namespace Filspresso.Core.Platform;

/// <summary>The Windows editions we recognise, as the installer reads them.</summary>
/// <remarks>
/// Values are the second field of <c>CurrentBuild</c>'s sibling registry value
/// <c>EditionID</c>, or the <c>InstallationType</c> string when there is no edition id. Both
/// come from
/// <c>HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion</c>.
/// </remarks>
public enum WindowsEdition
{
    Unknown = 0,
    Home,
    HomeSingleLanguage,
    Pro,
    ProEducation,
    ProWorkstation,
    Enterprise,
    EnterpriseS,
    Education,
    IoTEnterprise,
    /// <summary>A SKU with no Hyper-V role. Server is not a supported target at all.</summary>
    Server,
}

/// <summary>Why a machine was refused, in the words the installer should show.</summary>
public sealed record PlatformRequirement(string Edition, bool Supported, string Reason);

/// <summary>
/// The decision: may this application be installed, and may it run?
/// </summary>
/// <remarks>
/// This lives in Core, away from the registry, so that the rule can be tested without a
/// Windows machine and so that the installer and the application cannot drift into
/// disagreeing about what "supported" means. Both ask this type; neither reimplements it.
/// <para>
/// <b>Why the edition is a requirement at all.</b> The sandbox is a Hyper-V VM. Windows Home
/// has no Hyper-V role, so there is no supported way to give generated code a real boundary.
/// The honest choices are to block Home or to run the agent with a weaker sandbox on a large
/// share of machines, and this picks the first.
/// </para>
/// <para>
/// That is a product decision with a cost — it excludes every Home user — not a technical
/// inevitability. If it is ever revisited, it is this type that should change, and both the
/// installer and the app should change with it.
/// </para>
/// </remarks>
public static class PlatformRequirementCheck
{
    /// <summary>Windows 10 2004 / build 19041. The floor for the Windows App SDK 1.6 runtime.</summary>
    public const int MinimumBuild = 19041;

    /// <summary>
    /// Whether the OS version is new enough, regardless of edition.
    /// </summary>
    public static bool IsVersionSupported(int build) => build >= MinimumBuild;

    /// <summary>
    /// Whether this edition carries the Hyper-V role.
    /// </summary>
    /// <remarks>
    /// <c>Core</c> is treated as supported: it is Windows 10 Pro for the purposes of this
    /// check, and the edition id for it is not reliably distinct from Pro's on every build.
    /// <c>Server</c> is refused explicitly rather than falling into the unsupported bucket,
    /// because the sandbox design assumes an interactive desktop session.
    /// </remarks>
    public static bool EditionSupportsHyperV(WindowsEdition edition) => edition switch
    {
        WindowsEdition.Pro => true,
        WindowsEdition.ProEducation => true,
        WindowsEdition.ProWorkstation => true,
        WindowsEdition.Enterprise => true,
        WindowsEdition.EnterpriseS => true,
        WindowsEdition.Education => true,
        WindowsEdition.IoTEnterprise => true,
        WindowsEdition.Home => false,
        WindowsEdition.HomeSingleLanguage => false,
        WindowsEdition.Server => false,
        _ => false,
    };

    /// <summary>
    /// Maps a registry edition id to the enum. Unknown values stay unknown rather than being
    /// optimistically treated as Pro: a new SKU should be refused and someone told, not
    /// waved through.
    /// </summary>
    public static WindowsEdition ParseEdition(string? editionId, string? installationType)
    {
        if (!string.IsNullOrWhiteSpace(editionId))
        {
            return editionId.Trim() switch
            {
                "Home" => WindowsEdition.Home,
                "HomeSingleLanguage" => WindowsEdition.HomeSingleLanguage,
                "Professional" => WindowsEdition.Pro,
                "ProfessionalEducation" or "ProfessionalEducationN" => WindowsEdition.ProEducation,
                "ProfessionalWorkstation" => WindowsEdition.ProWorkstation,
                "Enterprise" or "EnterpriseN" => WindowsEdition.Enterprise,
                "EnterpriseS" or "EnterpriseSN" => WindowsEdition.EnterpriseS,
                "Education" or "EducationN" => WindowsEdition.Education,
                "IoTEnterprise" => WindowsEdition.IoTEnterprise,
                "Server" => WindowsEdition.Server,
                "Core" => WindowsEdition.Pro,
                _ => WindowsEdition.Unknown,
            };
        }

        // No edition id at all. The installation type is the only signal left, and it is a
        // poor one -- but it is better than refusing every machine on a build that omits the
        // value, and it still cannot promote Home, whose type is "Client".
        if (!string.IsNullOrWhiteSpace(installationType))
        {
            return installationType.Trim() switch
            {
                "Client" => WindowsEdition.Home,
                "Server" or "Server Core" => WindowsEdition.Server,
                _ => WindowsEdition.Unknown,
            };
        }

        return WindowsEdition.Unknown;
    }

    /// <summary>
    /// The full decision, with a sentence fit to put in front of a user.
    /// </summary>
    public static PlatformRequirement Evaluate(int build, WindowsEdition edition)
    {
        if (!IsVersionSupported(build))
        {
            return new PlatformRequirement(
                edition.ToString(),
                Supported: false,
                Reason: $"Filspresso Playground needs Windows 10 version 2004 (build {MinimumBuild}) or newer. " +
                        $"This machine reports build {build}.");
        }

        if (!EditionSupportsHyperV(edition))
        {
            var why = edition is WindowsEdition.Home or WindowsEdition.HomeSingleLanguage
                ? "Windows Home does not include the Hyper-V role."
                : edition == WindowsEdition.Server
                    ? "Windows Server is not a supported target."
                    : $"The {edition} edition is not a recognised supported edition.";

            return new PlatformRequirement(
                edition.ToString(),
                Supported: false,
                Reason: why + " The Playground sandboxes generated code in a Hyper-V virtual machine, " +
                             "and there is no supported way to provide that boundary on this edition. " +
                             "Windows 10 Pro and Windows 11 Pro are supported.");
        }

        return new PlatformRequirement(edition.ToString(), Supported: true, Reason: string.Empty);
    }
}