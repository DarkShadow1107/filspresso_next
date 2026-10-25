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

public sealed class WindowsSandboxWorkflowTests
{
    private sealed class Transport : INativeAgentModelTransport
    {
        internal int Sends;
        public bool SupportsConversation => true;
        public bool SupportsModel(string model) => model == "fixture";
        public Task<ApiResult<NativeAgentCapabilities>> GetCapabilitiesAsync(CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<AgentModelReply> SendAsync(AgentModelRequest request, CancellationToken cancellationToken = default)
        {
            Sends++;
            AgentModelReply reply = Sends == 1
                ? new AgentModelReply.Completed("", new TokenUsage(10, 2), [new("search-one", "web_search", "{\"query\":\"public documentation\"}")], AgentFinishReason.ToolCalls)
                : new AgentModelReply.Completed("done", new TokenUsage(10, 2), []);
            return Task.FromResult(reply);
        }
    }
    private sealed class Web : IAgentWebLookup
    {
        internal int Calls;
        public Task<ToolResult> InvokeAsync(string name, string arguments, CancellationToken cancellationToken)
        { Calls++; return Task.FromResult(new ToolResult(0, "untrusted public result", "", TimeSpan.Zero, false)); }
    }
    private sealed class SnapshotVm : IWorkspaceSandbox, ISandboxSnapshot
    {
        private readonly Guid _id = Guid.NewGuid(); internal bool Stopped;
        public Task<SandboxSessionInfo> StartAsync(string name, CancellationToken cancellationToken = default) => Task.FromResult(new SandboxSessionInfo(_id, "fixture", SandboxState.Ready, 0, null));
        public Task<ToolResult> RunAsync(Guid sessionId, string command, string arguments, string? workingDirectory = null, TimeSpan? timeout = null, CancellationToken cancellationToken = default) => Task.FromResult(new ToolResult(0, "ok", "", TimeSpan.Zero, false));
        public Task<string> WriteFileAsync(Guid sessionId, string relativePath, ReadOnlyMemory<byte> contents, CancellationToken cancellationToken = default) => Task.FromResult(relativePath);
        public Task<string> ReadFileAsync(Guid sessionId, string relativePath, CancellationToken cancellationToken = default) => Task.FromResult("fixture");
        public Task<GuestListing> ListFilesAsync(Guid sessionId, string? relativePath, CancellationToken cancellationToken = default) => Task.FromResult(new GuestListing([], false));
        public Task StopAsync(Guid sessionId, CancellationToken cancellationToken = default) { Stopped = true; return Task.CompletedTask; }
        public Task<IReadOnlyList<SandboxSessionInfo>> ListAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<SandboxSessionInfo>>([]);
        public Task<IReadOnlyList<SandboxTextFile>> CaptureAsync(Guid sessionId, IReadOnlyCollection<string> trackedPaths, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<SandboxTextFile>>([new("src/main.cs", "after command")]);
        public void Dispose() { Stopped = true; }
    }

    [Fact]
    public async Task InspectionReadsImportedTextOnlyAndHasNoWriteOrCommandTool()
    {
        var project = new ProjectCheckpoints(); project.SetBaseline([new("src/main.cs", "before")]);
        using var services = new InspectionAgentServices(new Transport(), project, new Web());
        Assert.DoesNotContain(services.Tools, tool => tool.Name is "write_file" or "run_command");
        var result = await services.InvokeAsync(services.Workspace!, new("read", "read_file", "{\"path\":\"src/main.cs\"}")); Assert.Equal("before", result.StandardOutput);
        await Assert.ThrowsAsync<SandboxPolicyException>(() => services.InvokeAsync(services.Workspace!, new("escape", "read_file", "{\"path\":\"C:\\\\Windows\\\\win.ini\"}")));
        await Assert.ThrowsAsync<SandboxPolicyException>(() => services.InvokeAsync(services.Workspace!, new("write", "write_file", "{\"path\":\"src/main.cs\",\"contents\":\"bad\"}")));
        Assert.Equal("before", project.Current["src/main.cs"]);
    }

