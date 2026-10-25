using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace Filspresso.Sandbox;

public enum ExecutionIsolation { WindowsSandbox, NativeRestricted }

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

/// <summary>One bounded directory listing of the guest workspace.</summary>
public sealed record GuestListing(IReadOnlyList<GuestListingEntry> Entries, bool Truncated);
public sealed record GuestListingEntry(string Name, bool IsDirectory, long Bytes);

/// <summary>Bounded file tools shared by VM backends. No host-directory executor exists.</summary>
public interface IWorkspaceSandbox : ISandbox, IDisposable
{
    Task<GuestListing> ListFilesAsync(Guid sessionId, string? relativePath, CancellationToken cancellationToken = default);
}

public sealed record SandboxTextFile(string Path, string Contents);
public interface ISandboxSnapshot
{
    Task<IReadOnlyList<SandboxTextFile>> CaptureAsync(Guid sessionId, IReadOnlyCollection<string> trackedPaths,
        CancellationToken cancellationToken = default);
}

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
    /// Generated commands have no network access. Hyper-V omits adapters; Windows Sandbox
    /// explicitly disables networking. Web lookup is a separate authenticated backend tool.
    /// </remarks>
    Task<SandboxSessionInfo> StartAsync(string name, CancellationToken cancellationToken = default);

    /// <summary>
    /// Runs a command inside the session and waits.
    /// </summary>
    /// <param name="workingDirectory">
    /// Null means the sandbox's own workspace; non-null must be workspace-relative, never
    /// a host path. This API does not grant consent: a production adapter must enforce mode
    /// and per-action approval before calling it.
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
    /// Only the VM workspace is writable, never the user's original project.
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
    /// Invalidates and destroys the session. Idempotent after confirmed teardown. Failure
    /// must remain visible and retryable; killing a remoting client alone is not guest cleanup.
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
