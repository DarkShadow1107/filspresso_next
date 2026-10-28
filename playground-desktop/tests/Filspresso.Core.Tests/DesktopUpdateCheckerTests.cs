using System;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class DesktopUpdateCheckerTests
{
    private static ApiResult<InstallerUpdate> Published(string version, bool allowed = true) =>
        ApiResult<InstallerUpdate>.Success(new() { Available = true, ProductVersion = version, CanDownload = allowed, Unsigned = true });

    [Fact]
    public async Task NewerPublishedVersionNotifiesWithoutDownloadPermissionAndWarnsAboutSigning()
    {
        var checks = 0;
        var checker = new DesktopUpdateChecker("0.3.4", _ => { checks++; return Task.FromResult(Published("0.3.5", false)); });
        await checker.RefreshAsync();
        Assert.True(checker.Snapshot.HasUpdate("0.3.4"));
        Assert.Contains("eligible account", checker.Snapshot.Message, StringComparison.Ordinal);
        Assert.Contains("unsigned", checker.Snapshot.Message, StringComparison.Ordinal);
        Assert.Equal(1, checks);
    }

    [Fact]
    public async Task OldPublishedPackageIsNotConfusedWithALocalCandidate()
    {
        var checker = new DesktopUpdateChecker("0.3.5", _ => Task.FromResult(Published("0.3.2")));
        await checker.RefreshAsync();
        Assert.False(checker.Snapshot.HasUpdate("0.3.5"));
        Assert.Contains("Installed 0.3.5 · published 0.3.2", checker.Snapshot.Message, StringComparison.Ordinal);
        Assert.Contains("candidates are not update releases", checker.Snapshot.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task PassiveChecksAreThrottledButManualChecksCanRetry()
    {
        var calls = 0;
        var checker = new DesktopUpdateChecker("0.3.4", _ => { calls++; return Task.FromResult(Published("0.3.5")); });
        await checker.RefreshAsync(); await checker.RefreshAsync();
        Assert.Equal(1, calls);
        await checker.RefreshAsync(force: true);
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task FailureIsVisibleRetryableAndNeverClaimsUpToDate()
    {
        var calls = 0;
        var checker = new DesktopUpdateChecker("0.3.4", _ => { calls++; throw new System.Net.Http.HttpRequestException("offline"); });
        await checker.RefreshAsync();
        Assert.Contains("unavailable", checker.Snapshot.Message, StringComparison.Ordinal);
        Assert.Null(checker.Snapshot.Package);
        Assert.False(checker.Snapshot.Checking);
        await checker.RefreshAsync(force: true);
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task ParallelChecksAreSingleFlightAndSignOutRejectsLateAccountResults()
    {
        var pending = new TaskCompletionSource<ApiResult<InstallerUpdate>>(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        var checker = new DesktopUpdateChecker("0.3.4", _ => { calls++; return pending.Task; });
        var first = checker.RefreshAsync();
        await checker.RefreshAsync(force: true);
        Assert.Equal(1, calls);
        checker.Clear();
        pending.SetResult(Published("0.3.5")); await first;
        Assert.Null(checker.Snapshot.Package);
        Assert.Contains("Sign in", checker.Snapshot.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("broken")]
    public async Task InvalidMetadataCannotInventAnUpdate(string? version)
    {
        var checker = new DesktopUpdateChecker("0.3.4", _ => Task.FromResult(Published(version!)));
        await checker.RefreshAsync();
        Assert.False(checker.Snapshot.HasUpdate("0.3.4"));
        Assert.Contains("could not be verified", checker.Snapshot.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CallerCancellationStopsAHangingAdapterWithoutAutomaticRetry()
    {
        var checker = new DesktopUpdateChecker("0.3.4", _ => new TaskCompletionSource<ApiResult<InstallerUpdate>>().Task);
        using var cancellation = new CancellationTokenSource();
        var check = checker.RefreshAsync(cancellationToken: cancellation.Token);
        cancellation.Cancel(); await check;
        Assert.False(checker.Snapshot.Checking); Assert.Null(checker.Snapshot.Package);
        Assert.Contains("retry", checker.Snapshot.Message, StringComparison.Ordinal);
    }
}
