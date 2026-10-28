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
using Filspresso.Core.Api;
using Filspresso.Core.Storage;
using Filspresso.Harness;
using System.Text.RegularExpressions;
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
    private readonly ObservableCollection<AttachmentView> _sources = new();
    private CancellationTokenSource? _inFlight;
    private CancellationTokenSource? _resumeRequest;
    private string _conversationId = Guid.NewGuid().ToString();
    private bool _rendering;
    private bool _refreshing;
    private bool _disposed;
    private int? _editingFrom;
    private bool _thinking;
    private string _suggestionState = string.Empty;
    private bool _compactNext;
    // A compaction checkpoint: the original lines it replaced, the retained turns the next
    // request continues from, and the measurement event itself, which the server session
    // saves as the conversation's resume context.
    private readonly Dictionary<string, (TranscriptLine[] Original, ChatTurn[] Active, ContextState State)> _checkpoints = new();
    // Local conversation id -> server session uuid. In-memory like the web client: a lost
    // app session starts local conversations anew, and the server's own list is the only
    // durable resume surface.
    private readonly Dictionary<string, string> _sessionUuids = new();
    private readonly List<SavedSession> _serverSessions = new();
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true, WriteIndented = true };

    public event RoutedEventHandler? SettingsRequested;
    private AgentWorkspacePage? _agent;
    private bool AgentBusy => _agent?.IsBusy == true;
    private bool AgentMode => ChatModePicker.SelectedIndex > 0;
    public string? SavedSessionUuid => _sessionUuids.GetValueOrDefault(_conversationId);

    public PlaygroundPage(AppServices services, PlaygroundSession session)
    {
        _services = services;
        _session = session;
        InitializeComponent();
        Transcript.ItemsSource = _transcript;
        SourcesList.ItemsSource = _sources;
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
        _ = RefreshServerSessionsAsync();
    }

    public void NewConversation()
    {
        if (_inFlight is not null || AgentBusy) return;
        ResetAgent();
        CancelPendingResume();
        RememberConversation();
        _conversationId = Guid.NewGuid().ToString();
        _transcript.Clear();
        ClearSources();
        ResetContextDisplay();
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
        ContextButton.Content = $"{preferences.InputContextTokens / 1024}K";
        CompactionPicker.SelectedIndex = preferences.CompactionMode switch { "permissive" => 0, "aggressive" => 2, _ => 1 };
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
        var rows = catalogue.Models.Select(model => new CatalogueRow(
            model.Label,
            $"{model.InputPer1M:0.00} / {model.OutputPer1M:0.00} RON",
            !model.IsUsable ? "Locked" : !model.CanGenerate ? "Needs credit" : model.Availability == ModelAvailability.WalletOnly ? "Wallet only" : "Allowance, then wallet"));
        CatalogueList.ItemsSource = rows.ToArray();
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
            PlaygroundAvailability.InputContextExceeded => ("Input context exceeded", "Choose a larger input context, remove sources, or start a new conversation, then retry.", InfoBarSeverity.Warning),
            _ => ("Checking account…", string.Empty, InfoBarSeverity.Informational),
        };
        StateBar.IsOpen = state != PlaygroundAvailability.Ready;
        var sending = _inFlight is not null || AgentBusy;
        CompactButton.IsEnabled = !sending && _transcript.Count > 1;
        SendButton.IsEnabled = !sending && state.AllowsSending() && _sources.All(source => source.Context is not null)
            && (!AgentMode || _agent?.CanSend == true) && (!string.IsNullOrWhiteSpace(PromptBox.Text) || _sources.Count > 0);
        SendButton.Visibility = sending ? Visibility.Collapsed : Visibility.Visible;
        CancelButton.Visibility = sending ? Visibility.Visible : Visibility.Collapsed;
        ModelBox.IsEnabled = ThinkingButton.IsEnabled = CompactionPicker.IsEnabled = ChatModePicker.IsEnabled = !sending;
        ThinkingButton.IsEnabled = !sending && !AgentMode;
        ToolTipService.SetToolTip(ThinkingButton, AgentMode ? "Thinking · controlled by the agent model in Plan and Build" : _thinking ? "Thinking · on" : "Thinking · off");
        AttachButton.IsEnabled = GithubButton.IsEnabled = ContextButton.IsEnabled = !sending;
        PromptBox.IsReadOnly = sending;
        CompactButton.Visibility = AgentMode ? Visibility.Collapsed : Visibility.Visible;
        ModeGuidance.Text = !AgentMode ? "Chat · answers and attachments, no tools" : ChatModePicker.SelectedIndex == 1 ? "Plan · read and explore, no changes or commands" : "Build · staged changes, approval for each action";
        RenderSourceSuggestions(selected?.ModelKey, sending);
    }

    private void RenderSourceSuggestions(string? selected, bool sending)
    {
        var recommendations = AttachmentModels.Recommend(selected, _sources.Select(source => source.Name));
        var video = recommendations.Contains(DesktopPreferences.VisionModel);
        var audio = recommendations.Contains(DesktopPreferences.AudioModel);
        var state = $"{video}:{audio}:{sending}:{selected}";
        if (_suggestionState == state) return;
        _suggestionState = state;
        SuggestionsPanel.Children.Clear();
        if (video) AddSuggestion(DesktopPreferences.VisionModel, "A Vision-Language (VL) model is recommended for video.", sending);
        if (audio) AddSuggestion(DesktopPreferences.AudioModel, "An Audio model is recommended for this audio file.", sending);
    }

    private void AddSuggestion(string modelKey, string message, bool sending)
    {
        var model = _session.Catalogue.Usable.FirstOrDefault(item => item.ModelKey == modelKey);
        if (model is null) return;
        var panel = new StackPanel { Spacing = 6 };
        panel.Children.Add(new TextBlock { Text = message, FontSize = 11, TextWrapping = TextWrapping.Wrap, Foreground = (Brush)Application.Current.Resources["FilspressoMuted"] });
        var button = new Button { Content = $"Use {model.Label}", IsEnabled = !sending, Style = (Style)Application.Current.Resources["QuietButtonStyle"] };
        button.Click += (_, _) => ModelBox.SelectedItem = _session.Catalogue.Usable.FirstOrDefault(item => item.ModelKey == modelKey);
        panel.Children.Add(button);
        SuggestionsPanel.Children.Add(new Border { Child = panel, Padding = new Thickness(10), CornerRadius = new CornerRadius(8), BorderThickness = new Thickness(1), BorderBrush = (Brush)Application.Current.Resources["FilspressoBorder"] });
    }

    private void UpdateChatLayout()
    {
        var empty = _transcript.Count == 0;
        WelcomePanel.Visibility = empty ? Visibility.Visible : Visibility.Collapsed;
        Transcript.Visibility = empty ? Visibility.Collapsed : Visibility.Visible;
        ChatLayout.VerticalAlignment = empty ? VerticalAlignment.Center : VerticalAlignment.Stretch;
    }

    private void OnModelChanged(object sender, SelectionChangedEventArgs args)
    {
        if (!_rendering && ModelBox.SelectedItem is ModelView model && model.ModelKey != _services.Preferences.ModelKey)
        {
            try { _services.SavePreferences(_services.Preferences with { ModelKey = model.ModelKey }); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { ShowSourceError("The model preference could not be saved."); }
        }
        RenderSelection();
    }
    private void ResetContextDisplay()
    {
        _compactNext = false;
        CompactButton.Content = "Compact next send";
        ContextHint.Text = "Context is measured before generation";
        ContextSummary.Text = string.Empty;
        ContextSummaryPanel.Visibility = Visibility.Collapsed;
        SessionResumeHint.Text = string.Empty;
    }

    private void ShowCheckpoint(ContextState state)
    {
        ContextHint.Text = $"Last measured input: {state.TokensAfter:N0} / {state.InputLimit / 1024}K · {state.Mode} compaction";
        ContextSummary.Text = $"{state.TokensBefore:N0} → {state.TokensAfter:N0} tokens. The full transcript stays client-local. Summary inference is metered.\n\n{state.Summary}";
        ContextSummaryPanel.Visibility = Visibility.Visible;
    }

    private void CancelPendingResume()
    {
        _resumeRequest?.Cancel();
        _resumeRequest = null;
    }
    private void OnPromptChanged(object sender, TextChangedEventArgs args) => RenderSelection();
    private async void OnRefresh(object sender, RoutedEventArgs args) => await RefreshAsync();
    private async void OnManageAccount(object sender, RoutedEventArgs args) => await Launcher.LaunchUriAsync(
        _session.Availability == PlaygroundAvailability.NoAccess ? _services.SubscriptionUrl : _services.AccountUrl);
    private void OnStop(object sender, RoutedEventArgs args) { _inFlight?.Cancel(); _agent?.Stop(); }
    private void OnCompactNext(object sender, RoutedEventArgs args)
    {
        if (_inFlight is not null) return;
        _compactNext = !_compactNext;
        CompactButton.Content = _compactNext ? "Compaction queued for next send" : "Compact next send";
    }
    private async void OnSend(object sender, RoutedEventArgs args) => await SendAsync();
    private void OnSettings(object sender, RoutedEventArgs args) => SettingsRequested?.Invoke(this, args);
    private void OnCompactionChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_rendering || _inFlight is not null || sender is not ChoicePicker picker || picker.SelectedIndex < 0) return;
        var mode = picker.SelectedIndex switch { 0 => "permissive", 2 => "aggressive", _ => "balanced" };
        if (mode != _services.Preferences.CompactionMode) _services.SavePreferences(_services.Preferences with { CompactionMode = mode });
    }
    private void OnChatModeChanged(object sender, SelectionChangedEventArgs args)
    {
        if (AgentHost is null || PromptBox is null || _inFlight is not null || AgentBusy) return;
        if (AgentMode)
        {
            if (_agent is null)
            {
                _agent = new AgentWorkspacePage(_services);
                _agent.StateChanged += (_, _) => { if (!_disposed) RenderSelection(); };
                AgentHost.Content = _agent;
                _agent.Reload(SavedSessionUuid);
            }
            _agent.SelectMode(ChatModePicker.SelectedIndex == 2);
        }
        AgentHost.Visibility = AgentMode ? Visibility.Visible : Visibility.Collapsed;
        PromptBox.PlaceholderText = !AgentMode ? "Ask anything…" : ChatModePicker.SelectedIndex == 1 ? "Explore a project or plan a change…" : "Describe what you want to build…";
        RenderSelection();
    }
    private void ResetAgent()
    {
        _agent?.Dispose(); _agent = null;
        AgentHost.Content = null; AgentHost.Visibility = Visibility.Collapsed;
        ChatModePicker.SelectedIndex = 0;
    }
    public void SuspendAgent() => ResetAgent();
    private void OnThinkingChanged(object sender, RoutedEventArgs args) => _thinking = ThinkingButton.IsChecked == true;
    private void OnNewConversation(object sender, RoutedEventArgs args) => NewConversation();
    private void OnCancelEdit(object sender, RoutedEventArgs args) { _editingFrom = null; PromptBox.Text = string.Empty; EditingPanel.Visibility = Visibility.Collapsed; }

    private void OnInputContext(object sender, RoutedEventArgs args)
    {
        if (_inFlight is not null || sender is not MenuFlyoutItem item || !int.TryParse(item.Tag as string, out var level)) return;
        try { _services.SavePreferences(_services.Preferences with { InputContextTokens = level, ModelKey = (ModelBox.SelectedItem as ModelView)?.ModelKey ?? _services.Preferences.ModelKey }); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { ShowSourceError("The context preference could not be saved."); }
    }

    private async void OnAttachFiles(object sender, RoutedEventArgs args)
    {
        if (_inFlight is not null) return;
        var conversation = _conversationId;
        var picker = new Windows.Storage.Pickers.FileOpenPicker();
        foreach (var extension in ((sender as MenuFlyoutItem)?.Tag as string ?? "*").Split(',')) picker.FileTypeFilter.Add(extension);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, _services.WindowHandle);
        var files = await picker.PickMultipleFilesAsync();
        foreach (var file in files)
        {
            if (conversation != _conversationId || _disposed) break;
            if (_sources.Count >= 8) { ShowSourceError("Attach up to 8 sources at a time."); break; }
            if ((await file.GetBasicPropertiesAsync()).Size is 0 or > 20 * 1024 * 1024) { ShowSourceError($"{file.Name}: choose a non-empty file no larger than 20 MB."); continue; }
            var source = new AttachmentView(file.Name, IconFor(file.Name));
            _sources.Add(source); RenderSelection();
            try
            {
                using var contents = await file.OpenStreamForReadAsync();
                var result = await _services.PrepareFileAsync(file.Name, contents, source.Cancellation.Token);
                source.Complete(result);
            }
            catch (OperationCanceledException) { source.Status = "Cancelled"; }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { source.Status = "The file could not be opened."; }
            RenderSelection();
        }
    }

    private async void OnAddGithub(object sender, RoutedEventArgs args)
    {
        if (_inFlight is not null) return;
        if (_sources.Count >= 8) { ShowSourceError("Attach up to 8 sources at a time."); return; }
        var url = new TextBox { Header = "Repository URL", PlaceholderText = "https://github.com/owner/project", MinWidth = 340 };
        var error = new TextBlock { FontSize = 11, TextWrapping = TextWrapping.Wrap };
        var panel = new StackPanel { Spacing = 16 };
        panel.Children.Add(new TextBlock { Text = "Attach a public repository's source snapshot to this conversation.", TextWrapping = TextWrapping.Wrap });
        panel.Children.Add(url); panel.Children.Add(error);
        var title = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        title.Children.Add(new SharedIcon { IconName = "github", Width = 24, Height = 24 });
        title.Children.Add(new TextBlock { Text = "Add GitHub project" });
        var dialog = new ContentDialog { Title = title, Content = panel, PrimaryButtonText = "Add project", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Primary, XamlRoot = XamlRoot, RequestedTheme = ElementTheme.Dark };
        dialog.PrimaryButtonClick += (_, click) =>
        {
            if (!Regex.IsMatch(url.Text.Trim(), @"^https://github\.com/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}/?$", RegexOptions.IgnoreCase))
            { click.Cancel = true; error.Text = "Enter a repository URL such as https://github.com/owner/project."; }
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        var source = new AttachmentView(url.Text.Trim().Replace("https://github.com/", string.Empty, StringComparison.OrdinalIgnoreCase), "github");
        _sources.Add(source); RenderSelection();
        try { source.Complete(await _services.PrepareGithubAsync(url.Text.Trim(), source.Cancellation.Token)); }
        catch (OperationCanceledException) { source.Status = "Cancelled"; }
        RenderSelection();
    }

    private void OnRemoveSource(object sender, RoutedEventArgs args)
    {
        if (_inFlight is null && (sender as Button)?.Tag is AttachmentView source)
        { source.Cancellation.Cancel(); _sources.Remove(source); RenderSelection(); }
    }
    private void ClearSources() { foreach (var source in _sources) source.Cancellation.Cancel(); _sources.Clear(); }
    private void ShowSourceError(string message) { StateBar.Title = "Attachment"; StateBar.Message = message; StateBar.IsOpen = true; StateBar.Severity = InfoBarSeverity.Warning; }
    private static string IconFor(string name) => Path.GetExtension(name).ToLowerInvariant() switch
    {
        ".png" or ".jpg" or ".jpeg" or ".webp" or ".gif" or ".bmp" => "image",
        ".mp3" or ".wav" or ".m4a" or ".ogg" or ".flac" or ".aac" or ".opus" => "audio",
        ".mp4" or ".mov" or ".webm" or ".mkv" or ".avi" => "video", _ => "file",
    };

    private async void OnPromptKeyDown(object sender, KeyRoutedEventArgs args)
    {
        if (args.Key != VirtualKey.Enter) return;
        var shift = (Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Shift) & CoreVirtualKeyStates.Down) != 0;
        var control = (Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Control) & CoreVirtualKeyStates.Down) != 0;
        if (control || (_services.Preferences.EnterToSend && !shift)) { args.Handled = true; await SendAsync(); }
    }

    private async Task SendAsync(string? replacementPrompt = null, int? replaceFrom = null)
    {
        if (AgentMode) { if (replacementPrompt is not null || _editingFrom is not null) { ShowSourceError("Cancel the message edit before using agent tools."); return; } await SendAgentAsync(); return; }
        if (_inFlight is not null || ModelBox.SelectedItem is not ModelView selected ||
            !_session.ForModel(selected.ModelKey).AllowsSending()) return;
        if (_sources.Any(source => source.Context is null)) return;
        var replacing = replaceFrom ?? _editingFrom;
        var sources = replacing is { } sourceIndex && sourceIndex < _transcript.Count ? _transcript[sourceIndex].Sources
            : _sources.Select(source => source.Context!).ToArray();
        var prompt = (replacementPrompt ?? PromptBox.Text).Trim();
        if (prompt.Length == 0 && sources.Length > 0) prompt = "Please analyze the attached sources.";
        if (prompt.Length == 0) return;
        CancelPendingResume();
        var preferences = _services.Preferences;
        using var cancellation = new CancellationTokenSource();
        _inFlight = cancellation;
        var replace = replaceFrom ?? _editingFrom;
        var originalHistory = (replace is { } before ? _transcript.Take(before) : _transcript).ToArray();
        var history = originalHistory.Select(line => new ChatTurn(line.IsUser ? "user" : "assistant",
            line.Text + string.Join(string.Empty, line.Sources.Select(source => $"\n\n<attached-source name={JsonSerializer.Serialize(source.Name)}>\n{source.Text}\n</attached-source>")))).ToArray();
        if (_checkpoints.TryGetValue(_conversationId, out var checkpoint) && checkpoint.Original.Length <= originalHistory.Length
            && checkpoint.Original.Select((line, index) => ReferenceEquals(line, originalHistory[index])).All(value => value))
            history = checkpoint.Active.Concat(history.Skip(checkpoint.Original.Length)).ToArray();
        if (replace is { } index) while (_transcript.Count > index) _transcript.RemoveAt(_transcript.Count - 1);
        _editingFrom = null;
        EditingPanel.Visibility = Visibility.Collapsed;
        var userLine = CreateLine(true, "You", prompt); userLine.Sources = sources;
        _transcript.Add(userLine);
        ClearSources();
        var answer = CreateLine(false, selected.Label, "Generating…");
        answer.IsComplete = false;
        _transcript.Add(answer);
        PromptBox.Text = string.Empty;
        UpdateChatLayout();
        RenderSelection();
        var watch = Stopwatch.StartNew();
        var firstText = true;
        var finished = false;
        try
        {
            await foreach (var update in _session.SendAsync(prompt, selected.ModelKey,
                inputContextTokens: preferences.InputContextTokens, contexts: sources, history: history,
                compactionMode: preferences.CompactionMode, compactNow: _compactNext,
                sessionUuid: _sessionUuids.TryGetValue(_conversationId, out var sessionUuid) ? sessionUuid : null,
                thinking: _thinking && _services.Entitlement?.Tier is "max" or "ultimate",
                cancellationToken: cancellation.Token))
            {
                switch (update)
                {
                    case PlaygroundEvent.Context context:
                        var state = context.State;
                        ContextHint.Text = $"Last measured input: {state.TokensAfter:N0} / {state.InputLimit / 1024}K · {state.Mode} compaction";
                        if (state.Compacted)
                        {
                            _checkpoints[_conversationId] = (originalHistory, state.History, state);
                            ShowCheckpoint(state);
                            _compactNext = false; CompactButton.Content = "Compact next send";
                        }
                        break;
                    case PlaygroundEvent.Say say:
                        if (firstText) { answer.Text = string.Empty; firstText = false; }
                        answer.Text += say.Text;
                        break;
                    case PlaygroundEvent.Think think:
                        answer.Reasoning += think.Text;
                        break;
                    case PlaygroundEvent.Finished done:
                        finished = true;
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
            // The conversation's server session: created by the first completed generation and
            // patched by every later one. Persisting is fail-open — a lost save never costs a
            // reply — and the checkpoint is re-validated against the exact history this send
            // used, so a saved context can never disagree with a conversation the user edited.
            if (finished) _ = PersistServerSessionAsync(originalHistory, sources, selected.ModelKey, prompt, preferences);
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

    private async Task SendAgentAsync()
    {
        if (_inFlight is not null || _agent is not { CanSend: true } agent || _sources.Any(source => source.Context is null)) return;
        var sources = _sources.Select(source => source.Context!).ToArray();
        var prompt = PromptBox.Text.Trim();
        if (prompt.Length == 0 && sources.Length > 0) prompt = "Please analyze the attached sources.";
        if (prompt.Length == 0) return;
        var request = prompt + string.Join(string.Empty, sources.Select(source => $"\n\n<attached-source name={JsonSerializer.Serialize(source.Name)}>\n{source.Text}\n</attached-source>"));
        if (request.Length > 8000) { ShowSourceError("These sources exceed the agent message limit. Import project files through Workspace instead; nothing was silently removed."); return; }
        var history = new List<AgentConversationTurn>();
        for (var i = 0; i < _transcript.Count; i += 2)
        {
            if (i + 1 >= _transcript.Count || !_transcript[i].IsUser || _transcript[i + 1].IsUser) { ShowSourceError("The transcript has an incomplete message pair. Start a new conversation to use agent tools."); return; }
            var line = _transcript[i];
            var message = line.Text + string.Join(string.Empty, line.Sources.Select(source => $"\n\n<attached-source name={JsonSerializer.Serialize(source.Name)}>\n{source.Text}\n</attached-source>"));
            history.Add(new(message, _transcript[i + 1].Text, Array.Empty<AgentExchange>()));
        }
        if (history.Count >= 16 || JsonSerializer.Serialize(history).Length > 196608 || history.Any(turn => turn.UserMessage.Length > 8000 || turn.AssistantText.Length > 32768)) { ShowSourceError("Agent context limit reached. Export this thread and start a new conversation; nothing was silently removed."); return; }
        using var cancellation = new CancellationTokenSource(); _inFlight = cancellation;
        var user = CreateLine(true, "You", prompt); user.Sources = sources; _transcript.Add(user);
        var answer = CreateLine(false, (ModelBox.SelectedItem as ModelView)?.Label ?? "Agent", "Working…"); answer.IsComplete = false; _transcript.Add(answer);
        PromptBox.Text = string.Empty; ClearSources(); UpdateChatLayout(); RenderSelection();
        agent.OutputChanged = text => { answer.Text = string.IsNullOrEmpty(text) ? "Working…" : text; Transcript.ScrollIntoView(answer); };
        try { await agent.SendFromComposerAsync(request, history); }
        catch (Exception error) when (error is InvalidOperationException or OperationCanceledException) { answer.Text = error.Message; }
        finally { agent.OutputChanged = null; answer.IsComplete = true; _inFlight = null; if (!_disposed) { RememberConversation(); Render(); } }
    }

    /// <summary>
    /// Saves the conversation's resume state to its server session, fire-and-forget.
    /// </summary>
    /// <remarks>
    /// The save is fail-open like the recorder: every failure mode inside the API client is
    /// returned as a result, and nothing here can cost the user a reply or an error dialog.
    /// The stored checkpoint is the compaction artifact for the exact history this send used
    /// — after an edit or regeneration that diverged from it, no checkpoint is sent at all,
    /// and the server keeps what it already had. Titles and source references are named
    /// pointers; the transcript itself never leaves this PC.
    /// </remarks>
    private async Task PersistServerSessionAsync(TranscriptLine[] originalHistory, PreparedSource[] sources, string modelKey, string fallbackTitle, DesktopPreferences preferences)
    {
        var conversationId = _conversationId;
        var checkpoint = _checkpoints.TryGetValue(conversationId, out var saved) &&
                saved.Original.Length <= originalHistory.Length &&
                saved.Original.Select((line, index) => ReferenceEquals(line, originalHistory[index])).All(match => match)
            ? saved.State
            : null;
        var title = originalHistory.Length > 0 ? originalHistory[0].Text : fallbackTitle;
        var write = new SessionWrite
        {
            Title = title,
            Model = modelKey,
            InputContextTokens = preferences.InputContextTokens,
            CompactionMode = preferences.CompactionMode,
            ActiveContext = checkpoint,
            SourceReferences = sources.Length > 0 ? sources.Where(source => !string.IsNullOrWhiteSpace(source.Name)).Select(source =>
                new SavedSourceReference { Name = source.Name, Kind = source.Kind, Size = source.Size, SourceUrl = source.SourceUrl }).ToArray() : null,
        };
        var result = await _services.SaveSavedSessionAsync(_sessionUuids.TryGetValue(conversationId, out var uuid) ? uuid : null, write);
        if (_disposed || !result.Ok || result.Value is null) return;
        _sessionUuids[conversationId] = result.Value;
        // A page session that never stops creating conversations would otherwise let this
        // map grow without end; stale entries are harmless, and the server's list stays the
        // durable record of which conversations exist.
        if (_sessionUuids.Count > 32) _sessionUuids.Remove(_sessionUuids.Keys.First());
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
        if (_inFlight is not null || AgentBusy || AgentMode || (sender as Button)?.Tag is not TranscriptLine line) return;
        _editingFrom = _transcript.IndexOf(line); PromptBox.Text = line.Text;
        EditingPanel.Visibility = Visibility.Visible; PromptBox.Focus(FocusState.Programmatic);
    }
    private async void OnRegenerate(object sender, RoutedEventArgs args)
    {
        if (_inFlight is not null || AgentBusy || AgentMode || (sender as Button)?.Tag is not TranscriptLine line) return;
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
        RenderServerConversations();
    }

    /// <summary>
    /// The account's server-saved conversations, alongside the session-local ones.
    /// </summary>
    /// <remarks>
    /// The conversation in view is served by its own session row, so it is not offered into
    /// itself: resuming it would fork the context. Rows the server sent but this pane cannot
    /// resolve are still rendered by title — the server rows are already account-scoped and
    /// sanitized, and one odd row costs nothing but its own listing.
    /// </remarks>
    private void RenderServerConversations()
    {
        var rows = _serverSessions.Where(session => session.SessionUuid != _sessionUuids.GetValueOrDefault(_conversationId) &&
            session.Title.Contains(ConversationSearch.Text, StringComparison.OrdinalIgnoreCase)).ToArray();
        ServerSessionsCaption.Visibility = rows.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        ServerSessionsList.Visibility = rows.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        ServerSessionsList.ItemsSource = rows;
    }

    /// <summary>
    /// Loads the account's server-saved conversations for the pane, fire-and-forget.
    /// </summary>
    /// <remarks>
    /// Durable state is an enhancement to the local pane: a slow or failed load leaves the
    /// pane as it was and costs nothing further.
    /// </remarks>
    private async Task RefreshServerSessionsAsync()
    {
        if (_disposed || ConversationsPane.Visibility != Visibility.Visible) return;
        var result = await _services.ListSavedSessionsAsync();
        if (_disposed || !result.Ok || result.Value is null) return;
        _serverSessions.Clear();
        _serverSessions.AddRange(result.Value);
        RenderServerConversations();
    }

    /// <summary>
    /// Resumes a server-saved conversation: keep the context the server retained (the
    /// compaction checkpoint, the conversation's preferences), not the transcript — which
    /// stays on this PC by design. The checkpoint is registered without original lines, so
    /// the next send continues exactly from the retained history, and the local conversation
    /// keeps its server session uuid so the next generation's run events link to it.
    /// </summary>
    private async void OnServerSessionChosen(object sender, RoutedEventArgs args)
    {
        if (_inFlight is not null || (sender as FrameworkElement)?.Tag is not SavedSession row) return;
        CancelPendingResume();
        using var request = new CancellationTokenSource();
        _resumeRequest = request;
        try
        {
            var result = await _services.GetSavedSessionAsync(row.SessionUuid, request.Token);
            if (_disposed || request.IsCancellationRequested || !ReferenceEquals(_resumeRequest, request)) return;
            if (!result.Ok || result.Value is not { } saved)
            { ShowSourceError("This saved conversation could not be opened. Your current conversation is unchanged; please retry."); return; }
            var preferences = saved.RestorePreferences(_services.Preferences);
            if (!_session.Catalogue.Models.Any(model => model.ModelKey == preferences.ModelKey && model.IsUsable))
            { ShowSourceError("The saved model is not available on this account. Your current conversation is unchanged."); return; }
            try { _services.SavePreferences(preferences); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            { ShowSourceError("The restored preferences could not be saved. Your current conversation is unchanged."); return; }
            ResumeServerSession(saved);
        }
        catch (OperationCanceledException) when (request.IsCancellationRequested) { }
        finally { if (ReferenceEquals(_resumeRequest, request)) _resumeRequest = null; }
    }

    private void ResumeServerSession(SavedSession saved)
    {
        ResetAgent();
        RememberConversation();
        var nextId = Guid.NewGuid().ToString();
        _sessionUuids[nextId] = saved.SessionUuid;
        var checkpoint = saved.RestoreContext();
        _conversationId = nextId;
        _transcript.Clear();
        ClearSources();
        ResetContextDisplay();
        if (checkpoint is not null)
        {
            // The checkpoint is registered without original lines, so the next send continues
            // exactly from the retained history, and the meter shows the restored measurement.
            _checkpoints[nextId] = (Array.Empty<TranscriptLine>(), checkpoint.History, checkpoint);
            ShowCheckpoint(checkpoint);
        }
        SessionResumeHint.Text = (checkpoint is null ? "Restored preferences only: no saved compaction checkpoint." : "Resumed the last compaction checkpoint, not the full transcript.") +
            (saved.SourceReferences is { Length: > 0 } ? " Attach source files again if needed; saved references are not file contents." : string.Empty);
        PromptBox.Text = string.Empty; _editingFrom = null; EditingPanel.Visibility = Visibility.Collapsed;
        ShowModelsOnly(false); UpdateChatLayout();
        RenderConversations();
        PromptBox.Focus(FocusState.Programmatic);
    }

    /// <summary>
    /// Forgets a server-saved conversation, purging the run events linked to it in the same
    /// request — the single honest consent gesture for "this conversation and its history
    /// are not wanted". The local transcript, if open, is untouched: it lives on this PC.
    /// </summary>
    private async void OnServerSessionForgotten(object sender, RoutedEventArgs args)
    {
        if (_inFlight is not null || (sender as FrameworkElement)?.Tag is not SavedSession saved) return;
        CancelPendingResume();
        var result = await _services.DeleteSavedSessionAsync(saved.SessionUuid);
        if (_disposed || !result.Ok) return;
        _serverSessions.RemoveAll(item => item.SessionUuid == saved.SessionUuid);
        RenderServerConversations();
    }

    private void OnSearchChanged(object sender, TextChangedEventArgs args) { if (ConversationsList is not null) RenderConversations(); }
    private void OnConversationSelected(object sender, SelectionChangedEventArgs args)
    {
        if (_rendering || _inFlight is not null || AgentBusy || ConversationsList.SelectedItem is not Conversation chat) return;
        ResetAgent();
        CancelPendingResume();
        RememberConversation(); _conversationId = chat.Id; _transcript.Clear();
        ClearSources();
        ResetContextDisplay();
        if (_checkpoints.TryGetValue(chat.Id, out var checkpoint)) ShowCheckpoint(checkpoint.State);
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
        var messages = _transcript.Select(line => new ExportedMessage(line.IsUser ? "user" : "assistant", line.Text, line.Role, line.Reasoning, line.Sources)).ToArray();
        await Windows.Storage.FileIO.WriteTextAsync(file, JsonSerializer.Serialize(new ConversationDocument(1, messages), JsonOptions));
    }
    public async Task ImportConversationAsync()
    {
        if (_inFlight is not null) return;
        CancelPendingResume();
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
            ResetContextDisplay();
            foreach (var message in messages)
            {
                var importedLabel = _session.Catalogue.Models.FirstOrDefault(model => model.ModelKey == message.Model)?.Label
                    ?? (message.Model?.Contains("q4", StringComparison.OrdinalIgnoreCase) == true || message.Model?.Contains("q8", StringComparison.OrdinalIgnoreCase) == true ? "Model" : message.Model ?? "Model");
                var line = CreateLine(message.Role == "user", message.Role == "user" ? "You" : importedLabel, message.Content);
                line.Reasoning = message.Reasoning ?? string.Empty; _transcript.Add(line);
                line.Sources = message.Sources?.Where(source => source.Text is not null && source.Text.Length <= 240_000).Take(8).ToArray() ?? Array.Empty<PreparedSource>();
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
        _agent?.Dispose();
        CancelPendingResume();
        _disposed = true; _inFlight?.Cancel(); _session.Changed -= OnSessionChanged;
        ClearSources();
        _services.PreferencesChanged -= OnPreferencesChanged;
    }

    public sealed record CatalogueRow(string Label, string Price, string State);
    public sealed record Conversation(string Id, string Title, TranscriptLine[] Messages);
    public sealed record ExportedMessage(string Role, string Content, string? Model, string? Reasoning, PreparedSource[]? Sources = null);
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
        private PreparedSource[] _sources = Array.Empty<PreparedSource>();
        public PreparedSource[] Sources { get => _sources; set { _sources = value; Changed(nameof(SourceNames)); } }
        public string SourceNames => string.Join(" · ", Sources.Select(source => source.Name));
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

    public sealed class AttachmentView(string name, string iconName) : INotifyPropertyChanged
    {
        private string _status = "Reading source…";
        public string Name { get; } = name;
        public string IconName { get; } = iconName;
        public PreparedSource? Context { get; private set; }
        public CancellationTokenSource Cancellation { get; } = new();
        public string Status { get => _status; set { _status = value; PropertyChanged?.Invoke(this, new(nameof(Status))); } }
        public void Complete(ApiResult<PreparedSource> result)
        {
            Context = result.Ok ? result.Value : null;
            Status = Context is not null ? "Ready" + (Context.Warnings.Length > 0 ? " · " + string.Join(" ", Context.Warnings) : string.Empty) : result.Message;
        }
        public event PropertyChangedEventHandler? PropertyChanged;
    }
}
