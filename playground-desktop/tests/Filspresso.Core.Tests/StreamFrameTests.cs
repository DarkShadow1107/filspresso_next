using System;
using System.Linq;
using Filspresso.Core.Api;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>
/// Frame classification, which is where a streamed answer turns into either text or a bill.
/// </summary>
public class StreamFrameTests
{
    [Fact]
    public void ADeltaFrameBecomesText()
    {
        var update = DesktopApiClient.ParseFrame("""{"delta":"hello "}""");
        var delta = Assert.IsType<StreamUpdate.Delta>(update);
        Assert.Equal("hello ", delta.Text);
    }

    [Fact]
    public void TheDoneFrameBecomesACompletionWithItsUsage()
    {
        var update = DesktopApiClient.ParseFrame(
            """{"done":true,"usage":{"prompt_tokens":42,"completion_tokens":7}}""");

        var completed = Assert.IsType<StreamUpdate.Completed>(update);
        Assert.Equal(42, completed.Usage.InputTokens);
        Assert.Equal(7, completed.Usage.OutputTokens);
    }

    [Fact]
    public void ACompletionWithNoTokensIsStillACompletion()
    {
        // It has to be distinguishable from a delta, or the UI would keep "streaming" after
        // the model had finished.
        var update = DesktopApiClient.ParseFrame("""{"done":true}""");
        Assert.IsType<StreamUpdate.Completed>(update);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("[DONE]")]
    [InlineData("{not json")]
    [InlineData("""{"other":"field"}""")]
    public void FramesTheUiDoesNotUnderstandAreDropped(string frame)
    {
        // Null means "nothing to draw", which is different from a delta of empty text: the
        // latter would append nothing and look like a stall.
        Assert.Null(DesktopApiClient.ParseFrame(frame));
    }

    [Fact]
    public void ADoneFrameIsNeverAlsoTreatedAsADelta()
    {
        // Some servers put both on one frame. Completion wins, because appending text after
        // the stream has ended is worse than dropping the trailing fragment.
        var update = DesktopApiClient.ParseFrame(
            """{"done":true,"delta":"trailing","usage":{"prompt_tokens":1,"completion_tokens":1}}""");

        Assert.IsType<StreamUpdate.Completed>(update);
    }
}