using System;
using System.IO;
using Filspresso.Core.Storage;
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
        UnhandledException += (_, args) => RecordFailure(args.Exception);
        DebugSettings.XamlResourceReferenceFailed += (_, args) => RecordFailure(new InvalidOperationException(args.Message));
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
        try
        {
            var requirement = WindowsPlatformProbe.CurrentRequirement();

            _window = requirement.Supported
                ? new MainWindow()
                : new UnsupportedPlatformWindow(requirement);

            _window.AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "Filspresso.ico"));
            _window.Activate();
        }
        catch (Exception error)
        {
            RecordFailure(error);
            throw;
        }
    }

    private static void RecordFailure(Exception error)
    {
        try
        {
            var directory = Environment.GetEnvironmentVariable("FILSPRESSO_PROFILE_DIR") ?? DesktopDataPaths.UserDataDirectory;
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, "last-error.log");
            if (File.Exists(path) && new FileInfo(path).Length > 64 * 1024) File.Delete(path);
            File.AppendAllText(path, $"{DateTimeOffset.UtcNow:O} {error} HRESULT={error.HResult:X8}{Environment.NewLine}");
            foreach (System.Collections.DictionaryEntry item in error.Data)
                File.AppendAllText(path, $"{item.Key}: {item.Value}{Environment.NewLine}");
        }
        catch (Exception failure) when (failure is IOException or UnauthorizedAccessException) { }
    }
}
