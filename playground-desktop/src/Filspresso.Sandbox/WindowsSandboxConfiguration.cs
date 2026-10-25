using System;
using System.Xml.Linq;
using Filspresso.Core.Tools;

namespace Filspresso.Sandbox;

public static class WindowsSandboxConfiguration
{
    public const string GuestInput = @"C:\filspresso-in";
    public const string GuestOutput = @"C:\filspresso-out";
    public static string Create(string input, string output)
    {
        input = PinnedLocalPath.Normalize(input); output = PinnedLocalPath.Normalize(output);
        if (input.Equals(output, StringComparison.OrdinalIgnoreCase) || input.StartsWith(output + "\\", StringComparison.OrdinalIgnoreCase) ||
            output.StartsWith(input + "\\", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Separate sibling staging folders are required.");
        // No user-selected path or original repository is accepted by the application here.
        return new XElement("Configuration",
            new XElement("Networking", "Disable"), new XElement("vGPU", "Disable"),
            new XElement("ClipboardRedirection", "Disable"), new XElement("AudioInput", "Disable"),
            new XElement("VideoInput", "Disable"), new XElement("PrinterRedirection", "Disable"),
            new XElement("ProtectedClient", "Enable"), new XElement("MemoryInMB", 4096),
            new XElement("MappedFolders", Mapping(input, GuestInput, true), Mapping(output, GuestOutput, false)))
            .ToString(SaveOptions.DisableFormatting);
    }
    private static XElement Mapping(string host, string guest, bool readOnly) => new("MappedFolder",
        new XElement("HostFolder", host), new XElement("SandboxFolder", guest), new XElement("ReadOnly", readOnly ? "true" : "false"));
}
