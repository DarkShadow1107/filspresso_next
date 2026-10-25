using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Core.Streaming;
using Filspresso.Sandbox;

namespace Filspresso.Harness;

/// <summary>One turn of the agent loop.</summary>
public sealed record Turn(
    string UserMessage,
    string ModelKey,
    string? SystemPrompt = null,
    double Temperature = 0.7,
    int MaxTokens = 2048)
{
    public AgentMode Mode { get; init; } = AgentMode.Chat;
    public IReadOnlyList<AgentConversationTurn> Conversation { get; init; } = Array.Empty<AgentConversationTurn>();
}

public enum AgentMode { Chat, Plan, Build }
public enum ToolEffect { ReadOnly, Mutation, Execution, Interaction }
public enum CodeLocation { HyperV, HostedDocker, WindowsSandbox, Inspection, NativeRestricted }

/// <summary>An account/session-owned VM or imported-memory inspection view, never host shell authority.</summary>
public sealed record AgentWorkspace(Guid Id, CodeLocation Location);

/// <summary>A tool the model is allowed to call.</summary>
public sealed record ToolDefinition(
    string Name,
    string Description,
    ToolArgumentSchema Parameters,
    ToolEffect Effect)
{
    /// <summary>External lookup sends data off-device even though project files are read-only.</summary>
    public bool RequiresApproval { get; init; }
}

internal interface IAgentConsentBinding
{
    void AttachConsent(AgentConsentQueue consent);
    void RevokeApprovals();
}

/// <summary>The model's request to run something.</summary>
public sealed record ToolCall(string Id, string Name, string ArgumentsJson);

/// <summary>What came back from running it.</summary>
public sealed record ToolInvocation(ToolCall Call, ToolResult Result)
{
    public bool Refused { get; init; }
    public bool OutputTruncated { get; init; }
    public string? InteractionContent { get; init; }
}

/// <summary>One complete assistant/tool group. Adapters must preserve tool roles and call IDs.</summary>
public sealed record AgentExchange(string AssistantText, IReadOnlyList<ToolInvocation> Invocations);
public sealed record AgentConversationTurn(string UserMessage, string AssistantText, IReadOnlyList<AgentExchange> History);
public sealed record AgentModelRequest(Turn Turn, IReadOnlyList<ToolDefinition> Tools, IReadOnlyList<AgentExchange> History);

public enum AgentFinishReason { Answer, ToolCalls, Length }
public sealed record AgentCompactionReceipt(string Mode, int InputLimit, int TokensBefore, int TokensAfter,
    bool Compacted, int ConsumedGroups, string? Summary, TokenUsage? Usage);

/// <summary>
/// A terminal model response, assembled only from native structured tool-call frames.
/// Markdown, XML tags, reasoning and JSON-looking answer text are NOT tool requests.
/// </summary>
public abstract record AgentModelReply
{
    public sealed record Completed(string Text, TokenUsage? Usage, IReadOnlyList<ToolCall> ToolCalls,
        AgentFinishReason Reason = AgentFinishReason.Answer, int Version = 1) : AgentModelReply
    {
        public string? RunId { get; init; }
        public bool SettlementRecorded { get; init; }
        public AgentCompactionReceipt? Compaction { get; init; }
    }
    public sealed record Refused(ApiError Error, string Message) : AgentModelReply;
    public sealed record Incomplete : AgentModelReply;
}

/// <summary>One-shot consent bound to the exact call and sandbox. Never persisted as reusable approval.</summary>
public sealed record AgentApproval(Guid Id, AgentWorkspace Workspace, ToolCall Call, ToolEffect Effect);
public sealed record AgentApprovalDecision(Guid ApprovalId, bool Approved);

/// <summary>
/// The loop: request a complete model turn, validate its structured calls, apply policy, repeat.
/// </summary>
/// <remarks>
/// Two decisions worth stating, because both are the difference between a harness and a
/// script.
/// <para>
/// <b>Tool results are distinct from narration.</b> They are visible as tool events and go
/// back to the model as paired, untrusted tool data, never privileged instructions.
/// </para>
/// <para>
/// <b>Every tool call is bounded and every refusal is visible.</b> A model that asked for
/// something the sandbox policy rejects is told so, in the same channel as any other result,
/// so it can adapt. A call that times out reports the timeout rather than appearing to
/// succeed -- an agent that cannot tell a failed command from a successful one will happily
/// build on a result that never existed.
/// </para>
/// </remarks>
public interface IAgentLoop
{
    IAsyncEnumerable<AgentEvent> RunAsync(Turn turn, CancellationToken cancellationToken = default);
}

