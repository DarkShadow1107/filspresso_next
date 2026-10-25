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

/// <summary>Windows-owned disposable VM; no VHDX, password, network or host executor.
/// Only an app-owned request directory (read-only) and untrusted reply directory (writable)
/// are mapped. Results are bounded no-follow reads; never executed on the host.</summary>
public sealed class WindowsSandbox : IWorkspaceSandbox, ISandboxSnapshot
{
    public static string DefaultRoot => Path.Combine(DesktopDataPaths.UserDataDirectory, "windows-sandbox");
    private readonly IWindowsSandboxCli _cli;
    private readonly string _root;
    private readonly IHyperVRecoveryJournal _journal;
    private readonly SemaphoreSlim _operation = new(1), _cleanup = new(1);
    private CancellationTokenSource _lifetime = new();
    private IDisposable? _lease;
    private PinnedLocalPath? _inputPin, _outputPin;
    private Guid? _id;
    private SandboxState _state;
    private bool _disposed;
    private TaskCompletionSource? _starting;
    private int _requests;
    public WindowsSandbox(IWindowsSandboxCli cli, string? root = null, IHyperVRecoveryJournal? journal = null)
    { _cli = cli; _root = PinnedLocalPath.Normalize(root ?? DefaultRoot); _journal = journal ?? new HyperVRecoveryJournal(_root); }

