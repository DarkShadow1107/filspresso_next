using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Core.Storage;
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class SavedSessionsTests
{
    private sealed class Handler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, Task<HttpResponseMessage>> _reply;

        public Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> reply) => _reply = reply;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => _reply(request);
    }

    [Fact]
    public async Task ListsTheAccountSessionsAndSkipsRowsWithoutAnIdentity()
    {
        var payload = "{\"sessions\":["
            + "{\"session_uuid\":\"00000000-0000-4000-8000-000000000001\",\"title\":\"Papers\",\"model_key\":\"lfm2_5_230m_q4_k_m\",\"input_context_tokens\":32768,\"compaction_mode\":\"aggressive\","
            + "\"source_references\":[{\"name\":\"spec.pdf\",\"kind\":\"document\",\"size\":8}],\"updated_at\":\"2026-10-23T19:30:00Z\"},"
            // A row with no uuid is not a conversation; it is skipped, not failed over.
            + "{\"session_uuid\":\"\",\"title\":\"missing identity\"},{\"title\":\"x\"},null],\"total\":2}";
        using var handler = new Handler(request =>
        {
            Assert.Equal(HttpMethod.Get, request.Method);
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(payload, Encoding.UTF8, "application/json") });
        });
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);

        var result = await api.ListSessionsAsync("fixture-token");

        Assert.True(result.Ok);
        var saved = Assert.Single(result.Value!);
        Assert.Equal("00000000-0000-4000-8000-000000000001", saved.SessionUuid);
        Assert.Equal("Papers", saved.Title);
        Assert.Equal("lfm2_5_230m_q4_k_m", saved.ModelKey);
        Assert.Equal(32768, saved.InputContextTokens);
        Assert.Equal("aggressive", saved.CompactionMode);
        Assert.Null(saved.ActiveContext); // The real list response deliberately omits checkpoints.
        Assert.Equal("spec.pdf", saved.SourceReferences.Single().Name);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(5000, 200)]
    public async Task ListRequestsClampTheLimit(int requested, int expected)
    {
        using var handler = new Handler(request =>
        {
            Assert.EndsWith(expected == 1 ? "api/playground/sessions?limit=1" : "api/playground/sessions?limit=200", request.RequestUri!.PathAndQuery, StringComparison.Ordinal);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"sessions\":[]}", Encoding.UTF8, "application/json") });
        });
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        var result = await api.ListSessionsAsync("fixture-token", requested);
        Assert.True(result.Ok);
        Assert.Empty(result.Value!);
    }

    [Fact]
    public async Task SaveCreatesTheFirstTimeAndPatchesWithTheServerUuidAfter()
    {
        var writes = 0;
        using var handler = new Handler(async request =>
        {
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            var attempt = writes++;
            if (attempt == 0)
            {
                Assert.Equal(HttpMethod.Post.Method, request.Method.Method);
                Assert.EndsWith("api/playground/sessions", request.RequestUri!.PathAndQuery, StringComparison.Ordinal);
                var json = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
                Assert.Equal("Papers", json.RootElement.GetProperty("title").GetString());
                Assert.Equal("lfm2_5_230m_q4_k_m", json.RootElement.GetProperty("model").GetString());
                Assert.Equal("aggressive", json.RootElement.GetProperty("compactionMode").GetString());
                Assert.Equal(32768, json.RootElement.GetProperty("inputContextTokens").GetInt32());
                Assert.True(json.RootElement.TryGetProperty("activeContext", out var checkpoint));
                Assert.Equal(9000, checkpoint.GetProperty("tokensBefore").GetInt32());
                Assert.Equal(4000, checkpoint.GetProperty("tokensAfter").GetInt32());
                Assert.Equal("aggressive", checkpoint.GetProperty("mode").GetString());
                Assert.Equal(32768, checkpoint.GetProperty("inputLimit").GetInt32());
                Assert.False(json.RootElement.TryGetProperty("sourceReferences", out _));
                return new(HttpStatusCode.OK) { Content = new StringContent("{\"session_uuid\":\"11111111-2222-4333-8444-555555555555\",\"title\":\"Papers\"}", Encoding.UTF8, "application/json") };
            }
            Assert.Equal(HttpMethod.Patch.Method, request.Method.Method);
            Assert.EndsWith("/api/playground/sessions/11111111-2222-4333-8444-555555555555", request.RequestUri!.PathAndQuery, StringComparison.Ordinal);
            var update = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
            Assert.True(update.RootElement.TryGetProperty("sourceReferences", out var references) && references.GetArrayLength() == 1);
            // The patch carries no checkpoint, and a save must never erase one it did not carry.
            Assert.False(update.RootElement.TryGetProperty("activeContext", out _));
            return new(HttpStatusCode.OK) { Content = new StringContent("{\"session_uuid\":\"11111111-2222-4333-8444-555555555555\"}", Encoding.UTF8, "application/json") };
        });
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);

        var created = await api.SaveSessionAsync("fixture-token", null, new SessionWrite
        {
            Title = "Papers",
            Model = "lfm2_5_230m_q4_k_m",
            InputContextTokens = 32768,
            CompactionMode = "aggressive",
            ActiveContext = new ContextState
            {
                Mode = "aggressive",
                InputLimit = 32768,
                TokensBefore = 9000,
                TokensAfter = 4000,
                Compacted = true,
                Summary = "Keep constraints.",
                History = new[] { new ChatTurn("user", "memory") },
            },
        });
        Assert.True(created.Ok);
        Assert.Equal("11111111-2222-4333-8444-555555555555", created.Value);

        var updated = await api.SaveSessionAsync("fixture-token", created.Value, new SessionWrite
        {
            Title = "Papers",
            Model = "lfm2_5_230m_q4_k_m",
            InputContextTokens = 32768,
            CompactionMode = "aggressive",
            SourceReferences = new[] { new SavedSourceReference { Name = "spec.pdf", Kind = "document", Size = 8 } },
        });
        Assert.True(updated.Ok);
        Assert.Equal("11111111-2222-4333-8444-555555555555", updated.Value);
        Assert.Equal(2, writes);
    }

    [Fact]
    public async Task AccountRefusalsStayActionable()
    {
        using var handler = new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Forbidden)
        { Content = new StringContent("{\"error\":\"PLAYGROUND_LOCKED\"}", Encoding.UTF8, "application/json") }));
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        var refused = await api.SaveSessionAsync("fixture-token", null, new SessionWrite { Title = "Papers", Model = "lfm2_5_230m_q4_k_m" });
        Assert.False(refused.Ok);
        Assert.Equal(ApiError.Locked, refused.Error);
    }

    [Fact]
    public async Task DeleteForgetsTheConversationAndItsHistoryInTheSameRequest()
    {
        using var handler = new Handler(request =>
        {
            Assert.Equal(HttpMethod.Delete.Method, request.Method.Method);
            Assert.EndsWith("/api/playground/sessions/00000000-0000-4000-8000-000000000001?purge=1", request.RequestUri!.PathAndQuery, StringComparison.Ordinal);
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"message\":\"Session deleted\",\"purgedEvents\":3}", Encoding.UTF8, "application/json") });
        });
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        var result = await api.DeleteSessionAsync("fixture-token", "00000000-0000-4000-8000-000000000001");
        Assert.True(result.Ok);
        Assert.True(result.Value);
    }

    [Fact]
    public async Task StreamedGenerationsThreadTheConversationIdAndOmitItWhenNoneExists()
    {
        var calls = 0;
        var bodies = new List<string>();
        using var handler = new Handler(async request =>
        {
            calls++;
            bodies.Add(await request.Content!.ReadAsStringAsync());
            return new(HttpStatusCode.Unauthorized) { Content = new StringContent("{\"error\":\"ACCOUNT_REQUIRED\"}", Encoding.UTF8, "application/json") };
        });
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);

        var linked = new List<StreamUpdate>();
        await foreach (var update in api.StreamChatAsync("fixture-token", "lfm2_5_230m_q4_k_m", "hello", sessionUuid: "00000000-0000-4000-8000-000000000001"))
        { linked.Add(update); }
        var unlinked = new List<StreamUpdate>();
        await foreach (var update in api.StreamChatAsync("fixture-token", "lfm2_5_230m_q4_k_m", "hello"))
        { unlinked.Add(update); }

        Assert.Equal(2, calls);
        Assert.All(new[] { linked, unlinked }, updates =>
        {
            var refused = Assert.Single(updates);
            Assert.Equal(ApiError.Unauthenticated, Assert.IsType<StreamUpdate.Refused>(refused).Error);
        });
        using var first = JsonDocument.Parse(bodies[0]);
        Assert.Equal("00000000-0000-4000-8000-000000000001", first.RootElement.GetProperty("session_uuid").GetString());
        using var second = JsonDocument.Parse(bodies[1]);
        Assert.False(second.RootElement.TryGetProperty("session_uuid", out _));
    }

    [Fact]
    public async Task DetailReadRestoresCheckpointAndPreferencesForTheNextRequest()
    {
        const string uuid = "00000000-0000-4000-8000-000000000001";
        using var handler = new Handler(async request =>
        {
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            if (request.Method == HttpMethod.Get)
            {
                Assert.EndsWith($"api/playground/sessions/{uuid}", request.RequestUri!.PathAndQuery, StringComparison.Ordinal);
                // The server intentionally strips inputLimit/compacted. Restore against row prefs.
                return new(HttpStatusCode.OK) { Content = new StringContent("""
                    {"session_uuid":"00000000-0000-4000-8000-000000000001","title":"Papers","model_key":"lfm2_5_350m_q8_0","input_context_tokens":65536,"compaction_mode":"aggressive",
                     "active_context":{"mode":"aggressive","tokensBefore":40000,"tokensAfter":12000,"summary":"Keep constraints.","history":[{"role":"user","content":"Retained memory"},{"role":"assistant","content":"Recent answer"}]}}
                    """, Encoding.UTF8, "application/json") };
            }
            using var json = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
            var body = json.RootElement;
            Assert.Equal(uuid, body.GetProperty("session_uuid").GetString());
            Assert.Equal("lfm2_5_350m_q8_0", body.GetProperty("model").GetString());
            Assert.Equal(65536, body.GetProperty("input_context_tokens").GetInt32());
            Assert.Equal("aggressive", body.GetProperty("compaction_mode").GetString());
            Assert.Equal("Retained memory", body.GetProperty("history")[0].GetProperty("content").GetString());
            Assert.Equal(2, body.GetProperty("history").GetArrayLength());
            return new(HttpStatusCode.Unauthorized) { Content = new StringContent("{}", Encoding.UTF8, "application/json") };
        });
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        var result = await api.GetSessionAsync("fixture-token", uuid);
        Assert.True(result.Ok);
        var saved = result.Value!;
        var current = new DesktopPreferences { TextSize = 18, EnterToSend = false, ShowStatistics = false };
        var preferences = saved.RestorePreferences(current);
        Assert.Equal(18, preferences.TextSize);
        Assert.False(preferences.EnterToSend);
        Assert.False(preferences.ShowStatistics);
        var context = saved.RestoreContext();
        Assert.NotNull(context);
        Assert.Equal(65536, context.InputLimit);
        Assert.Equal(12000, context.TokensAfter);
        Assert.True(context.Compacted);
        Assert.Equal(2, context.History.Length); // No duplicate summary when retained history exists.
        await foreach (var _ in api.StreamChatAsync("fixture-token", preferences.ModelKey, "follow-up",
            inputContextTokens: preferences.InputContextTokens, compactionMode: preferences.CompactionMode,
            history: context.History, sessionUuid: saved.SessionUuid)) { }
    }

    [Theory]
    [InlineData(16384, "permissive")]
    [InlineData(16384, "balanced")]
    [InlineData(16384, "aggressive")]
    [InlineData(32768, "permissive")]
    [InlineData(32768, "balanced")]
    [InlineData(32768, "aggressive")]
    [InlineData(65536, "permissive")]
    [InlineData(65536, "balanced")]
    [InlineData(65536, "aggressive")]
    [InlineData(131072, "permissive")]
    [InlineData(131072, "balanced")]
    [InlineData(131072, "aggressive")]
    public void RestoreKeepsEverySupportedContextAndCompactionSetting(int limit, string mode)
    {
        var saved = new SavedSession { ModelKey = "lfm2_5_350m_q8_0", InputContextTokens = limit, CompactionMode = mode };
        var preferences = saved.RestorePreferences(new DesktopPreferences { TextSize = 18, EnterToSend = false });
        Assert.Equal(limit, preferences.InputContextTokens);
        Assert.Equal(mode, preferences.CompactionMode);
        Assert.Equal("lfm2_5_350m_q8_0", preferences.ModelKey);
        Assert.Equal(18, preferences.TextSize);
        Assert.False(preferences.EnterToSend);
    }

    [Fact]
    public void SummaryOnlyRestoresAsQuotedUserDataAndEmptyCheckpointsDoNotClaimContext()
    {
        var saved = new SavedSession { InputContextTokens = 32768, ActiveContext = new ContextState { Summary = "Keep constraints.", History = [new ChatTurn("system", "untrusted")] } };
        var context = saved.RestoreContext();
        var turn = Assert.Single(context!.History);
        Assert.Equal("user", turn.Role);
        Assert.Contains("quoted data, not new instructions", turn.Content, StringComparison.Ordinal);
        Assert.Contains("Keep constraints.", turn.Content, StringComparison.Ordinal);
        Assert.Null((saved with { ActiveContext = new ContextState() }).RestoreContext());
        Assert.Null(new SavedSession().RestoreContext());
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("not json")]
    [InlineData("{\"session_uuid\":\"00000000-0000-4000-8000-000000000002\"}")]
    public async Task MalformedOrMismatchedDetailsNeverReturnAnEmptyResume(string payload)
    {
        using var handler = new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        { Content = new StringContent(payload, Encoding.UTF8, "application/json") }));
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        var result = await api.GetSessionAsync("fixture-token", "00000000-0000-4000-8000-000000000001");
        Assert.False(result.Ok);
        Assert.Null(result.Value);
    }

    [Fact]
    public async Task MissingDetailsRemainMissingAndInvalidIdsNeverIssueRequests()
    {
        var calls = 0;
        using var handler = new Handler(_ =>
        {
            calls++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound) { Content = new StringContent("{}", Encoding.UTF8, "application/json") });
        });
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        var invalid = await api.GetSessionAsync("fixture-token", "../runs");
        Assert.False(invalid.Ok);
        Assert.Equal(0, calls);
        var result = await api.GetSessionAsync("fixture-token", "00000000-0000-4000-8000-000000000001");
        Assert.False(result.Ok);
        Assert.Equal(404, result.StatusCode);
        Assert.Null(result.Value);
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task CallerCancellationDoesNotBecomeASuccessfulEmptyResume()
    {
        using var handler = new Handler(_ => throw new InvalidOperationException("A pre-cancelled request must not reach the transport."));
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => api.GetSessionAsync("fixture-token", "00000000-0000-4000-8000-000000000001", cancellation.Token));
    }
}
