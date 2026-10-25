using System;
using System.Text.Json.Serialization;

namespace Filspresso.Core.Api;

/// <summary>
/// What the server would hand a browser that clicked <c>api/desktop/download</c> today.
/// </summary>
/// <remarks>
/// The application asks this so it can tell its user, passively and without trying to
/// update itself, that a newer build exists. Each field is what the server's manifest
/// recorded for the package behind it; the app never assumes the file it links to is what
/// a browser will actually receive, because the server re-verifies that at serve time and
/// reports a refusal when it would not.
/// </remarks>
public sealed record InstallerUpdate
{
    [JsonPropertyName("available")]
    public bool Available { get; init; }

    [JsonPropertyName("fileName")]
    public string FileName { get; init; } = string.Empty;

    /// <summary>False when the account has no Spectre access; the notice is not shown then.</summary>
    [JsonPropertyName("canDownload")]
    public bool CanDownload { get; init; }

    /// <summary>The published package version, or null when the server could not resolve one.</summary>
    [JsonPropertyName("productVersion")]
    public string? ProductVersion { get; init; }

    [JsonPropertyName("sha256")]
    public string? Sha256 { get; init; }

    [JsonPropertyName("bytes")]
    public long? Bytes { get; init; }

    /// <summary>True when the manifest carries no publisher signature. Shown so the user is not surprised by SmartScreen.</summary>
    [JsonPropertyName("unsigned")]
    public bool Unsigned { get; init; }

    /// <summary>Whether this account has already acknowledged this version for download.</summary>
    [JsonPropertyName("acknowledged")]
    public bool Acknowledged { get; init; }

    /// <summary>
    /// Whether the published package is strictly newer than the running application.
    /// </summary>
    /// <remarks>
    /// The rule the update notice uses, kept here rather than in the app project so it can
    /// be tested without the WinUI runtime. Numeric field comparison: 0.10.0 is newer than
    /// 0.9.0, which a string compare would get wrong. A version that cannot be parsed is
    /// never claimed as newer -- a malformed server answer does not invent an update.
    /// </remarks>
    public bool IsNewerThan(string runningVersion)
    {
        if (ProductVersion is null) return false;
        if (!Version.TryParse(ProductVersion, out var published)) return false;
        if (!Version.TryParse(runningVersion, out var running)) return true;
        return published > running;
    }
}

/// <summary>
/// The facts this machine would like on record, for the account page's "Playground
/// installed on" line.
/// </summary>
/// <remarks>
/// Everything except the device identity is a possible unknown: the registry can refuse,
/// a value can be absent. A read that failed is reported as null and never as a plausibly
/// wrong number, because the server stores what it is told and a fabricated 0 would read
/// back as a real build.
/// </remarks>
public sealed record DeviceStateReport
{
    [JsonPropertyName("deviceId")]
    public string DeviceId { get; init; } = string.Empty;

    [JsonPropertyName("deviceName")]
    public string? DeviceName { get; init; }

    [JsonPropertyName("osEdition")]
    public string? OsEdition { get; init; }

    [JsonPropertyName("osBuild")]
    public int? OsBuild { get; init; }

    [JsonPropertyName("osUbr")]
    public int? OsUbr { get; init; }

    [JsonPropertyName("appVersion")]
    public string? AppVersion { get; init; }
}
