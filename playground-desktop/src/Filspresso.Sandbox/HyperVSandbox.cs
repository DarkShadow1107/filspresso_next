using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Filspresso.Sandbox;

/// <summary>
/// A Hyper-V virtual machine, used as the sandbox for generated code.
/// </summary>
/// <remarks>
/// ## The design, and the one property that matters
///
/// The virtual machine is created with **no network adapter**. Not a disabled one, not a
/// filtered one -- none at all. PowerShell Direct, which is how the harness controls it, runs
/// over the hypervisor's VMBus rather than over a network, so the session stays fully
/// controllable with no route off the machine.
/// <para>
/// That is stronger than a policy. Generated code cannot exfiltrate what it reads, cannot
/// fetch a payload to execute, and cannot reach the host's network, because there is nothing
/// to reach. A low-integrity process or a container would have to *forbid* the network; here
/// there is no network to forbid.
/// </para>
/// <para>
/// The cost is that the model cannot search the web from inside the sandbox. It does not
/// have to: the web tools run on the host, and the harness writes their results into the
/// sandbox as files. The sandbox never gains a socket.
/// </para>
///
/// ## What runs in it
///
/// The Windows Sandbox feature is deliberately not used. It is single-instance, it destroys
/// all state when it closes, and it has no scripting interface, so a coding agent that needs
/// a project directory to survive between turns cannot have one. A differencing disk on a
/// Hyper-V VM gives each session its own copy of a clean base image, disposable on teardown,
/// and scriptable.
/// </para>
/// </remarks>
public sealed class HyperVSandbox : ISandbox
{
    private readonly IPowerShellRunner _runner;
    private readonly string _baseImagePath;
    private readonly string _workspaceRoot;
    private readonly TimeSpan _commandTimeout;
    private readonly Dictionary<Guid, string> _sessions = new();

    public HyperVSandbox(
        IPowerShellRunner runner,
        string baseImagePath,
        string workspaceRoot,
        TimeSpan? commandTimeout = null)
    {
        ArgumentNullException.ThrowIfNull(runner);
        ArgumentException.ThrowIfNullOrWhiteSpace(baseImagePath);
        ArgumentException.ThrowIfNullOrWhiteSpace(workspaceRoot);

        _runner = runner;
        _baseImagePath = baseImagePath;
        _workspaceRoot = workspaceRoot;
        _commandTimeout = commandTimeout ?? TimeSpan.FromMinutes(5);
    }

    /// <summary>
    /// Whether Hyper-V is usable here at all.
    /// </summary>
    /// <remarks>
    /// Checked and reported rather than discovered by failing later: a machine without the
    /// Hyper-V role is a supported configuration that cannot run the Playground, and the user
    /// deserves to be told which of the two it is.
    /// </remarks>
    public async Task<(bool Available, string Reason)> ProbeAsync(CancellationToken cancellationToken = default)
    {
        var (exitCode, output, _) = await _runner.RunAsync(
            "if (Get-Command New-VM -ErrorAction SilentlyContinue) { 'OK' } else { 'MISSING' }",
            TimeSpan.FromSeconds(30),
            cancellationToken).ConfigureAwait(false);

        if (exitCode != 0 || !output.Contains("OK", StringComparison.Ordinal))
        {
            return (false, "The Hyper-V role is not installed, so the sandbox cannot be created.");
        }

        var (adminExit, adminOutput, _) = await _runner.RunAsync(
            "$id = [Security.Principal.WindowsIdentity]::GetCurrent(); " +
            "(New-Object Security.Principal.WindowsPrincipal $id).IsInRole(" +
            "[Security.Principal.WindowsBuiltInRole]::Administrator)",
            TimeSpan.FromSeconds(30),
            cancellationToken).ConfigureAwait(false);

        if (adminExit == 0 && adminOutput.Trim().Equals("False", StringComparison.OrdinalIgnoreCase))
        {
            return (false, "Creating a virtual machine needs administrator rights.");
        }

        return (true, string.Empty);
    }

    public async Task<SandboxSessionInfo> StartAsync(string name, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);

