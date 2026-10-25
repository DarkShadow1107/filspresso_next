using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Core.Streaming;
using Filspresso.Harness;
using Filspresso.Sandbox;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>
/// The experimental session spend ceiling: off by default, estimate-only, and re-armed per
/// conversation.
/// </summary>
public class SessionSpendGateTests
{
    private static ToolDefinition ReadTool() => new("read_file", "A sandbox file tool.",
        new ToolArgumentSchema(new Dictionary<string, ToolParameter> { ["path"] = new(ToolParameterKind.WorkspacePath) }), ToolEffect.ReadOnly);
    private static readonly Turn BuildTurn = new("Inspect the workspace.", "fixture-model", "Keep the original instructions.") { Mode = AgentMode.Build };
    private static readonly ToolCall ReadCall = new("call_1", "read_file", "{\"path\":\"src/main.cs\"}");
    private static AgentModelReply.Completed Answer() => new("Done.", new TokenUsage(10, 3), Array.Empty<ToolCall>());
    private static AgentModelReply.Completed Calls() => new("Inspecting.",
        new TokenUsage(20, 4), new[] { ReadCall }, AgentFinishReason.ToolCalls);

    private sealed class Services : IAgentServices
    {
        public IReadOnlyCollection<ToolDefinition> Tools { get; } = new[] { ReadTool() };
        public bool SupportsStructuredTools(string modelKey) => true;
        public AgentWorkspace? Workspace { get; } = new(Guid.NewGuid(), CodeLocation.HyperV);
        public Queue<AgentModelReply> Replies { get; } = new();
        public List<AgentModelRequest> Requests { get; } = new();
        public List<ToolCall> Invocations { get; } = new();

        public Task<AgentModelReply> SendAsync(AgentModelRequest request, CancellationToken cancellationToken = default)
        {
            Requests.Add(request);
            return Task.FromResult(Replies.Dequeue());
        }

        public Task<ToolResult> InvokeAsync(AgentWorkspace workspace, ToolCall call, CancellationToken cancellationToken = default)
        {
            Invocations.Add(call);
            return Task.FromResult(new ToolResult(0, "file contents", string.Empty, TimeSpan.FromSeconds(1), false));
        }

        public Task<bool> AbortAsync(AgentWorkspace workspace, CancellationToken cancellationToken = default) => Task.FromResult(true);
    }

    private static async Task<List<AgentEvent>> CollectAsync(IAgentLoop loop, Turn? turn = null)
    {
        var events = new List<AgentEvent>();
        await foreach (var item in loop.RunAsync(turn ?? BuildTurn)) events.Add(item);
        return events;
    }

    [Fact]
    public void AnUnsetCeilingIsOffAndInert()
    {
        // Null is the untouched default. The gate must not exist and must not be armed by
        // any exploration of the object graph, which is what "default off" means here.
        Assert.Null(SessionSpendGate.Create(null, new Entitlement()));
        var gate = new SessionSpendGate(null, _ => (1m, 1m));
        Assert.False(gate.Enabled);
        Assert.False(gate.Reached);
        Assert.Null(gate.Describe());
        gate.Record("fixture-model", new TokenUsage(1_000_000, 1_000_000));
        Assert.Equal(0m, gate.RecordedSpendRon);
    }

    [Fact]
    public void ACeilingOfZeroOrLessNormalisesToOff()
    {
        Assert.Null(new SessionSpendGate(0, _ => (1m, 1m)).CapRon);
        Assert.Null(new SessionSpendGate(-5, _ => (1m, 1m)).CapRon);
    }

    [Fact]
    public void RepliesAccumulateAtEntitlementPrices()
    {
        // 20,000 input tokens and 4,000 output tokens at 250/500 RON per million:
        // 20,000/1e6 x 250 = 5.000 RON and 4,000/1e6 x 500 = 2.000 RON. The second reply
        // pushes the conversation past its 12 RON ceiling.
        var gate = new SessionSpendGate(12m, _ => (250m, 500m));

        Assert.False(gate.Reached);
        gate.Record("fixture-model", new TokenUsage(20_000, 4_000));
        Assert.Equal(7m, gate.RecordedSpendRon);
        Assert.False(gate.Reached);
        gate.Record("fixture-model", new TokenUsage(20_000, 4_000));
        Assert.True(gate.Reached);
    }

