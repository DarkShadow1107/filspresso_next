using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Session;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;

namespace Filspresso.App;

/// <summary>
/// The Playground itself: pick a model, ask a question, read the answer.
/// </summary>
/// <remarks>
/// The page has one job beyond showing a conversation, and it is to keep the <em>state</em>
/// honest. A metered product that does not say what things cost, or what state it is in, is
/// asking the user to guess. So the page always shows: which model is selected, what it
/// costs, what the account's state is, and what the last message came to.
/// </remarks>
public sealed partial class PlaygroundPage : UserControl, IDisposable
{
    private readonly AppServices _services;
    private readonly PlaygroundSession _session;
    private readonly ObservableCollection<TranscriptLine> _transcript = new();
    private CancellationTokenSource? _inFlight;
    private bool _rendering;
    private bool _refreshing;
    private bool _disposed;

    public PlaygroundPage(AppServices services, PlaygroundSession session)
    {
        _services = services;
        _session = session;
        InitializeComponent();
        Transcript.ItemsSource = _transcript;
        _session.Changed += OnSessionChanged;
    }

    /// <summary>Re-reads the account state and re-renders.</summary>
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_refreshing || _disposed)
        {
            return;
        }

        _refreshing = true;
        RefreshButton.IsEnabled = false;
        try
        {
            await _session.RefreshAsync(cancellationToken);
            Render();
        }
        finally
        {
            _refreshing = false;
            RefreshButton.IsEnabled = true;
        }
    }

    /// <summary>Shows the catalogue on its own, without the conversation.</summary>
    public void ShowModelsOnly(bool modelsOnly)
    {
        Transcript.Visibility = PromptPanel.Visibility = modelsOnly ? Visibility.Collapsed : Visibility.Visible;
        CatalogueList.MaxHeight = modelsOnly ? 520 : 210;
    }

    private void OnSessionChanged(object? sender, EventArgs args) =>
        DispatcherQueue.TryEnqueue(() =>
        {
            if (!_disposed)
            {
                Render();
            }
        });

    private void Render()
    {
        if (_disposed || StateBar is null)
        {
            return;
        }

        var selectedKey = (ModelBox.SelectedItem as ModelView)?.ModelKey;
        var catalogue = _session.Catalogue;

        _rendering = true;
        ModelBox.ItemsSource = catalogue.Usable.ToArray();
        ModelBox.DisplayMemberPath = nameof(ModelView.Label);
        ModelBox.SelectedItem = catalogue.Models.FirstOrDefault(m => m.ModelKey == selectedKey && m.IsUsable)
            ?? catalogue.DefaultModel;
        CatalogueList.ItemsSource = catalogue.Models.Select(m => new CatalogueRow(
            m.Label,
            $"{m.InputPer1M.ToString("0.00", CultureInfo.InvariantCulture)} / {m.OutputPer1M.ToString("0.00", CultureInfo.InvariantCulture)}",
            !m.IsUsable || _session.Availability == PlaygroundAvailability.NoAccess
                ? "Locked"
                : !m.CanGenerate
                    ? "Needs credit"
                    : m.Availability == ModelAvailability.WalletOnly
                        ? "Wallet only"
                        : "Allowance, then wallet")).ToArray();
        _rendering = false;

        var entitlement = _session.Entitlement;
        BalanceHint.Text = entitlement is null
            ? string.Empty
            : $"Allowance: {entitlement.Allowance.RemainingRon.ToString("0.00", CultureInfo.InvariantCulture)} RON · " +
              $"Wallet: {entitlement.Wallet.BalanceRon.ToString("0.00", CultureInfo.InvariantCulture)} RON";

        RenderSelection();
    }

    private void RenderSelection()
    {
        if (StateBar is null || _rendering || _disposed)
        {
            return;
        }

        var selected = ModelBox.SelectedItem as ModelView;
        var state = selected is null ? _session.Availability : _session.ForModel(selected.ModelKey);

        PriceHint.Text = selected is null
            ? string.Empty
            : $"{selected.Label}: {selected.InputPer1M.ToString("0.00", CultureInfo.InvariantCulture)} input / " +
              $"{selected.OutputPer1M.ToString("0.00", CultureInfo.InvariantCulture)} output RON per 1M tokens. " +
              (selected.Availability == ModelAvailability.WalletOnly
                  ? "Paid from your wallet."
                  : "Allowance first, then wallet.");

        var (title, message, severity) = state switch
        {
            PlaygroundAvailability.Ready => (
                "Ready",
                "Usage is metered at the API prices shown below.",
                InfoBarSeverity.Success),
            PlaygroundAvailability.NoAccess => (
                "Playground locked",
                "Your Spectre subscription or bundled plan is not active. Manage your subscription, then refresh.",
                InfoBarSeverity.Warning),
            PlaygroundAvailability.OutOfFunds => (
                "Credit needed",
                selected?.Availability == ModelAvailability.WalletOnly
                    ? "This model needs a funded wallet; the plan allowance cannot pay for it."
                    : "The allowance and the usable wallet credit are spent. Top up, or wait for the allowance to reset.",
                InfoBarSeverity.Warning),
            PlaygroundAvailability.BillingUnavailable => (
                "Cannot check your balance",
                "Billing is unavailable. Please refresh shortly; topping up is not the remedy.",
                InfoBarSeverity.Error),
            PlaygroundAvailability.SignedOut => (
                "Session ended",
                "Use Account to sign in again.",
                InfoBarSeverity.Warning),
            PlaygroundAvailability.RateLimited => (
                "Please wait",
                "Too many requests. Wait a moment, then refresh.",
                InfoBarSeverity.Warning),
            PlaygroundAvailability.ModelBusy => (
                "Model is loading",
                "The model is being loaded. Send your message again in a moment.",
                InfoBarSeverity.Warning),
            PlaygroundAvailability.ModelUnavailable => (
                "Model response unavailable",
                "The model did not complete its response. Refresh before trying again.",
                InfoBarSeverity.Error),
            PlaygroundAvailability.Unreachable => (
                "Cannot reach Filspresso",
                "Check your connection, then refresh the account state.",
                InfoBarSeverity.Error),
            _ => ("Checking account…", string.Empty, InfoBarSeverity.Informational),
        };

        StateBar.Title = title;
        StateBar.Message = message;
        StateBar.Severity = severity;
        StateBar.IsOpen = true;

        SendButton.IsEnabled = !_session.IsSending
            && _inFlight is null
            && state.AllowsSending()
            && !string.IsNullOrWhiteSpace(PromptBox.Text);
        CancelButton.IsEnabled = _inFlight is not null;
        ModelBox.IsEnabled = _inFlight is null;
    }

    private void OnModelChanged(object sender, SelectionChangedEventArgs args) => RenderSelection();

    private void OnPromptChanged(object sender, TextChangedEventArgs args) => RenderSelection();

    private async void OnRefresh(object sender, RoutedEventArgs args) => await RefreshAsync();

    private async void OnManageAccount(object sender, RoutedEventArgs args) =>
        await Windows.System.Launcher.LaunchUriAsync(
            _session.Availability == PlaygroundAvailability.NoAccess
                ? _services.SubscriptionUrl
                : _services.AccountUrl);

    private void OnStop(object sender, RoutedEventArgs args) => _inFlight?.Cancel();

    private async void OnSend(object sender, RoutedEventArgs args) => await SendAsync();

    private async void OnSendAccelerator(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args)
    {
        args.Handled = true;
        await SendAsync();
    }

    private async Task SendAsync()
    {
        if (_inFlight is not null
            || ModelBox.SelectedItem is not ModelView selected
            || !_session.ForModel(selected.ModelKey).AllowsSending()
            || string.IsNullOrWhiteSpace(PromptBox.Text))
        {
            return;
        }

        var prompt = PromptBox.Text;
        using var cts = new CancellationTokenSource();
        _inFlight = cts;

        _transcript.Add(new TranscriptLine("You", prompt));
        var answer = new TranscriptLine(selected.Label, string.Empty);
        _transcript.Add(answer);
        RenderSelection();

        var sentText = false;
        try
        {
            await foreach (var update in _session.SendAsync(prompt, selected.ModelKey, cancellationToken: cts.Token))
            {
                switch (update)
                {
                    case PlaygroundEvent.Say say:
                        if (!sentText)
                        {
                            PromptBox.Text = string.Empty;
                            sentText = true;
                        }

                        answer.Text += say.Text;
                        break;

                    case PlaygroundEvent.Finished done:
                        answer.Role = done.Usage.EstimatedCostRon is { } cost
                            ? $"{selected.Label} · {done.Usage.InputTokens + done.Usage.OutputTokens} tokens · " +
                              $"about {cost.ToString("0.000000", CultureInfo.InvariantCulture)} RON"
                            : $"{selected.Label} · usage unavailable";
                        break;

                    case PlaygroundEvent.Stopped:
                        answer.Role = $"{selected.Label} · response stopped";
                        break;
                }
            }
        }
        catch (OperationCanceledException)
        {
            answer.Role = $"{selected.Label} · stopped";
        }
        finally
        {
            _inFlight = null;
            if (!_disposed)
            {
                Render();
            }
        }
    }

    public void Dispose()
    {
        _disposed = true;
        _inFlight?.Cancel();
        _session.Changed -= OnSessionChanged;
    }

    /// <summary>One line of the catalogue, with the words the user needs.</summary>
    public sealed record CatalogueRow(string Label, string Price, string State);

    /// <summary>One line of the conversation.</summary>
    public sealed class TranscriptLine(string role, string text) : INotifyPropertyChanged
    {
        private string _role = role;
        private string _text = text;

        public string Role
        {
            get => _role;
            set
            {
                _role = value;
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Role)));
            }
        }

        public string Text
        {
            get => _text;
            set
            {
                _text = value;
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Text)));
            }
        }

        public event PropertyChangedEventHandler? PropertyChanged;
    }
}
