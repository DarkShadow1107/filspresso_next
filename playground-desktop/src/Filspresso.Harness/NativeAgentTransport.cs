using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Core.Auth;
using Filspresso.Core.Streaming;

namespace Filspresso.Harness;

public sealed record NativeAgentCapabilities(string[] Models);

public interface INativeAgentModelTransport
{
    bool SupportsConversation => false;
    bool SupportsModel(string model);
    Task<ApiResult<NativeAgentCapabilities>> GetCapabilitiesAsync(CancellationToken cancellationToken = default);
    Task<AgentModelReply> SendAsync(AgentModelRequest request, CancellationToken cancellationToken = default);
}

/// <summary>
/// Authenticated, non-retrying model transport only. It owns no sandbox, tool dispatcher or
/// approval UI. Capabilities must be loaded explicitly; server configuration defaults to none.
/// Every SendAsync refreshes authentication and the server gates/meters that individual turn.
/// </summary>
public sealed class NativeAgentTransport : INativeAgentModelTransport, IDisposable
{
    private const int MaxBytes = 1_048_576;
    private readonly HttpClient _http;
    private readonly IAuthSession _auth;
    private readonly int _inputContextTokens;
    private readonly string? _sessionUuid;
    private readonly string _compactionMode;
    private string[] _models = Array.Empty<string>();
    private int _conversationSupported;
    public bool SupportsConversation => Volatile.Read(ref _conversationSupported) == 1;
    private static readonly Regex RunId = new(@"\Adsk-[0-9a-f]{24}\z", RegexOptions.CultureInvariant);
    private static readonly Regex CallId = new(@"\A[A-Za-z0-9_-]{1,64}\z", RegexOptions.CultureInvariant);
    private static readonly Regex SessionId = new(@"\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z", RegexOptions.CultureInvariant);

    public NativeAgentTransport(Uri backend, IAuthSession auth, int inputContextTokens = 16_384, string? sessionUuid = null, HttpMessageHandler? handler = null, string compactionMode = "balanced")
    {
        ArgumentNullException.ThrowIfNull(backend); ArgumentNullException.ThrowIfNull(auth);
        if (!backend.IsAbsoluteUri || backend.Scheme is not ("http" or "https")) throw new ArgumentException("An HTTP backend origin is required.", nameof(backend));
        if (inputContextTokens is not (16_384 or 32_768 or 65_536 or 131_072)) throw new ArgumentOutOfRangeException(nameof(inputContextTokens));
        if (sessionUuid is not null && !SessionId.IsMatch(sessionUuid)) throw new ArgumentException("Invalid session id.", nameof(sessionUuid));
        if (compactionMode is not ("permissive" or "balanced" or "aggressive")) throw new ArgumentException("Invalid compaction mode.", nameof(compactionMode));
        _compactionMode = compactionMode;
        _auth = auth; _inputContextTokens = inputContextTokens; _sessionUuid = sessionUuid;
        _http = new HttpClient(handler ?? new HttpClientHandler { UseCookies = false, AllowAutoRedirect = false }, true)
        { BaseAddress = backend, Timeout = Timeout.InfiniteTimeSpan };
    }

    public bool SupportsModel(string model) => Volatile.Read(ref _models).Contains(model, StringComparer.Ordinal);

