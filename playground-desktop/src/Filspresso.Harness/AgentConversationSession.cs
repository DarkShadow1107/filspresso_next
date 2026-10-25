using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Sandbox;

namespace Filspresso.Harness;

public sealed record AgentConversationSnapshot(bool Busy, bool Stopping, bool RequiresReset, int CompletedTurns,
    IReadOnlyList<AgentEvent> Events, QuestionChallenge? Question, AgentApproval? Approval, string? QueuedMessage, string Error, bool DisplayTruncated);

/// <summary>
/// Client-local conversation. Interaction and execution consent have independent queues.
/// Stop retains the single-flight lock until cleanup finishes; account invalidation suppresses
/// late output immediately. No POST retry, transcript persistence, or approval restoration.
/// </summary>
public sealed class AgentConversationSession : IDisposable
{
    private readonly object _gate = new();
    private readonly IAgentServices _services;
    private readonly AgentQuestionQueue _questions = new();
    private readonly AgentConsentQueue _consent = new();
    private readonly List<AgentConversationTurn> _conversation = new();
    private readonly List<AgentEvent> _events = new();
    private CancellationTokenSource? _active;
    private Turn? _queued;
    private string? _key;
    private string _error = string.Empty;
    private bool _stopping, _requiresReset, _disposed, _truncated;
    private int _revision;
    public event EventHandler? Changed;
    public AgentConversationSession(IAgentServices services)
    {
        _services = services;
        _questions.Changed += OnInteractionChanged; _consent.Changed += OnInteractionChanged;
    }
    private void OnInteractionChanged(object? sender, EventArgs args) => Notify();
    private void Notify() { if (!_disposed) Changed?.Invoke(this, EventArgs.Empty); }
    public AgentConversationSnapshot Snapshot
    {
        get { lock (_gate) return new(_active is not null, _stopping, _requiresReset, _conversation.Count,
            Array.AsReadOnly(_events.ToArray()), _questions.Pending, _consent.Pending, _queued?.UserMessage, _error, _truncated); }
    }
    private static string Key(Turn turn) => $"{turn.ModelKey}\n{turn.Mode}\n{turn.SystemPrompt}";
    private void Append(AgentEvent value) { _events.Add(value); if (_events.Count > 256) { _events.RemoveAt(0); _truncated = true; } }
    public bool Answer(QuestionDecision value) => _questions.Answer(value);
    public bool Decide(Guid id, bool approved) => _consent.Decide(id, approved);
    public bool QueueFollowUp(Turn turn)
    {
        lock (_gate)
        {
            if (_disposed || _active is null || _stopping || _queued is not null || Key(turn) != _key || string.IsNullOrWhiteSpace(turn.UserMessage) || turn.UserMessage.Length > 8000) return false;
            _queued = turn with { Conversation = Array.Empty<AgentConversationTurn>() };
        }
        Notify(); return true;
    }
    public void CancelQueued() { lock (_gate) _queued = null; Notify(); }
    public async Task SendAsync(Turn turn)
    {
        CancellationTokenSource active; int revision;
        lock (_gate)
        {
            if (_disposed || _active is not null) return;
            if (_requiresReset || (_key is not null && Key(turn) != _key) || _conversation.Count >= 16)
            { _error = "Start a new conversation before changing mode/model or continuing a stopped/limited context."; active = null!; revision = 0; }
            else
            {
                _active = active = new(); revision = ++_revision; _key = Key(turn); _error = string.Empty; _stopping = false;
                turn = turn with { Conversation = Array.AsReadOnly(_conversation.ToArray()) };
                Append(new AgentEvent.UserMessage(turn.UserMessage));
            }
        }
        Notify(); if (active is null) return;
        var completed = false; Turn? queued = null;
        try
        {
            await foreach (var item in new AgentLoop(new Services(this)).RunAsync(turn, active.Token).ConfigureAwait(false))
            {
                lock (_gate)
                {
                    if (_disposed || revision != _revision || active.IsCancellationRequested) break;
                    Append(item);
                    if (item is AgentEvent.Finished { ConversationTurn: { } previous }) { _conversation.Add(previous); completed = true; }
                    if (item is AgentEvent.Stopped stopped) _error = stopped.Message;
                }
                Notify();
            }
        }
        catch (OperationCanceledException) { lock (_gate) if (revision == _revision) _error = "Stopped. No automatic retry was attempted; model work may still be billed."; }
        catch (Exception) { lock (_gate) if (revision == _revision) _error = "Agent conversation failed. No automatic retry was attempted."; }
        finally
        {
            _questions.Dismiss(); _consent.Clear();
            lock (_gate)
            {
                if (ReferenceEquals(_active, active))
                {
                    _active = null; _stopping = false;
                    if (revision == _revision)
                    {
                        _requiresReset = !completed;
                        if (completed && !active.IsCancellationRequested) queued = _queued;
                    }
                    _queued = null;
                }
            }
            active.Dispose(); if (queued is null) Notify();
        }
        // This is a distinct user-queued request, not a retry. Failure/stop never sends it.
        if (queued is not null) await SendAsync(queued).ConfigureAwait(false);
    }
    public void Stop(bool clearPrivateState = false)
    {
        lock (_gate)
        {
            _queued = null; _stopping = _active is not null; _active?.Cancel();
            if (clearPrivateState) { _revision++; _conversation.Clear(); _events.Clear(); _key = null; _error = string.Empty; _requiresReset = false; _truncated = false; }
        }
        _questions.Dismiss(); _consent.Clear(); Notify();
    }
    public bool NewConversation()
    {
        // A started sandbox is independent of conversation history; resetting the turn
        // history never discards it. Use DiscardWorkspaceAsync for that.
        lock (_gate) { if (_active is not null) return false; }
        Stop(true); return true;
    }
    public void Dispose()
    {
        Stop(true); _disposed = true;
        _questions.Changed -= OnInteractionChanged; _consent.Changed -= OnInteractionChanged;
        _questions.Dispose(); _consent.Dispose();
    }
    private sealed class Services(AgentConversationSession owner) : IAgentServices
    {
        public IReadOnlyCollection<ToolDefinition> Tools => owner._services.Tools;
        public bool SupportsStructuredTools(string model) => owner._services.SupportsStructuredTools(model);
        public AgentWorkspace? Workspace => owner._services.Workspace;
        public Task<AgentModelReply> SendAsync(AgentModelRequest request, CancellationToken cancellationToken = default) => owner._services.SendAsync(request, cancellationToken);
        public Task<QuestionDecision> AskAsync(QuestionChallenge question, CancellationToken cancellationToken = default) => owner._questions.RequestAsync(question, cancellationToken);
        public Task<AgentApprovalDecision> ApproveAsync(AgentApproval approval, CancellationToken cancellationToken = default) => owner._consent.RequestAsync(approval, cancellationToken);
        public Task<ToolResult> InvokeAsync(AgentWorkspace workspace, ToolCall call, CancellationToken cancellationToken = default) => owner._services.InvokeAsync(workspace, call, cancellationToken);
        public Task<bool> AbortAsync(AgentWorkspace workspace, CancellationToken cancellationToken = default) => owner._services.AbortAsync(workspace, cancellationToken);
    }
}

/// <summary>
/// Real native transport with clarification only. Until Hyper-V is qualified/composed,
/// desktop never advertises file/command tools or pretends to execute Build requests.
/// </summary>
public sealed class QuestionOnlyAgentServices(INativeAgentModelTransport transport) : IAgentServices
{
    public IReadOnlyCollection<ToolDefinition> Tools { get; } = Array.AsReadOnly(new[] { AgentQuestionProtocol.Tool });
    public bool SupportsStructuredTools(string modelKey) => transport.SupportsConversation && transport.SupportsModel(modelKey);
    public Task<AgentModelReply> SendAsync(AgentModelRequest request, CancellationToken cancellationToken = default) => transport.SendAsync(request, cancellationToken);
    public Task<ToolResult> InvokeAsync(AgentWorkspace workspace, ToolCall call, CancellationToken cancellationToken = default) => throw new SandboxPolicyException("Desktop execution is unavailable. No host-shell or hosted-Docker fallback exists.");
    public Task<bool> AbortAsync(AgentWorkspace workspace, CancellationToken cancellationToken = default) => Task.FromResult(false);
}
