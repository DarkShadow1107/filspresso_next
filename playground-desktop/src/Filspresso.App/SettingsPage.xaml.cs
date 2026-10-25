using System;
using System.IO;
using System.Linq;
using Filspresso.Core.Storage;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace Filspresso.App;

public sealed partial class SettingsPage : UserControl
{
    private readonly AppServices _services;
    public event RoutedEventHandler? BackRequested;
    public event RoutedEventHandler? ExportRequested;
    public event RoutedEventHandler? ImportRequested;

    public SettingsPage(AppServices services)
    {
        _services = services;
        InitializeComponent();
        Reload();
    }

    public void Reload()
    {
        DefaultModelBox.ItemsSource = _services.Playground.Catalogue.Models;
        SetDraft(_services.Preferences);
        DataLocation.Text = _services.PreferencesStore.DirectoryPath;
        SaveSettingsButton.IsEnabled = ResetSettingsButton.IsEnabled = !_services.Playground.IsSending;
        GeneralNav.Background = (Brush)Application.Current.Resources["FilspressoSurface"];
    }

    private void SetDraft(DesktopPreferences preferences)
    {
        DefaultModelBox.SelectedItem = _services.Playground.Catalogue.Models.FirstOrDefault(model => model.ModelKey == preferences.ModelKey)
            ?? _services.Playground.Catalogue.DefaultModel;
        InputContextBox.SelectedIndex = Math.Max(0, Array.IndexOf(DesktopPreferences.InputLevels, preferences.InputContextTokens));
        CompactionBox.SelectedIndex = preferences.CompactionMode switch { "permissive" => 0, "aggressive" => 2, _ => 1 };
        ThinkingSwitch.IsEnabled = _services.Entitlement?.Tier is "max" or "ultimate";
        ThinkingSwitch.IsOn = ThinkingSwitch.IsEnabled && preferences.Thinking;
        EnterSwitch.IsOn = preferences.EnterToSend;
        StatisticsSwitch.IsOn = preferences.ShowStatistics;
        TextSizeBox.SelectedIndex = preferences.TextSize switch { 13 => 0, 18 => 2, _ => 1 };
    }

    private void OnSection(object sender, RoutedEventArgs args)
    {
        var section = (sender as Button)?.Tag as string;
        GeneralPanel.Visibility = section == "general" ? Visibility.Visible : Visibility.Collapsed;
        DisplayPanel.Visibility = section == "display" ? Visibility.Visible : Visibility.Collapsed;
        DataPanel.Visibility = section == "data" ? Visibility.Visible : Visibility.Collapsed;
        SavePanel.Visibility = section == "data" ? Visibility.Collapsed : Visibility.Visible;
        SectionTitle.Text = section switch { "display" => "Display", "data" => "Import / Export", _ => "General" };
        foreach (var button in new[] { GeneralNav, DisplayNav, DataNav })
            button.Background = ReferenceEquals(button, sender)
                ? (Brush)Application.Current.Resources["FilspressoSurface"]
                : new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        NoticeBar.IsOpen = false;
    }

    private void OnSave(object sender, RoutedEventArgs args)
    {
        try
        {
            _services.SavePreferences(new DesktopPreferences
            {
                ModelKey = (DefaultModelBox.SelectedItem as Filspresso.Core.Session.ModelView)?.ModelKey ?? DesktopPreferences.DefaultModel,
                InputContextTokens = DesktopPreferences.InputLevels[Math.Max(0, InputContextBox.SelectedIndex)],
                CompactionMode = CompactionBox.SelectedIndex switch { 0 => "permissive", 2 => "aggressive", _ => "balanced" },
                Thinking = ThinkingSwitch.IsEnabled && ThinkingSwitch.IsOn,
                EnterToSend = EnterSwitch.IsOn,
                ShowStatistics = StatisticsSwitch.IsOn,
                TextSize = TextSizeBox.SelectedIndex switch { 0 => 13, 2 => 18, _ => 15 },
            });
            NoticeBar.Message = "Settings saved.";
            NoticeBar.Severity = InfoBarSeverity.Success;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            NoticeBar.Message = "Settings could not be saved. Check access to the app data folder.";
            NoticeBar.Severity = InfoBarSeverity.Error;
        }
        NoticeBar.IsOpen = true;
    }

    private void OnReset(object sender, RoutedEventArgs args) { SetDraft(new()); NoticeBar.Message = "Defaults restored. Save to apply them."; NoticeBar.IsOpen = true; }
    private void OnBack(object sender, RoutedEventArgs args) => BackRequested?.Invoke(this, args);
    private void OnExport(object sender, RoutedEventArgs args) => ExportRequested?.Invoke(this, args);
    private void OnImport(object sender, RoutedEventArgs args) => ImportRequested?.Invoke(this, args);
    private async void OnOpenData(object sender, RoutedEventArgs args)
    {
        Directory.CreateDirectory(_services.PreferencesStore.DirectoryPath);
        await Windows.System.Launcher.LaunchFolderPathAsync(_services.PreferencesStore.DirectoryPath);
    }
}
