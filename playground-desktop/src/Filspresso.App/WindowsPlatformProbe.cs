using System;
using Microsoft.Win32;
using Filspresso.Core.Platform;

namespace Filspresso.App;

/// <summary>
/// The facts the application itself read from the machine, for its system check-in.
/// </summary>
/// <remarks>
/// Every field is nullable on purpose: a registry read that refused produces a null, and a
/// null travels to the server as "not reported". There is no zero-when-unknown path, because
/// a fabricated zero would read back on the account page as a real build or edition.
/// </remarks>
/// <param name="Edition">The recognised Windows edition name, or null when the SKU could not be interpreted.</param>
/// <param name="Build">The <c>CurrentBuildNumber</c> as a number, or null when it could not be read.</param>
/// <param name="Ubr">The update build revision (<c>UBR</c>), or null when the registry does not carry one.</param>
public sealed record WindowsSystemReport(string? Edition, int? Build, int? Ubr);

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

            // Read as a string and parsed: the registry value is a REG_SZ, and an `as int?`
            // on it yields null -- which would report every machine as build 0 and refuse
            // it as too old.
            int.TryParse(
                Convert.ToString(key.GetValue("CurrentBuildNumber"), System.Globalization.CultureInfo.InvariantCulture),
                out var build);

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

    /// <summary>
    /// The machine's own facts, read once, for the system check-in to the account.
    /// </summary>
    /// <remarks>
    /// A separate accessor from <see cref="CurrentRequirement"/> rather than extra fields on
    /// <see cref="PlatformRequirement"/>, because the two answer different questions: one is a
    /// decision with a reason, this is a report with no opinion. Nothing is asserted beyond
    /// what the registry answered -- an edition that cannot be interpreted is null, not
    /// "Unknown" shipped as a name.
    /// </remarks>
    public static WindowsSystemReport? TryReadSystemReport()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(CurrentVersionKey);
            if (key is null)
            {
                return null;
            }

            var edition = PlatformRequirementCheck.ParseEdition(
                key.GetValue("EditionID") as string,
                key.GetValue("InstallationType") as string);

            // Read as a string and parsed, same as CurrentRequirement: the registry value is
            // a REG_SZ, and an `as int?` on it yields null -- which would fabricate a null
            // build rather than reporting the real one.
            int.TryParse(
                Convert.ToString(key.GetValue("CurrentBuildNumber"), System.Globalization.CultureInfo.InvariantCulture),
                out var build);

            // UBR is a REG_DWORD in the same key. A machine that does not carry it (or carries
            // a unreadable value) reports no UBR rather than 0, because 0 would read back as
            // a plausible "no updates" state.
            var ubrValue = key.GetValue("UBR") is { } raw
                ? int.TryParse(Convert.ToString(raw, System.Globalization.CultureInfo.InvariantCulture), out var parsed)
                    ? parsed
                    : (int?)null
                : (int?)null;

            return new WindowsSystemReport(
                edition == WindowsEdition.Unknown ? null : edition.ToString(),
                build > 0 ? build : null,
                ubrValue);
        }
        catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException)
        {
            // Same refusal policy as CurrentRequirement: a probe that cannot read reports
            // "could not read", never a guess.
            return null;
        }
    }
}