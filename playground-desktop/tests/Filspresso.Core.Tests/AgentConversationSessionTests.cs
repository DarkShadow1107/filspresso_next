using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Streaming;
using Filspresso.Harness;
using Filspresso.Sandbox;
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class AgentConversationSessionTests
{
    private static readonly Turn Turn = new("First request", "fixture", "Original instructions") { Mode = AgentMode.Build };
    private static AgentModelReply Answer(string text = "Done") => new AgentModelReply.Completed(text, new TokenUsage(20, 4), Array.Empty<ToolCall>());
    private sealed class Services : IAgentServices
    {
        public IReadOnlyCollection<ToolDefinition> Tools { get; set; } = new[] { AgentQuestionProtocol.Tool };
        public AgentWorkspace? Workspace { get; set; }
        public bool SupportsStructuredTools(string model) => true;
        public List<AgentModelRequest> Requests { get; } = new();
        public Func<AgentModelRequest, CancellationToken, Task<AgentModelReply>>? OnSend;
        public Func<CancellationToken, Task<bool>>? OnAbort;
        public Func<CancellationToken, Task<ToolResult>>? OnInvoke;
        public Task<AgentModelReply> SendAsync(AgentModelRequest request, CancellationToken cancellationToken = default)
        { Requests.Add(request); return OnSend?.Invoke(request, cancellationToken) ?? Task.FromResult(Answer()); }
        public Task<ToolResult> InvokeAsync(AgentWorkspace workspace, ToolCall call, CancellationToken cancellationToken = default) => OnInvoke?.Invoke(cancellationToken) ?? throw new Exception("No execution");
        public Task<bool> AbortAsync(AgentWorkspace workspace, CancellationToken cancellationToken = default) => OnAbort?.Invoke(cancellationToken) ?? Task.FromResult(true);
    }
    [Fact]
    public async Task CompletedTurnsAndAnswersRemainInOneClientLocalConversation()
    {
        var services = new Services(); using var session = new AgentConversationSession(services);
        await session.SendAsync(Turn); await session.SendAsync(Turn with { UserMessage = "Follow-up" });
        Assert.Equal(2, session.Snapshot.CompletedTurns); Assert.Empty(services.Requests[0].Turn.Conversation);
        var previous = Assert.Single(services.Requests[1].Turn.Conversation);
        Assert.Equal(Turn.UserMessage, previous.UserMessage); Assert.Equal("Done", previous.AssistantText);
        Assert.Equal(Turn.SystemPrompt, services.Requests[1].Turn.SystemPrompt);
        Assert.Equal(2, session.Snapshot.Events.OfType<AgentEvent.UserMessage>().Count());
        await session.SendAsync(Turn with { Mode = AgentMode.Plan }); Assert.Equal(2, services.Requests.Count);
        Assert.True(session.NewConversation()); Assert.Empty(session.Snapshot.Events);
    }
    [Fact]
    public async Task OneExplicitlyQueuedFollowUpRunsOnlyAfterSuccessAndCarriesTheCompletedTurn()
    {
        var first = new TaskCompletionSource<AgentModelReply>(TaskCreationOptions.RunContinuationsAsynchronously);
        var services = new Services { OnSend = (request, _) => request.Turn.UserMessage == "First request" ? first.Task : Task.FromResult(Answer("Second answer")) };
        using var session = new AgentConversationSession(services);
        var running = session.SendAsync(Turn);
        Assert.True(session.QueueFollowUp(Turn with { UserMessage = "Queued follow-up" }));
        Assert.False(session.QueueFollowUp(Turn with { UserMessage = "Cannot overwrite queue" }));
        Assert.Single(services.Requests); first.SetResult(Answer()); await running;
        Assert.Equal(2, services.Requests.Count); Assert.Single(services.Requests[1].Turn.Conversation);
        Assert.Equal(2, session.Snapshot.CompletedTurns); Assert.Null(session.Snapshot.QueuedMessage);
    }
    [Fact]
    public async Task SharedTranscriptChangesModeWithoutReplayingToolsOrRestoringApproval()
    {
        var services = new Services(); using var session = new AgentConversationSession(services);
        await session.SendAsync(Turn);
        Assert.True(session.ContinueFromTranscript(new[] { new AgentConversationTurn("First request", "Prior answer, not execution permission", Array.Empty<AgentExchange>()) }));
        await session.SendAsync(Turn with { Mode = AgentMode.Plan, UserMessage = "Inspect only", SystemPrompt = "Read-only instructions" });
        var plan = services.Requests[1]; Assert.Equal(AgentMode.Plan, plan.Turn.Mode);
        Assert.Empty(Assert.Single(plan.Turn.Conversation).History);
        Assert.All(plan.Tools, tool => Assert.True(tool.Effect is ToolEffect.ReadOnly or ToolEffect.Interaction));
        Assert.Null(session.Snapshot.Approval);
    }
    [Fact]
    public async Task SharedTranscriptCannotReplaceActiveOrFailedContextAndRefusesOverflow()
    {
        var pending = new TaskCompletionSource<AgentModelReply>(TaskCreationOptions.RunContinuationsAsynchronously);
        var services = new Services { OnSend = (_, _) => pending.Task };
        using var session = new AgentConversationSession(services);
        var running = session.SendAsync(Turn);
        Assert.False(session.ContinueFromTranscript(Array.Empty<AgentConversationTurn>()));
        session.Stop(); await running.WaitAsync(TimeSpan.FromSeconds(5)); pending.SetResult(Answer());
        Assert.True(session.Snapshot.RequiresReset);
        Assert.False(session.ContinueFromTranscript(Array.Empty<AgentConversationTurn>()));
        Assert.True(session.NewConversation());
        Assert.False(session.ContinueFromTranscript(new[] { new AgentConversationTurn(new string('x', 8001), "Answer", Array.Empty<AgentExchange>()) }));
    }
    [Fact]
    public async Task StopClearsQueuedWorkAndSuppressesLateUncooperativeModelOutput()
    {
        var first = new TaskCompletionSource<AgentModelReply>(TaskCreationOptions.RunContinuationsAsynchronously);
        var services = new Services { OnSend = (_, _) => first.Task };
        using var session = new AgentConversationSession(services); var running = session.SendAsync(Turn);
        Assert.True(session.QueueFollowUp(Turn with { UserMessage = "Never send this" })); session.Stop(true);
        Assert.Empty(session.Snapshot.Events); await running.WaitAsync(TimeSpan.FromSeconds(5)); first.SetResult(Answer("Late secret"));
        Assert.Single(services.Requests); Assert.Empty(session.Snapshot.Events); Assert.Null(session.Snapshot.QueuedMessage);
    }
    [Fact]
    public async Task QuestionsAndApprovalsHaveIndependentIdsAndAnsweringNeverDecidesAnAction()
    {
        var services = new Services(); using var session = new AgentConversationSession(services);
        var form = "{\"questions\":[{\"header\":\"Choice\",\"question\":\"Which?\",\"multiple\":false,\"options\":[]}]}";
        services.OnSend = (request, _) => Task.FromResult<AgentModelReply>(request.History.Count == 0 ?
            new AgentModelReply.Completed("Question", new TokenUsage(20, 4), new[] { new ToolCall("q_1", "question", form) }, AgentFinishReason.ToolCalls) : Answer());
        var ready = new TaskCompletionSource<QuestionChallenge>(TaskCreationOptions.RunContinuationsAsynchronously);
        session.Changed += (_, _) => { if (session.Snapshot.Question is { } q) ready.TrySetResult(q); };
        var running = session.SendAsync(Turn); var question = await ready.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(session.Decide(question.Id, true)); Assert.Null(session.Snapshot.Approval);
        Assert.True(session.Answer(new(1, question.Id, false, new[] { new QuestionAnswer(Array.Empty<int>(), "Use the existing setup") })));
        await running; Assert.Single(session.Snapshot.Events.OfType<AgentEvent.QuestionAnswered>());
        Assert.Empty(session.Snapshot.Events.OfType<AgentEvent.ApprovalRequired>());
    }
    [Fact]
    public async Task StopCannotUnlockANewRunBeforeIndependentSandboxCleanupFinishes()
    {
        var cleanup = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var dispatched = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var services = new Services { Workspace = new(Guid.NewGuid(), CodeLocation.HyperV), Tools = new[] { new ToolDefinition("run_command", "A guest command",
            new ToolArgumentSchema(new Dictionary<string, ToolParameter> { ["command"] = new(ToolParameterKind.String) }), ToolEffect.Execution) } };
        services.OnSend = (_, _) => Task.FromResult<AgentModelReply>(new AgentModelReply.Completed("Run", new TokenUsage(20, 4), new[] { new ToolCall("cmd", "run_command", "{\"command\":\"test\"}") }, AgentFinishReason.ToolCalls));
        services.OnInvoke = _ => { dispatched.SetResult(); return new TaskCompletionSource<ToolResult>().Task; }; services.OnAbort = _ => cleanup.Task;
        using var session = new AgentConversationSession(services);
        session.Changed += (_, _) => { if (session.Snapshot.Approval is { } approval) session.Decide(approval.Id, true); };
        var running = session.SendAsync(Turn); await dispatched.Task.WaitAsync(TimeSpan.FromSeconds(5)); session.Stop();
        Assert.True(session.Snapshot.Busy); await session.SendAsync(Turn); Assert.Single(services.Requests);
        cleanup.SetResult(true); await running.WaitAsync(TimeSpan.FromSeconds(5)); Assert.False(session.Snapshot.Busy); Assert.True(session.Snapshot.RequiresReset);
    }
}
