using System;
using System.IO;
using Filspresso.Core.Storage;
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class DesktopPreferencesTests
{
    [Fact]
    public void InvalidPreferencesCannotCreateAnUnknownModelOrTokenLevel()
    {
        var normalized = new DesktopPreferences { ModelKey = "not-a-model", InputContextTokens = -1, TextSize = 900 }.Normalize();
        Assert.Equal(DesktopPreferences.DefaultModel, normalized.ModelKey);
        Assert.Equal(16384, normalized.InputContextTokens);
        Assert.Equal(15, normalized.TextSize);
    }

    [Fact]
    public void PreferencesRoundTripWithoutLeavingATemporaryFile()
    {
        var root = Path.Combine(Path.GetTempPath(), "FilspressoPreferences-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new DesktopPreferencesStore(root);
            Assert.Equal(new DesktopPreferences(), store.Load());
            var preferences = new DesktopPreferences { InputContextTokens = 131072, TextSize = 18, EnterToSend = false, ShowStatistics = false, Thinking = true };
            store.Save(preferences);
            Assert.Equal(preferences, store.Load());
            Assert.Single(Directory.GetFiles(root));
            File.WriteAllText(Path.Combine(root, "preferences.json"), "corrupt");
            Assert.Equal(new DesktopPreferences(), store.Load());
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public void ContextAndOutputLevelsMatchTheWebPlayground()
    {
        Assert.Equal(new[] { 16384, 32768, 65536, 131072 }, DesktopPreferences.InputLevels);
        Assert.Equal(131072, DesktopPreferences.ContextTokens);
    }

    [Fact]
    public void ThePreviousTokenPreferenceMigratesToInputContext()
    {
        var stored = System.Text.Json.JsonSerializer.Deserialize<DesktopPreferences>("{\"MaxTokens\":65536}")!.Normalize();
        Assert.Equal(65536, stored.InputContextTokens);
        Assert.Null(stored.LegacyMaxTokens);
        Assert.DoesNotContain("MaxTokens", System.Text.Json.JsonSerializer.Serialize(stored), StringComparison.Ordinal);
    }

    [Fact]
    public void CompactionDefaultsToBalancedAndRejectsUnsupportedModes()
    {
        Assert.Equal("balanced", new DesktopPreferences().CompactionMode);
        foreach (var mode in new[] { "permissive", "balanced", "aggressive" })
            Assert.Equal(mode, new DesktopPreferences { CompactionMode = mode }.Normalize().CompactionMode);
        Assert.Equal("balanced", new DesktopPreferences { CompactionMode = "off" }.Normalize().CompactionMode);
    }

    [Fact]
    public void ContextFramesPreserveTheSummaryAndActiveHistory()
    {
        var update = Filspresso.Core.Api.DesktopApiClient.ParseFrame("{\"context\":{\"mode\":\"balanced\",\"inputLimit\":16384,\"tokensBefore\":11000,\"tokensAfter\":4000,\"compacted\":true,\"summary\":\"Keep constraints\",\"history\":[{\"role\":\"user\",\"content\":\"memory\"}]}}");
        var context = Assert.IsType<Filspresso.Core.Api.StreamUpdate.Context>(update);
        Assert.True(context.State.Compacted);
        Assert.Equal(4000, context.State.TokensAfter);
        Assert.Equal("memory", Assert.Single(context.State.History).Content);
    }
}
