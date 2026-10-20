using System;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;

namespace Filspresso.Core.Auth;

/// <summary>A clock the session manager can be tested against.</summary>
public interface IClock
{
    DateTimeOffset UtcNow { get; }
}

public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}

/// <summary>How far ahead of expiry a token is refreshed.</summary>
/// <remarks>
/// The margin is the point of the whole type. A 15-minute token refreshed *at* expiry leaves
/// no room: the refresh request itself races the token it is replacing, and one slow response
/// produces a 401 on a request that was perfectly valid when it started. Refreshing a minute
/// early costs nothing and removes the race.
/// </remarks>
public static class RefreshPolicy
{
    public static readonly TimeSpan DefaultMargin = TimeSpan.FromSeconds(60);

    public static bool ShouldRefresh(StoredSession session, DateTimeOffset now, TimeSpan margin) =>
        // Also refresh an already-expired token, so a session restored from disk with a stale
        // access token refreshes rather than failing its first request.
        now.Add(margin) >= session.AccessTokenExpiresAt;
}

/// <summary>What the interface the UI binds to reports.</summary>
public interface IAuthSession
{
    /// <summary>The current session, or null when signed out.</summary>
    StoredSession? Current { get; }

    bool IsSignedIn { get; }

    /// <summary>Why the last sign-in attempt ended, for the screen to show.</summary>
    string? LastError { get; }

    /// <summary>
    /// The challenge token from a sign-in the server paused for a second factor, or null.
    /// </summary>
    /// <remarks>
    /// Held here rather than passed between the screen's two states by the caller. It is
    /// server state with a five-minute life, and threading it through a UI field means the
    /// sign-in flow has two sources of truth for it — which is how a screen ends up
    /// submitting a challenge against the wrong account after the user goes back.
    /// </remarks>
    string? PendingMfaChallenge { get; }

    /// <summary>Raised whenever the session changes, so the UI can re-render.</summary>
    event EventHandler? Changed;

    /// <summary>
    /// Returns a usable access token, refreshing first if it is close to expiry.
    /// </summary>
    /// <returns>False when the user must sign in again.</returns>
    Task<bool> EnsureAccessTokenAsync(CancellationToken cancellationToken = default);

    Task<SignInOutcome> SignInAsync(
        string email,
        string password,
        CancellationToken cancellationToken = default);

    /// <summary>Completes a sign-in that the server paused for a second factor.</summary>
    Task<SignInOutcome> CompleteMfaAsync(
        string email,
        string password,
        string challengeToken,
        string code,
        CancellationToken cancellationToken = default);

    Task SignOutAsync(CancellationToken cancellationToken = default);
}

public enum SignInOutcome
{
    Success,

    /// <summary>The account has a second factor. Not a failure, and not a success.</summary>
    NeedsMfa,

    /// <summary>The credentials were wrong.</summary>
    Rejected,

    /// <summary>Too many attempts. Distinct from Rejected, because waiting helps.</summary>
    RateLimited,

    /// <summary>The server could not be reached.</summary>
    Unreachable,
}

/// <summary>
/// Owns the session: signs in, keeps the access token fresh, signs out.
/// </summary>
/// <remarks>
/// One rule here is worth more than the rest. <b>Refresh is single-flight.</b>
/// <para>
/// The application polls entitlement after every generation and on window focus, so several
/// calls can want a token at the same instant. Without a gate, each of them sees an expired
/// token and each starts a refresh — and because the server <i>rotates</i> the refresh token
/// on every use, the first response invalidates the token the other two are using. Two of them
/// then get a 401, and the naive client treats that as "session gone" and signs the user out
/// mid-work.
/// </para>
/// <para>
/// A refresh token that is presented twice is treated by the server as theft and the session is
/// deleted. So this is not a tidy-up; concurrent refresh is the exact event that logs the
/// customer out and invalidates their device.
/// </para>
/// </remarks>
public sealed class AuthSessionManager : IAuthSession
{
    private readonly DesktopApiClient _api;
    private readonly ICredentialStore _store;
    private readonly IClock _clock;
    private readonly string _deviceId;
    private readonly string _deviceName;
    private readonly string _appVersion;
    private readonly TimeSpan _margin;

    /// <summary>
    /// The in-flight refresh, shared by every caller. Deliberately an instance field holding a
    /// <see cref="Task{TResult}"/> rather than a lock, so that N callers await the same
    /// operation instead of N of them queueing behind it and then refreshing in turn anyway.
    /// </summary>
    /// <summary>
    /// The refresh gate.
    /// </summary>
    /// <remarks>
    /// A semaphore rather than a shared in-flight task, because a shared task has a race in
    /// it: two callers both read "no refresh running" before either starts one, and both
    /// refresh. The server <i>rotates</i> the refresh token on every use and treats a replay
    /// as theft, deleting the session — so a double refresh is not untidy, it is exactly the
    /// event that signs the customer out and invalidates their device.
    /// <para>
    /// The expiry check is inside the gate for the same reason. Checked outside, two callers
    /// would both see an expiring token and both queue a refresh; the second would spend a
    /// refresh token the first had already replaced.
    /// </para>
    /// </remarks>
    private readonly SemaphoreSlim _refreshGate = new(1, 1);

    public AuthSessionManager(
        DesktopApiClient api,
        ICredentialStore store,
        IClock clock,
        string deviceId,
        string deviceName,
        string appVersion,
        TimeSpan? refreshMargin = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);

