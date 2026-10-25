using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Filspresso.Core.Tools;

namespace Filspresso.Sandbox;

public sealed record HyperVRecoveryRecord(Guid Id, string Name, string OwnerTag);

public interface IHyperVRecoveryJournal
{
    IDisposable Acquire();
    IReadOnlyList<HyperVRecoveryRecord> Read();
    void Add(HyperVRecoveryRecord record);
    void Remove(Guid id);
}

/// <summary>Per-user DPAPI authenticated intent, persisted BEFORE any resource creation.
/// One exclusive root lease prevents one app instance reclaiming another's live VM.
/// Current user/administrators are trusted, never guest or model-controlled paths.</summary>
public sealed class HyperVRecoveryJournal(string root) : IHyperVRecoveryJournal
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Filspresso.HyperV.recovery.v3");
    public IDisposable Acquire()
    {
        var pinned = new PinnedLocalPath(root, create: true);
        try
        {
            var lease = Path.Combine(root, "owner.lock");
            if (!File.Exists(lease)) { using var created = pinned.OpenFile("owner.lock", FileAccess.ReadWrite, createNew: true); }
            return new Lease(pinned, pinned.OpenFile("owner.lock", FileAccess.ReadWrite));
        }
        catch { pinned.Dispose(); throw; }
    }
    private sealed class Lease(PinnedLocalPath pin, FileStream stream) : IDisposable
    { public void Dispose() { stream.Dispose(); pin.Dispose(); } }
    public IReadOnlyList<HyperVRecoveryRecord> Read()
    {
        using var pin = new PinnedLocalPath(root);
        var result = new List<HyperVRecoveryRecord>();
        foreach (var path in Directory.EnumerateFiles(root, "*.intent"))
        {
            if (result.Count >= 8) throw new InvalidDataException("Recovery inventory exceeds the bound; operator review required.");
            using var file = pin.OpenFile(Path.GetFileName(path));
            if (file.Length > 4096) throw new InvalidDataException("Invalid recovery intent.");
            var bytes = new byte[checked((int)file.Length)]; file.ReadExactly(bytes);
            var record = JsonSerializer.Deserialize<HyperVRecoveryRecord>(ProtectedData.Unprotect(bytes, Entropy, DataProtectionScope.CurrentUser));
            if (record is null || record.Id == Guid.Empty || record.Name != "filspresso-" + record.Id.ToString("N") ||
                record.OwnerTag != "Filspresso.v3." + record.Id.ToString("N") || Path.GetFileName(path) != record.Id.ToString("N") + ".intent")
                throw new InvalidDataException("Untrusted recovery inventory; no resource was removed.");
            result.Add(record);
        }
        return result;
    }
    public void Add(HyperVRecoveryRecord record)
    {
        using var pin = new PinnedLocalPath(root);
        using var file = pin.OpenFile(record.Id.ToString("N") + ".intent", FileAccess.ReadWrite, createNew: true);
        file.Write(ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(record), Entropy, DataProtectionScope.CurrentUser));
        file.Flush(true);
    }
    public void Remove(Guid id)
    {
        using var pin = new PinnedLocalPath(root);
        // Only an exact authenticated inventory name; ancestors remain pinned.
        File.Delete(Path.Combine(root, id.ToString("N") + ".intent"));
    }
}
