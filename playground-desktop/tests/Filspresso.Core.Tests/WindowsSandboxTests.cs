using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Xml.Linq;
using Filspresso.Sandbox;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>Explicit fixtures, never used to issue Windows Sandbox qualification evidence.</summary>
public sealed class WindowsSandboxTests
{
    internal sealed class Cli(string root) : IWindowsSandboxCli
    {
        internal readonly List<string[]> Calls = new();
        internal readonly List<Guid> Inventory = new();
        internal Guid Id;
        internal bool FailStop, LoseStart;
        internal Func<string, string>? Reply;
        public Task<SandboxCliResult> RunAsync(IReadOnlyList<string> arguments, TimeSpan timeout, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested(); Calls.Add(arguments.ToArray());
            switch (arguments[0])
            {
                case "list": return Done(new { WindowsSandboxEnvironments = Inventory.Select(id => new { Id = id }).ToArray() });
                case "start":
                    Id = Guid.Parse(arguments[2]); Inventory.Add(Id);
                    if (LoseStart) throw new TimeoutException("Fixture ambiguous start");
                    return Done(new { Id });
                case "stop":
                    if (FailStop) return Task.FromResult(new SandboxCliResult(1, ""));
                    Inventory.Remove(Guid.Parse(arguments[2])); return Done(new { });
                case "exec":
                    var nonce = Regex.Match(arguments[^1], @"([a-f0-9]{32})\.ps1").Groups[1].Value;
                    var source = File.ReadAllText(Path.Combine(root, Id.ToString("N"), "input", nonce + ".ps1"));
                    var payload = Reply?.Invoke(source) ?? "{\"version\":1,\"ready\":true}";
                    File.WriteAllText(Path.Combine(root, Id.ToString("N"), "output", nonce + ".json"),
                        "{\"version\":1,\"nonce\":\"" + nonce + "\",\"ok\":true,\"payload\":" + payload + "}");
                    return Done(new { ExitCode = 0 });
                default: throw new InvalidOperationException("No host command executor exists in this fixture.");
            }
        }
        private static Task<SandboxCliResult> Done(object value) => Task.FromResult(new SandboxCliResult(0, JsonSerializer.Serialize(value)));
    }

    [Fact]
    public void ConfigurationDisablesHostIntegrationAndMapsOnlySeparateStagingFolders()
    {
        var root = Path.GetTempPath().TrimEnd('\\');
        var xml = XElement.Parse(WindowsSandboxConfiguration.Create(Path.Combine(root, "input&one"), Path.Combine(root, "output")));
        foreach (var setting in new[] { "Networking", "vGPU", "ClipboardRedirection", "AudioInput", "VideoInput", "PrinterRedirection" })
            Assert.Equal("Disable", xml.Element(setting)!.Value);
        Assert.Equal("Enable", xml.Element("ProtectedClient")!.Value);
        var maps = xml.Element("MappedFolders")!.Elements().ToArray(); Assert.Equal(2, maps.Length);
        Assert.Equal("true", maps[0].Element("ReadOnly")!.Value); Assert.Equal("false", maps[1].Element("ReadOnly")!.Value);
        Assert.Equal(Path.Combine(root, "input&one"), maps[0].Element("HostFolder")!.Value);
        Assert.Throws<ArgumentException>(() => WindowsSandboxConfiguration.Create(root, Path.Combine(root, "child")));
    }

