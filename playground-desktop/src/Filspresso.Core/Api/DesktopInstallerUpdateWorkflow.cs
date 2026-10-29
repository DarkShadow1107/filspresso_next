using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Filspresso.Core.Api;

/// <summary>Visible state of one in-app installer operation.</summary>
public sealed record DesktopInstallerUpdateSnapshot(bool Running, string Message, int ProgressPercent, string? ProductVersion, bool Failed)
{
    public static DesktopInstallerUpdateSnapshot Idle { get; } = new(false, string.Empty, 0, null, false);
}

/// <summary>Local update journal. It contains state transitions, never credentials or document contents.</summary>
public interface IDesktopUpdateJournal
{
    void Record(string stage, string? productVersion = null, string? detail = null);
}

/// <summary>Receives installation after this application exits and relaunches it afterward.</summary>
public interface IDesktopUpdateLauncher
{
    bool Start(string installerPath, string applicationPath, string journalPath, int parentProcessId);
}

/// <summary>
/// A bounded, append-only journal with one bounded previous generation. It deliberately
/// shares the app's user-data directory, but touches only its own two log files.
/// </summary>
public sealed class DesktopUpdateJournal(string path) : IDesktopUpdateJournal
{
    public const int MaximumBytes = 64 * 1024;
    private readonly object _gate = new();

