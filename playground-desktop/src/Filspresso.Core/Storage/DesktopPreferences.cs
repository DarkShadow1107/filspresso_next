using System;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace Filspresso.Core.Storage;

public static class DesktopDataPaths
{
    public const string CredentialPrefix = "Filspresso.Playground";
    public static string UserDataDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Filspresso", "Playground");
}

public sealed record DesktopPreferences
{
    public static readonly int[] OutputLevels = [16_384, 32_768, 65_536, 131_072];
    public const int ContextTokens = 131_072;
    public const string DefaultModel = "lfm2_5_230m_q4_k_m";

    public string ModelKey { get; init; } = DefaultModel;
    public int MaxTokens { get; init; } = OutputLevels[0];
    public bool Thinking { get; init; }
    public bool EnterToSend { get; init; } = true;
    public bool ShowStatistics { get; init; } = true;
    public int TextSize { get; init; } = 15;

    public DesktopPreferences Normalize() => this with
    {
        ModelKey = KnownModels.Contains(ModelKey, StringComparer.Ordinal) ? ModelKey : DefaultModel,
        MaxTokens = OutputLevels.Contains(MaxTokens) ? MaxTokens : OutputLevels[0],
        TextSize = TextSize is 13 or 15 or 18 ? TextSize : 15,
    };

    public static string[] KnownModels =>
    [
        DefaultModel, "lfm2_5_350m_q8_0", "lfm2_5_1_2b_instruct_q4_k_m",
        "lfm2_5_1_2b_thinking_q4_k_m", "lfm2_5_2_6b_q4_0", "lfm2_5_8b_a1b_q4_k_m",
    ];
}

/// <summary>Only non-secret preferences go here; tokens stay in Credential Manager.</summary>
public sealed class DesktopPreferencesStore(string? dataDirectory = null)
{
    public string DirectoryPath { get; } = dataDirectory ?? DesktopDataPaths.UserDataDirectory;

    public DesktopPreferences Load()
    {
        try
        {
            return (JsonSerializer.Deserialize<DesktopPreferences>(
                File.ReadAllText(Path.Combine(DirectoryPath, "preferences.json"))) ?? new()).Normalize();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            return new();
        }
    }

    public void Save(DesktopPreferences preferences)
    {
        Directory.CreateDirectory(DirectoryPath);
        var target = Path.Combine(DirectoryPath, "preferences.json");
        var temporary = target + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(preferences.Normalize(), new JsonSerializerOptions { WriteIndented = true }));
        File.Move(temporary, target, overwrite: true);
    }
}
