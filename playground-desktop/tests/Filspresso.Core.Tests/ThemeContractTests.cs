using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>
/// The theme's resources must exist before anything can use them.
/// </summary>
/// <remarks>
/// WinUI resolves a <c>StaticResource</c> when the XAML is parsed, and a resource that
/// does not exist is a parse failure rather than a missing brush: the whole window
/// refuses to open. That is a spectacular way to learn that a brush was renamed, and
/// it happens at run time rather than at build time.
/// <para>
/// So the contract is checked here: every custom resource the application's XAML
/// references is defined in App.xaml, and the palette itself names the Filspresso
/// colours. A rename that misses one file fails the build instead of the
/// customer's first launch.
/// </para>
/// </remarks>
public sealed class ThemeContractTests
{
    private static string AppDirectory()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "src", "Filspresso.App");
            if (Directory.Exists(candidate)) return candidate;
            directory = directory.Parent;
        }
        throw new DirectoryNotFoundException("Could not locate src/Filspresso.App above the test output.");
    }

    private static string[] XamlFiles() =>
        Directory.GetFiles(AppDirectory(), "*.xaml", SearchOption.TopDirectoryOnly);

    [Fact]
    public void EveryCustomResourceTheApplicationUsesIsDefined()
    {
        var app = File.ReadAllText(Path.Combine(AppDirectory(), "App.xaml"));
        var defined = Regex.Matches(app, @"x:Key=""(?<key>[\w]+)""")
            .Select(match => match.Groups["key"].Value)
            .ToHashSet(StringComparer.Ordinal);

        var referenced = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in XamlFiles())
        {
            var text = File.ReadAllText(file);
            foreach (Match match in Regex.Matches(text, @"\{StaticResource\s+(?<key>[\w]+)\}"))
            {
                var key = match.Groups["key"].Value;
                if (key.StartsWith("Filspresso", StringComparison.Ordinal) ||
                    key is "RailButtonStyle" or "QuietButtonStyle" or "CopperButtonStyle" or "ComposerTextBoxStyle")
                {
                    referenced.Add(key);
                }
            }
        }

        Assert.NotEmpty(referenced);
        foreach (var key in referenced)
        {
            Assert.True(defined.Contains(key), $"{key} is used by the XAML but not defined in App.xaml");
        }
    }

    [Fact]
    public void ThePaletteIsTheFilspressoOne()
    {
        var app = File.ReadAllText(Path.Combine(AppDirectory(), "App.xaml"));
        // The copper and cream the site uses, so the native client is recognisably the
        // same product rather than a dark-mode copy of something else.
        Assert.Contains("#E4B38A", app, StringComparison.Ordinal);
        Assert.Contains("#F2E5DC", app, StringComparison.Ordinal);
        Assert.Contains("#100F10", app, StringComparison.Ordinal);
    }

    [Fact]
    public void TheApplicationAsksForTheDarkThemeAndTheBundledFont()
    {
        var app = File.ReadAllText(Path.Combine(AppDirectory(), "App.xaml"));
        Assert.Contains("RequestedTheme=\"Dark\"", app, StringComparison.Ordinal);
        Assert.Contains("Assets/Fonts/Poppins-Regular.ttf", app, StringComparison.Ordinal);
        Assert.Contains("Assets/Fonts/Poppins-SemiBold.ttf", app, StringComparison.Ordinal);
    }

    [Fact]
    public void TheBundledFontsAreShippedWithTheApplication()
    {
        // The fonts live in the repository's web assets, and the application copies
        // them. A missing copy means the app silently falls back to Segoe UI, which
        // looks like a different product.
        var project = File.ReadAllText(Path.Combine(AppDirectory(), "Filspresso.App.csproj"));
        Assert.Contains("Poppins-Regular.ttf", project, StringComparison.Ordinal);
        Assert.Contains("Poppins-SemiBold.ttf", project, StringComparison.Ordinal);
        Assert.Contains("CopyToOutputDirectory=\"PreserveNewest\"", project, StringComparison.Ordinal);
    }

    [Fact]
    public void ComposerOffersRealPlanBuildNavigationAndCompactIconImports()
    {
        var xaml = XDocument.Load(Path.Combine(AppDirectory(), "PlaygroundPage.xaml"));
        var picker = Assert.Single(xaml.Descendants(), element => element.Attribute("SelectionChanged")?.Value == "OnChatModeChanged");
        Assert.Equal("ChoicePicker", picker.Name.LocalName);
        Assert.Equal("Chat|Plan|Build", picker.Attribute("Options")?.Value);
        var imports = xaml.Descendants().Where(element => element.Name.LocalName == "MenuFlyoutItem" && element.Attribute("Click")?.Value == "OnAttachFiles").ToArray();
        Assert.Equal(8, imports.Length);
        Assert.All(imports, item => Assert.Contains(item.Elements(), child => child.Name.LocalName == "MenuFlyoutItem.Icon"));
        var shell = File.ReadAllText(Path.Combine(AppDirectory(), "MainWindow.xaml.cs"));
        Assert.Contains("AgentModeRequested += OnAgentMode", shell, StringComparison.Ordinal);
        Assert.Contains("SelectMode(mode == \"build\")", shell, StringComparison.Ordinal);
    }

    [Fact]
    public void AgentSetupIsProgressivelyDisclosedWithoutRemovingApprovalGates()
    {
        var xaml = File.ReadAllText(Path.Combine(AppDirectory(), "AgentWorkspacePage.xaml"));
        Assert.Contains("x:Name=\"WorkspaceSetup\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Header=\"Project &amp; changes\"", xaml, StringComparison.Ordinal);
        foreach (var control in new[] { "VerifySandboxButton", "EnableExecutionButton", "ReviewedAction", "ApprovalBorder", "QuestionBorder" })
            Assert.Contains($"x:Name=\"{control}\"", xaml, StringComparison.Ordinal);
        var code = File.ReadAllText(Path.Combine(AppDirectory(), "AgentWorkspacePage.xaml.cs"));
        Assert.Contains("ModeBox.SelectedIndex != 1 || started", code, StringComparison.Ordinal);
        Assert.Contains("WindowsPlatformProbe.TryReadSystemReport()", code, StringComparison.Ordinal);
    }

    [Fact]
    public void InstructionsAreDesktopSpecificAndUpdatesAppearInTheShell()
    {
        var help = File.ReadAllText(Path.Combine(AppDirectory(), "InstructionsPage.xaml"));
        Assert.Contains("Windows desktop guide", help, StringComparison.Ordinal);
        Assert.Contains("System &amp; updates", help, StringComparison.Ordinal);
        Assert.Contains("Check for updates", help, StringComparison.Ordinal);
        var code = File.ReadAllText(Path.Combine(AppDirectory(), "InstructionsPage.xaml.cs"));
        Assert.Contains("WindowsPlatformProbe.TryReadSystemReport()", code, StringComparison.Ordinal);
        Assert.Contains("Updates.RefreshAsync(force: true)", code, StringComparison.Ordinal);
        var shell = File.ReadAllText(Path.Combine(AppDirectory(), "MainWindow.xaml"));
        Assert.Contains("x:Name=\"UpdateBar\"", shell, StringComparison.Ordinal);
        Assert.Contains("Click=\"OnToggleNavigation\"", shell, StringComparison.Ordinal);
        Assert.Contains("IconName=\"help\"", shell, StringComparison.Ordinal);
    }

    [Fact]
    public void SharedIconsUsePublishedRasterAssetsWithoutPackageUriResolution()
    {
        var code = File.ReadAllText(Path.Combine(AppDirectory(), "SharedIcon.cs"));
        Assert.Contains("AppContext.BaseDirectory", code, StringComparison.Ordinal);
        Assert.Contains("new BitmapImage", code, StringComparison.Ordinal);
        Assert.DoesNotContain("ms-appx:", code, StringComparison.Ordinal);
        var project = File.ReadAllText(Path.Combine(AppDirectory(), "Filspresso.App.csproj"));
        Assert.Contains("shared-icons\\*.png", project, StringComparison.Ordinal);
        var picker = File.ReadAllText(Path.Combine(AppDirectory(), "ChoicePicker.cs"));
        Assert.Contains("new MenuFlyout", picker, StringComparison.Ordinal);
        Assert.DoesNotContain("Chevron", picker, StringComparison.Ordinal);
    }

    [Fact]
    public void PackageBuildStampsAndChecksTheApplicationVersionAndRasterAssets()
    {
        var build = File.ReadAllText(Path.Combine(AppDirectory(), "..", "..", "build", "Build-Desktop.ps1"));
        Assert.Contains("-p:Version=$ProductVersion", build, StringComparison.Ordinal);
        Assert.Contains("$applicationVersion -ne $ProductVersion", build, StringComparison.Ordinal);
        Assert.Contains("Missing or stale desktop icon", build, StringComparison.Ordinal);
        Assert.Contains("InstructionsPage.xbf", build, StringComparison.Ordinal);
    }
}
