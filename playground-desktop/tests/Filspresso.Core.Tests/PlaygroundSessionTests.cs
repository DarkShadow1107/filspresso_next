using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Core.Auth;
using Filspresso.Core.Session;
using Filspresso.Core.Streaming;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>
/// The behaviour that makes the desktop client's Playground honest: the pre-flight refuses
/// before any work, a refusal becomes a state rather than an error, a broken stream is not
/// presented as a completed message, and the balance is refreshed once the work is settled.
/// </summary>
public class PlaygroundSessionTests
{
    private static Entitlement State(bool access = true, bool funds = true, bool selectedCanPay = true) => new()
    {
        Access = new SpectreAccess { HasAccess = access, Source = access ? "tier" : null },
        CanGenerate = funds,
        Models = new[]
        {
            new ModelEntry
            {
                ModelKey = "test-model",
                Label = "Test model",
                InputPer1M = 2m,
                OutputPer1M = 10m,
                UsesAllowance = true,
                CanGenerate = selectedCanPay,
                Locked = !access,
            },
        },
    };

    private sealed class Handler : HttpMessageHandler
    {
        public Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> Respond { get; set; } =
            (_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Respond(request, ct);
    }

    private static async Task<(DesktopApiClient api, PlaygroundSession session)> Build(
        Handler handler,
        Func<CancellationToken, Task<ApiResult<Entitlement>>> load)
    {
        var api = new DesktopApiClient(new Uri("http://localhost:4000/"), handler);
        var store = new InMemoryCredentialStore();
        await store.SaveAsync(StoredSession.From(
            new DesktopTokenResponse
            {
                AccessToken = "valid-access",
                RefreshToken = "refresh",
                ExpiresIn = 900,
                RefreshExpiresIn = 3600,
            },
            "test@example.test",
            "device-1234567890123456",
            DateTimeOffset.UtcNow));

        var auth = new AuthSessionManager(api, store, new SystemClock(), "device-1234567890123456", "Test", "0.1.0");
        await auth.RestoreAsync();
        return (api, new PlaygroundSession(api, auth, load));
    }

    private static async Task<List<PlaygroundEvent>> Read(PlaygroundSession session, CancellationToken ct = default)
    {
        var events = new List<PlaygroundEvent>();
        await foreach (var item in session.SendAsync("hello", "test-model", cancellationToken: ct))
        {
            events.Add(item);
        }

        return events;
    }

    [Fact]
    public async Task NativeContextAndThinkingSettingsReachTheGateway()
    {
        string? sent = null;
        var handler = new Handler
        {
            Respond = async (request, ct) =>
            {
                sent = await request.Content!.ReadAsStringAsync(ct);
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("data: {\"reasoning\":\"Think first\"}\n\ndata: {\"delta\":\"Answer\"}\n\ndata: {\"done\":true,\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2}}\n\n", Encoding.UTF8, "text/event-stream"),
                };
            },
        };
        var (api, session) = await Build(handler, _ => Task.FromResult(ApiResult<Entitlement>.Success(State())));
        using (api)
        {
            var events = new List<PlaygroundEvent>();
            await foreach (var item in session.SendAsync("hello", "test-model", maxTokens: 131072, thinking: true)) events.Add(item);
            using var payload = System.Text.Json.JsonDocument.Parse(sent!);
            Assert.Equal(131072, payload.RootElement.GetProperty("max_tokens").GetInt32());
            Assert.True(payload.RootElement.GetProperty("thinking").GetBoolean());
            Assert.Equal("Think first", Assert.Single(events.OfType<PlaygroundEvent.Think>()).Text);
            Assert.Equal("Answer", Assert.Single(events.OfType<PlaygroundEvent.Say>()).Text);
            Assert.Single(events.OfType<PlaygroundEvent.Finished>());
        }
    }

    [Theory]
    [InlineData(false, true, true, PlaygroundAvailability.NoAccess)]
    [InlineData(true, false, false, PlaygroundAvailability.OutOfFunds)]
    [InlineData(true, true, false, PlaygroundAvailability.OutOfFunds)]
    public async Task FreshPreflightBlocksWorkBeforeAnHttpGeneration(
        bool access, bool funds, bool modelPays, PlaygroundAvailability expected)
    {
        var calls = 0;
        var handler = new Handler
        {
            Respond = (_, _) =>
            {
                calls++;
                throw new InvalidOperationException("Must not call upstream");
            },
        };

        var (api, session) = await Build(handler, _ => Task.FromResult(
            ApiResult<Entitlement>.Success(State(access, funds, modelPays))));

        using (api)
        {
            var stopped = Assert.IsType<PlaygroundEvent.Stopped>(Assert.Single(await Read(session)));
            Assert.Equal(expected, stopped.Availability);
            Assert.Equal(0, calls);
        }
    }

