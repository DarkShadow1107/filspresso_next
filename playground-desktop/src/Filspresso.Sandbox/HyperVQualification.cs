using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Text.Json;
using Filspresso.Core.Storage;

namespace Filspresso.Sandbox;

/// <summary>
/// A machine-specific qualification receipt for one provisioned Hyper-V guest image.
/// </summary>
/// <remarks>
/// Written by the operator's own qualification run, read here fail-closed. It carries settled
/// environment evidence — which image passed which gates on which machine — never consent:
/// enabling execution still needs the signed-in user's fresh per-action approval in the window.
/// The machine binding is a truncated SHA-256 of the registry MachineGuid, so a copied receipt
/// cannot enable another machine. Receipt staleness (30 days) forces re-running qualification
/// after image or policy changes instead of silently trusting old evidence.
/// </remarks>
public sealed record HyperVQualificationReceipt(
    string ImagePath,
    string ImageSha256,
    long ImageBytes,
    int PolicyVersion,
    DateTimeOffset CreatedUtc,
    string MachineId,
    IReadOnlyList<string> Checks)
{
    public const int MaxJsonBytes = 65_536;
    public static readonly string[] RequiredChecks =
    [
        "hyper-v-admin", "image-hash-verified", "image-unattached", "guest-ready",
        "no-network-adapter", "workspace-fenced", "cleanup-confirmed",
    ];
    public static readonly TimeSpan MaxAge = TimeSpan.FromDays(30);

    private static readonly Regex Hex32 = new(@"\A[0-9a-f]{32}\z", RegexOptions.CultureInvariant);
    private static readonly Regex Hex64 = new(@"\A[0-9a-f]{64}\z", RegexOptions.CultureInvariant);
    private static readonly Regex CheckName = new(@"\A[a-z0-9-]{3,64}\z", RegexOptions.CultureInvariant);
    private static readonly Regex LocalPath = new(@"\A[A-Za-z]:\\", RegexOptions.CultureInvariant);

    private static string? TextOf(JsonElement value) =>
        value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static long? IntegerOf(JsonElement value) =>
        value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var result) ? result : null;

    public static bool TryParse(string raw, out HyperVQualificationReceipt? receipt, out string reason)
    {
        receipt = null;
        reason = "The qualification receipt is invalid.";
        if (raw is null || raw.Length > MaxJsonBytes) return false;
        try
        {
            using var document = JsonDocument.Parse(raw, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 4,
            });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || root.EnumerateObject().Count() != 8) return false;
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in root.EnumerateObject())
                if (!seen.Add(property.Name)) return false;

            var version = root.TryGetProperty("version", out var versionValue) ? IntegerOf(versionValue) : null;
            var imagePath = root.TryGetProperty("imagePath", out var imageValue) ? TextOf(imageValue) : null;
            var imageSha256 = root.TryGetProperty("imageSha256", out var digestValue) ? TextOf(digestValue) : null;
            var imageBytes = root.TryGetProperty("imageBytes", out var bytesValue) ? IntegerOf(bytesValue) : null;
            var policyVersion = root.TryGetProperty("policyVersion", out var policyValue) ? IntegerOf(policyValue) : null;
            var createdUtc = root.TryGetProperty("createdUtc", out var createdValue) ? TextOf(createdValue) : null;
            var machineId = root.TryGetProperty("machineId", out var machineValue) ? TextOf(machineValue) : null;
            if (!root.TryGetProperty("checks", out var checksValue) || checksValue.ValueKind != JsonValueKind.Array) return false;

            if (version is not 1 || policyVersion is not 2) { reason = "Unsupported qualification receipt or policy version."; return false; }
            if (imagePath is not { } image || string.IsNullOrWhiteSpace(image) || image.Length > 240 ||
                !LocalPath.IsMatch(image) || image.Any(char.IsControl) ||
                !image.EndsWith(".vhdx", StringComparison.OrdinalIgnoreCase))
            { reason = "The receipt does not reference a local VHDX image."; return false; }
            if (imageSha256 is not { Length: 64 } digest || !Hex64.IsMatch(digest)) { reason = "The recorded image digest is invalid."; return false; }
            if (imageBytes is not { } bytes || bytes < 1_048_576 || bytes > 256L * 1024 * 1024 * 1024)
            { reason = "The recorded image size is not physically plausible."; return false; }
            if (machineId is not { Length: 32 } identifier || !Hex32.IsMatch(identifier))
            { reason = "The recorded machine binding is invalid."; return false; }
            if (createdUtc is not { Length: 20 } created || !DateTimeOffset.TryParseExact(created, "yyyy-MM-dd'T'HH:mm:ss'Z'",
                    CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var timestamp))
            { reason = "The qualification timestamp is not present in the canonical form."; return false; }
            var now = DateTimeOffset.UtcNow;
            if (timestamp > now.AddMinutes(2) || now - timestamp > MaxAge)
            { reason = "The qualification receipt is stale or from the future. Re-run the qualification script."; return false; }

            var names = new List<string>(checksValue.GetArrayLength());
            foreach (var element in checksValue.EnumerateArray())
            {
                var name = TextOf(element);
                if (name is not { Length: >= 3 and <= 64 } normalized || !CheckName.IsMatch(normalized) || names.Contains(normalized))
                { reason = "The receipt's recorded checks are invalid or duplicated."; return false; }
                names.Add(normalized);
            }
            if (RequiredChecks.Any(required => !names.Contains(required)))
            { reason = "The receipt does not record every required release gate."; return false; }

            receipt = new(image, digest, bytes, (int)policyVersion.Value, timestamp, identifier, names);
            reason = string.Empty;
            return true;
        }
        catch (Exception) { return false; }
    }

    /// <summary>Only the machine that produced the receipt may rely on it.</summary>
    public bool IsCurrentMachine() => MachineId.Equals(HyperVQualification.MachineId, StringComparison.OrdinalIgnoreCase);
}

