using System;
using System.Text.Json.Serialization;

namespace Filspresso.Core.Api;

public sealed record PreparedSource
{
    [JsonPropertyName("name")] public string Name { get; init; } = string.Empty;
    [JsonPropertyName("kind")] public string Kind { get; init; } = "document";
    [JsonPropertyName("text")] public string Text { get; init; } = string.Empty;
    [JsonPropertyName("size")] public long Size { get; init; }
    [JsonPropertyName("sourceUrl")] public string? SourceUrl { get; init; }
    [JsonPropertyName("warnings")] public string[] Warnings { get; init; } = Array.Empty<string>();
}

public sealed record ChatTurn(
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("content")] string Content);
