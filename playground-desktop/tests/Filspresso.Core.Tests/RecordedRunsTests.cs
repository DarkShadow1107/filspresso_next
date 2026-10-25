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
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class RecordedRunsTests
{
    private const string RunId = "exec-0123456789abcdef01234567";
    private const string SessionId = "00000000-0000-4000-8000-000000000001";
    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => reply(request);
    }
    private static HttpResponseMessage Json(string text, HttpStatusCode status = HttpStatusCode.OK) => new(status) { Content = new StringContent(text, Encoding.UTF8, "application/json") };
    private static string Event(int sequence, string kind = "execution.output", int version = 1) => JsonSerializer.Serialize(new { run_id = RunId, sequence_number = sequence, kind, version, status = "pending", payload = new { text = "output" } });
    private static string Page(string events, bool hasMore = false, int? cursor = null) => $"{{\"version\":1,\"runId\":\"{RunId}\",\"events\":[{events}],\"hasMore\":{hasMore.ToString().ToLowerInvariant()},\"nextAfterSequence\":{(cursor.HasValue ? cursor.Value.ToString() : "null")}}}";

    [Fact]
    public async Task DiscoveryUsesAuthenticatedGetAndKeepsAProvidedSessionFilter()
    {
        var paths = new List<string>();
        using var handler = new Handler(request =>
        {
            paths.Add(request.RequestUri!.PathAndQuery);
            Assert.Equal(HttpMethod.Get, request.Method);
            Assert.Null(request.Content);
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.False(request.Headers.Contains("Cookie"));
            return Task.FromResult(Json("""
                {"version":1,"runs":[{"run_id":"exec-0123456789abcdef01234567","event_count":402,"outcome":"pending","truncated":true,"settlement_failed":true},{"run_id":"../bad"},null]}
                """));
        });
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        var result = await api.ListRunsAsync("fixture-token");
        Assert.True(result.Ok);
        var run = Assert.Single(result.Value!);
        Assert.Equal(402, run.EventCount);
        Assert.True(run.Truncated);
        Assert.True(run.SettlementFailed);
        Assert.Equal("No completion recorded", run.OutcomeLabel);
        Assert.Contains("hosted Docker", run.LocationLabel, StringComparison.Ordinal);
        await api.ListRunsAsync("fixture-token", SessionId);
        Assert.Equal("/api/playground/runs?limit=20", paths[0]);
        Assert.Equal($"/api/playground/runs?limit=20&sessionUuid={SessionId}", paths[1]);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(9999, 50)]
    public async Task DiscoveryClampsItsLimit(int requested, int expected)
    {
        using var handler = new Handler(request =>
        {
            Assert.Equal($"/api/playground/runs?limit={expected}", request.RequestUri!.PathAndQuery);
            return Task.FromResult(Json("{\"version\":1,\"runs\":[]}"));
        });
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        Assert.True((await api.ListRunsAsync("fixture-token", limit: requested)).Ok);
    }

    [Fact]
    public async Task ReplayReadsPastTruncationAndSequenceGapsWithoutSubmittingACommand()
    {
        using var handler = new Handler(request =>
        {
            Assert.Equal(HttpMethod.Get, request.Method);
            Assert.Null(request.Content);
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            return Task.FromResult(Json(request.RequestUri!.Query.EndsWith("afterSequence=-1", StringComparison.Ordinal)
                ? Page($"{Event(399)},{Event(400, "run.truncated")}", true, 400)
                : Page($"{Event(900, "execution.finished")},{Event(901, "settlement.failed")}")));
        });
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        var first = await api.ReplayRunAsync("fixture-token", RunId);
        Assert.True(first.Ok);
        Assert.True(first.Value!.HasMore);
        Assert.Equal(400, first.Value.NextAfterSequence);
        var next = await api.ReplayRunAsync("fixture-token", RunId, first.Value.NextAfterSequence!.Value);
        Assert.True(next.Ok);
        Assert.Equal(new[] { "execution.finished", "settlement.failed" }, next.Value!.Events.Select(entry => entry.Kind));
        Assert.False(next.Value.HasMore);
        Assert.Null(next.Value.NextAfterSequence);
        Assert.Contains("output", next.Value.Events[0].DisplayPayload().Text, StringComparison.Ordinal); // Payload survives document disposal.
    }

    [Theory]
    [InlineData("{\"version\":2,\"runs\":[]}")]
    [InlineData("null")]
    [InlineData("not json")]
    public async Task InvalidOrUnsupportedDiscoveryDoesNotFabricateEmptyHistory(string payload)
    {
        using var handler = new Handler(_ => Task.FromResult(Json(payload)));
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        var result = await api.ListRunsAsync("fixture-token");
        Assert.False(result.Ok);
        Assert.Null(result.Value);
    }

    [Fact]
    public async Task BadIdsAndFiltersNeverIssueRequestsOrWidenToAccountHistory()
    {
        var calls = 0;
        using var handler = new Handler(_ => { calls++; return Task.FromResult(Json("{}")); });
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        Assert.False((await api.ListRunsAsync("fixture-token", "")).Ok);
        Assert.False((await api.ListRunsAsync("fixture-token", "../all")).Ok);
        Assert.False((await api.ReplayRunAsync("fixture-token", "../all")).Ok);
        Assert.False((await api.ReplayRunAsync("fixture-token", RunId, -2)).Ok);
        Assert.Equal(0, calls);
    }

    [Fact]
    public async Task ReplayRejectsWrongRunsRepeatedSequencesAndInvalidCursors()
    {
        var payload = Page($"{Event(1)},{Event(1)}");
        using var handler = new Handler(_ => Task.FromResult(Json(payload)));
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        foreach (var malformed in new[]
        {
            payload,
            Page($"{Event(2)},{Event(1)}"),
            Page(Event(1), true, 0),
            Page(Event(1)).Replace(RunId, "dsk-aaaaaaaaaaaaaaaaaaaaaaaa", StringComparison.Ordinal),
            $"{{\"version\":1,\"runId\":\"{RunId}\",\"events\":[]}}",
            Page(string.Join(",", Enumerable.Range(0, 101).Select(index => Event(index)))),
        })
        {
            payload = malformed;
            var result = await api.ReplayRunAsync("fixture-token", RunId);
            Assert.False(result.Ok);
            Assert.Null(result.Value);
        }
    }

    [Fact]
    public async Task UnknownEventVersionsAndHtmlRemainDataAndClippingIsDisclosed()
    {
        var payload = Page(Event(0, "future.command", 2));
        using var handler = new Handler(_ => Task.FromResult(Json(payload)));
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        var result = await api.ReplayRunAsync("fixture-token", RunId);
        Assert.True(result.Ok);
        Assert.Equal(2, Assert.Single(result.Value!.Events).Version);
        using var future = JsonDocument.Parse("[\"future array data\"]");
        Assert.Contains("future array data", (result.Value.Events[0] with { Payload = future.RootElement.Clone() }).DisplayPayload().Text, StringComparison.Ordinal);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(new { command = "<script>never execute</script>", nested = new { textTruncated = true } }));
        var entry = new RecordedRunEvent { Payload = json.RootElement.Clone() };
        var display = entry.DisplayPayload();
        Assert.True(display.Clipped);
        Assert.Contains("never execute", display.Text, StringComparison.Ordinal);
        using var large = JsonDocument.Parse(JsonSerializer.Serialize(new { text = new string('x', 50_000) }));
        display = (entry with { Payload = large.RootElement.Clone() }).DisplayPayload();
        Assert.True(display.Clipped);
        Assert.True(display.Text.Length < 17_000);
        Assert.Contains("Display clipped", display.Text, StringComparison.Ordinal);
        Assert.Equal("No completion recorded", new RecordedRun { Outcome = "running" }.OutcomeLabel);
        Assert.Contains("Chat did not execute code", new RecordedRun { RunId = "dsk-aaaaaaaaaaaaaaaaaaaaaaaa" }.LocationLabel, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, ApiError.Unauthenticated)]
    [InlineData(HttpStatusCode.ServiceUnavailable, ApiError.BillingUnavailable)]
    public async Task HttpRefusalsRemainFailuresNotEmptySuccessfulReads(HttpStatusCode status, ApiError expected)
    {
        using var handler = new Handler(_ => Task.FromResult(Json("{}", status)));
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        var result = await api.ListRunsAsync("fixture-token");
        Assert.False(result.Ok);
        Assert.Null(result.Value);
        Assert.Equal(expected, result.Error);
    }

    [Fact]
    public async Task CancellationPropagatesWhileTransportFailuresBecomeUnavailableResults()
    {
        using var handler = new Handler(_ => throw new HttpRequestException("offline"));
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        var failed = await api.ReplayRunAsync("fixture-token", RunId);
        Assert.False(failed.Ok);
        Assert.Null(failed.Value);
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => api.ReplayRunAsync("fixture-token", RunId, cancellationToken: cancellation.Token));
    }
}
