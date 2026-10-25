using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Platform;
using Filspresso.Core.Storage;
using Filspresso.Core.Tools;
using Microsoft.Win32;

namespace Filspresso.Sandbox;

public sealed record WindowsSandboxReceipt(int Version, string Machine, string Implementation, string WindowsBuild,
    string Package, DateTimeOffset CreatedUtc, IReadOnlyList<string> Checks);

/// <summary>Separate from Hyper-V receipts. A fixture can never activate the shipped app.</summary>
public static class WindowsSandboxQualification
{
    public static string ReceiptPath => Path.Combine(DesktopDataPaths.UserDataDirectory, "qualification", "windows-sandbox.bin");
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Filspresso.WindowsSandbox.offline.policy1");
    public static IReadOnlyList<string> RequiredChecks { get; } = Array.AsReadOnly(new[]
    {
        "explicit-id", "offline-readonly-input", "file-roundtrip", "appcontainer-jobs", "command-snapshot",
        "normal-exit-descendants", "reparse-hardlink-refusal", "pinned-directory-races", "timeout-discard", "output-discard",
        "stop-confirmed", "crash-worker-recovery",
    });
    public static string WindowsBuild
    {
        get
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            return $"{key?.GetValue("CurrentBuild")}.{key?.GetValue("UBR")}";
        }
    }
    public static string SetupStatus
    {
        get
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            var edition = PlatformRequirementCheck.ParseEdition(key?.GetValue("EditionID") as string, key?.GetValue("InstallationType") as string);
            if (!PlatformRequirementCheck.EditionSupportsHyperV(edition)) return "Windows Sandbox requires a supported Pro, Enterprise or Education edition; no host-execution fallback exists.";
            if (Environment.OSVersion.Version.Build < 26100) return "Automated execution requires Windows 11 24H2 or newer and the updated Windows Sandbox client. Repository inspection remains available.";
            if (!File.Exists(WindowsSandboxCli.ExecutablePath)) return "Windows Sandbox setup required: enable Windows Sandbox in Windows Features (administrator approval; a restart may be needed), then open it once to finish its client update. No VHDX or guest password is needed.";
            return string.Empty;
        }
    }
    internal static async Task<string> PackageAsync(CancellationToken token)
    {
        const string script = """
            $ErrorActionPreference = 'Stop'
            $names = @(Get-AppxPackage '*WindowsSandbox*' | Select-Object -ExpandProperty PackageFullName | Sort-Object)
            if ($names.Count -ne 1) { exit 1 }
            [Console]::Out.Write($names[0])
            """;
        var result = await new PowerShellRunner().RunAsync(script, TimeSpan.FromSeconds(15), token).ConfigureAwait(false);
        if (result.ExitCode != 0 || result.Output.Trim() is not { Length: > 0 and < 512 } package) throw new IOException("The installed Windows Sandbox package could not be identified.");
        return package;
    }
    public static bool Validate(WindowsSandboxReceipt receipt, string package)
    {
        return receipt.Version == 1 && receipt.Machine == HyperVQualification.MachineId && receipt.Machine.Length == 32 &&
            receipt.Implementation == HyperVQualification.ImplementationSha256 && receipt.WindowsBuild == WindowsBuild && receipt.Package == package &&
            receipt.CreatedUtc <= DateTimeOffset.UtcNow.AddMinutes(2) && DateTimeOffset.UtcNow - receipt.CreatedUtc < TimeSpan.FromDays(30) &&
            receipt.Checks is { Count: <= 32 } && receipt.Checks.Distinct(StringComparer.Ordinal).Count() == receipt.Checks.Count &&
            RequiredChecks.All(check => receipt.Checks.Contains(check));
    }
    public static async Task<(bool Qualified, string Status)> CheckAsync(CancellationToken token = default)
    {
        var setup = SetupStatus; if (setup.Length > 0) return (false, setup);
        if (!File.Exists(ReceiptPath)) return (false, "Windows Sandbox is installed; run the bundled Windows Sandbox qualification tool for this application build before enabling execution. No VHDX or guest password is required.");
        try
        {
            using var pin = new PinnedLocalPath(Path.GetDirectoryName(ReceiptPath)!); using var file = pin.OpenFile(Path.GetFileName(ReceiptPath));
            if (file.Length is < 1 or > 65_536) throw new InvalidDataException();
            var encrypted = new byte[(int)file.Length]; file.ReadExactly(encrypted);
            var bytes = ProtectedData.Unprotect(encrypted, Entropy, DataProtectionScope.CurrentUser);
            var receipt = JsonSerializer.Deserialize<WindowsSandboxReceipt>(bytes) ?? throw new InvalidDataException();
            if (!Validate(receipt, await PackageAsync(token).ConfigureAwait(false))) return (false, "Windows Sandbox qualification is stale or belongs to a different machine, Windows/client version or app build. Re-run qualification.");
            return (true, "Windows Sandbox qualified · offline VM · original project not shared · reviewed changes only");
        }
        catch (OperationCanceledException) { throw; }
        catch { return (false, "Windows Sandbox qualification could not be verified. Execution remains disabled."); }
    }
    internal static void Save(WindowsSandboxReceipt receipt, string path)
    {
        if (!Validate(receipt, receipt.Package)) throw new InvalidDataException("Incomplete live Windows Sandbox qualification.");
        using var pin = new PinnedLocalPath(Path.GetDirectoryName(path)!, create: true);
        using var file = pin.OpenFile(Path.GetFileName(path), FileAccess.ReadWrite, createNew: true);
        file.Write(ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(receipt), Entropy, DataProtectionScope.CurrentUser)); file.Flush(true);
    }
}