    [Theory]
    [InlineData(401, PlaygroundAvailability.SignedOut)]
    [InlineData(402, PlaygroundAvailability.OutOfFunds)]
    [InlineData(403, PlaygroundAvailability.NoAccess)]
    [InlineData(503, PlaygroundAvailability.BillingUnavailable)]
    [InlineData(429, PlaygroundAvailability.RateLimited)]
    public async Task ARefusalAfterPreflightBecomesAPersistentState(int status, PlaygroundAvailability expected)
    {
        var handler = new Handler
        {
            Respond = (_, _) => Task.FromResult(new HttpResponseMessage((HttpStatusCode)status)),
        };

        var (api, session) = await Build(handler, _ => Task.FromResult(ApiResult<Entitlement>.Success(State())));

        using (api)
        {
            var stopped = Assert.IsType<PlaygroundEvent.Stopped>(Assert.Single(await Read(session)));
            Assert.Equal(expected, stopped.Availability);
            Assert.Equal(expected, session.Availability);
        }
    }

    [Fact]
    public async Task SplitUtf8FramesStreamAndRefreshBeforeFinishedIsObserved()
    {
        var loads = 0;
        var handler = new Handler
        {
            Respond = (request, _) =>
            {
                // The bearer token, and no cookie: the backend's CSRF guard passes a
                // Bearer-only caller through precisely so a native client has a path that
                // needs no cookie jar.
                Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
                Assert.Equal("valid-access", request.Headers.Authorization?.Parameter);
                Assert.False(request.Headers.Contains("Cookie"));

                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StreamContent(new OneByteStream(Encoding.UTF8.GetBytes(
                        "data: {\"delta\":\"café ☕\"}\r\n\r\n" +
                        "data: {\"done\":true,\"usage\":{\"prompt_tokens\":1000,\"completion_tokens\":200}}\n\n"))),
                });
            },
        };

        var (api, session) = await Build(handler, _ =>
        {
            loads++;
            return Task.FromResult(ApiResult<Entitlement>.Success(State(funds: loads == 1)));
        });

        using (api)
        {
            var output = await Read(session);

            Assert.Equal("café ☕", Assert.IsType<PlaygroundEvent.Say>(output[0]).Text);
            // 1000 input at 2.00 and 200 output at 10.00, per 1M tokens.
            Assert.Equal(0.004m, Assert.IsType<PlaygroundEvent.Finished>(output[1]).Usage.EstimatedCostRon);
            // The balance is refreshed before the completion is published, so even a caller
            // that stops at the completion has the settled figure.
            Assert.Equal(2, loads);
            Assert.Equal(PlaygroundAvailability.OutOfFunds, session.Availability);
        }
    }

    [Fact]
    public async Task PrematureEofDoesNotPretendThatTheMessageCompleted()
    {
        var handler = new Handler
        {
            Respond = (_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("data: {\"delta\":\"partial\"}\n\n"),
            }),
        };

        var (api, session) = await Build(handler, _ => Task.FromResult(ApiResult<Entitlement>.Success(State())));

        using (api)
        {
            var output = await Read(session);
            Assert.IsType<PlaygroundEvent.Say>(output[0]);
            Assert.Equal(
                PlaygroundAvailability.ModelUnavailable,
                Assert.IsType<PlaygroundEvent.Stopped>(output[1]).Availability);
            // No completion: a stream that ended early is not a finished generation, and
            // presenting it as one would be a claim the ledger cannot back.
            Assert.DoesNotContain(output, x => x is PlaygroundEvent.Finished);
        }
    }

    [Fact]
    public async Task CancellingAnHttpSendReleasesTheSingleGenerationGate()
    {
        var handler = new Handler
        {
            Respond = async (_, ct) =>
            {
                await Task.Delay(Timeout.Infinite, ct);
                return new HttpResponseMessage();
            },
        };

        var (api, session) = await Build(handler, _ => Task.FromResult(ApiResult<Entitlement>.Success(State())));

        using (api)
        using (var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(50)))
        {
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Read(session, cts.Token));
            // The gate is released, or the next message would be refused as "already running".
            Assert.False(session.IsSending);
        }
    }

    [Fact]
    public async Task NetworkFailureLoadingEntitlementBecomesAnUnreachableState()
    {
        using var api = new DesktopApiClient(
            new Uri("http://localhost/"),
            new Handler { Respond = (_, _) => throw new HttpRequestException("offline") });

        var state = await api.GetEntitlementAsync("test");

        // Not Unauthenticated: the network failed, which is not the same as being signed out,
        // and the two call for different actions.
        Assert.False(state.Ok);
        Assert.Equal(ApiError.Unexpected, state.Error);
    }

    [Fact]
    public void BlankLineAndMultiLineEventsCanBeSplitAtEveryCharacterBoundary()
    {
        const string frame = "data: first\r\ndata: second\r\n\r\n";
        for (var split = 0; split <= frame.Length; split++)
        {
            var events = ServerSentEventReader.Feed("", frame[..split], out var pending).ToList();
            events.AddRange(ServerSentEventReader.Feed(pending, frame[split..], out _));
            Assert.Equal("first\nsecond", Assert.Single(events).Data);
        }
    }

    /// <summary>A stream that delivers one byte at a time, which is where framing breaks.</summary>
    private sealed class OneByteStream(byte[] bytes) : MemoryStream(bytes)
    {
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default) =>
            base.ReadAsync(buffer[..Math.Min(1, buffer.Length)], ct);
    }
}
