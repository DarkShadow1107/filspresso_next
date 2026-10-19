using System;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Filspresso.Core.Auth;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Filspresso.App;

/// <summary>
/// The sign-in and connect screen.
/// </summary>
/// <remarks>
/// One screen with two states rather than two screens, because the transition between them is
/// where a user gets stranded: a second dialog for the authenticator code is a place to lose
/// the half-typed email, and on a machine where the code expires in five minutes that matters.
/// <para>
/// It also carries the honest refusals. A Home machine never gets here -- the installer
/// refuses it -- and an account with no Spectre access is told so and pointed at the
/// subscription, rather than being signed in successfully to a product it cannot use.
/// </para>
/// </remarks>
public sealed partial class LoginPage : UserControl
{
    private readonly AuthSessionManager _auth;
    private readonly Func<Task<ApiResult<Entitlement>>> _loadEntitlement;
    private readonly Action _onSignedIn;

    private string _email = string.Empty;
    public LoginPage(
        AuthSessionManager auth,
        Func<Task<ApiResult<Entitlement>>> loadEntitlement,
        Action onSignedIn)
    {
        InitializeComponent();

        _auth = auth;
        _loadEntitlement = loadEntitlement;
        _onSignedIn = onSignedIn;
    }

    private async void OnSubmit(object sender, RoutedEventArgs e)
    {
        SubmitButton.IsEnabled = false;
        SetError(null);
        ShowBusy(true);

        try
        {
            // The same button serves both states, so the code that was typed into the password
            // box has to be carried across rather than asked for twice.
            _email = EmailBox.Text.Trim();

            // Which stage this is depends on the manager holding a challenge, not on a field
            // in the screen. One source of truth for a value with a five-minute life.
            SignInOutcome outcome = _auth.PendingMfaChallenge is null
                ? await _auth.SignInAsync(_email, PasswordBox.Password)
                : await _auth.CompleteMfaAsync(_email, PasswordBox.Password, _auth.PendingMfaChallenge, CodeBox.Text.Trim());

            switch (outcome)
            {
                case SignInOutcome.NeedsMfa:
                    EnterMfaStage();
                    return;

                case SignInOutcome.Success:
                    await OnSignedInAsync();
                    return;

                case SignInOutcome.RateLimited:
                    SetError("Too many attempts. Wait a few minutes and try again.");
                    return;

                case SignInOutcome.Unreachable:
                    SetError("Could not reach Filspresso. Check your connection and try again.");
                    return;

                default:
                    SetError(_auth.LastError ?? "That email and password do not match an account.");
                    PasswordBox.Password = string.Empty;
                    return;
            }
        }
        finally
        {
            SubmitButton.IsEnabled = true;
            ShowBusy(false);
        }
    }

    private void EnterMfaStage()
    {
        PasswordPanel.Visibility = Visibility.Collapsed;
        MfaPanel.Visibility = Visibility.Visible;
        SubmitButton.Content = "Verify";
        Header.Text = "Two-factor authentication";
        Subheader.Text = "Enter the six-digit code from your authenticator app.";

        // Focus moves to the code field, because the keyboard user has just finished typing a
        // password and should not have to hunt for the next box.
        CodeBox.Focus(FocusState.Programmatic);
    }

    private async Task OnSignedInAsync()
    {
        // Connecting to the account is part of signing in, not a separate success. If the
        // account has no Playground access, saying "signed in" and then showing a locked app is
        // the least useful outcome available.
        var entitlement = await _loadEntitlement();

        if (!entitlement.Ok || entitlement.Value is null)
        {
            SetError(entitlement.Error switch
            {
                ApiError.Locked => "This account does not have the Spectre Playground yet. " +
                                  "Subscribe from your Filspresso account page, then sign in again.",
                ApiError.OutOfFunds => "Signed in, but the account has no allowance or wallet balance. " +
                                      "Top up your wallet to send messages.",
                ApiError.BillingUnavailable => "Signed in, but Filspresso could not check your balance. " +
                                              "Try again in a moment.",
                ApiError.Unauthenticated => "The session was not accepted. Please sign in again.",
                _ => "Signed in, but the account state could not be read.",
            });

            // Not signed out: the credential is valid, there is simply nothing it can use yet.
            // Throwing the user out would lose the token they just proved.
            return;
        }

        _onSignedIn();
    }

    /// <summary>Disables the button until there is something to submit.</summary>
    private void OnEmailChanged(object sender, TextChangedEventArgs e) => UpdateSubmitEnabled();

    private void OnCodeChanged(object sender, TextChangedEventArgs e) => UpdateSubmitEnabled();

    private void UpdateSubmitEnabled()
    {
        var ready = _auth.PendingMfaChallenge is null
            ? EmailBox.Text.Trim().Length > 0 && PasswordBox.Password.Length > 0
            : CodeBox.Text.Trim().Length > 0;

        SubmitButton.IsEnabled = ready && !BusyRing.IsActive;
    }

    private void SetError(string? message)
    {
        ErrorBar.Message = message ?? string.Empty;
        ErrorBar.IsOpen = !string.IsNullOrEmpty(message);
        // Errors are announced, not only coloured: a screen reader user cannot see a red box.
        if (!string.IsNullOrEmpty(message))
        {
            ErrorBar.Focus(FocusState.Programmatic);
        }
    }

    private void ShowBusy(bool busy)
    {
        BusyRing.IsActive = busy;
        BusyRing.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        SubmitButton.Content = busy ? "Working…" : (_auth.PendingMfaChallenge is null ? "Sign in" : "Verify");
    }
}