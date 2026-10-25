using System;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Filspresso.Core.Api;

/// <summary>Account-owned activity metadata, never a transcript or an executable job.</summary>
public sealed record RecordedRun
{
    private static readonly Regex RunIdPattern = new(@"\A(?:dsk-[0-9a-f]{24}|exec-[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\z", RegexOptions.CultureInvariant);
    public static bool IsRunId(string? value) => value is { Length: <= 36 } && RunIdPattern.IsMatch(value);
    [JsonPropertyName("run_id")] public string RunId { get; init; } = string.Empty;
    [JsonPropertyName("session_uuid")] public string? SessionUuid { get; init; }
    [JsonPropertyName("scope")] public string Scope { get; init; } = string.Empty;
    [JsonPropertyName("model_key")] public string? ModelKey { get; init; }
    [JsonPropertyName("updated_at")] public string UpdatedAt { get; init; } = string.Empty;
    [JsonPropertyName("event_count")] public int EventCount { get; init; }
    [JsonPropertyName("outcome")] public string Outcome { get; init; } = "pending";
    [JsonPropertyName("truncated")] public bool Truncated { get; init; }
    [JsonPropertyName("settlement_failed")] public bool SettlementFailed { get; init; }
    [JsonIgnore] public string Label => RunId.StartsWith("dsk-", StringComparison.Ordinal) ? "Generation" : RunId.StartsWith("exec-", StringComparison.Ordinal) ? "Hosted execution / workspace" : "Workspace activity";
    [JsonIgnore] public string OutcomeLabel => Outcome == "complete" ? "Completion recorded" : Outcome == "failed" ? "Failure recorded" : "No completion recorded";
    [JsonIgnore] public string LocationLabel => RunId.StartsWith("dsk-", StringComparison.Ordinal)
        ? "Model: hosted AI · Chat did not execute code."
        : "Code boundary: hosted Docker sandbox · No local command is being run.";
}

/// <summary>Payloads are inert data. Unknown versions are displayed, not interpreted.</summary>
public sealed record RecordedRunEvent
{
    [JsonPropertyName("run_id")] public string RunId { get; init; } = string.Empty;
    [JsonPropertyName("sequence_number")] public int Sequence { get; init; } = -1;
    [JsonPropertyName("version")] public int Version { get; init; }
    [JsonPropertyName("kind")] public string Kind { get; init; } = string.Empty;
    [JsonPropertyName("status")] public string Status { get; init; } = "unknown";
    [JsonPropertyName("created_at")] public string CreatedAt { get; init; } = string.Empty;
    [JsonPropertyName("payload")] public JsonElement Payload { get; init; }

    public (string Text, bool Clipped) DisplayPayload()
    {
        const int limit = 16_384;
        var text = Payload.ValueKind == JsonValueKind.Undefined ? "(no payload recorded)" : JsonSerializer.Serialize(Payload, new JsonSerializerOptions { WriteIndented = true });
        return (text.Length > limit ? text[..limit] + "\n[Display clipped; this is not the full payload.]" : text, text.Length > limit || HasClippingFlag(Payload));
    }

    private static bool HasClippingFlag(JsonElement value, int depth = 0) => depth <= 2 && value.ValueKind == JsonValueKind.Object &&
        value.EnumerateObject().Any(field => (field.Name.EndsWith("Truncated", StringComparison.Ordinal) && field.Value.ValueKind == JsonValueKind.True) || HasClippingFlag(field.Value, depth + 1));
}

public sealed record RunReplayPage(RecordedRunEvent[] Events, bool HasMore, int? NextAfterSequence);
