using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using Filspresso.Core.Streaming;

namespace Filspresso.Core.Api;

/// <summary>What the server refused, in terms the UI can act on.</summary>
public enum ApiError
{
    None = 0,

    /// <summary>401. The session is gone; sign in again.</summary>
    Unauthenticated,

    /// <summary>403. No Spectre access. Offer the subscription, do not offer a retry.</summary>
    Locked,

    /// <summary>402. Genuinely out of money. Offer the wallet, do not treat it as an error.</summary>
    OutOfFunds,

    /// <summary>503. Our problem, not the customer's. Say so, and do not send them to pay.</summary>
    BillingUnavailable,

    /// <summary>
    /// The model service is busy -- usually loading or swapping a model. Retryable, and
    /// nothing to do with money.
    /// </summary>
    ModelBusy,

    /// <summary>The model service failed. The money is fine; the generation is not.</summary>
    Upstream,

    RateLimited,
    Unexpected,
}

public sealed record ApiResult<T>(bool Ok, T? Value, ApiError Error, string Message, int StatusCode)
{
    public static ApiResult<T> Success(T value) => new(true, value, ApiError.None, string.Empty, 200);

    public static ApiResult<T> Failure(ApiError error, string message, int status) =>
        new(false, default, error, message, status);
}

public sealed record DesktopGrantResult(
    ApiResult<DesktopTokenResponse> Result,
    MfaChallengeResponse? MfaChallenge);

/// <summary>
/// The desktop client's view of the backend.
/// </summary>
/// <remarks>
/// Two things here are deliberate and worth not undoing:
/// <para>
/// <b>The entitlement call is one request.</b> It replaces four, and the app polls it after
/// every generation.
/// </para>
/// <para>
/// <b>The streaming call carries the access token as a bearer.</b> No cookie is ever sent or
/// accepted: the backend's CSRF guard passes Bearer-only callers through precisely so a
/// native client has a path that does not need a cookie jar. Reintroducing cookies here
/// would put the application on the wrong side of that guard.
/// </para>
/// </remarks>
// Not sealed, and the two credential methods are virtual, so tests can substitute a client
// whose responses the test controls the timing of. The behaviour worth testing here -- two
// callers refreshing at once, a slow refresh -- cannot be expressed without that, and a
// mocking framework would hide the very thing under test by wrapping the call instead of
// replacing it.
public class DesktopApiClient : IDisposable
{
    private readonly HttpClient _http;

    public DesktopApiClient(Uri backendBaseAddress, HttpMessageHandler? handler = null)
    {
        ArgumentNullException.ThrowIfNull(backendBaseAddress);

        // Cookies are off and redirects are refused: a native client has no cookie jar, and
        // following a redirect would send the bearer token to a host the client did not
        // choose.
        _http = handler is null
            ? new HttpClient(new HttpClientHandler { UseCookies = false, AllowAutoRedirect = false })
            : new HttpClient(handler, disposeHandler: false);
        _http.BaseAddress = backendBaseAddress;
        _http.Timeout = TimeSpan.FromSeconds(60);
    }

    /// <summary>
    /// Exchanges a password for tokens, or returns an MFA challenge when one is required.
    /// </summary>
    public virtual async Task<DesktopGrantResult> GrantAsync(
        string email,
        string password,
        string deviceId,
        string deviceName,
        string appVersion,
        string? challengeToken = null,
        string? mfaCode = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        ArgumentException.ThrowIfNullOrWhiteSpace(password);
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);

        var payload = new Dictionary<string, string?>
        {
            ["email"] = email,
            ["password"] = password,
            // A stable per-machine id, so the sessions list can name this device and the
            // server can key its throttle on the account rather than the address.
            ["deviceId"] = deviceId,
            ["deviceName"] = deviceName,
            ["platform"] = "windows",
            ["appVersion"] = appVersion,
        };

        if (challengeToken is not null)
        {
            payload["challengeToken"] = challengeToken;
        }

