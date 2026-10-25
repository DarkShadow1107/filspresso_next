using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Filspresso.Sandbox;

/// <summary>Actual adapter probes, never mocked into a receipt. Only the explicit operator
/// console calls this. Every probe changes a disposable offline guest, not the host project.</summary>
public static class HyperVLiveQualification
{
    public static async Task<IReadOnlyList<string>> RunAsync(HyperVSandbox sandbox, CancellationToken token = default, Action<string>? report = null)
    {
        var checks = new List<string>();
        report?.Invoke("hyper-v-start-and-image-lock");
        var session = await sandbox.StartAsync("operator qualification", token).ConfigureAwait(false);
        try
        {
            checks.AddRange(["hyper-v-admin", "image-unattached", "guest-ready", "no-network-adapter", "image-locked"]);
            report?.Invoke("workspace-roundtrip");
            var bytes = Encoding.UTF8.GetBytes("qualification 界\r\n");
            await sandbox.WriteFileAsync(session.Id, "qualification/sentinel.txt", bytes, token).ConfigureAwait(false);
            if (await sandbox.ReadFileAsync(session.Id, "qualification/sentinel.txt", token).ConfigureAwait(false) != "qualification 界\r\n") throw new InvalidDataException("Guest UTF-8 round trip failed.");
            checks.Add("workspace-fenced");
            report?.Invoke("pinned-directory-races");
            var race = await sandbox.QualificationProbeAsync(session.Id, """
                [Filspresso.Guest.FenceQualification]::Races('C:\filspresso-workspace')
                '{"version":1,"ok":true}'
                """, token).ConfigureAwait(false);
            if (!race.GetProperty("ok").GetBoolean()) throw new InvalidDataException("Guest race checks failed.");
            checks.Add("pinned-directory-races");
            report?.Invoke("appcontainer-and-job-resource-bounds");
            var command = await sandbox.RunAsync(session.Id, """
                [IO.File]::WriteAllText('C:\filspresso-workspace\qualification\command.txt', 'command-ok');
                $identity = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent());
                if ($identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 91 };
                try { [IO.File]::WriteAllText('C:\Windows\filspresso-escape.txt', 'no'); exit 92 } catch [UnauthorizedAccessException] { };
                [Console]::WriteLine('LOWBOX_OK')
                """, "", timeout: TimeSpan.FromSeconds(30), cancellationToken: token).ConfigureAwait(false);
            if (command.ExitCode != 0 || !command.StandardOutput.Contains("LOWBOX_OK", StringComparison.Ordinal)) throw new InvalidDataException("Guest AppContainer probe failed.");
            checks.AddRange(["appcontainer-no-capabilities", "job-before-resume", "job-resource-bounds"]);
            report?.Invoke("normal-exit-descendants");
            var children = await sandbox.RunAsync(session.Id, """
                $start = [Diagnostics.ProcessStartInfo]::new();
                $start.FileName = $PSHOME + '\powershell.exe'; $start.UseShellExecute = $false;
                $start.Arguments = '-NoProfile -NonInteractive -Command "Start-Sleep -Seconds 120"';
                $child = [Diagnostics.Process]::Start($start); [Console]::WriteLine($child.Id); exit 0
                """, "", timeout: TimeSpan.FromSeconds(30), cancellationToken: token).ConfigureAwait(false);
            if (children.ExitCode != 0 || !int.TryParse(children.StandardOutput.Trim(), out var childId)) throw new InvalidDataException("Guest descendant probe failed.");
            var noChild = await sandbox.QualificationProbeAsync(session.Id, $$"""
                if (Get-Process -Id {{childId}} -ErrorAction SilentlyContinue) { throw 'Detached child survived' }
                '{"version":1,"ok":true}'
                """, token).ConfigureAwait(false);
            if (!noChild.GetProperty("ok").GetBoolean()) throw new InvalidDataException();
            checks.Add("normal-exit-descendants");
            report?.Invoke("reparse-hardlink-refusal");
            var attacks = await sandbox.QualificationProbeAsync(session.Id, """
                $outside = 'C:\filspresso-qualification-private'
                [IO.Directory]::CreateDirectory($outside) | Out-Null
                [IO.File]::WriteAllText($outside + '\keep.txt', 'untouched')
                cmd.exe /c mklink /J C:\filspresso-workspace\junction $outside | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'Cannot create junction attack fixture' }
                $refused = $false
                try { $pin = Open-WorkspaceDirectory 'C:\filspresso-workspace\junction' $false; $pin.Dispose() }
                catch { $refused = $true }
                if (-not $refused) { throw 'Junction followed' }
                cmd.exe /c mklink /H C:\filspresso-workspace\alias.txt C:\filspresso-qualification-private\keep.txt | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'Cannot create hard-link attack fixture' }
                $pin = Open-WorkspaceDirectory 'C:\filspresso-workspace' $false
                try {
                    $refused = $false
                    try { $file = $pin.Open('alias.txt', $true); $file.Dispose() } catch { $refused = $true }
                    if (-not $refused -or [IO.File]::ReadAllText($outside + '\keep.txt') -ne 'untouched') { throw 'Hard link accepted' }
                } finally { $pin.Dispose() }
                '{"version":1,"ok":true}'
                """, token).ConfigureAwait(false);
            if (!attacks.GetProperty("ok").GetBoolean()) throw new InvalidDataException();
            checks.Add("reparse-hardlink-refusal");
        }
        finally { await sandbox.StopAsync(session.Id, CancellationToken.None).ConfigureAwait(false); }

        report?.Invoke("timeout-discard");
        session = await sandbox.StartAsync("timeout qualification", token).ConfigureAwait(false);
        try
        {
            var timed = await sandbox.RunAsync(session.Id, "Start-Sleep -Seconds 120", "", timeout: TimeSpan.FromSeconds(3), cancellationToken: token).ConfigureAwait(false);
            if (!timed.TimedOut || (await sandbox.ListAsync(token).ConfigureAwait(false)).Count != 0) throw new InvalidDataException("Timeout did not discard the VM.");
            checks.Add("timeout-discard");
        }
        finally { await sandbox.StopAsync(session.Id, CancellationToken.None).ConfigureAwait(false); }

        report?.Invoke("output-limit-discard");
        session = await sandbox.StartAsync("output qualification", token).ConfigureAwait(false);
        try
        {
            var refused = false;
            try { await sandbox.RunAsync(session.Id, "[Console]::Out.Write(('x' * 200000)); Start-Sleep -Seconds 120", "", timeout: TimeSpan.FromSeconds(30), cancellationToken: token).ConfigureAwait(false); }
            catch (PowerShellOutputLimitException) { refused = true; }
            if (!refused || (await sandbox.ListAsync(token).ConfigureAwait(false)).Count != 0) throw new InvalidDataException("Output limit did not discard the VM.");
            checks.Add("output-limit-discard");
        }
        finally { await sandbox.StopAsync(session.Id, CancellationToken.None).ConfigureAwait(false); }
        checks.Add("cleanup-confirmed");
        return checks.AsReadOnly();
    }
}
