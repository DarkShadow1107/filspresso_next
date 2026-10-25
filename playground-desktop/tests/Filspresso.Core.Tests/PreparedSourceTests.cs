using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class PreparedSourceTests
{
    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => reply(request);
    }

    [Fact]
    public async Task FilesUseAnAuthenticatedMultipartRequestAndReturnReadableContext()
    {
        using var handler = new Handler(async request =>
        {
            Assert.EndsWith("api/playground/context/file", request.RequestUri!.AbsoluteUri, StringComparison.Ordinal);
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.False(request.Headers.Contains("Cookie"));
            Assert.Equal("multipart/form-data", request.Content!.Headers.ContentType?.MediaType);
            Assert.Contains("file-content-marker", await request.Content.ReadAsStringAsync(), StringComparison.Ordinal);
            return new(HttpStatusCode.OK) { Content = new StringContent("{\"name\":\"code.txt\",\"kind\":\"document\",\"text\":\"file-content-marker\",\"warnings\":[]}", Encoding.UTF8, "application/json") };
        });
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        using var contents = new MemoryStream(Encoding.UTF8.GetBytes("file-content-marker"));
        var result = await api.PrepareFileAsync("fixture-token", "code.txt", contents);
        Assert.True(result.Ok);
        Assert.Equal("file-content-marker", result.Value!.Text);
    }

    [Fact]
    public async Task RepositoryErrorsRemainActionable()
    {
        using var handler = new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound)
        { Content = new StringContent("{\"error\":\"ATTACHMENT_ERROR\",\"details\":{\"message\":\"This repository is private or missing.\"}}", Encoding.UTF8, "application/json") }));
        using var api = new DesktopApiClient(new Uri("http://localhost/"), handler);
        var result = await api.PrepareGithubAsync("fixture-token", "https://github.com/owner/project");
        Assert.False(result.Ok);
        Assert.Contains("private or missing", result.Message, StringComparison.Ordinal);
    }
}
