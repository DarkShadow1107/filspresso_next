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
    private bool _loaded;
    private bool _refreshing;

    public MainWindow()
    {
        _services = new AppServices(new Uri(
            Environment.GetEnvironmentVariable("FILSPRESSO_BACKEND_URL") ?? "http://localhost:4000/"));
        InitializeComponent();
        Title = "Spectre Playground · Filspresso";
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
            _services.Dispose();
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
        PricesNav.Background = SettingsNav.Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Transparent);
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
    private void OnNewConversation(object sender, RoutedEventArgs args) { SetSection("chat"); _playgroundPage?.NewConversation(); }
    private void OnConversations(object sender, RoutedEventArgs args) { SetSection("chat"); _playgroundPage?.ToggleConversations(false); }
    private void OnSearch(object sender, RoutedEventArgs args) { SetSection("chat"); _playgroundPage?.ToggleConversations(true); }
    private async void OnGitHub(object sender, RoutedEventArgs args) =>
        await Windows.System.Launcher.LaunchUriAsync(new Uri("https://github.com/DarkShadow1107/filspresso_next"));

    private void ShowError(Exception error)
    {
        EntitlementBar.Message = error is System.Net.Http.HttpRequestException
            ? "Could not reach Filspresso. Check your connection and refresh."
            : "Account state could not be loaded. Try refreshing or signing in again.";
        EntitlementBar.IsOpen = true;
    }
}
