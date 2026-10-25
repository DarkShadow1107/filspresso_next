using System;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Harness;
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class AgentConsentQueueTests
{
    private static AgentApproval Approval() => new(Guid.NewGuid(), new(Guid.NewGuid(), CodeLocation.HyperV),
        new("call_1", "run_command", "{\"command\":\"python main.py\"}"), ToolEffect.Execution);

    [Fact]
    public async Task FreshConsentWaitsForAMatchingDecisionAndIsConsumedOnce()
    {
        using var queue = new AgentConsentQueue(); var approval = Approval(); var pending = queue.RequestAsync(approval);
        Assert.False(pending.IsCompleted); Assert.Equal(approval, queue.Pending);
        Assert.False(queue.Decide(Guid.NewGuid(), true)); Assert.NotNull(queue.Pending);
        Assert.True(queue.Decide(approval.Id, true)); Assert.Equal(new(approval.Id, true), await pending);
        Assert.False(queue.Decide(approval.Id, true)); Assert.Null(queue.Pending);
        Assert.False((await queue.RequestAsync(approval)).Approved);
    }

    [Fact]
    public async Task SecondApprovalCannotDisplaceThePendingOne()
    {
        using var queue = new AgentConsentQueue(); var first = Approval(); var pending = queue.RequestAsync(first);
        Assert.False((await queue.RequestAsync(Approval())).Approved); Assert.Equal(first, queue.Pending);
        queue.Clear(); Assert.False((await pending).Approved);
    }

    [Fact]
    public async Task CancellationDeniesConsentAndOldClicksCannotApproveANewAction()
    {
        using var queue = new AgentConsentQueue(); using var cancellation = new CancellationTokenSource();
        var old = Approval(); var previous = queue.RequestAsync(old, cancellation.Token); cancellation.Cancel();
        Assert.False((await previous).Approved); Assert.Null(queue.Pending);
        var next = Approval(); var current = queue.RequestAsync(next);
        Assert.False(queue.Decide(old.Id, true)); Assert.Equal(next, queue.Pending);
        queue.Clear(); Assert.False((await current).Approved);
    }

    [Fact]
    public async Task AlreadyCancelledAndDisposedQueuesNeverPublishApproval()
    {
        var queue = new AgentConsentQueue(); using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        Assert.False((await queue.RequestAsync(Approval(), cancellation.Token)).Approved); Assert.Null(queue.Pending);
        var pending = queue.RequestAsync(Approval()); queue.Dispose(); Assert.False((await pending).Approved);
        Assert.False((await queue.RequestAsync(Approval())).Approved);
    }

    [Fact]
    public async Task ReentrantDismissalDuringNotificationResolvesWithoutDeadlock()
    {
        using var queue = new AgentConsentQueue(); queue.Changed += (_, _) => { if (queue.Pending is not null) queue.Clear(); };
        Assert.False((await queue.RequestAsync(Approval()).WaitAsync(TimeSpan.FromSeconds(3))).Approved);
    }

    [Theory]
    [InlineData(ToolEffect.ReadOnly)]
    [InlineData((ToolEffect)99)]
    public async Task InvalidOrReadOnlyEffectsCannotBeApproved(ToolEffect effect)
    {
        using var queue = new AgentConsentQueue(); Assert.False((await queue.RequestAsync(Approval() with { Effect = effect })).Approved); Assert.Null(queue.Pending);
    }
}