    [Fact]
    public async Task NoCredentialsExplicitIdentityAndConfirmedStopAreRequired()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-wsb-fixture-");
        try
        {
            var cli = new Cli(root.FullName); var journal = new MemoryRecoveryJournal();
            using var sandbox = new WindowsSandbox(cli, root.FullName, journal);
            var session = await sandbox.StartAsync("fixture");
            Assert.Equal(cli.Id, session.Id); Assert.Single(journal.Read());
            Assert.Contains(cli.Calls, call => call[0] == "start" && call.Contains("--id"));
            Assert.All(cli.Calls, call => Assert.Contains(call[0], new[] { "list", "start", "exec", "stop" }));
            await Assert.ThrowsAsync<SandboxPolicyException>(() => sandbox.ReadFileAsync(session.Id, "../host.txt"));
            await sandbox.StopAsync(session.Id); Assert.Empty(journal.Read()); Assert.Empty(cli.Inventory);
            // A new session after discard does not inherit an already-cancelled lifetime.
            var next = await sandbox.StartAsync("fixture two"); Assert.NotEqual(session.Id, next.Id);
        }
        finally { root.Delete(true); }
    }

    [Fact]
    public async Task ForeignSandboxIsNeverAdoptedOrStopped()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-wsb-foreign-");
        try
        {
            var cli = new Cli(root.FullName); cli.Inventory.Add(Guid.NewGuid());
            using var sandbox = new WindowsSandbox(cli, root.FullName, new MemoryRecoveryJournal());
            await Assert.ThrowsAsync<SandboxPolicyException>(() => sandbox.StartAsync("fixture"));
            Assert.DoesNotContain(cli.Calls, call => call[0] is "stop" or "start" or "exec");
        }
        finally { root.Delete(true); }
    }

    [Fact]
    public async Task CleanupFailureRemainsRecordedAndCanBeRetriedWithoutStartingAnotherVm()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-wsb-cleanup-");
        try
        {
            var cli = new Cli(root.FullName); var journal = new MemoryRecoveryJournal();
            using var sandbox = new WindowsSandbox(cli, root.FullName, journal); var session = await sandbox.StartAsync("fixture");
            cli.FailStop = true;
            await Assert.ThrowsAsync<IOException>(() => sandbox.StopAsync(session.Id)); Assert.Single(journal.Read());
            await Assert.ThrowsAsync<SandboxPolicyException>(() => sandbox.StartAsync("no second VM"));
            cli.FailStop = false; await sandbox.StopAsync(session.Id); Assert.Empty(journal.Read());
        }
        finally { root.Delete(true); }
    }

    [Fact]
    public async Task LostCreationAcknowledgementCannotBeClearedByAnEmptyInventory()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-wsb-ambiguous-");
        try
        {
            var cli = new Cli(root.FullName) { LoseStart = true }; var journal = new MemoryRecoveryJournal();
            using (var sandbox = new WindowsSandbox(cli, root.FullName, journal)) await Assert.ThrowsAsync<TimeoutException>(() => sandbox.StartAsync("fixture"));
            Assert.Single(journal.Read()); Assert.Empty(cli.Inventory);
            using var recovery = new WindowsSandbox(cli, root.FullName, journal);
            await Assert.ThrowsAsync<IOException>(() => recovery.RecoverAsync()); Assert.Single(journal.Read());
        }
        finally { root.Delete(true); }
    }

    [Theory]
    [InlineData("{\"version\":1,\"bytes\":\"/w==\"}")]
    [InlineData("{\"version\":1,\"bytes\":\"YQ==\",\"bytes\":\"Yg==\"}")]
    [InlineData("{\"version\":1,\"bytes\":42}")]
    public async Task MalformedUntrustedFileRepliesDiscardTheVm(string reply)
    {
        var root = Directory.CreateTempSubdirectory("filspresso-wsb-reply-");
        try
        {
            var cli = new Cli(root.FullName); using var sandbox = new WindowsSandbox(cli, root.FullName, new MemoryRecoveryJournal());
            var session = await sandbox.StartAsync("fixture"); cli.Reply = _ => reply;
            await Assert.ThrowsAnyAsync<Exception>(() => sandbox.ReadFileAsync(session.Id, "src/test.txt"));
            Assert.Empty(await sandbox.ListAsync()); Assert.Empty(cli.Inventory);
        }
        finally { root.Delete(true); }
    }

    [Fact]
    public async Task SnapshotsReadBoundedGuestTextWithoutFollowingHostPaths()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-wsb-snapshot-");
        try
        {
            var cli = new Cli(root.FullName); using var sandbox = new WindowsSandbox(cli, root.FullName, new MemoryRecoveryJournal());
            var session = await sandbox.StartAsync("fixture");
            cli.Reply = _ => JsonSerializer.Serialize(new { version = 1, files = new[] { new { path = "src/main.cs", bytes = Convert.ToBase64String(Encoding.UTF8.GetBytes("generated")) } } });
            var files = await sandbox.CaptureAsync(session.Id, ["src/main.cs"]); Assert.Equal("generated", Assert.Single(files).Contents);
            cli.Reply = _ => "{\"version\":1,\"files\":[{\"path\":\"../host.txt\",\"bytes\":\"YQ==\"}]}";
            await Assert.ThrowsAsync<InvalidDataException>(() => sandbox.CaptureAsync(session.Id, [])); Assert.Empty(cli.Inventory);
        }
        finally { root.Delete(true); }
    }

    [Fact]
    public async Task ActualPowerShellParserAcceptsGuestWrapperAndSnapshotButNeverExecutesThemOnHost()
    {
        var script = WindowsSandboxScripts.Wrap(new string('a', 32), WindowsSandboxScripts.Snapshot(["src/main.cs"]));
        const string parse = """
            $request = [Console]::In.ReadLine() | ConvertFrom-Json
            $tokens = $null; $errors = $null
            [void][Management.Automation.Language.Parser]::ParseInput($request.source, [ref]$tokens, [ref]$errors)
            if ($errors.Count) { [Console]::Error.WriteLine(($errors | Out-String)); exit 1 }
            'PARSE_OK'
            """;
        var result = await new PowerShellRunner().RunWithInputAsync(parse, JsonSerializer.Serialize(new { source = script }), TimeSpan.FromSeconds(15));
        Assert.True(result.ExitCode == 0, result.Error); Assert.Contains("PARSE_OK", result.Output);
    }

    [Fact]
    public async Task NativeSnapshotComponentCapturesTextAndSkipsSecretsAndDependencyTrees()
    {
        // Fixed component probe in a new temporary directory, NOT a VM qualification,
        // model command, build script or host-execution fallback.
        var root = Directory.CreateTempSubdirectory("filspresso-snapshot-component-");
        try
        {
            foreach (var directory in new[] { "input", "output", "broker", "workspace", "workspace/node_modules", "workspace/src" })
                Directory.CreateDirectory(Path.Combine(root.FullName, directory));
            File.WriteAllText(Path.Combine(root.FullName, "input", "boundary.cs"), HyperVGuestScripts.BoundarySource);
            File.WriteAllText(Path.Combine(root.FullName, "workspace", "src", "main.cs"), "source 界", new UTF8Encoding(false));
            File.WriteAllText(Path.Combine(root.FullName, "workspace", ".env"), "secret");
            File.WriteAllText(Path.Combine(root.FullName, "workspace", "node_modules", "dependency.js"), "skip");
            File.WriteAllText(Path.Combine(root.FullName, "workspace", "README"), "tracked extensionless");
            var nonce = new string('b', 32);
            var script = WindowsSandboxScripts.Wrap(nonce, WindowsSandboxScripts.Snapshot(["README"]));
            foreach (var pair in new[] { ("C:\\filspresso-in", "input"), ("C:\\filspresso-out", "output"), ("C:\\filspresso-broker", "broker"), ("C:\\filspresso-workspace", "workspace") })
                script = script.Replace(pair.Item1, Path.Combine(root.FullName, pair.Item2).Replace("'", "''"), StringComparison.Ordinal);
            const string bootstrap = """
                $request = [Console]::In.ReadLine() | ConvertFrom-Json
                & ([ScriptBlock]::Create($request.source))
                """;
            var result = await new PowerShellRunner().RunWithInputAsync(bootstrap, JsonSerializer.Serialize(new { source = script }), TimeSpan.FromSeconds(30));
            Assert.True(result.ExitCode == 0, result.Error);
            using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(root.FullName, "output", nonce + ".json")));
            Assert.True(document.RootElement.GetProperty("ok").GetBoolean());
            var files = document.RootElement.GetProperty("payload").GetProperty("files").EnumerateArray().Select(item => item.GetProperty("path").GetString()).Order().ToArray();
            Assert.Equal(new[] { "README", "src/main.cs" }, files);
            Assert.True(File.Exists(Path.Combine(root.FullName, "broker", "Boundary.dll")));
        }
        finally { root.Delete(true); }
    }
}
