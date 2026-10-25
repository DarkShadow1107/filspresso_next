using System;

namespace Filspresso.Sandbox;

/// <summary>Only Direct() runs on the host. Every other script is decoded INSIDE the guest.</summary>
internal static class HyperVGuestScripts
{
    internal const string Root = @"C:\filspresso-workspace";
    internal const int MaxFileBytes = 262_144;
    internal const int MaxCommandOutput = 131_072;

    internal static string Direct(string vmName) => $$"""
        $ErrorActionPreference = 'Stop'
        try {
            $request = [Console]::In.ReadLine() | ConvertFrom-Json
            $secret = ConvertTo-SecureString -String ([string]$request.password) -AsPlainText -Force
            $credential = [Management.Automation.PSCredential]::new([string]$request.user, $secret)
            $request.password = $null
            $result = @(Invoke-Command -VMName '{{vmName}}' -Credential $credential -ErrorAction Stop -ArgumentList ([string]$request.script) -ScriptBlock {
                param([string]$encoded)
                $source = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($encoded))
                & ([ScriptBlock]::Create($source))
            })
            if ($result.Count -ne 1 -or $result[0] -isnot [string]) { throw 'Invalid guest response' }
            [Console]::Out.WriteLine([string]$result[0])
            exit 0
        } catch {
            [Console]::Error.WriteLine('PowerShell Direct operation failed.')
            exit 1
        }
        """;

    // Defense in depth, not race-proof handle-based containment. No file tool may be
    // enabled in production until reparse-point races and descendant lifetime are validated.
    private const string Guard = """
        $ErrorActionPreference = 'Stop'
        function Assert-WorkspacePath([string]$path) {
            $root = 'C:\filspresso-workspace'
            $full = [IO.Path]::GetFullPath($path)
            if ($full -ne $root -and -not $full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Outside workspace' }
            $current = $root
            $parts = @('') + @($full.Substring($root.Length).TrimStart('\').Split('\') | Where-Object { $_ -ne '' })
            foreach ($part in $parts) {
                if ($part) { $current = [IO.Path]::Combine($current, $part) }
                if (Test-Path -LiteralPath $current -ErrorAction Stop) {
                    $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
                    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are not workspace files' }
                }
            }
        }
        """;

    internal static string Ready => Guard + "\n" + """
        if (-not (Test-Path -LiteralPath 'C:\filspresso-workspace')) { New-Item -ItemType Directory -Path 'C:\filspresso-workspace' -Force | Out-Null }
        Assert-WorkspacePath 'C:\filspresso-workspace'
        if (-not (Test-Path -LiteralPath 'C:\filspresso-workspace' -PathType Container)) { throw 'Workspace is not a directory' }
        '{"version":1,"ready":true}'
        """;

    internal static string Write(string fullPath, ReadOnlyMemory<byte> contents) => Guard + "\n" + $$"""
        $path = '{{HyperVSandbox.Escape(fullPath)}}'
        Assert-WorkspacePath $path
        $dir = Split-Path -Parent $path
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Assert-WorkspacePath $path
        [IO.File]::WriteAllBytes($path, [Convert]::FromBase64String('{{Convert.ToBase64String(contents.Span)}}'))
        '{"version":1,"written":true}'
        """;

    internal static string Read(string fullPath) => Guard + "\n" + $$"""
        $path = '{{HyperVSandbox.Escape(fullPath)}}'
        Assert-WorkspacePath $path
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { '{"version":1,"missing":true}'; return }
        if ((Get-Item -LiteralPath $path -Force).Length -gt {{MaxFileBytes}}) { throw 'File is too large' }
        $bytes = [IO.File]::ReadAllBytes($path)
        if ($bytes.Length -gt {{MaxFileBytes}}) { throw 'File is too large' }
        @{ version = 1; bytes = [Convert]::ToBase64String($bytes) } | ConvertTo-Json -Compress
        """;

    internal const int MaxListEntries = 256;

    /// <summary>
    /// Lists one workspace directory for the read-only listing tool. Names are guest data:
    /// they are bounded, reparse-checked and never executed. A reparse point anywhere under
    /// a listed entry aborts the listing rather than following it.
    /// </summary>
    internal static string List(string fullDirectoryPath) => Guard + "\n" + $$"""
        $path = '{{HyperVSandbox.Escape(fullDirectoryPath)}}'
        Assert-WorkspacePath $path
        $prefix = [IO.Path]::GetFullPath($path).TrimEnd('\')
        if (-not (Test-Path -LiteralPath $prefix -PathType Container)) { '{"version":1,"missing":true}'; return }
        $entries = @()
        $truncated = $false
        foreach ($item in [IO.Directory]::EnumerateFileSystemEntries($prefix)) {
            if ($entries.Count -ge {{MaxListEntries}}) { $truncated = $true; break }
            $info = Get-Item -LiteralPath $item -Force -ErrorAction Stop
            if (($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are not workspace files' }
            $name = $info.FullName
            if (-not $name.StartsWith($prefix + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Listing escaped the workspace prefix' }
            $relative = $name.Substring($prefix.Length + 1)
            if ($info.PSIsContainer) {
                $entries += @{ name = $relative; kind = 'dir' }
            } else {
                if ($info.Length -gt {{MaxFileBytes}}) { throw 'File is too large' }
                $entries += @{ name = $relative; kind = 'file'; bytes = $info.Length }
            }
        }
        @{ version = 1; entries = $entries; truncated = $truncated } | ConvertTo-Json -Compress
        """;

