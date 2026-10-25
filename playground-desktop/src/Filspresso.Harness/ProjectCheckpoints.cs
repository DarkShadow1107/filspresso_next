using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Filspresso.Core.Tools;

namespace Filspresso.Harness;

/// <summary>Deterministic coordinator for imported project baselines, diffs and exports.</summary>
/// <remarks>
/// Everything here is client-local review material. It is never sent to the model, never
/// persisted by the harness, and never an execution authority. Writes recorded through
/// <see cref="RecordWrite"/> correspond to actions the user separately approved; the journal is
/// evidence for the later "apply reviewed changes to my real project" step, not the approval.
/// </remarks>
public sealed class ProjectCheckpoints
{
    public const int MaxFiles = 256;
    public const int MaxFileBytes = 256 * 1024;
    public const int MaxTotalBytes = 8 * 1024 * 1024;

    private static readonly string[] SkippedDirectories =
    [
        ".git", ".hg", ".svn", "node_modules", "__pycache__", "bin", "obj", "dist",
        "build", "target", "out", ".venv", "venv", "env", ".idea", ".vscode", ".next",
    ];

    private static readonly string[] SkippedFiles = [".env", ".env.local", ".env.production", "id_rsa", "id_ed25519"];

    private static readonly HashSet<string> ImportableExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".py", ".pyi", ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".markdown", ".txt", ".yaml", ".yml", ".toml",
        ".ini", ".cfg", ".conf", ".sh", ".bash", ".ps1", ".bat", ".cmd", ".xml", ".html", ".css", ".scss", ".svg",
        ".cs", ".csproj", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".hpp", ".sql", ".dart",
        ".rb", ".php", ".hs", ".clj", ".nix", ".cmake", ".mk", ".gitignore", ".dockerignore",
    };

    private readonly object _gate = new();
    private readonly Dictionary<string, string> _baseline = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _current = new(StringComparer.Ordinal);
    private readonly List<ProjectChange> _changes = new();

    public bool HasBaseline { get { lock (_gate) return _baseline.Count > 0; } }
    public int ChangeCount { get { lock (_gate) return _changes.Count; } }

    public IReadOnlyList<ProjectChange> Changes
    {
        get { lock (_gate) return Array.AsReadOnly(_changes.ToArray()); }
    }

    public IReadOnlyList<string> ChangedPaths
    {
        get
        {
            lock (_gate) return _changes.Select(change => change.Path).Distinct().ToArray();
        }
    }

    public IReadOnlyDictionary<string, string> Current
    {
        get { lock (_gate) return new ReadOnlyDictionary<string, string>(new Dictionary<string, string>(_current, StringComparer.Ordinal)); }
    }

    public IReadOnlyDictionary<string, string> Baseline
    {
        get { lock (_gate) return new ReadOnlyDictionary<string, string>(new Dictionary<string, string>(_baseline, StringComparer.Ordinal)); }
    }

    public void Reset()
    {
        lock (_gate) { _baseline.Clear(); _current.Clear(); _changes.Clear(); }
    }

    /// <summary>Registers the imported baseline files (workspace-relative path → source text).</summary>
    public void SetBaseline(IReadOnlyList<ProjectFileSnapshot> files)
    {
        ArgumentNullException.ThrowIfNull(files);
        lock (_gate)
        {
            if (_baseline.Count > 0) throw new InvalidOperationException("A baseline is already installed. Start a new conversation to import another project.");
            if (files.Count > MaxFiles) throw new InvalidOperationException($"A project import is limited to {MaxFiles} files.");
            foreach (var file in files)
            {
                if (file.Path is not { Length: > 0 } path || !WorkspacePath.IsRelativeFile(path))
                    throw new InvalidOperationException($"\"{file.Path}\" is not a relative workspace path.");
                if (!_current.TryAdd(path, file.Contents) || !_baseline.TryAdd(path, file.Contents))
                    throw new InvalidOperationException($"\"{file.Path}\" is already tracked.");
            }
        }
    }

    /// <summary>Called by the execution adapter after an approved write lands in the sandbox.</summary>
    public void RecordWrite(string path, string next)
    {
        if (path is not { Length: > 0 } relative || !WorkspacePath.IsRelativeFile(relative))
            throw new InvalidOperationException($"\"{path}\" is not a relative workspace path.");
        var content = next ?? string.Empty;
        lock (_gate)
        {
            var previous = _current.TryGetValue(relative, out var value) ? value : string.Empty;
            var previousBytes = Encoding.UTF8.GetBytes(previous);
            var nextBytes = Encoding.UTF8.GetBytes(content);
            _current[relative] = content;
            _changes.Add(new(_changes.Count + 1, relative, UnifiedDiff.Compute(previous, content, relative),
                previousBytes.Length == 0 ? null : Convert.ToHexStringLower(SHA256.HashData(previousBytes)),
                Convert.ToHexStringLower(SHA256.HashData(nextBytes))));
        }
    }

    // ── Import ───────────────────────────────────────────────────────────────────────────

    /// <summary>Deterministic ordered enumeration of the text files a bounded importer accepts.</summary>
    public static IReadOnlyList<string> EnumerateImportableFiles(string directory)
    {
        if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory))
            throw new InvalidOperationException($"The project directory does not exist: {directory}");
        var files = new List<string>();
        Walk(new DirectoryInfo(directory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)), depth: 0, files);
        files.Sort(StringComparer.Ordinal);
        if (files.Count > MaxFiles) throw new InvalidOperationException($"The project exceeds {MaxFiles} importable files; tighten the tree or import a subset.");
        return files;
    }

    private static void Walk(DirectoryInfo directory, int depth, List<string> files)
    {
        if (depth > 16) throw new InvalidOperationException("The project nesting depth exceeds bounded-import policy.");
        if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException($"\"{directory.FullName}\" is a reparse point; bounded imports never follow links.");
        foreach (var child in directory.EnumerateDirectories())
        {
            if (SkippedDirectories.Contains(child.Name, StringComparer.OrdinalIgnoreCase)
                || child.Name.StartsWith(".", StringComparison.Ordinal)) continue;
            Walk(child, depth + 1, files);
        }
        foreach (var file in directory.EnumerateFiles())
            if (IsImportable(file.FullName)) files.Add(file.FullName);
    }

    public static bool IsImportable(string fullPath)
    {
        var directory = Path.GetDirectoryName(fullPath);
        if (string.IsNullOrWhiteSpace(directory)) return false;
        try { if (new DirectoryInfo(directory).Attributes.HasFlag(FileAttributes.Hidden)) return false; }
        catch (DirectoryNotFoundException) { return false; }
        var name = Path.GetFileName(fullPath);
        if (SkippedFiles.Contains(name, StringComparer.OrdinalIgnoreCase)) return false;
        // Size is deliberately NOT filtered here: ImportPlan fails loud on oversized files
        // instead of silently importing a baseline that is missing them.
        return ImportableExtensions.Contains(Path.GetExtension(fullPath)) ||
            name.Equals("Dockerfile", StringComparison.OrdinalIgnoreCase) || name.Equals("Procfile", StringComparison.Ordinal);
    }

    /// <summary>Reads each bounded file and enforces the aggregate size cap.</summary>
    public static IReadOnlyList<ProjectFileSnapshot> ImportPlan(string directory)
    {
        var paths = EnumerateImportableFiles(directory);
        var files = new List<ProjectFileSnapshot>(capacity: paths.Count);
        long total = 0;
        foreach (var fullPath in paths)
        {
            using var stream = File.OpenRead(fullPath);
            if (stream.Length > MaxFileBytes) throw new InvalidOperationException($"\"{fullPath}\" exceeds the per-file import limit.");
            total += stream.Length;
            if (total > MaxTotalBytes) throw new InvalidOperationException($"The project exceeds the {MaxTotalBytes}-byte import limit.");
            using var reader = new StreamReader(stream, new UTF8Encoding(false, false), detectEncodingFromByteOrderMarks: true);
            files.Add(new(Relative(fullPath, directory), reader.ReadToEnd()));
        }
        return files;
    }

    private static string Relative(string fullPath, string root)
    {
        var rootDirectory = new DirectoryInfo(root).FullName;
        return Path.GetRelativePath(rootDirectory, fullPath).Replace(Path.DirectorySeparatorChar, '/');
    }

    // ── Reviewed export ──────────────────────────────────────────────────────────────────

    /// <summary>Validates the destination and returns writable entries and conflicts. No disk writes.</summary>
    public CheckpointExportPlan Prepare(string destinationRoot)
    {
        if (string.IsNullOrWhiteSpace(destinationRoot) || !Path.IsPathFullyQualified(destinationRoot) ||
            destinationRoot.StartsWith(@"\\", StringComparison.Ordinal))
            throw new InvalidOperationException("Choose a local absolute destination directory, not a network share or device path.");
        lock (_gate)
        {
            var entries = new List<ExportEntry>();
            var conflicts = new List<ExportConflict>();
            foreach (var grouped in _changes.GroupBy(change => change.Path, StringComparer.Ordinal))
            {
                var path = grouped.Key;
                var previous = _baseline.TryGetValue(path, out var value) ? value : string.Empty;
                if (!_current.TryGetValue(path, out var next)) throw new InvalidOperationException($"\"{path}\" is not tracked.");
                var destination = Path.GetFullPath(Path.Combine(destinationRoot, path.Replace('/', Path.DirectorySeparatorChar)));
                var prefix = destinationRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                if (!destination.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    conflicts.Add(new(path, "The destination path escapes the chosen project directory."));
                else if (Directory.Exists(destination))
                    conflicts.Add(new(path, "The destination path is an existing directory."));
                else
                {
                    var previousBytes = Encoding.UTF8.GetBytes(previous);
                    var nextBytes = Encoding.UTF8.GetBytes(next);
                    var previousDigest = Convert.ToHexStringLower(SHA256.HashData(previousBytes));
                    var candidate = TryReadCandidate(destination);
                    if (candidate is { } bytes && !bytes.AsSpan().SequenceEqual(previousBytes))
                        conflicts.Add(new(path, bytes.Length == 0
                            ? "An empty file already occupies the destination where the sandbox baseline stores content."
                            : $"A different file already occupies the destination. Its sha256 is {Convert.ToHexStringLower(SHA256.HashData(bytes))}; the sandbox base is {previousDigest}."));
                    else entries.Add(new(path, previousDigest, Convert.ToHexStringLower(SHA256.HashData(nextBytes)), nextBytes.Length, destination));
                }
            }
            return new(destinationRoot, entries, conflicts);
        }
    }

    /// <summary>Applies the prepared plan all-or-nothing and returns the byte-exact manifest.</summary>
    public CheckpointExportManifest Apply(CheckpointExportPlan plan)
    {
        ArgumentNullException.ThrowIfNull(plan);
        if (plan.Conflicts.Count > 0) throw new InvalidOperationException("Resolve every listed conflict before applying an export.");
        if (plan.Entries.Count == 0) throw new InvalidOperationException("The plan has no entries to apply.");
        Directory.CreateDirectory(plan.DestinationRoot);
        var manifestEntries = new List<ExportEntry>(plan.Entries.Count);
        foreach (var entry in plan.Entries)
        {
            var target = entry.DestinationPath!;
            var directory = Path.GetDirectoryName(target)!;
            Directory.CreateDirectory(directory);
            if ((new DirectoryInfo(directory).Attributes & FileAttributes.ReparsePoint) == FileAttributes.ReparsePoint)
                throw new InvalidOperationException($"A destination directory contains a reparse point: {directory}");
            if (!Current.TryGetValue(entry.Path, out var next)) throw new InvalidOperationException($"\"{entry.Path}\" is not tracked.");
            var interim = target + ".filspresso-partial";
            File.WriteAllText(interim, next, new UTF8Encoding(false, false));
            File.Move(interim, target, overwrite: true);
            manifestEntries.Add(new(entry.Path, entry.PreviousSha256, entry.NextSha256, entry.Bytes, null));
        }
        var manifest = new CheckpointExportManifest(1, plan.DestinationRoot, DateTimeOffset.UtcNow.ToUnixTimeSeconds(), manifestEntries);
        var json = JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(Path.Combine(plan.DestinationRoot, ".filspresso-export-manifest.json"), json, new UTF8Encoding(false));
        return manifest;
    }

    private static byte[]? TryReadCandidate(string path)
    {
        try
        {
            if (!File.Exists(path)) return null;
            using var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            if (stream.Length > MaxFileBytes) throw new InvalidOperationException($"The conflicting destination file is larger than bounded policy: {path}");
            var buffer = new byte[stream.Length];
            stream.ReadExactly(buffer);
            return buffer;
        }
        catch (DirectoryNotFoundException) { return null; }
    }
}

