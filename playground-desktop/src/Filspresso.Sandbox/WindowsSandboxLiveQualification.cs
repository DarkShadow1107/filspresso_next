using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Filspresso.Sandbox;

/// <summary>Fixed probes in actual Windows Sandbox VMs. Does not itself issue a receipt;
/// the console must additionally prove cross-process crash recovery.</summary>
public static class WindowsSandboxLiveQualification
{
    public static async Task<IReadOnlyList<string>> RunAsync(WindowsSandbox sandbox, Action<string> report, CancellationToken token)
    {
        var checks = new List<string>();
        report("Starting offline VM and verifying read-only input mapping");
        var session = await sandbox.StartAsync("qualification", token).ConfigureAwait(false);
        try
        {
            checks.AddRange(["explicit-id", "offline-readonly-input"]);
            report("Pinned file roundtrip, race and alias probes");
            await sandbox.WriteFileAsync(session.Id, "src/test.txt", Encoding.UTF8.GetBytes("before 界"), token).ConfigureAwait(false);
            if (await sandbox.ReadFileAsync(session.Id, "src/test.txt", token).ConfigureAwait(false) != "before 界") throw new InvalidDataException();
            checks.Add("file-roundtrip");
            var race = await sandbox.QualificationProbeAsync(session.Id, """
                [Filspresso.Guest.FenceQualification]::Races('C:\filspresso-workspace')
                '{"version":1,"ok":true}'
                """, token).ConfigureAwait(false);
            if (!race.GetProperty("ok").GetBoolean()) throw new InvalidDataException();
            checks.Add("pinned-directory-races");
            report("AppContainer, installed job limits and command-generated source capture");
            var command = await sandbox.RunAsync(session.Id, """
                $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent());
                if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 90 };
                try { [IO.File]::WriteAllText('C:\Windows\filspresso-escape.txt', 'escape'); exit 91 } catch [UnauthorizedAccessException] { };
                try { [IO.File]::WriteAllText('C:\filspresso-out\workload-escape.txt', 'escape'); exit 92 } catch [UnauthorizedAccessException] { };
                [IO.File]::WriteAllText('C:\filspresso-workspace\src\test.txt', 'after');
                [Console]::WriteLine('LOWBOX_OK')
                """, "", cancellationToken: token).ConfigureAwait(false);
            if (command.ExitCode != 0 || !command.StandardOutput.Contains("LOWBOX_OK", StringComparison.Ordinal)) throw new InvalidDataException("Lowbox boundary failed.");
            checks.Add("appcontainer-jobs");
            var snapshot = await sandbox.CaptureAsync(session.Id, ["src/test.txt"], token).ConfigureAwait(false);
            if (!snapshot.Any(file => file.Path == "src/test.txt" && file.Contents == "after")) throw new InvalidDataException("Snapshot did not capture command edits.");
            checks.Add("command-snapshot");
            report("Normal-exit descendant termination");
            var child = await sandbox.RunAsync(session.Id, """
                $start = [Diagnostics.ProcessStartInfo]::new(); $start.UseShellExecute = $false;
                $start.FileName = $PSHOME + '\powershell.exe';
                $start.Arguments = '-NoProfile -NonInteractive -Command "Start-Sleep -Seconds 120"';
                $child = [Diagnostics.Process]::Start($start); [Console]::WriteLine($child.Id); exit 0
                """, "", cancellationToken: token).ConfigureAwait(false);
            if (child.ExitCode != 0 || !int.TryParse(child.StandardOutput.Trim(), out var pid)) throw new InvalidDataException();
            var cleaned = await sandbox.QualificationProbeAsync(session.Id, $$"""
                if (Get-Process -Id {{pid}} -ErrorAction SilentlyContinue) { throw 'Child survived' }
                '{"version":1,"ok":true}'
                """, token).ConfigureAwait(false);
            if (!cleaned.GetProperty("ok").GetBoolean()) throw new InvalidDataException();
            checks.Add("normal-exit-descendants");
            var aliases = await sandbox.QualificationProbeAsync(session.Id, """
                [IO.Directory]::CreateDirectory('C:\filspresso-private') | Out-Null
                [IO.File]::WriteAllText('C:\filspresso-private\keep.txt', 'keep')
                cmd.exe /d /c mklink /J C:\filspresso-workspace\junction C:\filspresso-private | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'Junction fixture failed' }
                $refused = $false
                try { $pin = Open-WorkspaceDirectory 'C:\filspresso-workspace\junction' $false; $pin.Dispose() } catch { $refused = $true }
                if (-not $refused) { throw 'Junction followed' }
                cmd.exe /d /c mklink /H C:\filspresso-workspace\alias.txt C:\filspresso-private\keep.txt | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'Hard-link fixture failed' }
                $pin = Open-WorkspaceDirectory 'C:\filspresso-workspace' $false
                try {
                    $refused = $false
                    try { $file = $pin.Open('alias.txt', $true); $file.Dispose() } catch { $refused = $true }
                    if (-not $refused -or [IO.File]::ReadAllText('C:\filspresso-private\keep.txt') -ne 'keep') { throw 'Alias accepted' }
                } finally { $pin.Dispose() }
                '{"version":1,"ok":true}'
                """, token).ConfigureAwait(false);
            if (!aliases.GetProperty("ok").GetBoolean()) throw new InvalidDataException();
            checks.Add("reparse-hardlink-refusal");
        }
        finally { await sandbox.StopAsync(session.Id).ConfigureAwait(false); }

        report("Timeout invalidation and VM teardown");
        session = await sandbox.StartAsync("timeout", token).ConfigureAwait(false);
        var timedOut = false;
        try { await sandbox.RunAsync(session.Id, "Start-Sleep -Seconds 120", "", timeout: TimeSpan.FromSeconds(2), cancellationToken: token).ConfigureAwait(false); }
        catch (TimeoutException) { timedOut = true; }
        if (!timedOut || (await sandbox.ListAsync(token).ConfigureAwait(false)).Count != 0) throw new InvalidDataException("Timeout cleanup failed.");
        checks.Add("timeout-discard");

        report("Output overflow invalidation and VM teardown");
        session = await sandbox.StartAsync("overflow", token).ConfigureAwait(false);
        var limited = false;
        try { await sandbox.RunAsync(session.Id, "[Console]::Out.Write(('x' * 200000)); Start-Sleep -Seconds 120", "", cancellationToken: token).ConfigureAwait(false); }
        catch (PowerShellOutputLimitException) { limited = true; }
        if (!limited || (await sandbox.ListAsync(token).ConfigureAwait(false)).Count != 0) throw new InvalidDataException("Output cleanup failed.");
        checks.AddRange(["output-discard", "stop-confirmed"]);
        return checks.AsReadOnly();
    }
}
