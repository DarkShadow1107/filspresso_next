using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>
/// The installer-metadata call and the system check-in, against a stubbed server.
/// </summary>
/// <remarks>
/// Neither call is user-visible work: the first feeds a passive "newer build exists" line
/// and the second charges nothing and gates nothing. What is under test here is the shape
/// they put on the wire (the server validates it) and the honesty of the parsing -- an
/// unparseable version must not be claimed as an update.
/// </remarks>
public class InstallerUpdateTests
{
    private sealed class StubHandler : HttpMessageHandler
    {
        public string ResponseBody { get; set; } = "{}";
        public int StatusCode { get; set; } = 200;
        public string? LastBody { get; private set; }
        public string? LastAuthorization { get; private set; }
        public string? LastPath { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            LastAuthorization = request.Headers.Authorization?.ToString();
            LastPath = request.RequestUri?.ToString();
            return new HttpResponseMessage((HttpStatusCode)StatusCode)
            {
                Content = new StringContent(ResponseBody, System.Text.Encoding.UTF8, "application/json"),
            };
        }
    }

    private static readonly Uri Backend = new("http://localhost:4000/");

    [Fact]
    public async Task InstallerMetadataIsParsedFromTheServer()
    {
        var handler = new StubHandler
        {
            ResponseBody = """
            {"available":true,"fileName":"Filspresso.Playground.msi","canDownload":true,
             "productVersion":"0.4.0","sha256":"abc123","bytes":80978388,
             "unsigned":true,"acknowledged":false,"acknowledgementRequired":true}
            """,
        };
        using var api = new DesktopApiClient(Backend, handler);

        var outcome = await api.GetInstallerUpdateAsync("token");

        Assert.True(outcome.Ok);
        Assert.NotNull(outcome.Value);
        Assert.True(outcome.Value!.Available);
        Assert.Equal("0.4.0", outcome.Value.ProductVersion);
        Assert.Equal("abc123", outcome.Value.Sha256);
        Assert.Equal(80978388L, outcome.Value.Bytes);
        Assert.True(outcome.Value.Unsigned);
        Assert.False(outcome.Value.Acknowledged);
        // The right route was called, carrying the bearer token.
        Assert.EndsWith("/api/desktop/installer", handler.LastPath, StringComparison.Ordinal);
        Assert.Equal("Bearer token", handler.LastAuthorization);
    }

    [Fact]
    public async Task ALockAnswerIsClassifiedAsLocked()
    {
        var handler = new StubHandler
        {
            StatusCode = 403,
            ResponseBody = """{"error":"SPECTRE_REQUIRED"}""",
        };
        using var api = new DesktopApiClient(Backend, handler);

        var outcome = await api.GetInstallerUpdateAsync("token");

        Assert.False(outcome.Ok);
        Assert.Equal(ApiError.Locked, outcome.Error);
        Assert.Null(outcome.Value);
    }

    [Fact]
    public async Task DeviceStateIsPostedWithEveryReusableField()
    {
        var handler = new StubHandler { ResponseBody = """{"recorded":true}""" };
        using var api = new DesktopApiClient(Backend, handler);

        var report = new DeviceStateReport
        {
            DeviceId = "device-1234567890123456",
            DeviceName = "ALEX-PC",
            OsEdition = "Pro",
            OsBuild = 26100,
            OsUbr = 4061,
            AppVersion = "0.3.2",
        };

        var outcome = await api.PostDeviceStateAsync("token", report);

        Assert.True(outcome.Ok);
        Assert.True(outcome.Value);
        Assert.EndsWith("/api/desktop/device-state", handler.LastPath, StringComparison.Ordinal);
        Assert.Equal("Bearer token", handler.LastAuthorization);
        // The server normalises these field names; the client sends exactly the camelCase shape.
        Assert.Contains("\"deviceId\":\"device-1234567890123456\"", handler.LastBody);
        Assert.Contains("\"osEdition\":\"Pro\"", handler.LastBody);
        Assert.Contains("\"osBuild\":26100", handler.LastBody);
        Assert.Contains("\"osUbr\":4061", handler.LastBody);
        Assert.Contains("\"appVersion\":\"0.3.2\"", handler.LastBody);
    }

    [Fact]
    public async Task AnUnknownFieldReadRefusesToBeAPlausibleFact()
    {
        var handler = new StubHandler { ResponseBody = """{"recorded":true}""" };
        using var api = new DesktopApiClient(Backend, handler);

        var report = new DeviceStateReport
        {
            DeviceId = "device-1234567890123456",
            DeviceName = Environment.MachineName,
            // The probe refused: no edition, no build. They must travel as nulls, because the
            // server stores what it receives and a zero would read back as a real build.
            OsEdition = null,
            OsBuild = null,
            OsUbr = null,
            AppVersion = "0.3.2",
        };

        var outcome = await api.PostDeviceStateAsync("token", report);

        Assert.True(outcome.Ok);
        // Nulls are omitted rather than written as zeros: 0 would be a plausible lie.
        Assert.DoesNotContain("osEdition", handler.LastBody);
        Assert.DoesNotContain("osBuild", handler.LastBody);
    }

    [Fact]
    public async Task ASuppressedServiceIsNotBilledSpectreLock()
    {
        var handler = new StubHandler
        {
            StatusCode = 503,
            ResponseBody = """{"error":"INSTALLER_SERVICE"}""",
        };
        using var api = new DesktopApiClient(Backend, handler);

        var outcome = await api.PostDeviceStateAsync("token", new DeviceStateReport { DeviceId = "device-1234567890123456" });

        Assert.False(outcome.Ok);
        Assert.Equal(ApiError.BillingUnavailable, outcome.Error);
    }

    [Theory]
    [InlineData("0.4.0", "0.3.2", true)]
    [InlineData("0.3.2", "0.3.2", false)]
    [InlineData("0.3.2", "0.4.0", false)]
    [InlineData("0.10.0", "0.9.0", true)]   // numeric field comparison, not string compare
    [InlineData("0.3.2", "garbage", true)]  // an unparseable running version cannot block a real one
    public void VersionRulesDecideWhetherTheNoticeIsShown(string? published, string running, bool expected)
    {
        var update = new InstallerUpdate { ProductVersion = published };
        Assert.Equal(expected, update.IsNewerThan(running));
    }

    [Fact]
    public void AMalformedPublishedVersionIsNeverClaimedAsAnUpdate()
    {
        // "A newer build exists" is client-visible text; a server answer that cannot be
        // parsed must suppress the notice rather than show it with an invented version.
        var update = new InstallerUpdate { ProductVersion = "not-a-version" };
        Assert.False(update.IsNewerThan("0.3.2"));
        Assert.False(new InstallerUpdate().IsNewerThan("0.3.2"));
    }
}