    [Fact]
    public void AModelThisDeviceCannotPriceMakesTheCeilingUnverifiable()
    {
        // Fail closed: an unmeasurable spend must not be allowed to continue under a
        // ceiling, because "cannot know" is not "under budget".
        Func<string, (decimal InputPer1M, decimal OutputPer1M)?> pricing =
            model => model == "fixture-model" ? (1m, 1m) : null;
        var gate = new SessionSpendGate(1000m, pricing);

        Assert.False(gate.Reached);
        gate.Record("unknown-model", new TokenUsage(10, 3));
        Assert.True(gate.Reached);
    }

    [Fact]
    public void ZeroTokenRepliesDoNotSpend()
    {
        var gate = new SessionSpendGate(1m, _ => (1m, 1m));
        gate.Record("fixture-model", new TokenUsage(0, 0));
        Assert.Equal(0m, gate.RecordedSpendRon);
        Assert.False(gate.Reached);
    }

    [Fact]
    public void StartingANewConversationGrantsAFreshBudget()
    {
        var gate = new SessionSpendGate(12m, _ => (250m, 500m));
        gate.Record("fixture-model", new TokenUsage(20_000, 4_000));
        gate.Record("fixture-model", new TokenUsage(20_000, 4_000));
        Assert.True(gate.Reached);

        gate.Reset();

        Assert.False(gate.Reached);
        Assert.Equal(0m, gate.RecordedSpendRon);
        // The ceiling itself is unchanged: the user asked for a per-conversation bound.
        Assert.Equal(12m, gate.CapRon);
    }

    [Fact]
    public void ACeilingBuiltFromEntitlementResolvesEveryModelItCarries()
    {
        var entitlement = new Entitlement
        {
            Models = new[] { new ModelEntry { ModelKey = "m_a", InputPer1M = 100m, OutputPer1M = 200m } },
        };
        var gate = SessionSpendGate.Create(500m, entitlement);

        Assert.NotNull(gate);
        Assert.Equal(500m, gate!.CapRon);
        gate.Record("m_a", new TokenUsage(1_000_000, 0));
        Assert.Equal(100m, gate.RecordedSpendRon);
        Assert.False(gate.Reached);
        gate.Record("m_missing", new TokenUsage(1, 1));
        // A catalogue miss is the unpriceable case: reached, not open.
        Assert.True(gate.Reached);
    }

    [Fact]
    public async Task TheLoopRefusesTheToolBatchOnceTheCeilingIsCrossed()
    {
        var services = new Services();
        services.Replies.Enqueue(Calls());
        // 20 input / 4 output at 250 RON per million => 0.005 + 0.001 = 0.006 RON recorded
        // for the very reply that proposes the tool, above the 0.005 ceiling.
        var gate = new SessionSpendGate(0.005m, _ => (250m, 250m));

        var events = await CollectAsync(new AgentLoop(services, spendGate: gate));

        var stopped = Assert.Single(events.OfType<AgentEvent.Stopped>());
        Assert.Contains("spend cap", stopped.Message, StringComparison.OrdinalIgnoreCase);
        // The tool batch was never proposed for approval, let alone executed.
        Assert.Empty(services.Invocations);
        Assert.Empty(services.Requests.Skip(1));
    }

    [Fact]
    public async Task AnUnreachedCeilingChangesNothing()
    {
        var services = new Services();
        services.Replies.Enqueue(Calls());
        services.Replies.Enqueue(Answer());
        var gate = new SessionSpendGate(1000m, _ => (250m, 250m));

        var events = await CollectAsync(new AgentLoop(services, spendGate: gate));

        Assert.Single(events.OfType<AgentEvent.Finished>());
        Assert.Single(services.Invocations);
        Assert.False(gate.Reached);
    }

    [Fact]
    public async Task TheLoopRunsUnchangedWhenNoGateIsWired()
    {
        var services = new Services();
        services.Replies.Enqueue(Answer());

        var events = await CollectAsync(new AgentLoop(services));

        Assert.Single(events.OfType<AgentEvent.Finished>());
    }

    [Fact]
    public async Task ACappedConversationRefusesFurtherRunsUntilItIsRestarted()
    {
        var services = new Services();
        var gate = new SessionSpendGate(0.005m, _ => (250m, 250m));
        gate.Record("fixture-model", new TokenUsage(20_000, 4_000));
        using var conversation = new AgentConversationSession(services, gate);

        await conversation.SendAsync(BuildTurn);

        var blocked = conversation.Snapshot;
        Assert.False(blocked.Busy);
        Assert.Contains("spend cap", blocked.Error, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(services.Requests);

        // The model conversation restart is what re-arms the budget, not anything silent.
        conversation.NewConversation();
        services.Replies.Enqueue(Answer());
        await conversation.SendAsync(BuildTurn);
        Assert.Single(services.Requests);
    }
}