public static class HyperVQualification
{
    /// <summary>Default storage under the same local data root the desktop client already owns.</summary>
    public static string DefaultReceiptPath => Path.Combine(DesktopDataPaths.UserDataDirectory, "qualification", "hyper-v.json");

    /// <summary>Where sandbox sessions (differencing disks, VM config files) live.</summary>
    public static string DefaultSandboxRoot => Path.Combine(DesktopDataPaths.UserDataDirectory, "sandbox");

    /// <summary>
    /// Default guest credential target, read from Credential Manager at sandbox start.
    /// </summary>
    public static string DefaultGuestCredentialTarget => "Filspresso.Playground.HyperVGuest";

    /// <summary>
    /// Re-checks the qualified image against the disk: present, local, not a reparse point,
    /// same byte length, and not modified after qualification. This is a bounded check, not
    /// a proof — the receipt records the SHA-256 measured at qualification time; a changed
    /// image invalidates the receipt rather than being caught here byte-for-byte.
    /// </summary>
    public static (bool Ok, string Reason) VerifyImage(HyperVQualificationReceipt receipt, string? path = null)
    {
        ArgumentNullException.ThrowIfNull(receipt);
        var location = path is { Length: > 0 } ? path : receipt.ImagePath;
        try
        {
            if (!Path.IsPathFullyQualified(location) || !location.EndsWith(".vhdx", StringComparison.OrdinalIgnoreCase))
                return (false, "The qualified image path is not a local .vhdx path.");
            var information = new FileInfo(location);
            if (!information.Exists) return (false, "The qualified image file is missing.");
            if ((information.Attributes & FileAttributes.ReparsePoint) != 0)
                return (false, "The qualified image path is a reparse point.");
            if (information.Length != receipt.ImageBytes)
                return (false, "The image size no longer matches the qualification receipt.");
            if (information.LastWriteTimeUtc > receipt.CreatedUtc.AddMinutes(2))
                return (false, "The image was modified after qualification; re-run the qualification script.");
            return (true, string.Empty);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return (false, "The qualified image could not be read.");
        }
    }

    /// <summary>
    /// Loads and verifies the default receipt: parse, machine binding, freshness. Returns the
    /// receipt only when every condition holds, with a lowercase reason otherwise.
    /// </summary>
    public static (HyperVQualificationReceipt? Receipt, string Reason) TryLoadVerified(string? path = null)
    {
        var location = path is { Length: > 0 } ? path : DefaultReceiptPath;
        try
        {
            if (!File.Exists(location)) return (null, "Desktop execution is not qualified: run Qualify-HyperVExecution.ps1 first.");
            using var stream = new FileStream(location, FileMode.Open, FileAccess.Read, FileShare.Read);
            using var reader = new StreamReader(stream);
            var raw = reader.ReadToEnd();
            if (reader.Peek() >= 0) return (null, "The qualification receipt file has unexpected trailing content.");
            if (!HyperVQualificationReceipt.TryParse(raw, out var receipt, out var reason)) return (null, reason);
            if (receipt is null || !receipt.IsCurrentMachine()) return (null, "The qualification receipt was produced on another machine.");
            return (receipt, string.Empty);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            return (null, "The qualification receipt could not be read safely.");
        }
    }

    /// <summary>
    /// Truncated SHA-256 of the registry MachineGuid. Deterministic per machine; an empty or
    /// unreadable guid yields an empty binding that cannot match a receipt, so an unreadable
    /// registry never looks qualified.
    /// </summary>
    public static string MachineId
    {
        get
        {
            var guid = ReadMachineGuid();
            if (string.IsNullOrWhiteSpace(guid)) return string.Empty;
            return Convert.ToHexStringLower(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(guid.Trim())))[..32];
        }
    }

    private static string? ReadMachineGuid()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography");
            return key?.GetValue("MachineGuid") is string value ? value : null;
        }
        catch (Exception error) when (error is UnauthorizedAccessException or IOException or System.Security.SecurityException)
        {
            return null;
        }
    }
}
