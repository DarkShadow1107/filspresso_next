using System;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class DesktopInstallerUpdateWorkflowTests
{
    private sealed class FakeApi(byte[] bytes) : DesktopApiClient(new Uri("https://example.test/"))
    {
        public int Acks;
        public override Task<ApiResult<bool>> AcknowledgeInstallerUpdateAsync(string token, string version, CancellationToken cancellationToken = default)
        { Acks++; return Task.FromResult(ApiResult<bool>.Success(true)); }
        public override async Task<ApiResult<long>> DownloadInstallerUpdateAsync(string token, string path, long limit, IProgress<long>? progress = null, CancellationToken cancellationToken = default)
        { await File.WriteAllBytesAsync(path, bytes, cancellationToken); progress?.Report(bytes.Length); return ApiResult<long>.Success(bytes.Length); }
    }

    private sealed class FakeLauncher : IDesktopUpdateLauncher
    {
        public int Calls;
        public bool Start(string installerPath, string applicationPath, string journalPath, int parentProcessId)
        { Calls++; return File.Exists(installerPath); }
    }

    private sealed class FakeJournal : IDesktopUpdateJournal
    {
        public void Record(string stage, string? productVersion = null, string? detail = null) { }
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task OnlyMatchingDownloadedBytesAreHandedOff(bool matching)
    {
        var root = Path.Combine(Path.GetTempPath(), "Filspresso-update-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var application = Path.Combine(root, "app.exe");
            await File.WriteAllTextAsync(application, "test");
            byte[] body = [1, 2, 3, 4];
            using var api = new FakeApi(body);
            var launcher = new FakeLauncher();
            var workflow = new DesktopInstallerUpdateWorkflow(api, _ => Task.FromResult<string?>("token"), "0.3.6", root, application,
                Path.Combine(root, "journal.log"), new FakeJournal(), launcher);
            var package = new InstallerUpdate { Available = true, CanDownload = true, ProductVersion = "0.3.7", Bytes = body.Length,
                Sha256 = Convert.ToHexString(SHA256.HashData(matching ? body : [9, 8, 7])) };
            Assert.Equal(matching, await workflow.InstallAsync(package));
            Assert.Equal(1, api.Acks);
            Assert.Equal(matching ? 1 : 0, launcher.Calls);
            Assert.Equal(!matching, workflow.Snapshot.Failed);
            Assert.Empty(Directory.GetFiles(root, "*.part"));
            if (!matching) Assert.Empty(Directory.GetFiles(root, "*.msi"));
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
