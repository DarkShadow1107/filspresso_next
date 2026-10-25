using System;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Storage;

namespace Filspresso.Sandbox;

/// <summary>
/// Reads the operator-provisioned guest credential from Windows Credential Manager at the
/// moment the sandbox needs it. The application never stores or types this password; the
/// operator wrote it once with the qualification script (or <c>cmdkey</c> directly), and
/// Windows DPAPI keeps it session- and machine-bound.
/// </summary>
public sealed class VaultGuestCredentials : IGuestCredentialProvider
{
    private readonly string _target;

    public VaultGuestCredentials(string? target = null) =>
        _target = string.IsNullOrWhiteSpace(target) ? HyperVQualification.DefaultGuestCredentialTarget : target;

    public Task<NetworkCredential?> GetCredentialAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(GenericCredentialVault.Read(_target));
    }
}
