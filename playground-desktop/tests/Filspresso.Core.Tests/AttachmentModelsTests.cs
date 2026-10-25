using Filspresso.Core.Session;
using Filspresso.Core.Storage;
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class AttachmentModelsTests
{
    [Theory]
    [InlineData("clip.MP4", DesktopPreferences.DefaultModel, DesktopPreferences.VisionModel)]
    [InlineData("voice.wav", DesktopPreferences.DefaultModel, DesktopPreferences.AudioModel)]
    [InlineData("clip.webm", DesktopPreferences.AudioModel, DesktopPreferences.VisionModel)]
    [InlineData("voice.OPUS", DesktopPreferences.VisionModel, DesktopPreferences.AudioModel)]
    public void MediaSuggestsAnAppropriateSelectableModel(string filename, string selected, string expected) =>
        Assert.Equal(new[] { expected }, AttachmentModels.Recommend(selected, [filename]));

    [Theory]
    [InlineData("clip.mp4", DesktopPreferences.VisionModel)]
    [InlineData("clip.mp4", "lfm2_5_vl_3b_q4_k_m")]
    [InlineData("voice.wav", DesktopPreferences.AudioModel)]
    [InlineData("report.pdf", DesktopPreferences.DefaultModel)]
    public void ACompatibleModelOrDocumentNeedsNoSuggestion(string filename, string selected) =>
        Assert.Empty(AttachmentModels.Recommend(selected, [filename]));
}