    internal static string Run(string command, string arguments, string workingDirectory, TimeSpan timeout)
    {
        // exit/throw/native exit codes belong to a child PowerShell in the GUEST. They
        // cannot terminate the trusted remoting wrapper before its result is assembled.
        var child = $$"""
            [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
            $OutputEncoding = [Console]::OutputEncoding
            $ErrorActionPreference = 'Stop'
            $global:LASTEXITCODE = 0
            try {
                Set-Location -LiteralPath '{{HyperVSandbox.Escape(workingDirectory)}}'
                & {
                    {{command}} {{arguments}}
                }
                $ok = $?
                if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
                if (-not $ok) { exit 1 }
                exit 0
            } catch { [Console]::Error.WriteLine($_.ToString()); exit 1 }
            """;
        return Guard + "\n" + $$"""
            Assert-WorkspacePath '{{HyperVSandbox.Escape(workingDirectory)}}'
            $start = [Diagnostics.ProcessStartInfo]::new()
            $start.FileName = [IO.Path]::Combine($env:WINDIR, 'System32\WindowsPowerShell\v1.0\powershell.exe')
            $start.Arguments = '-NoProfile -NonInteractive -EncodedCommand {{HyperVSandbox.ToBase64(child)}}'
            $start.WorkingDirectory = '{{HyperVSandbox.Escape(workingDirectory)}}'
            $start.UseShellExecute = $false
            $start.CreateNoWindow = $true
            $start.RedirectStandardOutput = $true
            $start.RedirectStandardError = $true
            $start.RedirectStandardInput = $true
            $start.StandardOutputEncoding = [Text.Encoding]::UTF8
            $start.StandardErrorEncoding = [Text.Encoding]::UTF8
            $process = [Diagnostics.Process]::new()
            $process.StartInfo = $start
            $out = [Text.StringBuilder]::new()
            $err = [Text.StringBuilder]::new()
            $clock = [Diagnostics.Stopwatch]::StartNew()
            $timedOut = $false
            $limited = $false
            try {
                if (-not $process.Start()) { throw 'Guest process did not start' }
                $process.StandardInput.Close()
                $outBuffer = [char[]]::new(4096)
                $errBuffer = [char[]]::new(4096)
                $outRead = $process.StandardOutput.ReadAsync($outBuffer, 0, $outBuffer.Length)
                $errRead = $process.StandardError.ReadAsync($errBuffer, 0, $errBuffer.Length)
                while ($null -ne $outRead -or $null -ne $errRead -or -not $process.HasExited) {
                    if ($clock.ElapsedMilliseconds -ge {{(long)timeout.TotalMilliseconds}}) { $timedOut = $true; break }
                    if ($null -ne $outRead -and $outRead.IsCompleted) {
                        $count = $outRead.GetAwaiter().GetResult()
                        if ($count -eq 0) { $outRead = $null } else {
                            if ($out.Length + $err.Length + $count -gt {{MaxCommandOutput}}) { $limited = $true; break }
                            [void]$out.Append($outBuffer, 0, $count)
                            $outRead = $process.StandardOutput.ReadAsync($outBuffer, 0, $outBuffer.Length)
                        }
                    }
                    if ($null -ne $errRead -and $errRead.IsCompleted) {
                        $count = $errRead.GetAwaiter().GetResult()
                        if ($count -eq 0) { $errRead = $null } else {
                            if ($out.Length + $err.Length + $count -gt {{MaxCommandOutput}}) { $limited = $true; break }
                            [void]$err.Append($errBuffer, 0, $count)
                            $errRead = $process.StandardError.ReadAsync($errBuffer, 0, $errBuffer.Length)
                        }
                    }
                    Start-Sleep -Milliseconds 20
                }
                $code = -1
                if ($timedOut -or $limited) {
                    if (-not $process.HasExited) { $process.Kill() }
                    # Killing this child alone is NOT descendant cleanup. The host MUST turn
                    # off and discard the entire VM on either flag before reporting the result.
                } else { $process.WaitForExit(); $code = $process.ExitCode }
                @{ version = 1; exitCode = $code; stdout = $out.ToString(); stderr = $err.ToString(); timedOut = $timedOut; outputLimited = $limited } | ConvertTo-Json -Compress
            } finally { $process.Dispose() }
            """;
    }
}
