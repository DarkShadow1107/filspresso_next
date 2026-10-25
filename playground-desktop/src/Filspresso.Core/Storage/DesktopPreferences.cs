using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Filspresso.Core.Storage;

public static class DesktopDataPaths
{
    public const string CredentialPrefix = "Filspresso.Playground";
    public static string UserDataDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Filspresso", "Playground");
}

public sealed record DesktopPreferences
{
    public static readonly int[] InputLevels = [16_384, 32_768, 65_536, 131_072];
    public const int ContextTokens = 131_072;
    public const string DefaultModel = "lfm2_5_230m_q4_k_m";
    public const string VisionModel = "lfm2_5_vl_450m_q4_k_m";
    public const string AudioModel = "lfm2_5_audio_1_5b_q4_0";

    public string ModelKey { get; init; } = DefaultModel;
    public int InputContextTokens { get; init; } = InputLevels[0];
    public string CompactionMode { get; init; } = "balanced";
    [JsonPropertyName("MaxTokens")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? LegacyMaxTokens { get; init; }
    public bool Thinking { get; init; }
    public bool EnterToSend { get; init; } = true;
    public bool ShowStatistics { get; init; } = true;
    public int TextSize { get; init; } = 15;

    /// <summary>
    /// EXPERIMENTAL and DEFAULT OFF: a per-conversation ceiling in RON after which the agent
    /// stops proposing tools.
    /// </summary>
    /// <remarks>
    /// Null (the value an untouched preferences file yields) is off. The estimate is computed
    /// client-side from usage the server reported, so it can drift from the server's own
    /// settlement by fractions of a cent; the server is never told about the cap and the cap
    /// is never a billing discount. Anything non-positive or implausible normalises back to
    /// off rather than to a number the user did not set.
    /// </remarks>
    public decimal? AgentSessionSpendCapRon { get; init; }

    public DesktopPreferences Normalize() => this with
    {
        ModelKey = KnownModels.Contains(ModelKey, StringComparer.Ordinal) ? ModelKey : DefaultModel,
        InputContextTokens = InputLevels.Contains(LegacyMaxTokens ?? InputContextTokens) ? LegacyMaxTokens ?? InputContextTokens : InputLevels[0],
        LegacyMaxTokens = null,
        CompactionMode = CompactionMode is "permissive" or "aggressive" ? CompactionMode : "balanced",
        TextSize = TextSize is 13 or 15 or 18 ? TextSize : 15,
        AgentSessionSpendCapRon = AgentSessionSpendCapRon is { } cap && cap is > 0 and <= 10_000 ? cap : null,
    };

    public static string[] KnownModels =>
    [
        DefaultModel, "lfm2_5_350m_q8_0", "lfm2_5_1_2b_instruct_q4_k_m",
        "lfm2_5_1_2b_thinking_q4_k_m", "lfm2_5_2_6b_q4_0", "lfm2_5_8b_a1b_q4_k_m",
        VisionModel, "lfm2_5_vl_3b_q4_k_m", AudioModel,
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
