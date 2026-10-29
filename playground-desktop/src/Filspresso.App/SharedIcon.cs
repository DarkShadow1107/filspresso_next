using System;
using System.IO;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;

namespace Filspresso.App;

/// <summary>3x PNGs rendered from the shared TSX glyphs; no package URI/SVG dependency.</summary>
public sealed class SharedIcon : UserControl
{
    private readonly Image _image = new();
    public static readonly DependencyProperty IconNameProperty = DependencyProperty.Register(nameof(IconName), typeof(string), typeof(SharedIcon), new PropertyMetadata("file", OnNameChanged));
    public static readonly DependencyProperty ToneProperty = DependencyProperty.Register(nameof(Tone), typeof(string), typeof(SharedIcon), new PropertyMetadata("normal", OnNameChanged));
    public string IconName { get => (string)GetValue(IconNameProperty); set => SetValue(IconNameProperty, value); }
    public string Tone { get => (string)GetValue(ToneProperty); set => SetValue(ToneProperty, value); }
    public SharedIcon() { Width = Height = 20; Content = _image; RenderIcon("file"); }
    private static void OnNameChanged(DependencyObject sender, DependencyPropertyChangedEventArgs args)
    {
        var icon = (SharedIcon)sender;
        icon.RenderIcon(icon.IconName);
    }
    private void RenderIcon(string name)
    {
        var safe = System.Text.RegularExpressions.Regex.IsMatch(name ?? string.Empty, "^[a-z]+$") ? name : "file";
        var path = Path.Combine(AppContext.BaseDirectory, "Assets", "Icons", $"{safe}{(Tone == "dark" ? "-dark" : string.Empty)}.png");
        if (!File.Exists(path)) path = Path.Combine(AppContext.BaseDirectory, "Assets", "Icons", "file.png");
        _image.Source = new BitmapImage(new Uri(path, UriKind.Absolute));
    }
}