    [Theory]
    [InlineData(true, 1)]
    [InlineData(false, 0)]
    public async Task PlanModeWebLookupRequiresSeparateExactConsentWithoutAnyVm(bool approve, int expectedCalls)
    {
        var web = new Web(); using var services = new InspectionAgentServices(new Transport(), new ProjectCheckpoints(), web);
        using var conversation = new AgentConversationSession(services);
        var work = conversation.SendAsync(new("find documentation", "fixture") { Mode = AgentMode.Plan });
        var pending = conversation.Snapshot.Approval;
        Assert.NotNull(pending); Assert.Equal("web_search", pending.Call.Name);
        Assert.Equal(0, web.Calls);
        Assert.True(conversation.Decide(pending.Id, approve)); await work;
        Assert.Equal(expectedCalls, web.Calls);
        await Assert.ThrowsAsync<SandboxPolicyException>(() => services.InvokeAsync(services.Workspace!, pending.Call));
    }

    [Fact]
    public async Task ApprovedCommandEditsAreCapturedBeforeReviewedExport()
    {
        var project = new ProjectCheckpoints(); project.SetBaseline([new("src/main.cs", "before")]);
        using var consent = new AgentConsentQueue(); var vm = new SnapshotVm();
        using var services = new SandboxAgentServices(new Transport(), vm, CodeLocation.WindowsSandbox, project, true, "fixture", consent);
        Assert.True((await services.EnsureWorkspaceAsync()).Ok);
        var call = new ToolCall("command-one", "run_command", "{\"command\":\"formatter\"}");
        var approval = new AgentApproval(Guid.NewGuid(), services.Workspace!, call, ToolEffect.Execution);
        var pending = services.ApproveAsync(approval); Assert.True(consent.Decide(approval.Id, true)); await pending;
        await services.InvokeAsync(services.Workspace!, call);
        Assert.Equal("after command", project.Current["src/main.cs"]);
        Assert.Contains("+after command", Assert.Single(project.Changes).Diff);
        await Assert.ThrowsAsync<SandboxPolicyException>(() => services.InvokeAsync(services.Workspace!, call));
        Assert.False(vm.Stopped);
    }

    [Fact]
    public void SnapshotValidationIsAtomicAndDeletionsAreVisibleButNeverAutomaticallyApplied()
    {
        var project = new ProjectCheckpoints(); project.SetBaseline([new("one.cs", "before"), new("two.cs", "keep")]);
        Assert.Throws<InvalidOperationException>(() => project.RecordSnapshot([new("one.cs", "after"), new("../escape.cs", "bad")]));
        Assert.Equal("before", project.Current["one.cs"]); Assert.Empty(project.Changes);
        project.RecordSnapshot([new("one.cs", "after")]);
        Assert.False(project.Current.ContainsKey("two.cs")); Assert.Equal(2, project.ChangeCount);
        Assert.Contains(project.Changes, change => change.Path == "two.cs" && change.NextSha256 == "" && change.Diff.Contains("-keep", StringComparison.Ordinal));
        var root = System.IO.Directory.CreateTempSubdirectory("filspresso-snapshot-export-");
        try { Assert.Contains(project.Prepare(root.FullName).Conflicts, conflict => conflict.Path == "two.cs" && conflict.Reason.Contains("deletion", StringComparison.OrdinalIgnoreCase)); }
        finally { root.Delete(true); }
    }

    [Fact]
    public void NativeReceiptNeverAcceptsHyperVOrMissingLiveGates()
    {
        var receipt = new WindowsSandboxReceipt(1, HyperVQualification.MachineId, HyperVQualification.ImplementationSha256,
            WindowsSandboxQualification.WindowsBuild, "fixture-package", DateTimeOffset.UtcNow, WindowsSandboxQualification.RequiredChecks);
        Assert.True(WindowsSandboxQualification.Validate(receipt, "fixture-package"));
        Assert.False(WindowsSandboxQualification.Validate(receipt with { Checks = ["fixture"] }, "fixture-package"));
        Assert.False(WindowsSandboxQualification.Validate(receipt with { Implementation = new string('0', 64) }, "fixture-package"));
        Assert.False(WindowsSandboxQualification.Validate(receipt with { WindowsBuild = "old" }, "fixture-package"));
        Assert.False(WindowsSandboxQualification.Validate(receipt with { CreatedUtc = DateTimeOffset.UtcNow.AddDays(-31) }, "fixture-package"));
        Assert.False(WindowsSandboxQualification.Validate(receipt, "updated-package"));
    }
}
