using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Sandbox;
using Xunit;

namespace Filspresso.Core.Tests;

internal sealed class FixtureGuestCredentials : IGuestCredentialProvider
{
    internal const string Password = "fixture-only ' quoted 界 password";
    internal NetworkCredential? Value { get; set; } = new("fixture-guest", Password);
    public Task<NetworkCredential?> GetCredentialAsync(CancellationToken cancellationToken = default) => Task.FromResult(Value);
}

internal sealed class StubHyperVRunner : IPowerShellRunner
{
    internal sealed record GuestCall(string HostScript, string Input, string Source);
    internal List<string> HostScripts { get; } = new();
    internal List<GuestCall> GuestCalls { get; } = new();
    internal Func<string, CancellationToken, Task<(int, string, string)>>? OnHost { get; set; }
    internal Func<string, CancellationToken, Task<(int, string, string)>>? OnReady { get; set; }
    internal Func<string, CancellationToken, Task<(int, string, string)>>? OnOperation { get; set; }
    public bool SupportsStandardInput => true;
    internal static Task<(int, string, string)> Reply(string json, int exit = 0) => Task.FromResult((exit, json, ""));
    internal static Task<(int, string, string)> Completed(int exit = 0, bool timedOut = false, bool limited = false) =>
        Reply(JsonSerializer.Serialize(new { version = 1, exitCode = exit, stdout = "hello 界", stderr = "diagnostic", timedOut, outputLimited = limited, descendantsClean = true }));
    public Task<(int ExitCode, string Output, string Error)> RunAsync(string script, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        HostScripts.Add(script);
        if (OnHost is not null) return OnHost(script, cancellationToken);
        return Reply(script.Contains("'PROBE_OK'", StringComparison.Ordinal) ? "PROBE_OK" : script.Contains("New-VM -Name", StringComparison.Ordinal) ? "CREATED" : "DONE");
    }
    public Task<(int ExitCode, string Output, string Error)> RunWithInputAsync(string script, string standardInput, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        using var document = JsonDocument.Parse(standardInput);
        var source = Encoding.Unicode.GetString(Convert.FromBase64String(document.RootElement.GetProperty("script").GetString()!));
        GuestCalls.Add(new GuestCall(script, standardInput, source));
        if (source.Contains("\"ready\":true", StringComparison.Ordinal))
            return OnReady?.Invoke(source, cancellationToken) ?? Reply("{\"version\":1,\"ready\":true}");
        return OnOperation?.Invoke(source, cancellationToken) ?? Completed();
    }
    internal HyperVSandbox Sandbox(TimeSpan? readiness = null) => new(this, @"C:\base\windows.vhdx", @"C:\state", credentials: new FixtureGuestCredentials(), readinessTimeout: readiness, recoveryJournal: new MemoryRecoveryJournal());
}

internal sealed class MemoryRecoveryJournal : IHyperVRecoveryJournal
{
    private readonly List<HyperVRecoveryRecord> _records = new();
    public IDisposable Acquire() => new System.IO.MemoryStream();
    public IReadOnlyList<HyperVRecoveryRecord> Read() => _records.ToArray();
    public void Add(HyperVRecoveryRecord record) => _records.Add(record);
    public void Remove(Guid id) => _records.RemoveAll(record => record.Id == id);
}

public sealed class HyperVSandboxLifecycleTests
{
    private static TaskCompletionSource Entered() => new(TaskCreationOptions.RunContinuationsAsynchronously);
    private sealed class ScriptOnlyRunner : IPowerShellRunner
    {
        public Task<(int ExitCode, string Output, string Error)> RunAsync(string script, TimeSpan timeout, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("A runner without private stdin must never be called.");
    }

