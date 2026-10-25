using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Core.Streaming;
using Filspresso.Harness;
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class NativeProposalReviewTests
{
    private const string Model = "lfm2_5_230m_q4_k_m";
    private static ToolCall Call(string path = "src/main.py") => new("call_1", "read_file", $"{{\"path\":\"{path}\"}}");
    private static AgentModelReply.Completed Good() => new("Inspecting.", new TokenUsage(100, 12), new[] { Call() }, AgentFinishReason.ToolCalls)
    { RunId = "dsk-0123456789abcdef01234567", SettlementRecorded = true };
    private sealed class Transport : INativeAgentModelTransport
    {
        internal string[] Models = [Model];
        internal int Checks, Posts;
        internal List<AgentModelRequest> Requests { get; } = new();
        internal Func<CancellationToken, Task<ApiResult<NativeAgentCapabilities>>>? OnCheck;
        internal Func<AgentModelRequest, CancellationToken, Task<AgentModelReply>>? OnSend;
        public bool SupportsModel(string model) => Models.Contains(model, StringComparer.Ordinal);
        public Task<ApiResult<NativeAgentCapabilities>> GetCapabilitiesAsync(CancellationToken cancellationToken = default)
        { Checks++; return OnCheck?.Invoke(cancellationToken) ?? Task.FromResult(ApiResult<NativeAgentCapabilities>.Success(new(Models))); }
        public Task<AgentModelReply> SendAsync(AgentModelRequest request, CancellationToken cancellationToken = default)
        { Posts++; Requests.Add(request); return OnSend?.Invoke(request, cancellationToken) ?? Task.FromResult<AgentModelReply>(Good()); }
    }

    [Fact]
    public async Task StartsClosedAndOnlyExplicitGenerationSendsOnePaidModelTurn()
    {
        var transport = new Transport(); using var review = new NativeProposalReview(transport, Model);
        await review.GenerateAsync(AgentMode.Plan, "Inspect."); Assert.Equal(0, transport.Posts);
        await review.RefreshAsync(); Assert.Equal(1, transport.Checks); Assert.Equal(0, transport.Posts);
        await review.GenerateAsync(AgentMode.Plan, "Inspect.");
        Assert.Equal(1, transport.Posts); Assert.Equal(ProposalReviewPhase.Complete, review.Snapshot.Phase);
        Assert.NotNull(review.Snapshot.Reply); Assert.True(review.Snapshot.Reply.SettlementRecorded);
        Assert.Equal("dsk-0123456789abcdef01234567", review.Snapshot.Reply.RunId);
        Assert.Empty(Assert.Single(transport.Requests).History);
    }

    [Fact]
    public async Task DefaultDisabledCapabilitiesNeverGenerate()
    {
        var transport = new Transport { Models = Array.Empty<string>() }; using var review = new NativeProposalReview(transport, Model);
        await review.RefreshAsync(); await review.GenerateAsync(AgentMode.Build, "Propose a fix.");
        Assert.Equal(0, transport.Posts); Assert.Null(review.Snapshot.Reply);
    }

    [Fact]
    public void PlanAndBuildHaveClosedProposalOnlyRegistriesWithoutAnExecutorOrHistory()
    {
        Assert.Equal("read_file", Assert.Single(ProposalReviewProtocol.Tools(AgentMode.Plan)).Name);
        Assert.Equal(new[] { "read_file", "write_file", "run_command" }, ProposalReviewProtocol.Tools(AgentMode.Build).Select(tool => tool.Name));
        var request = ProposalReviewProtocol.Request(Model, AgentMode.Build, "  Propose a fix.  ");
        Assert.Equal("Propose a fix.", request.Turn.UserMessage); Assert.Empty(request.History);
        Assert.Contains("No workspace is connected", request.Turn.SystemPrompt!);
        Assert.Throws<ArgumentException>(() => ProposalReviewProtocol.Request(Model, AgentMode.Chat, "No tool mode."));
        Assert.Throws<ArgumentException>(() => ProposalReviewProtocol.Request(Model, AgentMode.Plan, new string('x', 8001)));
        Assert.Throws<ArgumentException>(() => ProposalReviewProtocol.Request("lfm2_5_audio_1_5b_q4_0", AgentMode.Plan, "Media is not native text."));
        Assert.Throws<NotSupportedException>(() => ((IList<ToolDefinition>)request.Tools).Clear());
    }

    [Fact]
    public async Task DoubleClicksCannotCreateParallelTurns()
    {
        var pending = new TaskCompletionSource<AgentModelReply>(TaskCreationOptions.RunContinuationsAsynchronously);
        var transport = new Transport { OnSend = (_, _) => pending.Task }; using var review = new NativeProposalReview(transport, Model);
        await review.RefreshAsync(); var first = review.GenerateAsync(AgentMode.Plan, "Inspect.");
        await review.GenerateAsync(AgentMode.Build, "Duplicate."); Assert.Equal(1, transport.Posts);
        pending.SetResult(Good()); await first;
        Assert.Equal(ProposalReviewPhase.Complete, review.Snapshot.Phase);
    }

    [Fact]
    public async Task CapabilityRefreshesAreSingleFlightAndCannotReplaceAnActivePaidTurn()
    {
        var capabilities = new TaskCompletionSource<ApiResult<NativeAgentCapabilities>>(TaskCreationOptions.RunContinuationsAsynchronously);
        var reply = new TaskCompletionSource<AgentModelReply>(TaskCreationOptions.RunContinuationsAsynchronously);
        var transport = new Transport { OnCheck = _ => capabilities.Task, OnSend = (_, _) => reply.Task };
        using var review = new NativeProposalReview(transport, Model);
        var checking = review.RefreshAsync(); await review.RefreshAsync(); await review.GenerateAsync(AgentMode.Plan, "Too soon.");
        Assert.Equal(1, transport.Checks); Assert.Equal(0, transport.Posts);
        capabilities.SetResult(ApiResult<NativeAgentCapabilities>.Success(new([Model]))); await checking;
        var generating = review.GenerateAsync(AgentMode.Build, "Propose a fix."); await review.RefreshAsync();
        Assert.Equal(1, transport.Checks); Assert.Equal(1, transport.Posts); Assert.Equal(ProposalReviewPhase.Generating, review.Snapshot.Phase);
        reply.SetResult(Good()); await generating; Assert.Equal(ProposalReviewPhase.Complete, review.Snapshot.Phase);
    }

    [Fact]
    public async Task CancellationFromStateNotificationPreventsDispatchBeforeItStarts()
    {
        var transport = new Transport(); using var review = new NativeProposalReview(transport, Model);
        void StopCheck(object? sender, EventArgs args) { if (review.Snapshot.Phase == ProposalReviewPhase.Checking) review.Clear(true); }
        review.Changed += StopCheck; await review.RefreshAsync(); review.Changed -= StopCheck; Assert.Equal(0, transport.Checks);
        await review.RefreshAsync();
        void StopGeneration(object? sender, EventArgs args) { if (review.Snapshot.Phase == ProposalReviewPhase.Generating) review.Clear(); }
        review.Changed += StopGeneration; await review.GenerateAsync(AgentMode.Plan, "Inspect."); review.Changed -= StopGeneration;
        Assert.Equal(0, transport.Posts); Assert.Null(review.Snapshot.Reply);
    }

    [Fact]
    public async Task CancelledTurnCannotOverwriteOrUnlockANewerActiveTurn()
    {
        var old = new TaskCompletionSource<AgentModelReply>(TaskCreationOptions.RunContinuationsAsynchronously);
        var next = new TaskCompletionSource<AgentModelReply>(TaskCreationOptions.RunContinuationsAsynchronously);
        var transport = new Transport(); transport.OnSend = (_, _) => transport.Posts == 1 ? old.Task : next.Task;
        using var review = new NativeProposalReview(transport, Model); await review.RefreshAsync();
        var first = review.GenerateAsync(AgentMode.Plan, "Old."); review.Clear();
        var second = review.GenerateAsync(AgentMode.Plan, "New."); await first.WaitAsync(TimeSpan.FromSeconds(5)); old.SetResult(Good());
        await review.GenerateAsync(AgentMode.Plan, "Duplicate new."); Assert.Equal(2, transport.Posts); Assert.Equal(ProposalReviewPhase.Generating, review.Snapshot.Phase);
        next.SetResult(Good() with { Text = "New answer." }); await second;
        Assert.Equal("New.", review.Snapshot.Request!.Turn.UserMessage); Assert.Equal("New answer.", review.Snapshot.Reply!.Text);
    }

    [Fact]
    public async Task BuildProposalsAndAnswerOnlyRepliesRemainSingleTurnInertResults()
    {
        var calls = new[] { new ToolCall("write_1", "write_file", "{\"path\":\"src/main.py\",\"text\":\"print(1)\"}"),
            new ToolCall("run_1", "run_command", "{\"command\":\"python3 src/main.py\"}") };
        var transport = new Transport { OnSend = (_, _) => Task.FromResult<AgentModelReply>(Good() with { ToolCalls = calls }) };
        using var review = new NativeProposalReview(transport, Model); await review.RefreshAsync(); await review.GenerateAsync(AgentMode.Build, "Propose a change and test.");
        Assert.Equal(calls, review.Snapshot.Reply!.ToolCalls); Assert.Equal(1, transport.Posts);
        transport.OnSend = (_, _) => Task.FromResult<AgentModelReply>(Good() with { Text = "```sh\necho not-executed\n```", ToolCalls = Array.Empty<ToolCall>(), Reason = AgentFinishReason.Answer });
        await review.GenerateAsync(AgentMode.Plan, "Explain only."); Assert.Equal(2, transport.Posts);
        Assert.Equal(ProposalReviewPhase.Complete, review.Snapshot.Phase); Assert.Empty(review.Snapshot.Reply!.ToolCalls); Assert.Empty(review.Snapshot.Request!.History);
    }

    [Fact]
    public async Task ClearCancelsEvenAnUncooperativeTransportAndNeverShowsItsLateResult()
    {
        var pending = new TaskCompletionSource<AgentModelReply>(TaskCreationOptions.RunContinuationsAsynchronously);
        var transport = new Transport { OnSend = (_, _) => pending.Task }; using var review = new NativeProposalReview(transport, Model);
        await review.RefreshAsync(); var first = review.GenerateAsync(AgentMode.Plan, "Inspect.");
        review.Clear(true, "Account changed."); var cleared = review.Snapshot;
        await first.WaitAsync(TimeSpan.FromSeconds(5)); pending.SetResult(Good());
        Assert.Same(cleared, review.Snapshot); Assert.Null(review.Snapshot.Reply); Assert.Empty(review.Snapshot.Models);
        await review.GenerateAsync(AgentMode.Plan, "New account."); Assert.Equal(1, transport.Posts);
    }

    [Fact]
    public async Task StaleCapabilityRepliesCannotReenableAClearedReview()
    {
        var pending = new TaskCompletionSource<ApiResult<NativeAgentCapabilities>>(TaskCreationOptions.RunContinuationsAsynchronously);
        var transport = new Transport { OnCheck = _ => pending.Task }; using var review = new NativeProposalReview(transport, Model);
        var check = review.RefreshAsync(); review.Clear(true); var cleared = review.Snapshot;
        await check.WaitAsync(TimeSpan.FromSeconds(5)); pending.SetResult(ApiResult<NativeAgentCapabilities>.Success(new([Model])));
        Assert.Same(cleared, review.Snapshot); Assert.Empty(review.Snapshot.Models);
    }

    [Fact]
    public async Task FailedCapabilityRefreshClearsPreviousAvailability()
    {
        var transport = new Transport(); using var review = new NativeProposalReview(transport, Model);
        await review.RefreshAsync(); Assert.Single(review.Snapshot.Models);
        transport.OnCheck = _ => throw new InvalidOperationException(); await review.RefreshAsync();
        Assert.Equal(ProposalReviewPhase.Failed, review.Snapshot.Phase); Assert.Empty(review.Snapshot.Models);
        await review.GenerateAsync(AgentMode.Plan, "Inspect."); Assert.Equal(0, transport.Posts);
    }

    [Fact]
    public async Task InvalidReceiptsModesPathsAndCallsNeverBecomeReviewable()
    {
        var transport = new Transport(); using var review = new NativeProposalReview(transport, Model); await review.RefreshAsync();
        foreach (var reply in new[]
        {
            Good() with { Version = 2 }, Good() with { RunId = null }, Good() with { SettlementRecorded = false },
            Good() with { Usage = null }, Good() with { Reason = AgentFinishReason.Length },
            Good() with { ToolCalls = new[] { Call("../escape") } }, Good() with { ToolCalls = new[] { Call(), Call() } },
            Good() with { ToolCalls = new[] { new ToolCall("call_1", "run_command", "{\"command\":\"whoami\"}") } },
        })
        {
            transport.OnSend = (_, _) => Task.FromResult<AgentModelReply>(reply);
            await review.GenerateAsync(AgentMode.Plan, "Inspect.");
            Assert.Equal(ProposalReviewPhase.Failed, review.Snapshot.Phase); Assert.Null(review.Snapshot.Reply);
        }
    }

    [Fact]
    public async Task ResultsAreCopiedAndReadOnlyNotMutablePendingActions()
    {
        var calls = new List<ToolCall> { Call() };
        var transport = new Transport { OnSend = (_, _) => Task.FromResult<AgentModelReply>(Good() with { ToolCalls = calls }) };
        using var review = new NativeProposalReview(transport, Model); await review.RefreshAsync(); await review.GenerateAsync(AgentMode.Plan, "Inspect.");
        calls.Clear(); Assert.Single(review.Snapshot.Reply!.ToolCalls);
        Assert.Throws<NotSupportedException>(() => ((IList<ToolCall>)review.Snapshot.Reply.ToolCalls).Clear());
        review.Clear(); Assert.Null(review.Snapshot.Reply); Assert.Equal(1, transport.Posts);
    }

    [Fact]
    public async Task DisposeDoesNotPermitFurtherChecksOrGeneration()
    {
        var transport = new Transport(); var review = new NativeProposalReview(transport, Model);
        await review.RefreshAsync(); review.Dispose(); await review.RefreshAsync(); await review.GenerateAsync(AgentMode.Build, "Propose a fix.");
        Assert.Equal(1, transport.Checks); Assert.Equal(0, transport.Posts); Assert.Null(review.Snapshot.Reply);
    }
}
