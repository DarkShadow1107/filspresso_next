using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Core.Streaming;
using Filspresso.Sandbox;

namespace Filspresso.Harness;

/// <summary>
/// Bounded orchestration, independent of transport and hypervisor. No production adapter is
/// enabled yet. Only complete native tool requests enter this loop; answer text is never parsed.
/// Execution failures/timeouts quarantine the workspace, with independently bounded teardown.
/// </summary>
public sealed class AgentLoop : IAgentLoop
{
    private readonly IAgentServices _services;
    private readonly AgentLimits _limits;
    private readonly IReadOnlyList<ToolDefinition> _tools;
    private readonly Dictionary<string, ToolDefinition> _registry;
    private readonly HashSet<Guid> _quarantined = new();
    private int _running;

    public AgentLoop(IAgentServices services, AgentLimits? limits = null)
    {
        ArgumentNullException.ThrowIfNull(services);
        _services = services;
        _limits = limits ?? new AgentLimits();
        ValidateLimits(_limits);
        var tools = services.Tools.ToArray();
        if (tools.Length > 32 || tools.Any(tool => tool is null || !ToolArgumentSchema.IsIdentifier(tool.Name) ||
            tool.Parameters is null || string.IsNullOrWhiteSpace(tool.Description) || tool.Description.Length > 2048 || !Enum.IsDefined(tool.Effect)) ||
            tools.Any(tool => (tool.Name == "question") != (tool.Effect == ToolEffect.Interaction) || (tool.Name == "question") != tool.Parameters.IsQuestion) ||
            tools.Select(tool => tool.Name).Distinct(StringComparer.Ordinal).Count() != tools.Length)
            throw new ArgumentException("The tool registry must contain unique, bounded, schema-defined tools.", nameof(services));
        _tools = Array.AsReadOnly(tools);
        _registry = tools.ToDictionary(tool => tool.Name, StringComparer.Ordinal);
    }

