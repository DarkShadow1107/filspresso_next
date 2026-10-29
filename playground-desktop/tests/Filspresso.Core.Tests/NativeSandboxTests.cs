using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Sandbox;
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class NativeSandboxTests
{
    [Fact]
    public void LowboxPowerShellReceivesOnlyTheTrustedInboxModulePath()
    {
        Assert.Contains("var trustedModules = System.IO.Path.Combine(system, @\"WindowsPowerShell\\v1.0\\Modules\")", HyperVGuestScripts.BoundarySource);
        Assert.Contains("{ \"PSModulePath\", trustedModules }", HyperVGuestScripts.BoundarySource);
    }

    private sealed class Broker : IPowerShellRunner
    {
        public bool SupportsStandardInput => true;
        internal bool TimedOut, Unconfirmed, FailCleanup;
        internal readonly List<string> Scripts = new();
        public Task<(int ExitCode, string Output, string Error)> RunAsync(string script, TimeSpan timeout, CancellationToken cancellationToken = default) => throw new InvalidOperationException("No unrestricted shell tool exists.");
        public Task<(int ExitCode, string Output, string Error)> RunWithInputAsync(string script, string input, TimeSpan timeout, CancellationToken cancellationToken = default)
        {
            Scripts.Add(script); using var document = JsonDocument.Parse(input);
            if (document.RootElement.GetProperty("operation").GetString() == "recover") return Task.FromResult((FailCleanup ? 1 : 0, "RECOVERED", ""));
            if (Unconfirmed) throw new PowerShellProcessCleanupException();
            return Task.FromResult((0, JsonSerializer.Serialize(new { ExitCode = 0, Stdout = "fixture", Stderr = "", TimedOut, OutputLimited = false, DescendantsClean = true }), ""));
        }
    }
    [Fact]
    public async Task StagedFileToolsAndSnapshotsNeverModifyTheOriginalFixture()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-native-files-");
        try
        {
            File.WriteAllText(Path.Combine(root.FullName, "original.cs"), "original");
            var broker = new Broker(); using var sandbox = new NativeSandbox(broker, root.FullName, new MemoryRecoveryJournal());
            var session = await sandbox.StartAsync("fixture");
            await sandbox.WriteFileAsync(session.Id, "src/main.cs", Encoding.UTF8.GetBytes("created"));
            Assert.Equal("created", await sandbox.ReadFileAsync(session.Id, "src/main.cs"));
            Assert.Equal("original", File.ReadAllText(Path.Combine(root.FullName, "original.cs")));
            var snapshot = await sandbox.CaptureAsync(session.Id, ["src/main.cs"]);
            Assert.Equal("src/main.cs", Assert.Single(snapshot).Path);
            await Assert.ThrowsAsync<SandboxPolicyException>(() => sandbox.WriteFileAsync(session.Id, "../original.cs", Encoding.UTF8.GetBytes("bad")));
            await sandbox.RunAsync(session.Id, "Write-Output", "fixture");
            Assert.All(broker.Scripts, script => Assert.DoesNotContain("ScriptBlock", script));
            await sandbox.StopAsync(session.Id);
        }
        finally { root.Delete(true); }
    }
    [Fact]
    public async Task TimeoutInvalidatesWorkspaceAndCleanupFailuresRemainRetryable()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-native-timeout-");
        try
        {
            var broker = new Broker { TimedOut = true }; var journal = new MemoryRecoveryJournal();
            using var sandbox = new NativeSandbox(broker, root.FullName, journal); var session = await sandbox.StartAsync("fixture");
            await Assert.ThrowsAsync<TimeoutException>(() => sandbox.RunAsync(session.Id, "fixture", ""));
            await Assert.ThrowsAsync<SandboxPolicyException>(() => sandbox.ReadFileAsync(session.Id, "test.txt"));
            broker.FailCleanup = true; await Assert.ThrowsAsync<IOException>(() => sandbox.StopAsync(session.Id)); Assert.Single(journal.Read());
            broker.FailCleanup = false; await sandbox.StopAsync(session.Id); Assert.Empty(journal.Read());
            var next = await sandbox.StartAsync("new fixture"); Assert.NotEqual(session.Id, next.Id);
        }
        finally { root.Delete(true); }
    }
    [Fact]
    public async Task UnconfirmedProcessShutdownBlocksRecoveryRatherThanReusingTheProfile()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-native-uncertain-");
        try
        {
            var broker = new Broker { Unconfirmed = true }; var journal = new MemoryRecoveryJournal();
            using (var sandbox = new NativeSandbox(broker, root.FullName, journal))
            {
                var session = await sandbox.StartAsync("fixture");
                await Assert.ThrowsAsync<PowerShellProcessCleanupException>(() => sandbox.RunAsync(session.Id, "fixture", ""));
                await Assert.ThrowsAsync<IOException>(() => sandbox.StopAsync(session.Id));
                Assert.True(File.Exists(Path.Combine(root.FullName, session.Id.ToString("N") + ".uncertain")));
            }
            using var recovered = new NativeSandbox(broker, root.FullName, journal);
            await Assert.ThrowsAsync<IOException>(() => recovered.RecoverAsync()); Assert.Single(journal.Read());
        }
        finally { root.Delete(true); }
    }
    [Fact]
    public async Task ActualNativeAdapterPassesFixedContainmentProbesWithoutAnyWindowsSandboxCli()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-native-adapter-live-");
        try
        {
            using var sandbox = new NativeSandbox(new PowerShellRunner(), root.FullName);
            using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(3)); var progress = new List<string>();
            IReadOnlyList<string> checks;
            try { checks = await NativeSandboxQualification.ProbeAsync(sandbox, root.FullName, progress.Add, deadline.Token); }
            catch (Exception error) { Assert.Fail(string.Join("\n", progress) + "\n" + error); return; }
            Assert.Equal(9, checks.Count); Assert.Empty(await sandbox.ListAsync());
            Assert.DoesNotContain("cross-process-crash-recovery", checks); // only the console's actual process-kill run may add this gate
        }
        finally { root.Delete(true); }
    }
    [Fact]
    public void NativeEvidenceCannotBeBorrowedFromVmReceiptsOrOldBuilds()
    {
        var receipt = new NativeSandboxReceipt(1, HyperVQualification.MachineId, HyperVQualification.ImplementationSha256,
            WindowsSandboxQualification.WindowsBuild, DateTimeOffset.UtcNow, NativeSandboxQualification.RequiredChecks);
        Assert.True(NativeSandboxQualification.Validate(receipt));
        Assert.False(NativeSandboxQualification.Validate(receipt with { Checks = WindowsSandboxQualification.RequiredChecks }));
        Assert.False(NativeSandboxQualification.Validate(receipt with { Machine = new string('0', 32) }));
        Assert.False(NativeSandboxQualification.Validate(receipt with { Implementation = new string('0', 64) }));
        Assert.False(NativeSandboxQualification.Validate(receipt with { CreatedUtc = DateTimeOffset.UtcNow.AddDays(-31) }));
    }
}
