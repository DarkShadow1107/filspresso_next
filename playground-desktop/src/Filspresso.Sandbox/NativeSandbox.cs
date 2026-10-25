using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Storage;
using Filspresso.Core.Tools;

namespace Filspresso.Sandbox;

/// <summary>Explicit, reduced-isolation fallback. No VM or Windows Sandbox CLI. Only the
/// capability-free lowbox child interprets generated source; the trusted broker never does.
/// Files live in a new app-owned staging tree, not the user's original project.</summary>
public sealed class NativeSandbox : IWorkspaceSandbox, ISandboxSnapshot
{
    public static string DefaultRoot => Path.Combine(DesktopDataPaths.UserDataDirectory, "native-sandbox");
    private readonly string _root;
    private readonly IPowerShellRunner _runner;
    private readonly IHyperVRecoveryJournal _journal;
    private readonly SemaphoreSlim _operation = new(1), _cleanup = new(1), _recovery = new(1);
    private IDisposable? _lease;
    private PinnedLocalPath? _workspace;
    private Guid? _id;
    private SandboxState _state;
    private CancellationTokenSource _lifetime = new();
    private TaskCompletionSource? _finished;
    private TaskCompletionSource? _starting;
    private bool _disposed, _transportUnconfirmed;

    public NativeSandbox(IPowerShellRunner runner, string? root = null, IHyperVRecoveryJournal? journal = null)
    {
        if (!runner.SupportsStandardInput) throw new ArgumentException("A private-input, kill-on-close job broker is required.");
        _runner = runner; _root = PinnedLocalPath.Normalize(root ?? DefaultRoot); _journal = journal ?? new HyperVRecoveryJournal(_root);
    }
    public async Task<SandboxSessionInfo> StartAsync(string name, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!await _operation.WaitAsync(0, cancellationToken).ConfigureAwait(false)) throw new SandboxPolicyException("Native workspace is busy.");
        if (_id is not null) { _operation.Release(); throw new SandboxPolicyException("Discard the previous native workspace first."); }
        _starting = new(TaskCreationOptions.RunContinuationsAsynchronously); _lifetime = new();
        using var startup = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token);
        try
        {
            await RecoverAsync(startup.Token).ConfigureAwait(false); startup.Token.ThrowIfCancellationRequested();
            var id = Guid.NewGuid();
            _journal.Add(new(id, "filspresso-" + id.ToString("N"), "Filspresso.v3." + id.ToString("N")));
            _id = id; _state = SandboxState.Starting; _transportUnconfirmed = false;
            _workspace = new(WorkspacePathFor(id), create: true);
            startup.Token.ThrowIfCancellationRequested();
            _state = SandboxState.Ready; _ = ExpireAsync(id);
            return new(id, "Native restricted workspace (shared Windows kernel)", _state, 0, null);
        }
        catch { if (_id is not null) _state = SandboxState.Failed; throw; }
        finally { _starting.TrySetResult(); _operation.Release(); }
    }
    public async Task RecoverAsync(CancellationToken cancellationToken = default)
    {
        await _recovery.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
        if (_lease is not null) return;
        _lease = _journal.Acquire();
        try
        {
            foreach (var record in _journal.Read())
            {
                if (File.Exists(Path.Combine(_root, record.Id.ToString("N") + ".uncertain")))
                    throw new IOException("Native process shutdown was not confirmed. Restart Windows and review the recorded state before recovery; no weaker retry is allowed.");
                await RecoverProfileAsync(record.Id, cancellationToken).ConfigureAwait(false);
                _journal.Remove(record.Id);
            }
        }
        catch { _lease.Dispose(); _lease = null; throw; }
        }
        finally { _recovery.Release(); }
    }
    public async Task<ToolResult> RunAsync(Guid sessionId, string command, string arguments, string? workingDirectory = null,
        TimeSpan? timeout = null, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(command) || command.Length + (long)(arguments?.Length ?? 0) > 8000) throw new SandboxPolicyException("Invalid command length.");
        var duration = timeout ?? TimeSpan.FromSeconds(120);
        if (duration <= TimeSpan.Zero || duration > TimeSpan.FromSeconds(120)) throw new SandboxPolicyException("Native commands are limited to 120 seconds.");
        var directory = string.IsNullOrEmpty(workingDirectory) ? WorkspacePathFor(sessionId) : Resolve(sessionId, workingDirectory);
        var source = $$"""
            [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
            $OutputEncoding = [Console]::OutputEncoding
            $ErrorActionPreference = 'Stop'
            $global:LASTEXITCODE = 0
            try {
                # A scoped drive avoids PowerShell normalizing every private ancestor of
                # the user's profile. No access to those ancestors is granted to fix this.
                New-PSDrive -Name Workspace -PSProvider FileSystem -Root '{{directory.Replace("'", "''")}}' -Scope Global | Out-Null
                Set-Location -LiteralPath 'Workspace:\'
                [Environment]::CurrentDirectory = '{{directory.Replace("'", "''")}}'
                & {
                    {{command}} {{arguments}}
                }
                $ok = $?
                if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
                if (-not $ok) { exit 1 }; exit 0
            } catch { [Console]::Error.WriteLine(('Native command error at line ' + $_.InvocationInfo.ScriptLineNumber + ' (' + $_.Exception.GetType().FullName + '): ' + $_.Exception.Message)); exit 1 }
            """;
        var clock = Stopwatch.StartNew();
        return await OperateAsync(sessionId, async token =>
        {
            // Caller cannot select the profile, broker executable, helper source or staging root.
            var input = JsonSerializer.Serialize(new { operation = "run", boundary = HyperVGuestScripts.BoundarySource,
                workspace = WorkspacePathFor(sessionId), directory, encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(source)),
                milliseconds = (int)duration.TotalMilliseconds, profile = Profile(sessionId) });
            var response = await _runner.RunWithInputAsync(Broker, input, duration + TimeSpan.FromSeconds(20), token).ConfigureAwait(false);
            if (response.ExitCode != 0) throw new IOException("Native isolation broker failed. No unrestricted retry is permitted.");
            using var document = JsonDocument.Parse(response.Output, new JsonDocumentOptions { MaxDepth = 4 });
            var value = document.RootElement;
            if (!value.GetProperty("DescendantsClean").GetBoolean()) throw new IOException("Native descendant cleanup is unconfirmed.");
            var stdout = value.GetProperty("Stdout").GetString()!; var stderr = value.GetProperty("Stderr").GetString()!;
            if (value.GetProperty("OutputLimited").GetBoolean() || (long)stdout.Length + stderr.Length > 131072) throw new PowerShellOutputLimitException();
            if (value.GetProperty("TimedOut").GetBoolean()) throw new TimeoutException("Native command timed out; workspace invalidated.");
            return new ToolResult(value.GetProperty("ExitCode").GetInt32(), stdout, stderr, clock.Elapsed, false);
        }, cancellationToken).ConfigureAwait(false);
    }
    public Task<string> WriteFileAsync(Guid sessionId, string relativePath, ReadOnlyMemory<byte> contents, CancellationToken cancellationToken = default)
    {
        var full = Resolve(sessionId, relativePath);
        if (contents.Length > 262144) throw new SandboxPolicyException("Native text files are limited to 256 KiB.");
        return OperateAsync(sessionId, token =>
        {
            token.ThrowIfCancellationRequested(); using var pin = new PinnedLocalPath(Path.GetDirectoryName(full)!, create: true);
            FileStream file;
            try { file = pin.OpenFile(Path.GetFileName(full), FileAccess.ReadWrite); }
            catch (FileNotFoundException) { file = pin.OpenFile(Path.GetFileName(full), FileAccess.ReadWrite, createNew: true); }
            using (file) { file.Write(contents.Span); file.SetLength(contents.Length); file.Flush(true); }
            return Task.FromResult(full);
        }, cancellationToken);
    }
    public Task<string> ReadFileAsync(Guid sessionId, string relativePath, CancellationToken cancellationToken = default)
    {
        var full = Resolve(sessionId, relativePath);
        return OperateAsync(sessionId, token =>
        {
            token.ThrowIfCancellationRequested();
            try { return Task.FromResult(SandboxTextSnapshot.Read(full)); }
            catch (FileNotFoundException) { return Task.FromResult("[File does not exist in this workspace.]"); }
            catch (DirectoryNotFoundException) { return Task.FromResult("[Directory does not exist in this workspace.]"); }
        }, cancellationToken);
    }
    public Task<GuestListing> ListFilesAsync(Guid sessionId, string? relativePath, CancellationToken cancellationToken = default)
    {
        var full = string.IsNullOrEmpty(relativePath) ? WorkspacePathFor(sessionId) : Resolve(sessionId, relativePath);
        return OperateAsync(sessionId, token =>
        {
            using var pin = new PinnedLocalPath(full);
            var entries = new List<GuestListingEntry>(); var truncated = false;
            foreach (var path in Directory.EnumerateFileSystemEntries(full))
            {
                token.ThrowIfCancellationRequested();
                if (entries.Count >= 256) { truncated = true; break; }
                var name = Path.GetFileName(path);
                if (!Filspresso.Core.Tools.WorkspacePath.IsRelativeFile(name)) throw new InvalidDataException("Unsupported workspace file name.");
                if (Directory.Exists(path)) { using var child = new PinnedLocalPath(path); entries.Add(new(name, true, 0)); }
                else { using var file = pin.OpenFile(name); entries.Add(new(name, false, file.Length)); }
            }
            return Task.FromResult(new GuestListing(entries.AsReadOnly(), truncated));
        }, cancellationToken);
    }
    public Task<IReadOnlyList<SandboxTextFile>> CaptureAsync(Guid sessionId, IReadOnlyCollection<string> trackedPaths, CancellationToken cancellationToken = default) =>
        OperateAsync(sessionId, token => Task.FromResult(SandboxTextSnapshot.Capture(WorkspacePathFor(sessionId), trackedPaths, token)), cancellationToken);

    private async Task<T> OperateAsync<T>(Guid id, Func<CancellationToken, Task<T>> operation, CancellationToken caller)
    {
        if (_disposed || _id != id || _state != SandboxState.Ready) throw new SandboxPolicyException("No ready native workspace.");
        if (!await _operation.WaitAsync(0, caller).ConfigureAwait(false)) throw new SandboxPolicyException("Native workspace is busy.");
        _finished = new(TaskCreationOptions.RunContinuationsAsynchronously);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(caller, _lifetime.Token);
        linked.CancelAfter(TimeSpan.FromSeconds(150));
        try { _state = SandboxState.Busy; return await operation(linked.Token).ConfigureAwait(false); }
        catch (PowerShellProcessCleanupException) { MarkUnconfirmed(id); _state = SandboxState.Failed; throw; }
        catch { _state = SandboxState.Failed; throw; }
        finally
        {
            if (_state == SandboxState.Busy) _state = SandboxState.Ready;
            _finished.TrySetResult(); _operation.Release();
        }
    }
    public async Task StopAsync(Guid sessionId, CancellationToken cancellationToken = default)
    {
        if (_id != sessionId) return;
        _state = SandboxState.Failed; _lifetime.Cancel();
        using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await _cleanup.WaitAsync(cleanup.Token).ConfigureAwait(false);
        try
        {
            if (_id != sessionId) return;
            if (_starting is { } startup) await startup.Task.WaitAsync(cleanup.Token).ConfigureAwait(false);
            if (_finished is { } work)
            {
                try { await work.Task.WaitAsync(cleanup.Token).ConfigureAwait(false); }
                catch { MarkUnconfirmed(sessionId); throw; }
            }
            if (_transportUnconfirmed) throw new IOException("Native broker shutdown is unconfirmed. Restart Windows and recover before reusing this state.");
            await RecoverProfileAsync(sessionId, cleanup.Token).ConfigureAwait(false);
            _journal.Remove(sessionId); _workspace?.Dispose(); _workspace = null; _id = null; _state = SandboxState.Stopped;
        }
        finally { _cleanup.Release(); }
    }
    private async Task RecoverProfileAsync(Guid id, CancellationToken token)
    {
        var input = JsonSerializer.Serialize(new { operation = "recover", boundary = HyperVGuestScripts.BoundarySource, workspace = WorkspacePathFor(id), profile = Profile(id) });
        var result = await _runner.RunWithInputAsync(Broker, input, TimeSpan.FromSeconds(15), token).ConfigureAwait(false);
        if (result.ExitCode != 0 || result.Output.Trim() != "RECOVERED") throw new IOException("Native profile cleanup is unconfirmed.");
    }
    private string WorkspacePathFor(Guid id) => Path.Combine(_root, id.ToString("N"), "workspace");
    private void MarkUnconfirmed(Guid id)
    {
        _transportUnconfirmed = true;
        using var pin = new PinnedLocalPath(_root);
        try { using var file = pin.OpenFile(id.ToString("N") + ".uncertain", FileAccess.ReadWrite, createNew: true); file.WriteByte(1); file.Flush(true); }
        catch (IOException) when (File.Exists(Path.Combine(_root, id.ToString("N") + ".uncertain"))) { }
    }
    private static string Profile(Guid id) => "Filspresso." + id.ToString("N");
    private string Resolve(Guid id, string relative) => Filspresso.Core.Tools.WorkspacePath.IsRelativeFile(relative)
        ? Path.Combine(WorkspacePathFor(id), relative.Replace('/', '\\')) : throw new SandboxPolicyException("Only relative workspace paths are permitted.");
    public Task<IReadOnlyList<SandboxSessionInfo>> ListAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<SandboxSessionInfo>>(_id is { } id ? [new(id, "Native restricted workspace", _state, 0, _state == SandboxState.Failed ? "Discard/recovery required." : null)] : []);
    private async Task ExpireAsync(Guid id)
    { try { await Task.Delay(TimeSpan.FromHours(1), _lifetime.Token).ConfigureAwait(false); await StopAsync(id).ConfigureAwait(false); } catch { /* Intent retained on cleanup failure. */ } }
    public void Dispose()
    {
        if (_disposed) return; _disposed = true;
        _lifetime.Cancel(); _starting?.Task.GetAwaiter().GetResult();
        if (_id is { } id) { try { StopAsync(id).GetAwaiter().GetResult(); } catch { } }
        _lifetime.Cancel(); _workspace?.Dispose(); _lease?.Dispose();
    }
    private const string Broker = """
        $ErrorActionPreference = 'Stop'
        try {
            $request = [Console]::In.ReadLine() | ConvertFrom-Json
            Add-Type -TypeDefinition $request.boundary
            if ($request.operation -eq 'recover') {
                [Filspresso.Guest.Command]::RecoverProfile([string]$request.workspace, [string]$request.profile)
                [Console]::WriteLine('RECOVERED')
            } elseif ($request.operation -eq 'run') {
                $result = [Filspresso.Guest.Command]::RunRestricted([string]$request.workspace, [string]$request.directory, [string]$request.encoded, [int]$request.milliseconds, [string]$request.profile)
                $result | ConvertTo-Json -Compress
            } else { throw 'Unknown operation' }
        } catch { [Console]::Error.WriteLine('Native isolation failed; unrestricted retry is forbidden.'); exit 1 }
        """;
}
