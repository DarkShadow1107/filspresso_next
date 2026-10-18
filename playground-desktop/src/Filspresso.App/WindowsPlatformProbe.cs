using System;
using Microsoft.Win32;
using Filspresso.Core.Platform;

namespace Filspresso.App;

/// <summary>
/// Reads the real machine's edition and build, then asks the shared rule.
/// </summary>
/// <remarks>
/// Deliberately does no deciding of its own. <see cref="PlatformRequirementCheck"/> holds the
/// rule and the installer asks the same type, so the two cannot disagree about what
/// "supported" means -- which is the failure mode of putting the rule in the installer alone
/// and having the app guess.
/// </remarks>
public static class WindowsPlatformProbe
{
    private const string CurrentVersionKey = @"SOFTWARE\Microsoft\Windows NT\CurrentVersion";

    /// <summary>
    /// The machine's edition and build, or a refusal that says the probe itself failed.
    /// </summary>
    /// <remarks>
    /// A failed probe refuses rather than proceeding. The alternative -- assuming Pro when the
    /// registry cannot be read -- would let the application start on a machine whose sandbox
    /// cannot work, and the user would find out from a VM error instead of an explanation.
    /// </remarks>
    public static PlatformRequirement CurrentRequirement()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(CurrentVersionKey);
            if (key is null)
            {
                return new PlatformRequirement(
                    "Unknown",
                    Supported: false,
                    Reason: "This machine's Windows edition could not be read, so it cannot be confirmed as supported.");
            }

            var edition = PlatformRequirementCheck.ParseEdition(
                key.GetValue("EditionID") as string,
                key.GetValue("InstallationType") as string);

            var build = key.GetValue("CurrentBuildNumber") as int? ?? 0;

            return PlatformRequirementCheck.Evaluate(build, edition);
        }
        catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException)
        {
            return new PlatformRequirement(
                "Unknown",
                Supported: false,
                Reason: "This machine's Windows edition could not be read, so it cannot be confirmed as supported.");
        }
    }
}