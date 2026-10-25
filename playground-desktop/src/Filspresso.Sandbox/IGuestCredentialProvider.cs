using System.Net;
using System.Threading;
using System.Threading.Tasks;

namespace Filspresso.Sandbox;

/// <summary>
/// Credentials provisioned by the operator for a dedicated Windows guest image. They must
/// not be the Filspresso account token or host credentials. No default password, download,
/// provisioning or production credential-store adapter is supplied by this library.
/// </summary>
public interface IGuestCredentialProvider
{
    Task<NetworkCredential?> GetCredentialAsync(CancellationToken cancellationToken = default);
}
