using System;
using System.Linq;
using Filspresso.Core.Platform;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>
/// The edition gate decides who can install the product, so it is tested exhaustively rather
/// than for the two cases somebody thought of.
/// </summary>
public class PlatformRequirementTests
{
    [Theory]
    [InlineData(19041, true)]   // Windows 10 2004, the floor
    [InlineData(19045, true)]
    [InlineData(22621, true)]   // Windows 11 22H2
    [InlineData(26100, true)]   // Windows 11 24H2
    [InlineData(19042, true)]   // 20H2, newer than the floor
    [InlineData(19043, true)]   // 21H1, newer than the floor
    [InlineData(19040, false)]  // Windows 10 1903, one build short
    [InlineData(18362, false)]  // Windows 10 1809
    [InlineData(0, false)]
    public void VersionFloorIsHonoured(int build, bool supported) =>
        Assert.Equal(supported, PlatformRequirementCheck.IsVersionSupported(build));

    [Theory]
    [InlineData("Professional", WindowsEdition.Pro)]
    [InlineData("ProfessionalEducation", WindowsEdition.ProEducation)]
    [InlineData("ProfessionalWorkstation", WindowsEdition.ProWorkstation)]
    [InlineData("Enterprise", WindowsEdition.Enterprise)]
    [InlineData("Education", WindowsEdition.Education)]
    [InlineData("IoTEnterprise", WindowsEdition.IoTEnterprise)]
    [InlineData("Home", WindowsEdition.Home)]
    [InlineData("HomeSingleLanguage", WindowsEdition.HomeSingleLanguage)]
    [InlineData("Server", WindowsEdition.Server)]
    public void EditionIdsMapToTheRightEnum(string editionId, WindowsEdition expected) =>
        Assert.Equal(expected, PlatformRequirementCheck.ParseEdition(editionId, null));

    [Fact]
    public void AnUnrecognisedSkuIsUnknownRatherThanOptimisticallyPro()
    {
        // A new edition id should be refused and reported, not waved through on the chance
        // that it is a capable one.
        Assert.Equal(WindowsEdition.Unknown, PlatformRequirementCheck.ParseEdition("BrandNewEdition", null));
        Assert.False(PlatformRequirementCheck.EditionSupportsHyperV(WindowsEdition.Unknown));
    }

    [Fact]
    public void CoreIsTreatedAsPro()
    {
        // Core is Windows 10 Pro for this purpose, and the registry sometimes reports it as
        // "Core" where a Pro machine would report "Professional".
        Assert.Equal(WindowsEdition.Pro, PlatformRequirementCheck.ParseEdition("Core", null));
        Assert.True(PlatformRequirementCheck.EditionSupportsHyperV(
            PlatformRequirementCheck.ParseEdition("Core", null)));
    }

    [Fact]
    public void WithoutAnEditionIdTheInstallationTypeCannotPromoteHome()
    {
        // "Client" means a consumer SKU, which has no Hyper-V role whatever else it says.
        var parsed = PlatformRequirementCheck.ParseEdition(null, "Client");
        Assert.Equal(WindowsEdition.Home, parsed);
        Assert.False(PlatformRequirementCheck.EditionSupportsHyperV(parsed));
    }

    [Fact]
    public void NothingAtAllIsUnknown()
    {
        var parsed = PlatformRequirementCheck.ParseEdition(null, null);
        Assert.Equal(WindowsEdition.Unknown, parsed);
        Assert.False(PlatformRequirementCheck.EditionSupportsHyperV(parsed));
    }

    [Theory]
    [InlineData(WindowsEdition.Pro)]
    [InlineData(WindowsEdition.ProEducation)]
    [InlineData(WindowsEdition.ProWorkstation)]
    [InlineData(WindowsEdition.Enterprise)]
    [InlineData(WindowsEdition.EnterpriseS)]
    [InlineData(WindowsEdition.Education)]
    [InlineData(WindowsEdition.IoTEnterprise)]
    public void EditionsWithHyperVAreSupported(WindowsEdition edition)
    {
        var result = PlatformRequirementCheck.Evaluate(22631, edition);
        Assert.True(result.Supported, result.Reason);
        Assert.Empty(result.Reason);
    }

    [Theory]
    [InlineData(WindowsEdition.Home)]
    [InlineData(WindowsEdition.HomeSingleLanguage)]
    public void HomeIsRefusedWithAnExplanationThatNamesTheRequirement(WindowsEdition edition)
    {
        var result = PlatformRequirementCheck.Evaluate(22631, edition);
        Assert.False(result.Supported);
        Assert.Contains("Home", result.Reason, StringComparison.OrdinalIgnoreCase);
        // The message has to say what would work, or the user is left with a refusal and no
        // idea what to do about it.
        Assert.Contains("Windows 10 Pro", result.Reason, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Windows 11 Pro", result.Reason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ServerIsRefusedDistinctlyFromHome()
    {
        var result = PlatformRequirementCheck.Evaluate(20348, WindowsEdition.Server);
        Assert.False(result.Supported);
        Assert.Contains("Server", result.Reason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void AnOldBuildIsRefusedBeforeTheEditionIsEvenConsidered()
    {
        // A Home machine on an old build should hear about the version first: that is the
        // requirement they could actually satisfy.
        var result = PlatformRequirementCheck.Evaluate(17763, WindowsEdition.Home);
        Assert.False(result.Supported);
        Assert.Contains("2004", result.Reason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ASupportedMachineReportsNoReason()
    {
        var result = PlatformRequirementCheck.Evaluate(26100, PlatformRequirementCheck.ParseEdition("Professional", null));
        Assert.True(result.Supported);
        Assert.Equal("Pro", result.Edition);
    }
}