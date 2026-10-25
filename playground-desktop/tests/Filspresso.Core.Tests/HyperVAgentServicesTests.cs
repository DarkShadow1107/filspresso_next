using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Harness;
using Filspresso.Sandbox;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>
/// The qualified desktop execution adapter. Everything here runs against the stubbed
/// PowerShell transport; no real Hyper-V is touched. The focus is the enforcement surface:
/// workspace authorization, baseline seeding, journaling, and disposal.
/// </summary>
public sealed class HyperVAgentServicesTests
{
    private static ProjectCheckpoints Baseline(params (string Path, string Contents)[] files)
    {
        var checkpoints = new ProjectCheckpoints();
        checkpoints.SetBaseline(files.Select(file => new ProjectFileSnapshot(file.Path, file.Contents)).ToArray());
        return checkpoints;
    }

    private const string CompletedEnvelope =
        "{\"version\":1,\"exitCode\":0,\"stdout\":\"hello 界\",\"stderr\":\"diagnostic\",\"timedOut\":false,\"outputLimited\":false}";

    private static StubHyperVRunner Runner() => new()
    {
        // Matched on unambiguous markers of the decoded guest scripts: write prints
        // "written", list carries "truncated", read carries "missing" — never overlapping.
        OnOperation = (source, _) => StubHyperVRunner.Reply(
            source.Contains("written", StringComparison.Ordinal) ? "{\"version\":1,\"written\":true}" :
            source.Contains("truncated", StringComparison.Ordinal) ? "{\"version\":1,\"entries\":[],\"truncated\":false}" :
            source.Contains("missing", StringComparison.Ordinal) ? "{\"version\":1,\"bytes\":\"" +
                Convert.ToBase64String(Encoding.UTF8.GetBytes("fixture-contents 界")) + "\"}" :
            CompletedEnvelope),
    };

    private sealed class StubTransport : INativeAgentModelTransport
    {
        public bool SupportsConversation => true; // the shipped native transport implements this; the interface default is fail-closed
        public bool SupportsModel(string model) => model == "supported";
        public Task<ApiResult<NativeAgentCapabilities>> GetCapabilitiesAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(ApiResult<NativeAgentCapabilities>.Success(new(["supported"])));
        public Task<AgentModelReply> SendAsync(AgentModelRequest request, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Model turns are transport-owned; the adapter never sends.");
    }

    private static HyperVAgentServices Compose(StubHyperVRunner runner, HyperVSandbox? sandbox = null, ProjectCheckpoints? checkpoints = null) =>
        new(new StubTransport(), sandbox ?? runner.Sandbox(), new HyperVQualificationReceipt(
            @"C:\base\windows.vhdx", new string('a', 64), 2L * 1024 * 1024, 2,
            DateTimeOffset.UtcNow, HyperVQualification.MachineId, HyperVQualificationReceipt.RequiredChecks),
            checkpoints ?? Baseline(("src/main.py", "print('one')")),
            executionQualified: true, executionStatus: "fixture-qualified");

    private static readonly ToolCall WriteCall =
        new("call_w", "write_file", "{\"path\":\"src/main.py\",\"contents\":\"print('two')\"}");

    [Fact]
    public void ToolRegistryIsBoundedAndStatesTheApprovalPolicyInDescriptions()
    {
        using var services = Compose(Runner());
        var registry = services.Tools.Select(tool => tool.Name).ToArray();
        Assert.Equal(new[] { "question", "list_files", "read_file", "write_file", "run_command" }, registry);
        var question = services.Tools.Single(tool => tool.Name == "question");
        Assert.Equal(ToolEffect.Interaction, question.Effect);
        Assert.True(question.Parameters.IsQuestion);
        var write = services.Tools.Single(tool => tool.Name == "write_file");
        Assert.Equal(ToolEffect.Mutation, write.Effect);
        Assert.Contains("approval", write.Description, StringComparison.OrdinalIgnoreCase);
        var run = services.Tools.Single(tool => tool.Name == "run_command");
        Assert.Equal(ToolEffect.Execution, run.Effect);
        foreach (var tool in services.Tools.Where(tool => tool.Name != "question"))
            Assert.NotEqual(ToolEffect.Interaction, tool.Effect);
        Assert.True(services.SupportsStructuredTools("supported"));
        Assert.False(services.SupportsStructuredTools("unknown"));
        Assert.Null(services.Workspace);
        Assert.True(services.ExecutionQualified);
    }

