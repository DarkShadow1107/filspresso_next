using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Filspresso.Sandbox;
using Xunit;

namespace Filspresso.Core.Tests;

/// <summary>
/// Receipt parsing, machine binding, freshness and image re-verification. Composed at test
/// time from this machine's own MachineGuid binding so the tests run on any Windows host.
/// </summary>
public sealed class HyperVQualificationTests
{
    private static string Stamp(DateTimeOffset value) =>
        value.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", System.Globalization.CultureInfo.InvariantCulture);

    private static string Digest(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));

    private static string Compose(string imagePath, string digest, long imageBytes, DateTimeOffset created,
        string machineId, string[]? checks = null, Action<Dictionary<string, object?>>? mutate = null)
    {
        var properties = new Dictionary<string, object?>
        {
            ["version"] = 1,
            ["policyVersion"] = HyperVQualificationReceipt.CurrentPolicyVersion,
            ["implementationSha256"] = HyperVQualification.ImplementationSha256,
            ["imagePath"] = imagePath,
            ["imageSha256"] = digest,
            ["imageBytes"] = imageBytes,
            ["createdUtc"] = Stamp(created),
            ["machineId"] = machineId,
            ["checks"] = (object?)checks ?? HyperVQualificationReceipt.RequiredChecks.ToArray(),
        };
        mutate?.Invoke(properties);
        return JsonSerializer.Serialize(properties);
    }

    private static (DirectoryInfo Root, string ImagePath) QualifiedImage()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-qual-scope-");
        var path = Path.Combine(root.FullName, "guest.vhdx");
        var bytes = new byte[2 * 1024 * 1024];
        Random.Shared.NextBytes(bytes);
        File.WriteAllBytes(path, bytes);
        return (root, path);
    }

    [Fact]
    public void AComposedCurrentReceiptParsesLoadsAndVerifiesItsOwnImage()
    {
        var (root, imagePath) = QualifiedImage();
        try
        {
            var bytes = File.ReadAllBytes(imagePath);
            var receiptPath = Path.Combine(root.FullName, "receipts", "hyper-v.json");
            Directory.CreateDirectory(Path.GetDirectoryName(receiptPath)!);
            File.WriteAllText(receiptPath, Compose(imagePath, Digest(bytes), bytes.LongLength, DateTimeOffset.UtcNow,
                HyperVQualification.MachineId), new UTF8Encoding(false));

            var (loaded, reason) = HyperVQualification.TryLoadVerified(receiptPath);
            Assert.Empty(reason);
            var receipt = Assert.IsType<HyperVQualificationReceipt>(loaded);
            Assert.Equal(imagePath, receipt.ImagePath);
            Assert.Equal(Digest(bytes), receipt.ImageSha256);
            Assert.Equal(HyperVQualificationReceipt.CurrentPolicyVersion, receipt.PolicyVersion);
            Assert.Equal(HyperVQualificationReceipt.RequiredChecks, receipt.Checks.ToArray());

            var (ok, verifyReason) = HyperVQualification.VerifyImage(receipt);
            Assert.True(ok, verifyReason);
        }
        finally { root.Delete(recursive: true); }
    }

    [Fact]
    public void EveryRequiredGateMustBeRecorded()
    {
        foreach (var missing in HyperVQualificationReceipt.RequiredChecks)
        {
            var checks = HyperVQualificationReceipt.RequiredChecks.Where(name => name != missing).ToArray();
            var parsed = HyperVQualificationReceipt.TryParse(Compose(@"C:\images\guest.vhdx", new string('a', 64),
                16L * 1024 * 1024, DateTimeOffset.UtcNow, HyperVQualification.MachineId, checks), out _, out var reason);
            Assert.False(parsed);
            Assert.Contains("required release gate", reason);
        }
    }

    [Fact]
    public void OldReceiptsAndAnotherBuildCannotEnableExecution()
    {
        foreach (var change in new Action<Dictionary<string, object?>>[]
        {
            fields => fields["policyVersion"] = 2,
            fields => fields["implementationSha256"] = new string('0', 64),
            fields => fields.Remove("implementationSha256"),
        })
            Assert.False(HyperVQualificationReceipt.TryParse(Compose(@"C:\images\guest.vhdx", new string('a', 64), 16L * 1024 * 1024,
                DateTimeOffset.UtcNow, HyperVQualification.MachineId, mutate: change), out _, out _));
    }

    [Fact]
    public void FormatsAndBoundsAreStrict()
    {
        const string digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        var attempts = new (string Json, string ReasonPart)[]
        {
            (Compose(@"C:\images\guest.vhdx", digest, 1L * 1024 * 1024, DateTimeOffset.UtcNow, HyperVQualification.MachineId)
                , string.Empty),
            (Compose(@"\\server\images\guest.vhdx", digest, 2L * 1024 * 1024, DateTimeOffset.UtcNow, HyperVQualification.MachineId), "local VHDX"),
            (Compose(@"C:\images\guest.vhd", digest, 2L * 1024 * 1024, DateTimeOffset.UtcNow, HyperVQualification.MachineId), "local VHDX"),
            (Compose(@"C:\images\" + new string('l', 260) + ".vhdx", digest, 2L * 1024 * 1024, DateTimeOffset.UtcNow, HyperVQualification.MachineId), "local VHDX"),
            (Compose(@"C:\images\guest.vhdx", digest, 1024 * 1024 - 1, DateTimeOffset.UtcNow, HyperVQualification.MachineId), "size"),
            (Compose(@"C:\images\guest.vhdx", digest, 257L * 1024 * 1024 * 1024, DateTimeOffset.UtcNow, HyperVQualification.MachineId), "size"),
            (Compose(@"C:\images\guest.vhdx", digest.ToUpperInvariant(), 2L * 1024 * 1024, DateTimeOffset.UtcNow, HyperVQualification.MachineId), "digest"),
            (Compose(@"C:\images\guest.vhdx", digest[..63], 2L * 1024 * 1024, DateTimeOffset.UtcNow, HyperVQualification.MachineId), "digest"),
            (Compose(@"C:\images\guest.vhdx", digest, 2L * 1024 * 1024, DateTimeOffset.UtcNow, "not-a-machine-id"), "binding"),
            (Compose(@"C:\images\guest.vhdx", digest, 2L * 1024 * 1024, DateTimeOffset.UtcNow, new string('f', 33)), "binding"),
            (Compose(@"C:\images\guest.vhdx", digest, 2L * 1024 * 1024, DateTimeOffset.UtcNow.AddMinutes(3), HyperVQualification.MachineId), "stale or from the future"),
            (Compose(@"C:\images\guest.vhdx", digest, 2L * 1024 * 1024, DateTimeOffset.UtcNow.AddDays(-31), HyperVQualification.MachineId), "stale or from the future"),
            (Compose(@"C:\images\guest.vhdx", digest, 2L * 1024 * 1024, DateTimeOffset.UtcNow, HyperVQualification.MachineId, checks: ["hyper-v-admin", "hyper-v-admin", "image-hash-verified", "image-unattached", "guest-ready", "no-network-adapter", "workspace-fenced", "cleanup-confirmed"]), "duplicated"),
            (Compose(@"C:\images\guest.vhdx", digest, 2L * 1024 * 1024, DateTimeOffset.UtcNow, HyperVQualification.MachineId) + "{}", "invalid"),
            (Compose(@"C:\images\guest.vhdx", digest, 2L * 1024 * 1024, DateTimeOffset.UtcNow, HyperVQualification.MachineId, mutate: properties => properties["version"] = 2), "version"),
            (Compose(@"C:\images\guest.vhdx", digest, 2L * 1024 * 1024, DateTimeOffset.UtcNow, HyperVQualification.MachineId, mutate: properties => properties["policyVersion"] = 1), "version"),
            (Compose(@"C:\images\guest.vhdx", digest, 2L * 1024 * 1024, DateTimeOffset.UtcNow, HyperVQualification.MachineId, mutate: properties => properties.Remove("machineId")), "invalid"),
            (Compose(@"C:\images\guest.vhdx", digest, 2L * 1024 * 1024, DateTimeOffset.UtcNow, HyperVQualification.MachineId, mutate: properties => properties["createdUtc"] = Stamp(DateTimeOffset.UtcNow).Insert(10, " ")), "canonical"),
            (Compose(@"C:\images\guest.vhdx", digest, 2L * 1024 * 1024, DateTimeOffset.UtcNow, HyperVQualification.MachineId, mutate: properties => properties["checks"] = "all-passed"), "invalid"),
        };
        foreach (var (json, part) in attempts.Where(attempt => attempt.ReasonPart.Length > 0))
        {
            var parsed = HyperVQualificationReceipt.TryParse(json, out _, out var reason);
            Assert.False(parsed, json);
            Assert.Contains(part, reason, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void ExtraNonrequiredWellFormedChecksAreTolerated()
    {
        var checks = HyperVQualificationReceipt.RequiredChecks.Append("lab-extra-observation").ToArray();
        var parsed = HyperVQualificationReceipt.TryParse(Compose(@"C:\images\guest.vhdx",
            new string('b', 64), 2L * 1024 * 1024, DateTimeOffset.UtcNow, HyperVQualification.MachineId, checks),
            out var receipt, out var reason);
        Assert.True(parsed, reason);
        Assert.Equal(HyperVQualificationReceipt.RequiredChecks.Count + 1, receipt!.Checks.Count);
    }

    [Fact]
    public void ForeignMachineReceiptsNeverLoad()
    {
        var (root, imagePath) = QualifiedImage();
        try
        {
            var bytes = File.ReadAllBytes(imagePath);
            var receiptPath = Path.Combine(root.FullName, "hyper-v.json");
            File.WriteAllText(receiptPath, Compose(imagePath, Digest(bytes), bytes.LongLength, DateTimeOffset.UtcNow,
                HyperVQualification.MachineId == "0123456789abcdef0123456789abcdef"
                    ? "fedcba9876543210fedcba9876543210"
                    : "0123456789abcdef0123456789abcdef"), new UTF8Encoding(false));
            var (loaded, reason) = HyperVQualification.TryLoadVerified(receiptPath);
            Assert.Null(loaded);
            Assert.Contains("another machine", reason, StringComparison.OrdinalIgnoreCase);
        }
        finally { root.Delete(recursive: true); }
    }

    [Fact]
    public void MissingReceiptsFailClosedWithOperatorGuidance()
    {
        var (loaded, reason) = HyperVQualification.TryLoadVerified(
            Path.Combine(Path.GetTempPath(), "filspresso-missing-" + Guid.NewGuid().ToString("N"), "hyper-v.json"));
        Assert.Null(loaded);
        Assert.Contains("not qualified", reason, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Qualify-HyperVExecution.ps1", reason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ImageVerificationDetectsMissingMutatedAndPostQualifiedWrites()
    {
        var (root, imagePath) = QualifiedImage();
        try
        {
            var bytes = File.ReadAllBytes(imagePath);
            var receipt = new HyperVQualificationReceipt(imagePath, Digest(bytes), bytes.LongLength, 2,
                DateTimeOffset.UtcNow, HyperVQualification.MachineId, HyperVQualificationReceipt.RequiredChecks);

            Assert.True(HyperVQualification.VerifyImage(receipt).Ok);

            Assert.False(HyperVQualification.VerifyImage(receipt, Path.Combine(root.FullName, "absent.vhdx")).Ok);

            File.WriteAllBytes(imagePath, bytes.AsSpan(0, bytes.Length - 1).ToArray());
            Assert.False(HyperVQualification.VerifyImage(receipt).Ok);

            File.WriteAllBytes(imagePath, bytes);
            File.SetLastWriteTimeUtc(imagePath, DateTimeOffset.UtcNow.AddMinutes(5).UtcDateTime);
            var (ok, reason) = HyperVQualification.VerifyImage(receipt);
            Assert.False(ok);
            Assert.Contains("modified after qualification", reason, StringComparison.OrdinalIgnoreCase);
        }
        finally { root.Delete(recursive: true); }
    }

    [Fact]
    public void DefaultPathsStayUnderTheUserDataRoot()
    {
        Assert.False(HyperVQualification.ExecutionReleaseReady);
        Assert.EndsWith("qualification\\hyper-v.json", HyperVQualification.DefaultReceiptPath, StringComparison.OrdinalIgnoreCase);
        Assert.EndsWith("sandbox", HyperVQualification.DefaultSandboxRoot, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("Filspresso.Playground.HyperVGuest", HyperVQualification.DefaultGuestCredentialTarget);
        if (HyperVQualification.MachineId.Length > 0)
            Assert.Matches(@"\A[0-9a-f]{32}\z", HyperVQualification.MachineId);
    }

    [Fact]
    public void SameSizeSameTimestampImageTamperingIsDetectedByHash()
    {
        var (root, imagePath) = QualifiedImage();
        try
        {
            var bytes = File.ReadAllBytes(imagePath);
            var receipt = new HyperVQualificationReceipt(imagePath, Digest(bytes), bytes.LongLength, 2,
                DateTimeOffset.UtcNow, HyperVQualification.MachineId, HyperVQualificationReceipt.RequiredChecks);
            var stamp = File.GetLastWriteTimeUtc(imagePath);
            bytes[0] ^= 1; File.WriteAllBytes(imagePath, bytes); File.SetLastWriteTimeUtc(imagePath, stamp);
            var result = HyperVQualification.VerifyImage(receipt);
            Assert.False(result.Ok); Assert.Contains("SHA-256", result.Reason);
        }
        finally { root.Delete(true); }
    }
}
