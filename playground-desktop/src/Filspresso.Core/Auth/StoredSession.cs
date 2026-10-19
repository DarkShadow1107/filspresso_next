using System;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;

namespace Filspresso.Core.Auth;

/// <summary>
/// A signed-in session, as it is kept between runs.
/// </summary>
/// <remarks>
/// This is the whole of the application's persistent secret. Everything else — the entitlement,
/// the model catalogue, the allowance — is re-fetched from the server on every launch,
/// because all of it can change while the application is closed and none of it is worth
/// trusting from disk.
/// <para>
/// The refresh token is long-lived (30 days by default) and the access token is not (15
/// minutes). Persisting both is what makes "open the app tomorrow" work; persisting only the
/// access token would sign the user out every fifteen minutes.
/// </para>
/// </remarks>
public sealed record StoredSession
{
    /// <summary>The access token, sent as a bearer on every call.</summary>
    public required string AccessToken { get; init; }

    /// <summary>
    /// The refresh token. Rotated on every use, so the copy held here goes stale the moment
    /// it is spent and must be replaced from the refresh response.
    /// </summary>
    public required string RefreshToken { get; init; }

    /// <summary>When the access token stops working.</summary>
    public required DateTimeOffset AccessTokenExpiresAt { get; init; }

    /// <summary>When the refresh token stops working, after which re-authentication is required.</summary>
    public required DateTimeOffset RefreshTokenExpiresAt { get; init; }

    public required string Email { get; init; }

    /// <summary>
    /// The stable id of this machine, as the server knows it.
    /// </summary>
    /// <remarks>
    /// Sent on the grant so the sessions list can name this device and so the server can key
    /// its throttle on the account rather than the address. It is per machine, not per install
    /// or per user: two people signing in on one PC are two sessions on one device, which is
    /// what a user means by "my computer".
    /// </remarks>
    public required string DeviceId { get; init; }

    public string? AccountName { get; init; }

    /// <summary>
    /// Whether the refresh token can still be used. Checked before every refresh so a long-dead
    /// session fails as "sign in again" rather than as a mysterious network error.
    /// </summary>
    public bool CanRefresh(DateTimeOffset now) => now < RefreshTokenExpiresAt;

    public bool IsAccessTokenValid(DateTimeOffset now) => now < AccessTokenExpiresAt;

    /// <param name="now">
    /// The current time, supplied by the caller rather than read here.
    /// </param>
    /// <remarks>
    /// The parameter exists because the manager decides expiry against an injected clock, and
    /// reading the wall clock inside this factory quietly introduced a second, unrelated notion
    /// of time: sessions were stamped in real time and compared against a test clock, so no
    /// refresh policy could be exercised at all. Taking the time as an argument keeps this a
    /// pure function of its inputs.
    /// </remarks>
    public static StoredSession From(
        DesktopTokenResponse response,
        string email,
        string deviceId,
        DateTimeOffset now) => new()
    {
        AccessToken = response.AccessToken,
        RefreshToken = response.RefreshToken,
        // Computed from the server's stated lifetimes rather than parsed out of the JWT.
        //
        // The server clamps the real lifetime, and a client that read its own `exp` claim would
        // disagree with the server about when the token dies -- always in the direction of
        // using it one request too late.
        AccessTokenExpiresAt = now.AddSeconds(response.ExpiresIn),
        RefreshTokenExpiresAt = now.AddSeconds(response.RefreshExpiresIn),
        Email = email,
        DeviceId = deviceId,
        AccountName = response.Account?.Username,
    };
}

/// <summary>
/// Where a session is kept between runs.
/// </summary>
/// <remarks>
/// An interface, and deliberately not a file path, because "where do the tokens live" is the
/// most security-relevant decision in a desktop client and it needs one answer rather than a
/// file path per implementation. The Windows implementation uses Credential Manager with
/// DPAPI; a Linux or macOS port would use the keychain and this interface is the seam.
/// </remarks>
public interface ICredentialStore
{
    Task<StoredSession?> LoadAsync(CancellationToken cancellationToken = default);

    Task SaveAsync(StoredSession session, CancellationToken cancellationToken = default);

    /// <summary>Removes the session. Must succeed even when there is nothing stored.</summary>
    Task ClearAsync(CancellationToken cancellationToken = default);
}

/// <summary>An in-memory store, for tests and for a session that must not persist.</summary>
public sealed class InMemoryCredentialStore : ICredentialStore
{
    private StoredSession? _session;

    public Task<StoredSession?> LoadAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(_session);

    public Task SaveAsync(StoredSession session, CancellationToken cancellationToken = default)
    {
        _session = session;
        return Task.CompletedTask;
    }

    public Task ClearAsync(CancellationToken cancellationToken = default)
    {
        _session = null;
        return Task.CompletedTask;
    }
}