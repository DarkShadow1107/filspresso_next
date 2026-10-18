using System;
using Microsoft.UI.Xaml;

namespace Filspresso.App;

/// <summary>
/// Process entry point.
/// </summary>
/// <remarks>
/// The single responsibility here is the platform check, and it happens before any window
/// exists. The installer already refuses Windows Home, so reaching this point on Home means
/// the installer was bypassed -- a copied payload, a repackaged MSI, a Home machine upgraded
/// after install. Re-checking costs one registry read and turns a confusing failure (a blank
/// window, or a sandbox that cannot start) into an explanation.
/// </remarks>
public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();

        // No bootstrapper initialisation here, and that is deliberate.
        //
        // The project sets WindowsAppSDKSelfContained, so the Windows App SDK runtime ships
        // inside the application rather than being resolved from the machine. An unpackaged
        // app that is *not* self-contained has to call DynamicDependency.Bootstrap.Initialize
        // before creating a window, or it throws at startup with a message that does not
        // mention the SDK at all. Shipping self-contained is the reason the MSI can install
        // the runtime for us instead of relying on it being present, and it removes a whole
        // class of "works on the dev box" failure.
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var requirement = WindowsPlatformProbe.CurrentRequirement();

        _window = requirement.Supported
            ? new MainWindow()
            : new UnsupportedPlatformWindow(requirement);

        _window.Activate();
    }
}