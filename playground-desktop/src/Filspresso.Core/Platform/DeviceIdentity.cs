using System;
using System.Security.Cryptography;

namespace Filspresso.Core.Platform;

/// <summary>
/// The stable identifier this machine presents to the backend.
/// </summary>
/// <remarks>
/// Generated once and then persisted, so it survives restarts and reinstalls. It is what lets
/// the server name the device in its sessions list and key the desktop throttle on the account
/// rather than the address.
/// <para>
/// <b>Not derived from hardware.</b> A MAC address, a disk serial, or a volume GUID would be
/// stable without storage, but they identify the hardware rather than the installation, they
/// can change under the user (a replaced NIC, a cloned disk, a moved VM), and reading them is a
/// privacy cost this product has no reason to pay. A random value kept in the credential store
/// is stable enough and asks for nothing.
/// </para>
/// <para>
/// The charset is restricted to <c>A-Za-z0-9_-</c> and the length to 16-64, matching what the
/// server accepts. It is generated inside that shape rather than trimmed into it, so the value
/// can never be one the server rejects — a rejected device id would silently become "no
/// device", and the throttle would fall back to per-IP.
/// </para>
/// </remarks>
public static class DeviceIdentity
{
    public const int MinLength = 16;
    public const int MaxLength = 64;

    /// <summary>192 bits, base64url, no padding. Comfortably inside the accepted length.</summary>
    public static string Generate()
    {
        Span<byte> bytes = stackalloc byte[24];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }

    /// <summary>
    /// Whether the server would accept this value.
    /// </summary>
    /// <remarks>
    /// Mirrors the server's rule so a value can be checked before it is sent rather than after
    /// the request is refused. Exposed for that check, not for generating: the generator
    /// cannot produce an invalid value.
    /// </remarks>
    public static bool IsWellFormed(string? deviceId)
    {
        if (deviceId is null || deviceId.Length < MinLength || deviceId.Length > MaxLength)
        {
            return false;
        }

        foreach (var c in deviceId)
        {
            var ok = c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '-' or '_';
            if (!ok)
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// Returns the stored id, or generates and stores one.
    /// </summary>
    /// <remarks>
    /// A stored value that is malformed is replaced rather than sent. The alternative is
    /// sending it, having the server reject it, and ending up with a session list entry the
    /// user cannot recognise — which is the exact problem the device id exists to solve.
    /// </remarks>
    public static async System.Threading.Tasks.Task<string> ResolveAsync(
        Func<System.Threading.CancellationToken, System.Threading.Tasks.Task<string?>> load,
        Func<string, System.Threading.CancellationToken, System.Threading.Tasks.Task> save,
        System.Threading.CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(load);
        ArgumentNullException.ThrowIfNull(save);

        var existing = await load(cancellationToken).ConfigureAwait(false);
        if (IsWellFormed(existing))
        {
            return existing!;
        }

        var generated = Generate();
        await save(generated, cancellationToken).ConfigureAwait(false);
        return generated;
    }
}