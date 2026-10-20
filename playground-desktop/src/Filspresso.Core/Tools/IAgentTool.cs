using System;
using System.Threading;
using System.Threading.Tasks;

namespace Filspresso.Core.Tools;

/// <summary>What a tool call produced.</summary>
/// <param name="Content">The text handed back to the model.</param>
/// <param name="IsError">
/// True when the tool failed. Not the same as a successful call that found nothing: the model
/// is told the difference, because "the tool broke" and "there is no answer" lead to different
/// next steps.
/// </param>
public sealed record ToolOutcome(string Content, bool IsError = false)
{
    public static ToolOutcome Ok(string content) => new(content);

    public static ToolOutcome Failed(string reason) => new(reason, IsError: true);
}

/// <summary>
/// A tool the model may call.
/// </summary>
/// <remarks>
/// The contract is deliberately narrow: a name, a description the model reads, and an
/// invocation. The model decides when to call it; the harness decides whether it is allowed to.
/// <para>
/// <b>Some tools run on the host and some run inside the sandbox.</b> A tool that touches the
/// filesystem or runs a command runs inside the sandbox, which has no network. A tool that
/// reaches the internet -- the web search, the page fetch -- runs on the host, because the
/// sandbox has no network adapter and that is the whole point of it. The harness writes the
/// result into the sandbox so the model can read it there.
/// </para>
/// </remarks>
public interface IAgentTool
{
    /// <summary>The name the model calls it by. Stable: it appears in the model's transcript.</summary>
    string Name { get; }

    /// <summary>What the tool does, in the second person, for the model to read.</summary>
    string Description { get; }

    /// <summary>
    /// The tool's parameters, in the shape the model is told about.
    /// </summary>
    /// <remarks>
    /// A short description rather than a JSON Schema. The models this product serves are
    /// small, and a schema they must follow exactly is a schema they get wrong. A sentence
    /// naming the argument and what it wants is enough, and the argument is validated here
    /// rather than by the model.
    /// </remarks>
    string Parameters { get; }

    /// <summary>
    /// Whether the tool runs on the host rather than inside the sandbox.
    /// </summary>
    /// <remarks>
    /// The harness needs to know, because the two are executed in different places with
    /// different guarantees. A host tool can reach the network; a sandbox tool cannot.
    /// </remarks>
    bool RunsOnHost { get; }

    Task<ToolOutcome> InvokeAsync(string argumentsJson, CancellationToken cancellationToken = default);
}