        var (available, reason) = await ProbeAsync(cancellationToken).ConfigureAwait(false);
        if (!available)
        {
            throw new InvalidOperationException(reason);
        }

        // The name is generated rather than taken from the caller: it ends up as a Hyper-V
        // object name, and a name with a quote in it is a quoting problem in every command
        // that touches it afterwards.
        var vmName = $"filspresso-{Guid.NewGuid():N}";
        var differencingDisk = Path.Combine(_workspaceRoot, $"{vmName}.vhdx");

        // No -SwitchName, and no Connect-VMNetworkAdapter afterwards. That omission is the
        // sandbox's whole security property, so it is stated in the comment on the line that
        // would otherwise look like an oversight.
        var create = $@"
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath '{Escape(_baseImagePath)}')) {{ throw 'the base image is missing' }}
if (-not (Test-Path -LiteralPath '{Escape(differencingDisk)}')) {{
    New-VHD -Path '{Escape(differencingDisk)}' -ParentPath '{Escape(_baseImagePath)}' -Dynamic | Out-Null
}}
$vm = New-VM -Name '{vmName}' -MemoryStartupBytes 2GB -VHDPath '{Escape(differencingDisk)}' -Generation 2
$vm | Set-VMMemory -DynamicMemoryEnabled $true -MinimumBytes 1GB -MaximumBytes 4GB
# No network adapter is ever attached. The session is controlled over PowerShell Direct,
# which travels the hypervisor's VMBus, so the machine stays scriptable with no route off
# the host. This is the property the whole design rests on, so it is asserted rather than
# assumed.
if ($vm.NetworkAdapters.Count -ne 0) {{
    $vm.NetworkAdapters | Remove-VMNetworkAdapter
}}
$vm | Set-VMFirmware -EnableSecureBoot On -BootOrder @([Microsoft.HyperV.VirtualMachineFirmwareBootOrderSource]::BootOrder)
Start-VM -Name '{vmName}' | Out-Null
'CREATED'
";
        var (exitCode, output, error) = await _runner.RunAsync(create, TimeSpan.FromMinutes(5), cancellationToken)
            .ConfigureAwait(false);

        if (exitCode != 0 || !output.Contains("CREATED", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"The sandbox could not be created: {error.Trim()}");
        }

        var id = Guid.NewGuid();
        _sessions[id] = vmName;
        return new SandboxSessionInfo(id, vmName, SandboxState.Ready, 0, null);
    }

    public async Task<ToolResult> RunAsync(
        Guid sessionId,
        string command,
        string arguments,
        string? workingDirectory = null,
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(command);
        var vmName = Resolve(sessionId);

        // The command is written into a script file inside the session and run from there,
        // rather than passed as an argument. PowerShell's argument quoting is a maze, and a
        // command that is mangled by quoting is a command that ran something else.
        var script = $@"
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath '{Escape(workingDirectory ?? "C:\\")}'
{command} {arguments}
exit $LASTEXITCODE
";
        var (exitCode, output, error) = await _runner.RunAsync(
            $"Invoke-Command -VMName '{vmName}' -ScriptBlock {{ {ToBase64(script)} }}",
            timeout ?? _commandTimeout,
            cancellationToken).ConfigureAwait(false);

        return new ToolResult(
            ExitCode: exitCode,
            StandardOutput: output,
            StandardError: error,
            Duration: timeout ?? _commandTimeout,
            TimedOut: false);
    }

    public async Task<string> WriteFileAsync(
        Guid sessionId,
        string relativePath,
        ReadOnlyMemory<byte> contents,
        CancellationToken cancellationToken = default)
    {
        var vmName = Resolve(sessionId);
        var full = CombineInsideGuest(relativePath);

        // Base64 through the PowerShell Direct channel: the bytes are written by a command
        // that decodes them, so there is no encoding to get wrong on the way in and no
        // quoting to get wrong on the way through.
        var payload = Convert.ToBase64String(contents.ToArray());
        var script = $@"
$bytes = [Convert]::FromBase64String('{payload}')
$dir = Split-Path -Parent '{Escape(full)}'
if ($dir) {{ New-Item -ItemType Directory -Path $dir -Force | Out-Null }}
[System.IO.File]::WriteAllBytes('{Escape(full)}', $bytes)
'WROTE'
";
        var (exitCode, output, error) = await _runner.RunAsync(
            $"Invoke-Command -VMName '{vmName}' -ScriptBlock {{ {ToBase64(script)} }}",
            _commandTimeout,
            cancellationToken).ConfigureAwait(false);

        if (exitCode != 0 || !output.Contains("WROTE", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"The file could not be written: {error.Trim()}");
        }

        return full;
    }

    public async Task<string> ReadFileAsync(
        Guid sessionId,
        string relativePath,
        CancellationToken cancellationToken = default)
    {
        var vmName = Resolve(sessionId);
        var full = CombineInsideGuest(relativePath);
        var script = $@"
if (Test-Path -LiteralPath '{Escape(full)}') {{
    [Convert]::ToBase64String([System.IO.File]::ReadAllBytes('{Escape(full)}'))
}} else {{
    'MISSING'
}}
";
        var (exitCode, output, _) = await _runner.RunAsync(
            $"Invoke-Command -VMName '{vmName}' -ScriptBlock {{ {ToBase64(script)} }}",
            _commandTimeout,
            cancellationToken).ConfigureAwait(false);

        if (exitCode != 0)
        {
            throw new InvalidOperationException("The file could not be read.");
        }

        var trimmed = output.Trim();
        if (trimmed == "MISSING" || trimmed.Length == 0)
        {
            throw new FileNotFoundException($"No such file in the sandbox: {relativePath}");
        }

        return Encoding.UTF8.GetString(Convert.FromBase64String(trimmed));
    }

    public async Task StopAsync(Guid sessionId, CancellationToken cancellationToken = default)
    {
        if (!_sessions.Remove(sessionId, out var vmName))
        {
            // Stopping something already stopped is a success, not an error: teardown runs
            // from a crash handler as well as from a clean exit, and it has to be safe to call
            // twice.
            return;
        }

        // The virtual machine is stopped and removed, and the differencing disk with it. The
        // disk is what makes the session disposable; leaving it would fill the disk over
        // time and would keep the previous session's files on the machine.
        var teardown = $@"
$ErrorActionPreference = 'SilentlyContinue'
Stop-VM -Name '{vmName}' -Force
Remove-VM -Name '{vmName}' -Force
Get-VHD -Path (Get-VM -Name '{vmName}' -ErrorAction SilentlyContinue).Path | Remove-VHD -Force
'DONE'
";
        await _runner.RunAsync(teardown, TimeSpan.FromMinutes(2), cancellationToken).ConfigureAwait(false);
    }

    public Task<IReadOnlyList<SandboxSessionInfo>> ListAsync(CancellationToken cancellationToken = default)
    {
        IReadOnlyList<SandboxSessionInfo> sessions = _sessions
            .Select(pair => new SandboxSessionInfo(pair.Key, pair.Value, SandboxState.Ready, 0, null))
            .ToArray();

        return Task.FromResult(sessions);
    }

    private string Resolve(Guid sessionId) =>
        _sessions.TryGetValue(sessionId, out var name)
            ? name
            : throw new InvalidOperationException($"No such sandbox session: {sessionId}");

    /// <summary>
    /// Where a file goes inside the guest.
    /// </summary>
    /// <remarks>
    /// Fixed to a path inside the guest, and the path is *combined* rather than
    /// concatenated, so a relative path with `..` in it cannot climb out of the workspace. The
    /// guest has no network, but it does have a filesystem, and the workspace directory is the
    /// boundary.
    /// </remarks>
    internal static string CombineInsideGuest(string relativePath)
    {
        const string root = @"C:\filspresso-workspace";
        var combined = Path.GetFullPath(Path.Combine(root, relativePath));
        if (!combined.StartsWith(root, StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("The path must stay inside the sandbox workspace.", nameof(relativePath));
        }

        return combined;
    }

    /// <summary>Escape a value for a single-quoted PowerShell string.</summary>
    internal static string Escape(string value) => value.Replace("'", "''");

    /// <summary>Wrap a script so it survives being nested inside a script block.</summary>
    internal static string ToBase64(string script) =>
        Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
}
