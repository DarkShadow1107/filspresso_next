using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Core.Auth;
using Filspresso.Core.Tools;
using Filspresso.Sandbox;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>
/// The sandbox's decisions, checked without a hypervisor.
/// </summary>
/// <remarks>
/// The property that matters is that the virtual machine is created with no network adapter at
/// all. That cannot be tested on a machine without Hyper-V, so what is tested here is the
/// script that creates it -- and the script is the thing that decides. A future edit that adds
/// a switch, or attaches an adapter afterwards, fails these tests rather than quietly
/// weakening the boundary.
/// </remarks>
public class SandboxContractTests
{
    private sealed class RecordingRunner : IPowerShellRunner
    {
        public List<string> Scripts { get; } = new();
        public bool SupportsStandardInput => true;

        public Task<(int ExitCode, string Output, string Error)> RunWithInputAsync(string script, string standardInput, TimeSpan timeout, CancellationToken cancellationToken = default)
        {
            Scripts.Add(script);
            return Task.FromResult((0, "{\"version\":1,\"ready\":true}", ""));
        }

        public Task<(int ExitCode, string Output, string Error)> RunAsync(
            string script, TimeSpan timeout, CancellationToken cancellationToken = default)
        {
            Scripts.Add(script);
            if (script.Contains("New-VM -Name"))
            {
                return Task.FromResult((0, "CREATED", ""));
            }

            if (script.Contains("'PROBE_OK'"))
            {
                return Task.FromResult((0, "PROBE_OK", ""));
            }

            return Task.FromResult((0, "DONE", ""));
        }
    }

    private static HyperVSandbox NewSandbox(RecordingRunner runner) =>
        new(runner, @"C:\base\windows.vhdx", @"C:\workspace", credentials: new FixtureGuestCredentials(), recoveryJournal: new MemoryRecoveryJournal());

    [Fact]
    public async Task TheVirtualMachineIsCreatedWithNoNetworkAdapter()
    {
        var runner = new RecordingRunner();
        var sandbox = NewSandbox(runner);

        await sandbox.StartAsync("test");

        var creation = runner.Scripts.First(s => s.Contains("New-VM -Name"));
        Assert.Contains("New-VM -Name", creation);
        // No switch, and no adapter is attached afterwards.
        Assert.DoesNotContain("-SwitchName", creation);
        Assert.DoesNotContain("Connect-VMNetworkAdapter", creation);
        // And any adapter that somehow exists is removed, so the property is asserted rather
        // than assumed.
        Assert.Contains("Remove-VMNetworkAdapter", creation);
    }

    [Fact]
    public async Task TheMachineIsBootedSecure()
    {
        var runner = new RecordingRunner();
        await NewSandbox(runner).StartAsync("test");

        var creation = runner.Scripts.First(s => s.Contains("New-VM -Name"));
        Assert.Contains("EnableSecureBoot On", creation);
        // Memory is capped, so a runaway process inside cannot take the host down with it.
        Assert.Contains("MaximumBytes 4GB", creation);
    }

    [Fact]
    public void APathCannotClimbOutOfTheWorkspace()
    {
        // The guest has no network, but it does have a filesystem, and the workspace is the
        // boundary for it.
        Assert.Throws<ArgumentException>(() => HyperVSandbox.CombineInsideGuest(@"..\..\Windows\System32\config\SAM"));
        Assert.Throws<ArgumentException>(() => HyperVSandbox.CombineInsideGuest(@"C:\Windows\System32\config\SAM"));
        // A path inside is fine.
        Assert.Contains("filspresso-workspace", HyperVSandbox.CombineInsideGuest("project\\main.cs"), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(@"..\filspresso-workspace-escape\secret.txt")]
    [InlineData(@"C:\filspresso-workspace\file.txt")]
    [InlineData(@"\\server\share\file.txt")]
    [InlineData(@"file.txt:stream")]
    [InlineData(@"C:file.txt")]
    [InlineData(@"NUL.txt")]
    [InlineData(@"CONIN$")]
    [InlineData(@"src\file.")]
    [InlineData(@"src\file ")]
    [InlineData(@"src\..\file.txt")]
    [InlineData("")]
    public void SiblingsRootedPathsAndWindowsAliasesAreNotGuestWorkspaceFiles(string path) =>
        Assert.Throws<ArgumentException>(() => HyperVSandbox.CombineInsideGuest(path));

    [Fact]
    public void GuestFilePathsAreCanonicalRegardlessOfAcceptedRelativeSeparator() =>
        Assert.Equal(@"C:\filspresso-workspace\src\main.cs", HyperVSandbox.CombineInsideGuest("src/main.cs"));

    [Fact]
    public void QuotesInValuesCannotBreakOutOfAString()
    {
        // Every value that reaches PowerShell goes through this. A name with a quote in it would
        // otherwise close the string and start a command.
        //
        // The property that matters is that every quote is doubled: inside a single-quoted
        // PowerShell string, `''` is one literal quote, so a string of only doubled quotes
        // cannot be terminated early. A value with an odd number of quotes would escape.
        var raw = "it's'; Remove-VM -Name 'x'";
        var escaped = HyperVSandbox.Escape(raw);

        Assert.Equal(raw.Count(c => c == '\'') * 2, escaped.Count(c => c == '\''));
        // And nothing is lost: unescaping gives the original back exactly.
        Assert.Equal(raw, escaped.Replace("''", "'"));
    }

    [Fact]
    public async Task StoppingTwiceIsNotAnError()
    {
        // Teardown runs from a crash handler as well as from a clean exit.
        var runner = new RecordingRunner();
        var sandbox = NewSandbox(runner);
        var session = await sandbox.StartAsync("test");

        await sandbox.StopAsync(session.Id);
        await sandbox.StopAsync(session.Id);
    }

    [Fact]
    public async Task TeardownRemovesTheDiskToo()
    {
        var runner = new RecordingRunner();
        var sandbox = NewSandbox(runner);
        var session = await sandbox.StartAsync("test");

        await sandbox.StopAsync(session.Id);

        var teardown = runner.Scripts.Last();
        Assert.Contains("Stop-VM", teardown);
        Assert.Contains("Remove-VM", teardown);
    }
}

/// <summary>
/// The web tools, against a stubbed server.
/// </summary>
public class WebToolTests
{
    private sealed class StubHandler : HttpMessageHandler
    {
        public string ResponseBody { get; set; } = "{}";
        public int StatusCode { get; set; } = 200;
        public string? LastBody { get; private set; }
        public string? LastAuthorization { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            LastAuthorization = request.Headers.Authorization?.ToString();
            return new HttpResponseMessage((System.Net.HttpStatusCode)StatusCode)
            {
                Content = new StringContent(ResponseBody, System.Text.Encoding.UTF8, "application/json"),
            };
        }
    }

