using System;
using System.Linq;

namespace Filspresso.Core.Tools;

/// <summary>
/// Portable lexical file-path policy shared by tool validation and the sandbox. This is
/// not a substitute for checking guest symlinks/reparse points when opening the file.
/// Paths use / separators and cannot address drives, devices, streams or workspace parents.
/// </summary>
public static class WorkspacePath
{
    public static bool IsRelativeFile(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 240 || value.Any(character => char.IsControl(character) || "\\:*?\"<>|".Contains(character))) return false;
        foreach (var part in value.Split('/'))
        {
            if (part is "" or "." or ".." || part.EndsWith(' ') || part.EndsWith('.')) return false;
            var stem = part.Split('.')[0].TrimEnd(' ').ToUpperInvariant();
            if (stem is "CON" or "PRN" or "AUX" or "NUL" or "CONIN$" or "CONOUT$" ||
                (stem.Length == 4 && (stem.StartsWith("COM", StringComparison.Ordinal) || stem.StartsWith("LPT", StringComparison.Ordinal)) &&
                 "123456789¹²³".Contains(stem[3]))) return false;
        }
        return true;
    }
}
