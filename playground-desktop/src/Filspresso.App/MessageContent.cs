using System;
using System.Text.RegularExpressions;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using Windows.ApplicationModel.DataTransfer;

namespace Filspresso.App;

/// <summary>Safe native rendering of paragraphs and fenced code; model text is never executed.</summary>
public sealed class MessageContent : StackPanel
{
    public static readonly DependencyProperty TextProperty = DependencyProperty.Register(nameof(Text), typeof(string), typeof(MessageContent), new PropertyMetadata(string.Empty, OnChanged));
    public static readonly DependencyProperty TextSizeProperty = DependencyProperty.Register(nameof(TextSize), typeof(int), typeof(MessageContent), new PropertyMetadata(15, OnChanged));
    public string Text { get => (string)GetValue(TextProperty); set => SetValue(TextProperty, value); }
    public int TextSize { get => (int)GetValue(TextSizeProperty); set => SetValue(TextSizeProperty, value); }
    private static void OnChanged(DependencyObject sender, DependencyPropertyChangedEventArgs args) => ((MessageContent)sender).Render();

    private void Render()
    {
        Children.Clear(); Spacing = 12;
        var parts = Regex.Split(Text ?? string.Empty, @"```([^\r\n`]*)\r?\n([\s\S]*?)(?:```|$)");
        for (var index = 0; index < parts.Length; index++)
        {
            if (index % 3 == 1) continue;
            if (index % 3 == 2) { Children.Add(Code(parts[index - 1], parts[index].TrimEnd('\r', '\n'))); continue; }
            if (string.IsNullOrWhiteSpace(parts[index])) continue;
            var block = new RichTextBlock { FontSize = TextSize, IsTextSelectionEnabled = true, TextWrapping = TextWrapping.Wrap, Foreground = (Brush)Application.Current.Resources["FilspressoText"] };
            foreach (var text in Regex.Split(parts[index], @"\r?\n\s*\r?\n"))
            {
                if (string.IsNullOrWhiteSpace(text)) continue;
                var paragraph = new Paragraph { Margin = new Thickness(0, 0, 0, 12) };
                var heading = Regex.Match(text, @"^#{1,3}\s+(.+)$");
                var content = heading.Success ? heading.Groups[1].Value : text;
                foreach (var part in Regex.Split(content, @"(\*\*[^*]+\*\*|`[^`]+`)"))
                {
                    var run = new Run { Text = part };
                    if (part.StartsWith("**", StringComparison.Ordinal) && part.EndsWith("**", StringComparison.Ordinal)) { run.Text = part[2..^2]; run.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold; }
                    else if (part.StartsWith('`') && part.EndsWith('`')) { run.Text = part[1..^1]; run.FontFamily = new FontFamily("Consolas"); run.Foreground = (Brush)Application.Current.Resources["FilspressoAccent"]; }
                    if (heading.Success) { run.FontSize = TextSize + 3; run.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold; }
                    paragraph.Inlines.Add(run);
                }
                block.Blocks.Add(paragraph);
            }
            Children.Add(block);
        }
    }

    private static Border Code(string language, string code)
    {
        var layout = new StackPanel();
        var header = new Grid { Padding = new Thickness(12, 7, 12, 7), Background = (Brush)Application.Current.Resources["FilspressoSurface"] };
        header.Children.Add(new TextBlock { Text = string.IsNullOrWhiteSpace(language) ? "Code" : language.Trim(), FontSize = 11, VerticalAlignment = VerticalAlignment.Center, Foreground = (Brush)Application.Current.Resources["FilspressoMuted"] });
        var copy = new Button { Content = "Copy code", FontSize = 10, HorizontalAlignment = HorizontalAlignment.Right, Style = (Style)Application.Current.Resources["QuietButtonStyle"], Padding = new Thickness(8, 4, 8, 4) };
        copy.Click += (_, _) => { var data = new DataPackage(); data.SetText(code); Clipboard.SetContent(data); };
        header.Children.Add(copy); layout.Children.Add(header);
        layout.Children.Add(new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Enabled,
            VerticalScrollMode = ScrollMode.Disabled,
            Content = new TextBlock { Text = code, FontFamily = new FontFamily("Cascadia Code, Consolas"), FontSize = 12, Padding = new Thickness(14), IsTextSelectionEnabled = true },
        });
        return new Border { Child = layout, CornerRadius = new CornerRadius(10), BorderThickness = new Thickness(1), BorderBrush = (Brush)Application.Current.Resources["FilspressoBorder"], Background = (Brush)Application.Current.Resources["FilspressoSubtleSurface"] };
    }
}