    [Fact]
    public async Task WorkspaceMustExistAndMatchBeforeAnyToolExecutes()
    {
        var runner = Runner();
        using var services = Compose(runner);
        var workspace = new AgentWorkspace(Guid.NewGuid(), CodeLocation.HyperV);
        await Assert.ThrowsAsync<SandboxPolicyException>(() => services.InvokeAsync(workspace, WriteCall));
        await Assert.ThrowsAsync<SandboxPolicyException>(() =>
            services.InvokeAsync(workspace, new ToolCall("c", "read_file", "{\"path\":\"src/main.py\"}")));
        await Assert.ThrowsAsync<SandboxPolicyException>(() =>
            services.InvokeAsync(workspace, new ToolCall("c", "evaluate_expression", "{}")));
        Assert.Empty(runner.GuestCalls);
    }

    [Fact]
    public async Task StartupSeedsTheBaselineAndPublishesTheWorkspaceForIt()
    {
        var runner = Runner();
        var checkpoints = Baseline(("src/main.py", "print('one')"), ("docs/readme", "tiny"));
        using var services = Compose(runner, checkpoints: checkpoints);
        var progress = new List<string>();
        var (ok, error) = await services.EnsureWorkspaceAsync(report: progress.Add);
        Assert.True(ok, error);
        Assert.Empty(error);
        var workspace = Assert.IsType<AgentWorkspace>(services.Workspace);
        Assert.Equal(CodeLocation.HyperV, workspace.Location);
        Assert.Contains(progress, line => line.Contains("Starting", StringComparison.Ordinal));
        Assert.Contains(progress, line => line.Contains("ready", StringComparison.OrdinalIgnoreCase));

        // Seeding wrote both files into the guest before the workspace was published.
        var writes = runner.GuestCalls.Where(call => call.Source.Contains("written", StringComparison.Ordinal)).ToList();
        Assert.Equal(2, writes.Count);
        var sources = string.Concat(writes.Select(call => call.Source));
        Assert.Contains(Convert.ToBase64String(Encoding.UTF8.GetBytes("print('one')")), sources, StringComparison.Ordinal);
        Assert.Contains(Convert.ToBase64String(Encoding.UTF8.GetBytes("tiny")), sources, StringComparison.Ordinal);

        // A second start is a no-op that creates no further host operations.
        var hostOperationsBefore = runner.HostScripts.Count;
        var second = await services.EnsureWorkspaceAsync();
        Assert.True(second.Ok);
        Assert.Equal(hostOperationsBefore, runner.HostScripts.Count);
        Assert.Equal(workspace.Id, services.Workspace!.Id);
    }

