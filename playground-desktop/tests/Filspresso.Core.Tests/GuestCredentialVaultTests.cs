using System;
using System.Threading.Tasks;
using Filspresso.Sandbox;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>
/// Validation and the not-configured/null path of the credential-vault reader. Writing test
/// rows into the real Windows Credential Manager is out of scope here on purpose: the
/// application never writes the vault, and the operator provisioned rows are covered by the
/// qualification script instead.
/// </summary>
public sealed class GuestCredentialVaultTests
{
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void EmptyTargetsAreRejected(string target) =>
        Assert.Throws<ArgumentException>(() => Filspresso.Core.Storage.GenericCredentialVault.Read(target));

    [Fact]
    public void OversizedTargetsAreRejected() =>
        Assert.Throws<ArgumentException>(() => Filspresso.Core.Storage.GenericCredentialVault.Read(new string('a', 256)));

    [Fact]
    public async Task UnprovisionedTargetsReadAsNullWithoutThrowing()
    {
        var provider = new VaultGuestCredentials("Filspresso.Tests.Probe." + Guid.NewGuid().ToString("N"));
        Assert.Null(await provider.GetCredentialAsync());
    }

    [Fact]
    public async Task OmittedTargetsFallBackToTheDocumentedDefault()
    {
        // The default row is operator-provisioned on qualified machines. Where present it
        // must surface intact; where absent it must read as null, never as an access failure.
        var value = await new VaultGuestCredentials().GetCredentialAsync();
        if (value is { } credential)
        {
            Assert.NotEqual(string.Empty, credential.UserName);
            Assert.NotEqual(string.Empty, credential.Password);
        }
    }
}
