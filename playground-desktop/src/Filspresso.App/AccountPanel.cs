using System;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Filspresso.App;

/// <summary>
/// What the account is entitled to and can afford, in one place.
/// </summary>
/// <remarks>
/// Every number on this panel comes from one <c>/api/desktop/entitlement</c> response. They are
/// not computed here, because the one thing this panel must never do is disagree with what the
/// gateway will actually charge — a client-side "you have 5 RON left" that disagrees with the
/// server is worse than no number at all.
/// </remarks>
public sealed partial class AccountPanel : UserControl
{
    private readonly AppServices _services;

    public AccountPanel(AppServices services)
    {
        InitializeComponent();
        _services = services;
    }

    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        var result = await _services.LoadEntitlementAsync(cancellationToken);
        if (!result.Ok || result.Value is null)
        {
            ShowUnavailable(result.Error);
            return;
        }

        Show(result.Value);
    }

    private void Show(Entitlement entitlement)
    {
        AccessPanel.Visibility = Visibility.Visible;
        UnavailablePanel.Visibility = Visibility.Collapsed;
        UnavailablePanel.IsOpen = false;

        TierValue.Text = entitlement.Tier.ToUpperInvariant();

        // Access is stated in the user's terms -- "your Max plan includes it", "your Spectre
        // subscription runs until the 18th" -- because "source: tier" is an implementation
        // detail and the expiry is the part they can act on.
        (AccessValue.Text, AccessDetail.Text) = entitlement switch
        {
            { HasAccess: true, Access.Source: "tier" } =>
                ("Included with your plan", "Nothing further to buy."),
            { HasAccess: true, Access.Source: "addon", Access.ExpiresAt: var expiry } =>
                ("Spectre subscription", $"Runs until {expiry:dd MMM yyyy}."),
            { HasAccess: true } => ("Spectre subscription", string.Empty),
            _ => ("No Playground access",
                  $"The Spectre subscription is {Ron(entitlement.Subscription.MonthlyRon)} a month, " +
                  $"or {Ron(entitlement.Subscription.AnnualRon)} a year."),
        };

        AllowRemainingValue.Text = Ron(entitlement.Allowance.RemainingRon);
        AllowResetValue.Text = entitlement.Allowance.ResetAt is { } reset
            ? $"of {Ron(entitlement.Allowance.GrantedRon)}, resets {reset:dd MMM}"
            : $"of {Ron(entitlement.Allowance.GrantedRon)}";

        WalletValue.Text = Ron(entitlement.Wallet.BalanceRon);
        WalletDetail.Text = entitlement.Wallet.MinBalanceIsCustom
            ? $"Floor {Ron(entitlement.Wallet.MinBalanceRon)}"
            : "Stops at your default floor";

        // The status line is the honest summary: a locked account with money still cannot send
        // anything, and saying so is more useful than showing a balance that does nothing.
        StatusValue.Text = entitlement switch
        {
            { HasAccess: false } => "No access — the Playground is locked.",
            { CanGenerate: true, TierGrantsAccess: true } => "Ready. Your plan allowance covers usage.",
            { CanGenerate: true } => "Ready. Messages are billed to your wallet.",
            _ => "Out of credit. Top up your wallet or wait for the allowance to reset.",
        };

        RefreshButton.IsEnabled = true;
    }

    private void ShowUnavailable(ApiError error)
    {
        AccessPanel.Visibility = Visibility.Collapsed;
        UnavailablePanel.Visibility = Visibility.Visible;
        UnavailablePanel.IsOpen = true;
        RefreshButton.IsEnabled = true;

        UnavailablePanel.Message = error switch
        {
            ApiError.Unauthenticated => "Your session ended. Sign in again.",
            ApiError.BillingUnavailable => "Filspresso could not check your balance. Try again shortly.",
            ApiError.Upstream => "The account service could not be reached.",
            _ => "Your account state could not be read.",
        };
    }

    /// <summary>RON to two decimals, in the locale the rest of the product uses.</summary>
    private static string Ron(decimal amount) =>
        $"{amount.ToString("N2", CultureInfo.InvariantCulture)} RON";

    private async void OnRefresh(object sender, RoutedEventArgs e)
    {
        RefreshButton.IsEnabled = false;
        await RefreshAsync();
    }

    /// <summary>Raised rather than acted on.</summary>
    /// <remarks>
    /// The panel does not own the session -- the window does, and the window is what decides
    /// what a signed-out shell looks like. An event keeps that decision in one place instead of
    /// letting a child rebuild the navigation around itself.
    /// </remarks>
    public event EventHandler? SignOutRequested;

    private void OnSignOutRequested(object sender, RoutedEventArgs e) =>
        SignOutRequested?.Invoke(this, EventArgs.Empty);
}