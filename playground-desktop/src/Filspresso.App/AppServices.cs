using System;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Core.Auth;
using Filspresso.Core.Session;
using Filspresso.Core.Storage;
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
        var store = new WindowsCredentialStore(
            Environment.GetEnvironmentVariable("FILSPRESSO_CREDENTIAL_PREFIX") ?? DesktopDataPaths.CredentialPrefix);
        PreferencesStore = new DesktopPreferencesStore(Environment.GetEnvironmentVariable("FILSPRESSO_PROFILE_DIR"));
        Preferences = PreferencesStore.Load();

        DeviceId = store.GetOrCreateDeviceIdAsync().GetAwaiter().GetResult();
        Store = store;
        Auth = new AuthSessionManager(
            _api,
            store,
            new SystemClock(),
            DeviceId,
            Environment.MachineName,
            AppVersion);

        Playground = new PlaygroundSession(_api, Auth, LoadEntitlementAsync);

        // Signing out clears the session, and the Playground's view of the account has to be
        // cleared with it. Otherwise the next screen still shows a balance and a catalogue
        // for an account the user has just left.
        Auth.Changed += (_, _) =>
        {
            if (!Auth.IsSignedIn)
            {
                Entitlement = null;
                Playground.Reset();
            }
        };
    }

    public string DeviceId { get; }

    public string AppVersion =>
        typeof(AppServices).Assembly.GetName().Version?.ToString(3) ?? "0.1.0";

    public ICredentialStore Store { get; }

    public AuthSessionManager Auth { get; }

    public PlaygroundSession Playground { get; }

    public IntPtr WindowHandle { get; set; }
    public DesktopPreferencesStore PreferencesStore { get; }
    public DesktopPreferences Preferences { get; private set; }
    public event EventHandler? PreferencesChanged;

    public void SavePreferences(DesktopPreferences preferences)
    {
        PreferencesStore.Save(preferences);
        Preferences = preferences.Normalize();
        PreferencesChanged?.Invoke(this, EventArgs.Empty);
    }

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
        bool valid;
        try
        {
            valid = await Auth.EnsureAccessTokenAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception error) when (error is System.Net.Http.HttpRequestException ||
            (error is OperationCanceledException && !cancellationToken.IsCancellationRequested))
        {
            // The network failed, which is not the same as being signed out. The distinction
            // matters: one is worth a retry, the other needs a password.
            return ApiResult<Entitlement>.Failure(ApiError.Unexpected, "Session service unreachable", 0);
        }

        if (!valid)
        {
            return ApiResult<Entitlement>.Failure(
                Auth.IsSignedIn ? ApiError.Unexpected : ApiError.Unauthenticated,
                "Session unavailable",
                Auth.IsSignedIn ? 0 : 401);
        }

        var result = await _api
            .GetEntitlementAsync(Auth.Current!.AccessToken, cancellationToken)
            .ConfigureAwait(false);

        if (result.Ok)
        {
            Entitlement = result.Value;
        }

        return result;
    }

    /// <summary>
    /// Where the customer manages their subscription and funds their wallet.
    /// </summary>
    /// <remarks>
    /// The web account page, not a page in this application. Funding needs a default card,
    /// which the desktop app deliberately does not handle, and a payment form belongs in the
    /// browser anyway.
    /// </remarks>
    public Uri AccountUrl => new(new Uri(WebBaseUrl), "api/pages/account");

    public Uri SubscriptionUrl => new(new Uri(WebBaseUrl), "api/pages/subscription");

    private static string WebBaseUrl =>
        Environment.GetEnvironmentVariable("FILSPRESSO_WEB_URL") ?? "https://localhost:8443/";

    public void Dispose() => _api.Dispose();
}
