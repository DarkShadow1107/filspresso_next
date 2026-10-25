using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Sandbox;

namespace Filspresso.Harness;

/// <summary>
/// The qualified desktop execution adapter: hosted inference via the native transport, with
/// file/command tools backed by a qualified VM workspace.
/// </summary>
/// <remarks>
/// Composition is fail-closed by construction: wherever this adapter cannot be built from
/// verified qualification evidence, imported-text inspection is used instead.
/// Starting the sandbox, sending model turns and executing tools are three different things.
/// Only an explicit user action starts the sandbox; the harness demands fresh one-shot
/// consent for every non-read tool call; the registry below is exactly what the model sees.
/// <para>
/// Every write performed through <c>write_file</c> is journaled into
/// <see cref="ProjectCheckpoints"/> against the imported project baseline, so reviewed
/// changes can be exported to the real project only after human review. Snapshot-capable
/// backends also capture command-generated text edits before completing a command call.
/// </para>
/// </remarks>
public class SandboxAgentServices : IAgentServices, IAgentConsentBinding, IDisposable
{
    public const int MaxWriteFileArgument = 16_000;
    public const int MaxCommandArgument = 1000;
    public const int MaxArgumentsArgument = 4000;
    public const int MaxListingArgument = 200;
    public const int MaxTimeoutSeconds = 120;

    private static readonly ToolArgumentSchema ListSchema = new(new Dictionary<string, ToolParameter>
    {
        ["directory"] = new(ToolParameterKind.WorkspacePath, Required: false, MaxLength: MaxListingArgument),
    });

    private static readonly ToolArgumentSchema ReadSchema = new(new Dictionary<string, ToolParameter>
    {
        ["path"] = new(ToolParameterKind.WorkspacePath, Required: true, MinLength: 1, MaxLength: 240),
    });

    private static readonly ToolArgumentSchema WriteSchema = new(new Dictionary<string, ToolParameter>
    {
        ["path"] = new(ToolParameterKind.WorkspacePath, Required: true, MinLength: 1, MaxLength: 240),
        ["contents"] = new(ToolParameterKind.String, Required: true, MinLength: 0, MaxLength: MaxWriteFileArgument),
    });

    private static readonly ToolArgumentSchema RunSchema = new(new Dictionary<string, ToolParameter>
    {
        ["command"] = new(ToolParameterKind.String, Required: true, MinLength: 1, MaxLength: MaxCommandArgument),
        ["arguments"] = new(ToolParameterKind.String, Required: false, MinLength: 0, MaxLength: MaxArgumentsArgument),
        ["directory"] = new(ToolParameterKind.WorkspacePath, Required: false, MaxLength: MaxListingArgument),
        ["timeoutSeconds"] = new(ToolParameterKind.Integer, Required: false, Minimum: 1, Maximum: MaxTimeoutSeconds),
    });

    private static readonly IReadOnlyCollection<ToolDefinition> _tools = Array.AsReadOnly(new[]
    {
        AgentQuestionProtocol.Tool,
        new ToolDefinition("list_files",
            "List files and directories inside the sandbox workspace, one level at a time. Read-only; " +
            "returns names and sizes, never contents. Omit directory to list the workspace root.",
            ListSchema, ToolEffect.ReadOnly),
        new ToolDefinition("read_file",
            "Read a UTF-8 text file from the sandbox workspace by workspace-relative path. Read-only. " +
            "Files are at most 256 KiB; oversized results are truncated before the model sees them.",
            ReadSchema, ToolEffect.ReadOnly),
        new ToolDefinition("write_file",
            "Create or replace one UTF-8 text file inside the sandbox workspace. Contents are limited to " +
            "16,000 characters per call. Every call requires separate, exact-action approval; each write " +
            "is journaled against the imported project baseline for later human review.",
            WriteSchema, ToolEffect.Mutation),
        new ToolDefinition("run_command",
            "Run one PowerShell command inside the disposable offline Windows VM, never on the host. " +
            "Only a staged project copy is available. Web search is a separate tool, not command internet access. " +
            "Every call requires separate, exact-action approval.",
            RunSchema, ToolEffect.Execution),
    });

