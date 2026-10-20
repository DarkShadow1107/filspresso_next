using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Filspresso.Sandbox;

/// <summary>
/// Runs PowerShell, which is how Hyper-V is administered.
/// </summary>
/// <remarks>
/// Both halves of this product are PowerShell surfaces: the Hyper-V module manages the
/// virtual machine, and PowerShell Direct is a PowerShell remoting feature. .NET has no
/// first-class API for either, and writing a CIM client for the first and a VMBus protocol
/// client for the second would be a large amount of code that talks to an interface Microsoft
/// already ships a client for.
/// <para>
/// The runner is an interface so the sandbox's decisions -- which VM to create, what to run
/// in it, how to tear it down -- can be tested without a hypervisor, and so the parts that
/// decide what runs can be checked even on a machine that cannot run a VM.
/// </para>
/// </remarks>
public interface IPowerShellRunner
{
    /// <summary>Runs a script and returns its output and exit code.</summary>
    Task<(int ExitCode, string Output, string Error)> RunAsync(
        string script,
        TimeSpan timeout,
        CancellationToken cancellationToken = default);
}

/// <summary>The real runner: <c>powershell.exe</c>.</summary>
public sealed class PowerShellRunner : IPowerShellRunner
{
    private readonly string _executable;

    public PowerShellRunner(string? executable = null) =>
        _executable = executable ?? "powershell.exe";

    public async Task<(int ExitCode, string Output, string Error)> RunAsync(
        string script,
        TimeSpan timeout,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(script);

        var startInfo = new ProcessStartInfo
        {
            FileName = _executable,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        // Encoded rather than passed as an argument: a script with quotes, pipes or a path with
        // a space in it is a quoting problem otherwise, and quoting problems in a shell
        // invocation are how a command ends up running something other than what was written.
        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-NonInteractive");
        startInfo.ArgumentList.Add("-EncodedCommand");
        startInfo.ArgumentList.Add(encoded);

        using var process = new Process { StartInfo = startInfo };
        if (!process.Start())
        {
            throw new InvalidOperationException("Could not start PowerShell.");
        }

        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();

        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);

        try
        {
            await process.WaitForExitAsync(timeoutSource.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch { /* already gone */ }
            throw new TimeoutException($"The PowerShell command did not finish within {timeout}.");
        }

        return (process.ExitCode, await stdout.ConfigureAwait(false), await stderr.ConfigureAwait(false));
    }
}
