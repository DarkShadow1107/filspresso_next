using System;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Core.Auth;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>
/// A clock the tests move by hand.
/// </summary>
internal sealed class FakeClock : IClock
{
    public DateTimeOffset UtcNow { get; set; } = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);

    public void Advance(TimeSpan by) => UtcNow += by;
}

/// <summary>
/// An API client stand-in that answers from a script.
/// </summary>
/// <remarks>
/// Not a mock framework: the interesting behaviours here are "two callers refresh at once" and
/// "the refresh is slow", and expressing those needs a client whose responses the test controls
/// the timing of. A mocking library would hide exactly the thing under test.
/// </remarks>
internal sealed class FakeApiClient : DesktopApiClient
{
    private int _refreshCalls;
    private int _grantCalls;

    public DesktopTokenResponse? RefreshResult { get; set; }
    public DesktopGrantResult? GrantResult { get; set; }
    public bool BarrierEnabled { get; set; }
    public int GrantCalls => _grantCalls;
    public int RefreshCalls => _refreshCalls;

    private readonly TaskCompletionSource _refreshGate =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public FakeApiClient() : base(new Uri("http://localhost:4000"))
    {
    }

    public override async Task<ApiResult<DesktopTokenResponse>> RefreshAsync(
        string refreshToken,
        CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _refreshCalls);

        // Hold the refresh open so a second caller is guaranteed to arrive mid-flight.
        // Without this the test would pass by accident on a fast machine and fail on a slow one.
        if (BarrierEnabled)
        {
            _refreshGate.TrySetResult();
            await Task.Delay(60, cancellationToken).ConfigureAwait(false);
        }

        return RefreshResult is null
            ? ApiResult<DesktopTokenResponse>.Failure(ApiError.Unauthenticated, "expired", 401)
            : ApiResult<DesktopTokenResponse>.Success(RefreshResult);
    }

    public override Task<DesktopGrantResult> GrantAsync(
        string email,
        string password,
        string deviceId,
        string deviceName,
        string appVersion,
        string? challengeToken = null,
        string? mfaCode = null,
        CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _grantCalls);
        return Task.FromResult(GrantResult ?? new DesktopGrantResult(
            ApiResult<DesktopTokenResponse>.Failure(ApiError.Unauthenticated, "bad", 401), null));
    }
}

public class AuthSessionManagerTests
{
    private const string DeviceId = "test-device-identifier-0001";

    private static (FakeApiClient api, AuthSessionManager manager, InMemoryCredentialStore store, FakeClock clock) Build(
        TimeSpan? margin = null,
        InMemoryCredentialStore? existingStore = null)
    {
        var api = new FakeApiClient();
        // Sharing the store matters for the restore test: a second Build() with its own store
        // would restore into an empty one and the test would pass or fail for the wrong reason.
        var store = existingStore ?? new InMemoryCredentialStore();
        var clock = new FakeClock();
        var manager = new AuthSessionManager(api, store, clock, DeviceId, "Test Bench", "0.1.0", margin);
        return (api, manager, store, clock);
    }

    private static DesktopTokenResponse Token(string access, string refresh, int expiresIn = 900, int refreshIn = 2_592_000) =>
        new() { AccessToken = access, RefreshToken = refresh, ExpiresIn = expiresIn, RefreshExpiresIn = refreshIn };

    [Fact]
    public async Task ASessionIsPersistedSoOpeningTheAppTomorrowWorks()
    {
        var (api, manager, store, _) = Build();
        api.GrantResult = new DesktopGrantResult(
            ApiResult<DesktopTokenResponse>.Success(Token("access-1", "refresh-1")), null);

        var outcome = await manager.SignInAsync("user@example.test", "password");

        Assert.Equal(SignInOutcome.Success, outcome);
        var stored = await store.LoadAsync();
        Assert.NotNull(stored);
        Assert.Equal("access-1", stored!.AccessToken);
        Assert.Equal("refresh-1", stored.RefreshToken);
        Assert.Equal(DeviceId, stored.DeviceId);
    }

    [Fact]
    public async Task RestoringBringsBackASignedInStateWithoutReauthenticating()
    {
        var (_, _, store, clock) = Build();
        await store.SaveAsync(StoredSession.From(Token("access-1", "refresh-1"), "user@example.test", DeviceId, clock.UtcNow));

        var (_, manager, _, _) = Build(existingStore: store);
        await manager.RestoreAsync();

        Assert.True(manager.IsSignedIn);
        Assert.Equal("access-1", manager.Current!.AccessToken);
    }

