using System;
using System.Linq;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Sandbox;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>
/// These tests launch only trusted, literal host scripts and the PowerShell parser. They
/// never execute generated guest source, administer Hyper-V, or require elevation.
/// </summary>
public sealed class PowerShellRunnerTests
{
    [Fact]
    public async Task TrustedAdministrationCannotLeaveAnOrphanAfterNormalTransportExit()
    {
        const string trusted = """
            $start = [Diagnostics.ProcessStartInfo]::new()
            $start.FileName = $PSHOME + '\powershell.exe'
            $start.Arguments = '-NoProfile -NonInteractive -Command "Start-Sleep -Seconds 120"'
            $start.UseShellExecute = $false
            $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
            $child = [Diagnostics.Process]::Start($start)
            [Console]::WriteLine($child.Id)
            """;
        var result = await new PowerShellRunner().RunAsync(trusted, TimeSpan.FromSeconds(15));
        Assert.Equal(0, result.ExitCode);
        var pid = int.Parse(result.Output.Trim(), System.Globalization.CultureInfo.InvariantCulture);
        try { using var child = Process.GetProcessById(pid); Assert.True(child.WaitForExit(5000), "Host job did not terminate its descendant."); }
        catch (ArgumentException) { /* The job already reaped it. */ }
    }
    [Fact]
    public async Task PrivateInputRoundTripsUnicodeAndHostExitCodesWithoutArgumentQuoting()
    {
        var runner = new PowerShellRunner();
        var payload = JsonSerializer.Serialize(new { text = "quoted ' \" 界 😀" });
        var result = await runner.RunWithInputAsync("$data = [Console]::In.ReadLine() | ConvertFrom-Json; [Console]::Out.WriteLine($data.text); exit 7", payload, TimeSpan.FromSeconds(15));
        Assert.Equal(7, result.ExitCode);
        Assert.Equal("quoted ' \" 界 😀", result.Output.TrimEnd());
        Assert.Equal(string.Empty, result.Error);
    }

    [Fact]
    public async Task CallerCancellationIsNotMislabeledAsATimeout()
    {
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(500));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new PowerShellRunner().RunAsync("Start-Sleep -Seconds 30", TimeSpan.FromSeconds(15), cancellation.Token));
    }

    [Fact]
    public async Task DeadlineIsReportedAsTimeoutAfterTheHostProcessIsStopped() =>
        await Assert.ThrowsAsync<TimeoutException>(() => new PowerShellRunner().RunAsync("Start-Sleep -Seconds 30", TimeSpan.FromMilliseconds(500)));

    [Theory]
    [InlineData("Out")]
    [InlineData("Error")]
    public async Task BothOutputPipesAreBoundedAndOverflowIsExplicit(string pipe) =>
        await Assert.ThrowsAsync<PowerShellOutputLimitException>(() => new PowerShellRunner(maxOutputCharacters: 512)
            .RunAsync($"[Console]::{pipe}.Write(('x' * 4096)); Start-Sleep -Seconds 30", TimeSpan.FromSeconds(15)));

    [Fact]
    public async Task InvalidInputsAndAlreadyCancelledCallsNeverLaunchAProcess()
    {
        var runner = new PowerShellRunner(executable: "this-executable-must-never-launch.exe");
        await Assert.ThrowsAsync<ArgumentException>(() => runner.RunWithInputAsync("unused", "two\nlines", TimeSpan.FromSeconds(1)));
        await Assert.ThrowsAsync<ArgumentException>(() => runner.RunWithInputAsync("unused", new string('x', PowerShellRunner.MaxInputCharacters + 1), TimeSpan.FromSeconds(1)));
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => runner.RunAsync("unused", TimeSpan.Zero));
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => runner.RunAsync("unused", TimeSpan.FromSeconds(1), cancellation.Token));
    }

    [Fact]
    public async Task AllGeneratedHostAndGuestScriptsParseInWindowsPowerShellWithoutExecutingThem()
    {
        var stub = new StubHyperVRunner(); var sandbox = stub.Sandbox(); var session = await sandbox.StartAsync("fixture");
        await sandbox.RunAsync(session.Id, "Write-Output 'fixture 界'", "", "src");
        await sandbox.StopAsync(session.Id);
        var run = stub.GuestCalls.Last().Source;
        var encodedChild = Regex.Match(run, "-EncodedCommand ([A-Za-z0-9+/=]+)").Groups[1].Value;
        var scripts = stub.HostScripts.Concat(stub.GuestCalls.Select(call => call.HostScript)).Concat(stub.GuestCalls.Select(call => call.Source)).Concat(new[]
        {
            HyperVGuestScripts.Write(@"C:\filspresso-workspace\src\quoted'file.txt", Encoding.UTF8.GetBytes("fixture 界")),
            HyperVGuestScripts.Read(@"C:\filspresso-workspace\src\quoted'file.txt"),
            Encoding.Unicode.GetString(Convert.FromBase64String(encodedChild)),
        }).ToArray();
        const string parserOnly = """
            $request = [Console]::In.ReadLine() | ConvertFrom-Json
            foreach ($source in $request.scripts) {
                $tokens = $null; $errors = $null
                [void][Management.Automation.Language.Parser]::ParseInput([string]$source, [ref]$tokens, [ref]$errors)
                if ($errors.Count -ne 0) {
                    foreach ($item in $errors) { [Console]::Error.WriteLine($item.Message) }
                    exit 1
                }
            }
            'PARSED'
            """;
        // Hosted Windows runners can take longer to start PowerShell under load. This test
        // only parses generated scripts; the production transport timeout is unchanged.
        var result = await new PowerShellRunner().RunWithInputAsync(parserOnly, JsonSerializer.Serialize(new { scripts }), TimeSpan.FromSeconds(60));
        Assert.True(result.ExitCode == 0, result.Error);
        Assert.Equal("PARSED", result.Output.Trim());
    }
}