public sealed record ProjectFileSnapshot(string Path, string Contents);
/// <summary>One approved write's contrast against the imported baseline or prior state.</summary>
public sealed record ProjectChange(int Index, string Path, string Diff, string? PreviousSha256, string NextSha256);
public sealed record ExportEntry(string Path, string PreviousSha256, string NextSha256, int Bytes, string? DestinationPath);
public sealed record ExportConflict(string Path, string Reason);
public sealed record CheckpointExportPlan(string DestinationRoot, IReadOnlyList<ExportEntry> Entries, IReadOnlyList<ExportConflict> Conflicts);
public sealed record CheckpointExportManifest(int Version, string DestinationRoot, long CreatedUtcEpochSeconds, IReadOnlyList<ExportEntry> Written);

/// <summary>Deterministic unified-diff generator (no timestamps, bounded allocation).</summary>
public static class UnifiedDiff
{
    /// <summary>Line budget: over this the generator emits a single whole-file hunk.</summary>
    private const int ContextLines = 3;
    private const long MaxCells = 4_000_000;

    public static string Compute(string? previous, string? next, string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new InvalidOperationException("The diff path must be a nonempty workspace path.");
        var before = Lines(previous);
        var after = Lines(next);
        var ops = (long)before.Length * after.Length <= MaxCells ? Split(before, after) : WholeFile(before, after);
        // Identical content leaves an all-context op stream; the empty diff then means nothing changed.
        if (ops.Count > 0 && ops.All(op => op.Kind == '=')) ops.Clear();
        if (ops.Count == 0) return string.Empty;
        return $"--- a/{path}\n+++ b/{path}\n" + Format(ops, before, after);
    }

