using System;
using System.Threading.Tasks;
using Filspresso.App;
using Filspresso.Core.Api;
using Filspresso.Core.Auth;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>
/// The credential store, against the real Windows Credential Manager.
/// </summary>
/// <remarks>
/// The Win32 interop cannot be tested with a fake, and a fake would be exactly the wrong
/// thing to trust here: the whole point of this store is that the blob is encrypted by
/// DPAPI and that only the same user on the same machine can read it back. A test that
/// substituted the storage would prove nothing about the storage.
/// <para>
/// A private target name per run keeps the test off any real user's session, and the
/// finally block removes it either way.
/// </para>
/// </remarks>
public class WindowsCredentialStoreTests
{
    [Fact]
    public async Task SessionRoundTripsThroughWindowsCredentialManager()
    {
        var store = new WindowsCredentialStore($"Filspresso.Playground.Tests.{Guid.NewGuid():N}");
        try
        {
            Assert.Null(await store.LoadAsync());

            var session = StoredSession.From(
                new DesktopTokenResponse
                {
                    AccessToken = "test-access",
                    RefreshToken = "test-refresh",
                    ExpiresIn = 900,
                    RefreshExpiresIn = 3600,
                },
                "test@example.test",
                "test-device-1234567890",
                DateTimeOffset.UtcNow);

            await store.SaveAsync(session);
            Assert.Equal(session, await store.LoadAsync());

            await store.ClearAsync();
            Assert.Null(await store.LoadAsync());

            // Clearing again must succeed: there is nothing to delete, and that is not an
            // error.
            await store.ClearAsync();
        }
        finally
        {
            await store.ClearAsync();
        }
    }

    [Fact]
    public async Task TheDeviceIdIsStableAcrossCalls()
    {
        var store = new WindowsCredentialStore($"Filspresso.Playground.Tests.{Guid.NewGuid():N}");
        try
        {
            var first = await store.GetOrCreateDeviceIdAsync();
            var second = await store.GetOrCreateDeviceIdAsync();

            Assert.Equal(first, second);
            // The shape the server accepts, so a stored id can never be one it refuses.
            Assert.True(Core.Platform.DeviceIdentity.IsWellFormed(first));
        }
        finally
        {
            await store.ClearAsync();
        }
    }
}
