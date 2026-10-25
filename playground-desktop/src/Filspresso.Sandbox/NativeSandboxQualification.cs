using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Storage;
using Filspresso.Core.Tools;

namespace Filspresso.Sandbox;

public sealed record NativeSandboxReceipt(int Version, string Machine, string Implementation, string WindowsBuild,
    DateTimeOffset CreatedUtc, IReadOnlyList<string> Checks);

/// <summary>Separate, explicitly weaker backend evidence. Never accepts VM/MXC claims.</summary>
public static class NativeSandboxQualification
{
    public static string ReceiptPath => Path.Combine(DesktopDataPaths.UserDataDirectory, "qualification", "native-restricted.bin");
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Filspresso.NativeRestricted.policy1");
    public static IReadOnlyList<string> RequiredChecks { get; } = Array.AsReadOnly(new[]
    {
        "file-boundary", "outside-file-denied", "network-denied", "clean-environment", "private-desktop-joblimits",
        "descendant-cleanup", "timeout-discard", "output-discard", "command-capture", "cross-process-crash-recovery",
    });
    public static bool Validate(NativeSandboxReceipt receipt) => receipt.Version == 1 && receipt.Machine is { Length: 32 } &&
        receipt.Machine == HyperVQualification.MachineId && receipt.Implementation == HyperVQualification.ImplementationSha256 &&
        receipt.WindowsBuild == WindowsSandboxQualification.WindowsBuild && receipt.CreatedUtc <= DateTimeOffset.UtcNow.AddMinutes(2) &&
        DateTimeOffset.UtcNow - receipt.CreatedUtc <= TimeSpan.FromDays(30) && receipt.Checks is { Count: <= 32 } &&
        receipt.Checks.Distinct(StringComparer.Ordinal).Count() == receipt.Checks.Count && RequiredChecks.All(check => receipt.Checks.Contains(check));
    public static (bool Qualified, string Status) Check(string? path = null)
    {
        try
        {
            var location = path ?? ReceiptPath;
            if (!File.Exists(location)) return (false, "Native restricted mode needs its own safety verification. No Windows Sandbox CLI or Pro edition is required. It shares the host kernel and is not equivalent to a VM.");
            using var pin = new PinnedLocalPath(Path.GetDirectoryName(location)!); using var file = pin.OpenFile(Path.GetFileName(location));
            if (file.Length is <= 0 or > 65536) throw new InvalidDataException();
            var bytes = new byte[checked((int)file.Length)]; file.ReadExactly(bytes);
            var receipt = JsonSerializer.Deserialize<NativeSandboxReceipt>(ProtectedData.Unprotect(bytes, Entropy, DataProtectionScope.CurrentUser));
            if (receipt is null || !Validate(receipt)) return (false, "Native restricted qualification is stale or does not match this device, Windows build or application. Verify again.");
            return (true, "Native restricted mode qualified · shares host Windows kernel · offline commands · staged copy only · explicit opt-in required");
        }
        catch { return (false, "Native restricted safety evidence could not be verified. No unrestricted host-shell fallback is permitted."); }
    }
    internal static void Save(NativeSandboxReceipt receipt, string? path = null)
    {
        if (!Validate(receipt)) throw new InvalidDataException("Incomplete native isolation evidence.");
        var location = path ?? ReceiptPath;
        using var pin = new PinnedLocalPath(Path.GetDirectoryName(location)!, create: true);
        var temporary = Path.GetFileName(location) + "." + Guid.NewGuid().ToString("N") + ".new";
        using (var file = pin.OpenFile(temporary, FileAccess.ReadWrite, createNew: true))
        { file.Write(ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(receipt), Entropy, DataProtectionScope.CurrentUser)); file.Flush(true); }
        if (File.Exists(location))
        {
            using (var old = pin.OpenFile(Path.GetFileName(location))) { if (old.Length > 65536) throw new InvalidDataException(); }
            File.Move(location, location + "." + Guid.NewGuid().ToString("N") + ".previous");
        }
        File.Move(Path.Combine(pin.DirectoryPath, temporary), location);
    }
    public static async Task<IReadOnlyList<string>> ProbeAsync(NativeSandbox sandbox, string privateRoot, Action<string> report, CancellationToken token)
    {
        var checks = new List<string>();
        report("Native AppContainer/private desktop/job and external-file denial probes (NOT a VM)");
        var session = await sandbox.StartAsync("native qualification", token).ConfigureAwait(false);
        var denied = Path.Combine(privateRoot, "qualification-private-" + Guid.NewGuid().ToString("N") + ".txt");
        using (var pin = new PinnedLocalPath(privateRoot, create: true))
        using (var file = pin.OpenFile(Path.GetFileName(denied), FileAccess.ReadWrite, createNew: true))
        { file.Write(Encoding.UTF8.GetBytes("private fixture only")); file.Flush(true); }
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var previous = Environment.GetEnvironmentVariable("FILSPRESSO_ISOLATION_TEST_SECRET");
        Environment.SetEnvironmentVariable("FILSPRESSO_ISOLATION_TEST_SECRET", "broker-fixture-only");
        try
        {
            await sandbox.WriteFileAsync(session.Id, "test.txt", Encoding.UTF8.GetBytes("before"), token).ConfigureAwait(false);
            if (await sandbox.ReadFileAsync(session.Id, "test.txt", token).ConfigureAwait(false) != "before") throw new InvalidDataException();
            try { await sandbox.ReadFileAsync(session.Id, "../escape", token).ConfigureAwait(false); throw new InvalidDataException(); }
            catch (SandboxPolicyException) { checks.Add("file-boundary"); }
            var source = $$"""
                if ($env:FILSPRESSO_ISOLATION_TEST_SECRET) { exit 91 };
                try { [IO.File]::ReadAllText('{{denied.Replace("'", "''")}}'); exit 92 } catch [UnauthorizedAccessException] { };
                try { [IO.File]::WriteAllText('{{denied.Replace("'", "''")}}', 'bad'); exit 93 } catch [UnauthorizedAccessException] { };
                try { $socket = [Net.Sockets.TcpClient]::new(); $socket.Connect('127.0.0.1', {{port}}); $socket.Dispose(); exit 94 } catch [Net.Sockets.SocketException] { };
                Set-Content -LiteralPath 'relative.txt' -Value 'relative-ok';
                if ((Get-Content -LiteralPath 'relative.txt') -ne 'relative-ok') { exit 95 };
                [IO.File]::WriteAllText(([Environment]::CurrentDirectory + '\test.txt'), 'after command'); [Console]::WriteLine('NATIVE_OK')
                """;
            var result = await sandbox.RunAsync(session.Id, source, "", cancellationToken: token).ConfigureAwait(false);
            report($"Native permissions probe exit: {result.ExitCode}; unexpected loopback connection: {listener.Pending()}.");
            if (result.ExitCode != 0) report("Fixed-probe diagnostic (no project/model code): " + result.StandardError[..Math.Min(1024, result.StandardError.Length)]);
            if (result.ExitCode != 0 || !result.StandardOutput.Contains("NATIVE_OK", StringComparison.Ordinal) || listener.Pending()) throw new InvalidDataException("Native permissions probe failed.");
            if (SandboxTextSnapshot.Read(denied) != "private fixture only") throw new InvalidDataException("Private qualification fixture changed.");
            checks.AddRange(["outside-file-denied", "network-denied", "clean-environment", "private-desktop-joblimits"]);
            var files = await sandbox.CaptureAsync(session.Id, ["test.txt"], token).ConfigureAwait(false);
            if (!files.Any(file => file.Path == "test.txt" && file.Contents == "after command")) throw new InvalidDataException();
            checks.Add("command-capture");
            var child = await sandbox.RunAsync(session.Id, """
                $start = [Diagnostics.ProcessStartInfo]::new(); $start.FileName = $PSHOME + '\powershell.exe'; $start.UseShellExecute = $false;
                $start.Arguments = '-NoProfile -NonInteractive -Command "Start-Sleep -Seconds 120"';
                $child = [Diagnostics.Process]::Start($start); [Console]::WriteLine($child.Id); exit 0
                """, "", cancellationToken: token).ConfigureAwait(false);
            if (child.ExitCode != 0 || !int.TryParse(child.StandardOutput.Trim(), out var pid)) throw new InvalidDataException();
            try { using var process = System.Diagnostics.Process.GetProcessById(pid); if (!process.WaitForExit(5000)) throw new IOException("Native descendant survived."); }
            catch (ArgumentException) { }
            checks.Add("descendant-cleanup");
        }
        finally { Environment.SetEnvironmentVariable("FILSPRESSO_ISOLATION_TEST_SECRET", previous); await sandbox.StopAsync(session.Id).ConfigureAwait(false); }
        report("Native timeout/output invalidation probes");
        session = await sandbox.StartAsync("timeout", token).ConfigureAwait(false);
        var timedOut = false;
        try { await sandbox.RunAsync(session.Id, "Start-Sleep -Seconds 120", "", timeout: TimeSpan.FromSeconds(1), cancellationToken: token).ConfigureAwait(false); }
        catch (TimeoutException) { timedOut = true; }
        await sandbox.StopAsync(session.Id).ConfigureAwait(false);
        if (!timedOut) throw new InvalidDataException(); checks.Add("timeout-discard");
        session = await sandbox.StartAsync("output", token).ConfigureAwait(false);
        var limited = false;
        try { await sandbox.RunAsync(session.Id, "[Console]::Write(('x' * 200000)); Start-Sleep -Seconds 120", "", cancellationToken: token).ConfigureAwait(false); }
        catch (PowerShellOutputLimitException) { limited = true; }
        await sandbox.StopAsync(session.Id).ConfigureAwait(false);
        if (!limited) throw new InvalidDataException(); checks.Add("output-discard");
        return checks.AsReadOnly();
    }
}
