using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Filspresso.App;

public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
    }

    private void OnAccountClick(object sender, RoutedEventArgs e)
    {
        // Phase 2 opens the sign-in and connect screen from here. Nothing is wired up in
        // Phase 1, and a button that silently does nothing is worse than an absent one.
        EntitlementBar.Message = "Sign-in arrives with Phase 2.";
        EntitlementBar.Severity = InfoBarSeverity.Informational;
        EntitlementBar.IsOpen = true;
    }
}