    private static string[] Lines(string? value) =>
        string.IsNullOrEmpty(value) ? Array.Empty<string>() : value.Replace("\r", string.Empty).Split('\n', StringSplitOptions.None);

    private static List<(char Kind, int Before, int After)> WholeFile(string[] before, string[] after)
    {
        var ops = new List<(char Kind, int Before, int After)>(before.Length + after.Length);
        for (var index = 0; index < before.Length; index++) ops.Add(('-', index, 0));
        for (var index = 0; index < after.Length; index++) ops.Add(('+', before.Length, index));
        return ops;
    }

    /// <summary>LCS DP; each op carries the line indices it renders from (0-based).</summary>
    private static List<(char Kind, int Before, int After)> Split(string[] before, string[] after)
    {
        var rows = before.Length;
        var columns = after.Length;
        var ops = new List<(char Kind, int Before, int After)>(rows + columns);
        if (rows == 0)
        {
            for (var index = 0; index < columns; index++) ops.Add(('+', 0, index));
            return ops;
        }
        if (columns == 0)
        {
            for (var index = 0; index < rows; index++) ops.Add(('-', index, 0));
            return ops;
        }
        var width = columns + 1;
        var dense = new ushort[(rows + 1) * width];
        for (var row = 1; row <= rows; row++)
        {
            for (var column = 1; column <= columns; column++)
            {
                if (before[row - 1] == after[column - 1])
                    dense[row * width + column] = (ushort)(dense[(row - 1) * width + (column - 1)] + 1);
                else
                    dense[row * width + column] = Math.Max(dense[(row - 1) * width + column], dense[row * width + (column - 1)]);
            }
        }
        var p = rows;
        var q = columns;
        while (p > 0 && q > 0)
        {
            if (before[p - 1] == after[q - 1] && dense[p * width + q] == dense[(p - 1) * width + (q - 1)] + 1)
            { ops.Add(('=', p - 1, q - 1)); p--; q--; }
            else if (dense[p * width + (q - 1)] >= dense[(p - 1) * width + q])
            { ops.Add(('+', p, q - 1)); q--; }
            else
            { ops.Add(('-', p - 1, q)); p--; }
        }
        while (p > 0) { ops.Add(('-', p - 1, 0)); p--; }
        while (q > 0) { ops.Add(('+', 0, q - 1)); q--; }
        ops.Reverse();
        return ops;
    }

