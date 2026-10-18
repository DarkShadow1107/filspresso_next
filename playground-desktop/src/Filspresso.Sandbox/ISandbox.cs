using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace Filspresso.Sandbox;

/// <summary>Lifecycle of one sandboxed session.</summary>
public enum SandboxState
{
    /// <summary>Nothing created yet.</summary>
    Idle,

    /// <summary>A VM is being created and booted.</summary>
    Starting,

    /// <summary>Booted, reachable over PowerShell Direct, not yet used.</summary>
    Ready,

    /// <summary>A tool is running inside the sandbox.</summary>
    Busy,

    /// <summary>Shut down or discarded.</summary>
    Stopped,

    /// <summary>Stopped because something went wrong, with the reason recorded.</summary>
    Failed,
}

public sealed record SandboxSessionInfo(
    Guid Id,
    string Name,
    SandboxState State,
    int ProcessId,
    string? FailureReason);

public sealed record ToolResult(
    int ExitCode,
    string StandardOutput,
    string StandardError,
    TimeSpan Duration,
    bool TimedOut);

/// <summary>
/// The boundary a tool call is not allowed to cross.
/// </summary>
/// <remarks>
/// Every method takes the session id rather than a session object, and that is deliberate:
/// it makes it impossible to call into a sandbox that has been torn down without holding a
/// reference that would keep it alive.
/// </remarks>
public interface ISandbox
{
    /// <summary>
    /// Creates and boots a session.
    /// </summary>
    /// <remarks>
    /// The contract is that a session has <b>no network adapter at all</b>. Control runs
    /// over PowerShell Direct, which travels the hypervisor's VMBus rather than a network, so
    /// the session is fully scriptable and simultaneously has no route to the host, the LAN or
    /// the internet. Exfiltration is not prevented by a policy the payload cannot see; it is
    /// not reachable.
    /// <para>
    /// That is the whole reason for choosing a VM over a restricted token or a container. A
    /// generated process in a low-integrity sandbox can still resolve DNS and open a socket;
    /// here there is nothing to resolve and nothing to open.
    /// </para>
    /// </remarks>
    Task<SandboxSessionInfo> StartAsync(string name, CancellationToken cancellationToken = default);

    /// <summary>
    /// Runs a command inside the session and waits.
    /// </summary>
    /// <param name="workingDirectory">
    /// Null means the sandbox's own workspace, not a host path. The sandbox has no access to
    /// the host filesystem, so a host path here is a bug rather than a fallback.
    /// </param>
    Task<ToolResult> RunAsync(
        Guid sessionId,
        string command,
        string arguments,
        string? workingDirectory = null,
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Copies a file in, and returns the sandbox path.
    /// </summary>
    /// <remarks>
    /// Over PowerShell Direct, byte by byte. Slow, and irrelevant next to the boot cost of the
    /// VM it runs in.
    /// </remarks>
    Task<string> WriteFileAsync(
        Guid sessionId,
        string relativePath,
        ReadOnlyMemory<byte> contents,
        CancellationToken cancellationToken = default);

    Task<string> ReadFileAsync(
        Guid sessionId,
        string relativePath,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Destroys the session. Idempotent, and safe to call from a crash handler.
    /// </summary>
    Task StopAsync(Guid sessionId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<SandboxSessionInfo>> ListAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Raised when a tool call is refused before it runs.
/// </summary>
/// <remarks>
/// Separate from a tool that ran and failed. The distinction matters to the agent loop: a
/// refused call is a policy decision the model should be told about so it can try something
/// else, while a non-zero exit is a fact about the world to work with.
/// </remarks>
public sealed class SandboxPolicyException : Exception
{
    public SandboxPolicyException(string message) : base(message)
    {
    }
}