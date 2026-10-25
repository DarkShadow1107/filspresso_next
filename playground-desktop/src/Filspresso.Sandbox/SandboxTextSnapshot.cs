using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using Filspresso.Core.Tools;

namespace Filspresso.Sandbox;

internal static class SandboxTextSnapshot
{
    private static readonly string[] Skip = [".git", ".hg", ".svn", "node_modules", "__pycache__", "bin", "obj", "dist", "build", "target", "out", ".venv", "venv", "env", ".idea", ".vscode", ".next", ".tmp"];
    private static readonly HashSet<string> Extensions = new(".py .pyi .ts .tsx .js .jsx .json .md .markdown .txt .yaml .yml .toml .ini .cfg .conf .sh .bash .ps1 .bat .cmd .xml .html .css .scss .svg .cs .csproj .go .rs .java .kt .swift .c .h .cpp .hpp .sql .dart .rb .php .hs .clj .nix .cmake .mk .gitignore .dockerignore".Split(' '), StringComparer.OrdinalIgnoreCase);
    internal static string Read(string path)
    {
        using var pin = new PinnedLocalPath(Path.GetDirectoryName(path)!); using var file = pin.OpenFile(Path.GetFileName(path));
        if (file.Length > 262144) throw new InvalidDataException("Text file exceeds 256 KiB.");
        var bytes = new byte[checked((int)file.Length)]; file.ReadExactly(bytes);
        var text = new UTF8Encoding(false, true).GetString(bytes);
        return !text.Contains('\0') ? text : throw new InvalidDataException("Binary file cannot enter text review.");
    }
    internal static IReadOnlyList<SandboxTextFile> Capture(string root, IReadOnlyCollection<string> tracked, CancellationToken token)
    {
        if (tracked.Count > 256 || tracked.Any(path => !WorkspacePath.IsRelativeFile(path))) throw new SandboxPolicyException("Invalid tracked paths.");
        var known = new HashSet<string>(tracked, StringComparer.OrdinalIgnoreCase);
        var files = new List<SandboxTextFile>(); var directories = 0; var entries = 0; long bytes = 0;
        void Walk(string directory, int depth)
        {
            if (++directories > 2048 || depth > 16) throw new InvalidDataException("Snapshot directory budget exceeded.");
            using var pin = new PinnedLocalPath(directory);
            foreach (var path in Directory.EnumerateFileSystemEntries(directory))
            {
                token.ThrowIfCancellationRequested();
                if (++entries > 32768) throw new InvalidDataException("Snapshot enumeration budget exceeded.");
                var name = Path.GetFileName(path);
                if (Directory.Exists(path))
                { if (!name.StartsWith('.') && !Skip.Contains(name, StringComparer.OrdinalIgnoreCase)) Walk(path, depth + 1); continue; }
                if (name.Equals(".env", StringComparison.OrdinalIgnoreCase) || name.StartsWith(".env.", StringComparison.OrdinalIgnoreCase) ||
                    name.EndsWith(".pem", StringComparison.OrdinalIgnoreCase) || name.EndsWith(".key", StringComparison.OrdinalIgnoreCase) ||
                    new[] { "id_rsa", "id_ed25519", "credentials.json" }.Contains(name, StringComparer.OrdinalIgnoreCase)) continue;
                var relative = Path.GetRelativePath(root, path).Replace('\\', '/');
                if (!known.Contains(relative) && !Extensions.Contains(Path.GetExtension(name)) && name is not ("Dockerfile" or "Procfile")) continue;
                if (!WorkspacePath.IsRelativeFile(relative) || files.Count >= 256) throw new InvalidDataException("Snapshot file budget exceeded.");
                var text = Read(path); bytes += Encoding.UTF8.GetByteCount(text);
                if (bytes > 8388608) throw new InvalidDataException("Snapshot exceeds 8 MiB.");
                files.Add(new(relative, text));
            }
        }
        Walk(root, 0); return files.AsReadOnly();
    }
}
