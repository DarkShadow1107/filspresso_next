using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Sandbox;

namespace Filspresso.Qualify;

internal static class Program
{
    private sealed class Credentials(NetworkCredential value) : IGuestCredentialProvider
    { public Task<NetworkCredential?> GetCredentialAsync(CancellationToken cancellationToken = default) => Task.FromResult<NetworkCredential?>(value); }

    private static async Task<int> Main(string[] args)
    {
        try
        {
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            if (args is ["native-sandbox", "--confirm"])
                return await QualifyNativeAsync(NativeSandbox.DefaultRoot, NativeSandboxQualification.ReceiptPath);
            if (args is ["native-sandbox", "--confirm", var nativeRoot, var nativeReceipt])
                return await QualifyNativeAsync(Path.GetFullPath(nativeRoot), Path.GetFullPath(nativeReceipt));
            if (args is ["native-sandbox-worker", var workerRoot])
                return await NativeCrashWorkerAsync(Path.GetFullPath(workerRoot));
            if (args is ["native-sandbox-recover", "--confirm"])
            {
                using var recovery = new NativeSandbox(new PowerShellRunner());
                using var limit = new CancellationTokenSource(TimeSpan.FromMinutes(1));
                await recovery.RecoverAsync(limit.Token); Console.WriteLine("Recorded native restricted resources recovered."); return 0;
            }
            if (args is ["windows-sandbox", "--confirm"])
                return await QualifyWindowsSandboxAsync();
            if (args is ["windows-sandbox-worker"])
            {
                using var worker = new WindowsSandbox(new WindowsSandboxCli());
                using var limit = new CancellationTokenSource(TimeSpan.FromMinutes(6));
                var session = await worker.StartAsync("crash recovery probe", limit.Token);
                Console.WriteLine(session.Id); await Console.Out.FlushAsync();
                await Task.Delay(Timeout.Infinite, limit.Token); return 1;
            }
            if (args is ["windows-sandbox-recover", "--confirm"])
            {
                using var recovery = new WindowsSandbox(new WindowsSandboxCli());
                using var limit = new CancellationTokenSource(TimeSpan.FromMinutes(1));
                await recovery.RecoverAsync(limit.Token); Console.WriteLine("Recorded Windows Sandbox resources recovered."); return 0;
            }
            if (args.Length == 2 && args[0] == "recover")
            {
                var state = Path.GetFullPath(args[1]);
                using var recoveryOnly = new HyperVSandbox(new PowerShellRunner(), Path.Combine(state, "unused.vhdx"), state);
                await recoveryOnly.RecoverAsync();
                Console.WriteLine("Owned stale Hyper-V resources recovered. No guest credential, model request or execution receipt was used.");
                return 0;
            }
            if (args.Length != 4 || args[0] is not ("qualify" or "crash-worker"))
                throw new ArgumentException("Usage: Filspresso.Qualify qualify <image.vhdx> <private-state-directory> <new-receipt.json>. Credential JSON is read only from stdin.");
            var line = await Console.In.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(30));
            if (line is null || line.Length > 8192) throw new InvalidDataException("Missing bounded private credential input.");
            using var input = JsonDocument.Parse(line);
            var credentials = new Credentials(new(input.RootElement.GetProperty("user").GetString(), input.RootElement.GetProperty("password").GetString()));
            using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(30));
            var token = deadline.Token;
            var image = Path.GetFullPath(args[1]); var root = Path.GetFullPath(args[2]);
            var receiptPath = Path.GetFullPath(args[3]);
            if (File.Exists(receiptPath) && args[0] == "qualify") throw new IOException("Receipt exists. Archive it explicitly before requalification; it will not be overwritten.");
            var info = new FileInfo(image);
            await using var imageRead = new FileStream(image, FileMode.Open, FileAccess.Read, FileShare.Read);
            var digest = Convert.ToHexStringLower(await SHA256.HashDataAsync(imageRead, token));
            var provisional = new HyperVQualificationReceipt(image, digest, info.Length, HyperVQualificationReceipt.CurrentPolicyVersion,
                DateTimeOffset.UtcNow, HyperVQualification.MachineId, HyperVQualificationReceipt.RequiredChecks) { ImplementationSha256 = HyperVQualification.ImplementationSha256 };
            if (args[0] == "crash-worker")
            {
                using var worker = new HyperVSandbox(new PowerShellRunner(), image, root, credentials: credentials, qualification: provisional);
                var session = await worker.StartAsync("crash qualification", token);
                Console.WriteLine(session.Id); await Console.Out.FlushAsync(token);
                await Task.Delay(Timeout.Infinite, token); return 1;
            }
            using (var sandbox = new HyperVSandbox(new PowerShellRunner(), image, root, credentials: credentials, qualification: provisional))
            {
                Console.Error.WriteLine("Running actual offline Hyper-V containment and lifecycle probes. No receipt is written on failure.");
                var checks = (await HyperVLiveQualification.RunAsync(sandbox, token, gate => Console.Error.WriteLine("CHECK: " + gate))).ToList();
                // Release the root lease before a distinct process takes ownership.
                sandbox.Dispose();
                Console.Error.WriteLine("CHECK: recovery-after-process-kill");
                var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
                if (Path.GetFileNameWithoutExtension(Environment.ProcessPath!).Equals("dotnet", StringComparison.OrdinalIgnoreCase)) start.ArgumentList.Add(typeof(Program).Assembly.Location);
                foreach (var arg in new[] { "crash-worker", image, root, receiptPath }) start.ArgumentList.Add(arg);
                using var child = Process.Start(start) ?? throw new IOException("Cannot start recovery probe.");
                var errors = child.StandardError.ReadToEndAsync(token);
                try
                {
                    await child.StandardInput.WriteLineAsync(line.AsMemory(), token); child.StandardInput.Close();
                    var ready = await child.StandardOutput.ReadLineAsync(token).AsTask().WaitAsync(TimeSpan.FromMinutes(6), token);
                    if (!Guid.TryParse(ready, out _)) throw new IOException("Crash worker failed to start a real guest.");
                }
                finally
                {
                    if (!child.HasExited) child.Kill(entireProcessTree: true);
                    await child.WaitForExitAsync(token);
                    await errors;
                }
                using var recovery = new HyperVSandbox(new PowerShellRunner(), image, root, credentials: credentials, qualification: provisional);
                await recovery.RecoverAsync(token);
                if ((await recovery.ListAsync(token)).Count != 0) throw new IOException("Crash recovery unconfirmed.");
                checks.AddRange(["recovery-after-process-kill", "image-hash-verified"]);
                var receipt = provisional with { CreatedUtc = DateTimeOffset.UtcNow, Checks = checks.AsReadOnly() };
                HyperVQualification.SaveReceipt(receipt, receiptPath);
            }
            Console.WriteLine($"QUALIFIED: {receiptPath}");
            Console.WriteLine($"Implementation: {HyperVQualification.ImplementationSha256}. This is not model/billing or MSI qualification, and never tool consent.");
            return 0;
        }
        catch (Exception error)
        {
            // No credential, model source or guest stdout is included in errors. Probe
            // refusal reasons are fixed literal strings and are safe to surface.
            var reason = error.Message.Split('\r', '\n')[0];
            Console.Error.WriteLine($"NOT QUALIFIED ({error.GetType().Name}: {reason}). No receipt issued. Retained intents require recovery before retry.");
            return 1;
        }
    }

    private static async Task<int> NativeCrashWorkerAsync(string root)
    {
        using var worker = new NativeSandbox(new PowerShellRunner(), root);
        using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(3)); var token = deadline.Token;
        var session = await worker.StartAsync("native process-kill qualification", token);
        var ready = Path.Combine(root, session.Id.ToString("N"), "workspace", "worker-ready.txt");
        // Fixed probe only. The child signals readiness from INSIDE its lowbox before the
        // parent verifier kills this worker. Parent death must close the outer broker job.
        var running = worker.RunAsync(session.Id, "[IO.File]::WriteAllText(([Environment]::CurrentDirectory + '\\worker-ready.txt'), [string]$PID, [Text.UTF8Encoding]::new($false)); Start-Sleep -Seconds 120", "", cancellationToken: token);
        while (!File.Exists(ready))
        {
            if (running.IsCompleted) { await running; throw new IOException("Native worker command did not reach readiness."); }
            await Task.Delay(50, token);
        }
        string pid;
        using (var pin = new Filspresso.Core.Tools.PinnedLocalPath(Path.GetDirectoryName(ready)!))
        using (var file = pin.OpenFile(Path.GetFileName(ready)))
        using (var reader = new StreamReader(file)) pid = await reader.ReadToEndAsync(token);
        if (!int.TryParse(pid, out var processId)) throw new IOException("Native workload readiness is invalid.");
        Console.WriteLine(JsonSerializer.Serialize(new { session.Id, ProcessId = processId })); await Console.Out.FlushAsync(token);
        await running; return 1;
    }

    private static async Task<int> QualifyNativeAsync(string root, string receiptPath)
    {
        Console.WriteLine("Explicit native restricted qualification: shared Windows kernel, NOT a VM or Codex MXC. No model requests or original project files are used.");
        using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(10)); var token = deadline.Token;
        var build = WindowsSandboxQualification.WindowsBuild;
        using var sandbox = new NativeSandbox(new PowerShellRunner(), root);
        var checks = (await NativeSandboxQualification.ProbeAsync(sandbox, root, Console.WriteLine, token)).ToList();
        sandbox.Dispose();
        var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        if (Path.GetFileNameWithoutExtension(Environment.ProcessPath!).Equals("dotnet", StringComparison.OrdinalIgnoreCase)) start.ArgumentList.Add(typeof(Program).Assembly.Location);
        start.ArgumentList.Add("native-sandbox-worker"); start.ArgumentList.Add(root);
        Console.WriteLine("Native broker/process-tree kill and authenticated recovery probe");
        using var child = Process.Start(start) ?? throw new IOException("Cannot start native crash worker.");
        var errors = child.StandardError.ReadToEndAsync(token);
        var workloadId = 0;
        try
        {
            var ready = await child.StandardOutput.ReadLineAsync(token).AsTask().WaitAsync(TimeSpan.FromMinutes(2), token);
            if (ready is null || ready.Length > 512) throw new InvalidDataException("Native readiness missing.");
            using var message = JsonDocument.Parse(ready);
            if (!message.RootElement.TryGetProperty("Id", out var id) || !Guid.TryParse(id.GetString(), out _) ||
                !message.RootElement.TryGetProperty("ProcessId", out var pid) || !pid.TryGetInt32(out workloadId) || workloadId <= 0)
                throw new InvalidDataException("Native readiness invalid.");
        }
        finally
        {
            if (!child.HasExited) child.Kill(entireProcessTree: true);
            using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await child.WaitForExitAsync(cleanup.Token); await errors;
        }
        try
        {
            using var workload = Process.GetProcessById(workloadId);
            if (!workload.WaitForExit(5000)) throw new IOException("Native child survived worker termination.");
        }
        catch (ArgumentException) { }
        using var recovery = new NativeSandbox(new PowerShellRunner(), root);
        await recovery.RecoverAsync(token); checks.Add("cross-process-crash-recovery");
        if (build != WindowsSandboxQualification.WindowsBuild) throw new IOException("Windows changed during native qualification.");
        NativeSandboxQualification.Save(new(1, HyperVQualification.MachineId, HyperVQualification.ImplementationSha256,
            build, DateTimeOffset.UtcNow, checks.AsReadOnly()), receiptPath);
        Console.WriteLine("Native restricted mode qualified for this device/build. Shared-kernel risks and tool/network restrictions still apply. This is not VM/model/billing/MSI qualification.");
        return 0;
    }

    private static async Task<int> QualifyWindowsSandboxAsync()
    {
        var setup = WindowsSandboxQualification.SetupStatus;
        if (setup.Length > 0) { Console.Error.WriteLine(setup); return 1; }
        // Explicit opt-in is mandatory; probes never run simply by installing/starting chat.
        using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(20)); var token = deadline.Token;
        var package = await WindowsSandboxQualification.PackageAsync(token);
        var build = WindowsSandboxQualification.WindowsBuild;
        using var sandbox = new WindowsSandbox(new WindowsSandboxCli());
        var checks = (await WindowsSandboxLiveQualification.RunAsync(sandbox, Console.WriteLine, token)).ToList();
        sandbox.Dispose();
        Console.WriteLine("Cross-process recovery after killing a ready-VM worker");
        var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        if (Path.GetFileNameWithoutExtension(Environment.ProcessPath!).Equals("dotnet", StringComparison.OrdinalIgnoreCase)) start.ArgumentList.Add(typeof(Program).Assembly.Location);
        start.ArgumentList.Add("windows-sandbox-worker");
        using var child = Process.Start(start) ?? throw new IOException("Cannot start crash worker.");
        var errors = child.StandardError.ReadToEndAsync(token);
        try
        {
            var ready = await child.StandardOutput.ReadLineAsync(token).AsTask().WaitAsync(TimeSpan.FromMinutes(5), token);
            if (!Guid.TryParse(ready, out _)) throw new IOException("Crash worker failed to boot an actual Windows Sandbox VM.");
        }
        finally
        {
            if (!child.HasExited) child.Kill(true);
            using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await child.WaitForExitAsync(cleanup.Token); await errors;
        }
        using var recovery = new WindowsSandbox(new WindowsSandboxCli());
        await recovery.RecoverAsync(token); checks.Add("crash-worker-recovery");
        if (package != await WindowsSandboxQualification.PackageAsync(token) || build != WindowsSandboxQualification.WindowsBuild)
            throw new IOException("Windows or Sandbox client changed during qualification.");
        var receipt = new WindowsSandboxReceipt(1, HyperVQualification.MachineId, HyperVQualification.ImplementationSha256, build,
            package, DateTimeOffset.UtcNow, checks.AsReadOnly());
        var path = WindowsSandboxQualification.ReceiptPath;
        // New evidence first. Preserve an existing receipt instead of overwriting it blindly.
        var candidate = path + "." + Guid.NewGuid().ToString("N") + ".new";
        WindowsSandboxQualification.Save(receipt, candidate);
        using (var pin = new Filspresso.Core.Tools.PinnedLocalPath(Path.GetDirectoryName(path)!))
        {
            if (File.Exists(path))
            {
                using (var previous = pin.OpenFile(Path.GetFileName(path))) { if (previous.Length > 65_536) throw new InvalidDataException("Existing receipt is oversized."); }
                File.Move(path, path + "." + Guid.NewGuid().ToString("N") + ".previous");
            }
            File.Move(candidate, path);
        }
        Console.WriteLine("Windows Sandbox qualified for this device, Windows/client version and exact app build. No model/billing or MSI qualification is implied.");
        return 0;
    }
}