    public void Record(string stage, string? productVersion = null, string? detail = null)
    {
        try
        {
            var safe = new
            {
                at = DateTimeOffset.UtcNow,
                stage = Clean(stage, 48),
                productVersion = Clean(productVersion, 32),
                detail = Clean(detail, 240),
            };
            var line = JsonSerializer.Serialize(safe) + Environment.NewLine;
            lock (_gate)
            {
                var directory = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                var bytes = Encoding.UTF8.GetByteCount(line);
                if (File.Exists(path) && new FileInfo(path).Length + bytes > MaximumBytes)
                {
                    var previous = path + ".previous";
                    if (File.Exists(previous)) File.Delete(previous);
                    File.Move(path, previous);
                }
                File.AppendAllText(path, line, new UTF8Encoding(false));
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        {
            // Update logging must not prevent the user's explicit update from proceeding.
        }
    }

    private static string? Clean(string? value, int max)
    {
        if (value is null) return null;
        var clean = new string(value.Where(character => !char.IsControl(character)).ToArray());
        return clean.Length <= max ? clean : clean[..max];
    }
}

/// <summary>
/// External hand-off helper. It waits for the current app to exit, asks Windows Installer
/// for the normal UAC elevation, and relaunches this same executable after either a successful
/// install or a user-cancelled/failed install. The MSI and helper live in the app's temp
/// update directory; the updater never writes into the profile or workspace.
/// </summary>
public sealed class PowerShellDesktopUpdateLauncher : IDesktopUpdateLauncher
{
    private const string Helper = """
        param([string]$Msi, [string]$Application, [int]$ParentPid, [string]$Journal, [string]$HelperPath)
        $ErrorActionPreference = 'Stop'
        function Write-UpdateLog([string]$Stage, [string]$Detail) {
          try {
            if ((Test-Path -LiteralPath $Journal -PathType Leaf) -and (Get-Item -LiteralPath $Journal).Length -gt 65536) {
              $previous = $Journal + '.previous'
              if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Force }
              Move-Item -LiteralPath $Journal -Destination $previous -Force
            }
            $record = @{ at = [DateTimeOffset]::UtcNow.ToString('O'); stage = $Stage; detail = $Detail } | ConvertTo-Json -Compress
            Add-Content -LiteralPath $Journal -Value $record -Encoding UTF8
          } catch { }
        }
        try {
          Write-UpdateLog 'helper-started' 'Waiting for the desktop application to exit.'
          Wait-Process -Id $ParentPid -ErrorAction SilentlyContinue
          Write-UpdateLog 'installer-started' 'Requesting Windows Installer elevation.'
          $arguments = '/i "' + $Msi + '" /passive /norestart'
          $installer = Start-Process -FilePath 'msiexec.exe' -Verb RunAs -ArgumentList $arguments -Wait -PassThru
          if ($installer.ExitCode -eq 0 -or $installer.ExitCode -eq 3010) {
            Write-UpdateLog 'installer-succeeded' ('Windows Installer exit code ' + $installer.ExitCode)
          } else {
            Write-UpdateLog 'installer-failed' ('Windows Installer exit code ' + $installer.ExitCode)
          }
        } catch {
          Write-UpdateLog 'installer-failed' $_.Exception.Message
        } finally {
          try { Start-Process -FilePath $Application } catch { Write-UpdateLog 'relaunch-failed' $_.Exception.Message }
          try { Remove-Item -LiteralPath $Msi -Force -ErrorAction SilentlyContinue } catch { }
          try { Remove-Item -LiteralPath $HelperPath -Force -ErrorAction SilentlyContinue } catch { }
        }
        """;

    public bool Start(string installerPath, string applicationPath, string journalPath, int parentProcessId)
    {
        if (!OperatingSystem.IsWindows() || !File.Exists(installerPath) || !File.Exists(applicationPath)) return false;
        try
        {
            var directory = Path.GetDirectoryName(installerPath);
            if (string.IsNullOrWhiteSpace(directory)) return false;
            var helperPath = Path.Combine(directory, $"filspresso-update-{Guid.NewGuid():N}.ps1");
            File.WriteAllText(helperPath, Helper, new UTF8Encoding(false));
            var start = new ProcessStartInfo("powershell.exe")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            start.ArgumentList.Add("-NoProfile");
            start.ArgumentList.Add("-NonInteractive");
            start.ArgumentList.Add("-ExecutionPolicy");
            start.ArgumentList.Add("Bypass");
            start.ArgumentList.Add("-File");
            start.ArgumentList.Add(helperPath);
            start.ArgumentList.Add(installerPath);
            start.ArgumentList.Add(applicationPath);
            start.ArgumentList.Add(parentProcessId.ToString(CultureInfo.InvariantCulture));
            start.ArgumentList.Add(journalPath);
            start.ArgumentList.Add(helperPath);
            var process = Process.Start(start);
            if (process is null)
            {
                File.Delete(helperPath);
                return false;
            }
            process.Dispose();
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException or System.ComponentModel.Win32Exception or ArgumentException)
        {
            return false;
        }
    }
}

/// <summary>
/// A user-confirmed, journaled update transaction:
/// acknowledge → stream to temp → verify manifest size/hash → atomic rename → external
/// installer hand-off → app exits → helper installs → helper relaunches the same app.
/// </summary>
public sealed class DesktopInstallerUpdateWorkflow
{
    public const long MaximumInstallerBytes = 250L * 1024 * 1024;
    private readonly DesktopApiClient _api;
    private readonly Func<CancellationToken, Task<string?>> _accessToken;
    private readonly string _runningVersion;
    private readonly string _temporaryRoot;
    private readonly string _applicationPath;
    private readonly IDesktopUpdateJournal _journal;
    private readonly IDesktopUpdateLauncher _launcher;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public DesktopInstallerUpdateWorkflow(
        DesktopApiClient api,
        Func<CancellationToken, Task<string?>> accessToken,
        string runningVersion,
        string temporaryRoot,
        string applicationPath,
        string journalPath,
        IDesktopUpdateJournal? journal = null,
        IDesktopUpdateLauncher? launcher = null)
    {
        _api = api;
        _accessToken = accessToken;
        _runningVersion = runningVersion;
        _temporaryRoot = temporaryRoot;
        _applicationPath = applicationPath;
        JournalPath = journalPath;
        _journal = journal ?? new DesktopUpdateJournal(journalPath);
        _launcher = launcher ?? new PowerShellDesktopUpdateLauncher();
    }

    public string JournalPath { get; }
    public DesktopInstallerUpdateSnapshot Snapshot { get; private set; } = DesktopInstallerUpdateSnapshot.Idle;
    public event EventHandler? Changed;

    /// <returns>True only when a verified MSI was handed to the helper and the app should exit.</returns>
    public async Task<bool> InstallAsync(InstallerUpdate? package, CancellationToken cancellationToken = default)
    {
        if (!await _gate.WaitAsync(0, cancellationToken).ConfigureAwait(false)) return false;
        string? partPath = null;
        string? installerPath = null;
        var handedOff = false;
        try
        {
            if (!Validate(package, out var validationError)) return Fail(validationError, package?.ProductVersion);
            var update = package!;
            SetSnapshot(new(true, "Confirming this update with the server…", 0, update.ProductVersion, false), "acknowledging");
            var token = await _accessToken(cancellationToken).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(token)) return Fail("Sign in again before installing the desktop update.", update.ProductVersion);
            var acknowledged = await _api.AcknowledgeInstallerUpdateAsync(token, update.ProductVersion!, cancellationToken).ConfigureAwait(false);
            if (!acknowledged.Ok) return Fail(acknowledged.Message.Length > 0 ? acknowledged.Message : "The server did not acknowledge this update.", update.ProductVersion);
            _journal.Record("acknowledged", update.ProductVersion);

            Directory.CreateDirectory(_temporaryRoot);
            var nonce = Guid.NewGuid().ToString("N");
            partPath = Path.Combine(_temporaryRoot, $"filspresso-update-{nonce}.part");
            installerPath = Path.Combine(_temporaryRoot, $"filspresso-update-{nonce}.msi");
            SetSnapshot(new(true, "Downloading desktop update…", 0, update.ProductVersion, false), "download-started");
            var progress = new InlineProgress(value =>
            {
                var percent = update.Bytes is > 0 ? (int)Math.Clamp(value * 100 / update.Bytes.Value, 0, 100) : 0;
                SetSnapshot(new(true, update.Bytes is > 0
                    ? $"Downloading desktop update… {FormatBytes(value)} / {FormatBytes(update.Bytes.Value)}"
                    : $"Downloading desktop update… {FormatBytes(value)}", percent, update.ProductVersion, false), "download-progress");
            });
            var download = await _api.DownloadInstallerUpdateAsync(token, partPath, MaximumInstallerBytes, progress, cancellationToken).ConfigureAwait(false);
            if (!download.Ok)
                return Fail(download.Message.Length > 0 ? download.Message : "The desktop installer could not be downloaded.", update.ProductVersion);
            var downloadedBytes = download.Value;
            _journal.Record("download-finished", update.ProductVersion, downloadedBytes.ToString(CultureInfo.InvariantCulture));

            if (update.Bytes is not { } expectedBytes || downloadedBytes != expectedBytes)
                return Fail("The installer size did not match its published manifest. It was not installed.", update.ProductVersion);
            SetSnapshot(new(true, "Verifying installer integrity…", 100, update.ProductVersion, false), "verification-started");
            byte[] expectedHash;
            try { expectedHash = Convert.FromHexString(update.Sha256!); }
            catch (FormatException) { return Fail("The published installer checksum was invalid. It was not installed.", update.ProductVersion); }
            byte[] actualHash;
            await using (var file = new FileStream(partPath, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, useAsync: true))
                actualHash = await SHA256.HashDataAsync(file, cancellationToken).ConfigureAwait(false);
            if (!CryptographicOperations.FixedTimeEquals(expectedHash, actualHash))
                return Fail("The installer checksum did not match its published manifest. It was not installed.", update.ProductVersion);
            _journal.Record("verification-succeeded", update.ProductVersion, Convert.ToHexString(actualHash).ToLowerInvariant());

            // Both files are in the same temp directory: this rename is atomic and the final
            // name becomes visible only after the size and digest have passed.
            File.Move(partPath, installerPath);
            partPath = null;
            SetSnapshot(new(true, "Update verified. Closing this window to install and restart…", 100, update.ProductVersion, false), "installer-handoff-started");
            if (!_launcher.Start(installerPath, _applicationPath, JournalPath, Environment.ProcessId))
                return Fail("The installer helper could not start. The update was not installed; please retry.", update.ProductVersion);

            handedOff = true;
            _journal.Record("installer-helper-started", update.ProductVersion);
            SetSnapshot(new(false, "The verified installer is ready. Closing now; the app will restart when Windows finishes.", 100, update.ProductVersion, false), "handoff-complete");
            return true;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            _journal.Record("cancelled", package?.ProductVersion, "User cancelled the update download.");
            return Fail("Update cancelled. The current app and your data are unchanged.", package?.ProductVersion);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException or System.Net.Http.HttpRequestException or CryptographicException or ArgumentException)
        {
            _journal.Record("failed", package?.ProductVersion, error.GetType().Name + ": " + error.Message);
            return Fail("The desktop update could not be completed. The current app and your data are unchanged.", package?.ProductVersion);
        }
        finally
        {
            if (partPath is not null) TryDelete(partPath);
            if (!handedOff && installerPath is not null) TryDelete(installerPath);
            _gate.Release();
        }
    }

    private bool Validate(InstallerUpdate? package, out string error)
    {
        if (package is null || !package.Available) { error = "There is no published desktop update to install."; return false; }
        if (!package.CanDownload) { error = "This account is not eligible to download the desktop installer."; return false; }
        if (!package.IsNewerThan(_runningVersion)) { error = "The published installer is not newer than this app."; return false; }
        if (package.ProductVersion is not { Length: <= 32 } || !Version.TryParse(package.ProductVersion, out _))
        { error = "The published version could not be verified."; return false; }
        if (package.Sha256 is not { Length: 64 } hash || !IsHex(hash))
        { error = "The published installer checksum is missing or invalid."; return false; }
        if (package.Bytes is not { } bytes || bytes <= 0 || bytes > MaximumInstallerBytes)
        { error = "The published installer size is outside the safe download limit."; return false; }
        if (!File.Exists(_applicationPath)) { error = "The running desktop executable could not be located for restart."; return false; }
        error = string.Empty;
        return true;
    }

    private bool Fail(string message, string? version)
    {
        _journal.Record("failed", version, message);
        SetSnapshot(new(false, message, 0, version, true), "failed");
        return false;
    }

    private void SetSnapshot(DesktopInstallerUpdateSnapshot snapshot, string stage)
    {
        Snapshot = snapshot;
        if (stage is not "download-progress") _journal.Record(stage, snapshot.ProductVersion, snapshot.Message);
        Changed?.Invoke(this, EventArgs.Empty);
    }

    private static bool IsHex(string value)
    {
        foreach (var character in value)
            if (!Uri.IsHexDigit(character)) return false;
        return true;
    }

    private static string FormatBytes(long bytes) => bytes >= 1024 * 1024
        ? $"{bytes / 1024d / 1024d:0.0} MB"
        : $"{Math.Max(1, bytes / 1024)} KB";

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    }

    private sealed class InlineProgress(Action<long> report) : IProgress<long>
    {
        public void Report(long value) => report(value);
    }
}
