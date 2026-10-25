using System;
using System.Text.Json.Serialization;

namespace Filspresso.Core.Api;

public sealed record ContextState
{
    [JsonPropertyName("mode")] public string Mode { get; init; } = "balanced";
    [JsonPropertyName("inputLimit")] public int InputLimit { get; init; }
    [JsonPropertyName("tokensBefore")] public int TokensBefore { get; init; }
    [JsonPropertyName("tokensAfter")] public int TokensAfter { get; init; }
    [JsonPropertyName("compacted")] public bool Compacted { get; init; }
    [JsonPropertyName("summary")] public string? Summary { get; init; }
    [JsonPropertyName("notice")] public string? Notice { get; init; }
    [JsonPropertyName("history")] public ChatTurn[] History { get; init; } = Array.Empty<ChatTurn>();
}
