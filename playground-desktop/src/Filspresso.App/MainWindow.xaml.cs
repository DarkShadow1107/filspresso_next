using System;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Filspresso.App;

/// <summary>
/// The signed-in shell: navigation on the left, whatever is selected on the right.
/// </summary>
/// <remarks>
/// Its one job is the boundary between "signed in" and "not signed in". Everything else is
/// navigation, and keeping that boundary in one place is what stops a screen from being
/// reachable while the session has expired underneath it.
/// </remarks>
public sealed partial class MainWindow : Window
{
    private readonly AppServices _services;
    private AccountPanel? _accountPanel;
    private ScrollViewer? _accountHost;
    private PlaygroundPage? _playgroundPage;
    private SettingsPage? _settingsPage;
    private RunHistoryPage? _runHistoryPage;
    private AgentReviewPage? _agentReviewPage;
    private bool _loaded;
    private bool _refreshing;
    private bool _railExpanded, _instructionsOpen;

    public MainWindow()
    {
        App.TraceStartup("MainWindow constructor");
        _services = new AppServices(new Uri(
            Environment.GetEnvironmentVariable("FILSPRESSO_BACKEND_URL") ?? "http://localhost:4000/"));
        App.TraceStartup("AppServices created");
        InitializeComponent();
        App.TraceStartup("MainWindow XAML loaded");
        Title = $"Spectre Playground · Filspresso · {_services.AppVersion}";
        _services.SystemNoticeChanged += OnSystemNotice;
        _services.WindowHandle = WinRT.Interop.WindowNative.GetWindowHandle(this);
        AppWindow.Resize(new Windows.Graphics.SizeInt32(1280, 860));
        AppWindow.TitleBar.BackgroundColor = Windows.UI.Color.FromArgb(255, 20, 18, 19);
        AppWindow.TitleBar.ForegroundColor = Windows.UI.Color.FromArgb(255, 242, 229, 220);
        AppWindow.TitleBar.ButtonBackgroundColor = Windows.UI.Color.FromArgb(255, 20, 18, 19);
        AppWindow.TitleBar.ButtonForegroundColor = Windows.UI.Color.FromArgb(255, 228, 179, 138);
        Activated += OnWindowActivated;
        Closed += (_, _) =>
        {
            _playgroundPage?.Dispose();
            _runHistoryPage?.Dispose();
            _agentReviewPage?.Dispose();
            _services.Dispose();
            _services.SystemNoticeChanged -= OnSystemNotice;
        };
        ShowSignedOut();
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_loaded)
        {
            return;
        }

