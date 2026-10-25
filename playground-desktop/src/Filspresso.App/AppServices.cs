using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Core.Auth;
using Filspresso.Core.Session;
using Filspresso.Core.Storage;
using Filspresso.Harness;
using Filspresso.Sandbox;
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
    private readonly Uri _backendBaseAddress;

    public AppServices(Uri backendBaseAddress)
    {
        _backendBaseAddress = backendBaseAddress;
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

    /// <summary>Model transport only. The caller owns it; no executor/guest credentials are composed.</summary>
    public NativeAgentTransport CreateProposalTransport(int inputContextTokens, string? sessionUuid) =>
        new(_backendBaseAddress, Auth, inputContextTokens, sessionUuid, compactionMode: Preferences.Normalize().CompactionMode);

    /// <summary>
    /// Composes a conversation adapter, and thereby decides execution availability.
    /// </summary>
    /// <remarks>
    /// Fail-closed: only a verified, current Hyper-V qualification receipt over an unchanged
    /// image composes <see cref="HyperVAgentServices"/>; every other case composes
    /// <see cref="QuestionOnlyAgentServices"/> and reports why. Both advertise the same
    ///clarification protocol; only the qualified one offers file/command tools.
    /// </remarks>
    public IAgentServices CreateAgentServices(INativeAgentModelTransport transport, ProjectCheckpoints checkpoints, out string executionStatus)
    {
        var (receipt, reason) = HyperVQualification.TryLoadVerified();
        if (receipt is not { } qualified)
        {
            executionStatus = reason;
            return new QuestionOnlyAgentServices(transport);
        }
        var (imageOk, imageReason) = HyperVQualification.VerifyImage(qualified);
        if (!imageOk)
        {
            executionStatus = imageReason;
            return new QuestionOnlyAgentServices(transport);
        }
        executionStatus = $"Hyper-V execution qualified {qualified.CreatedUtc:yyyy-MM-dd} · policy {qualified.PolicyVersion} · image {qualified.ImageSha256[..12]}…";
        var sandbox = new HyperVSandbox(new PowerShellRunner(), qualified.ImagePath,
            HyperVQualification.DefaultSandboxRoot, credentials: new VaultGuestCredentials());
        return new HyperVAgentServices(transport, sandbox, qualified, checkpoints, executionQualified: true, executionStatus);
    }

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

    public async Task<ApiResult<PreparedSource>> PrepareFileAsync(string name, Stream contents, CancellationToken cancellationToken)
    {
        if (!await Auth.EnsureAccessTokenAsync(cancellationToken) || Auth.Current is null)
            return ApiResult<PreparedSource>.Failure(ApiError.Unauthenticated, "Sign in again to attach files.", 401);
        return await _api.PrepareFileAsync(Auth.Current.AccessToken, name, contents, cancellationToken);
    }

    public async Task<ApiResult<PreparedSource>> PrepareGithubAsync(string url, CancellationToken cancellationToken)
    {
        if (!await Auth.EnsureAccessTokenAsync(cancellationToken) || Auth.Current is null)
            return ApiResult<PreparedSource>.Failure(ApiError.Unauthenticated, "Sign in again to attach a project.", 401);
        return await _api.PrepareGithubAsync(Auth.Current.AccessToken, url, cancellationToken);
    }

    /// <summary>The account's server-saved Playground sessions, newest first.</summary>
    public Task<ApiResult<IReadOnlyList<SavedSession>>> ListSavedSessionsAsync(CancellationToken cancellationToken = default) =>
        WithSavedSessionTokenAsync((token, ct) => _api.ListSessionsAsync(token, 12, ct), cancellationToken);

    public Task<ApiResult<SavedSession>> GetSavedSessionAsync(string sessionUuid, CancellationToken cancellationToken = default) =>
        WithSavedSessionTokenAsync((token, ct) => _api.GetSessionAsync(token, sessionUuid, ct), cancellationToken);

    public Task<ApiResult<IReadOnlyList<RecordedRun>>> ListRecordedRunsAsync(string? sessionUuid = null, CancellationToken cancellationToken = default) =>
        WithSavedSessionTokenAsync((token, ct) => _api.ListRunsAsync(token, sessionUuid, cancellationToken: ct), cancellationToken);

    public Task<ApiResult<RunReplayPage>> ReplayRecordedRunAsync(string runId, int afterSequence = -1, CancellationToken cancellationToken = default) =>
        WithSavedSessionTokenAsync((token, ct) => _api.ReplayRunAsync(token, runId, afterSequence, cancellationToken: ct), cancellationToken);

    /// <summary>
    /// Creates or updates one conversation's server session: its resume state, never its
    /// transcript.
    /// </summary>
    /// <remarks>
    /// The checkpoint stored is the compaction artifact itself — mode, the two measurements,
    /// the summary and the retained turns — matching what the web client saves. The
    /// measurement bookkeeping a resume never needs (the input limit it will be resolved
    /// against, notices, usage) is dropped here so both clients write the same shape.
    /// </remarks>
    public Task<ApiResult<string>> SaveSavedSessionAsync(string? sessionUuid, SessionWrite write, CancellationToken cancellationToken = default) =>
        WithSavedSessionTokenAsync(async (token, ct) =>
    {
        if (write.ActiveContext is { } checkpoint)
            write = write with
            {
                ActiveContext = new ContextState
                {
                    Mode = checkpoint.Mode,
                    TokensBefore = checkpoint.TokensBefore,
                    TokensAfter = checkpoint.TokensAfter,
                    Summary = checkpoint.Summary,
                    History = checkpoint.History,
                },
            };
        var saved = await _api.SaveSessionAsync(token, sessionUuid, write, ct);
        // Only a definitive missing row permits recreation; ambiguous writes are never retried.
        return saved.StatusCode == 404 && sessionUuid is not null
            ? await _api.SaveSessionAsync(token, null, write, ct)
            : saved;
    }, cancellationToken);

    /// <summary>Forgets a saved conversation; the same request purges its recorded events.</summary>
    public Task<ApiResult<bool>> DeleteSavedSessionAsync(string sessionUuid, CancellationToken cancellationToken = default) =>
        WithSavedSessionTokenAsync((token, ct) => _api.DeleteSessionAsync(token, sessionUuid, ct), cancellationToken);

    // Fire-and-forget saves also pass through token refresh and the credential store. Keep
    // those failures fail-open too, and bound the entire operation, not just the HTTP call.
    private async Task<ApiResult<T>> WithSavedSessionTokenAsync<T>(Func<string, CancellationToken, Task<ApiResult<T>>> operation, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(8));
        try
        {
            if (!await Auth.EnsureAccessTokenAsync(timeout.Token) || Auth.Current is null)
                return ApiResult<T>.Failure(ApiError.Unauthenticated, "Sign in again to manage saved conversations.", 401);
            return await operation(Auth.Current.AccessToken, timeout.Token);
        }
        catch (Exception error) when (error is System.Net.Http.HttpRequestException or IOException or UnauthorizedAccessException ||
            (error is OperationCanceledException && !cancellationToken.IsCancellationRequested))
        { return ApiResult<T>.Failure(ApiError.Unexpected, "Saved conversations are unavailable right now. Please retry.", 0); }
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
