using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Filspresso.Sandbox;

/// <summary>Only Direct runs on the host. The embedded native boundary is compiled INSIDE the guest.</summary>
internal static class HyperVGuestScripts
{
    internal const string Root = @"C:\filspresso-workspace";
    internal const int MaxFileBytes = 262_144;
    internal const int MaxCommandOutput = 131_072;
    internal const int MaxListEntries = 256;
    internal static string BoundarySource { get; } = LoadSource();
    private static string LoadSource()
    {
        using var stream = typeof(HyperVGuestScripts).Assembly.GetManifestResourceStream("Filspresso.GuestBoundary.cs")!;
        using var reader = new StreamReader(stream);
        var boundary = reader.ReadToEnd();
        using var checks = typeof(HyperVGuestScripts).Assembly.GetManifestResourceStream("Filspresso.FenceQualification.cs")!;
        using var checkReader = new StreamReader(checks);
        return boundary + "\n" + checkReader.ReadToEnd();
    }
    internal static string BoundarySha256 => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(BoundarySource)));
    internal static string Direct(string vmName) => $$"""
        $ErrorActionPreference = 'Stop'
        try {
            $request = [Console]::In.ReadLine() | ConvertFrom-Json
            $secret = ConvertTo-SecureString -String ([string]$request.password) -AsPlainText -Force
            $credential = [Management.Automation.PSCredential]::new([string]$request.user, $secret)
            $request.password = $null
            $result = @(Invoke-Command -VMName '{{vmName}}' -Credential $credential -ErrorAction Stop -ArgumentList ([string]$request.script) -ScriptBlock {
                param([string]$encoded)
                $source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
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

    internal static string Guard => $$"""
        $ErrorActionPreference = 'Stop'
        if (-not ('Filspresso.Guest.Fence' -as [type])) {
            Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{{Convert.ToBase64String(Encoding.UTF8.GetBytes(BoundarySource))}}')))
        }
        function Open-WorkspaceDirectory([string]$path, [bool]$create) {
            [Filspresso.Guest.Fence]::new('C:\filspresso-workspace', $path, $create)
        }
        """;

    internal static string Ready => Guard + "\n" + """
        $fence = Open-WorkspaceDirectory 'C:\filspresso-workspace' $true
        try { '{"version":1,"ready":true}' } finally { $fence.Dispose() }
        """;

    internal static string Write(string fullPath, ReadOnlyMemory<byte> contents) => Guard + "\n" + $$"""
        $path = '{{HyperVSandbox.Escape(fullPath)}}'
        $fence = Open-WorkspaceDirectory ([IO.Path]::GetDirectoryName($path)) $true
        try {
            $file = $fence.Open([IO.Path]::GetFileName($path), $true)
            try {
                $bytes = [Convert]::FromBase64String('{{Convert.ToBase64String(contents.Span)}}')
                $file.Write($bytes, 0, $bytes.Length); $file.SetLength($bytes.Length); $file.Flush($true)
            } finally { $file.Dispose() }
            '{"version":1,"written":true}'
        } finally { $fence.Dispose() }
        """;

    internal static string Read(string fullPath) => Guard + "\n" + $$"""
        $path = '{{HyperVSandbox.Escape(fullPath)}}'
        try {
            $fence = Open-WorkspaceDirectory ([IO.Path]::GetDirectoryName($path)) $false
            try {
                $file = $fence.Open([IO.Path]::GetFileName($path), $false)
                try {
                    if ($file.Length -gt {{MaxFileBytes}}) { throw 'File is too large' }
                    $bytes = [byte[]]::new([int]$file.Length)
                    $offset = 0
                    while ($offset -lt $bytes.Length) {
                        $read = $file.Read($bytes, $offset, $bytes.Length - $offset)
                        if ($read -eq 0) { throw 'Incomplete file read' }; $offset += $read
                    }
                    @{ version = 1; bytes = [Convert]::ToBase64String($bytes) } | ConvertTo-Json -Compress
                } finally { $file.Dispose() }
            } finally { $fence.Dispose() }
        } catch [IO.FileNotFoundException] { '{"version":1,"missing":true}' }
          catch [IO.DirectoryNotFoundException] { '{"version":1,"missing":true}' }
        """;

    internal static string List(string fullDirectoryPath) => Guard + "\n" + $$"""
        $path = '{{HyperVSandbox.Escape(fullDirectoryPath)}}'
        $fence = Open-WorkspaceDirectory $path $false
        try {
            $entries = @(); $truncated = $false
            foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($fence.Path)) {
                if ($entries.Count -ge {{MaxListEntries}}) { $truncated = $true; break }
                $name = [IO.Path]::GetFileName($entry)
                if ([IO.Directory]::Exists($entry)) {
                    $child = Open-WorkspaceDirectory $entry $false
                    try { $entries += @{ name = $name; kind = 'dir' } } finally { $child.Dispose() }
                } else {
                    $file = $fence.Open($name, $false)
                    try {
                        if ($file.Length -gt {{MaxFileBytes}}) { throw 'File is too large' }
                        $entries += @{ name = $name; kind = 'file'; bytes = $file.Length }
                    } finally { $file.Dispose() }
                }
            }
            @{ version = 1; entries = $entries; truncated = $truncated } | ConvertTo-Json -Compress
        } finally { $fence.Dispose() }
        """;

    internal static string Run(string command, string arguments, string workingDirectory, TimeSpan timeout)
    {
        var child = $$"""
            [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
            $OutputEncoding = [Console]::OutputEncoding
            $ErrorActionPreference = 'Stop'
            $global:LASTEXITCODE = 0
            $env:TEMP = 'C:\filspresso-workspace\.tmp'; $env:TMP = $env:TEMP
            try {
                Set-Location -LiteralPath '{{HyperVSandbox.Escape(workingDirectory)}}'
                & {
                    {{command}} {{arguments}}
                }
                $ok = $?
                if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
                if (-not $ok) { exit 1 }; exit 0
            } catch { [Console]::Error.WriteLine($_.ToString()); exit 1 }
            """;
        return Guard + "\n" + $$"""
            # -EncodedCommand {{HyperVSandbox.ToBase64(child)}}
            $result = [Filspresso.Guest.Command]::Run('C:\filspresso-workspace', '{{HyperVSandbox.Escape(workingDirectory)}}', '{{HyperVSandbox.ToBase64(child)}}', {{(long)timeout.TotalMilliseconds}})
            @{ version = 1; exitCode = $result.ExitCode; stdout = $result.Stdout; stderr = $result.Stderr;
               timedOut = $result.TimedOut; outputLimited = $result.OutputLimited; descendantsClean = $result.DescendantsClean } | ConvertTo-Json -Compress
            """;
    }
}
