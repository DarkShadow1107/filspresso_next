using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Tools;

namespace Filspresso.Sandbox;

/// <summary>
/// Explicitly configured, offline Hyper-V sessions, not connected to chat. Only trusted
/// administration runs on the host; generated scripts are decoded/executed in the guest.
/// The guest uses pinned file handles, capability-free AppContainer commands and jobs.
/// Machine/image/build qualification is required before application enablement.
/// </summary>
public sealed class HyperVSandbox : IWorkspaceSandbox
{
    private readonly IPowerShellRunner _runner;
    private readonly string _baseImagePath;
    private readonly string _workspaceRoot;
    private readonly TimeSpan _commandTimeout;
    private readonly TimeSpan _readinessTimeout;
    private readonly TimeSpan _cleanupTimeout;
    private readonly IGuestCredentialProvider? _credentials;
    private readonly ConcurrentDictionary<Guid, ManagedSession> _sessions = new();
    private int _starting;
    private readonly IHyperVRecoveryJournal _journal;
    private IDisposable? _lease;
    private bool _disposed;
    private readonly HyperVQualificationReceipt? _qualification;
    private PinnedLocalPath? _imagePin;
    private FileStream? _imageLock;
    public const int MaxSessions = 2;
    /// <summary>Guest single-file budget, mirrored from the guest scripts for host-side checks.</summary>
    public const int MaxSandboxFileBytes = HyperVGuestScripts.MaxFileBytes;

    private sealed class ManagedSession(Guid id, string name, string disk)
    {
        internal readonly Guid Id = id;
        internal readonly string Name = name;
        internal readonly string Disk = disk;
        internal readonly SemaphoreSlim Operation = new(1, 1);
        internal readonly SemaphoreSlim Cleanup = new(1, 1);
        internal readonly CancellationTokenSource Lifetime = new();
        internal readonly TaskCompletionSource StartupFinished = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal readonly Stopwatch Age = Stopwatch.StartNew();
        internal bool CreationTransportUnconfirmed;
        internal int State = (int)SandboxState.Starting;
        internal string? Failure;
    }

