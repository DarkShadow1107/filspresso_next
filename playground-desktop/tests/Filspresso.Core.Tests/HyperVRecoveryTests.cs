using System;
using System.IO;
using System.Security.Cryptography;
using System.Threading.Tasks;
using Filspresso.Sandbox;
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class HyperVRecoveryTests
{
    [Fact]
    public async Task DurableIntentSurvivesAnotherObjectAndRecoversBeforeNewWork()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-recovery-");
        try
        {
            var journal = new HyperVRecoveryJournal(root.FullName);
            var id = Guid.NewGuid();
            using (journal.Acquire()) journal.Add(new(id, "filspresso-" + id.ToString("N"), "Filspresso.v3." + id.ToString("N")));
            var runner = new StubHyperVRunner();
            using var recovered = new HyperVSandbox(runner, @"C:\base\windows.vhdx", root.FullName,
                credentials: new FixtureGuestCredentials());
            await recovered.RecoverAsync();
            var teardown = Assert.Single(runner.HostScripts);
            Assert.Contains(id.ToString("N"), teardown);
            Assert.Contains("Foreign VM disk; refusing recovery", teardown);
            Assert.Contains("Foreign VM marker", teardown);
            Assert.Empty(journal.Read()); Assert.Empty(await recovered.ListAsync());
        }
        finally { root.Delete(true); }
    }

    [Fact]
    public void ActiveOwnerAndTamperedInventoryCannotBeReclaimed()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-recovery-auth-");
        try
        {
            var journal = new HyperVRecoveryJournal(root.FullName);
            var id = Guid.NewGuid();
            using (journal.Acquire())
            {
                Assert.Throws<IOException>(() => new HyperVRecoveryJournal(root.FullName).Acquire());
                journal.Add(new(id, "filspresso-" + id.ToString("N"), "Filspresso.v3." + id.ToString("N")));
            }
            var path = Path.Combine(root.FullName, id.ToString("N") + ".intent");
            var bytes = File.ReadAllBytes(path); bytes[^1] ^= 1; File.WriteAllBytes(path, bytes);
            using (journal.Acquire()) Assert.Throws<CryptographicException>(() => journal.Read());
            Assert.True(File.Exists(path));
        }
        finally { root.Delete(true); }
    }

    [Fact]
    public async Task MissingDescendantCleanupProofAlwaysDiscards()
    {
        var runner = new StubHyperVRunner { OnOperation = (_, _) => StubHyperVRunner.Reply("{\"version\":1,\"exitCode\":0,\"stdout\":\"ok\",\"stderr\":\"\",\"timedOut\":false,\"outputLimited\":false,\"descendantsClean\":false}") };
        using var sandbox = runner.Sandbox(); var session = await sandbox.StartAsync("fixture");
        await Assert.ThrowsAsync<InvalidOperationException>(() => sandbox.RunAsync(session.Id, "echo", "fixture"));
        Assert.Empty(await sandbox.ListAsync());
    }
}
