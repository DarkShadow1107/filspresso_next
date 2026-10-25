using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Filspresso.Harness;

public sealed record QuestionOption(string Label, string Description);
public sealed record AgentQuestion(string Header, string Question, bool Multiple, IReadOnlyList<QuestionOption> Options);
public sealed record QuestionForm(IReadOnlyList<AgentQuestion> Questions);
public sealed record QuestionChallenge(int Version, Guid Id, string CallId, QuestionForm Form);
public sealed record QuestionAnswer(IReadOnlyList<int> Selected, string Custom);
public sealed record QuestionDecision(int Version, Guid Id, bool Cancelled, IReadOnlyList<QuestionAnswer> Answers);

/// <summary>A fixed bounded nested schema, not an expansion of arbitrary executable tool schemas.</summary>
public static class AgentQuestionProtocol
{
    private static readonly Encoding Utf8 = new UTF8Encoding(false, true);
    public static JsonElement Schema { get { using var document = JsonDocument.Parse("""
        {"type":"object","properties":{"questions":{"type":"array","minItems":1,"maxItems":4,"items":{
          "type":"object","properties":{"header":{"type":"string","minLength":1,"maxLength":30},
          "question":{"type":"string","minLength":1,"maxLength":2000},"multiple":{"type":"boolean"},
          "options":{"type":"array","minItems":0,"maxItems":8,"items":{"type":"object",
          "properties":{"label":{"type":"string","minLength":1,"maxLength":60},"description":{"type":"string","minLength":0,"maxLength":300}},
          "required":["label","description"],"additionalProperties":false}}},
          "required":["header","question","multiple","options"],"additionalProperties":false}}},"required":["questions"],"additionalProperties":false}
        """); return document.RootElement.Clone(); } }
    public static ToolDefinition Tool => new("question",
        "Ask structured clarification questions and wait for the user's answers. Custom answers are always available. Answers NEVER authorize changes or commands.",
        ToolArgumentSchema.ForQuestions(), ToolEffect.Interaction);

    public static QuestionForm Parse(string raw)
    {
        if (raw is null || Utf8.GetByteCount(raw) > 16_384) throw new ArgumentException("Question form exceeds its byte limit.");
        using var document = JsonDocument.Parse(raw, new JsonDocumentOptions { MaxDepth = 8 });
        var nodes = 0; Unique(document.RootElement, ref nodes);
        var root = document.RootElement; Fields(root, "questions");
        var rows = root.GetProperty("questions");
        Require(rows.ValueKind == JsonValueKind.Array && rows.GetArrayLength() is >= 1 and <= 4);
        var questions = new List<AgentQuestion>();
        foreach (var row in rows.EnumerateArray())
        {
            Fields(row, "header", "question", "multiple", "options");
            var header = Text(row.GetProperty("header"), 30); var prompt = Text(row.GetProperty("question"), 2000);
            var multiple = row.GetProperty("multiple"); Require(multiple.ValueKind is JsonValueKind.True or JsonValueKind.False);
            var options = row.GetProperty("options"); Require(options.ValueKind == JsonValueKind.Array && options.GetArrayLength() <= 8);
            var labels = new HashSet<string>(StringComparer.Ordinal); var choices = new List<QuestionOption>();
            foreach (var option in options.EnumerateArray())
            {
                Fields(option, "label", "description"); var label = Text(option.GetProperty("label"), 60);
                Require(labels.Add(label)); choices.Add(new(label, Text(option.GetProperty("description"), 300, true)));
            }
            questions.Add(new(header, prompt, multiple.GetBoolean(), Array.AsReadOnly(choices.ToArray())));
        }
        return new(Array.AsReadOnly(questions.ToArray()));
    }
    public static string FormJson(QuestionForm form) => JsonSerializer.Serialize(new { questions = form.Questions.Select(question => new {
        header = question.Header, question = question.Question, multiple = question.Multiple,
        options = question.Options.Select(option => new { label = option.Label, description = option.Description }) }) });

