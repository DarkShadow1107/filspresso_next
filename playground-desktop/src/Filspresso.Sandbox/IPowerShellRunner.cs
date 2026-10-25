using System;
using System.Diagnostics;
using System.IO;
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
    /// <summary>
    /// Runs trusted host administration. Implementations must bound reads and stop the host
    /// process before completing cancellation, or throw PowerShellProcessCleanupException.
    /// This does not itself stop a guest workload.
    /// </summary>
    Task<(int ExitCode, string Output, string Error)> RunAsync(
        string script,
        TimeSpan timeout,
        CancellationToken cancellationToken = default);

    bool SupportsStandardInput => false;

    /// <summary>Secrets/data go through stdin, never through the process command line.</summary>
    Task<(int ExitCode, string Output, string Error)> RunWithInputAsync(string script, string standardInput,
        TimeSpan timeout, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException("This PowerShell runner cannot pass private standard input.");
}

public sealed class PowerShellOutputLimitException : IOException
{
    public PowerShellOutputLimitException() : base("PowerShell output exceeded the transport limit.") { }
}

public sealed class PowerShellProcessCleanupException : IOException
{
    public PowerShellProcessCleanupException() : base("The host PowerShell process could not be confirmed stopped.") { }
}

/// <summary>The real runner: <c>powershell.exe</c>.</summary>
public sealed class PowerShellRunner : IPowerShellRunner
{
    private readonly string _executable;
    private readonly int _maxOutputCharacters;
    public const int MaxInputCharacters = 1_048_576;
    public bool SupportsStandardInput => true;

    public PowerShellRunner(string? executable = null, int maxOutputCharacters = 1_048_576)
    {
        if (maxOutputCharacters is < 256 or > 1_048_576) throw new ArgumentOutOfRangeException(nameof(maxOutputCharacters));
        _maxOutputCharacters = maxOutputCharacters;
        _executable = executable ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
    }

    public Task<(int ExitCode, string Output, string Error)> RunAsync(
        string script,
        TimeSpan timeout,
        CancellationToken cancellationToken = default) => RunCoreAsync(script, null, timeout, cancellationToken);

    public Task<(int ExitCode, string Output, string Error)> RunWithInputAsync(string script, string standardInput,
        TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(standardInput);
        if (standardInput.Length > MaxInputCharacters || standardInput.Contains('\n') || standardInput.Contains('\r'))
            throw new ArgumentException("Standard input must be one bounded JSON line.", nameof(standardInput));
        return RunCoreAsync(script, standardInput, timeout, cancellationToken);
    }

    private async Task<(int ExitCode, string Output, string Error)> RunCoreAsync(string script, string? standardInput,
        TimeSpan timeout, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(script);
        if (timeout <= TimeSpan.Zero || timeout > TimeSpan.FromMinutes(5)) throw new ArgumentOutOfRangeException(nameof(timeout));
        cancellationToken.ThrowIfCancellationRequested();

        var startInfo = new ProcessStartInfo
        {
            FileName = _executable,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        // Encoded rather than passed as an argument: a script with quotes, pipes or a path with
        // a space in it is a quoting problem otherwise, and quoting problems in a shell
        // invocation are how a command ends up running something other than what was written.
        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(
            "$ProgressPreference = 'SilentlyContinue'; " +
            "[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); " +
            "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); " + script));
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-NonInteractive");
        startInfo.ArgumentList.Add("-OutputFormat");
        startInfo.ArgumentList.Add("Text");
        startInfo.ArgumentList.Add("-EncodedCommand");
        startInfo.ArgumentList.Add(encoded);

        using var process = new Process { StartInfo = startInfo };
        if (!process.Start())
        {
            throw new InvalidOperationException("Could not start PowerShell.");
        }

        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);
        var exceeded = 0;
        var stdout = ReadBoundedAsync(process.StandardOutput, timeoutSource.Token, () => { Interlocked.Exchange(ref exceeded, 1); timeoutSource.Cancel(); });
        var stderr = ReadBoundedAsync(process.StandardError, timeoutSource.Token, () => { Interlocked.Exchange(ref exceeded, 1); timeoutSource.Cancel(); });

        try
        {
            if (standardInput is not null) await process.StandardInput.WriteLineAsync(standardInput.AsMemory(), timeoutSource.Token).ConfigureAwait(false);
            process.StandardInput.Close();
            await process.WaitForExitAsync(timeoutSource.Token).ConfigureAwait(false);
            var output = await stdout.WaitAsync(timeoutSource.Token).ConfigureAwait(false);
            var error = await stderr.WaitAsync(timeoutSource.Token).ConfigureAwait(false);
            return (process.ExitCode, output, error);
        }
        catch (Exception)
        {
            var timedOut = timeoutSource.IsCancellationRequested;
            try { process.Kill(entireProcessTree: true); } catch { /* already gone */ }
            timeoutSource.Cancel();
            // Do not leave pipe readers or a process wait unobserved. All cleanup has its own
            // short bound, independent of an already-cancelled caller token.
            try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false); } catch { }
            try { await Task.WhenAll(stdout, stderr).WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false); } catch { }
            if (!process.HasExited) throw new PowerShellProcessCleanupException();
            cancellationToken.ThrowIfCancellationRequested();
            if (Volatile.Read(ref exceeded) != 0) throw new PowerShellOutputLimitException();
            if (timedOut) throw new TimeoutException("The PowerShell transport did not finish in time.");
            throw new InvalidOperationException("The PowerShell transport failed.");
        }
    }

    private async Task<string> ReadBoundedAsync(StreamReader reader, CancellationToken token, Action onLimit)
    {
        var text = new StringBuilder();
        var buffer = new char[4096];
        for (;;)
        {
            var count = await reader.ReadAsync(buffer.AsMemory(), token).ConfigureAwait(false);
            if (count == 0) return text.ToString();
            if (count > _maxOutputCharacters - text.Length) { onLimit(); throw new PowerShellOutputLimitException(); }
            text.Append(buffer, 0, count);
        }
    }
}