    [Fact]
    public async Task CredentialsAndPrivateInputAreRequiredBeforeAnyHostOperation()
    {
        var runner = new StubHyperVRunner();
        var sandbox = new HyperVSandbox(runner, @"C:\base\windows.vhdx", @"C:\state");
        Assert.False((await sandbox.ProbeAsync()).Available);
        await Assert.ThrowsAsync<SandboxPolicyException>(() => sandbox.StartAsync("test"));
        Assert.Empty(runner.HostScripts); Assert.Empty(runner.GuestCalls);
        foreach (var value in new NetworkCredential?[] { null, new("", "x"), new("guest", "") })
        {
            sandbox = new HyperVSandbox(runner, @"C:\base\windows.vhdx", @"C:\state", credentials: new FixtureGuestCredentials { Value = value });
            await Assert.ThrowsAsync<SandboxPolicyException>(() => sandbox.StartAsync("test"));
        }
        Assert.Empty(runner.HostScripts);
    }

    [Fact]
    public async Task ScriptOnlyLegacyRunnersCannotFallBackToPuttingSecretsInArguments()
    {
        var sandbox = new HyperVSandbox(new ScriptOnlyRunner(), @"C:\base\windows.vhdx", @"C:\state", credentials: new FixtureGuestCredentials());
        Assert.False((await sandbox.ProbeAsync()).Available);
        await Assert.ThrowsAsync<SandboxPolicyException>(() => sandbox.StartAsync("fixture"));
    }

