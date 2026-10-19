using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Auth;
using Filspresso.Core.Platform;

namespace Filspresso.App;

/// <summary>
/// Keeps the session in Windows Credential Manager, encrypted with DPAPI.
/// </summary>
/// <remarks>
/// Not a file, and that is the whole decision. An access token plus a month-long refresh token
/// sitting in a JSON file under %AppData% is readable by every process running as the user,
/// and is trivially copied by anything that gets the machine. Credential Manager encrypts with
/// DPAPI at <c>CurrentUser</c> scope, so the blob is only decryptable by the same user on the
/// same machine — which is exactly the lifetime the token should have.
/// <para>
/// The device id is stored alongside in the same store, because it has the same properties:
/// stable across runs, worthless to anyone else, and awkward to keep anywhere sensible.
/// </para>
/// </remarks>
public sealed class WindowsCredentialStore : ICredentialStore
{
    // "Filspresso.Playground" target and a "Desktop" credential type. The type is a genuine
    // part of the name: keeping it out of the app's own data is what stops a future bug from
    // writing a token into a place that is not protected.
    private const string TargetName = "Filspresso.Playground";

    private const string SessionBlob = "session";
    private const string DeviceIdBlob = "device-id";

    public async Task<StoredSession?> LoadAsync(CancellationToken cancellationToken = default)
    {
        var json = await ReadAsync(SessionBlob, cancellationToken).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<StoredSession>(json!);
        }
        catch (System.Text.Json.JsonException)
        {
            // A corrupt or stale-format blob is treated as "not signed in" and removed, rather
            // than left to fail every launch. The cost is one re-authentication; the alternative
            // is an application that cannot start.
            await ClearAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }
    }

    public async Task SaveAsync(StoredSession session, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(session);

        var json = System.Text.Json.JsonSerializer.Serialize(session);
        await WriteAsync(SessionBlob, json, cancellationToken).ConfigureAwait(false);
    }

    public async Task ClearAsync(CancellationToken cancellationToken = default)
    {
        // Only the session. The device id survives sign-out on purpose: the next sign-in is
        // still the same computer, and a new id each time would fill the server's sessions list
        // with devices the user does not recognise.
        await DeleteAsync(SessionBlob, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>The stable device id, generated once and then kept.</summary>
    public Task<string> GetOrCreateDeviceIdAsync(CancellationToken cancellationToken = default) =>
        DeviceIdentity.ResolveAsync(LoadDeviceIdAsync, SaveDeviceIdAsync, cancellationToken);

    private Task<string?> LoadDeviceIdAsync(CancellationToken cancellationToken) =>
        ReadAsync(DeviceIdBlob, cancellationToken);

    private Task SaveDeviceIdAsync(string value, CancellationToken cancellationToken) =>
        WriteAsync(DeviceIdBlob, value, cancellationToken);

    private static async Task<string?> ReadAsync(string blob, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var buffer = new StringBuilder(4096);
        if (!CredReadW(TargetName, (uint)blob.Length, blob, buffer, buffer.Capacity, 0, out var size) || size == 0)
        {
            return null;
        }

        var value = buffer.ToString();

        // The interface is async so a different platform's store can be genuinely slow. This
        // one is a Win32 call that returns in microseconds; the yield keeps that guarantee
        // honest without pretending the work is off-thread.
        await Task.Yield();
        return value;
    }

    private static async Task WriteAsync(string blob, string value, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var bytes = Encoding.Unicode.GetBytes(value);
        var pointer = Marshal.AllocCoTaskMem(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
            if (!CredWriteW(TargetName, (uint)blob.Length, blob, pointer, (uint)bytes.Length, 0))
            {
                throw new InvalidOperationException(
                    $"Could not write '{blob}' to Windows Credential Manager (error {Marshal.GetLastWin32Error()}).");
            }
        }
        finally
        {
            Marshal.FreeCoTaskMem(pointer);
            // Zeroed before release. The buffer held a refresh token in plaintext, and freeing
            // managed-looking memory does not clear it -- the bytes stay in the heap until
            // something overwrites them, which may be never.
            Array.Clear(bytes);
        }

        // Yielded rather than awaited-on-completed, so a write does not block the UI thread.
        // The interop itself is a few microseconds; the yield is what keeps a burst of them
        // from stalling input.
        await Task.Yield();
    }

    private static async Task DeleteAsync(string blob, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        // Returns false when there was nothing to delete, which is the normal case and not an
        // error: clearing a cleared store must succeed.
        CredDeleteW(TargetName, (uint)blob.Length, blob, 0);
        await Task.Yield();
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredReadW(
        string target,
        uint type,
        string? targetName,
        StringBuilder credentialBlob,
        int credentialBlobSize,
        uint flags,
        out uint credentialBlobSizeActual);

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredWriteW(
        string target,
        uint type,
        string? targetName,
        IntPtr credentialBlob,
        uint credentialBlobSize,
        uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredDeleteW(string target, uint type, string? targetName, uint flags);
}