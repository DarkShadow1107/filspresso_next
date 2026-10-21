using System;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Filspresso.Core.Platform;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>
/// The installer and the application must agree about which Windows editions are supported.
/// </summary>
/// <remarks>
/// They cannot share one implementation: the installer is an MSI, evaluated by Windows Installer
/// before anything is installed, and the application is managed code. So the rule is written
/// twice, and this test is what stops the two copies from drifting.
///
/// This is the same arrangement used for the Playground's model catalogue, and for the same
/// reason: a duplicated list that no test ties together is a list that will be wrong in one
/// place within a year.
/// </remarks>
public class InstallerContractTests
{
    private static readonly XNamespace Wxs = "http://wixtoolset.org/schemas/v4/wxs";

    private static string InstallerPath()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "installer", "Filspresso.Installer.wxs");
            if (File.Exists(candidate))
            {
                return candidate;
            }

            directory = directory.Parent;
        }

        throw new FileNotFoundException("Could not locate installer/Filspresso.Installer.wxs above the test output.");
    }

    private static XDocument Load() => XDocument.Load(InstallerPath());

    [Fact]
    public void TheFolderChooserSelectsAParentAndTheAppAlwaysHasItsOwnFolder()
    {
        var document = Load();
        XNamespace ui = "http://wixtoolset.org/schemas/v4/wxs/ui";
        var wizard = document.Descendants(ui + "WixUI").Single();
        Assert.Equal("WixUI_InstallDir", wizard.Attribute("Id")?.Value);
        Assert.Equal("INSTALLROOT", wizard.Attribute("InstallDirectory")?.Value);
        var app = document.Descendants(Wxs + "Directory").Single(element => (string?)element.Attribute("Id") == "INSTALLFOLDER");
        Assert.Equal("Filspresso Playground", app.Attribute("Name")?.Value);
        Assert.Equal("INSTALLROOT", app.Parent?.Attribute("Id")?.Value);
    }

    [Fact]
    public void FullRemovalCleansUserDataButMajorUpgradesDoNot()
    {
        var document = Load();
        var cleanup = document.Descendants(Wxs + "CustomAction").Single(element => (string?)element.Attribute("Id") == "CleanupUserData");
        Assert.Equal("MaintenanceExe", cleanup.Attribute("FileRef")?.Value);
        Assert.Equal("--cleanup-user-data", cleanup.Attribute("ExeCommand")?.Value);
        Assert.Equal("yes", cleanup.Attribute("Impersonate")?.Value);
        var scheduled = document.Descendants(Wxs + "Custom").Single(element => (string?)element.Attribute("Action") == "CleanupUserData");
        Assert.Contains("REMOVE = \"ALL\"", scheduled.Attribute("Condition")!.Value, StringComparison.Ordinal);
        Assert.Contains("NOT UPGRADINGPRODUCTCODE", scheduled.Attribute("Condition")!.Value, StringComparison.Ordinal);
        Assert.Equal("RemoveFiles", scheduled.Attribute("Before")?.Value);
        Assert.Contains("Uninstall.exe", document.Descendants(Wxs + "File").Single(element => (string?)element.Attribute("Id") == "MaintenanceExe").Attribute("Source")!.Value, StringComparison.Ordinal);
    }

    [Fact]
    public void NativeCleanupAndTheAppUseTheSameOwnedDirectoriesAndCredentialTargets()
    {
        var installerDirectory = Path.GetDirectoryName(InstallerPath())!;
        var native = File.ReadAllText(Path.Combine(installerDirectory, "native", "Maintenance.cpp"));
        var header = File.ReadAllText(Path.Combine(installerDirectory, "native", "Maintenance.h"));
        Assert.Contains(Core.Storage.DesktopDataPaths.CredentialPrefix, header, StringComparison.Ordinal);
        Assert.Contains("/session", native, StringComparison.Ordinal);
        Assert.Contains("/device-id", native, StringComparison.Ordinal);
        Assert.Contains("FOLDERID_LocalAppData", native, StringComparison.Ordinal);
        Assert.Contains("FOLDERID_RoamingAppData", native, StringComparison.Ordinal);
        Assert.Contains("FILE_ATTRIBUTE_REPARSE_POINT", native, StringComparison.Ordinal);
        Assert.Contains("NOT UPGRADINGPRODUCTCODE", Load().ToString(), StringComparison.Ordinal);
    }

    /// <summary>The edition ids the installer's condition accepts.</summary>
    private static string[] InstallerAcceptedEditions()
    {
        var document = Load();
        var xml = document.ToString();

        // The accepted set is spelled out as OR'd comparisons against EDITIONOK. Reading them
        // back out of the text is what makes this a contract test rather than a restatement:
        // if someone deletes an edition from the installer, this fails.
        return System.Text.RegularExpressions.Regex
            .Matches(xml, @"FILSPRESSO_EDITION\s*=\s*&quot;(?<id>[A-Za-z]+)&quot;")
            .Select(m => m.Groups["id"].Value)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(v => v, StringComparer.Ordinal)
            .ToArray();
    }

    [Fact]
    public void TheInstallerIsAnMsiAndNotAnMsix()
    {
        // The packaging decision is load-bearing enough to pin. An MSIX will not install from
        // an untrusted certificate at all, and cannot express an edition requirement.
        var xml = Load().ToString();
        Assert.Contains("http://wixtoolset.org/schemas/v4/wxs", xml, StringComparison.Ordinal);
        Assert.DoesNotContain("AppxManifest", xml, StringComparison.Ordinal);
        Assert.DoesNotContain("windows.appxmanifest", xml, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void TheInstallerRefusesBeforeWritingAnything()
    {
        var launch = Load().Descendants(Wxs + "Launch").Single();
        var condition = launch.Attribute("Condition")!.Value;

        // `Installed` first, so an upgrade or a repair over an existing install is never
        // blocked by the edition check. Refusing to update someone's working install because
        // they are on Home would be a different bug, not the same one handled twice.
        Assert.StartsWith("Installed OR", condition, StringComparison.Ordinal);

        // The real build number, not VersionNT, which saturates at 603 and cannot tell 19041
        // from 26100.
        Assert.Contains("FILSPRESSO_BUILD", condition, StringComparison.Ordinal);
        Assert.Contains("19041", condition, StringComparison.Ordinal);

        // The editions are enumerated rather than reduced to a flag, so the set is visible to
        // anyone auditing the installer instead of hidden behind a custom action.
        Assert.Contains("FILSPRESSO_EDITION", condition, StringComparison.Ordinal);
        Assert.NotEmpty(InstallerAcceptedEditions());
    }

    [Fact]
    public void TheGateIsOneConditionRatherThanTwo()
    {
        // Two launch conditions failing on the same machine give two explanations for one
        // problem, and the user sees whichever Windows Installer reaches first.
        Assert.Single(Load().Descendants(Wxs + "Launch"));
    }

    [Fact]
    public void TheRefusalMessageSaysWhatIsSupportedAndWhy()
    {
        // A user refused by an installer deserves to know which editions would work and the
        // reason, not just a failure.
        var launch = Load().Descendants(Wxs + "Launch").Single();
        var message = launch.Attribute("Message")!.Value;

        Assert.Contains("Windows 10 Pro", message, StringComparison.Ordinal);
        Assert.Contains("Windows 11 Pro", message, StringComparison.Ordinal);
        Assert.Contains("Hyper-V", message, StringComparison.Ordinal);
    }

    [Fact]
    public void HomeIsNotAmongTheEditionsTheInstallerAccepts()
    {
        var accepted = InstallerAcceptedEditions();
        Assert.DoesNotContain("Home", accepted);
        Assert.DoesNotContain("HomeSingleLanguage", accepted);
        // Core is the consumer SKU. If the installer ever accepts it, the requirement stops
        // meaning anything on exactly the machines it was written for.
        Assert.DoesNotContain("Core", accepted);
        Assert.DoesNotContain("CoreN", accepted);
        Assert.DoesNotContain("CoreSingleLanguage", accepted);
    }

    [Fact]
    public void TheInstallerAndTheApplicationAgreeOnEveryEdition()
    {
        // The actual contract: every edition the application supports must be accepted by the
        // installer, and every edition it refuses must not be.
        var accepted = InstallerAcceptedEditions();

        foreach (var edition in Enum.GetValues<WindowsEdition>())
        {
            // Unknown is not an edition id, so it cannot appear in an equality test.
            if (edition == WindowsEdition.Unknown)
            {
                continue;
            }

            var registryId = RegistryIdFor(edition);
            var supportedByApp = PlatformRequirementCheck.EditionSupportsHyperV(edition);
            var acceptedByInstaller = accepted.Contains(registryId, StringComparer.Ordinal);

            Assert.True(
                supportedByApp == acceptedByInstaller,
                $"disagreement on {edition} (registry id '{registryId}'): " +
                $"application says {(supportedByApp ? "supported" : "refused")}, " +
                $"installer says {(acceptedByInstaller ? "accepted" : "refused")}");
        }
    }

    /// <summary>The registry value the installer matches against, per edition.</summary>
    private static string RegistryIdFor(WindowsEdition edition) => edition switch
    {
        WindowsEdition.Pro => "Professional",
        WindowsEdition.ProEducation => "ProfessionalEducation",
        WindowsEdition.ProWorkstation => "ProfessionalWorkstation",
        WindowsEdition.Enterprise => "Enterprise",
        WindowsEdition.EnterpriseS => "EnterpriseS",
        WindowsEdition.Education => "Education",
        WindowsEdition.IoTEnterprise => "IoTEnterprise",
        WindowsEdition.Home => "Home",
        WindowsEdition.HomeSingleLanguage => "HomeSingleLanguage",
        WindowsEdition.Server => "Server",
        _ => throw new ArgumentOutOfRangeException(nameof(edition), edition, "no registry id"),
    };
}
