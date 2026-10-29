using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Filspresso.App;

public sealed partial class InstructionsPage : UserControl, IDisposable
{
    private readonly AppServices _services;
    private bool _disposed;
    private string? _acknowledgedVersion;
    public InstructionsPage(AppServices services)
    {
        _services = services; InitializeComponent();
        services.SystemNoticeChanged += OnNotice;
        ReadSystem(); RenderUpdate();
    }
    private void ReadSystem()
    {
        var report = WindowsPlatformProbe.TryReadSystemReport();
        var family = report?.Build is { } build ? build >= 22000 ? "Windows 11" : "Windows 10" : "Windows";
        SystemFacts.Text = $"{family} · edition: {report?.Edition ?? "not reported"} · build: {report?.Build?.ToString() ?? "not reported"}{(report?.Ubr is { } ubr ? "." + ubr : string.Empty)} · {System.Runtime.InteropServices.RuntimeInformation.OSArchitecture}\nRead from this PC at {DateTime.Now:t}. Sandbox/virtualization verification is separate.";
    }
    private void OnNotice(object? sender, EventArgs args) => DispatcherQueue.TryEnqueue(() => { if (!_disposed) RenderUpdate(); });
    private void RenderUpdate()
    {
        VersionFacts.Text = $"Installed version · {_services.AppVersion}";
        var state = _services.Updates.Snapshot;
        var package = state.Package;
        var install = _services.UpdateInstaller.Snapshot;
        var hasUpdate = state.HasUpdate(_services.AppVersion);
        if (_acknowledgedVersion != package?.ProductVersion)
        {
            _acknowledgedVersion = package?.ProductVersion;
            UpdateAcknowledgement.IsChecked = false;
        }
        UpdateStatus.Text = install.Running || install.Failed
            ? install.Message
            : _services.Auth.IsSignedIn ? state.Message : "Sign in to check the published version. No update has been verified.";
        UpdatePackageFacts.Text = hasUpdate && package is not null
            ? $"Version {package.ProductVersion} · {FormatBytes(package.Bytes)} · SHA-256 {package.Sha256}{(package.Unsigned ? " · unsigned; Windows may warn" : string.Empty)}"
            : string.Empty;
        LastChecked.Text = state.CheckedAt is { } time ? $"Last checked {time.ToLocalTime():g}" : "No successful version comparison yet";
        CheckUpdates.IsEnabled = _services.Auth.IsSignedIn && !state.Checking;
        var offerInstall = hasUpdate && package is { CanDownload: true };
        InstallUpdate.Visibility = offerInstall ? Visibility.Visible : Visibility.Collapsed;
        UpdateAcknowledgement.Visibility = offerInstall ? Visibility.Visible : Visibility.Collapsed;
        InstallUpdate.IsEnabled = offerInstall && UpdateAcknowledgement.IsChecked == true && !install.Running;
        UpdateProgress.Visibility = install.Running ? Visibility.Visible : Visibility.Collapsed;
        UpdateProgress.Value = install.ProgressPercent;
    }
    private async void OnCheckUpdates(object sender, RoutedEventArgs args) { await _services.Updates.RefreshAsync(force: true); RenderUpdate(); }
    private void OnUpdateAcknowledgementChanged(object sender, RoutedEventArgs args) => RenderUpdate();
    private async void OnInstallUpdate(object sender, RoutedEventArgs args)
    {
        if (UpdateAcknowledgement.IsChecked != true) return;
        var shouldExit = await _services.InstallDesktopUpdateAsync();
        RenderUpdate();
        if (shouldExit) Application.Current.Exit();
    }
    private void OnRecheck(object sender, RoutedEventArgs args) => ReadSystem();
    private async void OnWebAccount(object sender, RoutedEventArgs args) => await Windows.System.Launcher.LaunchUriAsync(_services.AccountUrl);
    private static string FormatBytes(long? bytes) => bytes is > 0
        ? bytes.Value >= 1024 * 1024 ? $"{bytes.Value / 1024d / 1024d:0.0} MB" : $"{Math.Max(1, bytes.Value / 1024)} KB"
        : "size unavailable";
    public void Dispose() { _disposed = true; _services.SystemNoticeChanged -= OnNotice; }
}