        _loaded = true;
        try
        {
            await _services.Auth.RestoreAsync();
            if (_services.Auth.IsSignedIn)
            {
                await ShowSignedInAsync();
            }
        }
        catch (Exception error)
        {
            ShowError(error);
        }
    }

    private async Task ShowSignedInAsync()
    {
        _playgroundPage ??= new PlaygroundPage(_services, _services.Playground);
        _playgroundPage.SettingsRequested -= OnSettings;
        _playgroundPage.SettingsRequested += OnSettings;
        if (_settingsPage is null)
        {
            _settingsPage = new SettingsPage(_services);
            _settingsPage.BackRequested += (_, _) => SetSection("chat");
            _settingsPage.ExportRequested += async (_, _) => await _playgroundPage.ExportConversationAsync();
            _settingsPage.ImportRequested += async (_, _) => { await _playgroundPage.ImportConversationAsync(); SetSection("chat"); };
        }
        if (_accountPanel is null)
        {
            _accountPanel = new AccountPanel(_services);
            _accountPanel.SignOutRequested += async (_, _) =>
            {
                _playgroundPage?.Dispose();
                _runHistoryPage?.Dispose();
                _runHistoryPage = null;
                _agentReviewPage?.Dispose();
                _agentReviewPage = null;
                await _services.Auth.SignOutAsync();
                _playgroundPage = null;
                _accountPanel = null;
                _accountHost = null;
                _settingsPage = null;
                ShowSignedOut();
            };
        }

        SignInHost.Children.Clear();
        SignInHost.Visibility = Visibility.Collapsed;
        WorkspaceHost.Visibility = Rail.Visibility = Visibility.Visible;
        Subtitle.Text = _services.Auth.Current?.Email ?? string.Empty;
        AccountButton.Content = "Account";
        ContentFrame.Content = _playgroundPage;
        SetSection("chat");
        await _playgroundPage.RefreshAsync();
        _ = _services.Updates.RefreshAsync();
    }

    private void ShowSignedOut()
    {
        WorkspaceHost.Visibility = Rail.Visibility = Visibility.Collapsed;
        ContentFrame.Content = null;
        SignInHost.Visibility = Visibility.Visible;
        SignInHost.Children.Clear();
        SignInHost.Children.Add(new LoginPage(
            _services.Auth,
            () => _services.LoadEntitlementAsync(),
            () => DispatcherQueue.TryEnqueue(async () =>
            {
                try
                {
                    await ShowSignedInAsync();
                }
                catch (Exception error)
                {
                    ShowError(error);
                }
            })));
        Subtitle.Text = "Not signed in";
        AccountButton.Content = "Sign in";
    }

    private async void OnAccountClick(object sender, RoutedEventArgs args)
    {
        if (!_services.Auth.IsSignedIn)
        {
            ShowSignedOut();
            return;
        }
        try
        {
            _runHistoryPage?.CancelPendingRequests();
            _agentReviewPage?.CancelPendingRequests();
            _playgroundPage?.SuspendAgent();
            _accountHost ??= new ScrollViewer
            {
                Content = _accountPanel,
                Padding = new Thickness(36, 24, 36, 36),
                MaxWidth = 820,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            ContentFrame.Content = _accountHost;
            if (_accountPanel is not null) await _accountPanel.RefreshAsync();
        }
        catch (Exception error)
        {
            ShowError(error);
        }
    }

    /// <summary>
    /// Re-reads the account state when the window regains focus.
    /// </summary>
    /// <remarks>
    /// A subscription can lapse, a wallet can be topped up, and a session can be revoked from
    /// another device, and none of those announce themselves. Polling on focus is how the
    /// application notices without asking the user to press a refresh button -- and without
    /// polling continuously, which would spend the request budget for nothing.
    /// </remarks>
    private async void OnWindowActivated(object sender, WindowActivatedEventArgs args)
    {
        if (!_loaded || _refreshing || !_services.Auth.IsSignedIn ||
            args.WindowActivationState == WindowActivationState.Deactivated)
        {
            return;
        }

        _refreshing = true;
        try
        {
            _ = _services.Updates.RefreshAsync();
            if (ContentFrame.Content is ScrollViewer { Content: AccountPanel } && _accountPanel is not null)
            {
                await _accountPanel.RefreshAsync();
            }
            else if (_playgroundPage is not null)
            {
                await _playgroundPage.RefreshAsync();
            }
        }
        catch (Exception error)
        {
            ShowError(error);
        }
        finally
        {
            _refreshing = false;
        }
    }

    private void SetSection(string section)
    {
        if (_playgroundPage is null) return;
        if (section == "review" && _services.Playground.IsSending)
        { EntitlementBar.Message = "Finish or stop Chat generation before opening proposal review."; EntitlementBar.IsOpen = true; return; }
        _runHistoryPage?.CancelPendingRequests();
        _agentReviewPage?.CancelPendingRequests();
        if (section != "chat") _playgroundPage.SuspendAgent();
        PricesNav.Background = SettingsNav.Background = ActivityNav.Background = ReviewNav.Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Transparent);
        if (section == "review")
        {
            _agentReviewPage ??= new AgentReviewPage(_services);
            ContentFrame.Content = _agentReviewPage;
            ReviewNav.Background = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["FilspressoSurface"];
            _agentReviewPage.Reload(_playgroundPage.SavedSessionUuid);
            return;
        }
        if (section == "activity")
        {
            _runHistoryPage ??= new RunHistoryPage(_services);
            ContentFrame.Content = _runHistoryPage;
            ActivityNav.Background = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["FilspressoSurface"];
            _ = _runHistoryPage.RefreshAsync(_playgroundPage.SavedSessionUuid);
            return;
        }
        if (section == "settings")
        {
            _settingsPage?.Reload();
            ContentFrame.Content = _settingsPage;
            SettingsNav.Background = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["FilspressoSurface"];
            return;
        }
        _playgroundPage.ShowModelsOnly(section == "prices");
        ContentFrame.Content = _playgroundPage;
        if (section == "prices") PricesNav.Background = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["FilspressoSurface"];
    }

    private void OnSettings(object? sender, RoutedEventArgs args) => SetSection("settings");
    private void OnPrices(object sender, RoutedEventArgs args) => SetSection("prices");
    private void OnActivity(object sender, RoutedEventArgs args) => SetSection("activity");
    private void OnReview(object sender, RoutedEventArgs args) => SetSection("review");
    private void OnNewConversation(object sender, RoutedEventArgs args) { SetSection("chat"); _playgroundPage?.NewConversation(); }
    private void OnConversations(object sender, RoutedEventArgs args) { SetSection("chat"); _playgroundPage?.ToggleConversations(false); }
    private void OnSearch(object sender, RoutedEventArgs args) { SetSection("chat"); _playgroundPage?.ToggleConversations(true); }

    private void OnToggleNavigation(object sender, RoutedEventArgs args)
    {
        _railExpanded = !_railExpanded; Rail.Width = _railExpanded ? 210 : 66;
        foreach (var child in RailItems.Children)
        {
            if (child is not Button { Content: StackPanel content } button) continue;
            button.Width = _railExpanded ? 188 : 42;
            button.HorizontalContentAlignment = _railExpanded ? HorizontalAlignment.Left : HorizontalAlignment.Center;
            button.Padding = new Thickness(_railExpanded ? 11 : 0, 0, 0, 0);
            foreach (var item in content.Children)
                if (item is TextBlock { Tag: "nav-label" } label) label.Visibility = _railExpanded ? Visibility.Visible : Visibility.Collapsed;
        }
    }
    private void OnSystemNotice(object? sender, EventArgs args) => DispatcherQueue.TryEnqueue(() =>
    {
        var version = _services.NewDesktopBuildVersion;
        var install = _services.UpdateInstaller.Snapshot;
        UpdateBar.Title = install.Running ? "Installing desktop update"
            : version is not null ? $"Desktop {version} is available"
            : install.Failed ? "Desktop update did not complete" : string.Empty;
        UpdateBar.Message = install.Running || install.Failed ? install.Message : _services.Updates.Snapshot.Message;
        InstallUpdateButton.Content = install.Running ? "Installing…" : "Install update";
        InstallUpdateButton.IsEnabled = !install.Running && _services.Updates.Snapshot.Package is { CanDownload: true };
        UpdateBar.IsOpen = version is not null || install.Running || install.Failed;
    });
    private async void OnInstallUpdate(object sender, RoutedEventArgs args)
    {
        var package = _services.Updates.Snapshot.Package;
        if (package is null || !_services.Updates.Snapshot.HasUpdate(_services.AppVersion) || !package.CanDownload) return;
        var confirmation = new CheckBox
        {
            Content = new TextBlock
            {
                Text = "I have read the update details and want to download and install this package.",
                TextWrapping = TextWrapping.Wrap,
            },
            IsChecked = false,
        };
        var details = new StackPanel { Spacing = 12, MaxWidth = 520 };
        details.Children.Add(new TextBlock
        {
            Text = $"Version {package.ProductVersion} · {FormatUpdateBytes(package.Bytes)}\nSHA-256: {package.Sha256}\n\nThe installer downloads to a temporary folder, is checked against the published size and checksum, then Windows Installer asks for permission. This app closes and restarts after installation. Playground settings, credentials and user files are not removed.",
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
        });
        if (package.Unsigned)
            details.Children.Add(new TextBlock
            {
                Text = "This package is unsigned. Windows may show an unverified-publisher warning during installation.",
                TextWrapping = TextWrapping.Wrap,
                Foreground = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["FilspressoAccent"],
            });
        details.Children.Add(confirmation);
        var dialog = new ContentDialog
        {
            XamlRoot = Root.XamlRoot,
            Title = "Install desktop update?",
            Content = details,
            PrimaryButtonText = "Download and install",
            CloseButtonText = "Not now",
            DefaultButton = ContentDialogButton.Close,
            IsPrimaryButtonEnabled = false,
        };
        confirmation.Checked += (_, _) => dialog.IsPrimaryButtonEnabled = true;
        confirmation.Unchecked += (_, _) => dialog.IsPrimaryButtonEnabled = false;
        var choice = await dialog.ShowAsync();
        if (choice != ContentDialogResult.Primary) return;
        var shouldExit = await _services.InstallDesktopUpdateAsync();
        if (shouldExit) Application.Current.Exit();
    }
    private static string FormatUpdateBytes(long? bytes) => bytes is > 0
        ? bytes.Value >= 1024 * 1024 ? $"{bytes.Value / 1024d / 1024d:0.0} MB" : $"{Math.Max(1, bytes.Value / 1024)} KB"
        : "size unavailable";
    private async void OnInstructions(object sender, RoutedEventArgs args)
    {
        if (_instructionsOpen) return;
        _instructionsOpen = true;
        using var page = new InstructionsPage(_services) { MaxHeight = 600 };
        try
        {
            var dialog = new ContentDialog { XamlRoot = Root.XamlRoot, Title = "Desktop instructions", Content = page,
                CloseButtonText = "Done", DefaultButton = ContentDialogButton.Close };
            await dialog.ShowAsync();
        }
        finally { _instructionsOpen = false; }
    }

    private void ShowError(Exception error)
    {
        EntitlementBar.Message = error is System.Net.Http.HttpRequestException
            ? "Could not reach Filspresso. Check your connection and refresh."
            : "Account state could not be loaded. Try refreshing or signing in again.";
        EntitlementBar.IsOpen = true;
    }
}
