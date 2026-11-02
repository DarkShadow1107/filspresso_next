using System;
using System.Xml.Linq;
using Filspresso.Core.Tools;

namespace Filspresso.Sandbox;

public static class WindowsSandboxConfiguration
{
    // Config-mapped input folders do not distribute file content on current Windows builds.
    // Requests travel as freshly attached read-only shares instead: one shard folder per
    // exchange, under a fresh guest path, so the attach snapshot is always complete.
    public const string GuestSharesRoot = @"C:\filspresso-shards";
    public const string GuestOutput = @"C:\filspresso-out";
    public static string GuestSharePath(string nonce) => GuestSharesRoot + @"\s" + nonce;
    // No user-selected path or original repository is accepted by the application here.
    public static string Create(string output)
    {
        output = PinnedLocalPath.Normalize(output);
        return new XElement("Configuration",
            new XElement("Networking", "Disable"), new XElement("vGPU", "Disable"),
            new XElement("ClipboardRedirection", "Disable"), new XElement("AudioInput", "Disable"),
            new XElement("VideoInput", "Disable"), new XElement("PrinterRedirection", "Disable"),
            new XElement("ProtectedClient", "Enable"), new XElement("MemoryInMB", 4096),
            new XElement("MappedFolders", Mapping(output, GuestOutput, false)))
            .ToString(SaveOptions.DisableFormatting);
    }
    private static XElement Mapping(string host, string guest, bool readOnly) => new("MappedFolder",
        new XElement("HostFolder", host), new XElement("SandboxFolder", guest), new XElement("ReadOnly", readOnly ? "true" : "false"));
}