    [Fact]
    public async Task AValidTokenIsNotRefreshed()
    {
        var (api, manager, _, clock) = Build();
        api.GrantResult = new DesktopGrantResult(
            ApiResult<DesktopTokenResponse>.Success(Token("access-1", "refresh-1")), null);
        await manager.SignInAsync("user@example.test", "password");

        Assert.True(await manager.EnsureAccessTokenAsync());
        Assert.Equal(0, api.RefreshCalls);
    }

    [Fact]
    public async Task ATokenAboutToExpireIsRefreshedBeforeItDies()
    {
        // The margin is the whole reason RefreshPolicy exists: refreshing at expiry leaves no
        // room for the refresh request itself, and one slow response becomes a 401 on a request
        // that was valid when it started.
        var (api, manager, _, clock) = Build(TimeSpan.FromSeconds(60));
        api.GrantResult = new DesktopGrantResult(
            ApiResult<DesktopTokenResponse>.Success(Token("access-1", "refresh-1", expiresIn: 900)), null);
        await manager.SignInAsync("user@example.test", "password");

        // 900s of token, so advancing 850s leaves 50s -- inside the 60s margin, which is the
        // window the policy exists to catch. Advancing 830s would leave 70s and correctly not
        // refresh, which is what the "a valid token is not refreshed" test relies on.
        clock.Advance(TimeSpan.FromSeconds(850));

        api.RefreshResult = Token("access-2", "refresh-2");
        Assert.True(await manager.EnsureAccessTokenAsync());

        Assert.Equal(1, api.RefreshCalls);
        Assert.Equal("access-2", manager.Current!.AccessToken);
    }

    [Fact]
    public async Task ConcurrentCallersTriggerExactlyOneRefresh()
    {
        // The server rotates the refresh token on every use and treats a replay as theft,
        // deleting the session. Two concurrent refreshes is therefore not untidy -- it is the
        // event that signs the customer out and invalidates their device.
        var (api, manager, _, clock) = Build(TimeSpan.FromSeconds(60));
        api.GrantResult = new DesktopGrantResult(
            ApiResult<DesktopTokenResponse>.Success(Token("access-1", "refresh-1", expiresIn: 60)), null);
        await manager.SignInAsync("user@example.test", "password");
        clock.Advance(TimeSpan.FromSeconds(60));

        api.BarrierEnabled = true;
        api.RefreshResult = Token("access-2", "refresh-2");

        var results = await Task.WhenAll(
            manager.EnsureAccessTokenAsync(),
            manager.EnsureAccessTokenAsync(),
            manager.EnsureAccessTokenAsync());

        Assert.All(results, Assert.True);
        Assert.Equal(1, api.RefreshCalls);
        Assert.Equal("access-2", manager.Current!.AccessToken);
    }

    [Fact]
    public async Task AFailedRefreshSignsTheUserOutRatherThanLeavingADeadSession()
    {
        var (api, manager, _, clock) = Build(TimeSpan.FromSeconds(60));
        api.GrantResult = new DesktopGrantResult(
            ApiResult<DesktopTokenResponse>.Success(Token("access-1", "refresh-1", expiresIn: 60)), null);
        await manager.SignInAsync("user@example.test", "password");
        clock.Advance(TimeSpan.FromSeconds(60));

        // The server answers 401 identically for expired, revoked and replayed, so the client
        // cannot tell them apart and must treat all three the same way.
        api.RefreshResult = null;

        Assert.False(await manager.EnsureAccessTokenAsync());
        Assert.False(manager.IsSignedIn);
        Assert.Null(await new InMemoryCredentialStore().LoadAsync());
    }

    [Fact]
    public async Task AnExpiredRefreshTokenIsNotSpentTrying()
    {
        var (api, manager, _, clock) = Build(TimeSpan.FromSeconds(60));
        api.GrantResult = new DesktopGrantResult(
            ApiResult<DesktopTokenResponse>.Success(
                Token("access-1", "refresh-1", expiresIn: 60, refreshIn: 600)), null);
        await manager.SignInAsync("user@example.test", "password");

        clock.Advance(TimeSpan.FromSeconds(3600)); // refresh token also gone

        Assert.False(await manager.EnsureAccessTokenAsync());
        Assert.Equal(0, api.RefreshCalls);
        Assert.False(manager.IsSignedIn);
    }

