using System;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Core.Auth;
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

    public MainWindow()
    {
        InitializeComponent();
        _services = new AppServices(new Uri("http://localhost:4000"));
        ShowSignedOut();
    }

    private async void OnLoaded(object sender, RoutedEventArgs e) => await ConnectAsync();

    /// <summary>
    /// Restore a stored session, or show the sign-in screen.
    /// </summary>
    /// <remarks>
    /// A stored session is only a candidate, never an answer. It is verified against the server
    /// before the shell opens, because a session restored from disk may have been revoked, may
    /// have been killed by the reuse detection, or may have simply expired while the app was
    /// closed.
    /// </remarks>
    private async Task ConnectAsync()
    {
        await _services.Auth.RestoreAsync();

        if (_services.Auth.IsSignedIn)
        {
            var restored = await _services.LoadEntitlementAsync();
            if (restored.Ok)
            {
                ShowSignedIn();
                return;
            }
        }

        ShowSignedOut();
    }

    private void ShowSignedIn()
    {
        if (_accountPanel is null)
        {
            _accountPanel = new AccountPanel(_services);
            _accountPanel.SignOutRequested += async (_, _) =>
            {
                await _services.Auth.SignOutAsync();
                ShowSignedOut();
            };
        }

        ContentFrame.Content = _accountPanel;
        Nav.Visibility = Visibility.Visible;
        Subtitle.Text = _services.Auth.Current?.Email ?? string.Empty;
        AccountButton.Content = "Account";

        _ = _accountPanel.RefreshAsync();
    }

    private void ShowSignedOut()
    {
        Nav.Visibility = Visibility.Collapsed;
        Subtitle.Text = "Not signed in";
        AccountButton.Content = "Sign in";

        ContentFrame.Content = new LoginPage(
            _services.Auth,
            () => _services.LoadEntitlementAsync(),
            ShowSignedIn);
    }

    private async void OnAccountClick(object sender, RoutedEventArgs e)
    {
        if (_services.Auth.IsSignedIn)
        {
            ShowSignedIn();
            return;
        }

        ShowSignedOut();
        await Task.CompletedTask;
    }

    private async void OnSignOutRequested(object sender, RoutedEventArgs e)
    {
        // Local only. The session stays valid on the server until it expires or is revoked
        // from the account page -- which is the right behaviour, because signing out of a
        // desktop app is a local act and a user on a shared machine should not be able to
        // revoke a session they do not own by signing out of someone else's.
        await _services.Auth.SignOutAsync();
        ShowSignedOut();
    }
}