    public HyperVSandbox(IPowerShellRunner runner, string baseImagePath, string workspaceRoot,
        TimeSpan? commandTimeout = null, IGuestCredentialProvider? credentials = null,
        TimeSpan? readinessTimeout = null, TimeSpan? cleanupTimeout = null, IHyperVRecoveryJournal? recoveryJournal = null,
        HyperVQualificationReceipt? qualification = null)
    {
        ArgumentNullException.ThrowIfNull(runner);
        ArgumentException.ThrowIfNullOrWhiteSpace(baseImagePath);
        ArgumentException.ThrowIfNullOrWhiteSpace(workspaceRoot);
        if (!Path.IsPathFullyQualified(baseImagePath) || !Path.IsPathFullyQualified(workspaceRoot) ||
            baseImagePath.StartsWith(@"\\", StringComparison.Ordinal) || workspaceRoot.StartsWith(@"\\", StringComparison.Ordinal) ||
            !Path.GetExtension(baseImagePath).Equals(".vhdx", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Configure a local, absolute Windows VHDX image and state directory.");
        _runner = runner;
        _baseImagePath = Path.GetFullPath(baseImagePath);
        _workspaceRoot = Path.GetFullPath(workspaceRoot);
        _journal = recoveryJournal ?? new HyperVRecoveryJournal(_workspaceRoot);
        _qualification = qualification;
        _credentials = credentials;
        _commandTimeout = commandTimeout ?? TimeSpan.FromMinutes(5);
        _readinessTimeout = readinessTimeout ?? TimeSpan.FromMinutes(2);
        _cleanupTimeout = cleanupTimeout ?? TimeSpan.FromSeconds(30);
        if (_commandTimeout <= TimeSpan.Zero || _commandTimeout > TimeSpan.FromMinutes(5) ||
            _readinessTimeout <= TimeSpan.Zero || _readinessTimeout > TimeSpan.FromMinutes(5) ||
            _cleanupTimeout <= TimeSpan.Zero || _cleanupTimeout > TimeSpan.FromSeconds(30))
            throw new ArgumentOutOfRangeException(nameof(commandTimeout), "Sandbox timeouts must be positive and bounded.");
    }

    public async Task<(bool Available, string Reason)> ProbeAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_credentials is null || !_runner.SupportsStandardInput)
            return (false, "Configure dedicated guest credentials and a private-input PowerShell transport first.");
        const string probe = """
            $ErrorActionPreference = 'Stop'
            try {
                Get-Command New-VM, New-VHD, Get-VHD, Invoke-Command, Set-VMFirmware -ErrorAction Stop | Out-Null
                $id = [Security.Principal.WindowsIdentity]::GetCurrent()
                if (-not ([Security.Principal.WindowsPrincipal]::new($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 1 }
                if ((Get-Service vmms -ErrorAction Stop).Status -ne 'Running') { exit 1 }
                'PROBE_OK'
            } catch { exit 1 }
            """;
        try
        {
            var result = await _runner.RunAsync(probe, TimeSpan.FromSeconds(30), cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            return result.ExitCode == 0 && result.Output.Trim() == "PROBE_OK" ? (true, string.Empty) :
                (false, "Hyper-V administration is unavailable. Check the role, running VM management service and administrator rights.");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception) { return (false, "Hyper-V availability could not be verified."); }
    }

    public async Task<SandboxSessionInfo> StartAsync(string name, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (Interlocked.CompareExchange(ref _starting, 1, 0) != 0) throw new SandboxPolicyException("Sandbox startup is already in progress.");
        try
        {
            if (_sessions.Count >= MaxSessions) throw new SandboxPolicyException("Stop an existing or failed sandbox before starting another.");
            return await StartCoreAsync(name, cancellationToken).ConfigureAwait(false);
        }
        finally { Interlocked.Exchange(ref _starting, 0); }
    }

    private async Task<SandboxSessionInfo> StartCoreAsync(string name, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var credential = await GetCredentialAsync(cancellationToken).ConfigureAwait(false);
        var (available, reason) = await ProbeAsync(cancellationToken).ConfigureAwait(false);
        if (!available) throw new InvalidOperationException(reason);
        if (_lease is null) await RecoverCoreAsync(cancellationToken).ConfigureAwait(false);
        if (_qualification is { } qualified && _imageLock is null)
        {
            if (qualified.PolicyVersion != HyperVQualificationReceipt.CurrentPolicyVersion || !qualified.IsCurrentMachine() ||
                qualified.ImplementationSha256 != HyperVQualification.ImplementationSha256 ||
                DateTimeOffset.UtcNow - qualified.CreatedUtc > HyperVQualificationReceipt.MaxAge || qualified.CreatedUtc > DateTimeOffset.UtcNow.AddMinutes(2))
                throw new SandboxPolicyException("Qualification is stale or does not match this machine/build.");
            if (qualified.ImagePath != _baseImagePath) throw new SandboxPolicyException("Qualified image path mismatch.");
            _imagePin = new PinnedLocalPath(Path.GetDirectoryName(_baseImagePath)!);
            try
            {
                _imageLock = _imagePin.OpenFile(Path.GetFileName(_baseImagePath), shareRead: true);
                if (_imageLock.Length != qualified.ImageBytes ||
                    Convert.ToHexStringLower(await System.Security.Cryptography.SHA256.HashDataAsync(_imageLock, cancellationToken).ConfigureAwait(false)) != qualified.ImageSha256)
                    throw new SandboxPolicyException("Image bytes changed since qualification.");
            }
            catch { _imageLock?.Dispose(); _imageLock = null; _imagePin.Dispose(); _imagePin = null; throw; }
        }
        var id = Guid.NewGuid();
        var vmName = $"filspresso-{id:N}";
        var session = new ManagedSession(id, vmName, Path.Combine(_workspaceRoot, $"{vmName}.vhdx"));
        _journal.Add(new(id, vmName, $"Filspresso.v3.{id:N}"));
        _sessions[session.Id] = session; // Partial creation must remain discoverable if teardown fails.
        _ = ExpireAsync(session);
        using var startup = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, session.Lifetime.Token);
        var create = $$"""
            $ErrorActionPreference = 'Stop'
            if (-not (Test-Path -LiteralPath '{{Escape(_baseImagePath)}}' -PathType Leaf)) { throw 'Base image missing' }
            if ((Get-Item -LiteralPath '{{Escape(_baseImagePath)}}' -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Image is a reparse point' }
            $base = Get-VHD -Path '{{Escape(_baseImagePath)}}' -ErrorAction Stop
            if ($base.Attached -or $base.VhdType -eq 'Differencing') { throw 'Use an unattached provisioned base image' }
            New-Item -ItemType Directory -Path '{{Escape(_workspaceRoot)}}' -Force | Out-Null
            if ((Get-Item -LiteralPath '{{Escape(_workspaceRoot)}}' -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'State directory is a reparse point' }
            New-VHD -Path '{{Escape(session.Disk)}}' -ParentPath '{{Escape(_baseImagePath)}}' -Differencing | Out-Null
            $vm = New-VM -Name '{{vmName}}' -Path '{{Escape(_workspaceRoot)}}' -MemoryStartupBytes 2GB -VHDPath '{{Escape(session.Disk)}}' -Generation 2
            $vm | Set-VMMemory -DynamicMemoryEnabled $true -MinimumBytes 1GB -MaximumBytes 4GB
            $vm | Set-VMProcessor -Count 2
            $vm | Set-VM -AutomaticStartAction Nothing -AutomaticStopAction TurnOff -CheckpointType Disabled -Notes 'Filspresso.v3.{{id:N}}'
            # Remove even disconnected adapters. No virtual switch is configured.
            Get-VMNetworkAdapter -VMName '{{vmName}}' | Remove-VMNetworkAdapter -Confirm:$false
            if (@(Get-VMNetworkAdapter -VMName '{{vmName}}').Count -ne 0) { throw 'Adapter removal failed' }
            $bootDisk = Get-VMHardDiskDrive -VMName '{{vmName}}' | Select-Object -First 1
            $vm | Set-VMFirmware -EnableSecureBoot On -FirstBootDevice $bootDisk
            Start-VM -Name '{{vmName}}' | Out-Null
            'CREATED'
            """;
        try
        {
            var result = await _runner.RunAsync(create, TimeSpan.FromMinutes(5), startup.Token).ConfigureAwait(false);
            startup.Token.ThrowIfCancellationRequested();
            if (result.ExitCode != 0 || result.Output.Trim() != "CREATED") throw new InvalidOperationException();
            using var ready = CancellationTokenSource.CreateLinkedTokenSource(startup.Token);
            ready.CancelAfter(_readinessTimeout);
            for (;;)
            {
                ready.Token.ThrowIfCancellationRequested();
                try
                {
                    var response = await DirectAsync(session, HyperVGuestScripts.Ready, credential, TimeSpan.FromSeconds(15), ready.Token).ConfigureAwait(false);
                    if (response.TryGetProperty("ready", out var flag) && flag.ValueKind == JsonValueKind.True) break;
                }
                catch (OperationCanceledException) when (ready.IsCancellationRequested) { throw; }
                catch (Exception) { /* Retry readiness only; never create another VM for an ambiguous result. */ }
                await Task.Delay(TimeSpan.FromMilliseconds(250), ready.Token).ConfigureAwait(false);
            }
            cancellationToken.ThrowIfCancellationRequested();
            if (Interlocked.CompareExchange(ref session.State, (int)SandboxState.Ready, (int)SandboxState.Starting) != (int)SandboxState.Starting)
                throw new OperationCanceledException(startup.Token);
            return Info(session);
        }
        catch (Exception exception)
        {
            session.CreationTransportUnconfirmed = exception is PowerShellProcessCleanupException;
            session.StartupFinished.TrySetResult();
            var cleaned = await TryStopAsync(session).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            throw new InvalidOperationException(cleaned ? "Sandbox startup or guest readiness failed; partial resources were discarded." :
                "Sandbox startup failed and cleanup could not be confirmed. Inspect the failed session before retrying.");
        }
        finally { session.StartupFinished.TrySetResult(); }
    }