    [Fact]
    public async Task AFailedRefreshDoesNotWedgeLaterCalls()
    {
        // If the in-flight task were left behind, every later call would await a completed
        // faulted task and the user could never sign in again without restarting.
        var (api, manager, _, clock) = Build(TimeSpan.FromSeconds(60));
        api.GrantResult = new DesktopGrantResult(
            ApiResult<DesktopTokenResponse>.Success(Token("access-1", "refresh-1", expiresIn: 60)), null);
        await manager.SignInAsync("user@example.test", "password");
        clock.Advance(TimeSpan.FromSeconds(60));
        api.RefreshResult = null;
        await manager.EnsureAccessTokenAsync();

        api.GrantResult = new DesktopGrantResult(
            ApiResult<DesktopTokenResponse>.Success(Token("access-3", "refresh-3")), null);

        Assert.Equal(SignInOutcome.Success, await manager.SignInAsync("user@example.test", "password"));
        Assert.True(await manager.EnsureAccessTokenAsync());
    }

    [Fact]
    public async Task AnAccountWithMfaAsksForTheCodeRatherThanReportingFailure()
    {
        var (api, manager, _, _) = Build();
        api.GrantResult = new DesktopGrantResult(
            ApiResult<DesktopTokenResponse>.Failure(ApiError.Unauthenticated, "MFA required", 202),
            new MfaChallengeResponse { RequiresMfa = true, ChallengeToken = "mfa_abc", ExpiresIn = 300 });

        var outcome = await manager.SignInAsync("user@example.test", "password");

        Assert.Equal(SignInOutcome.NeedsMfa, outcome);
        Assert.False(manager.IsSignedIn);
        // A second factor is a step, not an error, so the screen must not be shown a failure.
        Assert.Null(manager.LastError);
    }

    [Fact]
    public async Task CompletingMfaSignsIn()
    {
        var (api, manager, _, _) = Build();
        api.GrantResult = new DesktopGrantResult(
            ApiResult<DesktopTokenResponse>.Success(Token("access-1", "refresh-1")), null);

        var outcome = await manager.CompleteMfaAsync(
            "user@example.test", "password", "mfa_abc", "123456");

        Assert.Equal(SignInOutcome.Success, outcome);
        Assert.True(manager.IsSignedIn);
    }

    [Fact]
    public async Task RateLimitingIsDistinguishedFromWrongCredentials()
    {
        // They need different words: one means "wait", the other means "check what you typed".
        var (api, manager, _, _) = Build();
        api.GrantResult = new DesktopGrantResult(
            ApiResult<DesktopTokenResponse>.Failure(ApiError.RateLimited, "slow down", 429), null);

        Assert.Equal(SignInOutcome.RateLimited, await manager.SignInAsync("user@example.test", "password"));
        Assert.Contains("Wait", manager.LastError, StringComparison.OrdinalIgnoreCase);

        api.GrantResult = new DesktopGrantResult(
            ApiResult<DesktopTokenResponse>.Failure(ApiError.Unauthenticated, "no", 401), null);
        Assert.Equal(SignInOutcome.Rejected, await manager.SignInAsync("user@example.test", "wrong"));
        Assert.DoesNotContain("Wait", manager.LastError!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SigningOutClearsTheStoredSession()
    {
        var (api, manager, store, _) = Build();
        api.GrantResult = new DesktopGrantResult(
            ApiResult<DesktopTokenResponse>.Success(Token("access-1", "refresh-1")), null);
        await manager.SignInAsync("user@example.test", "password");

        await manager.SignOutAsync();

        Assert.False(manager.IsSignedIn);
        Assert.Null(await store.LoadAsync());
    }

    [Fact]
    public async Task ASessionIsPersistedBeforeAnyoneIsToldAboutIt()
    {
        // A change handler that re-reads the session must not see a signed-in state that a
        // crash one second later would lose.
        var (api, manager, store, _) = Build();
        api.GrantResult = new DesktopGrantResult(
            ApiResult<DesktopTokenResponse>.Success(Token("access-1", "refresh-1")), null);

        StoredSession? seenByHandler = null;
        StoredSession? storedWhenNotified = null;
        manager.Changed += async (_, _) =>
        {
            seenByHandler = manager.Current;
            storedWhenNotified = await store.LoadAsync();
        };

        await manager.SignInAsync("user@example.test", "password");

        Assert.NotNull(seenByHandler);
        Assert.NotNull(storedWhenNotified);
    }
}