public abstract record AgentEvent
{
    public sealed record UserMessage(string Text) : AgentEvent;
    /// <summary>A chunk of the model's visible answer.</summary>
    public sealed record Say(string Text) : AgentEvent;

    /// <summary>A requested tool, not proof of approval or execution.</summary>
    public sealed record ToolStarting(ToolCall Call) : AgentEvent;

    public sealed record ApprovalRequired(AgentApproval Approval) : AgentEvent;
    public sealed record QuestionRequired(QuestionChallenge Question) : AgentEvent;
    public sealed record QuestionAnswered(string CallId, QuestionDecision Decision) : AgentEvent;

    public sealed record ToolFinished(ToolInvocation Invocation) : AgentEvent;

    /// <summary>The run completed. Aggregate reported usage, not proof of successful settlement.</summary>
    public sealed record Finished(TokenUsage Usage) : AgentEvent
    {
        public AgentConversationTurn? ConversationTurn { get; init; }
    }

    /// <summary>The turn stopped for a reason the user must see.</summary>
    public sealed record Stopped(ApiError Error, string Message) : AgentEvent;
}

/// <summary>
/// What the loop needs from the outside world.
/// </summary>
/// <remarks>
/// Split out so the loop can be tested without a network, a model, or a hypervisor. The
/// loop is where the interesting mistakes live -- unbounded loops, forgotten tool results,
/// treating a refusal as an answer -- and none of them can be found by running it for real.
/// </remarks>
public interface IAgentServices
{
    IReadOnlyCollection<ToolDefinition> Tools { get; }

    // Fail closed. A production adapter may enable this only for a verified native
    // tool-call transport/model combination, never from a model's own claim of support.
    bool SupportsStructuredTools(string modelKey) => false;
    AgentWorkspace? Workspace => null;

    /// <summary>Authenticate, check affordability and meter EVERY model turn, including follow-ups.</summary>
    Task<AgentModelReply> SendAsync(AgentModelRequest request, CancellationToken cancellationToken = default);

    Task<AgentApprovalDecision> ApproveAsync(AgentApproval approval, CancellationToken cancellationToken = default) =>
        Task.FromResult(new AgentApprovalDecision(approval.Id, false));
    Task<QuestionDecision> AskAsync(QuestionChallenge question, CancellationToken cancellationToken = default) =>
        Task.FromResult(new QuestionDecision(1, question.Id, true, Array.Empty<QuestionAnswer>()));

    /// <summary>Dispatch only the registered tool, within the supplied sandbox; never a host shell.</summary>
    Task<ToolResult> InvokeAsync(AgentWorkspace workspace, ToolCall call, CancellationToken cancellationToken = default);

    /// <summary>
    /// Stop/discard the actual workload and its descendants, not just the remoting client.
    /// Return true only when teardown is confirmed. The loop quarantines this workspace regardless.
    /// Adapters must invalidate the session ID even on cleanup failure, so another loop cannot reuse it.
    /// </summary>
    Task<bool> AbortAsync(AgentWorkspace workspace, CancellationToken cancellationToken = default);
}

/// <summary>
/// Bounds on one run.
/// </summary>
/// <remarks>
/// Every one of these is a limit the *harness* enforces, not a request it makes of the model.
/// A model that has been asked nicely to be brief will eventually not be, and the cost of
/// that is the customer's wallet.
/// </remarks>
public sealed record AgentLimits
{
    /// <summary>Model turns per run, including tool results being fed back.</summary>
    public int MaxTurns { get; init; } = 24;

    /// <summary>Tool invocations per run, across all turns.</summary>
    public int MaxToolCalls { get; init; } = 48;

    /// <summary>Wall clock for a single tool call.</summary>
    public TimeSpan ToolTimeout { get; init; } = TimeSpan.FromMinutes(5);

    /// <summary>Wall clock for a whole run.</summary>
    public TimeSpan RunTimeout { get; init; } = TimeSpan.FromMinutes(60);

    public int MaxToolCallsPerTurn { get; init; } = 8;
    public int MaxGeneratedTokens { get; init; } = 16_384;
    public int MaxTurnCharacters { get; init; } = 32_768;
    public int MaxToolResultCharacters { get; init; } = 16_384;
    public int MaxHistoryCharacters { get; init; } = 262_144;
    public TimeSpan CleanupTimeout { get; init; } = TimeSpan.FromSeconds(10);
}