    public static QuestionDecision Validate(QuestionChallenge challenge, QuestionDecision decision)
    {
        Require(decision is not null && decision.Version == 1 && decision.Id == challenge.Id && decision.Answers is not null);
        Require(decision.Answers.All(answer => answer is not null && answer.Selected is not null && answer.Custom is not null));
        decision = decision with { Answers = Array.AsReadOnly(decision.Answers.Select(answer => answer with { Selected = Array.AsReadOnly(answer.Selected.ToArray()) }).ToArray()) };
        if (decision.Cancelled) Require(decision.Answers.Count == 0);
        else
        {
            Require(decision.Answers.Count == challenge.Form.Questions.Count);
            for (var index = 0; index < decision.Answers.Count; index++)
            {
                var answer = decision.Answers[index]; var question = challenge.Form.Questions[index];
                Require(answer is not null && answer.Selected is not null && answer.Custom is not null && answer.Custom.EnumerateRunes().Count() <= 4000);
                Utf8.GetByteCount(answer.Custom);
                Require(answer.Selected.Count <= question.Options.Count && answer.Selected.Distinct().Count() == answer.Selected.Count && answer.Selected.All(item => item >= 0 && item < question.Options.Count));
                var count = answer.Selected.Count + (string.IsNullOrWhiteSpace(answer.Custom) ? 0 : 1);
                Require(count > 0 && (question.Multiple || count == 1));
            }
        }
        Require(Utf8.GetByteCount(ResultJson(decision)) <= 16_384);
        return decision with { Answers = Array.AsReadOnly(decision.Answers.Select(answer => answer with { Selected = Array.AsReadOnly(answer.Selected.ToArray()) }).ToArray()) };
    }
    public static string ResultJson(QuestionDecision decision) => JsonSerializer.Serialize(new {
        kind = "clarification", answers = decision.Answers.Select(answer => new { selected = answer.Selected, custom = answer.Custom }), grantsExecutionPermission = false });
    private static void Require([DoesNotReturnIf(false)] bool value) { if (!value) throw new ArgumentException("Invalid bounded agent question or answer."); }
    private static string Text(JsonElement value, int max, bool empty = false)
    {
        Require(value.ValueKind == JsonValueKind.String); var result = value.GetString()!;
        Require(result.EnumerateRunes().Count() <= max && (empty || !string.IsNullOrWhiteSpace(result))); Utf8.GetByteCount(result); return result;
    }
    private static void Fields(JsonElement value, params string[] fields)
    {
        Require(value.ValueKind == JsonValueKind.Object && value.EnumerateObject().Count() == fields.Length && fields.All(field => value.TryGetProperty(field, out _)));
    }
    private static void Unique(JsonElement value, ref int nodes)
    {
        Require(++nodes <= 256);
        if (value.ValueKind == JsonValueKind.Object)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in value.EnumerateObject()) { Require(seen.Add(property.Name)); Unique(property.Value, ref nodes); }
        }
        else if (value.ValueKind == JsonValueKind.Array) foreach (var item in value.EnumerateArray()) Unique(item, ref nodes);
    }
}

/// <summary>One pending local question. Deliberately has no AgentConsentQueue or sandbox dependency.</summary>
public sealed class AgentQuestionQueue : IDisposable
{
    private readonly object _gate = new();
    private readonly HashSet<Guid> _issued = new();
    private QuestionChallenge? _pending;
    private TaskCompletionSource<QuestionDecision>? _answer;
    private CancellationToken _cancellation;
    private bool _disposed;
    public event EventHandler? Changed;
    public QuestionChallenge? Pending { get { lock (_gate) return _pending; } }
    public async Task<QuestionDecision> RequestAsync(QuestionChallenge value, CancellationToken token = default)
    {
        token.ThrowIfCancellationRequested();
        var form = AgentQuestionProtocol.Parse(AgentQuestionProtocol.FormJson(value.Form));
        TaskCompletionSource<QuestionDecision> answer;
        lock (_gate)
        {
            if (_disposed || _pending is not null || value.Version != 1 || value.Id == Guid.Empty || !System.Text.RegularExpressions.Regex.IsMatch(value.CallId, @"\A[A-Za-z0-9_-]{1,64}\z") || _issued.Count >= 4096 || !_issued.Add(value.Id))
                throw new InvalidOperationException("Question is unavailable, repeated or already pending.");
            _pending = value with { Form = form }; _cancellation = token;
            _answer = answer = new(TaskCreationOptions.RunContinuationsAsynchronously);
        }
        using var cancelled = token.Register(Dismiss);
        Changed?.Invoke(this, EventArgs.Empty);
        return await answer.Task.ConfigureAwait(false);
    }
    public bool Answer(QuestionDecision value)
    {
        TaskCompletionSource<QuestionDecision> answer; QuestionDecision decision;
        lock (_gate)
        {
            if (_pending is null || _answer is null || ((_disposed || _cancellation.IsCancellationRequested) && !value.Cancelled)) return false;
            try { decision = AgentQuestionProtocol.Validate(_pending, value); } catch (ArgumentException) { return false; }
            answer = _answer; _answer = null; _pending = null;
        }
        answer.TrySetResult(decision); Changed?.Invoke(this, EventArgs.Empty); return true;
    }
    public void Dismiss() { Guid? id; lock (_gate) id = _pending?.Id; if (id is { } value) Answer(new(1, value, true, Array.Empty<QuestionAnswer>())); }
    public void Dispose() { lock (_gate) _disposed = true; Dismiss(); }
}
