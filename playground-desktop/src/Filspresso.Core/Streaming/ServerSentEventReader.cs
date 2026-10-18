using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;

namespace Filspresso.Core.Streaming;

/// <summary>One event off a <c>text/event-stream</c> response.</summary>
public sealed record ServerSentEvent(string Data);

/// <summary>
/// An incremental reader for <c>text/event-stream</c>.
/// </summary>
/// <remarks>
/// Written by hand rather than taken from a package for one reason that only shows up in
/// production: a frame can straddle two network reads. Anything that parses a chunk and
/// throws away a trailing partial line will drop the frame that crosses the boundary, and
/// for this stream the frame that crosses the boundary is the <c>done</c> frame carrying the
/// token counts. Losing it means a completed generation that nobody is charged for.
/// <para>
/// That is not hypothetical. The web route has exactly this bug's shape documented on it,
/// and it meters with a null request id as a result.
/// </para>
/// <para>
/// Only the <c>data:</c> field is surfaced. This stream sends no <c>event:</c>, <c>id:</c>
/// or <c>retry:</c> fields, and inventing handling for them would be untested code pretending
/// to be a feature.
/// </para>
/// </remarks>
public static class ServerSentEventReader
{
    /// <summary>
    /// Feeds a chunk in and returns whatever complete events it finished. Anything after the
    /// last newline is retained until the next call.
    /// </summary>
    /// <remarks>
    /// A concrete list rather than an iterator. The body builds one either way, and returning
    /// <c>IEnumerable</c> would hand callers a lazy wrapper that re-enumerates -- so
    /// <c>.Count()</c> in a caller walks the list again, and so does indexing it.
    /// </remarks>
    public static IReadOnlyList<ServerSentEvent> Feed(string pending, string chunk, out string newPending)
    {
        ArgumentNullException.ThrowIfNull(pending);
        ArgumentNullException.ThrowIfNull(chunk);

        var buffer = pending + chunk;
        var events = new List<ServerSentEvent>();

        // SplitKeepingEmptyEntries, because a blank line is the event terminator and is
        // therefore meaningful. A plain Split would swallow it.
        var lines = buffer.Split('\n');
        var complete = lines.Length - 1; // the last element is either empty or partial

        var data = new StringBuilder();
        var sawField = false;

        for (var i = 0; i < complete; i++)
        {
            var line = lines[i].TrimEnd('\r');

            if (line.Length == 0)
            {
                if (sawField)
                {
                    events.Add(new ServerSentEvent(data.ToString()));
                    data.Clear();
                    sawField = false;
                }
                continue;
            }

            // A line beginning with ':' is a comment, used as a keep-alive.
            if (line[0] == ':')
            {
                continue;
            }

            var colon = line.IndexOf(':');
            var field = colon < 0 ? line : line[..colon];
            var value = colon < 0 ? string.Empty : line[(colon + 1)..];
            // Exactly one optional leading space is part of the framing, not the value.
            if (value.StartsWith(' '))
            {
                value = value[1..];
            }

            if (string.Equals(field, "data", StringComparison.Ordinal))
            {
                if (sawField)
                {
                    data.Append('\n');
                }

                data.Append(value);
                sawField = true;
            }
        }

        newPending = string.Concat(lines.Skip(complete));
        return events;
    }

    /// <summary>
    /// Emits whatever the last chunk left behind, for the case where a stream ends without a
    /// trailing blank line. Servers that close cleanly always send one, so this is a safety
    /// net rather than the normal path.
    /// </summary>
    public static IEnumerable<ServerSentEvent> Flush(string pending)
    {
        if (string.IsNullOrEmpty(pending))
        {
            yield break;
        }

        var line = pending.TrimEnd('\r', '\n');
        if (line.Length == 0 || line[0] == ':')
        {
            yield break;
        }

        var colon = line.IndexOf(':');
        if (colon < 0 || !string.Equals(line[..colon], "data", StringComparison.Ordinal))
        {
            yield break;
        }

        var value = line[(colon + 1)..];
        if (value.StartsWith(' '))
        {
            value = value[1..];
        }

        if (value.Length > 0)
        {
            yield return new ServerSentEvent(value);
        }
    }

    /// <summary>
    /// Reads the <c>done</c> frame's usage block.
    /// </summary>
    /// <remarks>
    /// Both spellings are accepted because the AI service has used both, and a rename there
    /// must not silently stop billing. Counts are floored at zero: a negative or fractional
    /// token count is not something to bill in the customer's favour by accident.
    /// <para>
    /// Returns null when the frame carries nothing usable, and the caller must treat that as
    /// "not metered" rather than "free".
    /// </para>
    /// </remarks>
    public static TokenUsage? ReadUsage(string data)
    {
        if (string.IsNullOrWhiteSpace(data))
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

        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (!root.TryGetProperty("done", out var done) || done.ValueKind != JsonValueKind.True)
        {
            return null;
        }

        if (!root.TryGetProperty("usage", out var usage) || usage.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new TokenUsage(
            ReadCount(usage, "prompt_tokens", "input_tokens"),
            ReadCount(usage, "completion_tokens", "output_tokens"));
    }

    private static int ReadCount(JsonElement usage, string primary, string alternate)
    {
        foreach (var name in new[] { primary, alternate })
        {
            if (usage.TryGetProperty(name, out var value) &&
                value.ValueKind == JsonValueKind.Number &&
                value.TryGetDouble(out var number) &&
                number > 0)
            {
                return (int)Math.Floor(number);
            }
        }

        return 0;
    }
}

/// <summary>A completed generation's token counts.</summary>
public readonly record struct TokenUsage(int InputTokens, int OutputTokens)
{
    public bool IsEmpty => InputTokens <= 0 && OutputTokens <= 0;
}

/// <summary>
/// Convenience for consuming a whole response stream without the caller managing the
/// pending buffer.
/// </summary>
public static class ServerSentEventStream
{
    public static async IAsyncEnumerable<ServerSentEvent> ReadAsync(
        System.IO.Stream stream,
        [System.Runtime.CompilerServices.EnumeratorCancellation] System.Threading.CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(stream);

        using var reader = new StreamReader(stream, Encoding.UTF8);
        var pending = string.Empty;

        while (!reader.EndOfStream)
        {
            cancellationToken.ThrowIfCancellationRequested();

            // ReadAsync(CancellationToken) returning ValueTask<string> is not available on
            // the char-based reader, so the buffer form is used. It is still cancellable.
            var buffer = new char[4096];
            var read = await reader.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken)
                .ConfigureAwait(false);
            if (read == 0)
            {
                break;
            }

            var chunk = new string(buffer, 0, read);
            foreach (var evt in ServerSentEventReader.Feed(pending, chunk, out pending))
            {
                yield return evt;
            }
        }

        foreach (var evt in ServerSentEventReader.Flush(pending))
        {
            yield return evt;
        }
    }
}
