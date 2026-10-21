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
        var normalized = new DesktopPreferences { ModelKey = "not-a-model", MaxTokens = -1, TextSize = 900 }.Normalize();
        Assert.Equal(DesktopPreferences.DefaultModel, normalized.ModelKey);
        Assert.Equal(16384, normalized.MaxTokens);
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
            var preferences = new DesktopPreferences { MaxTokens = 131072, TextSize = 18, EnterToSend = false, ShowStatistics = false, Thinking = true };
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
        Assert.Equal(new[] { 16384, 32768, 65536, 131072 }, DesktopPreferences.OutputLevels);
        Assert.Equal(131072, DesktopPreferences.ContextTokens);
    }
}
