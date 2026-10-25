using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;

namespace Filspresso.Sandbox;

internal static class WindowsSandboxScripts
{
    internal static string Wrap(string nonce, string source) => $$"""
        $ErrorActionPreference = 'Stop'
        $ProgressPreference = 'SilentlyContinue'
        try {
            [IO.Directory]::CreateDirectory('C:\filspresso-broker') | Out-Null
            if (-not [IO.File]::Exists('C:\filspresso-broker\Boundary.dll')) {
                Add-Type -Path 'C:\filspresso-in\boundary.cs' -OutputAssembly 'C:\filspresso-broker\Boundary.dll'
            }
            if (-not ('Filspresso.Guest.Fence' -as [type])) { Add-Type -Path 'C:\filspresso-broker\Boundary.dll' }
            function Open-WorkspaceDirectory([string]$path, [bool]$create) {
                [Filspresso.Guest.Fence]::new('C:\filspresso-workspace', $path, $create)
            }
            $responses = @(& {
                {{source}}
            })
            if ($responses.Count -ne 1 -or $responses[0] -isnot [string]) { throw 'Invalid guest response' }
            $payload = $responses[0] | ConvertFrom-Json
            $envelope = @{ version = 1; nonce = '{{nonce}}'; ok = $true; payload = $payload } | ConvertTo-Json -Depth 8 -Compress
        } catch {
            $envelope = '{"version":1,"nonce":"{{nonce}}","ok":false,"payload":null}'
        }
        [IO.File]::WriteAllText('C:\filspresso-out\{{nonce}}.json', $envelope, [Text.UTF8Encoding]::new($false))
        exit 0
        """;

    internal static string Ready => """
        if (@(Get-NetAdapter -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' }).Count -ne 0) { throw 'Networking must be disabled' }
        $writable = $false
        try { [IO.File]::WriteAllText('C:\filspresso-in\readonly-probe.txt', 'must-not-write'); $writable = $true } catch [UnauthorizedAccessException] { } catch [IO.IOException] { }
        if ($writable) { throw 'Input mapping is writable' }
        $pin = Open-WorkspaceDirectory 'C:\filspresso-workspace' $true
        try { '{"version":1,"ready":true}' } finally { $pin.Dispose() }
        """;

    internal static string Snapshot(IReadOnlyCollection<string> tracked) => $$"""
        $tracked = @{}
        foreach ($path in (([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{{Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(tracked)))}}'))) | ConvertFrom-Json)) { $tracked[$path] = $true }
        $skip = @('.git','.hg','.svn','node_modules','__pycache__','bin','obj','dist','build','target','out','.venv','venv','env','.idea','.vscode','.next','.tmp')
        $extensions = @('.py','.pyi','.ts','.tsx','.js','.jsx','.json','.md','.markdown','.txt','.yaml','.yml','.toml','.ini','.cfg','.conf','.sh','.bash','.ps1','.bat','.cmd','.xml','.html','.css','.scss','.svg','.cs','.csproj','.go','.rs','.java','.kt','.swift','.c','.h','.cpp','.hpp','.sql','.dart','.rb','.php','.hs','.clj','.nix','.cmake','.mk','.gitignore','.dockerignore')
        $state = @{ directories = 0; entries = 0; bytes = 0; files = [Collections.Generic.List[object]]::new() }
        function Capture-Directory([string]$path, [string]$prefix, [int]$depth) {
            $state.directories++
            if ($state.directories -gt 2048 -or $depth -gt 16) { throw 'Snapshot directory budget exceeded' }
            $pin = Open-WorkspaceDirectory $path $false
            try {
                foreach ($child in [IO.Directory]::EnumerateFileSystemEntries($path)) {
                    $state.entries++; if ($state.entries -gt 32768) { throw 'Snapshot enumeration budget exceeded' }
                    $name = [IO.Path]::GetFileName($child); $relative = $prefix + $name
                    if ([IO.Directory]::Exists($child)) {
                        if ($skip -contains $name -or $name.StartsWith('.')) { continue }
                        Capture-Directory $child ($relative + '/') ($depth + 1)
                        continue
                    }
                    if ($name -eq '.env' -or $name.StartsWith('.env.') -or $name -in @('id_rsa','id_ed25519','credentials.json') -or $name.EndsWith('.pem') -or $name.EndsWith('.key')) { continue }
                    if (-not $tracked.ContainsKey($relative) -and $extensions -notcontains [IO.Path]::GetExtension($name) -and $name -notin @('Dockerfile','Procfile')) { continue }
                    $file = $pin.Open($name, $false)
                    try {
                        if ($file.Length -gt 262144 -or $state.files.Count -ge 256) { throw 'Snapshot file budget exceeded' }
                        $state.bytes += $file.Length; if ($state.bytes -gt 8388608) { throw 'Snapshot byte budget exceeded' }
                        $buffer = [byte[]]::new([int]$file.Length); $offset = 0
                        while ($offset -lt $buffer.Length) { $count = $file.Read($buffer, $offset, $buffer.Length - $offset); if ($count -eq 0) { throw 'Incomplete snapshot' }; $offset += $count }
                        $state.files.Add(@{ path = $relative; bytes = [Convert]::ToBase64String($buffer) })
                    } finally { $file.Dispose() }
                }
            } finally { $pin.Dispose() }
        }
        Capture-Directory 'C:\filspresso-workspace' '' 0
        @{ version = 1; files = @($state.files.ToArray()) } | ConvertTo-Json -Depth 4 -Compress
        """;
}