        _api = api;
        _store = store;
        _clock = clock;
        _deviceId = deviceId;
        _deviceName = deviceName;
        _appVersion = appVersion;
        _margin = refreshMargin ?? RefreshPolicy.DefaultMargin;
    }

    public StoredSession? Current { get; private set; }

    public bool IsSignedIn => Current is not null;

    public string? LastError { get; private set; }

    /// <inheritdoc />
    public string? PendingMfaChallenge { get; private set; }

    public event EventHandler? Changed;

    /// <summary>Restores a session saved by a previous run, if there is one.</summary>
    public async Task RestoreAsync(CancellationToken cancellationToken = default)
    {
        var stored = await _store.LoadAsync(cancellationToken).ConfigureAwait(false);
        if (stored is null)
        {
            return;
        }

        Current = stored;
        RaiseChanged();
    }

    public async Task<SignInOutcome> SignInAsync(
        string email,
        string password,
        CancellationToken cancellationToken = default) =>
        await GrantAsync(email, password, null, null, cancellationToken).ConfigureAwait(false);

    public async Task<SignInOutcome> CompleteMfaAsync(
        string email,
        string password,
        string challengeToken,
        string code,
        CancellationToken cancellationToken = default) =>
        await GrantAsync(email, password, challengeToken, code, cancellationToken).ConfigureAwait(false);

    private async Task<SignInOutcome> GrantAsync(
        string email,
        string password,
        string? challengeToken,
        string? mfaCode,
        CancellationToken cancellationToken)
    {
        var grant = await _api
            .GrantAsync(email, password, _deviceId, _deviceName, _appVersion, challengeToken, mfaCode, cancellationToken)
            .ConfigureAwait(false);

        if (grant.MfaChallenge is { RequiresMfa: true })
        {
            // Not an error state, and deliberately not surfaced through LastError: the screen
            // shows the second factor rather than a failure message.
            PendingMfaChallenge = grant.MfaChallenge.ChallengeToken;
            return SignInOutcome.NeedsMfa;
        }

        if (!grant.Result.Ok || grant.Result.Value is null)
        {
            LastError = Describe(grant.Result);
            RaiseChanged();
            return ToOutcome(grant.Result.Error);
        }

        await AdoptAsync(grant.Result.Value, email, cancellationToken).ConfigureAwait(false);
        return SignInOutcome.Success;
    }

    public async Task<bool> EnsureAccessTokenAsync(CancellationToken cancellationToken = default)
    {
        await _refreshGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var session = Current;
            if (session is null)
            {
                return false;
            }

            if (!RefreshPolicy.ShouldRefresh(session, _clock.UtcNow, _margin))
            {
                return true;
            }

            return await RefreshAsync(session, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            // Released in a finally so a throwing refresh cannot wedge every later call
            // behind a held gate.
            _refreshGate.Release();
        }
    }

    private async Task<bool> RefreshAsync(StoredSession session, CancellationToken cancellationToken)
    {
        if (!session.CanRefresh(_clock.UtcNow))
        {
            // The refresh token itself has expired. Nothing to try; the user signs in again.
            await SignOutAsync(cancellationToken).ConfigureAwait(false);
            LastError = "Your session expired. Sign in again.";
            RaiseChanged();
            return false;
        }

        var result = await _api.RefreshAsync(session.RefreshToken, cancellationToken).ConfigureAwait(false);

        // If another caller signed us out while this was in flight, its decision stands.
        if (!ReferenceEquals(Current, session))
        {
            return Current?.IsAccessTokenValid(_clock.UtcNow) ?? false;
        }

        if (!result.Ok || result.Value is null)
        {
            // A 401 means the session is gone: expired, revoked, or replayed. The server
            // answers all three the same way and the client cannot tell them apart, so all
            // three mean the same thing here -- sign in again.
            //
            // Anything else is our problem, not the user's. A network failure must not sign
            // the customer out of a working application.
            if (result.Error == ApiError.Unauthenticated)
            {
                await SignOutAsync(cancellationToken).ConfigureAwait(false);
                LastError = "Your session ended. Sign in again.";
            }
            else
            {
                LastError = "Could not renew the session. Try again shortly.";
            }

            RaiseChanged();
            return false;
        }

        await AdoptAsync(result.Value, session.Email, cancellationToken).ConfigureAwait(false);
        return true;
    }

    private async Task AdoptAsync(DesktopTokenResponse response, string email, CancellationToken cancellationToken)
    {
        var stored = StoredSession.From(response, email, _deviceId, _clock.UtcNow);
        Current = stored;
        LastError = null;

        // Cleared on success. A stale challenge left here would let a later sign-in skip the
        // second factor by presenting it instead of re-authenticating.
        PendingMfaChallenge = null;

        // Persisted before the change event fires, so a handler that immediately re-reads the
        // session cannot see a signed-in state that would be lost on a crash a second later.
        await _store.SaveAsync(stored, cancellationToken).ConfigureAwait(false);
        RaiseChanged();
    }

    public async Task SignOutAsync(CancellationToken cancellationToken = default)
    {
        Current = null;
        await _store.ClearAsync(cancellationToken).ConfigureAwait(false);
        RaiseChanged();
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);

    private static SignInOutcome ToOutcome(ApiError error) => error switch
    {
        ApiError.RateLimited => SignInOutcome.RateLimited,
        ApiError.Unexpected => SignInOutcome.Unreachable,
        _ => SignInOutcome.Rejected,
    };

    private static string Describe(ApiResult<DesktopTokenResponse> result) => result.Error switch
    {
        ApiError.Unauthenticated => "That email and password do not match an account.",
        ApiError.RateLimited => "Too many attempts. Wait a few minutes and try again.",
        ApiError.Unexpected => "Could not reach Filspresso. Check your connection and try again.",
        _ => "Sign-in failed.",
    };
}