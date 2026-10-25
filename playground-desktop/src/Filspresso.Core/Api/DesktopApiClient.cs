using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Serialization;
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
    InputContextExceeded,
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
    private readonly HttpClient _sourcesHttp;

    // A session write that is missing a field means "leave what is stored", not "erase it":
    // null properties are omitted so a patch can never wipe the checkpoint it did not carry.
    private static readonly JsonSerializerOptions SessionWriteOptions = new() { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

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
        _sourcesHttp = handler is null
            ? new HttpClient(new HttpClientHandler { UseCookies = false, AllowAutoRedirect = false })
            : new HttpClient(handler, disposeHandler: false);
        _sourcesHttp.BaseAddress = backendBaseAddress;
        _sourcesHttp.Timeout = TimeSpan.FromMinutes(16);
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
        int inputContextTokens = 16_384,
        IReadOnlyList<PreparedSource>? contexts = null,
        IReadOnlyList<ChatTurn>? history = null,
        string compactionMode = "balanced",
        bool compactNow = false,
        string? sessionUuid = null,
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
            ["input_context_tokens"] = inputContextTokens,
            ["contexts"] = contexts ?? Array.Empty<PreparedSource>(),
            ["history"] = history ?? Array.Empty<ChatTurn>(),
            ["compaction_mode"] = compactionMode,
            ["compact_now"] = compactNow,
        };

        if (!string.IsNullOrWhiteSpace(systemPrompt))
        {
            payload["system_prompt"] = systemPrompt;
        }

        // Conversation linkage: server-owned run events group a conversation's generations
        // for replay and retention. The value is a uuid the server itself issued for a
        // session row; anything else is omitted and the run simply stays unlinked.
        if (!string.IsNullOrWhiteSpace(sessionUuid))
        {
            payload["session_uuid"] = sessionUuid;
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
        timeout.CancelAfter(TimeSpan.FromMinutes(16));

        HttpResponseMessage? response = null;
        try
        {
            response = await _sourcesHttp
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
    /// Calls the web tool on the server.
    /// </summary>
    /// <remarks>
    /// The request goes to the backend rather than to the web directly, because the backend is
    /// where the egress allowlist lives, so a deployment decides what may leave the network,
    /// and because the request is authenticated as the user rather than being an open proxy.
    /// <para>
    /// The status is returned as well as the body, because the body of a refusal is where the
    /// reason is, and the reason is what the model needs to try something else.
    /// </para>
    /// </remarks>
    public async Task<(int Status, JsonDocument Body)> PostWebAsync(
        string accessToken,
        string action,
        object payload,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(accessToken);
        ArgumentException.ThrowIfNullOrWhiteSpace(action);

        // The body is the action plus the payload's own fields. Built as a dictionary rather
        // than an anonymous object with a spread, because C# has no spread and the payload is
        // already a bag of named values.
        var requestBody = new Dictionary<string, object?> { ["action"] = action };
        foreach (var field in Extract(payload))
        {
            requestBody[field.Key] = field.Value;
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, "api/desktop/web")
        {
            Content = new StringContent(
                JsonSerializer.Serialize(requestBody),
                Encoding.UTF8,
                "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        try
        {
            using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            var text = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            var body = string.IsNullOrWhiteSpace(text)
                ? JsonDocument.Parse("{}")
                : JsonDocument.Parse(text);
            return ((int)response.StatusCode, body);
        }
        catch (Exception error) when (IsTransportError(error, cancellationToken))
        {
            var body = JsonDocument.Parse("{}");
            return (0, body);
        }
    }

    /// <summary>
    /// The payload's own fields, so they can sit beside `action` in the body.
    /// </summary>
    private static Dictionary<string, object?> Extract(object payload)
    {
        if (payload is Dictionary<string, object?> dictionary) return dictionary;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(payload));
        var result = new Dictionary<string, object?>();
        foreach (var property in document.RootElement.EnumerateObject())
        {
            result[property.Name] = property.Value.ValueKind switch
            {
                JsonValueKind.String => property.Value.GetString(),
                JsonValueKind.Number => property.Value.GetDouble(),
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => null,
            };
        }
        return result;
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

        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("context", out var context) && context.ValueKind == JsonValueKind.Object)
        {
            var state = context.Deserialize<ContextState>();
            if (state is not null) return new StreamUpdate.Context(state);
        }

        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("reasoning", out var reasoning) &&
            reasoning.ValueKind == JsonValueKind.String)
        {
            return new StreamUpdate.Reasoning(reasoning.GetString() ?? string.Empty);
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
            case "INPUT_CONTEXT_EXCEEDED": return ApiError.InputContextExceeded;
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
        413 => ApiError.InputContextExceeded,
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

    /// <summary>
    /// The account's server-saved conversations, newest first.
    /// </summary>
    /// <remarks>
    /// Every row is account-scoped server-side; the client sees only its own. One response
    /// row that cannot parse is skipped rather than allowed to cost the whole list.
    /// </remarks>
    public async Task<ApiResult<IReadOnlyList<SavedSession>>> ListSessionsAsync(string accessToken, int limit = 20, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(accessToken);
        var bounded = Math.Clamp(limit, 1, 200);
        using var request = new HttpRequestMessage(HttpMethod.Get, $"api/playground/sessions?limit={bounded}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        try
        {
            using var response = await _sourcesHttp.SendAsync(request, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                var code = await ReadErrorCodeAsync(response, cancellationToken).ConfigureAwait(false);
                return ApiResult<IReadOnlyList<SavedSession>>.Failure(
                    MapRefusal((int)response.StatusCode, code),
                    response.ReasonPhrase ?? string.Empty,
                    (int)response.StatusCode);
            }
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken).ConfigureAwait(false);
            var sessions = new List<SavedSession>();
            if (document.RootElement.ValueKind == JsonValueKind.Object && document.RootElement.TryGetProperty("sessions", out var rows) && rows.ValueKind == JsonValueKind.Array)
            {
                foreach (var row in rows.EnumerateArray())
                {
                    try
                    {
                        var saved = row.Deserialize<SavedSession>();
                        if (SavedSession.IsSessionUuid(saved?.SessionUuid)) sessions.Add(saved!);
                    }
                    catch (JsonException) { }
                }
            }
            return ApiResult<IReadOnlyList<SavedSession>>.Success(sessions);
        }
        catch (Exception error) when (IsTransportError(error, cancellationToken))
        { return ApiResult<IReadOnlyList<SavedSession>>.Failure(ApiError.Unexpected, "Saved conversations are unavailable right now. Please retry.", 0); }
    }

    /// <summary>The list contains metadata only; fetch the selected row's checkpoint before resuming.</summary>
    public async Task<ApiResult<SavedSession>> GetSessionAsync(string accessToken, string sessionUuid, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(accessToken);
        cancellationToken.ThrowIfCancellationRequested();
        if (!SavedSession.IsSessionUuid(sessionUuid))
            return ApiResult<SavedSession>.Failure(ApiError.Unexpected, "Invalid saved conversation id.", 400);
        using var request = new HttpRequestMessage(HttpMethod.Get, $"api/playground/sessions/{Uri.EscapeDataString(sessionUuid)}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        try
        {
            using var response = await _sourcesHttp.SendAsync(request, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                var code = await ReadErrorCodeAsync(response, cancellationToken).ConfigureAwait(false);
                return ApiResult<SavedSession>.Failure(MapRefusal((int)response.StatusCode, code), "This saved conversation could not be opened. Please retry.", (int)response.StatusCode);
            }
            var saved = await response.Content.ReadFromJsonAsync<SavedSession>(cancellationToken).ConfigureAwait(false);
            return saved is not null && saved.SessionUuid == sessionUuid
                ? ApiResult<SavedSession>.Success(saved)
                : ApiResult<SavedSession>.Failure(ApiError.Unexpected, "The server returned an invalid saved conversation.", 502);
        }
        catch (Exception error) when (IsTransportError(error, cancellationToken))
        { return ApiResult<SavedSession>.Failure(ApiError.Unexpected, "This saved conversation could not be opened. Please retry.", 0); }
    }

    /// <summary>Latest account-owned runs; a supplied session filter is never silently widened.</summary>
    public Task<ApiResult<IReadOnlyList<RecordedRun>>> ListRunsAsync(string accessToken, string? sessionUuid = null, int limit = 20, CancellationToken cancellationToken = default)
    {
        if (sessionUuid is not null && !SavedSession.IsSessionUuid(sessionUuid))
            return Task.FromResult(ApiResult<IReadOnlyList<RecordedRun>>.Failure(ApiError.Unexpected, "Invalid saved conversation id.", 400));
        var bounded = Math.Clamp(limit, 1, 50);
        var path = $"api/playground/runs?limit={bounded}" + (sessionUuid is null ? string.Empty : $"&sessionUuid={Uri.EscapeDataString(sessionUuid)}");
        return ReadRunStateAsync<IReadOnlyList<RecordedRun>>(accessToken, path, root =>
        {
            if (!root.TryGetProperty("runs", out var rows) || rows.ValueKind != JsonValueKind.Array) return null;
            var runs = new List<RecordedRun>();
            foreach (var row in rows.EnumerateArray().Take(bounded))
            {
                try
                {
                    var run = row.Deserialize<RecordedRun>();
                    if (RecordedRun.IsRunId(run?.RunId)) runs.Add(run!);
                }
                catch (JsonException) { }
            }
            return runs;
        }, cancellationToken);
    }

    /// <summary>One read-only event page. No command or transcript is submitted or replayed into chat.</summary>
    public Task<ApiResult<RunReplayPage>> ReplayRunAsync(string accessToken, string runId, int afterSequence = -1, int limit = 100, CancellationToken cancellationToken = default)
    {
        if (!RecordedRun.IsRunId(runId) || afterSequence < -1)
            return Task.FromResult(ApiResult<RunReplayPage>.Failure(ApiError.Unexpected, "Invalid recorded activity id or cursor.", 400));
        var bounded = Math.Clamp(limit, 1, 400);
        return ReadRunStateAsync<RunReplayPage>(accessToken, $"api/playground/runs/{runId}?limit={bounded}&afterSequence={afterSequence}", root =>
        {
            if (!root.TryGetProperty("runId", out var id) || id.ValueKind != JsonValueKind.String || id.GetString() != runId ||
                !root.TryGetProperty("events", out var rows) || rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() > bounded ||
                !root.TryGetProperty("hasMore", out var more) || more.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return null;
            var events = new List<RecordedRunEvent>();
            var last = afterSequence;
            foreach (var row in rows.EnumerateArray())
            {
                var entry = row.Deserialize<RecordedRunEvent>();
                if (entry is null || entry.RunId != runId || entry.Sequence <= last || entry.Version < 1 || string.IsNullOrEmpty(entry.Kind)) return null;
                last = entry.Sequence;
                events.Add(entry);
            }
            var hasMore = more.GetBoolean();
            if (hasMore && (events.Count == 0 || !root.TryGetProperty("nextAfterSequence", out var cursor) || cursor.ValueKind != JsonValueKind.Number || !cursor.TryGetInt32(out var next) || next != last)) return null;
            return new RunReplayPage(events.ToArray(), hasMore, hasMore ? last : null);
        }, cancellationToken);
    }

    private async Task<ApiResult<T>> ReadRunStateAsync<T>(string accessToken, string path, Func<JsonElement, T?> parse, CancellationToken cancellationToken) where T : class
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(accessToken);
        cancellationToken.ThrowIfCancellationRequested();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(8));
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        try
        {
            using var response = await _sourcesHttp.SendAsync(request, timeout.Token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                var code = await ReadErrorCodeAsync(response, timeout.Token).ConfigureAwait(false);
                return ApiResult<T>.Failure(MapRefusal((int)response.StatusCode, code), "Recorded activity is unavailable. Please retry or sign in again.", (int)response.StatusCode);
            }
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token).ConfigureAwait(false);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: timeout.Token).ConfigureAwait(false);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var format) || format != 1)
                return ApiResult<T>.Failure(ApiError.Unexpected, "This activity format is not supported. Please update the client.", 502);
            var value = parse(root);
            return value is null ? ApiResult<T>.Failure(ApiError.Unexpected, "The server returned invalid recorded activity.", 502) : ApiResult<T>.Success(value);
        }
        catch (Exception error) when (IsTransportError(error, cancellationToken))
        { return ApiResult<T>.Failure(ApiError.Unexpected, "Recorded activity is unavailable. Please retry.", 0); }
    }

    /// <summary>
    /// Creates one conversation's server session, or updates the row already named.
    /// </summary>
    /// <remarks>
    /// On success the server's own session uuid comes back, so the caller can link the next
    /// generation. A 404 while patching means the row was deleted elsewhere; the caller may
    /// retry with a null uuid to recreate it.
    /// </remarks>
    public async Task<ApiResult<string>> SaveSessionAsync(string accessToken, string? sessionUuid, SessionWrite write, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(accessToken);
        ArgumentNullException.ThrowIfNull(write);
        using var request = new HttpRequestMessage(
            string.IsNullOrWhiteSpace(sessionUuid) ? HttpMethod.Post : HttpMethod.Patch,
            string.IsNullOrWhiteSpace(sessionUuid) ? "api/playground/sessions" : $"api/playground/sessions/{Uri.EscapeDataString(sessionUuid)}")
        { Content = new StringContent(JsonSerializer.Serialize(write, SessionWriteOptions), Encoding.UTF8, "application/json") };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        try
        {
            using var response = await _sourcesHttp.SendAsync(request, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                var code = await ReadErrorCodeAsync(response, cancellationToken).ConfigureAwait(false);
                return ApiResult<string>.Failure(
                    MapRefusal((int)response.StatusCode, code),
                    response.ReasonPhrase ?? string.Empty,
                    (int)response.StatusCode);
            }
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken).ConfigureAwait(false);
            return document.RootElement.ValueKind == JsonValueKind.Object && document.RootElement.TryGetProperty("session_uuid", out var uuid) && uuid.ValueKind == JsonValueKind.String
                && SavedSession.IsSessionUuid(uuid.GetString())
                ? ApiResult<string>.Success(uuid.GetString()!)
                : ApiResult<string>.Failure(ApiError.Unexpected, "The server did not identify the saved conversation.", 502);
        }
        catch (Exception error) when (IsTransportError(error, cancellationToken))
        { return ApiResult<string>.Failure(ApiError.Unexpected, "The conversation could not be saved. Please retry.", 0); }
    }

    /// <summary>
    /// Forgets one server-saved conversation, purging the run events linked to it in the
    /// same request — the single honest consent gesture for "this history is not wanted".
    /// </summary>
    public async Task<ApiResult<bool>> DeleteSessionAsync(string accessToken, string sessionUuid, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(accessToken);
        ArgumentException.ThrowIfNullOrWhiteSpace(sessionUuid);
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"api/playground/sessions/{Uri.EscapeDataString(sessionUuid)}?purge=1");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        try
        {
            using var response = await _sourcesHttp.SendAsync(request, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                var code = await ReadErrorCodeAsync(response, cancellationToken).ConfigureAwait(false);
                return ApiResult<bool>.Failure(
                    MapRefusal((int)response.StatusCode, code),
                    response.ReasonPhrase ?? string.Empty,
                    (int)response.StatusCode);
            }
            return ApiResult<bool>.Success(true);
        }
        catch (Exception error) when (IsTransportError(error, cancellationToken))
        { return ApiResult<bool>.Failure(ApiError.Unexpected, "The saved conversation could not be deleted. Please retry.", 0); }
    }

    public async Task<ApiResult<PreparedSource>> PrepareFileAsync(string accessToken, string filename, Stream contents, CancellationToken cancellationToken = default)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new StreamContent(contents), "file", filename);
        return await PrepareSourceAsync(accessToken, "file", form, cancellationToken).ConfigureAwait(false);
    }

    public async Task<ApiResult<PreparedSource>> PrepareGithubAsync(string accessToken, string url, CancellationToken cancellationToken = default)
    {
        using var body = new StringContent(JsonSerializer.Serialize(new { url }), Encoding.UTF8, "application/json");
        return await PrepareSourceAsync(accessToken, "github", body, cancellationToken).ConfigureAwait(false);
    }

    private async Task<ApiResult<PreparedSource>> PrepareSourceAsync(string accessToken, string kind, HttpContent body, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"api/playground/context/{kind}") { Content = body };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        try
        {
            using var response = await _sourcesHttp.SendAsync(request, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                var raw = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
                string message = "This source could not be read.";
                string? code = null;
                try
                {
                    using var json = JsonDocument.Parse(raw);
                    var root = json.RootElement;
                    var detail = root.TryGetProperty("details", out var details) && details.ValueKind == JsonValueKind.Object ? details : root;
                    if (detail.TryGetProperty("message", out var field) && field.ValueKind == JsonValueKind.String) message = field.GetString()!;
                    if (root.TryGetProperty("error", out var errorCode) && errorCode.ValueKind == JsonValueKind.String) code = errorCode.GetString();
                }
                catch (JsonException) { }
                return ApiResult<PreparedSource>.Failure(MapRefusal((int)response.StatusCode, code), message, (int)response.StatusCode);
            }
            var source = await response.Content.ReadFromJsonAsync<PreparedSource>(cancellationToken).ConfigureAwait(false);
            return source is not null && !string.IsNullOrWhiteSpace(source.Text) ? ApiResult<PreparedSource>.Success(source)
                : ApiResult<PreparedSource>.Failure(ApiError.Unexpected, "No readable context was returned.", 502);
        }
        catch (Exception error) when (IsTransportError(error, cancellationToken))
        { return ApiResult<PreparedSource>.Failure(ApiError.Unexpected, "Source processing is unavailable. Please retry.", 0); }
    }

    public void Dispose() { _http.Dispose(); _sourcesHttp.Dispose(); }
}

/// <summary>One step of a streamed generation.</summary>
public abstract record StreamUpdate
{
    public sealed record Context(ContextState State) : StreamUpdate;
    public sealed record Delta(string Text) : StreamUpdate;

    public sealed record Reasoning(string Text) : StreamUpdate;

    public sealed record Completed(TokenUsage Usage, bool UsageReported = true) : StreamUpdate;

    public sealed record Refused(ApiError Error) : StreamUpdate;
}
