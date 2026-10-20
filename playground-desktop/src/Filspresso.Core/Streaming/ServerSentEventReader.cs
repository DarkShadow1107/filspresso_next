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

        // Scanned for line ends rather than split on '\n', because the interesting case is a
        // frame split across two network reads. A frame is retained whole -- its data lines
        // and the blank line that terminates it -- and only the unfinished remainder is
        // carried forward.
        var frameStart = 0;
        var lineStart = 0;
        for (var i = 0; i < buffer.Length; i++)
        {
            if (buffer[i] != '\n') continue;
            var length = i - lineStart;
            if (length == 0 || (length == 1 && buffer[lineStart] == '\r'))
            {
                // A blank line terminates the event.
                var data = ParseData(buffer[frameStart..(i + 1)]);
                if (data is not null) events.Add(new ServerSentEvent(data));
                frameStart = i + 1;
            }
            lineStart = i + 1;
        }

        // The whole unfinished event is retained, not only its last line: a `data:` line
        // followed by the terminating blank line arriving in a later read must still be
        // delivered.
        newPending = buffer[frameStart..];
        if (newPending.Length > 1_048_576)
        {
            throw new InvalidDataException("SSE event exceeded 1 MiB.");
        }

        return events;
    }

    /// <summary>
    /// The data of one event, or null when the frame carries none.
    /// </summary>
    private static string? ParseData(string frame)
    {
        var data = new List<string>();
        foreach (var rawLine in frame.Split('\n'))
        {
            var line = rawLine.TrimEnd('\r');
            // A blank line is the terminator, and a line starting with ':' is a comment --
            // which is how this stream sends keep-alives.
            if (line.Length == 0 || line[0] == ':') continue;

            var colon = line.IndexOf(':');
            var field = colon < 0 ? line : line[..colon];
            var value = colon < 0 ? string.Empty : line[(colon + 1)..];
            // Exactly one optional leading space is part of the framing, not the value.
            if (value.StartsWith(' ')) value = value[1..];

            if (field == "data") data.Add(value);
        }

        return data.Count == 0 ? null : string.Join("\n", data);
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

        var value = ParseData(pending);
        if (value is not null) yield return new ServerSentEvent(value);
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

        using var reader = new StreamReader(stream, Encoding.UTF8, leaveOpen: true);
        var pending = string.Empty;
        var buffer = new char[4096];

        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();

            // ReadAsync(CancellationToken) returning ValueTask<string> is not available on
            // the char-based reader, so the buffer form is used. It is still cancellable.
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