    public async IAsyncEnumerable<AgentEvent> RunAsync(Turn turn, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(turn);
        cancellationToken.ThrowIfCancellationRequested();
        if (Interlocked.CompareExchange(ref _running, 1, 0) != 0) throw new InvalidOperationException("An agent run is already active.");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(_limits.RunTimeout);
        AgentWorkspace? activeWorkspace = null;
        try
        {
            if (string.IsNullOrWhiteSpace(turn.UserMessage) || string.IsNullOrWhiteSpace(turn.ModelKey) || turn.ModelKey.Length > 128 ||
                !Enum.IsDefined(turn.Mode) || !double.IsFinite(turn.Temperature) || turn.Temperature is < 0 or > 2 || turn.MaxTokens is < 1 or > 131_072)
            { yield return Stop("Invalid agent turn or generation settings."); yield break; }

            var workspace = turn.Mode == AgentMode.Chat ? null : _services.Workspace;
            var interactionOnly = _tools.Count > 0 && _tools.All(tool => tool.Effect == ToolEffect.Interaction);
            if (turn.Mode != AgentMode.Chat && (!_services.SupportsStructuredTools(turn.ModelKey) || (!interactionOnly && workspace is null) ||
                (workspace is not null && (workspace.Id == Guid.Empty || !Enum.IsDefined(workspace.Location)))))
            { yield return Stop("Agent mode requires a verified structured-tool model and a sandbox. Plain chat remains available."); yield break; }
            if (workspace is not null && _quarantined.Contains(workspace.Id))
            { yield return Stop("This workspace was quarantined after interrupted execution. Start a new sandbox before retrying."); yield break; }

            // Plan advertises only reads, but the registry is also checked on every response:
            // a model cannot gain permission by inventing or requesting an unadvertised tool.
            var offered = Array.AsReadOnly(_tools.Where(tool => turn.Mode == AgentMode.Build ||
                (turn.Mode == AgentMode.Plan && tool.Effect is ToolEffect.ReadOnly or ToolEffect.Interaction)).ToArray());
            var history = new List<AgentExchange>();
            var historyCharacters = (long)turn.UserMessage.Length + (turn.SystemPrompt?.Length ?? 0) +
                offered.Sum(tool => (long)tool.Name.Length + tool.Description.Length + tool.Parameters.ToJsonSchema().GetRawText().Length) +
                System.Text.Json.JsonSerializer.Serialize(turn.Conversation).Length;
            var usedIds = new HashSet<string>(turn.Conversation.SelectMany(previous => previous.History.SelectMany(group => group.Invocations.Select(item => item.Call.Id))), StringComparer.Ordinal);
            var usage = new TokenUsage();
            var callsUsed = 0;
            for (var round = 0; round < _limits.MaxTurns; round++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (historyCharacters > _limits.MaxHistoryCharacters)
                { yield return Stop("Agent context character limit reached. No instructions or tool pairs were silently dropped."); yield break; }
                var remaining = _limits.MaxGeneratedTokens - usage.OutputTokens;
                if (remaining <= 0) { yield return Stop("Agent generated-token limit reached."); yield break; }
                var request = new AgentModelRequest(turn with { MaxTokens = Math.Min(turn.MaxTokens, remaining) }, offered, Array.AsReadOnly(history.ToArray()));
                var response = await AttemptAsync(token => _services.SendAsync(request, token), deadline.Token).ConfigureAwait(false);
                cancellationToken.ThrowIfCancellationRequested();
                if (response.Value is AgentModelReply.Refused refused)
                {
                    yield return new AgentEvent.Stopped(refused.Error == ApiError.None ? ApiError.Unexpected : refused.Error,
                        Clip(refused.Message ?? "The model request was refused.", 2048));
                    yield break;
                }
                if (response.Value is not AgentModelReply.Completed completed || response.Failure is not null)
                { yield return Stop(response.Failure ?? "The model response was incomplete. No tool was executed."); yield break; }
                if (deadline.IsCancellationRequested)
                { yield return Stop("Agent run time limit reached. No further tool was executed."); yield break; }
                if (completed.Version != 1 || completed.Text is null || completed.Text.Length > _limits.MaxTurnCharacters || completed.ToolCalls is null ||
                    completed.Usage is not { } counts || counts.IsEmpty || counts.InputTokens < 0 || counts.OutputTokens < 0 ||
                    counts.OutputTokens > request.Turn.MaxTokens || (long)usage.InputTokens + counts.InputTokens > int.MaxValue)
                { yield return Stop("Invalid, unmetered or oversized model response. No tool was executed."); yield break; }
                usage = new TokenUsage(usage.InputTokens + counts.InputTokens, usage.OutputTokens + counts.OutputTokens);
                if (completed.Reason == AgentFinishReason.Length || !Enum.IsDefined(completed.Reason) ||
                    (completed.ToolCalls.Count == 0) != (completed.Reason == AgentFinishReason.Answer))
                { yield return Stop("The model did not finish a complete answer/tool-call group. No tool was executed."); yield break; }

                // Snapshot the entire batch before yielding events or calling any external code.
                var calls = completed.ToolCalls.Take(_limits.MaxToolCallsPerTurn + 1).ToArray();
                if (calls.Any(call => call?.Name == "question") && calls.Length != 1)
                { yield return Stop("Clarification must finish before the model can propose subsequent actions. No tool was executed."); yield break; }
                if (calls.Length == 0)
                {
                    if (completed.Text.Length > 0) yield return new AgentEvent.Say(completed.Text);
                    cancellationToken.ThrowIfCancellationRequested();
                    yield return new AgentEvent.Finished(usage) { ConversationTurn = new(turn.UserMessage, completed.Text, Array.AsReadOnly(history.ToArray())) };
                    yield break;
                }
                if (turn.Mode == AgentMode.Chat)
                { yield return Stop("Tools are disabled in Chat mode. No tool was executed."); yield break; }
                if (calls.Length > _limits.MaxToolCallsPerTurn || calls.Length > _limits.MaxToolCalls - callsUsed ||
                    round + 1 >= _limits.MaxTurns || usage.OutputTokens >= _limits.MaxGeneratedTokens)
                { yield return Stop("Agent turn, tool-call or generated-token limit reached before tool execution."); yield break; }
                var batchIds = new HashSet<string>(usedIds, StringComparer.Ordinal);
                string? invalid = null;
                foreach (var call in calls)
                {
                    if (call is null || !IsCallId(call.Id) || !batchIds.Add(call.Id) || !ToolArgumentSchema.IsIdentifier(call.Name) || !_registry.TryGetValue(call.Name, out var tool))
                    { invalid = "Unknown tool or invalid/repeated tool-call ID. No tool in this batch was executed."; break; }
                    if (!tool.Parameters.TryValidate(call.ArgumentsJson, out var error))
                    { invalid = error + " No tool in this batch was executed."; break; }
                }
                if (invalid is not null) { yield return Stop(invalid); yield break; }
                var assistantCharacters = completed.Text.Length + calls.Sum(call => (long)call.Id.Length + call.Name.Length + call.ArgumentsJson.Length);
                // Reserve space for the complete group before doing work. Never leave an
                // orphaned tool result or silently truncate original instructions to fit it.
                if (historyCharacters + assistantCharacters + (long)calls.Length * _limits.MaxToolResultCharacters > _limits.MaxHistoryCharacters)
                { yield return Stop("Agent context character limit would be exceeded by this tool group. No tool was executed."); yield break; }
                usedIds = batchIds;
                if (completed.Text.Length > 0) yield return new AgentEvent.Say(completed.Text);
                var invocations = new List<ToolInvocation>();
                foreach (var call in calls)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (deadline.IsCancellationRequested) { yield return Stop("Agent run time limit reached."); yield break; }
                    callsUsed++;
                    var tool = _registry[call.Name];
                    if (tool.Effect == ToolEffect.Interaction)
                    {
                        var question = new QuestionChallenge(1, Guid.NewGuid(), call.Id, AgentQuestionProtocol.Parse(call.ArgumentsJson));
                        yield return new AgentEvent.QuestionRequired(question);
                        using var questionDeadline = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token);
                        questionDeadline.CancelAfter(_limits.ToolTimeout);
                        var answer = await AttemptAsync(token => _services.AskAsync(question, token), questionDeadline.Token).ConfigureAwait(false);
                        cancellationToken.ThrowIfCancellationRequested();
                        if (answer.Failure is not null || answer.Value is null || questionDeadline.IsCancellationRequested)
                        { yield return Stop("Question unavailable or timed out. No further action was executed."); yield break; }
                        QuestionDecision? decision = null;
                        try { decision = AgentQuestionProtocol.Validate(question, answer.Value); } catch (ArgumentException) { }
                        if (decision is null || decision.Cancelled)
                        { yield return Stop("Question dismissed or its answer was invalid/stale. No further action was executed."); yield break; }
                        var content = AgentQuestionProtocol.ResultJson(decision);
                        if (content.Length > _limits.MaxToolResultCharacters)
                        { yield return Stop("Question answers exceed the result limit. No answers were silently clipped."); yield break; }
                        invocations.Add(new ToolInvocation(call, new ToolResult(0, string.Empty, string.Empty, TimeSpan.Zero, false)) { InteractionContent = content });
                        yield return new AgentEvent.QuestionAnswered(call.Id, decision);
                        continue;
                    }
                    yield return new AgentEvent.ToolStarting(call);
                    using var callDeadline = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token);
                    callDeadline.CancelAfter(_limits.ToolTimeout);
                    ToolInvocation? invocation = null;
                    if (turn.Mode == AgentMode.Plan && tool.Effect != ToolEffect.ReadOnly)
                        invocation = Refusal(call, "Plan mode is read-only. No mutation or command was executed.");
                    else if (tool.Effect != ToolEffect.ReadOnly)
                    {
                        var approval = new AgentApproval(Guid.NewGuid(), workspace!, call, tool.Effect);
                        yield return new AgentEvent.ApprovalRequired(approval);
                        var decision = await AttemptAsync(token => _services.ApproveAsync(approval, token), callDeadline.Token).ConfigureAwait(false);
                        cancellationToken.ThrowIfCancellationRequested();
                        if (decision.Failure is not null)
                        { yield return Stop("Approval was unavailable or timed out. No action was executed."); yield break; }
                        if (decision.Value is not { Approved: true } consent || consent.ApprovalId != approval.Id)
                            invocation = Refusal(call, "Approval denied or not bound to this exact request. No action was executed.");
                    }
                    if (invocation is null)
                    {
                        // A timeout or exception after dispatch is an unknown workload state,
                        // never an ordinary error result that the model may retry blindly.
                        activeWorkspace = workspace;
                        var clock = Stopwatch.StartNew();
                        var execution = await AttemptAsync(token => _services.InvokeAsync(workspace!, call, token), callDeadline.Token).ConfigureAwait(false);
                        cancellationToken.ThrowIfCancellationRequested();
                        if (execution.PolicyRefused)
                        { activeWorkspace = null; invocation = Refusal(call, "The sandbox refused this call before execution."); }
                        else if (execution.Failure is not null || execution.Value is null || execution.Value.TimedOut || callDeadline.IsCancellationRequested)
                        {
                            var stopped = await QuarantineAsync(workspace!).ConfigureAwait(false);
                            activeWorkspace = null;
                            cancellationToken.ThrowIfCancellationRequested();
                            yield return Stop("Tool execution was interrupted; no further calls will run. " + stopped);
                            yield break;
                        }
                        else
                        {
                            activeWorkspace = null;
                            invocation = BoundResult(call, execution.Value with { Duration = clock.Elapsed });
                        }
                    }
                    invocations.Add(invocation);
                    yield return new AgentEvent.ToolFinished(invocation);
                }
                var exchange = new AgentExchange(completed.Text, Array.AsReadOnly(invocations.ToArray()));
                history.Add(exchange);
                historyCharacters += assistantCharacters + invocations.Sum(invocation =>
                    (long)invocation.Result.StandardOutput.Length + invocation.Result.StandardError.Length + (invocation.InteractionContent?.Length ?? 0));
            }
            yield return Stop("Agent model-turn limit reached.");
        }
        finally
        {
            try { if (activeWorkspace is not null) await QuarantineAsync(activeWorkspace).ConfigureAwait(false); }
            finally { Interlocked.Exchange(ref _running, 0); }
        }
    }

    private async Task<string> QuarantineAsync(AgentWorkspace workspace)
    {
        _quarantined.Add(workspace.Id);
        using var cleanup = new CancellationTokenSource(_limits.CleanupTimeout);
        var stopped = await AttemptAsync(async token => new CleanupResult(await _services.AbortAsync(workspace, token).ConfigureAwait(false)), cleanup.Token).ConfigureAwait(false);
        return stopped.Value is { Confirmed: true } ? "The workspace was discarded; start a new sandbox." :
            "Workspace teardown could not be confirmed. Do not reuse it; manual cleanup may be required.";
    }

    private sealed record CleanupResult(bool Confirmed);
    private sealed record Attempt<T>(T? Value, string? Failure = null, bool PolicyRefused = false) where T : class;

    // WaitAsync also bounds an adapter that ignores its cancellation token. An interrupted
    // invocation is never followed by another call; AbortAsync must kill the real workload.
    private static async Task<Attempt<T>> AttemptAsync<T>(Func<CancellationToken, Task<T>> operation, CancellationToken token) where T : class
    {
        try { token.ThrowIfCancellationRequested(); return new(await operation(token).WaitAsync(token).ConfigureAwait(false)); }
        catch (SandboxPolicyException) { return new(null, "The sandbox refused this call before execution.", true); }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { return new(null, "Agent operation reached its time limit or was cancelled."); }
        catch (Exception) { return new(null, "Agent service operation failed. No automatic retry was attempted."); }
    }

    private ToolInvocation BoundResult(ToolCall call, ToolResult result)
    {
        var stdout = result.StandardOutput ?? string.Empty;
        var stderr = result.StandardError ?? string.Empty;
        if ((long)stdout.Length + stderr.Length <= _limits.MaxToolResultCharacters)
            return new ToolInvocation(call, result with { StandardOutput = stdout, StandardError = stderr });
        var outBudget = Math.Min(stdout.Length, _limits.MaxToolResultCharacters - Math.Min(stderr.Length, _limits.MaxToolResultCharacters / 2));
        var errBudget = _limits.MaxToolResultCharacters - outBudget;
        return new ToolInvocation(call, result with { StandardOutput = Clip(stdout, outBudget), StandardError = Clip(stderr, errBudget) })
        { OutputTruncated = stdout.Length > outBudget || stderr.Length > errBudget };
    }

    private static string Clip(string text, int limit)
    {
        const string marker = "\n[Tool output truncated.]";
        return text.Length <= limit ? text : limit < marker.Length ? marker[..limit] : text[..(limit - marker.Length)] + marker;
    }

    private static bool IsCallId(string? id) => id is { Length: > 0 and <= 64 } && id.All(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '-');
    private static AgentEvent.Stopped Stop(string message) => new(ApiError.Unexpected, message);
    private static ToolInvocation Refusal(ToolCall call, string message) => new(call, new ToolResult(-1, string.Empty, message, TimeSpan.Zero, false)) { Refused = true };

    private static void ValidateLimits(AgentLimits limits)
    {
        if (limits.MaxTurns is < 1 or > 24 || limits.MaxToolCalls is < 1 or > 48 || limits.MaxToolCallsPerTurn is < 1 or > 8 ||
            limits.MaxGeneratedTokens is < 1 or > 131_072 || limits.MaxTurnCharacters is < 1 or > 131_072 ||
            limits.MaxToolResultCharacters is < 256 or > 65_536 || limits.MaxHistoryCharacters is < 1024 or > 1_048_576 ||
            limits.ToolTimeout <= TimeSpan.Zero || limits.ToolTimeout > TimeSpan.FromMinutes(5) ||
            limits.RunTimeout <= TimeSpan.Zero || limits.RunTimeout > TimeSpan.FromMinutes(60) ||
            limits.CleanupTimeout <= TimeSpan.Zero || limits.CleanupTimeout > TimeSpan.FromSeconds(30))
            throw new ArgumentOutOfRangeException(nameof(limits), "Agent limits must stay within the harness hard ceilings.");
    }
}
