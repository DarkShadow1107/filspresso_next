using System;
using System.Linq;
using Filspresso.Core.Streaming;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>
/// The SSE reader exists because of one bug shape: a frame that straddles two network reads.
/// Every test below is about a boundary.
/// </summary>
public class ServerSentEventReaderTests
{
    [Fact]
    public void ASingleCompleteEventIsEmitted()
    {
        var events = ServerSentEventReader.Feed("", "data: hello\n\n", out var pending);
        Assert.Single(events);
        Assert.Equal("hello", events[0].Data);
        Assert.Equal("", pending);
    }

    [Fact]
    public void AFrameSplitAcrossTwoChunksIsStillEmittedOnce()
    {
        // The reason this class exists. A naive reader processes the first chunk, finds no
        // complete line, and throws the fragment away -- and when the frame that splits is the
        // done frame carrying the token counts, a completed generation goes unmetered.
        var first = ServerSentEventReader.Feed("", "data: {\"delta\":\"hel", out var pending);
        Assert.Empty(first);
        Assert.Equal("data: {\"delta\":\"hel", pending);

        var second = ServerSentEventReader.Feed(pending, "lo\"}\n\n", out pending);
        Assert.Single(second);
        Assert.Equal("{\"delta\":\"hello\"}", second[0].Data);
        Assert.Equal("", pending);
    }

    [Fact]
    public void SeveralEventsInOneChunkAreAllEmitted()
    {
        var events = ServerSentEventReader.Feed("", "data: one\n\ndata: two\n\n", out _);
        Assert.Equal(2, events.Count);
        Assert.Equal("one", events[0].Data);
        Assert.Equal("two", events[1].Data);
    }

    [Fact]
    public void CRLFTerminatorsAreHandled()
    {
        var events = ServerSentEventReader.Feed("", "data: one\r\n\r\n", out _);
        Assert.Single(events);
        Assert.Equal("one", events[0].Data);
    }

    [Fact]
    public void CommentsAreIgnoredSoKeepAlivesDoNotBecomeEvents()
    {
        var events = ServerSentEventReader.Feed("", ": keep-alive\n\ndata: real\n\n", out _);
        Assert.Single(events);
        Assert.Equal("real", events[0].Data);
    }

    [Fact]
    public void ExactlyOneLeadingSpaceIsStripped()
    {
        // The space is part of the framing, not the value. Stripping whitespace in general
        // would corrupt a token that legitimately begins with one.
        var events = ServerSentEventReader.Feed("", "data:  two spaces\n\n", out _);
        Assert.Single(events);
        Assert.Equal(" two spaces", events[0].Data);
    }

    [Fact]
    public void MultipleDataLinesInOneEventAreJoinedWithNewlines()
    {
        var events = ServerSentEventReader.Feed("", "data: first\ndata: second\n\n", out _);
        Assert.Single(events);
        Assert.Equal("first\nsecond", events[0].Data);
    }

    [Fact]
    public void FlushRecoversATrailingFrameWithNoTerminator()
    {
        // A server that closes without a final blank line should not cost us the last frame.
        var flushed = ServerSentEventReader.Flush("data: trailing").ToArray();
        Assert.Single(flushed);
        Assert.Equal("trailing", flushed[0].Data);
    }

    [Fact]
    public void FlushOnEmptyYieldsNothing()
    {
        Assert.Empty(ServerSentEventReader.Flush(string.Empty));
        Assert.Empty(ServerSentEventReader.Flush(": only a comment"));
    }
}

public class TokenUsageReadingTests
{
    [Fact]
    public void TheDoneFrameYieldsBothTokenCounts()
    {
        var usage = ServerSentEventReader.ReadUsage(
            """{"done":true,"usage":{"prompt_tokens":1234,"completion_tokens":567}}""");

        Assert.NotNull(usage);
        Assert.Equal(1234, usage!.Value.InputTokens);
        Assert.Equal(567, usage.Value.OutputTokens);
        Assert.False(usage.Value.IsEmpty);
    }

    [Fact]
    public void TheAlternateSpellingIsAccepted()
    {
        // The AI service has used both, and a rename there must not silently stop billing.
        var usage = ServerSentEventReader.ReadUsage(
            """{"done":true,"usage":{"input_tokens":10,"output_tokens":20}}""");

        Assert.NotNull(usage);
        Assert.Equal(10, usage!.Value.InputTokens);
        Assert.Equal(20, usage.Value.OutputTokens);
    }

    [Fact]
    public void ANonDoneFrameYieldsNoUsage()
    {
        // A delta frame must never be mistaken for a completion.
        Assert.Null(ServerSentEventReader.ReadUsage("""{"delta":"hi"}"""));
    }

    [Fact]
    public void ADoneFrameWithNoUsageBlockYieldsNothing()
    {
        Assert.Null(ServerSentEventReader.ReadUsage("""{"done":true}"""));
    }

    [Fact]
    public void NegativeAndFractionalCountsAreFlooredAtZero()
    {
        // Billing in the customer's favour by accident is still wrong billing.
        var usage = ServerSentEventReader.ReadUsage(
            """{"done":true,"usage":{"prompt_tokens":-5,"completion_tokens":2.7}}""");

        Assert.NotNull(usage);
        Assert.Equal(0, usage!.Value.InputTokens);
        Assert.Equal(2, usage.Value.OutputTokens);
    }

    [Fact]
    public void MalformedJsonIsIgnoredRatherThanThrown()
    {
        // A stream is untrusted input. A parse failure must not tear down the whole read.
        Assert.Null(ServerSentEventReader.ReadUsage("{not json"));
        Assert.Null(ServerSentEventReader.ReadUsage(string.Empty));
    }

    [Fact]
    public void ADoneFrameWithZeroTokensIsEmptyRatherThanFree()
    {
        var usage = ServerSentEventReader.ReadUsage(
            """{"done":true,"usage":{"prompt_tokens":0,"completion_tokens":0}}""");

        Assert.NotNull(usage);
        Assert.True(usage!.Value.IsEmpty);
    }
}