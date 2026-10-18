using System.Text.Json.Serialization;

namespace Filspresso.Core.Api;

/// <summary>
/// The answer to <c>POST /api/auth/desktop/token</c> and <c>.../refresh</c>.
/// </summary>
/// <remarks>
/// This is the only credential the application ever holds in memory outside the vault, and
/// the reason the device grant exists at all: the web login hands back an httpOnly cookie,
/// which a desktop process cannot read. See <c>PLAN_PLAYGROUND_APP.md</c>, section 0.1.
/// <para>
/// The token is short-lived by design. <c>ExpiresIn</c> is authoritative rather than being
/// read back out of the JWT, because the server clamps the real lifetime and a client that
/// trusted its own parse of the token would drift out of step with it.
/// </para>
/// </remarks>
public sealed record DesktopTokenResponse
{
    [JsonPropertyName("accessToken")]
    public string AccessToken { get; init; } = string.Empty;

    [JsonPropertyName("refreshToken")]
    public string RefreshToken { get; init; } = string.Empty;

    [JsonPropertyName("expiresIn")]
    public int ExpiresIn { get; init; }

    [JsonPropertyName("refreshExpiresIn")]
    public int RefreshExpiresIn { get; init; }

    [JsonPropertyName("tokenType")]
    public string TokenType { get; init; } = "Bearer";

    [JsonPropertyName("account")]
    public AccountSummary? Account { get; init; }
}

public sealed record AccountSummary
{
    [JsonPropertyName("username")]
    public string Username { get; init; } = string.Empty;

    [JsonPropertyName("email")]
    public string Email { get; init; } = string.Empty;

    [JsonPropertyName("full_name")]
    public string? FullName { get; init; }

    [JsonPropertyName("role")]
    public string Role { get; init; } = "user";
}

/// <summary>
/// The 202 the grant returns when the account has MFA enabled, which is not a failure and
/// not a success.
/// </summary>
/// <remarks>
/// Modelled separately from <see cref="DesktopTokenResponse"/> because conflating the two is
/// the easiest way to ship a login screen that either skips the second factor or dead-ends
/// on it. The status code is the only thing that distinguishes them, so the client checks it
/// before it ever looks at the body.
/// </remarks>
public sealed record MfaChallengeResponse
{
    [JsonPropertyName("requiresMfa")]
    public bool RequiresMfa { get; init; }

    [JsonPropertyName("challengeToken")]
    public string ChallengeToken { get; init; } = string.Empty;

    [JsonPropertyName("expiresIn")]
    public int ExpiresIn { get; init; }
}