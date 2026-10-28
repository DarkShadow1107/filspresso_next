using System;
using System.Collections;
using System.Linq;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Filspresso.App;

/// <summary>Arrow-free button picker with rounded, keyboard-accessible native menu items.</summary>
public sealed class ChoicePicker : Button
{
    private object[] _items = Array.Empty<object>();
    private object? _selected;
    public string DisplayMemberPath { get; set; } = string.Empty;
    public string Options { set => ItemsSource = value.Split('|'); }
    public IEnumerable? ItemsSource
    {
        get => _items;
        set { _items = value?.Cast<object>().ToArray() ?? Array.Empty<object>(); Render(); }
    }
    public object? SelectedItem
    {
        get => _selected;
        set
        {
            if (Equals(_selected, value)) { Render(); return; }
            var before = _selected; _selected = value; Render();
            SelectionChanged?.Invoke(this, new SelectionChangedEventArgs(
                before is null ? Array.Empty<object>() : new[] { before }, value is null ? Array.Empty<object>() : new[] { value }));
        }
    }
    public int SelectedIndex
    {
        get => Array.IndexOf(_items, _selected);
        set => SelectedItem = value >= 0 && value < _items.Length ? _items[value] : null;
    }
    public event SelectionChangedEventHandler? SelectionChanged;
    public ChoicePicker()
    {
        CornerRadius = new CornerRadius(12); Padding = new Thickness(10, 6, 10, 6); MinHeight = 30; FontSize = 11;
        Click += (_, _) =>
        {
            var menu = new MenuFlyout();
            foreach (var value in _items)
            {
                var item = new ToggleMenuFlyoutItem { Text = Label(value), IsChecked = Equals(value, _selected) };
                item.Click += (_, _) => SelectedItem = value;
                menu.Items.Add(item);
            }
            menu.ShowAt(this);
        };
    }
    private string Label(object value) => string.IsNullOrEmpty(DisplayMemberPath) ? value.ToString() ?? string.Empty
        : value.GetType().GetProperty(DisplayMemberPath)?.GetValue(value)?.ToString() ?? value.ToString() ?? string.Empty;
    private void Render() => Content = _selected is null ? "Choose…" : Label(_selected);
}