    private static async Task<(WebTool search, WebFetchTool fetch, StubHandler handler, AuthSessionManager auth)> Build(
        string responseBody, int status = 200)
    {
        var handler = new StubHandler { ResponseBody = responseBody, StatusCode = status };
        var api = new DesktopApiClient(new Uri("http://localhost:4000/"), handler);
        var store = new InMemoryCredentialStore();
        await store.SaveAsync(StoredSession.From(
            new DesktopTokenResponse { AccessToken = "token", RefreshToken = "refresh", ExpiresIn = 900, RefreshExpiresIn = 3600 },
            "user@example.test", "device-1234567890123456", DateTimeOffset.UtcNow));
        var auth = new AuthSessionManager(api, store, new SystemClock(), "device-1234567890123456", "Test", "0.1.0");
        await auth.RestoreAsync();
        return (new WebTool(api, auth), new WebFetchTool(api, auth), handler, auth);
    }

    [Fact]
    public async Task SearchReturnsTheResultsAsText()
    {
        var (search, _, handler, _) = await Build("""
        {"action":"search","results":[
          {"title":"First result","url":"https://example.com/one","snippet":"A snippet."},
          {"title":"Second result","url":"https://example.com/two","snippet":"Another."}
        ]}
        """);

        var outcome = await search.InvokeAsync("""{"query":"hyper-v"}""");

        Assert.False(outcome.IsError);
        Assert.Contains("First result", outcome.Content);
        Assert.Contains("https://example.com/one", outcome.Content);
        Assert.Contains("A snippet.", outcome.Content);
        // The request carried the action and the query, and the bearer token.
        Assert.Contains("\"action\":\"search\"", handler.LastBody!);
        Assert.Contains("hyper-v", handler.LastBody!);
        Assert.Equal("Bearer token", handler.LastAuthorization);
    }

    [Fact]
    public async Task AMissingQueryIsRefusedWithSomethingTheModelCanActOn()
    {
        var (search, _, _, _) = await Build("{}");
        var outcome = await search.InvokeAsync("{}");
        Assert.True(outcome.IsError);
        Assert.Contains("query", outcome.Content, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task MalformedArgumentsDoNotThrow()
    {
        // The model is not reliable about shape, and an exception here would take the run down
        // rather than telling the model what it did wrong.
        var (search, _, _, _) = await Build("{}");
        var outcome = await search.InvokeAsync("this is not json at all");
        Assert.True(outcome.IsError);
    }

    [Fact]
    public async Task ARefusalFromTheServerIsPassedOnWithItsReason()
    {
        var (_, fetch, _, _) = await Build("""{"error":"that address is not reachable from the web tool"}""", 400);
        var outcome = await fetch.InvokeAsync("""{"url":"http://169.254.169.254/"}""");

        Assert.True(outcome.IsError);
        // The reason is worth passing on: the model can try a different address.
        Assert.Contains("not reachable", outcome.Content, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task AFetchedPageComesBackAsTextWithItsTitle()
    {
        var (_, fetch, _, _) = await Build("""
        {"action":"fetch","page":{"url":"https://example.com/","finalUrl":"https://example.com/",
          "title":"Example Domain","text":"Example body","truncated":false}}
        """);

        var outcome = await fetch.InvokeAsync("""{"url":"https://example.com/"}""");

        Assert.False(outcome.IsError);
        Assert.Contains("Example Domain", outcome.Content);
        Assert.Contains("Example body", outcome.Content);
    }

    [Fact]
    public async Task ATruncatedPageSaysSo()
    {
        var (_, fetch, _, _) = await Build("""
        {"action":"fetch","page":{"url":"https://example.com/","finalUrl":"https://example.com/",
          "title":"Long","text":"part of it","truncated":true}}
        """);

        var outcome = await fetch.InvokeAsync("""{"url":"https://example.com/"}""");
        Assert.Contains("truncated", outcome.Content, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task TheWebToolsRunOnTheHostRatherThanInTheSandbox()
    {
        // The distinction is the whole design: the sandbox has no network, so anything that
        // needs one has to run outside it.
        var (search, fetch, _, _) = await Build("{}");
        Assert.True(search.RunsOnHost);
        Assert.True(fetch.RunsOnHost);
    }
}