    public async Task<ToolResult> RunAsync(Guid sessionId, string command, string arguments, string? workingDirectory = null,
        TimeSpan? timeout = null, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(command) || command.Length + (long)(arguments?.Length ?? 0) > 8000)
            throw new SandboxPolicyException("Choose a nonempty command of at most 8000 characters.");
        var duration = timeout ?? _commandTimeout;
        if (duration <= TimeSpan.Zero || duration > _commandTimeout) throw new SandboxPolicyException("Command timeout exceeds sandbox policy.");
        var directory = workingDirectory is null ? HyperVGuestScripts.Root : CombineInsideGuest(workingDirectory);
        var clock = Stopwatch.StartNew();
        try
        {
            var result = await InGuestAsync(sessionId, HyperVGuestScripts.Run(command, arguments ?? string.Empty, directory, duration), duration, root =>
            {
                if (!root.TryGetProperty("exitCode", out var code) || !code.TryGetInt32(out var exit) ||
                    !root.TryGetProperty("stdout", out var stdout) || stdout.ValueKind != JsonValueKind.String ||
                    !root.TryGetProperty("stderr", out var stderr) || stderr.ValueKind != JsonValueKind.String ||
                    !ReadBoolean(root, "timedOut", out var timedOut) || !ReadBoolean(root, "outputLimited", out var limited) ||
                    !ReadBoolean(root, "descendantsClean", out var clean) || !clean)
                    throw new InvalidDataException();
                var output = stdout.GetString()!; var error = stderr.GetString()!;
                if (output.Length + (long)error.Length > HyperVGuestScripts.MaxCommandOutput || limited) throw new PowerShellOutputLimitException();
                if (timedOut) throw new TimeoutException();
                return new ToolResult(exit, output, error, TimeSpan.Zero, false);
            }, cancellationToken).ConfigureAwait(false);
            return result with { Duration = clock.Elapsed };
        }
        catch (TimeoutException)
        { return new ToolResult(-1, string.Empty, "Command time limit reached; the sandbox was discarded.", clock.Elapsed, true); }
    }

    public async Task<string> WriteFileAsync(Guid sessionId, string relativePath, ReadOnlyMemory<byte> contents, CancellationToken cancellationToken = default)
    {
        var full = CombineInsideGuest(relativePath);
        if (contents.Length > HyperVGuestScripts.MaxFileBytes) throw new SandboxPolicyException("Sandbox files are limited to 256 KiB.");
        return await InGuestAsync(sessionId, HyperVGuestScripts.Write(full, contents), _commandTimeout, root =>
        {
            if (!root.TryGetProperty("written", out var flag) || flag.ValueKind != JsonValueKind.True) throw new InvalidDataException();
            return full;
        }, cancellationToken).ConfigureAwait(false);
    }

    public async Task<string> ReadFileAsync(Guid sessionId, string relativePath, CancellationToken cancellationToken = default)
    {
        var full = CombineInsideGuest(relativePath);
        return await InGuestAsync(sessionId, HyperVGuestScripts.Read(full), _commandTimeout, root =>
        {
            if (root.TryGetProperty("missing", out var missing) && missing.ValueKind == JsonValueKind.True) throw new MissingGuestFileException();
            if (!root.TryGetProperty("bytes", out var value) || value.ValueKind != JsonValueKind.String || value.GetString() is not { Length: <= 349_528 } encoded)
                throw new InvalidDataException();
            var bytes = Convert.FromBase64String(encoded);
            if (bytes.Length > HyperVGuestScripts.MaxFileBytes) throw new InvalidDataException();
            return Encoding.UTF8.GetString(bytes);
        }, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Lists one workspace-relative directory in the guest. Null or empty lists the workspace
    /// root. A missing directory is reported, not an error the model must be silent about.
    /// </summary>
    public async Task<GuestListing> ListFilesAsync(Guid sessionId, string? relativePath, CancellationToken cancellationToken = default)
    {
        var full = string.IsNullOrEmpty(relativePath) ? HyperVGuestScripts.Root : CombineInsideGuest(relativePath);
        return await InGuestAsync(sessionId, HyperVGuestScripts.List(full), _commandTimeout, root =>
        {
            if (root.TryGetProperty("missing", out var missing) && missing.ValueKind == JsonValueKind.True) throw new MissingGuestFileException();
            if (!root.TryGetProperty("entries", out var entries) || entries.ValueKind != JsonValueKind.Array ||
                !ReadBoolean(root, "truncated", out var truncated))
                throw new InvalidDataException();
            var result = new List<GuestListingEntry>(entries.GetArrayLength());
            foreach (var entry in entries.EnumerateArray())
            {
                var parsed = ParseEntry(entry, result);
                if (result.Any(previous => previous.Name.Equals(parsed.Name, StringComparison.OrdinalIgnoreCase)))
                    throw new InvalidDataException();
                result.Add(parsed);
            }
            return new GuestListing(result, truncated);
        }, cancellationToken).ConfigureAwait(false);
    }

    private static GuestListingEntry ParseEntry(JsonElement entry, List<GuestListingEntry> parsed)
    {
        if (entry.ValueKind != JsonValueKind.Object ||
            !entry.TryGetProperty("name", out var name) || name.ValueKind != JsonValueKind.String ||
            name.GetString() is not { Length: > 0 and <= 240 } relative ||
            !WorkspacePath.IsRelativeFile(relative) ||
            !entry.TryGetProperty("kind", out var kind) || kind.ValueKind != JsonValueKind.String)
            throw new InvalidDataException();
        var isDirectory = kind.GetString() switch
        {
            "dir" => true,
            "file" => false,
            _ => throw new InvalidDataException(),
        };
        if (isDirectory) return new GuestListingEntry(relative, true, 0);
        if (!entry.TryGetProperty("bytes", out var size) || size.ValueKind != JsonValueKind.Number ||
            !size.TryGetInt64(out var bytes) || bytes is < 0 or > HyperVGuestScripts.MaxFileBytes)
            throw new InvalidDataException();
        return new GuestListingEntry(relative, false, bytes);
    }

    private async Task<T> InGuestAsync<T>(Guid sessionId, string script, TimeSpan timeout, Func<JsonElement, T> parse, CancellationToken caller)
    {
        caller.ThrowIfCancellationRequested();
        if (!_sessions.TryGetValue(sessionId, out var session)) throw new SandboxPolicyException("No such active sandbox session.");
        if (!await session.Operation.WaitAsync(0, caller).ConfigureAwait(false)) throw new SandboxPolicyException("This sandbox already has an operation in progress.");
        var dispatched = false;
        using var operation = CancellationTokenSource.CreateLinkedTokenSource(caller, session.Lifetime.Token);
        operation.CancelAfter(timeout);
        try
        {
            if (session.Age.Elapsed > TimeSpan.FromHours(1) || (_qualification is { } receipt && DateTimeOffset.UtcNow - receipt.CreatedUtc > HyperVQualificationReceipt.MaxAge))
                throw new TimeoutException("Sandbox lifetime or qualification expired.");
            if (Interlocked.CompareExchange(ref session.State, (int)SandboxState.Busy, (int)SandboxState.Ready) != (int)SandboxState.Ready)
                throw new SandboxPolicyException("The sandbox is not ready or was invalidated.");
            var credential = await GetCredentialAsync(operation.Token).ConfigureAwait(false);
            operation.Token.ThrowIfCancellationRequested();
            dispatched = true;
            var root = await DirectAsync(session, script, credential, timeout, operation.Token).ConfigureAwait(false);
            operation.Token.ThrowIfCancellationRequested();
            return parse(root);
        }
        catch (MissingGuestFileException) { throw new FileNotFoundException("No such file in the sandbox."); }
        catch (Exception exception)
        {
            var timedOut = operation.IsCancellationRequested && !caller.IsCancellationRequested && !session.Lifetime.IsCancellationRequested;
            var cleaned = (!dispatched && !timedOut && exception is not TimeoutException) || await TryStopAsync(session).ConfigureAwait(false);
            caller.ThrowIfCancellationRequested();
            if (!cleaned) throw new SandboxCleanupException();
            if (exception is SandboxPolicyException && !dispatched) throw;
            if (exception is PowerShellOutputLimitException) throw new PowerShellOutputLimitException();
            if (exception is TimeoutException || timedOut) throw new TimeoutException("Guest operation time limit reached; sandbox discarded.");
            throw new InvalidOperationException(dispatched ? "Guest operation failed; the sandbox was discarded." : "Guest operation could not be started.");
        }
        finally
        {
            Interlocked.CompareExchange(ref session.State, (int)SandboxState.Ready, (int)SandboxState.Busy);
            session.Operation.Release();
        }
    }

    private async Task<NetworkCredential> GetCredentialAsync(CancellationToken caller)
    {
        if (_credentials is null || !_runner.SupportsStandardInput) throw new SandboxPolicyException("Dedicated guest credentials and a private-input transport are required.");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(caller);
        deadline.CancelAfter(TimeSpan.FromSeconds(15));
        try
        {
            var value = await _credentials.GetCredentialAsync(deadline.Token).WaitAsync(deadline.Token).ConfigureAwait(false);
            var user = string.IsNullOrEmpty(value?.Domain) ? value?.UserName : value.Domain + "\\" + value.UserName;
            if (string.IsNullOrWhiteSpace(user) || user.Length > 256 || user.Any(char.IsControl) || value?.Password is not { Length: > 0 and <= 1024 } password)
                throw new SandboxPolicyException("Configure nonempty credentials for the provisioned guest image.");
            return new NetworkCredential(user, password);
        }
        catch (OperationCanceledException) when (caller.IsCancellationRequested) { throw; }
        catch (Exception) { throw new SandboxPolicyException("Dedicated guest credentials could not be loaded."); }
    }

    private async Task<JsonElement> DirectAsync(ManagedSession session, string script, NetworkCredential credential, TimeSpan timeout, CancellationToken token)
    {
        // JSON and encoded guest source are data on stdin. Neither password nor generated
        // source appears in the host command line, model context, or diagnostic exception.
        var input = JsonSerializer.Serialize(new { user = credential.UserName, password = credential.Password, script = ToBase64(script) });
        var result = await _runner.RunWithInputAsync(HyperVGuestScripts.Direct(session.Name), input, timeout, token).ConfigureAwait(false);
        token.ThrowIfCancellationRequested();
        if (result.ExitCode != 0) throw new InvalidOperationException("PowerShell Direct failed.");
        using var document = JsonDocument.Parse(result.Output, new JsonDocumentOptions { MaxDepth = 8 });
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("version", out var version) || !version.TryGetInt32(out var number) || number != 1)
            throw new InvalidDataException();
        return root.Clone();
    }

    public async Task StopAsync(Guid sessionId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (_sessions.TryGetValue(sessionId, out var session)) await StopSessionAsync(session).ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
    }

    private async Task<bool> TryStopAsync(ManagedSession session)
    {
        try { await StopSessionAsync(session).ConfigureAwait(false); return true; }
        catch (Exception) { return false; }
    }
    private async Task ExpireAsync(ManagedSession session)
    {
        try { await Task.Delay(TimeSpan.FromHours(1), session.Lifetime.Token).ConfigureAwait(false); }
        catch (OperationCanceledException) { return; }
        await TryStopAsync(session).ConfigureAwait(false);
    }

    private async Task StopSessionAsync(ManagedSession session)
    {
        // Invalidate BEFORE teardown or waiting for the cleanup lock. Never restore Ready
        // from an operation's finally block once cancellation/teardown has begun.
        session.Failure = "Sandbox teardown is in progress or could not be confirmed.";
        Volatile.Write(ref session.State, (int)SandboxState.Failed);
        try { session.Lifetime.Cancel(); } catch (AggregateException) { /* Teardown must still run if a transport callback fails. */ }
        using var deadline = new CancellationTokenSource(_cleanupTimeout);
        var entered = false;
        try
        {
            await session.Cleanup.WaitAsync(deadline.Token).ConfigureAwait(false); entered = true;
            if (!_sessions.ContainsKey(session.Id)) return;
            await session.StartupFinished.Task.WaitAsync(deadline.Token).ConfigureAwait(false);
            var teardown = $$"""
                $ErrorActionPreference = 'Stop'
                $vm = Get-VM -ErrorAction Stop | Where-Object { $_.Name -eq '{{session.Name}}' }
                if ($null -ne $vm) {
                    if (@($vm).Count -ne 1) { throw 'Ambiguous VM identity' }
                    $drives = @(Get-VMHardDiskDrive -VM $vm -ErrorAction Stop)
                    if ($drives.Count -ne 1 -or $drives[0].Path -ine '{{Escape(session.Disk)}}') { throw 'Foreign VM disk; refusing recovery' }
                    if ($vm.Notes -ne 'Filspresso.v3.{{session.Id:N}}' -and -not [string]::IsNullOrEmpty($vm.Notes)) { throw 'Foreign VM marker' }
                    if ($vm.State -ne 'Off') { $vm | Stop-VM -TurnOff -Force -Confirm:$false }
                    $vm | Remove-VM -Force -Confirm:$false
                }
                if (Get-VM -ErrorAction Stop | Where-Object { $_.Name -eq '{{session.Name}}' }) { throw 'VM removal not confirmed' }
                $disk = '{{Escape(session.Disk)}}'
                if (Test-Path -LiteralPath $disk -ErrorAction Stop) {
                    if ((Get-Item -LiteralPath $disk -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Disk is a reparse point' }
                    Remove-Item -LiteralPath $disk -Force -ErrorAction Stop
                }
                if (Test-Path -LiteralPath $disk -ErrorAction Stop) { throw 'Disk removal not confirmed' }
                'DONE'
                """;
            var result = await _runner.RunAsync(teardown, _cleanupTimeout, deadline.Token).ConfigureAwait(false);
            if (result.ExitCode != 0 || result.Output.Trim() != "DONE" || session.CreationTransportUnconfirmed) throw new SandboxCleanupException();
            _journal.Remove(session.Id);
            _sessions.TryRemove(session.Id, out _);
        }
        catch (Exception) { throw new SandboxCleanupException(); }
        finally { if (entered) session.Cleanup.Release(); }
    }

    public Task<IReadOnlyList<SandboxSessionInfo>> ListAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<SandboxSessionInfo>>(_sessions.Values.Select(Info).ToArray());
    }

    public async Task RecoverAsync(CancellationToken cancellationToken = default)
    {
        if (Interlocked.CompareExchange(ref _starting, 1, 0) != 0) throw new SandboxPolicyException("Startup/recovery already in progress.");
        try { await RecoverCoreAsync(cancellationToken).ConfigureAwait(false); }
        finally { Interlocked.Exchange(ref _starting, 0); }
    }
    private async Task RecoverCoreAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_lease is not null) return;
        _lease = _journal.Acquire();
        try
        {
            foreach (var record in _journal.Read())
            {
                cancellationToken.ThrowIfCancellationRequested();
                var stale = new ManagedSession(record.Id, record.Name, Path.Combine(_workspaceRoot, record.Name + ".vhdx"));
                stale.StartupFinished.TrySetResult(); _sessions[record.Id] = stale;
                await StopSessionAsync(stale).ConfigureAwait(false);
            }
        }
        catch { _lease.Dispose(); _lease = null; throw; }
    }
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var session in _sessions.Values) session.Lifetime.Cancel();
        if (Volatile.Read(ref _starting) != 0) throw new InvalidOperationException("Await startup cancellation before disposing the sandbox.");
        foreach (var session in _sessions.Values) { try { StopSessionAsync(session).GetAwaiter().GetResult(); } catch { } }
        // Intents survive. The next owner must recover before any new guest can start.
        _lease?.Dispose(); _lease = null;
        _imageLock?.Dispose(); _imagePin?.Dispose();
    }

    internal Task<JsonElement> QualificationProbeAsync(Guid id, string trustedSource, CancellationToken token) =>
        InGuestAsync(id, HyperVGuestScripts.Guard + "\n" + trustedSource, TimeSpan.FromSeconds(30), value => value, token);

    private static SandboxSessionInfo Info(ManagedSession session) => new(session.Id, session.Name, (SandboxState)Volatile.Read(ref session.State), 0, session.Failure);
    private sealed class MissingGuestFileException : Exception { }
    private static bool ReadBoolean(JsonElement root, string name, out bool value)
    {
        value = false;
        if (!root.TryGetProperty(name, out var field) || field.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
        value = field.GetBoolean(); return true;
    }

    /// <summary>Lexical containment only; guest reparse-point checks are also required.</summary>
    internal static string CombineInsideGuest(string relativePath)
    {
        var normalized = relativePath?.Replace('\\', '/');
        if (!WorkspacePath.IsRelativeFile(normalized)) throw new ArgumentException("Choose a relative file path inside the sandbox workspace.", nameof(relativePath));
        var combined = Path.GetFullPath(Path.Combine(HyperVGuestScripts.Root, normalized!.Replace('/', Path.DirectorySeparatorChar)));
        if (!combined.StartsWith(HyperVGuestScripts.Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("The path must stay inside the sandbox workspace.", nameof(relativePath));
        return combined;
    }

    internal static string Escape(string value) => value.Replace("'", "''");
    internal static string ToBase64(string script) => Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
}

public sealed class SandboxCleanupException : Exception
{
    public SandboxCleanupException() : base("Sandbox teardown could not be confirmed. The session is invalidated; retry Stop or perform manual cleanup.") { }
}
