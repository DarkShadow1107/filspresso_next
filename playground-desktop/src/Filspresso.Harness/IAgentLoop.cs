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
    int MaxTokens = 2048);

/// <summary>A tool the model is allowed to call.</summary>
public sealed record ToolDefinition(
    string Name,
    string Description,
    IReadOnlyDictionary<string, string> Parameters);

/// <summary>The model's request to run something.</summary>
public sealed record ToolCall(string Id, string Name, string ArgumentsJson);

/// <summary>What came back from running it.</summary>
public sealed record ToolInvocation(ToolCall Call, ToolResult Result);

/// <summary>
/// The loop: send a turn, stream the answer, run whatever the model asks for, repeat.
/// </summary>
/// <remarks>
/// Two decisions worth stating, because both are the difference between a harness and a
/// script.
/// <para>
/// <b>Tool results go back to the model, never to the UI as output.</b> The user sees the
/// model's narration; the command output is context for the next turn. Conflating them
/// buries the answer in a wall of compiler output.
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
    /// <summary>A chunk of the model's visible answer.</summary>
    public sealed record Say(string Text) : AgentEvent;

    /// <summary>The model wants a tool run. Emitted before the run, so the UI can show it.</summary>
    public sealed record ToolStarting(ToolCall Call) : AgentEvent;

    public sealed record ToolFinished(ToolInvocation Invocation) : AgentEvent;

    /// <summary>The turn ended. Carries the usage the server billed.</summary>
    public sealed record Finished(TokenUsage Usage) : AgentEvent;

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
    IAsyncEnumerable<StreamUpdate> SendAsync(
        string accessToken,
        Turn turn,
        CancellationToken cancellationToken = default);

    ISandbox Sandbox { get; }

    IReadOnlyCollection<ToolDefinition> Tools { get; }
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
}