    public async Task<SandboxSessionInfo> StartAsync(string name, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!await _operation.WaitAsync(0, cancellationToken).ConfigureAwait(false)) throw new SandboxPolicyException("Sandbox is busy.");
        if (_id is not null) { _operation.Release(); throw new SandboxPolicyException("Discard the previous sandbox before starting another."); }
        _starting = new(TaskCreationOptions.RunContinuationsAsynchronously);
        _lifetime = new();
        using var startup = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token);
        startup.CancelAfter(TimeSpan.FromMinutes(4)); var startToken = startup.Token;
        try
        {
            _requests = 0;
            await RecoverAsync(startToken).ConfigureAwait(false);
            if ((await InventoryAsync(startToken).ConfigureAwait(false)).Count != 0)
                throw new SandboxPolicyException("Another Windows Sandbox exists. It will not be adopted or stopped. Close it yourself before starting Playground execution.");
            startToken.ThrowIfCancellationRequested();
            var id = Guid.NewGuid();
            _journal.Add(new(id, "filspresso-" + id.ToString("N"), "Filspresso.v3." + id.ToString("N")));
            _id = id; _state = SandboxState.Starting;
            var directory = Path.Combine(_root, id.ToString("N"));
            _inputPin = new(Path.Combine(directory, "input"), create: true);
            _outputPin = new(Path.Combine(directory, "output"), create: true);
            WriteNew(_inputPin, "boundary.cs", Encoding.UTF8.GetBytes(HyperVGuestScripts.BoundarySource));
            var xml = WindowsSandboxConfiguration.Create(_inputPin.DirectoryPath, _outputPin.DirectoryPath);
            using (var pin = new PinnedLocalPath(_root)) WriteNew(pin, id.ToString("N") + ".uncertain", [1]);
            var result = await _cli.RunAsync(["start", "--id", id.ToString(), "--config", xml], TimeSpan.FromMinutes(3), startToken).ConfigureAwait(false);
            var response = Parse(result);
            if (!response.TryGetProperty("Id", out var value) || !Guid.TryParse(value.GetString(), out var actual) || actual != id)
                throw new InvalidDataException("Sandbox did not return the requested identity.");
            File.Delete(Path.Combine(_root, id.ToString("N") + ".uncertain"));
            var ready = await ExchangeAsync(WindowsSandboxScripts.Ready, TimeSpan.FromMinutes(1), startToken).ConfigureAwait(false);
            if (!ready.TryGetProperty("ready", out var flag) || flag.ValueKind != JsonValueKind.True) throw new InvalidDataException("Sandbox readiness failed.");
            startToken.ThrowIfCancellationRequested();
            _state = SandboxState.Ready;
            _ = ExpireAsync(id);
            return new(id, "Windows Sandbox", _state, 0, null);
        }
        catch
        {
            _starting.TrySetResult();
            if (_id is { } id) { try { await StopAsync(id, CancellationToken.None).ConfigureAwait(false); } catch { } }
            throw;
        }
        finally { _starting.TrySetResult(); _operation.Release(); }
    }

    /// <summary>Only authenticated IDs from this app's distinct state root are reclaimed.</summary>
    public async Task RecoverAsync(CancellationToken cancellationToken = default)
    {
        if (_lease is not null) return;
        _lease = _journal.Acquire();
        try
        {
            foreach (var record in _journal.Read())
            {
                if (File.Exists(Path.Combine(_root, record.Id.ToString("N") + ".uncertain")))
                    throw new IOException("Sandbox creation was interrupted before acknowledgement. Inspect this recorded ID with wsb list; operator recovery is required before retrying.");
                await StopOwnedAsync(record.Id, cancellationToken).ConfigureAwait(false);
                _journal.Remove(record.Id);
            }
        }
        catch { _lease.Dispose(); _lease = null; throw; }
    }

    public async Task<ToolResult> RunAsync(Guid sessionId, string command, string arguments, string? workingDirectory = null,
        TimeSpan? timeout = null, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(command) || command.Length + (long)(arguments?.Length ?? 0) > 8000) throw new SandboxPolicyException("Invalid command length.");
        var duration = timeout ?? TimeSpan.FromSeconds(120);
        if (duration <= TimeSpan.Zero || duration > TimeSpan.FromSeconds(120)) throw new SandboxPolicyException("Commands are limited to 120 seconds.");
        var directory = string.IsNullOrEmpty(workingDirectory) ? HyperVGuestScripts.Root : GuestPath(workingDirectory);
        var clock = Stopwatch.StartNew();
        try
        {
            var result = await OperateAsync(sessionId, HyperVGuestScripts.Run(command, arguments ?? "", directory, duration), duration + TimeSpan.FromSeconds(15), cancellationToken).ConfigureAwait(false);
            var stdout = result.GetProperty("stdout").GetString()!; var stderr = result.GetProperty("stderr").GetString()!;
            if (!result.GetProperty("descendantsClean").GetBoolean()) throw new IOException("Command cleanup failed.");
            if (result.GetProperty("outputLimited").GetBoolean() || stdout.Length + (long)stderr.Length > HyperVGuestScripts.MaxCommandOutput)
                throw new PowerShellOutputLimitException();
            if (result.GetProperty("timedOut").GetBoolean()) throw new TimeoutException();
            return new(result.GetProperty("exitCode").GetInt32(), stdout, stderr, clock.Elapsed, false);
        }
        catch (SandboxPolicyException) { throw; }
        catch
        {
            await StopAsync(sessionId, CancellationToken.None).ConfigureAwait(false);
            throw;
        }
    }

    public async Task<string> WriteFileAsync(Guid sessionId, string relativePath, ReadOnlyMemory<byte> contents, CancellationToken cancellationToken = default)
    {
        var path = GuestPath(relativePath);
        if (contents.Length > HyperVGuestScripts.MaxFileBytes) throw new SandboxPolicyException("File exceeds 256 KiB.");
        return await ValidateAsync(sessionId, async () =>
        {
            var result = await OperateAsync(sessionId, HyperVGuestScripts.Write(path, contents), TimeSpan.FromSeconds(30), cancellationToken).ConfigureAwait(false);
            if (result.GetProperty("written").ValueKind != JsonValueKind.True) throw new InvalidDataException();
            return path;
        }).ConfigureAwait(false);
    }
    public async Task<string> ReadFileAsync(Guid sessionId, string relativePath, CancellationToken cancellationToken = default)
    {
        var path = GuestPath(relativePath);
        return await ValidateAsync(sessionId, async () =>
        {
            var result = await OperateAsync(sessionId, HyperVGuestScripts.Read(path), TimeSpan.FromSeconds(30), cancellationToken).ConfigureAwait(false);
            if (result.TryGetProperty("missing", out var missing) && missing.ValueKind == JsonValueKind.True) return "[File does not exist in this workspace.]";
            return Decode(result.GetProperty("bytes").GetString()!);
        }).ConfigureAwait(false);
    }
    public async Task<GuestListing> ListFilesAsync(Guid sessionId, string? relativePath, CancellationToken cancellationToken = default)
    {
        var path = string.IsNullOrEmpty(relativePath) ? HyperVGuestScripts.Root : GuestPath(relativePath);
        return await ValidateAsync<GuestListing>(sessionId, async () =>
        {
            var result = await OperateAsync(sessionId, HyperVGuestScripts.List(path), TimeSpan.FromSeconds(30), cancellationToken).ConfigureAwait(false);
            var entries = new List<GuestListingEntry>();
            foreach (var entry in result.GetProperty("entries").EnumerateArray())
            {
                var name = entry.GetProperty("name").GetString()!; var kind = entry.GetProperty("kind").GetString();
                if (entries.Count >= 256 || !WorkspacePath.IsRelativeFile(name) || name.Contains('/') || entries.Any(item => item.Name.Equals(name, StringComparison.OrdinalIgnoreCase)) || kind is not ("dir" or "file"))
                    throw new InvalidDataException("Invalid guest listing.");
                var size = kind == "file" ? entry.GetProperty("bytes").GetInt64() : 0;
                if (size is < 0 or > 262_144) throw new InvalidDataException();
                entries.Add(new(name, kind == "dir", size));
            }
            return new(entries.AsReadOnly(), result.GetProperty("truncated").GetBoolean());
        }).ConfigureAwait(false);
    }
    public async Task<IReadOnlyList<SandboxTextFile>> CaptureAsync(Guid sessionId, IReadOnlyCollection<string> trackedPaths, CancellationToken cancellationToken = default)
    {
        if (trackedPaths.Count > 256 || trackedPaths.Any(path => !WorkspacePath.IsRelativeFile(path))) throw new SandboxPolicyException("Invalid snapshot path set.");
        return await ValidateAsync<IReadOnlyList<SandboxTextFile>>(sessionId, async () =>
        {
            var result = await OperateAsync(sessionId, WindowsSandboxScripts.Snapshot(trackedPaths), TimeSpan.FromSeconds(45), cancellationToken).ConfigureAwait(false);
            var files = new List<SandboxTextFile>(); var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase); long bytes = 0;
            foreach (var file in result.GetProperty("files").EnumerateArray())
            {
                var path = file.GetProperty("path").GetString()!;
                if (files.Count >= 256 || !WorkspacePath.IsRelativeFile(path) || !seen.Add(path)) throw new InvalidDataException("Invalid snapshot file set.");
                var text = Decode(file.GetProperty("bytes").GetString()!); bytes += Encoding.UTF8.GetByteCount(text);
                if (bytes > 8 * 1024 * 1024) throw new InvalidDataException("Snapshot exceeds 8 MiB.");
                files.Add(new(path, text));
            }
            return files.AsReadOnly();
        }).ConfigureAwait(false);
    }
    internal Task<JsonElement> QualificationProbeAsync(Guid id, string source, CancellationToken token) =>
        OperateAsync(id, source, TimeSpan.FromSeconds(45), token);
    private async Task<JsonElement> OperateAsync(Guid id, string script, TimeSpan timeout, CancellationToken cancellationToken)
    {
        if (_disposed || id != _id || _state != SandboxState.Ready) throw new SandboxPolicyException("No ready Windows Sandbox workspace.");
        if (!await _operation.WaitAsync(0, cancellationToken).ConfigureAwait(false)) throw new SandboxPolicyException("Sandbox is busy.");
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token);
        try { _state = SandboxState.Busy; return await ExchangeAsync(script, timeout, linked.Token).ConfigureAwait(false); }
        catch { await StopAsync(id, CancellationToken.None).ConfigureAwait(false); throw; }
        finally { if (_state == SandboxState.Busy) _state = SandboxState.Ready; _operation.Release(); }
    }
    private async Task<JsonElement> ExchangeAsync(string source, TimeSpan timeout, CancellationToken token)
    {
        if (++_requests > 4096) throw new IOException("Sandbox request budget exhausted; discard this VM.");
        var nonce = Guid.NewGuid().ToString("N"); var input = _inputPin ?? throw new IOException(); var output = _outputPin ?? throw new IOException();
        // Guard's embedded source would exceed process-command-line limits; Add-Type is
        // redirected to the immutable source mapping instead. The entire script stays a file.
        source = source.Replace(HyperVGuestScripts.Guard, "", StringComparison.Ordinal);
        WriteNew(input, nonce + ".ps1", Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(WindowsSandboxScripts.Wrap(nonce, source))).ToArray());
        var command = @"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\filspresso-in\" + nonce + ".ps1";
        var result = Parse(await _cli.RunAsync(["exec", "--id", _id!.Value.ToString(), "--run-as", "System", "--command", command], timeout, token).ConfigureAwait(false));
        if (result.GetProperty("ExitCode").GetInt32() != 0) throw new IOException("Guest operation failed.");
        using var reply = output.OpenFile(nonce + ".json");
        if (reply.Length is <= 0 or > 12_000_000) throw new InvalidDataException("Guest reply size exceeds policy.");
        var bytes = new byte[checked((int)reply.Length)]; reply.ReadExactly(bytes);
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 8 });
        var envelope = document.RootElement;
        UniqueFields(envelope);
        if (envelope.GetProperty("nonce").GetString() != nonce || envelope.GetProperty("version").GetInt32() != 1 || !envelope.GetProperty("ok").GetBoolean())
            throw new InvalidDataException("Guest reply identity or operation failed.");
        var payload = envelope.GetProperty("payload");
        if (payload.ValueKind != JsonValueKind.Object || payload.GetProperty("version").GetInt32() != 1) throw new InvalidDataException();
        return payload.Clone();
    }
    private async Task<T> ValidateAsync<T>(Guid id, Func<Task<T>> operation)
    {
        try { return await operation().ConfigureAwait(false); }
        catch (SandboxPolicyException) { throw; }
        catch { await StopAsync(id, CancellationToken.None).ConfigureAwait(false); throw; }
    }
    public async Task StopAsync(Guid sessionId, CancellationToken cancellationToken = default)
    {
        if (_id != sessionId) return;
        _state = SandboxState.Failed; _lifetime.Cancel();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(25));
        await _cleanup.WaitAsync(deadline.Token).ConfigureAwait(false);
        try
        {
            if (_id != sessionId) return;
            if (_starting is { } starting) await starting.Task.WaitAsync(deadline.Token).ConfigureAwait(false);
            await StopOwnedAsync(sessionId, deadline.Token).ConfigureAwait(false);
            if (File.Exists(Path.Combine(_root, sessionId.ToString("N") + ".uncertain")))
                throw new IOException("Sandbox creation acknowledgement was lost. Retained intent requires operator review; absence from one inventory is not proof a service cannot finish creation later.");
            _journal.Remove(sessionId); _id = null; _state = SandboxState.Stopped;
            _inputPin?.Dispose(); _outputPin?.Dispose(); _inputPin = _outputPin = null;
            // Retain staging for inspection; never recursively delete guest-writable content.
        }
        finally { _cleanup.Release(); }
    }
    private async Task StopOwnedAsync(Guid id, CancellationToken token)
    {
        var current = await InventoryAsync(token).ConfigureAwait(false);
        if (current.Contains(id))
        {
            var stop = await _cli.RunAsync(["stop", "--id", id.ToString()], TimeSpan.FromSeconds(15), token).ConfigureAwait(false);
            if (stop.ExitCode != 0) throw new IOException("Windows Sandbox stop failed.");
        }
        if ((await InventoryAsync(token).ConfigureAwait(false)).Contains(id)) throw new IOException("Windows Sandbox teardown is unconfirmed.");
    }
    internal async Task<IReadOnlyList<Guid>> InventoryAsync(CancellationToken token)
    {
        var root = Parse(await _cli.RunAsync(["list"], TimeSpan.FromSeconds(10), token).ConfigureAwait(false));
        var values = root.GetProperty("WindowsSandboxEnvironments");
        if (values.ValueKind != JsonValueKind.Array || values.GetArrayLength() > 8) throw new InvalidDataException("Unknown Windows Sandbox CLI inventory.");
        var ids = new List<Guid>();
        foreach (var item in values.EnumerateArray())
        {
            if (!Guid.TryParse(item.GetProperty("Id").GetString(), out var id) || id == Guid.Empty || ids.Contains(id)) throw new InvalidDataException("Invalid sandbox identity.");
            ids.Add(id);
        }
        return ids.AsReadOnly();
    }
    public Task<IReadOnlyList<SandboxSessionInfo>> ListAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<SandboxSessionInfo>>(_id is { } id ? [new(id, "Windows Sandbox", _state, 0, _state == SandboxState.Failed ? "Cleanup required." : null)] : []);
    private async Task ExpireAsync(Guid id)
    {
        try { await Task.Delay(TimeSpan.FromHours(1), _lifetime.Token).ConfigureAwait(false); await StopAsync(id).ConfigureAwait(false); }
        catch (OperationCanceledException) { }
        catch { /* Durable intent blocks subsequent work until explicit recovery succeeds. */ }
    }
    private static JsonElement Parse(SandboxCliResult result)
    {
        if (result.ExitCode != 0 || result.Output.Length > 65_536) throw new IOException("Windows Sandbox CLI failed. Check the optional feature, restart and client update.");
        using var document = JsonDocument.Parse(result.Output, new JsonDocumentOptions { MaxDepth = 8 });
        UniqueFields(document.RootElement);
        return document.RootElement.Clone();
    }
    private static void UniqueFields(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var field in value.EnumerateObject()) { if (!seen.Add(field.Name)) throw new InvalidDataException("Duplicate reply field."); UniqueFields(field.Value); }
        }
        else if (value.ValueKind == JsonValueKind.Array) foreach (var item in value.EnumerateArray()) UniqueFields(item);
    }
    private static string GuestPath(string relative) => WorkspacePath.IsRelativeFile(relative) ?
        HyperVGuestScripts.Root + "\\" + relative.Replace('/', '\\') : throw new SandboxPolicyException("Only relative workspace paths are allowed.");
    private static string Decode(string encoded)
    {
        if (encoded.Length > 349_528) throw new InvalidDataException("Guest file is oversized.");
        var bytes = Convert.FromBase64String(encoded);
        if (bytes.Length > 262_144) throw new InvalidDataException();
        var text = new UTF8Encoding(false, true).GetString(bytes);
        return !text.Contains('\0') ? text : throw new InvalidDataException("Binary files cannot be exported as text.");
    }
    private static void WriteNew(PinnedLocalPath directory, string name, byte[] bytes)
    { using var file = directory.OpenFile(name, FileAccess.ReadWrite, createNew: true); file.Write(bytes); file.Flush(true); }
    public void Dispose()
    {
        if (_disposed) return; _disposed = true;
        _lifetime.Cancel();
        _starting?.Task.GetAwaiter().GetResult();
        if (_id is { } id) { try { StopAsync(id).GetAwaiter().GetResult(); } catch { } }
        _inputPin?.Dispose(); _outputPin?.Dispose(); _lease?.Dispose();
        _lifetime.Cancel();
    }
}
