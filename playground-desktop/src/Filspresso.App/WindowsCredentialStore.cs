using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Auth;
using Filspresso.Core.Platform;
using Filspresso.Core.Storage;

namespace Filspresso.App;

/// <summary>
/// Keeps the session in Windows Credential Manager, encrypted with DPAPI.
/// </summary>
/// <remarks>
/// Not a file, and that is the whole decision. An access token plus a month-long refresh token
/// sitting in a JSON file under %AppData% is readable by every process running as the user,
/// and is copied by anything that gets the machine. Credential Manager encrypts with DPAPI at
/// <c>CurrentUser</c> scope, so the blob is only decryptable by the same user on the same
/// machine — which is exactly the lifetime the token should have.
/// <para>
/// The device id is stored alongside in the same store, because it has the same properties:
/// stable across runs, worthless to anyone else, and awkward to keep anywhere sensible.
/// </para>
/// </remarks>
public sealed class WindowsCredentialStore(string targetPrefix = DesktopDataPaths.CredentialPrefix) : ICredentialStore
{
    private const uint Generic = 1;
    private const int NotFound = 1168;

    public async Task<StoredSession?> LoadAsync(CancellationToken cancellationToken = default)
    {
        var json = await ReadAsync("session", cancellationToken).ConfigureAwait(false);
        if (json is null)
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<StoredSession>(json);
        }
        catch (JsonException)
        {
            // A corrupt or stale-format blob is treated as "not signed in" and removed, rather
            // than left to fail every launch. The cost is one re-authentication; the
            // alternative is an application that cannot start.
            await ClearAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }
    }

    public Task SaveAsync(StoredSession session, CancellationToken cancellationToken = default) =>
        WriteAsync("session", JsonSerializer.Serialize(session), cancellationToken);

    public Task ClearAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!CredDeleteW($"{targetPrefix}/session", Generic, 0) && Marshal.GetLastWin32Error() != NotFound)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        return Task.CompletedTask;
    }

    /// <summary>The stable device id, generated once and then kept.</summary>
    public Task<string> GetOrCreateDeviceIdAsync(CancellationToken cancellationToken = default) =>
        DeviceIdentity.ResolveAsync(
            ct => ReadAsync("device-id", ct),
            (value, ct) => WriteAsync("device-id", value, ct),
            cancellationToken);

    private Task<string?> ReadAsync(string name, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (!CredReadW($"{targetPrefix}/{name}", Generic, 0, out var pointer))
        {
            var error = Marshal.GetLastWin32Error();
            if (error == NotFound)
            {
                return Task.FromResult<string?>(null);
            }

            throw new Win32Exception(error);
        }

        try
        {
            var credential = Marshal.PtrToStructure<Credential>(pointer);
            var bytes = new byte[checked((int)credential.BlobSize)];
            try
            {
                Marshal.Copy(credential.Blob, bytes, 0, bytes.Length);
                return Task.FromResult<string?>(Encoding.Unicode.GetString(bytes));
            }
            finally
            {
                // The blob held a refresh token in plaintext. Freeing it does not clear it.
                CryptographicOperations.ZeroMemory(bytes);
            }
        }
        finally
        {
            CredFree(pointer);
        }
    }

    private Task WriteAsync(string name, string value, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var bytes = Encoding.Unicode.GetBytes(value);
        if (bytes.Length > 2560)
        {
            throw new InvalidOperationException("Credential exceeds the Windows blob limit.");
        }

        var pointer = Marshal.AllocCoTaskMem(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
            var credential = new Credential
            {
                Type = Generic,
                TargetName = $"{targetPrefix}/{name}",
                UserName = Environment.UserName,
                BlobSize = (uint)bytes.Length,
                Blob = pointer,
                // Persist locally: the session should survive a reboot without a sign-in.
                Persist = 2,
            };

            if (!CredWriteW(ref credential, 0))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
        }
        finally
        {
            // Zeroed before release, and the unmanaged copy too: the buffer held a refresh
            // token in plaintext and freeing it does not clear it.
            CryptographicOperations.ZeroMemory(bytes);
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
            Marshal.FreeCoTaskMem(pointer);
        }

        return Task.CompletedTask;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public uint Flags;
        public uint Type;
        public string? TargetName;
        public string? Comment;
        public long LastWritten;
        public uint BlobSize;
        public IntPtr Blob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string? UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredReadW(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredWriteW(ref Credential credential, uint flags);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredDeleteW(string target, uint type, uint flags);

    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr credential);
}
