using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Text.Json;
using Filspresso.Harness;
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class ProjectCheckpointsTests
{
    private static ProjectFileSnapshot Snap(string path, string contents) => new(path, contents);

    [Fact]
    public void BaselineInstallsOnlyOnce()
    {
        var checkpoints = new ProjectCheckpoints();
        checkpoints.SetBaseline([Snap("src/main.py", "print('hi')")]);
        Assert.Throws<InvalidOperationException>(() => checkpoints.SetBaseline([Snap("other.py", "x")]));
        Assert.True(checkpoints.HasBaseline);
    }

    [Fact]
    public void BaselineRejectsTraversalMountAndDuplicatePaths()
    {
        var checkpoints = new ProjectCheckpoints();
        foreach (var path in new[] { "../outside.py", "/etc/passwd", "C:/Windows/System32/config", "dir/", "..", ".", "" })
            Assert.Throws<InvalidOperationException>(() => checkpoints.SetBaseline([Snap(path, "x")]));
        Assert.Empty(checkpoints.Current);
    }

    [Fact]
    public void BaselineRejectsCaseAliasesAtomicallyAndAcceptsNestedPaths()
    {
        var checkpoints = new ProjectCheckpoints();
        Assert.Throws<InvalidOperationException>(() => checkpoints.SetBaseline([Snap("b/cs.py", "1"), Snap("B/CS.py", "2")]));
        Assert.Empty(checkpoints.Current);
        checkpoints.SetBaseline([Snap("b/cs.py", "1"), Snap("src/组件.py", "3")]);
        Assert.Equal(2, checkpoints.Current.Count);
        Assert.Equal("3", checkpoints.Current["src/组件.py"]);
        checkpoints.Reset();
        Assert.False(checkpoints.HasBaseline);
        checkpoints.SetBaseline([Snap("again.py", "x")]);
        Assert.Single(checkpoints.Current);
    }

    [Fact]
    public void RecordWriteJournalIsAdjacentAndByteCounted()
    {
        var checkpoints = new ProjectCheckpoints();
        checkpoints.SetBaseline([Snap("keep.md", "keep")]);
        checkpoints.RecordWrite("new.txt", "hello");
        checkpoints.RecordWrite("keep.md", "keep");
        var changes = checkpoints.Changes;
        Assert.Equal(2, changes.Count);
        Assert.Equal(1, changes[0].Index);
        Assert.Equal(2, changes[1].Index);
        Assert.Null(changes[0].PreviousSha256);           // new file: no previous content
        Assert.NotNull(changes[0].NextSha256);
        Assert.NotNull(changes[1].PreviousSha256);
        Assert.Equal(string.Empty, changes[1].Diff);      // unchanged write still journals
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes("keep"))), changes[1].NextSha256);
        Assert.Equal(["new.txt", "keep.md"], checkpoints.ChangedPaths);
    }

    [Fact]
    public void RecordWriteRejectsInvalidPaths()
    {
        var checkpoints = new ProjectCheckpoints();
        foreach (var path in new[] { "a/../b.txt", "dir/", "C:/x", "con.txt", "a/b?c" })
            Assert.Throws<InvalidOperationException>(() => checkpoints.RecordWrite(path, "x"));
    }

    [Fact]
    public void ImportEnumerationIsDeterministicAndSkipsGeneratedTrees()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-import-scope-");
        try
        {
            foreach (var path in new[]
            {
                "src/App.tsx", "src/components/deep/nested/thing.ts", "package.json", "README.md",
                ".git/config", "node_modules/pkg/index.js", "bin/app.dll", "__pycache__/x.pyc",
                ".next/cache/x.js", "tools/helper.sh",
            })
            {
                var full = Path.Join(root.FullName, path.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(full)!);
                File.WriteAllText(full, "x");
            }
            var first = ProjectCheckpoints.EnumerateImportableFiles(root.FullName);
            var second = ProjectCheckpoints.EnumerateImportableFiles(root.FullName);
            Assert.Equal(first, second);
            Assert.Equal(
                new[] { "README.md", "package.json", "src/App.tsx", "src/components/deep/nested/thing.ts", "tools/helper.sh" },
                first.Select(full => Path.GetRelativePath(root.FullName, full).Replace(Path.DirectorySeparatorChar, '/')).ToArray());
        }
        finally { root.Delete(recursive: true); }
    }

    [Fact]
    public void ImportRespectsPerFileBoundsAndReadsContents()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-import-scope-");
        try
        {
            File.WriteAllText(Path.Join(root.FullName, "big.txt"), new string('x', ProjectCheckpoints.MaxFileBytes + 1));
            Assert.Throws<InvalidOperationException>(() => ProjectCheckpoints.ImportPlan(root.FullName));
            File.Delete(Path.Join(root.FullName, "big.txt")); // fail-loud policy: oversized files must be pruned by the operator
            File.WriteAllText(Path.Join(root.FullName, "tiny.txt"), "tiny");
            var imported = ProjectCheckpoints.ImportPlan(root.FullName);
            Assert.Equal(new[] { "tiny.txt" }, imported.Select(file => file.Path).ToArray());
            Assert.Equal("tiny", imported[0].Contents);
        }
        finally { root.Delete(recursive: true); }
    }

    [Fact]
    public void ExportPlansWritesExactBytesAndManifest()
    {
        var checkpoints = new ProjectCheckpoints();
        checkpoints.SetBaseline([Snap("src/main.py", "print('one')"), Snap("docs/readme", "text")]);
        checkpoints.RecordWrite("src/main.py", "print('two')");
        checkpoints.RecordWrite("src/new.py", "fresh");

        var destination = Directory.CreateTempSubdirectory("filspresso-export-scope-");
        try
        {
            // Prime the destination with an already different file.
            Directory.CreateDirectory(Path.Join(destination.FullName, "src"));
            File.WriteAllText(Path.Join(destination.FullName, "src", "new.py"), "polluted");

            var plan = checkpoints.Prepare(destination.FullName);
            var conflict = Assert.Single(plan.Conflicts);
            Assert.Equal("src/new.py", conflict.Path);
            Assert.True(conflict.Reason.Contains("already occupies", StringComparison.OrdinalIgnoreCase) ||
                conflict.Reason.Contains("conflicting", StringComparison.OrdinalIgnoreCase));
            var blockedPlan = Assert.Single(plan.Entries);
            Assert.Equal("src/main.py", blockedPlan.Path);
            Assert.True(plan.Entries.All(entry => entry.DestinationPath is not null));

            var blocked = Assert.Throws<InvalidOperationException>(() => checkpoints.Apply(plan));
            Assert.Contains("conflict", blocked.Message, StringComparison.OrdinalIgnoreCase);

            // Resolve the conflict and apply.
            File.Delete(Path.Join(destination.FullName, "src", "new.py"));
            plan = checkpoints.Prepare(destination.FullName);
            Assert.Empty(plan.Conflicts);
            var manifest = checkpoints.Apply(plan);
            Assert.Equal(1, manifest.Version);
            Assert.Equal(2, manifest.Written.Count);
            Assert.Equal("print('two')", File.ReadAllText(Path.Join(destination.FullName, "src", "main.py")));
            Assert.Equal("fresh", File.ReadAllText(Path.Join(destination.FullName, "src", "new.py")));
            Assert.False(File.Exists(Path.Join(destination.FullName, "docs", "readme")));
            Assert.True(Directory.EnumerateFiles(destination.FullName, "*", SearchOption.AllDirectories)
                .All(path => !path.EndsWith(".filspresso-partial", StringComparison.Ordinal)));

            var saved = JsonDocument.Parse(File.ReadAllText(Path.Join(destination.FullName, ".filspresso-export-manifest.json")));
            Assert.Equal(1, saved.RootElement.GetProperty("Version").GetInt32());
            Assert.Equal(2, saved.RootElement.GetProperty("Written").GetArrayLength());
            Assert.Equal("print('two')".Length, saved.RootElement.GetProperty("Written")[0].GetProperty("Bytes").GetInt32());
        }
        finally { destination.Delete(recursive: true); }
    }

    [Fact]
    public void ExportRefusesUnusableDestinations()
    {
        var checkpoints = new ProjectCheckpoints();
        checkpoints.SetBaseline([Snap("a.py", "x")]);
        checkpoints.RecordWrite("a.py", "y");
        foreach (var destination in new[] { @"\\server\share", "relative/not-absolute", "", "  " })
            Assert.Throws<InvalidOperationException>(() => checkpoints.Prepare(destination));
    }

    [Fact]
    public void ExportFailsCleanlyWhenNothingChanged()
    {
        var checkpoints = new ProjectCheckpoints();
        checkpoints.SetBaseline([Snap("a.py", "x")]);
        var destination = Directory.CreateTempSubdirectory("filspresso-export-empty-scope-");
        try
        {
            var plan = checkpoints.Prepare(destination.FullName);
            Assert.Empty(plan.Entries);
            Assert.Empty(plan.Conflicts);
            Assert.Throws<InvalidOperationException>(() => checkpoints.Apply(plan));
            Assert.Empty(Directory.GetFiles(destination.FullName, "*", SearchOption.AllDirectories));
        }
        finally { destination.Delete(recursive: true); }
    }
}

