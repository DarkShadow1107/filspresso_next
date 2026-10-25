using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Filspresso.Core.Tools;

namespace Filspresso.Harness;

public enum ToolParameterKind { String, Integer, Boolean, WorkspacePath }

/// <summary>The intentionally small JSON Schema subset supported by the harness.</summary>
public sealed record ToolParameter(ToolParameterKind Kind, bool Required = true, int MinLength = 0,
    int MaxLength = 4096, int Minimum = int.MinValue, int Maximum = int.MaxValue);

/// <summary>
/// Closed, flat objects only: required fields, exact types, string/integer bounds, no extras
/// or duplicate keys. The advertised JSON Schema and validation share these definitions.
/// No coercion, arbitrary schema extensions, or parsing of model narration is performed.
/// </summary>
public sealed class ToolArgumentSchema
{
    public const int MaxArgumentBytes = 16_384;
    private static readonly Encoding StrictUtf8 = new UTF8Encoding(false, true);
    private static readonly Regex Identifier = new(@"\A[a-zA-Z_][a-zA-Z0-9_]{0,63}\z", RegexOptions.CultureInvariant);
    public IReadOnlyDictionary<string, ToolParameter> Properties { get; }
    public bool IsQuestion { get; private init; }
    public static ToolArgumentSchema ForQuestions() => new(new Dictionary<string, ToolParameter>()) { IsQuestion = true };

    public ToolArgumentSchema(IReadOnlyDictionary<string, ToolParameter> properties)
    {
        ArgumentNullException.ThrowIfNull(properties);
        if (properties.Count > 32) throw new ArgumentException("A tool may declare at most 32 parameters.", nameof(properties));
        var snapshot = new Dictionary<string, ToolParameter>(StringComparer.Ordinal);
        foreach (var (name, parameter) in properties)
        {
            if (!IsIdentifier(name) || parameter is null || !Enum.IsDefined(parameter.Kind) ||
                parameter.MinLength < 0 || parameter.MaxLength < parameter.MinLength || parameter.MaxLength > MaxArgumentBytes ||
                (parameter.Kind == ToolParameterKind.WorkspacePath && (parameter.MinLength > 240 || parameter.MaxLength < 1)) ||
                parameter.Minimum > parameter.Maximum)
                throw new ArgumentException("Invalid tool parameter definition.", nameof(properties));
            snapshot.Add(name, parameter);
        }
        Properties = new ReadOnlyDictionary<string, ToolParameter>(snapshot);
    }

    internal static bool IsIdentifier(string? value) => value is { Length: > 0 and <= 64 } && Identifier.IsMatch(value);

    public bool TryValidate(string? argumentsJson, out string error)
    {
        error = "Tool arguments must be a bounded JSON object matching the registered schema.";
        if (argumentsJson is null || argumentsJson.Length > MaxArgumentBytes) return false;
        try
        {
            if (StrictUtf8.GetByteCount(argumentsJson) > MaxArgumentBytes) return false;
            if (IsQuestion) { AgentQuestionProtocol.Parse(argumentsJson); error = string.Empty; return true; }
            using var document = JsonDocument.Parse(argumentsJson, new JsonDocumentOptions { MaxDepth = 4 });
            if (document.RootElement.ValueKind != JsonValueKind.Object) return false;
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var field in document.RootElement.EnumerateObject())
            {
                if (!seen.Add(field.Name) || !Properties.TryGetValue(field.Name, out var parameter)) return false;
                var valid = parameter.Kind switch
                {
                    ToolParameterKind.String or ToolParameterKind.WorkspacePath => field.Value.ValueKind == JsonValueKind.String &&
                        field.Value.GetString() is { } text && text.EnumerateRunes().Count() >= parameter.MinLength && text.EnumerateRunes().Count() <= parameter.MaxLength &&
                        (parameter.Kind != ToolParameterKind.WorkspacePath || IsWorkspacePath(text)),
                    ToolParameterKind.Integer => field.Value.ValueKind == JsonValueKind.Number && field.Value.TryGetInt32(out var number) &&
                        number >= parameter.Minimum && number <= parameter.Maximum,
                    ToolParameterKind.Boolean => field.Value.ValueKind is JsonValueKind.True or JsonValueKind.False,
                    _ => false,
                };
                if (!valid) return false;
            }
            if (Properties.Any(property => property.Value.Required && !seen.Contains(property.Key))) return false;
            error = string.Empty;
            return true;
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException or ArgumentException) { return false; }
    }

    public JsonElement ToJsonSchema()
    {
        if (IsQuestion) return AgentQuestionProtocol.Schema;
        var properties = new Dictionary<string, object>(StringComparer.Ordinal);
        foreach (var (name, parameter) in Properties)
        {
            var constraints = new Dictionary<string, object>
            {
                ["type"] = parameter.Kind switch { ToolParameterKind.Integer => "integer", ToolParameterKind.Boolean => "boolean", _ => "string" },
            };
            if (parameter.Kind is ToolParameterKind.String or ToolParameterKind.WorkspacePath)
            {
                constraints["minLength"] = parameter.Kind == ToolParameterKind.WorkspacePath ? Math.Max(parameter.MinLength, 1) : parameter.MinLength;
                constraints["maxLength"] = parameter.Kind == ToolParameterKind.WorkspacePath ? Math.Min(parameter.MaxLength, 240) : parameter.MaxLength;
                if (parameter.Kind == ToolParameterKind.WorkspacePath)
                    constraints["description"] = "Workspace-relative path using / separators; no traversal, drive, device or absolute paths.";
            }
            if (parameter.Kind == ToolParameterKind.Integer) { constraints["minimum"] = parameter.Minimum; constraints["maximum"] = parameter.Maximum; }
            properties[name] = constraints;
        }
        return JsonSerializer.SerializeToElement(new
        {
            type = "object", properties,
            required = Properties.Where(property => property.Value.Required).Select(property => property.Key).ToArray(),
            additionalProperties = false,
        });
    }

    // Platform-independent lexical validation, not a replacement for symlink/reparse-point
    // containment in the executor. Windows aliases and alternate data streams are rejected
    // even when this contract is used by a hosted POSIX adapter.
    public static bool IsWorkspacePath(string value) => WorkspacePath.IsRelativeFile(value);
}