    [Fact]
    public async Task ApprovedWritesAreJournalledAgainstTheBaseline()
    {
        var runner = Runner();
        var checkpoints = Baseline(("src/main.py", "print('one')"));
        using var services = Compose(runner, checkpoints: checkpoints);
        await services.EnsureWorkspaceAsync();
        var workspace = services.Workspace!;
        var result = await services.InvokeAsync(workspace, WriteCall);
        Assert.Equal(0, result.ExitCode);
        var change = checkpoints.Changes.Single(change => change.Path == "src/main.py");
        Assert.Contains("-print('one')", change.Diff, StringComparison.Ordinal);
        Assert.Contains("+print('two')", change.Diff, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ReadListAndRunDispatchThroughTheGuestTransportOnly()
    {
        var runner = Runner();
        using var services = Compose(runner);
        await services.EnsureWorkspaceAsync();
        var workspace = services.Workspace!;

        var read = await services.InvokeAsync(workspace, new ToolCall("c", "read_file", "{\"path\":\"src/main.py\"}"));
        Assert.Equal("fixture-contents 界", read.StandardOutput);

        var listing = await services.InvokeAsync(workspace, new ToolCall("c", "list_files", "{}"));
        Assert.Equal(0, listing.ExitCode);
        Assert.Empty(listing.StandardOutput); // empty fixture listing

        var run = await services.InvokeAsync(workspace, new ToolCall("c", "run_command",
            "{\"command\":\"python\",\"arguments\":\"-V\",\"directory\":\"src\",\"timeoutSeconds\":60}"));
        Assert.Equal(0, run.ExitCode);
        Assert.Contains("hello 界", run.StandardOutput, StringComparison.Ordinal);
        Assert.Contains("diagnostic", run.StandardError, StringComparison.Ordinal);
        Assert.All(runner.GuestCalls, call => Assert.Contains("filspresso-workspace", call.Source, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task OversizedBaselineSeedContentIsRefusedBeforeAnyGuestWrite()
    {
        var runner = Runner();
        var checkpoints = Baseline(("src/big.cpp", new string('x', HyperVSandbox.MaxSandboxFileBytes + 1)));
        using var services = Compose(runner, checkpoints: checkpoints);
        var (ok, error) = await services.EnsureWorkspaceAsync();
        Assert.False(ok);
        Assert.Contains("per-file sandbox limit", error, StringComparison.OrdinalIgnoreCase);
        Assert.Null(services.Workspace);
        Assert.DoesNotContain(runner.GuestCalls, call => call.Source.Contains("written", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ReadinessFailureSurfacesAsAStartRefusalWithoutPublishingAWorkspace()
    {
        var runner = new StubHyperVRunner
        {
            OnReady = (_, _) => StubHyperVRunner.Reply("not-ready", 1),
            OnOperation = (_, _) => StubHyperVRunner.Completed(),
        };
        var sandbox = new HyperVSandbox(runner, @"C:\base\windows.vhdx", @"C:\state",
            credentials: new FixtureGuestCredentials(), readinessTimeout: TimeSpan.FromSeconds(1));
        using var services = Compose(new StubHyperVRunner(), sandbox);
        var (ok, error) = await services.EnsureWorkspaceAsync();
        Assert.False(ok);
        Assert.NotEmpty(error);
        Assert.Null(services.Workspace);
    }

    [Fact]
    public async Task DiscardStopsTheSandboxAndRevokesTheWorkspaceId()
    {
        var runner = Runner();
        using var services = Compose(runner);
        await services.EnsureWorkspaceAsync();
        Assert.NotNull(services.Workspace);
        Assert.True(await services.DiscardWorkspaceAsync());
        Assert.Null(services.Workspace);
        // After a discard, tool calls are refused structurally, not dispatched to a dead VM.
        await Assert.ThrowsAsync<SandboxPolicyException>(() => services.InvokeAsync(
            new AgentWorkspace(Guid.NewGuid(), CodeLocation.HyperV), WriteCall));
    }

    [Fact]
    public async Task DisposeAfterStartupStopsInTheBackgroundAndRejectsFurtherUse()
    {
        var runner = Runner();
        var services = Compose(runner);
        await services.EnsureWorkspaceAsync();
        var workspace = services.Workspace!;
        services.Dispose();
        Assert.Null(services.Workspace);
        await Assert.ThrowsAsync<SandboxPolicyException>(() => services.InvokeAsync(workspace, WriteCall));
        var (ok, _) = await services.EnsureWorkspaceAsync();
        Assert.False(ok);
    }
}
