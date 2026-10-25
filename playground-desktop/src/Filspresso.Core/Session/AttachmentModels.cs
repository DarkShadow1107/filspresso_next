using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Filspresso.Core.Storage;

namespace Filspresso.Core.Session;

public static class AttachmentModels
{
    public static IReadOnlyList<string> Recommend(string? selected, IEnumerable<string> filenames)
    {
        var extensions = filenames.Select(name => Path.GetExtension(name).ToLowerInvariant()).ToHashSet(StringComparer.Ordinal);
        var result = new List<string>();
        if (extensions.Overlaps([".mp4", ".webm", ".mov", ".mkv", ".avi"]) && selected is not (DesktopPreferences.VisionModel or "lfm2_5_vl_3b_q4_k_m"))
            result.Add(DesktopPreferences.VisionModel);
        if (extensions.Overlaps([".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac", ".opus"]) && selected != DesktopPreferences.AudioModel)
            result.Add(DesktopPreferences.AudioModel);
        return result;
    }
}