    private readonly INativeAgentModelTransport _transport;
    private readonly IWorkspaceSandbox _sandbox;
    private readonly CodeLocation _location;
    private readonly IReadOnlyCollection<ToolDefinition> _registry;
    private readonly IAgentWebLookup? _web;
    private readonly ProjectCheckpoints _checkpoints;
    private readonly object _gate = new();
    private Guid? _workspaceId;
    private Task<(bool Ok, string Error)>? _startup;
    private bool _disposed;
    private AgentConsentQueue? _consent;
    private readonly Dictionary<string, ToolCall> _approved = new(StringComparer.Ordinal);
    private readonly HashSet<string> _consumed = new(StringComparer.Ordinal);
    private Guid? _cleanupPending;

    /// <summary>True only when composition verified current evidence for this backend.</summary>
    public bool ExecutionQualified { get; }

    /// <summary>Local, non-authoritative status text for the screen.</summary>
    public string ExecutionStatus { get; }
    public bool NeedsCleanup { get { lock (_gate) return _cleanupPending is not null; } }

    public SandboxAgentServices(INativeAgentModelTransport transport, IWorkspaceSandbox sandbox,
        CodeLocation location, ProjectCheckpoints checkpoints, bool executionQualified, string executionStatus,
        AgentConsentQueue? consent = null, IAgentWebLookup? web = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(sandbox);
        if (location is not (CodeLocation.WindowsSandbox or CodeLocation.HyperV or CodeLocation.NativeRestricted)) throw new ArgumentOutOfRangeException(nameof(location));
        ArgumentNullException.ThrowIfNull(checkpoints);
        if (string.IsNullOrWhiteSpace(executionStatus))
            throw new ArgumentException("The qualification status text must describe why execution is or is not enabled.", nameof(executionStatus));
        _transport = transport;
        _sandbox = sandbox;
        _location = location;
        _web = web;
        var localTools = location == CodeLocation.NativeRestricted ? _tools.Select(tool => tool.Name == "run_command"
            ? tool with { Description = "Run PowerShell only under native AppContainer, private desktop and job limits, NOT a VM. Shares the host Windows kernel. Uses a staged project copy, scrubbed environment, no command networking or inherited user PATH. Limited tool compatibility; no unrestricted retry. Requires fresh exact-action approval." } : tool).ToArray() : _tools.ToArray();
        _registry = Array.AsReadOnly(web is null ? localTools : localTools.Concat(AgentWebTools.Definitions).ToArray());
        _checkpoints = checkpoints;
        ExecutionQualified = executionQualified;
        ExecutionStatus = executionStatus;
        _consent = consent;
    }

    internal void AttachConsent(AgentConsentQueue consent)
    { lock (_gate) { if (_consent is not null && !ReferenceEquals(_consent, consent)) throw new InvalidOperationException("Consent is already bound."); _consent = consent; } }
    internal void RevokeApprovals() { lock (_gate) _approved.Clear(); }
    void IAgentConsentBinding.AttachConsent(AgentConsentQueue consent) => AttachConsent(consent);
    void IAgentConsentBinding.RevokeApprovals() => RevokeApprovals();

    public async Task<AgentApprovalDecision> ApproveAsync(AgentApproval approval, CancellationToken cancellationToken = default)
    {
        AgentConsentQueue? consent;
        lock (_gate)
        {
            if (_disposed || approval.Workspace.Location != _location || approval.Workspace.Id != _workspaceId ||
                _consumed.Count >= 4096 || _consumed.Contains(approval.Call.Id) || !_registry.Any(tool => tool.Name == approval.Call.Name && tool.Effect == approval.Effect &&
                    (tool.Effect is ToolEffect.Mutation or ToolEffect.Execution || tool.RequiresApproval) && tool.Parameters.TryValidate(approval.Call.ArgumentsJson, out _)))
                return new(approval.Id, false);
            consent = _consent;
        }
        if (consent is null) return new(approval.Id, false);
        var decision = await consent.RequestAsync(approval, cancellationToken).ConfigureAwait(false);
        lock (_gate)
        {
            if (_disposed || cancellationToken.IsCancellationRequested || _workspaceId != approval.Workspace.Id || !decision.Approved || decision.ApprovalId != approval.Id)
                return new(approval.Id, false);
            _approved[approval.Call.Id] = approval.Call;
            return decision;
        }
    }

