using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;

namespace Filspresso.App;

/// <summary>SVGs rendered at build time from the actual src/icons TSX components.</summary>
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
    private void RenderIcon(string name) => _image.Source = new SvgImageSource(new Uri($"ms-appx:///Assets/Icons/{name}{(Tone == "dark" ? "-dark" : string.Empty)}.svg"));
}
