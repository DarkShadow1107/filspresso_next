using Filspresso.Core.Platform;
using Microsoft.UI.Xaml;

namespace Filspresso.App;

public sealed partial class UnsupportedPlatformWindow : Window
{
    public UnsupportedPlatformWindow(PlatformRequirement requirement)
    {
        InitializeComponent();
        Reason.Text = requirement.Reason;
        Title = "Filspresso Playground";
    }
}