    [Theory]
    [InlineData(1, "PROBE_OK")]
    [InlineData(0, "True")]
    [InlineData(0, "NOT_PROBE_OK")]
    public async Task AvailabilityMustBeExplicitlyVerified(int exit, string output)
    {
        var runner = new StubHyperVRunner { OnHost = (_, _) => StubHyperVRunner.Reply(output, exit) };
        var sandbox = runner.Sandbox();
        Assert.False((await sandbox.ProbeAsync()).Available);
        await Assert.ThrowsAsync<InvalidOperationException>(() => sandbox.StartAsync("test"));
        Assert.DoesNotContain(runner.HostScripts, script => script.Contains("New-VM -Name", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ReadyIsPublishedOnlyAfterTheGuestConnectionResponds()
    {
        var entered = Entered(); var release = Entered();
        var runner = new StubHyperVRunner { OnReady = async (_, token) => { entered.SetResult(); await release.Task.WaitAsync(token); return (0, "{\"version\":1,\"ready\":true}", ""); } };
        var sandbox = runner.Sandbox();
        var start = sandbox.StartAsync("untrusted name'; anything");
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var pending = Assert.Single(await sandbox.ListAsync());
        Assert.Equal(SandboxState.Starting, pending.State);
        await Assert.ThrowsAsync<SandboxPolicyException>(() => sandbox.RunAsync(pending.Id, "echo fixture", ""));
        release.SetResult();
        var ready = await start;
        Assert.Equal(SandboxState.Ready, ready.State);
        Assert.Matches("^filspresso-[0-9a-f]{32}$", ready.Name);
        Assert.DoesNotContain(runner.HostScripts, script => script.Contains("untrusted name", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ReadinessRetriesNeverCreateAnotherVm()
    {
        var count = 0;
        var runner = new StubHyperVRunner { OnReady = (_, _) => Interlocked.Increment(ref count) == 1 ? StubHyperVRunner.Reply("booting", 1) : StubHyperVRunner.Reply("{\"version\":1,\"ready\":true}") };
        var sandbox = runner.Sandbox();
        await sandbox.StartAsync("test");
        Assert.Equal(2, count);
        Assert.Single(runner.HostScripts, script => script.Contains("New-VM -Name", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ReadinessFailureDiscardsThePartialVmAndDisk()
    {
        var runner = new StubHyperVRunner { OnReady = (_, _) => StubHyperVRunner.Reply("{\"version\":2,\"ready\":true}") };
        var sandbox = runner.Sandbox(TimeSpan.FromMilliseconds(40));
        await Assert.ThrowsAsync<InvalidOperationException>(() => sandbox.StartAsync("test"));
        Assert.Empty(await sandbox.ListAsync());
        var teardown = runner.HostScripts.Last();
        Assert.Contains("-TurnOff", teardown);
        Assert.Contains("Remove-VM", teardown);
        Assert.Contains("Remove-Item -LiteralPath $disk", teardown);
        Assert.DoesNotContain("-Recurse", teardown);
        var create = runner.HostScripts.Single(script => script.Contains("New-VM -Name", StringComparison.Ordinal));
        var disk = Regex.Match(create, "New-VHD -Path '([^']+)'").Groups[1].Value;
        Assert.NotEmpty(disk); Assert.Contains(disk, teardown);
        Assert.DoesNotContain("Remove-VHD", teardown);
    }

    [Fact]
    public async Task FailedCreationAndFailedCleanupRemainDiscoverableAndCannotBeUsed()
    {
        var runner = new StubHyperVRunner();
        runner.OnHost = (script, _) => StubHyperVRunner.Reply(script.Contains("'PROBE_OK'", StringComparison.Ordinal) ? "PROBE_OK" : "SECRET transport failure", script.Contains("'PROBE_OK'", StringComparison.Ordinal) ? 0 : 1);
        var sandbox = runner.Sandbox();
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => sandbox.StartAsync("test"));
        Assert.DoesNotContain("SECRET", error.Message);
        var failed = Assert.Single(await sandbox.ListAsync()); Assert.Equal(SandboxState.Failed, failed.State);
        await Assert.ThrowsAsync<SandboxPolicyException>(() => sandbox.RunAsync(failed.Id, "echo test", ""));
        runner.OnHost = null;
        await sandbox.StopAsync(failed.Id);
        Assert.Empty(await sandbox.ListAsync());
    }

    [Fact]
    public async Task CancellingStartupDoesNotLeaveAReadyOrUsableSession()
    {
        using var cancel = new CancellationTokenSource(); var entered = Entered();
        var runner = new StubHyperVRunner { OnReady = async (_, token) => { entered.SetResult(); await Task.Delay(Timeout.Infinite, token); return (0, "", ""); } };
        var sandbox = runner.Sandbox(); var start = sandbox.StartAsync("test", cancel.Token);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5)); cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => start);
        Assert.Empty(await sandbox.ListAsync());
        Assert.Contains("-TurnOff", runner.HostScripts.Last());
    }

    [Fact]
    public async Task StopDuringStartupCannotBeOverwrittenByALateReadyResponse()
    {
        var entered = Entered();
        var runner = new StubHyperVRunner { OnReady = async (_, token) => { entered.SetResult(); await Task.Delay(Timeout.Infinite, token); return (0, "", ""); } };
        var sandbox = runner.Sandbox(); var start = sandbox.StartAsync("test");
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var id = Assert.Single(await sandbox.ListAsync()).Id;
        await sandbox.StopAsync(id).WaitAsync(TimeSpan.FromSeconds(5));
        await Assert.ThrowsAsync<InvalidOperationException>(() => start);
        Assert.Empty(await sandbox.ListAsync());
    }

    [Fact]
    public async Task CredentialsAndGeneratedSourceAreStdinDataNotHostCodeOrCommandArguments()
    {
        var runner = new StubHyperVRunner(); var sandbox = runner.Sandbox(); var session = await sandbox.StartAsync("test");
        await sandbox.RunAsync(session.Id, "Write-Output 'MODEL_SOURCE_MARKER 界'", "");
        Assert.All(runner.HostScripts.Concat(runner.GuestCalls.Select(call => call.HostScript)), script =>
        {
            Assert.DoesNotContain(FixtureGuestCredentials.Password, script);
            Assert.DoesNotContain("MODEL_SOURCE_MARKER", script);
        });
        var request = runner.GuestCalls.Last();
        using var data = JsonDocument.Parse(request.Input);
        Assert.Equal(FixtureGuestCredentials.Password, data.RootElement.GetProperty("password").GetString());
        Assert.Contains("-Credential $credential", request.HostScript);
        Assert.Contains("param([string]$encoded)", request.HostScript);
        Assert.Contains("Unicode.GetString([Convert]::FromBase64String($encoded))", request.HostScript);
        var encodedChild = Regex.Match(request.Source, "-EncodedCommand ([A-Za-z0-9+/=]+)").Groups[1].Value;
        Assert.Contains("MODEL_SOURCE_MARKER 界", Encoding.Unicode.GetString(Convert.FromBase64String(encodedChild)));
    }

    [Fact]
    public async Task GuestExitCodeAndUnicodeOutputArePreservedAndTimingIsMeasured()
    {
        var runner = new StubHyperVRunner { OnOperation = (_, _) => StubHyperVRunner.Completed(7) };
        var sandbox = runner.Sandbox(); var session = await sandbox.StartAsync("test");
        var result = await sandbox.RunAsync(session.Id, "exit 7", "");
        Assert.Equal(7, result.ExitCode); Assert.Equal("hello 界", result.StandardOutput);
        Assert.False(result.TimedOut); Assert.True(result.Duration < TimeSpan.FromMinutes(1));
        Assert.Equal(SandboxState.Ready, Assert.Single(await sandbox.ListAsync()).State);
        Assert.Contains(HyperVGuestScripts.Root, runner.GuestCalls.Last().Source);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task BothHostAndGuestTimeoutsDiscardTheWholeVm(bool guestTimeout)
    {
        var runner = new StubHyperVRunner { OnOperation = (_, _) => guestTimeout ? StubHyperVRunner.Completed(timedOut: true) : throw new TimeoutException("SECRET") };
        var sandbox = runner.Sandbox(); var session = await sandbox.StartAsync("test");
        var result = await sandbox.RunAsync(session.Id, "echo fixture", "");
        Assert.True(result.TimedOut); Assert.Equal(-1, result.ExitCode);
        Assert.Empty(await sandbox.ListAsync()); Assert.Contains("-TurnOff", runner.HostScripts.Last());
        await Assert.ThrowsAsync<SandboxPolicyException>(() => sandbox.RunAsync(session.Id, "echo fixture", ""));
    }

    [Fact]
    public async Task OperationDeadlineCancellationIsStillATimeoutAfterCleanupCancelsTheSession()
    {
        var runner = new StubHyperVRunner { OnOperation = async (_, token) => { await Task.Delay(Timeout.Infinite, token); return (0, "", ""); } };
        var sandbox = runner.Sandbox(); var session = await sandbox.StartAsync("test");
        var result = await sandbox.RunAsync(session.Id, "echo fixture", "", timeout: TimeSpan.FromMilliseconds(50));
        Assert.True(result.TimedOut); Assert.Empty(await sandbox.ListAsync());
    }

    [Fact]
    public async Task TransportFileNotFoundIsNotMistakenForACompleteMissingFileResponse()
    {
        var runner = new StubHyperVRunner { OnOperation = (_, _) => throw new System.IO.FileNotFoundException("SECRET transport path") };
        var sandbox = runner.Sandbox(); var session = await sandbox.StartAsync("test");
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => sandbox.ReadFileAsync(session.Id, "a.txt"));
        Assert.DoesNotContain("SECRET", error.Message); Assert.Empty(await sandbox.ListAsync());
    }

    [Fact]
    public async Task UnconfirmedHostCreationProcessCannotLoseItsRecoveryRecord()
    {
        var runner = new StubHyperVRunner();
        runner.OnHost = (script, _) => script.Contains("New-VM -Name", StringComparison.Ordinal) ? throw new PowerShellProcessCleanupException() :
            StubHyperVRunner.Reply(script.Contains("'PROBE_OK'", StringComparison.Ordinal) ? "PROBE_OK" : "DONE");
        var sandbox = runner.Sandbox();
        await Assert.ThrowsAsync<InvalidOperationException>(() => sandbox.StartAsync("fixture"));
        var failed = Assert.Single(await sandbox.ListAsync()); Assert.Equal(SandboxState.Failed, failed.State);
        await Assert.ThrowsAsync<SandboxCleanupException>(() => sandbox.StopAsync(failed.Id));
        Assert.Single(await sandbox.ListAsync());
    }

    [Fact]
    public async Task CancellationAfterDispatchPropagatesOnlyAfterIndependentVmCleanup()
    {
        using var cancel = new CancellationTokenSource();
        var runner = new StubHyperVRunner { OnOperation = (_, token) => { cancel.Cancel(); return Task.FromCanceled<(int, string, string)>(token); } };
        runner.OnHost = (script, token) =>
        {
            if (script.Contains("Remove-VM", StringComparison.Ordinal)) Assert.False(token.IsCancellationRequested);
            return StubHyperVRunner.Reply(script.Contains("'PROBE_OK'", StringComparison.Ordinal) ? "PROBE_OK" : script.Contains("New-VM -Name", StringComparison.Ordinal) ? "CREATED" : "DONE");
        };
        var sandbox = runner.Sandbox(); var session = await sandbox.StartAsync("test");
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => sandbox.RunAsync(session.Id, "echo fixture", "", cancellationToken: cancel.Token));
        Assert.Empty(await sandbox.ListAsync()); Assert.Contains("-TurnOff", runner.HostScripts.Last());
    }

    [Fact]
    public async Task ConcurrentWorkIsRefusedAndStopInvalidatesAnActiveOperation()
    {
        var entered = Entered();
        var runner = new StubHyperVRunner { OnOperation = async (_, token) => { entered.SetResult(); await Task.Delay(Timeout.Infinite, token); return (0, "", ""); } };
        var sandbox = runner.Sandbox(); var session = await sandbox.StartAsync("test");
        var run = sandbox.RunAsync(session.Id, "echo fixture", "");
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(SandboxState.Busy, Assert.Single(await sandbox.ListAsync()).State);
        await Assert.ThrowsAsync<SandboxPolicyException>(() => sandbox.ReadFileAsync(session.Id, "a.txt"));
        await sandbox.StopAsync(session.Id).WaitAsync(TimeSpan.FromSeconds(5));
        await Assert.ThrowsAsync<InvalidOperationException>(() => run);
        Assert.Empty(await sandbox.ListAsync());
    }

    [Fact]
    public async Task UnconfirmedTeardownKeepsAFailedNonReusableSessionAndCanBeRetried()
    {
        var runner = new StubHyperVRunner(); var sandbox = runner.Sandbox(); var session = await sandbox.StartAsync("test");
        runner.OnHost = (_, _) => StubHyperVRunner.Reply("DONE", 1);
        await Assert.ThrowsAsync<SandboxCleanupException>(() => sandbox.StopAsync(session.Id));
        Assert.Equal(SandboxState.Failed, Assert.Single(await sandbox.ListAsync()).State);
        await Assert.ThrowsAsync<SandboxPolicyException>(() => sandbox.ReadFileAsync(session.Id, "a.txt"));
        runner.OnHost = null;
        await sandbox.StopAsync(session.Id); var count = runner.HostScripts.Count;
        await sandbox.StopAsync(session.Id); Assert.Equal(count, runner.HostScripts.Count);
        Assert.Empty(await sandbox.ListAsync());
    }

    [Fact]
    public async Task InterruptedExecutionCannotClaimDiscardIfVmCleanupFailed()
    {
        var runner = new StubHyperVRunner { OnOperation = (_, _) => StubHyperVRunner.Completed(timedOut: true) };
        var sandbox = runner.Sandbox(); var session = await sandbox.StartAsync("test");
        runner.OnHost = (_, _) => StubHyperVRunner.Reply("unconfirmed", 1);
        await Assert.ThrowsAsync<SandboxCleanupException>(() => sandbox.RunAsync(session.Id, "echo fixture", ""));
        Assert.Equal(SandboxState.Failed, Assert.Single(await sandbox.ListAsync()).State);
    }

    [Fact]
    public async Task SessionCountAndStartupAreBoundedBeforeProvisioningMoreResources()
    {
        var runner = new StubHyperVRunner(); var sandbox = runner.Sandbox();
        for (var index = 0; index < HyperVSandbox.MaxSessions; index++) await sandbox.StartAsync("fixture");
        var count = runner.HostScripts.Count;
        await Assert.ThrowsAsync<SandboxPolicyException>(() => sandbox.StartAsync("too many"));
        Assert.Equal(count, runner.HostScripts.Count);

        var entered = Entered(); var release = Entered();
        runner = new StubHyperVRunner { OnReady = async (_, token) => { entered.SetResult(); await release.Task.WaitAsync(token); return (0, "{\"version\":1,\"ready\":true}", ""); } };
        sandbox = runner.Sandbox();
        var start = sandbox.StartAsync("first"); await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await Assert.ThrowsAsync<SandboxPolicyException>(() => sandbox.StartAsync("concurrent"));
        release.SetResult(); await start;
    }

    [Theory]
    [InlineData("{\"version\":2,\"exitCode\":0}")]
    [InlineData("not json")]
    [InlineData("{\"version\":1,\"exitCode\":0}")]
    public async Task IncompleteOrUnsupportedResultsAreNotReportedAsSuccess(string payload)
    {
        var runner = new StubHyperVRunner { OnOperation = (_, _) => StubHyperVRunner.Reply(payload) };
        var sandbox = runner.Sandbox(); var session = await sandbox.StartAsync("test");
        await Assert.ThrowsAsync<InvalidOperationException>(() => sandbox.RunAsync(session.Id, "echo fixture", ""));
        Assert.Empty(await sandbox.ListAsync());
    }

    [Fact]
    public async Task OutputLimitStopsAndDiscardsRatherThanReturningASilentPartialLog()
    {
        var runner = new StubHyperVRunner { OnOperation = (_, _) => StubHyperVRunner.Completed(limited: true) };
        var sandbox = runner.Sandbox(); var session = await sandbox.StartAsync("test");
        await Assert.ThrowsAsync<PowerShellOutputLimitException>(() => sandbox.RunAsync(session.Id, "echo fixture", ""));
        Assert.Empty(await sandbox.ListAsync());
    }

    [Theory]
    [InlineData("")]
    [InlineData("hello 界")]
    public async Task FileReadDistinguishesEmptyContentFromAMissingFile(string content)
    {
        var runner = new StubHyperVRunner { OnOperation = (_, _) => StubHyperVRunner.Reply(JsonSerializer.Serialize(new { version = 1, bytes = Convert.ToBase64String(Encoding.UTF8.GetBytes(content)) })) };
        var sandbox = runner.Sandbox(); var session = await sandbox.StartAsync("test");
        Assert.Equal(content, await sandbox.ReadFileAsync(session.Id, "file.txt"));
        Assert.Equal(SandboxState.Ready, Assert.Single(await sandbox.ListAsync()).State);
        runner.OnOperation = (_, _) => StubHyperVRunner.Reply("{\"version\":1,\"missing\":true}");
        await Assert.ThrowsAsync<System.IO.FileNotFoundException>(() => sandbox.ReadFileAsync(session.Id, "missing.txt"));
        Assert.Equal(SandboxState.Ready, Assert.Single(await sandbox.ListAsync()).State);
    }

    [Fact]
    public async Task FileWritesAreBoundedPrivatePayloadsWithGuestReparseChecks()
    {
        var runner = new StubHyperVRunner { OnOperation = (_, _) => StubHyperVRunner.Reply("{\"version\":1,\"written\":true}") };
        var sandbox = runner.Sandbox(); var session = await sandbox.StartAsync("test");
        await sandbox.WriteFileAsync(session.Id, "src/quoted'file.txt", new byte[262_144]);
        var call = runner.GuestCalls.Last();
        Assert.True(call.Input.Length < PowerShellRunner.MaxInputCharacters);
        Assert.Contains("Open-WorkspaceDirectory", call.Source); Assert.Contains("$fence.Open", call.Source);
        Assert.Contains("quoted''file.txt", call.Source);
        var count = runner.GuestCalls.Count;
        await Assert.ThrowsAsync<SandboxPolicyException>(() => sandbox.WriteFileAsync(session.Id, "a.txt", new byte[262_145]));
        await Assert.ThrowsAsync<ArgumentException>(() => sandbox.RunAsync(session.Id, "echo fixture", "", @"C:\Windows"));
        Assert.Equal(count, runner.GuestCalls.Count);
    }
}
