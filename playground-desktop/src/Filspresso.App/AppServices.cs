using System;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Core.Auth;
using Microsoft.UI.Xaml;

namespace Filspresso.App;

/// <summary>
/// Builds the object graph, once, at launch.
/// </summary>
/// <remarks>
/// Composed by hand rather than with a container. There are five objects, they never change,
/// and a dependency-injection framework here would be a second thing to learn and a third
/// thing to debug — on a client whose hard problems are the sandbox and the billing, not
/// construction.
/// </remarks>
public sealed class AppServices : IDisposable
{
    private readonly DesktopApiClient _api;

    public AppServices(Uri backendBaseAddress)
    {
        _api = new DesktopApiClient(backendBaseAddress);
        var store = new WindowsCredentialStore();

        DeviceId = store.GetOrCreateDeviceIdAsync().GetAwaiter().GetResult();
        Store = store;
        Auth = new AuthSessionManager(
            _api,
            store,
            new SystemClock(),
            DeviceId,
            Environment.MachineName,
            AppVersion);
    }

    public string DeviceId { get; }

    public string AppVersion =>
        typeof(AppServices).Assembly.GetName().Version?.ToString(3) ?? "0.1.0";

    public ICredentialStore Store { get; }

    public AuthSessionManager Auth { get; }

    /// <summary>The most recent entitlement, kept so every screen reads the same answer.</summary>
    public Entitlement? Entitlement { get; private set; }

    /// <summary>
    /// Loads entitlement, refreshing the access token first if it is close to expiry.
    /// </summary>
    /// <remarks>
    /// Every screen that needs to know "may I, and can I afford it" goes through here rather
    /// than calling the API. One place owns the refresh, so no screen can accidentally skip it
    /// and be the reason a request 401s.
    /// </remarks>
    public async Task<ApiResult<Entitlement>> LoadEntitlementAsync(CancellationToken cancellationToken = default)
    {
        if (!await Auth.EnsureAccessTokenAsync(cancellationToken).ConfigureAwait(true))
        {
            return ApiResult<Entitlement>.Failure(ApiError.Unauthenticated, "Signed out", 401);
        }

        var result = await _api
            .GetEntitlementAsync(Auth.Current!.AccessToken, cancellationToken)
            .ConfigureAwait(true);

        if (result.Ok)
        {
            Entitlement = result.Value;
        }

        return result;
    }

    public void Dispose() => _api.Dispose();
}