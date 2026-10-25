using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Filspresso.Sandbox;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>Trusted, literal native-boundary probes on local Windows, NOT guest qualification.
/// Untrusted/model commands never run on the host as a fallback.</summary>
public sealed class GuestBoundaryNativeTests
{
    [Fact]
    public async Task NativeRestrictedCommandUsesPrivateDesktopAndDoesNotInheritBrokerSecrets()
    {
        var result = await Probe("""
            $env:FILSPRESSO_NATIVE_TEST_SECRET = 'broker-only'
            $profile = 'Filspresso.' + [Guid]::NewGuid().ToString('N')
            $command = 'if ($env:FILSPRESSO_NATIVE_TEST_SECRET) { exit 91 }; [IO.File]::WriteAllText(''' + ($root + '\native.txt').Replace("'", "''") + ''', ''restricted''); [Console]::WriteLine(''NATIVE_OK'')'
            $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
            [Filspresso.Guest.Command]::RunRestricted($root, $root, $encoded, 15000, $profile) | ConvertTo-Json -Compress
            """);
        Assert.Equal(0, result.GetProperty("ExitCode").GetInt32());
        Assert.Contains("NATIVE_OK", result.GetProperty("Stdout").GetString());
        Assert.True(result.GetProperty("DescendantsClean").GetBoolean());
    }
    private static async Task<JsonElement> Probe(string source)
    {
        var root = Directory.CreateTempSubdirectory("filspresso-native-boundary-");
        try
        {
            const string bootstrap = """
                $ErrorActionPreference = 'Stop'
                $request = [Console]::In.ReadLine() | ConvertFrom-Json
                Add-Type -TypeDefinition $request.boundary
                $root = $request.root
                function Invoke-Isolated([string]$command, [int]$duration = 15000) {
                    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
                    [Filspresso.Guest.Command]::Run($root, $root, $encoded, $duration)
                }
                """;
            var result = await new PowerShellRunner().RunWithInputAsync(bootstrap + "\n" + source,
                JsonSerializer.Serialize(new { boundary = HyperVGuestScripts.BoundarySource, root = root.FullName }), TimeSpan.FromSeconds(45));
            Assert.True(result.ExitCode == 0, result.Error + result.Output);
            using var document = JsonDocument.Parse(result.Output); return document.RootElement.Clone();
        }
        finally { root.Delete(true); }
    }

    [Fact]
    public async Task ExactFrameworkSourceCompilesAndPinsAgainstConcurrentRenameAndOverwrite()
    {
        var result = await Probe("""
            [Filspresso.Guest.FenceQualification]::Races($root)
            @{ ok = $true } | ConvertTo-Json -Compress
            """);
        Assert.True(result.GetProperty("ok").GetBoolean());
    }

    [Fact]
    public async Task CommandHasNoAdministratorAuthorityButCanWriteTheGrantedWorkspace()
    {
        var result = await Probe("""
            $path = Join-Path $root 'result.txt'
            $command = '[IO.File]::WriteAllText(''' + $path.Replace("'", "''") + ''', ''ok''); $p = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()); if ($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 91 }; [Console]::WriteLine(''lowbox-ok'')'
            $result = Invoke-Isolated $command
            if ([IO.File]::ReadAllText($path) -ne 'ok') { throw 'workspace not writable' }
            $result | ConvertTo-Json -Compress
            """);
        Assert.Equal(0, result.GetProperty("ExitCode").GetInt32());
        Assert.Contains("lowbox-ok", result.GetProperty("Stdout").GetString());
        Assert.True(result.GetProperty("DescendantsClean").GetBoolean());
    }

    [Fact]
    public async Task NormalRootExitTerminatesDetachedChildrenAndTimeoutAndOutputAreBounded()
    {
        var result = await Probe("""
            $child = '[Threading.Thread]::Sleep(30000)'
            $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($child))
            $command = '$s = [Diagnostics.ProcessStartInfo]::new(); $s.FileName = $PSHOME + ''\powershell.exe''; $s.UseShellExecute = $false; $s.Arguments = ''-NoProfile -NonInteractive -EncodedCommand ' + $encoded + '''; $p = [Diagnostics.Process]::Start($s); [Console]::WriteLine($p.Id); exit 0'
            $normal = Invoke-Isolated $command
            if ($normal.ExitCode -ne 0) { throw $normal.Stderr }
            $pidText = $normal.Stdout.Trim()
            if (Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue) { throw 'Detached child survived' }
            $timed = Invoke-Isolated '[Threading.Thread]::Sleep(30000)' 1000
            $limited = Invoke-Isolated '[Console]::Out.Write((''x'' * 200000)); [Threading.Thread]::Sleep(30000)'
            @{ normal = $normal.DescendantsClean; timeout = $timed.TimedOut; limited = $limited.OutputLimited } | ConvertTo-Json -Compress
            """);
        Assert.True(result.GetProperty("normal").GetBoolean());
        Assert.True(result.GetProperty("timeout").GetBoolean());
        Assert.True(result.GetProperty("limited").GetBoolean());
    }
}
