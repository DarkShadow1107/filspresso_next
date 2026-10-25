using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Sandbox;

namespace Filspresso.Harness;

/// <summary>Reads only an explicitly imported in-memory text baseline, not arbitrary host
/// paths. Available without a VM. External lookup has separate one-shot consent.</summary>
public sealed class InspectionAgentServices : IAgentServices, IAgentConsentBinding, IDisposable
{
    private readonly INativeAgentModelTransport _transport;
    private readonly ProjectCheckpoints _project;
    private readonly IAgentWebLookup _web;
    private readonly object _gate = new();
    private readonly Dictionary<string, ToolCall> _approved = new(StringComparer.Ordinal);
    private readonly HashSet<string> _used = new(StringComparer.Ordinal);
    private readonly AgentWorkspace _workspace = new(Guid.NewGuid(), CodeLocation.Inspection);
    private AgentConsentQueue? _consent;
    private bool _disposed;
    public InspectionAgentServices(INativeAgentModelTransport transport, ProjectCheckpoints project, IAgentWebLookup web)
    {
        _transport = transport; _project = project; _web = web;
        Tools = Array.AsReadOnly(new[] { AgentQuestionProtocol.Tool,
            new ToolDefinition("list_files", "List imported text baseline paths only. This is not the live host or a running VM.", new(new Dictionary<string, ToolParameter>()), ToolEffect.ReadOnly),
            new ToolDefinition("read_file", "Read an explicitly imported UTF-8 baseline file by relative path. No arbitrary host access.",
                new(new Dictionary<string, ToolParameter> { ["path"] = new(ToolParameterKind.WorkspacePath, MinLength: 1, MaxLength: 240) }), ToolEffect.ReadOnly)
        }.Concat(AgentWebTools.Definitions).ToArray());
    }
    public IReadOnlyCollection<ToolDefinition> Tools { get; }
    public AgentWorkspace? Workspace => _disposed ? null : _workspace;
    public bool SupportsStructuredTools(string modelKey) => _transport.SupportsConversation && _transport.SupportsModel(modelKey);
    public Task<AgentModelReply> SendAsync(AgentModelRequest request, CancellationToken cancellationToken = default) => _transport.SendAsync(request, cancellationToken);
    void IAgentConsentBinding.AttachConsent(AgentConsentQueue consent) { lock (_gate) _consent = consent; }
    void IAgentConsentBinding.RevokeApprovals() { lock (_gate) _approved.Clear(); }
    public async Task<AgentApprovalDecision> ApproveAsync(AgentApproval approval, CancellationToken cancellationToken = default)
    {
        AgentConsentQueue? queue;
        lock (_gate)
        {
            if (_disposed || approval.Workspace != _workspace || _used.Count >= 4096 || _used.Contains(approval.Call.Id) ||
                !Tools.Any(tool => tool.RequiresApproval && tool.Name == approval.Call.Name && tool.Effect == approval.Effect && tool.Parameters.TryValidate(approval.Call.ArgumentsJson, out _))) return new(approval.Id, false);
            queue = _consent;
        }
        if (queue is null) return new(approval.Id, false);
        var result = await queue.RequestAsync(approval, cancellationToken).ConfigureAwait(false);
        lock (_gate)
        {
            if (_disposed || cancellationToken.IsCancellationRequested || !result.Approved || result.ApprovalId != approval.Id) return new(approval.Id, false);
            _approved[approval.Call.Id] = approval.Call; return result;
        }
    }
    public async Task<ToolResult> InvokeAsync(AgentWorkspace workspace, ToolCall call, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            if (_disposed || workspace != _workspace) throw new SandboxPolicyException("This baseline was invalidated.");
            var tool = Tools.FirstOrDefault(tool => tool.Name == call.Name);
            if (tool is null || tool.Effect != ToolEffect.ReadOnly || !tool.Parameters.TryValidate(call.ArgumentsJson, out _)) throw new SandboxPolicyException("Inspection cannot write files or run commands.");
            if (tool.RequiresApproval && (!_approved.Remove(call.Id, out var approved) || approved != call || !_used.Add(call.Id))) throw new SandboxPolicyException("Fresh exact lookup consent is required.");
        }
        if (call.Name is "web_search" or "web_fetch") return await _web.InvokeAsync(call.Name, call.ArgumentsJson, cancellationToken).ConfigureAwait(false);
        var files = _project.Current;
        if (call.Name == "list_files") return new(0, string.Join('\n', files.Keys.Order(StringComparer.Ordinal)), "", TimeSpan.Zero, false);
        using var document = JsonDocument.Parse(call.ArgumentsJson);
        var path = document.RootElement.GetProperty("path").GetString()!;
        return files.TryGetValue(path, out var text) ? new(0, text, "", TimeSpan.Zero, false) : new(1, "", "This path was not imported.", TimeSpan.Zero, false);
    }
    public Task<bool> AbortAsync(AgentWorkspace workspace, CancellationToken cancellationToken = default)
    { Dispose(); return Task.FromResult(true); }
    public void Dispose() { lock (_gate) { _disposed = true; _approved.Clear(); } }
}