    public async Task<ApiResult<NativeAgentCapabilities>> GetCapabilitiesAsync(CancellationToken cancellationToken = default)
    {
        Volatile.Write(ref _models, Array.Empty<string>());
        Volatile.Write(ref _conversationSupported, 0);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken); deadline.CancelAfter(TimeSpan.FromSeconds(8));
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "api/desktop/agent/capabilities");
            if (!await AuthorizeAsync(request, deadline.Token).ConfigureAwait(false)) return ApiResult<NativeAgentCapabilities>.Failure(ApiError.Unauthenticated, "Sign in again.", 401);
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token).WaitAsync(deadline.Token).ConfigureAwait(false);
            using var document = await ReadAsync(response, deadline.Token).ConfigureAwait(false);
            var root = document.RootElement;
            if (!response.IsSuccessStatusCode || !VersionOne(root) || !root.TryGetProperty("protocol", out var protocol) || protocol.GetString() != "native-v1" ||
                !root.TryGetProperty("executesTools", out var executes) || executes.ValueKind != JsonValueKind.False ||
                !root.TryGetProperty("models", out var rows) || rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() > 6)
                throw new InvalidDataException();
            var models = rows.EnumerateArray().Select(row => row.GetString()).ToArray();
            if (models.Any(model => model is null || model.Length is 0 or > 64) || models.Distinct(StringComparer.Ordinal).Count() != models.Length) throw new InvalidDataException();
            Volatile.Write(ref _models, models.Select(model => model!).ToArray());
            Volatile.Write(ref _conversationSupported, root.TryGetProperty("conversationProtocol", out var conversation) && conversation.GetString() == "completed-turns-v1" &&
                root.TryGetProperty("interactionProtocols", out var protocols) && protocols.ValueKind == JsonValueKind.Array && protocols.EnumerateArray().Any(item => item.ValueKind == JsonValueKind.String && item.GetString() == "question-v1") ? 1 : 0);
            return ApiResult<NativeAgentCapabilities>.Success(new NativeAgentCapabilities(models.Select(model => model!).ToArray()));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { Volatile.Write(ref _models, Array.Empty<string>()); Volatile.Write(ref _conversationSupported, 0); throw; }
        catch (Exception) { Volatile.Write(ref _models, Array.Empty<string>()); Volatile.Write(ref _conversationSupported, 0); return ApiResult<NativeAgentCapabilities>.Failure(ApiError.Upstream, "Native agent capability is unavailable.", 503); }
    }

    public async Task<AgentModelReply> SendAsync(AgentModelRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        cancellationToken.ThrowIfCancellationRequested();
        if (!SupportsModel(request.Turn.ModelKey) || request.Turn.Mode is not (AgentMode.Plan or AgentMode.Build))
            return new AgentModelReply.Refused(ApiError.Upstream, "Native agent mode is not enabled for this model. Plain chat remains available.");
        if ((request.Turn.Conversation.Count > 0 || request.Tools.Any(tool => tool.Effect == ToolEffect.Interaction)) && !SupportsConversation)
            return new AgentModelReply.Refused(ApiError.Upstream, "The server has not advertised the conversation/question protocol.");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken); deadline.CancelAfter(TimeSpan.FromSeconds(130));
        try
        {
            var payload = new
            {
                version = 1, model = request.Turn.ModelKey, mode = request.Turn.Mode == AgentMode.Plan ? "plan" : "build",
                message = request.Turn.UserMessage, system_prompt = request.Turn.SystemPrompt ?? string.Empty,
                temperature = request.Turn.Temperature, max_tokens = request.Turn.MaxTokens, input_context_tokens = _inputContextTokens,
                compaction_mode = _compactionMode,
                tools = request.Tools.Select(tool => new { name = tool.Name, description = tool.Description,
                    effect = tool.Effect == ToolEffect.ReadOnly ? "read_only" : tool.Effect == ToolEffect.Mutation ? "mutation" : tool.Effect == ToolEffect.Interaction ? "interaction" : "execution", parameters = tool.Parameters.ToJsonSchema() }).ToArray(),
                history = HistoryPayload(request.History),
                conversation = request.Turn.Conversation.Count == 0 ? null : request.Turn.Conversation.Select(turn => new { message = turn.UserMessage,
                    text = turn.AssistantText, history = HistoryPayload(turn.History) }).ToArray(),
                session_uuid = _sessionUuid,
            };
            var options = new JsonSerializerOptions { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };
            var bytes = JsonSerializer.SerializeToUtf8Bytes(payload, options);
            if (bytes.Length > MaxBytes) return new AgentModelReply.Refused(ApiError.InputContextExceeded, "Native agent request exceeds 1 MiB. No tool pairs were dropped.");
            using var httpRequest = new HttpRequestMessage(HttpMethod.Post, "api/desktop/agent/turn") { Content = new ByteArrayContent(bytes) };
            httpRequest.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
            if (!await AuthorizeAsync(httpRequest, deadline.Token).ConfigureAwait(false)) return new AgentModelReply.Refused(ApiError.Unauthenticated, "Sign in again.");
            using var response = await _http.SendAsync(httpRequest, HttpCompletionOption.ResponseHeadersRead, deadline.Token).WaitAsync(deadline.Token).ConfigureAwait(false);
            using var document = await ReadAsync(response, deadline.Token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode) return Refusal(response.StatusCode, document.RootElement);
            return ParseReply(document.RootElement, request);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception) { return new AgentModelReply.Refused(ApiError.Upstream, "Native agent response failed, was invalid or timed out. No automatic retry was attempted."); }
    }

    private async Task<bool> AuthorizeAsync(HttpRequestMessage request, CancellationToken token)
    {
        if (!await _auth.EnsureAccessTokenAsync(token).WaitAsync(token).ConfigureAwait(false) || _auth.Current is null) return false;
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _auth.Current.AccessToken);
        request.Headers.CacheControl = new CacheControlHeaderValue { NoStore = true };
        return true;
    }

    private AgentModelReply ParseReply(JsonElement root, AgentModelRequest request)
    {
        if (!VersionOne(root) || !root.TryGetProperty("runId", out var id) || !RunId.IsMatch(id.GetString() ?? string.Empty) ||
            !root.TryGetProperty("settlement", out var settlement) || settlement.GetString() != "succeeded" ||
            !root.TryGetProperty("text", out var text) || text.GetString() is not { Length: <= 32_768 } answer ||
            !root.TryGetProperty("usage", out var usage) || !usage.TryGetProperty("prompt_tokens", out var input) || !input.TryGetInt32(out var inputTokens) || inputTokens < 0 ||
            !usage.TryGetProperty("completion_tokens", out var output) || !output.TryGetInt32(out var outputTokens) || outputTokens < 0 || outputTokens > request.Turn.MaxTokens || (long)inputTokens + outputTokens == 0 ||
            !root.TryGetProperty("tool_calls", out var rows) || rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() > 8 ||
            !root.TryGetProperty("finish_reason", out var finish)) throw new InvalidDataException();
        var reason = finish.GetString();
        if (!((reason == "stop" && rows.GetArrayLength() == 0) || (reason == "tool_calls" && rows.GetArrayLength() > 0))) throw new InvalidDataException();
        var tools = request.Tools.ToDictionary(tool => tool.Name, StringComparer.Ordinal);
        var seen = new HashSet<string>(request.History.Concat(request.Turn.Conversation.SelectMany(turn => turn.History)).SelectMany(group => group.Invocations.Select(item => item.Call.Id)), StringComparer.Ordinal);
        var calls = new List<ToolCall>();
        foreach (var row in rows.EnumerateArray())
        {
            var callId = row.GetProperty("id").GetString(); var name = row.GetProperty("name").GetString(); var arguments = row.GetProperty("arguments").GetString();
            if (callId is null || !CallId.IsMatch(callId) || !seen.Add(callId) || name is null || !tools.TryGetValue(name, out var tool) || !tool.Parameters.TryValidate(arguments, out _)) throw new InvalidDataException();
            calls.Add(new ToolCall(callId, name, arguments!));
        }
        if (seen.Count > 48) throw new InvalidDataException();
        if (calls.Any(call => call.Name == "question") && calls.Count != 1) throw new InvalidDataException();
        var compaction = ParseCompaction(root, request, inputTokens, outputTokens);
        return new AgentModelReply.Completed(answer, new TokenUsage(inputTokens, outputTokens), Array.AsReadOnly(calls.ToArray()),
            reason == "stop" ? AgentFinishReason.Answer : AgentFinishReason.ToolCalls) { RunId = id.GetString(), SettlementRecorded = true, Compaction = compaction };
    }

    private AgentCompactionReceipt? ParseCompaction(JsonElement root, AgentModelRequest request, int input, int output)
    {
        if (!root.TryGetProperty("compaction", out var value)) return null; // Additive compatibility.
        if (value.GetProperty("mode").GetString() != _compactionMode || value.GetProperty("inputLimit").GetInt32() != _inputContextTokens ||
            !value.GetProperty("tokensBefore").TryGetInt32(out var before) || before < 0 || !value.GetProperty("tokensAfter").TryGetInt32(out var after) || after < 0)
            throw new InvalidDataException();
        var compacted = value.GetProperty("compacted").GetBoolean();
        var groups = value.GetProperty("consumedGroups").GetInt32();
        string? summary = null; TokenUsage? usage = null;
        if (compacted)
        {
            summary = value.GetProperty("summary").GetString();
            var counts = value.GetProperty("usage");
            var prompt = counts.GetProperty("prompt_tokens").GetInt32();
            var completion = counts.GetProperty("completion_tokens").GetInt32();
            var fraction = _compactionMode == "permissive" ? .8 : _compactionMode == "aggressive" ? .45 : .65;
            if (groups < 1 || groups >= request.History.Count + request.Turn.Conversation.Count || string.IsNullOrWhiteSpace(summary) || summary.Length > 32_000 || after >= before ||
                after >= Math.Min((int)(_inputContextTokens * fraction), 131_072 - request.Turn.MaxTokens - 256) ||
                prompt < 0 || prompt > input || completion < 0 || completion > Math.Min(output, Math.Min(2048, request.Turn.MaxTokens / 4)) || (long)prompt + completion == 0)
                throw new InvalidDataException();
            usage = new TokenUsage(prompt, completion);
        }
        else if (groups != 0 || before != after || value.TryGetProperty("summary", out _) || value.GetProperty("usage").ValueKind != JsonValueKind.Null)
            throw new InvalidDataException();
        return new(_compactionMode, _inputContextTokens, before, after, compacted, groups, summary, usage);
    }

    private static object[] HistoryPayload(IReadOnlyList<AgentExchange> history) => history.Select(group => new { text = group.AssistantText,
        tool_calls = group.Invocations.Select(item => new { id = item.Call.Id, name = item.Call.Name, arguments = item.Call.ArgumentsJson }).ToArray(),
        tool_results = group.Invocations.Select(item => new { tool_call_id = item.Call.Id, content = item.InteractionContent ?? JsonSerializer.Serialize(new
        { stdout = item.Result.StandardOutput, stderr = item.Result.StandardError, exitCode = item.Result.ExitCode, timedOut = item.Result.TimedOut, refused = item.Refused, truncated = item.OutputTruncated }) }).ToArray() }).ToArray();

    private static AgentModelReply Refusal(HttpStatusCode status, JsonElement body)
    {
        var code = body.ValueKind == JsonValueKind.Object && body.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.String ? error.GetString() : null;
        var kind = code == "BILLING_UNAVAILABLE" ? ApiError.BillingUnavailable : code == "MODEL_BUSY" ? ApiError.ModelBusy : status switch
        { HttpStatusCode.Unauthorized => ApiError.Unauthenticated, HttpStatusCode.Forbidden => ApiError.Locked, HttpStatusCode.PaymentRequired => ApiError.OutOfFunds,
          HttpStatusCode.RequestEntityTooLarge => ApiError.InputContextExceeded, HttpStatusCode.TooManyRequests => ApiError.RateLimited, _ => ApiError.Upstream };
        return new AgentModelReply.Refused(kind, "Native agent turn was refused. No automatic retry or tool execution was attempted.");
    }

    private static bool VersionOne(JsonElement root) => root.ValueKind == JsonValueKind.Object && root.TryGetProperty("version", out var version) && version.TryGetInt32(out var number) && number == 1;
    private static async Task<JsonDocument> ReadAsync(HttpResponseMessage response, CancellationToken token)
    {
        if (response.Content.Headers.ContentLength > MaxBytes) throw new InvalidDataException();
        await using var stream = await response.Content.ReadAsStreamAsync(token).ConfigureAwait(false);
        using var buffer = new MemoryStream(); var bytes = new byte[8192];
        for (;;)
        {
            var count = await stream.ReadAsync(bytes.AsMemory(), token).AsTask().WaitAsync(token).ConfigureAwait(false);
            if (count == 0) break;
            if (buffer.Length + count > MaxBytes) throw new InvalidDataException();
            buffer.Write(bytes, 0, count);
        }
        return JsonDocument.Parse(buffer.ToArray(), new JsonDocumentOptions { MaxDepth = 16 });
    }
    public void Dispose() => _http.Dispose();
}