public sealed class UnifiedDiffTests
{
    /// <summary>
    /// An independent line-by-line patch applier: every hunk must anchor its start correctly,
    /// consume exactly the counted previous lines, and reproduce the next text exactly.
    /// </summary>
    private static string Apply(string before, string diff)
    {
        if (diff.Length == 0) return before; // no-change writes emit an empty diff with no headers
        var hunks = Regex.Matches(diff, @"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$", RegexOptions.Multiline);
        var headers = Regex.Matches(diff, @"^(--- a/|\+\+\+ b/).+", RegexOptions.Multiline).Count;
        Assert.Equal(2, headers);
        var beforeLines = Regex.Matches(before, "[^\\n]*\\n|[^\\n]+$").Select(match => match.Value).ToArray();
        var position = 0;
        var output = new List<string>();
        for (var hunkIndex = 0; hunkIndex < hunks.Count; hunkIndex++)
        {
            var match = hunks[hunkIndex];
            var oldCount = int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture);
            var hunkStart = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture) - (oldCount == 0 ? 0 : 1);
            while (position < hunkStart) { output.Add(beforeLines[position]); position++; }
            var from = match.Index + match.Length;
            var to = hunkIndex + 1 < hunks.Count ? hunks[hunkIndex + 1].Index : diff.Length;
            var consumed = 0;
            var body = diff[from..to].TrimStart('\n').Split('\n');
            for (var index = 0; index < body.Length; index++)
            {
                var line = body[index];
                if (line.Length == 0) continue;
                var content = line[1..] + "\n";
                if (index + 1 < body.Length && body[index + 1] == "\\ No newline at end of file") { content = line[1..]; index++; }
                if (line[0] == '+')
                {
                    output.Add(content);
                }
                else
                {
                    Assert.True(position < beforeLines.Length, "The diff consumed past the end of the previous text.");
                    Assert.Equal(beforeLines[position], content);
                    if (line[0] == ' ') output.Add(content);
                    position++;
                    consumed++;
                }
            }
            var expected = match.Groups[2].Success ? int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture) : 1;
            Assert.Equal(expected, consumed);
        }
        while (position < beforeLines.Length) { output.Add(beforeLines[position]); position++; }
        return string.Concat(output);
    }

    private static string Diff(string previous, string next) => UnifiedDiff.Compute(previous, next, "src/example.py");

    private static void Check(string previous, string next, string expected = "")
    {
        var diff = Diff(previous, next);
        if (expected.Length > 0) Assert.Equal(expected, diff);
        Assert.Equal(next, Apply(previous, diff));
        if (previous == next) Assert.Equal(string.Empty, diff);
    }

    [Fact]
    public void MiddleEditProducesAContextWindow()
    {
        Check("a\nb\nc", "a\nX\nc",
            "--- a/src/example.py\n+++ b/src/example.py\n@@ -1,3 +1,3 @@\n a\n-b\n+X\n c\n\\ No newline at end of file\n");
    }

    [Fact]
    public void AppendDeleteAndEmptyEdgesProduceStandardHeaders()
    {
        Check("a", "a\nb");
        Check("a\nb", "a");
        Check("alpha\nbeta\ngamma", "alpha\nbeta\ngamma\ndelta");
        Check("", "one");
        Check("one", "");
        Check("", "");
    }

    [Fact]
    public void MultipleDistantEditsSplitIntoSeparateHunks()
    {
        var before = string.Join('\n', Enumerable.Range(0, 40).Select(index => $"line-{index}"));
        var after = before.Replace("line-5", "LINE-5").Replace("line-30", "LINE-30");
        var diff = UnifiedDiff.Compute(before, after, "big.txt");
        Assert.Equal(2, Regex.Matches(diff, "^@@", RegexOptions.Multiline).Count);
        Assert.Equal(after, Apply(before, diff));
    }

    [Fact]
    public void NearEditsShareOneHunk()
    {
        var before = string.Join('\n', Enumerable.Range(0, 6).Select(index => $"line-{index}"));
        var after = before.Replace("line-0", "LINE-0").Replace("line-3", "LINE-3");
        var hunkCount = Regex.Matches(Diff(before, after), "^@@", RegexOptions.Multiline).Count;
        Assert.Equal(1, hunkCount);
        Assert.Equal(after, Apply(before, Diff(before, after)));
    }

    [Fact]
    public void OversizedComparisonsFallBackToWholeFile()
    {
        var before = string.Join('\n', Enumerable.Repeat("same", 2100).ToArray());
        var after = string.Join('\n', Enumerable.Repeat("other", 2100).ToArray());
        var diff = UnifiedDiff.Compute(before, after, "huge.txt");
        var firstHunk = diff.Split('\n').First(line => line.StartsWith("@@", StringComparison.Ordinal));
        Assert.StartsWith("@@ -1,", firstHunk);
        Assert.Equal(after, Apply(before, diff));
    }

    [Fact]
    public void IdenticalContentYieldsNoDiffAndLineEndingsRemainByteExact()
    {
        Assert.Equal(string.Empty, Diff("a\nb\nc", "a\nb\nc"));
        Check("a\r\nb\r\nc", "a\nb\nc");
        Check("x", "x\n"); Check("x\n", "x"); Check("\n", "");
        Check("++header\n", "---body\n");
        Assert.Throws<InvalidOperationException>(() => UnifiedDiff.Compute("a", "b", ""));
        Assert.Throws<InvalidOperationException>(() => UnifiedDiff.Compute("a", "b", " "));
    }

    [Fact]
    public void UnicodeLineContentsSurvive()
    {
        Check("café 界", "caffè 界");
    }
}
