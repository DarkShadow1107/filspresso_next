using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Session;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.ApplicationModel.DataTransfer;
using Windows.System;
using Windows.UI.Core;

namespace Filspresso.App;

public sealed partial class PlaygroundPage : UserControl, IDisposable
{
    private readonly AppServices _services;
    private readonly PlaygroundSession _session;
    private readonly ObservableCollection<TranscriptLine> _transcript = new();
    private readonly List<Conversation> _conversations = new();
    private CancellationTokenSource? _inFlight;
    private string _conversationId = Guid.NewGuid().ToString();
    private bool _rendering;
    private bool _refreshing;
    private bool _disposed;
    private int? _editingFrom;
    private bool _thinking;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true, WriteIndented = true };

    public event RoutedEventHandler? SettingsRequested;

    public PlaygroundPage(AppServices services, PlaygroundSession session)
    {
        _services = services;
        _session = session;
        InitializeComponent();
        Transcript.ItemsSource = _transcript;
        _session.Changed += OnSessionChanged;
        _services.PreferencesChanged += OnPreferencesChanged;
        ApplyPreferences();
    }

    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_refreshing || _disposed) return;
        _refreshing = true;
        RefreshButton.IsEnabled = false;
        try { await _session.RefreshAsync(cancellationToken); Render(); }
        finally { _refreshing = false; RefreshButton.IsEnabled = true; }
    }

    public void ShowModelsOnly(bool modelsOnly)
    {
        ChatLayout.Visibility = modelsOnly ? Visibility.Collapsed : Visibility.Visible;
        PricesPanel.Visibility = modelsOnly ? Visibility.Visible : Visibility.Collapsed;
    }

    public void ToggleConversations(bool search)
    {
        ConversationsPane.Visibility = search || ConversationsPane.Visibility == Visibility.Collapsed ? Visibility.Visible : Visibility.Collapsed;
        RememberConversation();
        RenderConversations();
        if (search) ConversationSearch.Focus(FocusState.Programmatic);
    }

    public void NewConversation()
    {
        if (_inFlight is not null) return;
        RememberConversation();
        _conversationId = Guid.NewGuid().ToString();
        _transcript.Clear();
        PromptBox.Text = string.Empty;
        _editingFrom = null;
        EditingPanel.Visibility = Visibility.Collapsed;
        UpdateChatLayout();
        RenderConversations();
        PromptBox.Focus(FocusState.Programmatic);
    }

    private void OnSessionChanged(object? sender, EventArgs args) => DispatcherQueue.TryEnqueue(() => { if (!_disposed) Render(); });
    private void OnPreferencesChanged(object? sender, EventArgs args) { ApplyPreferences(); Render(); }

    private void ApplyPreferences()
    {
        var preferences = _services.Preferences;
        ContextButton.Content = $"{preferences.MaxTokens / 1024}K / 128K";
        _thinking = preferences.Thinking;
        ThinkingButton.IsChecked = _thinking;
        foreach (var line in _transcript) { line.TextSize = preferences.TextSize; line.ShowStatistics = preferences.ShowStatistics; }
        if (ModelBox.ItemsSource is not null)
            ModelBox.SelectedItem = _session.Catalogue.Models.FirstOrDefault(model => model.ModelKey == preferences.ModelKey && model.IsUsable)
                ?? _session.Catalogue.DefaultModel;
    }

    private void Render()
    {
        if (_disposed || StateBar is null) return;
        var selectedKey = (ModelBox.SelectedItem as ModelView)?.ModelKey ?? _services.Preferences.ModelKey;
        var catalogue = _session.Catalogue;
        _rendering = true;
        ModelBox.ItemsSource = catalogue.Usable.ToArray();
        ModelBox.SelectedItem = catalogue.Usable.FirstOrDefault(model => model.ModelKey == selectedKey) ?? catalogue.DefaultModel;
        CatalogueList.ItemsSource = catalogue.Models.Select(model => new CatalogueRow(
            model.Label,
            $"{model.InputPer1M:0.00} / {model.OutputPer1M:0.00} RON",
            !model.IsUsable ? "Locked" : !model.CanGenerate ? "Needs credit" : model.Availability == ModelAvailability.WalletOnly ? "Wallet only" : "Allowance, then wallet")).ToArray();
        _rendering = false;
        var entitlement = _session.Entitlement;
        BalanceHint.Text = entitlement is null ? "Direct model access · 128K context" :
            $"128K context · {entitlement.Tier.ToUpperInvariant()} plan · Allowance {entitlement.Allowance.RemainingRon:0.00} RON · Wallet {entitlement.Wallet.BalanceRon:0.00} RON";
        ThinkingButton.Visibility = entitlement?.Tier is "max" or "ultimate" ? Visibility.Visible : Visibility.Collapsed;
        RenderSelection();
        UpdateChatLayout();
    }

    private void RenderSelection()
    {
        if (StateBar is null || _rendering || _disposed) return;
        var selected = ModelBox.SelectedItem as ModelView;
        var state = selected is null ? _session.Availability : _session.ForModel(selected.ModelKey);
        PriceHint.Text = selected is null ? string.Empty :
            $"{selected.InputPer1M:0.00} input / {selected.OutputPer1M:0.00} output RON per 1M tokens · " +
            (selected.Availability == ModelAvailability.WalletOnly ? "Paid from your wallet" : "Allowance first, then wallet");

        (StateBar.Title, StateBar.Message, StateBar.Severity) = state switch
        {
            PlaygroundAvailability.Ready => ("Ready", string.Empty, InfoBarSeverity.Success),
            PlaygroundAvailability.NoAccess => ("Playground locked", "Your Spectre subscription or bundled plan is not active. Manage your subscription, then refresh.", InfoBarSeverity.Warning),
            PlaygroundAvailability.OutOfFunds => ("Credit needed", selected?.Availability == ModelAvailability.WalletOnly ? "This model needs a funded wallet; your plan allowance cannot pay for it." : "Your allowance and usable wallet credit are spent. Top up or wait for the allowance to reset.", InfoBarSeverity.Warning),
            PlaygroundAvailability.BillingUnavailable => ("Cannot check your balance", "Billing is unavailable. Try refreshing shortly.", InfoBarSeverity.Error),
            PlaygroundAvailability.SignedOut => ("Session ended", "Use Account to sign in again.", InfoBarSeverity.Warning),
            PlaygroundAvailability.RateLimited => ("Please wait", "Too many requests. Wait a moment, then refresh.", InfoBarSeverity.Warning),
            PlaygroundAvailability.ModelBusy => ("Model is loading", "The model is being loaded. Refresh and send again in a moment.", InfoBarSeverity.Informational),
            PlaygroundAvailability.ModelUnavailable => ("Response unavailable", "The model did not finish its response. Refresh before trying again.", InfoBarSeverity.Error),
            PlaygroundAvailability.Unreachable => ("Cannot reach Filspresso", "Check your connection, then refresh the account state.", InfoBarSeverity.Error),
            _ => ("Checking account…", string.Empty, InfoBarSeverity.Informational),
        };
        StateBar.IsOpen = state != PlaygroundAvailability.Ready;
        var sending = _inFlight is not null;
        SendButton.IsEnabled = !sending && state.AllowsSending() && !string.IsNullOrWhiteSpace(PromptBox.Text);
        SendButton.Visibility = sending ? Visibility.Collapsed : Visibility.Visible;
        CancelButton.Visibility = sending ? Visibility.Visible : Visibility.Collapsed;
        ModelBox.IsEnabled = ThinkingButton.IsEnabled = !sending;
        PromptBox.IsReadOnly = sending;
    }

    private void UpdateChatLayout()
    {
        var empty = _transcript.Count == 0;
        WelcomePanel.Visibility = empty ? Visibility.Visible : Visibility.Collapsed;
        Transcript.Visibility = empty ? Visibility.Collapsed : Visibility.Visible;
        ChatLayout.VerticalAlignment = empty ? VerticalAlignment.Center : VerticalAlignment.Stretch;
    }

    private void OnModelChanged(object sender, SelectionChangedEventArgs args) => RenderSelection();
    private void OnPromptChanged(object sender, TextChangedEventArgs args) => RenderSelection();
    private async void OnRefresh(object sender, RoutedEventArgs args) => await RefreshAsync();
    private async void OnManageAccount(object sender, RoutedEventArgs args) => await Launcher.LaunchUriAsync(
        _session.Availability == PlaygroundAvailability.NoAccess ? _services.SubscriptionUrl : _services.AccountUrl);
    private void OnStop(object sender, RoutedEventArgs args) => _inFlight?.Cancel();
    private async void OnSend(object sender, RoutedEventArgs args) => await SendAsync();
    private void OnSettings(object sender, RoutedEventArgs args) => SettingsRequested?.Invoke(this, args);
    private void OnThinkingChanged(object sender, RoutedEventArgs args) => _thinking = ThinkingButton.IsChecked == true;
    private void OnNewConversation(object sender, RoutedEventArgs args) => NewConversation();
    private void OnCancelEdit(object sender, RoutedEventArgs args) { _editingFrom = null; PromptBox.Text = string.Empty; EditingPanel.Visibility = Visibility.Collapsed; }

    private async void OnPromptKeyDown(object sender, KeyRoutedEventArgs args)
    {
        if (args.Key != VirtualKey.Enter) return;
        var shift = (Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Shift) & CoreVirtualKeyStates.Down) != 0;
        var control = (Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Control) & CoreVirtualKeyStates.Down) != 0;
        if (control || (_services.Preferences.EnterToSend && !shift)) { args.Handled = true; await SendAsync(); }
    }

    private async Task SendAsync(string? replacementPrompt = null, int? replaceFrom = null)
    {
        if (_inFlight is not null || ModelBox.SelectedItem is not ModelView selected ||
            !_session.ForModel(selected.ModelKey).AllowsSending()) return;
        var prompt = (replacementPrompt ?? PromptBox.Text).Trim();
        if (prompt.Length == 0) return;
        using var cancellation = new CancellationTokenSource();
        _inFlight = cancellation;
        var replace = replaceFrom ?? _editingFrom;
        if (replace is { } index) while (_transcript.Count > index) _transcript.RemoveAt(_transcript.Count - 1);
        _editingFrom = null;
        EditingPanel.Visibility = Visibility.Collapsed;
        _transcript.Add(CreateLine(true, "You", prompt));
        var answer = CreateLine(false, selected.Label, "Generating…");
        answer.IsComplete = false;
        _transcript.Add(answer);
        PromptBox.Text = string.Empty;
        UpdateChatLayout();
        RenderSelection();
        var watch = Stopwatch.StartNew();
        var firstText = true;
        try
        {
            await foreach (var update in _session.SendAsync(prompt, selected.ModelKey,
                maxTokens: _services.Preferences.MaxTokens,
                thinking: _thinking && _services.Entitlement?.Tier is "max" or "ultimate",
                cancellationToken: cancellation.Token))
            {
                switch (update)
                {
                    case PlaygroundEvent.Say say:
                        if (firstText) { answer.Text = string.Empty; firstText = false; }
                        answer.Text += say.Text;
                        break;
                    case PlaygroundEvent.Think think:
                        answer.Reasoning += think.Text;
                        break;
                    case PlaygroundEvent.Finished done:
                        answer.Metadata = done.Usage.EstimatedCostRon is { } cost
                            ? $"{done.Usage.InputTokens + done.Usage.OutputTokens:N0} tokens · {watch.Elapsed.TotalSeconds:0.0} s · about {cost:0.000000} RON"
                            : $"{watch.Elapsed.TotalSeconds:0.0} s · usage unavailable";
                        if (firstText) answer.Text = "The model returned no answer. Try again or adjust Thinking mode.";
                        break;
                    case PlaygroundEvent.Stopped stopped:
                        if (firstText) answer.Text = "The response could not start. Check the account status above, then retry.";
                        answer.Metadata = stopped.Availability.ToString();
                        break;
                }
                Transcript.ScrollIntoView(answer);
            }
        }
        catch (OperationCanceledException) { if (firstText) answer.Text = "Generation stopped."; answer.Metadata = "Stopped"; }
        catch (Exception error) when (error is System.Net.Http.HttpRequestException or IOException or InvalidOperationException)
        {
            if (firstText) answer.Text = "The response was interrupted. Check your connection and try again.";
            answer.Metadata = "Response interrupted";
        }
        finally
        {
            answer.IsComplete = true;
            _inFlight = null;
            if (!_disposed) { RememberConversation(); Render(); }
        }
    }

    private TranscriptLine CreateLine(bool isUser, string role, string text) => new(isUser, role, text)
    { TextSize = _services.Preferences.TextSize, ShowStatistics = _services.Preferences.ShowStatistics };

    private void OnCopyMessage(object sender, RoutedEventArgs args)
    {
        if ((sender as Button)?.Tag is not TranscriptLine line) return;
        var data = new DataPackage(); data.SetText(line.Text); Clipboard.SetContent(data);
    }
    private void OnEditMessage(object sender, RoutedEventArgs args)
    {
        if (_inFlight is not null || (sender as Button)?.Tag is not TranscriptLine line) return;
        _editingFrom = _transcript.IndexOf(line); PromptBox.Text = line.Text;
        EditingPanel.Visibility = Visibility.Visible; PromptBox.Focus(FocusState.Programmatic);
    }
    private async void OnRegenerate(object sender, RoutedEventArgs args)
    {
        if (_inFlight is not null || (sender as Button)?.Tag is not TranscriptLine line) return;
        var index = _transcript.IndexOf(line);
        if (index > 0 && _transcript[index - 1].IsUser) await SendAsync(_transcript[index - 1].Text, index - 1);
    }
    private void OnDeleteMessage(object sender, RoutedEventArgs args)
    {
        if (_inFlight is null && (sender as Button)?.Tag is TranscriptLine line)
        { _transcript.Remove(line); _editingFrom = null; EditingPanel.Visibility = Visibility.Collapsed; UpdateChatLayout(); }
    }

    private void RememberConversation()
    {
        if (_transcript.Count == 0) return;
        _conversations.RemoveAll(chat => chat.Id == _conversationId);
        var title = _transcript.FirstOrDefault(line => line.IsUser)?.Text ?? "Conversation";
        _conversations.Insert(0, new(_conversationId, title[..Math.Min(54, title.Length)], _transcript.ToArray()));
        if (_conversations.Count > 30) _conversations.RemoveAt(_conversations.Count - 1);
    }
    private void RenderConversations()
    {
        _rendering = true;
        ConversationsList.ItemsSource = _conversations.Where(chat =>
            chat.Title.Contains(ConversationSearch.Text, StringComparison.OrdinalIgnoreCase) ||
            chat.Messages.Any(line => line.Text.Contains(ConversationSearch.Text, StringComparison.OrdinalIgnoreCase))).ToArray();
        _rendering = false;
    }
    private void OnSearchChanged(object sender, TextChangedEventArgs args) { if (ConversationsList is not null) RenderConversations(); }
    private void OnConversationSelected(object sender, SelectionChangedEventArgs args)
    {
        if (_rendering || _inFlight is not null || ConversationsList.SelectedItem is not Conversation chat) return;
        RememberConversation(); _conversationId = chat.Id; _transcript.Clear();
        foreach (var line in chat.Messages) _transcript.Add(line);
        PromptBox.Text = string.Empty; _editingFrom = null; EditingPanel.Visibility = Visibility.Collapsed;
        UpdateChatLayout();
    }

    public async Task ExportConversationAsync()
    {
        if (_inFlight is not null || _transcript.Count == 0) return;
        var picker = new Windows.Storage.Pickers.FileSavePicker { SuggestedFileName = "filspresso-conversation" };
        picker.FileTypeChoices.Add("Playground conversation", new List<string> { ".json" });
        WinRT.Interop.InitializeWithWindow.Initialize(picker, _services.WindowHandle);
        var file = await picker.PickSaveFileAsync();
        if (file is null) return;
        var messages = _transcript.Select(line => new ExportedMessage(line.IsUser ? "user" : "assistant", line.Text, line.Role, line.Reasoning)).ToArray();
        await Windows.Storage.FileIO.WriteTextAsync(file, JsonSerializer.Serialize(new ConversationDocument(1, messages), JsonOptions));
    }
    public async Task ImportConversationAsync()
    {
        if (_inFlight is not null) return;
        var picker = new Windows.Storage.Pickers.FileOpenPicker(); picker.FileTypeFilter.Add(".json");
        WinRT.Interop.InitializeWithWindow.Initialize(picker, _services.WindowHandle);
        var file = await picker.PickSingleFileAsync();
        if (file is null) return;
        try
        {
            if ((await file.GetBasicPropertiesAsync()).Size > 2 * 1024 * 1024) throw new InvalidDataException();
            var document = JsonSerializer.Deserialize<ConversationDocument>(await Windows.Storage.FileIO.ReadTextAsync(file), JsonOptions);
            if (document?.Messages is not { Length: > 0 and <= 200 } messages ||
                messages.Any(message => message.Role is not ("user" or "assistant") || message.Content is null)) throw new InvalidDataException();
            RememberConversation(); _transcript.Clear(); _conversationId = Guid.NewGuid().ToString();
            foreach (var message in messages)
            {
                var line = CreateLine(message.Role == "user", message.Role == "user" ? "You" : message.Model ?? "Model", message.Content);
                line.Reasoning = message.Reasoning ?? string.Empty; _transcript.Add(line);
            }
            ShowModelsOnly(false); UpdateChatLayout(); RememberConversation();
        }
        catch (Exception error) when (error is JsonException or InvalidDataException)
        { StateBar.Title = "Could not import conversation"; StateBar.Message = "Choose a Playground JSON export with 1–200 messages, smaller than 2 MB."; StateBar.IsOpen = true; StateBar.Severity = InfoBarSeverity.Warning; }
    }
    private async void OnExportConversation(object sender, RoutedEventArgs args) => await ExportConversationAsync();
    private async void OnImportConversation(object sender, RoutedEventArgs args) => await ImportConversationAsync();

    public void Dispose()
    {
        _disposed = true; _inFlight?.Cancel(); _session.Changed -= OnSessionChanged;
        _services.PreferencesChanged -= OnPreferencesChanged;
    }

    public sealed record CatalogueRow(string Label, string Price, string State);
    public sealed record Conversation(string Id, string Title, TranscriptLine[] Messages);
    public sealed record ExportedMessage(string Role, string Content, string? Model, string? Reasoning);
    public sealed record ConversationDocument(int Version, ExportedMessage[] Messages);

    public sealed class TranscriptLine(bool isUser, string role, string text) : INotifyPropertyChanged
    {
        private string _text = text;
        private string _reasoning = string.Empty;
        private string _metadata = string.Empty;
        private bool _complete = true;
        private bool _showStatistics = true;
        private int _textSize = 15;
        public bool IsUser { get; } = isUser;
        public string Role { get; } = role;
        public string Text { get => _text; set { _text = value; Changed(nameof(Text)); } }
        public string Reasoning { get => _reasoning; set { _reasoning = value; Changed(nameof(Reasoning)); Changed(nameof(ReasoningVisibility)); } }
        public string Metadata { get => _metadata; set { _metadata = value; Changed(nameof(Metadata)); } }
        public bool IsComplete { get => _complete; set { _complete = value; Changed(nameof(ActionsVisibility)); Changed(nameof(MetadataVisibility)); } }
        public bool ShowStatistics { get => _showStatistics; set { _showStatistics = value; Changed(nameof(MetadataVisibility)); } }
        public int TextSize { get => _textSize; set { _textSize = value; Changed(nameof(TextSize)); } }
        public HorizontalAlignment BubbleAlignment => IsUser ? HorizontalAlignment.Right : HorizontalAlignment.Stretch;
        public Brush BubbleBrush => IsUser ? (Brush)Application.Current.Resources["FilspressoSurface"] : new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        public Visibility ReasoningVisibility => string.IsNullOrEmpty(Reasoning) ? Visibility.Collapsed : Visibility.Visible;
        public Visibility MetadataVisibility => !IsUser && IsComplete && ShowStatistics ? Visibility.Visible : Visibility.Collapsed;
        public Visibility ActionsVisibility => IsComplete ? Visibility.Visible : Visibility.Collapsed;
        public Visibility EditVisibility => IsUser ? Visibility.Visible : Visibility.Collapsed;
        public Visibility RegenerateVisibility => IsUser ? Visibility.Collapsed : Visibility.Visible;
        public event PropertyChangedEventHandler? PropertyChanged;
        private void Changed(string property) => PropertyChanged?.Invoke(this, new(property));
    }
}