    private static string Format(List<(char Kind, int Before, int After)> ops, string[] before, string[] after)
    {
        // Maximal runs of changes, merged when the equal-tail gap is within 2 * context, so
        // hunk windows never overlap and standard diff readers see canonical output.
        var regions = new List<(int Start, int End)>();
        for (var index = 0; index < ops.Count;)
        {
            if (ops[index].Kind == '=') { index++; continue; }
            var run = index;
            while (run < ops.Count && ops[run].Kind != '=') run++;
            if (regions.Count > 0 && index - regions[^1].End <= 2 * ContextLines)
                regions[^1] = (regions[^1].Start, run);
            else regions.Add((index, run));
            index = run;
        }
        var output = new StringBuilder();
        foreach (var (start, end) in regions)
        {
            var begin = Math.Max(0, start - ContextLines);
            var stop = Math.Min(ops.Count, end + ContextLines);
            var beforeCount = 0;
            var afterCount = 0;
            for (var index = begin; index < stop; index++)
            {
                beforeCount += ops[index].Kind == '+' ? 0 : 1;
                afterCount += ops[index].Kind == '-' ? 0 : 1;
            }
            // Pure before-edge insertion anchors at the line count before it; everything
            // else anchors at the first rendered previous line, 1-based.
            var beforeHead = Math.Max(0, ops[begin].Before + 1 - (beforeCount == 0 ? 1 : 0));
            var afterHead = Math.Max(0, ops[begin].After + 1 - (afterCount == 0 ? 1 : 0));
            output.Append(CultureInfo.InvariantCulture, $"@@ -{beforeHead},{beforeCount} +{afterHead},{afterCount} @@\n");
            for (var index = begin; index < stop; index++)
            {
                var (kind, beforeLine, afterLine) = ops[index];
                output.Append(kind switch
                {
                    '-' => $"-{before[beforeLine]}\n",
                    '+' => $"+{after[afterLine]}\n",
                    _ => $" {before[beforeLine]}\n",
                });
            }
        }
        return output.ToString();
    }
}
