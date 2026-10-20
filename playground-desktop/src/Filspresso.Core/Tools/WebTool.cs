using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Core.Auth;

namespace Filspresso.Core.Tools;

/// <summary>
/// The web search and page fetch, as the model sees them.
/// </summary>
/// <remarks>
/// These run on the **host**, and that is not a compromise -- it is the design. The sandbox is
/// a virtual machine with no network adapter, so generated code cannot reach the internet, and
/// that is what stops it exfiltrating what it reads or fetching something to execute.
/// <para>
/// The model still needs to look things up. So the harness performs the lookup here, on the
/// host, and writes the result into the sandbox as a file. The sandbox never has a socket, so
/// the boundary is exactly as strong as before; there is simply one trusted step outside it.
/// </para>
/// <para>
/// The host calls the <b>backend</b> rather than the web directly, for three reasons: the
/// backend is where the egress allowlist lives, so a deployment decides what may leave; the
/// request is authenticated as the user, so the tool is not an open proxy; and the response is
/// reduced to text and capped on a machine built for it, rather than in the client.
/// </para>
/// </remarks>
public sealed class WebTool : IAgentTool
{
    private readonly DesktopApiClient _api;
    private readonly IAuthSession _auth;

    public WebTool(DesktopApiClient api, IAuthSession auth)
    {
        _api = api;
        _auth = auth;
    }

    public string Name => "web_search";

    public string Description =>
        "Search the web. Use it for facts you are not sure of, for documentation, and for " +
        "anything that changed after your training data was cut.";

    public string Parameters => "query: the words to search for.";

    public bool RunsOnHost => true;

    public async Task<ToolOutcome> InvokeAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        var query = ToolArguments.ReadString(argumentsJson, "query");
        if (string.IsNullOrWhiteSpace(query))
        {
            return ToolOutcome.Failed("web_search needs a query.");
        }

        if (!_auth.IsSignedIn || _auth.Current is null)
        {
            return ToolOutcome.Failed("Not signed in.");
        }

        var (status, body) = await _api
            .PostWebAsync(_auth.Current.AccessToken, "search", new { query }, cancellationToken)
            .ConfigureAwait(false);

        if (status != 200)
        {
            return ToolOutcome.Failed($"The search could not be run (HTTP {status}).");
        }

        var results = body.RootElement.GetProperty("results");
        if (results.GetArrayLength() == 0)
        {
            return ToolOutcome.Ok($"No results for \"{query}\".");
        }

        var text = new StringBuilder();
        text.AppendLine($"Search results for \"{query}\":");
        var index = 0;
        foreach (var result in results.EnumerateArray())
        {
            index++;
            text.AppendLine();
            text.AppendLine($"{index}. {result.GetProperty("title").GetString()}");
            text.AppendLine($"   {result.GetProperty("url").GetString()}");
            var snippet = result.TryGetProperty("snippet", out var s) ? s.GetString() : null;
            if (!string.IsNullOrWhiteSpace(snippet))
            {
                text.AppendLine($"   {snippet}");
            }
        }

        return ToolOutcome.Ok(text.ToString().Trim());
    }
}

/// <summary>Fetch a page and read it as text.</summary>
public sealed class WebFetchTool : IAgentTool
{
    private readonly DesktopApiClient _api;
    private readonly IAuthSession _auth;

    public WebFetchTool(DesktopApiClient api, IAuthSession auth)
    {
        _api = api;
        _auth = auth;
    }

    public string Name => "web_fetch";

    public string Description =>
        "Fetch a web page and return it as plain text. Use it to read a specific URL you were " +
        "given, or one a search returned.";

    public string Parameters => "url: the address to fetch, starting with http:// or https://.";

    public bool RunsOnHost => true;

    public async Task<ToolOutcome> InvokeAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        var url = ToolArguments.ReadString(argumentsJson, "url");
        if (string.IsNullOrWhiteSpace(url))
        {
            return ToolOutcome.Failed("web_fetch needs a url.");
        }

        if (!_auth.IsSignedIn || _auth.Current is null)
        {
            return ToolOutcome.Failed("Not signed in.");
        }

        var (status, body) = await _api
            .PostWebAsync(_auth.Current.AccessToken, "fetch", new { url }, cancellationToken)
            .ConfigureAwait(false);

        if (status != 200)
        {
            // The server's own reason is worth passing on: "that address is not reachable from
            // the web tool" tells the model the fetch was refused rather than lost, and it can
            // try a different address.
            var reason = body.RootElement.TryGetProperty("error", out var error)
                ? error.GetString()
                : null;
            return ToolOutcome.Failed(string.IsNullOrWhiteSpace(reason)
                ? $"The page could not be fetched (HTTP {status})."
                : reason!);
        }

        var page = body.RootElement.GetProperty("page");
        var title = page.GetProperty("title").GetString();
        var text = page.GetProperty("text").GetString() ?? string.Empty;
        var truncated = page.TryGetProperty("truncated", out var t) && t.GetBoolean();

        var result = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(title))
        {
            result.AppendLine(title);
            result.AppendLine();
        }

        result.Append(text);
        if (truncated)
        {
            result.AppendLine();
            result.AppendLine("(The page was truncated.)");
        }

        return ToolOutcome.Ok(result.ToString().Trim());
    }
}

/// <summary>
/// Reads an argument out of the model's JSON.
/// </summary>
/// <remarks>
/// Hand-rolled rather than deserialised into a type per tool, because the model is not
/// reliable about shape: it omits fields, sends numbers as strings, and occasionally sends
/// prose. A missing argument has to produce a message the model can act on, not an
/// exception the harness has to survive.
/// </remarks>
internal static class ToolArguments
{
    public static string? ReadString(string json, string name)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            using var document = JsonDocument.Parse(json);
            if (!document.RootElement.TryGetProperty(name, out var value)) return null;
            return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