    /// <summary>The workspace the model sees; null until an explicit start succeeds.</summary>
    public AgentWorkspace? Workspace
    {
        get { lock (_gate) return _disposed || _workspaceId is not { } active ? null : new AgentWorkspace(active, _location); }
    }

    public IReadOnlyCollection<ToolDefinition> Tools => _registry;

    public bool SupportsStructuredTools(string modelKey) => _transport.SupportsConversation && _transport.SupportsModel(modelKey);

    public Task<AgentModelReply> SendAsync(AgentModelRequest request, CancellationToken cancellationToken = default) =>
        _transport.SendAsync(request, cancellationToken);

    /// <summary>
    /// Starts the sandbox and seeds the imported project baseline into it. No tool executes
    /// here: seeding is provisioning visible on the screen, not a model action.
    /// </summary>
    public Task<(bool Ok, string Error)> EnsureWorkspaceAsync(CancellationToken cancellationToken = default, Action<string>? report = null)
    {
        lock (_gate)
        {
            if (_disposed) return Task.FromResult((false, "Execution services were discarded."));
            if (!ExecutionQualified) return Task.FromResult((false, "Execution was not qualified."));
            if (_cleanupPending is not null) return Task.FromResult((false, "Previous sandbox cleanup is unconfirmed. Retry discard before starting another."));
            if (_workspaceId is not null) return Task.FromResult((true, string.Empty));
            if (_startup is { IsCompleted: false }) return Task.FromResult((false, "A sandbox start is already in progress."));
            var run = RunStartupAsync(cancellationToken, report);
            _startup = run;
            return run;
        }
    }

