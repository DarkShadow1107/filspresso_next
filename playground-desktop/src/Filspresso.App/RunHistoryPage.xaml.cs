using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Filspresso.Core.Api;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Filspresso.App;

/// <summary>Inert, account-scoped history. No executor, shell, chat session or approval is invoked here.</summary>
public sealed partial class RunHistoryPage : UserControl, IDisposable
{
    private readonly AppServices _services;
    private CancellationTokenSource? _listRequest;
    private CancellationTokenSource? _replayRequest;
    private string? _currentSessionUuid;
    private RecordedRun? _selected;
    private RunReplayPage? _page;
    private bool _disposed;

    public RunHistoryPage(AppServices services) { _services = services; InitializeComponent(); }

    public async Task RefreshAsync(string? currentSessionUuid)
    {
        if (_disposed) return;
        CancelPendingRequests();
        _currentSessionUuid = currentSessionUuid;
        OnlyConversation.IsEnabled = currentSessionUuid is not null;
        if (currentSessionUuid is null) OnlyConversation.IsChecked = false;
        var filter = OnlyConversation.IsChecked == true ? currentSessionUuid : null;
        _selected = null; _page = null;
        RunsList.ItemsSource = EventsList.ItemsSource = null;
        RunsList.IsEnabled = false;
        RunHeading.Text = "Choose a run to inspect its recorded events.";
        RunDescription.Text = RunWarnings.Text = ReplayStatus.Text = string.Empty;
        FirstPageButton.IsEnabled = NextPageButton.IsEnabled = false;
        HistoryStatus.Text = "Loading recorded activity…";
        using var request = new CancellationTokenSource();
        _listRequest = request;
        try
        {
            var result = await _services.ListRecordedRunsAsync(filter, request.Token);
            if (_disposed || request.IsCancellationRequested || !ReferenceEquals(_listRequest, request)) return;
            if (!result.Ok || result.Value is null) { HistoryStatus.Text = result.Message; return; }
            RunsList.ItemsSource = result.Value.Select(run => new RunRow(run, $"{run.Label} · {run.OutcomeLabel}", $"{run.UpdatedAt} · {run.EventCount} records")).ToArray();
            HistoryStatus.Text = result.Value.Count == 0
                ? "No retained activity was found. Recording is best-effort; an empty log does not prove no work happened."
                : "Latest 20 runs. The account-wide view includes unlinked first generations and hosted workspace activity.";
        }
        catch (OperationCanceledException) when (request.IsCancellationRequested) { }
        finally
        {
            if (ReferenceEquals(_listRequest, request)) { _listRequest = null; if (!_disposed) RunsList.IsEnabled = true; }
        }
    }

    private async Task LoadReplayAsync(RecordedRun run, int afterSequence)
    {
        if (_disposed) return;
        _replayRequest?.Cancel();
        using var request = new CancellationTokenSource();
        _replayRequest = request;
        _selected = run; _page = null;
        EventsList.ItemsSource = null;
        FirstPageButton.IsEnabled = NextPageButton.IsEnabled = false;
        RunHeading.Text = $"{run.Label} · {run.OutcomeLabel}";
        RunDescription.Text = $"{run.LocationLabel}\n{run.ModelKey ?? "No model recorded"} · {(run.SessionUuid is null ? "Not linked to a saved conversation" : "Linked to a saved conversation")}";
        RunWarnings.Text = (run.Truncated ? "Output was truncated. Later completion/settlement events may be on another page. " : string.Empty) +
            (run.SettlementFailed ? "A settlement failure was recorded. Completion is not proof of a successful charge." : string.Empty);
        ReplayStatus.Text = "Loading recorded events…";
        try
        {
            var result = await _services.ReplayRecordedRunAsync(run.RunId, afterSequence, request.Token);
            if (_disposed || request.IsCancellationRequested || !ReferenceEquals(_replayRequest, request)) return;
            if (!result.Ok || result.Value is null) { ReplayStatus.Text = result.Message + " Use Refresh activity to retry."; return; }
            _page = result.Value;
            EventsList.ItemsSource = _page.Events.Select(entry =>
            {
                var payload = entry.DisplayPayload();
                return new EventRow($"#{entry.Sequence} · {entry.Kind}", $"{entry.CreatedAt} · v{entry.Version} · Record status: {entry.Status}",
                    (entry.Version != 1 ? "Unknown event version; shown as data only. " : string.Empty) +
                    (payload.Clipped || entry.Kind == "run.truncated" ? "Recorded output or this display was clipped. This is not a complete log." : string.Empty), payload.Text);
            }).ToArray();
            ReplayStatus.Text = _page.Events.Length == 0 ? "No events remain for this run. They may have expired or been deleted." :
                $"Showing {_page.Events.Length} records after sequence {afterSequence}.";
            FirstPageButton.IsEnabled = afterSequence >= 0;
            NextPageButton.IsEnabled = _page.HasMore;
        }
        catch (OperationCanceledException) when (request.IsCancellationRequested) { }
        finally { if (ReferenceEquals(_replayRequest, request)) _replayRequest = null; }
    }

    public void CancelPendingRequests()
    {
        _listRequest?.Cancel(); _listRequest = null;
        _replayRequest?.Cancel(); _replayRequest = null;
    }

    private async void OnRefresh(object sender, RoutedEventArgs args) => await RefreshAsync(_currentSessionUuid);
    private async void OnFilterChanged(object sender, RoutedEventArgs args) => await RefreshAsync(_currentSessionUuid);
    private async void OnRunSelected(object sender, SelectionChangedEventArgs args)
    { if (RunsList.SelectedItem is RunRow row) await LoadReplayAsync(row.Run, -1); }
    private async void OnFirstPage(object sender, RoutedEventArgs args)
    { if (_selected is { } run) await LoadReplayAsync(run, -1); }
    private async void OnNextPage(object sender, RoutedEventArgs args)
    { if (_selected is { } run && _page is { HasMore: true, NextAfterSequence: { } cursor }) await LoadReplayAsync(run, cursor); }

    public void Dispose() { _disposed = true; CancelPendingRequests(); }
    public sealed record RunRow(RecordedRun Run, string Title, string Detail);
    public sealed record EventRow(string Title, string Detail, string Notice, string Payload);
}