        if (mfaCode is not null)
        {
            payload["mfaCode"] = mfaCode;
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, "api/auth/desktop/token")
        {
            Content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json"),
        };

        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);

        // 202 means "not yet, and here is why". It has to be distinguished before the body is
        // looked at, because a challenge and a success are otherwise the same shape.
        if (response.StatusCode == HttpStatusCode.Accepted)
        {
            var challenge = await response.Content
                .ReadFromJsonAsync<MfaChallengeResponse>(cancellationToken)
                .ConfigureAwait(false);

            return new DesktopGrantResult(
                ApiResult<DesktopTokenResponse>.Failure(
                    ApiError.Unauthenticated, "MFA required", (int)response.StatusCode),
                challenge);
        }

        if (!response.IsSuccessStatusCode)
        {
            return new DesktopGrantResult(Failure<DesktopTokenResponse>(response), null);
        }

        var token = await response.Content
            .ReadFromJsonAsync<DesktopTokenResponse>(cancellationToken)
            .ConfigureAwait(false);

        if (token is null || string.IsNullOrEmpty(token.AccessToken))
        {
            return new DesktopGrantResult(
                ApiResult<DesktopTokenResponse>.Failure(
                    ApiError.Unexpected, "The server returned no credential.", (int)response.StatusCode),
                null);
        }

        return new DesktopGrantResult(ApiResult<DesktopTokenResponse>.Success(token), null);
    }

    public virtual async Task<ApiResult<DesktopTokenResponse>> RefreshAsync(
        string refreshToken,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(refreshToken);

        using var request = new HttpRequestMessage(HttpMethod.Post, "api/auth/desktop/refresh")
        {
            Content = new StringContent(
                $"{{\"refreshToken\":{JsonSerializer.Serialize(refreshToken)}}}",
                Encoding.UTF8,
                "application/json"),
        };

        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            // Every refresh failure looks the same to the client -- missing, expired, or
            // replayed -- and the only correct response to all three is to sign in again.
            return Failure<DesktopTokenResponse>(response);
        }

        var token = await response.Content
            .ReadFromJsonAsync<DesktopTokenResponse>(cancellationToken)
            .ConfigureAwait(false);

        return token is null || string.IsNullOrEmpty(token.AccessToken)
            ? ApiResult<DesktopTokenResponse>.Failure(
                ApiError.Unexpected, "The server returned no credential.", (int)response.StatusCode)
            : ApiResult<DesktopTokenResponse>.Success(token);
    }

    public async Task<ApiResult<Entitlement>> GetEntitlementAsync(
        string accessToken,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "api/desktop/entitlement");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        try
        {
            using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                var code = await ReadErrorCodeAsync(response, cancellationToken).ConfigureAwait(false);
                return ApiResult<Entitlement>.Failure(
                    MapRefusal((int)response.StatusCode, code),
                    response.ReasonPhrase ?? string.Empty,
                    (int)response.StatusCode);
            }

            var entitlement = await response.Content
                .ReadFromJsonAsync<Entitlement>(cancellationToken)
                .ConfigureAwait(false);

            return entitlement is null
                ? ApiResult<Entitlement>.Failure(ApiError.Unexpected, "Empty entitlement.", (int)response.StatusCode)
                : ApiResult<Entitlement>.Success(entitlement);
        }
        catch (Exception error) when (IsTransportError(error, cancellationToken))
        {
            // A network failure is not a server answer, and the caller has to be able to tell
            // the difference: "we could not ask" is not "you are locked" and not "you are out
            // of credit", and they call for different actions.
            return ApiResult<Entitlement>.Failure(ApiError.Unexpected, "Could not read account state.", 0);
        }
    }

    /// <summary>
    /// Sends one message and streams the answer.
    /// </summary>
    /// <remarks>
    /// The returned token usage is what the <c>done</c> frame reported, and the server
    /// charges from its own copy of it. This value exists so the UI can show what a message
    /// cost; it is never sent back as a price, because a client that could state its own cost
    /// could state a zero.
    /// </remarks>
    public async IAsyncEnumerable<StreamUpdate> StreamChatAsync(
        string accessToken,
        string modelKey,
        string message,
        string? systemPrompt = null,
        double temperature = 0.7,
        int maxTokens = 512,
        bool thinking = false,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(accessToken);
        ArgumentException.ThrowIfNullOrWhiteSpace(modelKey);
        ArgumentException.ThrowIfNullOrWhiteSpace(message);

        var payload = new Dictionary<string, object?>
        {
            ["model"] = modelKey,
            ["message"] = message,
            ["temperature"] = temperature,
            ["max_tokens"] = maxTokens,
            ["thinking"] = thinking,
        };

        if (!string.IsNullOrWhiteSpace(systemPrompt))
        {
            payload["system_prompt"] = systemPrompt;
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, "api/desktop/chat/stream")
        {
            Content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));

        // A generation legitimately runs for minutes, so the bound is generous -- but it is a
        // bound, because an unbounded stream holds a socket and a connection from the pool
        // indefinitely.
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(5));

        HttpResponseMessage? response = null;
        try
        {
            response = await _http
                .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token)
                .ConfigureAwait(false);
        }
        catch (Exception error) when (IsTransportError(error, cancellationToken))
        {
            // The upstream was unreachable. Reported as a refusal rather than an exception, so
            // the UI can show it as a state the user can retry.
        }

        if (response is null)
        {
            yield return new StreamUpdate.Refused(ApiError.Unexpected);
            yield break;
        }

        using var responseOwner = response;

        if (!response.IsSuccessStatusCode)
        {
            // The body carries a precise error code, and the status alone cannot separate
            // "the model is loading" from "we could not check your balance" -- both are 503,
            // and they call for different things from the user.
            var status = (int)response.StatusCode;
            var code = await ReadErrorCodeAsync(response, timeout.Token).ConfigureAwait(false);
            yield return new StreamUpdate.Refused(MapRefusal(status, code));
            yield break;
        }

        await using var stream = await response.Content
            .ReadAsStreamAsync(timeout.Token)
            .ConfigureAwait(false);

        var completed = false;
        await using var events = ServerSentEventStream
            .ReadAsync(stream, timeout.Token)
            .GetAsyncEnumerator(timeout.Token);

        while (true)
        {
            var moved = false;
            var failed = false;
            try
            {
                moved = await events.MoveNextAsync().ConfigureAwait(false);
            }
            catch (Exception error) when (IsTransportError(error, cancellationToken))
            {
                failed = true;
            }

            if (failed)
            {
                // The stream broke mid-answer. Whatever was received is not a completed
                // generation, and reporting it as one would be a lie the ledger would act on.
                yield return new StreamUpdate.Refused(ApiError.Upstream);
                yield break;
            }

            if (!moved)
            {
                break;
            }

            var update = ParseFrame(events.Current.Data);
            if (update is null)
            {
                continue;
            }

            // Nothing after the done frame is part of this answer.
            if (completed)
            {
                continue;
            }

            completed = update is StreamUpdate.Completed;
            yield return update;

            if (update is StreamUpdate.Refused)
            {
                yield break;
            }
        }

        if (!completed)
        {
            // The stream ended without a done frame. The model did not finish, so there is no
            // usage to bill and no answer to present as complete.
            yield return new StreamUpdate.Refused(ApiError.Upstream);
        }
    }

    /// <summary>
    /// Turns one SSE frame into an update. Returns null for anything that is not an event
    /// the UI understands, such as a keep-alive.
    /// </summary>
    internal static StreamUpdate? ParseFrame(string data)
    {
        if (string.IsNullOrWhiteSpace(data) || data == "[DONE]")
        {
            return null;
        }

        JsonElement root;
        try
        {
            using var document = JsonDocument.Parse(data);
            root = document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }

        // `done` is what ends the stream, and it is read independently of the usage block.
        //
        // Reading the two together is the bug this comment exists to prevent: a done frame
        // carrying no usage returned null, and the UI -- which stops on Completed -- would
        // keep waiting for tokens that were never coming. A generation that completes with no
        // usage block is unusual, but "the stream never ends" is a far worse failure than an
        // empty count, and the two must not be conflated.
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("done", out var done) &&
            done.ValueKind == JsonValueKind.True)
        {
            var usage = ServerSentEventReader.ReadUsage(data);
            return new StreamUpdate.Completed(usage ?? default, usage is not null);
        }

        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("delta", out var delta) &&
            delta.ValueKind == JsonValueKind.String)
        {
            return new StreamUpdate.Delta(delta.GetString() ?? string.Empty);
        }

        return null;
    }

    /// <summary>
    /// Status code to meaning. The UI keys off the enum, never off the raw code or the
    /// server's prose, so the wording lives in one place and cannot drift per caller.
    /// </summary>
    /// <summary>
    /// Turns a refusal into a meaning.
    /// </summary>
    /// <remarks>
    /// The server sends a machine-readable <c>error</c> code with every refusal, and that
    /// code is more precise than the status: 503 covers both "we could not check your
    /// balance" and "the model is loading, try again", and those call for different things
    /// from the user. The body is read for that one field, and the status is the fallback
    /// when there is no body or no code.
    /// </remarks>
    internal static ApiError MapRefusal(int status, string? errorCode)
    {
        switch (errorCode)
        {
            case "PLAYGROUND_LOCKED": return ApiError.Locked;
            case "INSUFFICIENT_BALANCE": return ApiError.OutOfFunds;
            case "BILLING_UNAVAILABLE": return ApiError.BillingUnavailable;
            // The model is loading or the slot is busy. Retryable, and nothing about money.
            case "MODEL_BUSY": return ApiError.ModelBusy;
            case "UPSTREAM_UNAVAILABLE":
            case "UPSTREAM_ERROR": return ApiError.Upstream;
            case "ACCOUNT_REQUIRED": return ApiError.Unauthenticated;
            default: return MapStatus(status);
        }
    }

    /// <summary>
    /// Reads the refusal's error code, if the body carries one.
    /// </summary>
    private static async Task<string?> ReadErrorCodeAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            var payload = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(payload)) return null;
            using var document = JsonDocument.Parse(payload);
            return document.RootElement.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.String
                ? error.GetString()
                : null;
        }
        catch (Exception error) when (error is JsonException or IOException or HttpRequestException)
        {
            // A body that cannot be read is not a reason to fail the call; the status alone
            // still classifies it.
            return null;
        }
    }

    internal static ApiError MapStatus(int status) => status switch
    {
        401 => ApiError.Unauthenticated,
        402 => ApiError.OutOfFunds,
        403 => ApiError.Locked,
        429 => ApiError.RateLimited,
        503 => ApiError.BillingUnavailable,
        >= 500 => ApiError.Upstream,
        _ => ApiError.Unexpected,
    };

    private static ApiResult<T> Failure<T>(HttpResponseMessage response)
    {
        var status = (int)response.StatusCode;
        return ApiResult<T>.Failure(MapStatus(status), response.ReasonPhrase ?? string.Empty, status);
    }

    /// <summary>
    /// Whether an exception means "the network or the server failed" rather than "the caller
    /// asked for something impossible".
    /// </summary>
    /// <remarks>
    /// A cancellation the caller did not request is a timeout, and is a transport failure.
    /// A cancellation the caller did request is the user pressing stop, and must not be
    /// swallowed into an error state.
    /// </remarks>
    private static bool IsTransportError(Exception error, CancellationToken caller) =>
        error is HttpRequestException or IOException or JsonException ||
        (error is OperationCanceledException && !caller.IsCancellationRequested);

    public void Dispose() => _http.Dispose();
}

/// <summary>One step of a streamed generation.</summary>
public abstract record StreamUpdate
{
    public sealed record Delta(string Text) : StreamUpdate;

    public sealed record Completed(TokenUsage Usage, bool UsageReported = true) : StreamUpdate;

    public sealed record Refused(ApiError Error) : StreamUpdate;
}