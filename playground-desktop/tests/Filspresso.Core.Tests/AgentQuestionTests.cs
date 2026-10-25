using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Streaming;
using Filspresso.Harness;
using Filspresso.Sandbox;
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class AgentQuestionTests
{
    private static QuestionForm Form()
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "playground-question.json")));
        return AgentQuestionProtocol.Parse(fixture.RootElement.GetProperty("form").GetRawText());
    }
    private static QuestionChallenge Challenge() => new(1, Guid.NewGuid(), "q-1", Form());
    private static QuestionDecision Answer(QuestionChallenge q) => new(1, q.Id, false, new[] {
        new QuestionAnswer(new[] { 0 }, ""), new QuestionAnswer(new[] { 0, 1 }, "Also inspect Unicode: café 😀") });

    [Fact]
    public void FixedQuestionFormsAreBoundedAndRejectNestedDuplicates()
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "playground-question.json")));
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(fixture.RootElement.GetProperty("schema").GetRawText()), JsonNode.Parse(AgentQuestionProtocol.Schema.GetRawText())));
        var raw = AgentQuestionProtocol.FormJson(Form()); Assert.Equal(2, AgentQuestionProtocol.Parse(raw).Questions.Count);
        foreach (var invalid in new[] { "{\"questions\":[],\"questions\":[]}", raw.Replace("\"header\":\"Database\"", "\"header\":\"Database\",\"header\":\"Injected\""),
            raw.Replace("\"header\":\"Database\"", "\"header\":\"\\uD800\"") }) Assert.False(AgentQuestionProtocol.Tool.Parameters.TryValidate(invalid, out _));
        Assert.True(AgentQuestionProtocol.Tool.Parameters.TryValidate(raw, out _));
    }
    [Fact]
    public void QuestionAnswersNeverAcceptStaleIdentityOrInvalidSelections()
    {
        var q = Challenge(); Assert.False(AgentQuestionProtocol.Validate(q, Answer(q)).Cancelled);
        Assert.Throws<ArgumentException>(() => AgentQuestionProtocol.Validate(q, Answer(q) with { Id = Guid.NewGuid() }));
        foreach (var selected in new[] { new[] { 0, 0 }, new[] { 0, 1 }, new[] { 8 }, Array.Empty<int>() })
            Assert.Throws<ArgumentException>(() => AgentQuestionProtocol.Validate(q, Answer(q) with { Answers = new[] { new QuestionAnswer(selected, ""), Answer(q).Answers[1] } }));
        Assert.Contains("\"grantsExecutionPermission\":false", AgentQuestionProtocol.ResultJson(Answer(q)));
    }
    [Fact]
    public async Task QuestionQueueIsOneShotAndCancellationDismissesWithoutApprovingAnything()
    {
        using var queue = new AgentQuestionQueue(); using var cancellation = new CancellationTokenSource(); var q = Challenge();
        var pending = queue.RequestAsync(q, cancellation.Token);
        Assert.False(queue.Answer(Answer(q) with { Id = Guid.NewGuid() }));
        Assert.True(queue.Answer(Answer(q))); Assert.False(queue.Answer(Answer(q))); Assert.False((await pending).Cancelled);
        await Assert.ThrowsAsync<InvalidOperationException>(() => queue.RequestAsync(q));
        var next = Challenge(); pending = queue.RequestAsync(next, cancellation.Token); cancellation.Cancel();
        Assert.True((await pending).Cancelled); Assert.False(queue.Answer(Answer(next)));
    }
    private sealed class Services : IAgentServices
    {
        public AgentQuestionQueue Questions { get; } = new();
        public IReadOnlyCollection<ToolDefinition> Tools => new[] { AgentQuestionProtocol.Tool };
        public bool SupportsStructuredTools(string _) => true;
        public List<AgentModelRequest> Requests { get; } = new();
        public int Invocations { get; private set; }
        public Task<AgentModelReply> SendAsync(AgentModelRequest request, CancellationToken cancellationToken = default)
        {
            Requests.Add(request);
            return Task.FromResult<AgentModelReply>(Requests.Count == 1 ? new AgentModelReply.Completed("Clarify first", new TokenUsage(20, 4),
                new[] { new ToolCall("q-1", "question", AgentQuestionProtocol.FormJson(Form())) }, AgentFinishReason.ToolCalls) :
                new AgentModelReply.Completed("Done", new TokenUsage(20, 4), Array.Empty<ToolCall>()));
        }
        public Task<QuestionDecision> AskAsync(QuestionChallenge q, CancellationToken cancellationToken = default) => Questions.RequestAsync(q, cancellationToken);
        public Task<ToolResult> InvokeAsync(AgentWorkspace _, ToolCall call, CancellationToken cancellationToken = default) { Invocations++; throw new Exception("Must not invoke"); }
        public Task<bool> AbortAsync(AgentWorkspace _, CancellationToken cancellationToken = default) => throw new Exception("No sandbox started");
    }
    [Fact]
    public async Task InteractionOnlyConversationPausesForAnswerWithoutStartingASandbox()
    {
        var services = new Services(); var ready = new TaskCompletionSource<QuestionChallenge>(TaskCreationOptions.RunContinuationsAsynchronously);
        services.Questions.Changed += (_, _) => { if (services.Questions.Pending is { } q) ready.TrySetResult(q); };
        var events = new List<AgentEvent>();
        var run = Task.Run(async () => { await foreach (var item in new AgentLoop(services).RunAsync(new("Ask first", "fixture") { Mode = AgentMode.Build })) events.Add(item); });
        var q = await ready.Task.WaitAsync(TimeSpan.FromSeconds(5)); Assert.Equal(0, services.Invocations); Assert.Single(services.Requests);
        services.Questions.Answer(Answer(q)); await run.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Single(events.OfType<AgentEvent.QuestionAnswered>()); Assert.Empty(events.OfType<AgentEvent.ApprovalRequired>());
        Assert.Empty(events.OfType<AgentEvent.ToolFinished>()); Assert.Equal(0, services.Invocations);
        Assert.Contains("\"grantsExecutionPermission\":false", Assert.Single(Assert.Single(services.Requests[1].History).Invocations).InteractionContent);
        Assert.Single(events.OfType<AgentEvent.Finished>()).ConversationTurn!.History.Single();
    }
}
