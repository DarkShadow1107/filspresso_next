using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Harness;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Filspresso.App;

/// <summary>A single proposal-only model turn. No sandbox or IAgentLoop is constructed.</summary>
public sealed partial class AgentReviewPage : UserControl, IDisposable
{
    private readonly AppServices _services;
    private NativeAgentTransport? _transport;
    private NativeProposalReview? _review;
    private string? _sessionUuid;
    private string? _account;
    private string? _model;
    private int _context;
    private bool _rendering;
    private bool _active;
    private bool _disposed;

    public AgentReviewPage(AppServices services)
    {
        _services = services; InitializeComponent();
        services.PreferencesChanged += OnPreferencesChanged;
        services.Auth.Changed += OnAuthChanged;
    }

    public void Reload(string? sessionUuid)
    {
        if (_disposed) return;
        ReleaseReview();
        _active = true; _sessionUuid = sessionUuid;
        _account = _services.Auth.Current?.Email;
        var preferences = _services.Preferences.Normalize();
        _model = preferences.ModelKey; _context = preferences.InputContextTokens;
        _transport = _services.CreateProposalTransport(_context, sessionUuid);
        _review = new NativeProposalReview(_transport, _model);
        _review.Changed += OnReviewChanged;
        _rendering = true; PromptBox.Text = string.Empty; ModeBox.SelectedIndex = 0; _rendering = false;
        var label = _services.Playground.Catalogue.Models.FirstOrDefault(model => model.ModelKey == _model)?.Label ?? "Selected chat model";
        ModelInfo.Text = $"Model: hosted AI · This review: no connected executor · {label} · {_context / 1024}K input limit · Desktop Build boundary: Windows Sandbox, not started";
        Render();
    }

    private void Render()
    {
        if (_disposed || _review is null) return;
        var state = _review.Snapshot;
        var busy = state.Phase is ProposalReviewPhase.Checking or ProposalReviewPhase.Generating;
        var available = state.Models.Contains(_model, StringComparer.Ordinal);
        CheckButton.IsEnabled = _active && !busy;
        StopButton.IsEnabled = _active && busy;
        ModeBox.IsEnabled = PromptBox.IsEnabled = _active && !busy;
        GenerateButton.IsEnabled = _active && !busy && available && !string.IsNullOrWhiteSpace(PromptBox.Text);
        ReviewStatus.Text = state.Phase == ProposalReviewPhase.Checking ? "Checking native model capabilities…" : state.Phase == ProposalReviewPhase.Generating ?
            "Generating proposals. No code is running in this review." : available ? "Native proposal transport configured. Execution approval is still unavailable." :
            "Native proposals unavailable for the selected model. No models are enabled by default; plain chat remains available.";
        ReviewError.Text = state.Error;
        Receipt.Text = state.Reply is { Usage: { } usage } reply ? $"{reply.RunId} · Reported model usage: {usage.InputTokens} input / {usage.OutputTokens} output tokens · Settlement recorded" : string.Empty;
        Answer.Text = state.Reply?.Text ?? string.Empty;
        AnswerHeading.Visibility = Answer.Text.Length == 0 ? Visibility.Collapsed : Visibility.Visible;
        Proposals.ItemsSource = state.Reply?.ToolCalls.Select(call => new ProposalRow($"{call.Name} · Proposed, not executed", $"Call {call.Id} · Exact JSON arguments, untrusted data", call.ArgumentsJson)).ToArray();
        ClearButton.IsEnabled = state.Reply is not null;
        if (state.Reply is { ToolCalls.Count: 0 }) Receipt.Text += "\nNo native tool proposals returned. Answer text/code blocks are not actions.";
    }

    private void OnReviewChanged(object? sender, EventArgs args) => DispatcherQueue.TryEnqueue(() => { if (!_disposed && ReferenceEquals(sender, _review)) Render(); });
    private void OnPreferencesChanged(object? sender, EventArgs args) => DispatcherQueue.TryEnqueue(() =>
    {
        if (!_disposed && _active && (_services.Preferences.ModelKey != _model || _services.Preferences.InputContextTokens != _context)) Reload(_sessionUuid);
    });
    private void OnAuthChanged(object? sender, EventArgs args) => DispatcherQueue.TryEnqueue(() =>
    {
        if (_disposed) return;
        if (!_services.Auth.IsSignedIn || !string.Equals(_account, _services.Auth.Current?.Email, StringComparison.OrdinalIgnoreCase))
        {
            _active = false;
            _review?.Clear(true, "Account changed. Reopen review and check native availability again.");
            _rendering = true; PromptBox.Text = string.Empty; _rendering = false;
            Render();
        }
    });

    private async void OnCheck(object sender, RoutedEventArgs args) { if (_active && _review is { } review) await review.RefreshAsync(); }
    private async void OnGenerate(object sender, RoutedEventArgs args)
    {
        if (!_active || _review is not { } review) return;
        await review.GenerateAsync(ModeBox.SelectedIndex == 1 ? AgentMode.Build : AgentMode.Plan, PromptBox.Text);
        _ = RefreshBalanceAsync();
    }
    private async Task RefreshBalanceAsync()
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        try { await _services.Playground.RefreshAsync(timeout.Token); } catch (Exception) { /* The server still gates every subsequent turn. */ }
    }
    private void OnModeChanged(object sender, SelectionChangedEventArgs args) { if (!_rendering && _review is not null) _review.Clear(); }
    private void OnPromptChanged(object sender, TextChangedEventArgs args) { if (!_rendering && _review is not null) { _review.Clear(); Render(); } }
    private void OnStop(object sender, RoutedEventArgs args) => _review?.Clear(false, "Review stopped. A generation may still have consumed billed tokens.");
    private void OnClear(object sender, RoutedEventArgs args) => _review?.Clear();
    public void CancelPendingRequests() { _active = false; _review?.Clear(true); Render(); }

    private void ReleaseReview()
    {
        if (_review is not null) { _review.Changed -= OnReviewChanged; _review.Dispose(); _review = null; }
        _transport?.Dispose(); _transport = null;
    }
    public void Dispose()
    {
        _disposed = true; _active = false;
        _services.PreferencesChanged -= OnPreferencesChanged; _services.Auth.Changed -= OnAuthChanged;
        ReleaseReview();
    }
    public sealed record ProposalRow(string Title, string Detail, string Arguments);
}
