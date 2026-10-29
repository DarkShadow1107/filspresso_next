using System;
using System.Threading;
using System.Threading.Tasks;

namespace Filspresso.Core.Api;

public sealed record DesktopUpdateSnapshot(bool Checking, InstallerUpdate? Package, string Message, DateTimeOffset? CheckedAt)
{
    public bool HasUpdate(string runningVersion) => Package is { Available: true } package && package.IsNewerThan(runningVersion);
}

/// <summary>Read-only, bounded update discovery; independent of device check-in and downloads.</summary>
public sealed class DesktopUpdateChecker
{
    private readonly Func<CancellationToken, Task<ApiResult<InstallerUpdate>>> _fetch;
    private readonly string _runningVersion;
    private readonly TimeProvider _time;
    private readonly object _gate = new();
    private bool _busy;
    private int _revision;
    private DateTimeOffset _nextCheck;
    public DesktopUpdateSnapshot Snapshot { get; private set; } = new(false, null, "Update status has not been checked.", null);
    public event EventHandler? Changed;

    public DesktopUpdateChecker(string runningVersion, Func<CancellationToken, Task<ApiResult<InstallerUpdate>>> fetch, TimeProvider? time = null)
    { _runningVersion = runningVersion; _fetch = fetch; _time = time ?? TimeProvider.System; }

    public void Clear()
    {
        lock (_gate)
        {
            _revision++; _nextCheck = default;
            Snapshot = new(false, null, "Sign in to check for updates.", null);
        }
        Changed?.Invoke(this, EventArgs.Empty);
    }

    public async Task RefreshAsync(bool force = false, CancellationToken cancellationToken = default)
    {
        int revision;
        lock (_gate)
        {
            if (_busy || (!force && _time.GetUtcNow() < _nextCheck)) return;
            _busy = true; revision = _revision;
            Snapshot = Snapshot with { Checking = true, Message = "Checking published desktop version…" };
        }
        Changed?.Invoke(this, EventArgs.Empty);
        InstallerUpdate? package = null;
        var message = "Update check unavailable. Check your connection and retry.";
        var successful = false;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(8));
        try
        {
            // WaitAsync bounds even an uncooperative HTTP adapter. Never retries or installs.
            var result = await _fetch(timeout.Token).WaitAsync(timeout.Token).ConfigureAwait(false);
            if (result.Ok && result.Value is { } value)
            {
                package = value;
                successful = true;
                message = !value.Available ? "No desktop installer is currently published."
                    : !Version.TryParse(value.ProductVersion, out _) ? "The published version could not be verified. Retry later."
                    : value.IsNewerThan(_runningVersion) ? $"Version {value.ProductVersion} is available.{(value.CanDownload ? " Install it from this app." : " Download requires eligible account access.")}"
                    : $"Installed {_runningVersion} · published {value.ProductVersion}. No newer published version; local candidates are not update releases.";
                if (value.Unsigned) message += " Published installer is unsigned; verify the source and checksum.";
            }
        }
        catch (Exception error) when (error is System.Net.Http.HttpRequestException or System.IO.IOException or OperationCanceledException or InvalidOperationException or UnauthorizedAccessException)
        { /* Visible retryable status, not a fabricated 'up to date'. */ }
        finally
        {
            lock (_gate)
            {
                _busy = false;
                if (revision == _revision)
                {
                    var now = _time.GetUtcNow();
                    _nextCheck = now.AddMinutes(successful ? 30 : 1);
                    Snapshot = new(false, package, message, now);
                }
            }
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }
}