    private async Task<(bool Ok, string Error)> RunStartupAsync(CancellationToken cancellationToken, Action<string>? report)
    {
        Guid? started = null;
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            report?.Invoke(_location == CodeLocation.NativeRestricted ? "Starting native restricted workspace (shared Windows kernel, NOT a VM). The original repository is not writable by commands."
                : "Starting a disposable offline Windows VM. No original project folder is shared.");
            var boot = await _sandbox.StartAsync("agent conversation", cancellationToken).ConfigureAwait(false);
            started = boot.Id;
            var baseline = _checkpoints.Current;
            var index = 0;
            foreach (var file in baseline)
            {
                lock (_gate)
                {
                    if (_disposed) throw new ObjectDisposedException(typeof(SandboxAgentServices).FullName);
                }
                index++;
                cancellationToken.ThrowIfCancellationRequested();
                var contents = Encoding.UTF8.GetBytes(file.Value);
                if (contents.Length > HyperVSandbox.MaxSandboxFileBytes)
                    throw new SandboxPolicyException($"\"{file.Key}\" exceeds the per-file sandbox limit and cannot be seeded.");
                if (index % 8 == 1) report?.Invoke($"Seeding the sandbox workspace ({index}/{baseline.Count}).");
                await _sandbox.WriteFileAsync(boot.Id, file.Key, contents, cancellationToken).ConfigureAwait(false);
            }
            lock (_gate)
            {
                if (_disposed) throw new ObjectDisposedException(typeof(SandboxAgentServices).FullName);
                _workspaceId = boot.Id;
            }
            report?.Invoke("Sandbox ready. Tools run only with your separate approval for each action.");
            return (true, string.Empty);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            if (started is { } leaked)
            {
                lock (_gate) { _cleanupPending = leaked; _workspaceId = null; }
                await AbortAsync(new(leaked, _location)).ConfigureAwait(false);
            }
            throw;
        }
        catch (Exception error)
        {
            if (started is null)
            {
                // Startup can fail before returning its id while retaining a failed library
                // session. Keep it recoverable rather than creating another VM blindly.
                var retained = await _sandbox.ListAsync().ConfigureAwait(false);
                lock (_gate) _cleanupPending = retained.FirstOrDefault()?.Id;
            }
            if (started is { } partial)
            {
                lock (_gate) { _cleanupPending = partial; _workspaceId = null; }
                await AbortAsync(new(partial, _location)).ConfigureAwait(false);
            }
            return (false, error is SandboxPolicyException
                ? $"The sandbox refused to start: {error.Message}"
                : "The Windows VM could not start or the imported project could not be seeded. " + error.Message);
        }
    }

    public async Task<ToolResult> InvokeAsync(AgentWorkspace workspace, ToolCall call, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(workspace);
        ArgumentNullException.ThrowIfNull(call);
        cancellationToken.ThrowIfCancellationRequested();
        Guid current;
        lock (_gate)
        {
            if (_disposed || workspace.Location != _location || _workspaceId is not { } active || workspace.Id != active)
                throw new SandboxPolicyException("This tool call is not authorized for the active sandbox.");
            var tool = _registry.FirstOrDefault(tool => tool.Name == call.Name);
            if (tool is null || tool.Effect == ToolEffect.Interaction || !tool.Parameters.TryValidate(call.ArgumentsJson, out _))
                throw new SandboxPolicyException("Unregistered or invalid tool arguments.");
            if ((tool.Effect != ToolEffect.ReadOnly || tool.RequiresApproval) &&
                (!_approved.Remove(call.Id, out var approved) || approved != call || !_consumed.Add(call.Id)))
                throw new SandboxPolicyException("Fresh exact-action consent is required by the executor.");
            current = active;
        }
        switch (call.Name)
        {
            case "list_files":
            {
                var directory = Text(call.ArgumentsJson, "directory", allowMissing: true);
                var listing = await _sandbox.ListFilesAsync(current, directory, cancellationToken).ConfigureAwait(false);
                var text = string.Join('\n', listing.Entries.Select(entry => $"{(entry.IsDirectory ? "dir " : "file")} {entry.Name}"));
                if (listing.Truncated) text += "\n[Directory listing truncated.]";
                return Plain(text);
            }
            case "read_file":
            {
                var path = Required(call.ArgumentsJson, "path");
                var contents = await _sandbox.ReadFileAsync(current, path, cancellationToken).ConfigureAwait(false);
                return Plain(contents);
            }
            case "write_file":
            {
                var path = Required(call.ArgumentsJson, "path");
                var contents = Text(call.ArgumentsJson, "contents", allowMissing: false);
                var bytes = Encoding.UTF8.GetBytes(contents ?? string.Empty);
                await _sandbox.WriteFileAsync(current, path, bytes, cancellationToken).ConfigureAwait(false);
                _checkpoints.RecordWrite(path, contents ?? string.Empty);
                return Plain($"Wrote \"{path}\" ({bytes.Length:N0} bytes); journaled for human review against the imported baseline.");
            }
            case "run_command":
            {
                var command = Required(call.ArgumentsJson, "command");
                var arguments = Text(call.ArgumentsJson, "arguments", allowMissing: true) ?? string.Empty;
                var directory = Text(call.ArgumentsJson, "directory", allowMissing: true);
                var seconds = OptionalInt(call.ArgumentsJson, "timeoutSeconds", allowMissing: true);
                var timeout = seconds is { } bounded ? TimeSpan.FromSeconds(bounded) : (TimeSpan?)null;
                var result = await _sandbox.RunAsync(current, command, arguments, directory, timeout, cancellationToken).ConfigureAwait(false);
                if (!result.TimedOut && _sandbox is ISandboxSnapshot snapshot)
                {
                    try
                    {
                        var files = await snapshot.CaptureAsync(current, _checkpoints.Current.Keys.ToArray(), cancellationToken).ConfigureAwait(false);
                        _checkpoints.RecordSnapshot(files.Select(file => new ProjectFileSnapshot(file.Path, file.Contents)).ToArray());
                    }
                    catch
                    {
                        await AbortAsync(workspace, CancellationToken.None).ConfigureAwait(false);
                        throw;
                    }
                }
                return result;
            }
            case "web_search":
            case "web_fetch":
                return _web is not null ? await _web.InvokeAsync(call.Name, call.ArgumentsJson, cancellationToken).ConfigureAwait(false)
                    : throw new SandboxPolicyException("Web lookup is not configured.");
            default:
                throw new SandboxPolicyException("No such sandbox tool.");
        }
    }

    /// <summary>Destroys the sandbox bound to this workspace id; the loop quarantines afterwards.</summary>
    public async Task<bool> AbortAsync(AgentWorkspace workspace, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(workspace);
        Guid id;
        lock (_gate)
        {
            if (workspace.Location != _location || (workspace.Id != _workspaceId && workspace.Id != _cleanupPending)) return false;
            id = workspace.Id; _cleanupPending = id; _workspaceId = null; _approved.Clear();
        }
        try
        {
            await _sandbox.StopAsync(id, cancellationToken).ConfigureAwait(false);
            lock (_gate) if (_cleanupPending == id) _cleanupPending = null;
            return true;
        }
        catch { return false; }
    }

    /// <summary>Explicit user discard from the screen; separate from consent denial.</summary>
    public Task<bool> DiscardWorkspaceAsync(CancellationToken cancellationToken = default)
    {
        AgentWorkspace? workspace;
        lock (_gate) workspace = (_workspaceId ?? _cleanupPending) is { } id ? new(id, _location) : null;
        return workspace is null ? Task.FromResult(false) : AbortAsync(workspace, cancellationToken);
    }

    private static ToolResult Plain(string text) => new(0, text, string.Empty, TimeSpan.Zero, false);

    private static JsonElement Parse(string argumentsJson)
    {
        using var document = JsonDocument.Parse(argumentsJson, new JsonDocumentOptions { MaxDepth = 4 });
        if (document.RootElement.ValueKind != JsonValueKind.Object) throw new SandboxPolicyException("Tool arguments are not a bounded object.");
        return document.RootElement.Clone();
    }

    private static string? Text(string argumentsJson, string name, bool allowMissing = false)
    {
        var root = Parse(argumentsJson);
        if (!root.TryGetProperty(name, out var value))
        {
            if (allowMissing) return null;
            throw new SandboxPolicyException($"Tool arguments are missing \"{name}\".");
        }
        if (value.ValueKind != JsonValueKind.String) throw new SandboxPolicyException($"Tool argument \"{name}\" is not a string.");
        return value.GetString();
    }

    private static string Required(string argumentsJson, string name)
    {
        var text = Text(argumentsJson, name, allowMissing: false);
        if (string.IsNullOrWhiteSpace(text)) throw new SandboxPolicyException($"Tool argument \"{name}\" is empty.");
        return text!;
    }

    private static int? OptionalInt(string argumentsJson, string name, bool allowMissing = false)
    {
        var root = Parse(argumentsJson);
        if (!root.TryGetProperty(name, out var value))
        {
            if (allowMissing) return null;
            throw new SandboxPolicyException($"Tool arguments are missing \"{name}\".");
        }
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var integer))
            throw new SandboxPolicyException($"Tool argument \"{name}\" is not an integer.");
        return integer;
    }

    /// <summary>
    /// Bounded, non-blocking disposal: any in-flight startup finishes (it either registers or
    /// stops its own session), then a sandbox started before disposal is discarded in the
    /// background. The workspace id is captured before disposal is latched; once disposed the
    /// workspace getter intentionally reads null, which would otherwise leak the VM.
    /// </summary>
    public void Dispose()
    {
        Task<(bool Ok, string Error)>? startup;
        Guid? live;
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            startup = _startup;
            live = _workspaceId ?? _cleanupPending;
            _workspaceId = null;
            _approved.Clear();
        }
        _ = Task.Run(async () =>
        {
            if (startup is not null) { try { await startup.ConfigureAwait(false); } catch { } }
            if (live is { } id)
            {
                try { await _sandbox.StopAsync(id).ConfigureAwait(false); } catch { }
            }
            _sandbox.Dispose();
        });
    }
}
