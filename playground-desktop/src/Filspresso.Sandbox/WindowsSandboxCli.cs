using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Filspresso.Sandbox;

public sealed record SandboxCliResult(int ExitCode, string Output);
public interface IWindowsSandboxCli
{
    Task<SandboxCliResult> RunAsync(IReadOnlyList<string> arguments, TimeSpan timeout, CancellationToken cancellationToken);
}

/// <summary>Only wsb administration is launched on the host. Guest source is a file on a
/// read-only mapping, never host PowerShell, shell interpolation, or a generated executable.</summary>
public sealed class WindowsSandboxCli : IWindowsSandboxCli
{
    public static string ExecutablePath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\WindowsApps\wsb.exe");
    public async Task<SandboxCliResult> RunAsync(IReadOnlyList<string> arguments, TimeSpan timeout, CancellationToken cancellationToken)
    {
        if (arguments.Count == 0 || arguments[0] is not ("list" or "start" or "exec" or "stop") ||
            arguments.Count > 12 || arguments.Any(value => value.Length > 24_000 || value.Contains('\0')) ||
            timeout <= TimeSpan.Zero || timeout > TimeSpan.FromMinutes(5)) throw new ArgumentException("Invalid Sandbox administration request.");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken); deadline.CancelAfter(timeout);
        var start = new ProcessStartInfo(ExecutablePath) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
        start.ArgumentList.Add("--raw"); foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var job = new HostProcessJob(); using var process = new Process { StartInfo = start };
        deadline.Token.ThrowIfCancellationRequested();
        if (!process.Start()) throw new IOException("Windows Sandbox CLI could not start.");
        var output = ReadAsync(process.StandardOutput, deadline.Token);
        var errors = ReadAsync(process.StandardError, deadline.Token);
        try
        {
            job.Assign(process); process.StandardInput.Close();
            await process.WaitForExitAsync(deadline.Token).ConfigureAwait(false);
            job.Terminate();
            var text = await output.ConfigureAwait(false); await errors.ConfigureAwait(false);
            return new(process.ExitCode, text);
        }
        catch
        {
            try { job.Terminate(); } catch { try { process.Kill(true); } catch { } }
            deadline.Cancel();
            try { await Task.WhenAll(output, errors).WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false); } catch { }
            throw;
        }
    }
    private static async Task<string> ReadAsync(StreamReader reader, CancellationToken token)
    {
        var result = new StringBuilder(); var buffer = new char[4096];
        for (;;)
        {
            var count = await reader.ReadAsync(buffer.AsMemory(), token).ConfigureAwait(false);
            if (count == 0) return result.ToString();
            if (result.Length + count > 65_536) throw new IOException("Windows Sandbox CLI response exceeded its limit.");
            result.Append(buffer, 0, count);
        }
    }
}
