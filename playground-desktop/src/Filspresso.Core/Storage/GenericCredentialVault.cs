using System;
using System.ComponentModel;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace Filspresso.Core.Storage;

/// <summary>
/// Read-only Windows Credential Manager reader for one generic credential.
/// </summary>
/// <remarks>
/// The guest account is not typed into the application. The operator provisioned the
/// dedicated guest image, so the operator owns the password, and the credential enters
/// Credential Manager with <c>cmdkey /generic:</c> rather than a file every process of the
/// user session can read. This class deliberately only <b>reads</b>: a UI able to write the
/// vault is one checkbox away from silently saving a password the rest of the code treats as
/// operator-owned data. The blob is DPAPI-protected by the operating system and decryptable
/// only by the same user on the same machine, which is the right lifetime for a guest
/// credential tied to a local image.
/// </remarks>
public static class GenericCredentialVault
{
    /// <summary>Target name serialized into the sandbox credential contract; scripts must use it.</summary>
    public const string GuestTarget = "Filspresso.Playground.HyperVGuest";

    private const int ErrorNotFound = 1168;
    private const uint GenericType = 1;

    /// <summary>
    /// Reads the stored generic credential, or null when none is provisioned yet. Missing
    /// credentials are a null, not an exception; a vault access failure is an exception
    /// because a broken handle state must not silently look like "not configured".
    /// </summary>
    public static NetworkCredential? Read(string target)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(target);
        if (target.Length > 255) throw new ArgumentException("Credential target must be 1..255 characters.", nameof(target));
        if (!CredRead(target, GenericType, 0, out var pointer))
        {
            var error = Marshal.GetLastWin32Error();
            if (error == ErrorNotFound) return null;
            throw new Win32Exception(error, "Credential Manager could not be read.");
        }
        try
        {
            var credential = Marshal.PtrToStructure<Cred>(pointer);
            var blobSize = credential.CredentialBlobSize;
            var blob = credential.CredentialBlob;
            // A row with no usable secret means the guest account was never provisioned into
            // this vault; report that as null rather than as a credential with no password.
            if (blobSize != 0u && blob != IntPtr.Zero)
            {
                if (blobSize % 2u != 0u || blobSize > 2048u)
                    throw new InvalidOperationException("The stored guest credential blob is not usable.");
                var secret = Marshal.PtrToStringUni(blob, unchecked((int)(blobSize / 2u))) ?? string.Empty;
                if (secret.Length > 1024 || secret.Any(char.IsControl))
                    throw new InvalidOperationException("The stored guest credential blob is not usable.");
                if (string.IsNullOrWhiteSpace(secret)) return null;
                var user = credential.UserName is { Length: > 0 and <= 256 } name ? name.Trim() : string.Empty;
                var targetName = string.IsNullOrWhiteSpace(credential.TargetName) ? target : credential.TargetName!;
                return new NetworkCredential(user, secret, targetName);
            }
            return null;
        }
        finally { CredFree(pointer); }
    }

    public static NetworkCredential? ReadGuestCredential() => Read(GuestTarget);

    [DllImport("advapi32.dll", SetLastError = true, EntryPoint = "CredReadW", CharSet = CharSet.Unicode)]
    private static extern bool CredRead(string targetName, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", SetLastError = false)]
    private static extern void CredFree(IntPtr buffer);

    // Binary layout must match CREDENTIALW exactly: field order is fixed by the unmanaged ABI.
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct Cred
    {
        public uint Flags;
        public uint Type;
        public string? TargetName;
        public string? Comment;
        public FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string? UserName;
    }
}
