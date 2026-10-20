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
    private PlaygroundPage? _playgroundPage;
    private bool _loaded;
    private bool _refreshing;

    public MainWindow()
    {
        _services = new AppServices(new Uri(
            Environment.GetEnvironmentVariable("FILSPRESSO_BACKEND_URL") ?? "http://localhost:4000/"));
        InitializeComponent();
        Title = "Spectre Playground · Filspresso";
        AppWindow.Resize(new Windows.Graphics.SizeInt32(1280, 860));
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
        if (_accountPanel is null)
        {
            _accountPanel = new AccountPanel(_services);
            _accountPanel.SignOutRequested += async (_, _) =>
            {
                _playgroundPage?.Dispose();
                await _services.Auth.SignOutAsync();
                _playgroundPage = null;
                _accountPanel = null;
                ShowSignedOut();
            };
        }

        SignInHost.Children.Clear();
        SignInHost.Visibility = Visibility.Collapsed;
        Nav.Visibility = Visibility.Visible;
        Subtitle.Text = _services.Auth.Current?.Email ?? string.Empty;
        AccountButton.Content = "Account";
        ContentFrame.Content = _playgroundPage;
        Nav.SelectedItem = Nav.MenuItems[0];
        await _playgroundPage.RefreshAsync();
    }

    private void ShowSignedOut()
    {
        Nav.Visibility = Visibility.Collapsed;
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

    private async void OnNavigationChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (!_loaded || !_services.Auth.IsSignedIn || _playgroundPage is null)
        {
            return;
        }

        try
        {
            if (args.SelectedItem is NavigationViewItem { Tag: "account" })
            {
                ContentFrame.Content = _accountPanel;
                if (_accountPanel is not null)
                {
                    await _accountPanel.RefreshAsync();
                }
            }
            else
            {
                _playgroundPage.ShowModelsOnly(args.SelectedItem is NavigationViewItem { Tag: "models" });
                ContentFrame.Content = _playgroundPage;
            }
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
            if (ReferenceEquals(ContentFrame.Content, _accountPanel) && _accountPanel is not null)
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

    private void OnAccountClick(object sender, RoutedEventArgs args)
    {
        if (_services.Auth.IsSignedIn)
        {
            Nav.SelectedItem = Nav.MenuItems[2];
        }
        else
        {
            ShowSignedOut();
        }
    }

    private void ShowError(Exception error)
    {
        EntitlementBar.Message = error is System.Net.Http.HttpRequestException
            ? "Could not reach Filspresso. Check your connection and refresh."
            : "Account state could not be loaded. Try refreshing or signing in again.";
        EntitlementBar.IsOpen = true;
    }
}
