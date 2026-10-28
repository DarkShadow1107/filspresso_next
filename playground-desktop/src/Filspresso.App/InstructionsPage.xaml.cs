using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Filspresso.App;

public sealed partial class InstructionsPage : UserControl, IDisposable
{
    private readonly AppServices _services;
    private bool _disposed;
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
        UpdateStatus.Text = _services.Auth.IsSignedIn ? state.Message : "Sign in to check the published version. No update has been verified.";
        LastChecked.Text = state.CheckedAt is { } time ? $"Last checked {time.ToLocalTime():g}" : "No successful version comparison yet";
        CheckUpdates.IsEnabled = _services.Auth.IsSignedIn && !state.Checking;
    }
    private async void OnCheckUpdates(object sender, RoutedEventArgs args) { await _services.Updates.RefreshAsync(force: true); RenderUpdate(); }
    private void OnRecheck(object sender, RoutedEventArgs args) => ReadSystem();
    private async void OnWebAccount(object sender, RoutedEventArgs args) => await Windows.System.Launcher.LaunchUriAsync(_services.AccountUrl);
    public void Dispose() { _disposed = true; _services.SystemNoticeChanged -= OnNotice; }
}
