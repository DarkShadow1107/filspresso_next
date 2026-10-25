using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using Filspresso.Core.Tools;
using Filspresso.Harness;
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class ProjectExportSafetyTests
{
    [DllImport("kernel32.dll", EntryPoint = "CreateHardLinkW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateHardLink(string link, string existing, IntPtr security);
    private static ProjectCheckpoints Project()
    {
        var result = new ProjectCheckpoints();
        result.SetBaseline([new("a.txt", "old"), new("b.txt", "old")]);
        result.RecordWrite("a.txt", "new"); result.RecordWrite("b.txt", "new");
        return result;
    }

    [Fact]
    public void PinPreventsAncestorRenameAndFileWritersUntilReleased()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-pins-");
        try
        {
            var child = Directory.CreateDirectory(Path.Combine(root.FullName, "child"));
            File.WriteAllText(Path.Combine(child.FullName, "a.txt"), "text");
            using (var pin = new PinnedLocalPath(child.FullName))
            using (var file = pin.OpenFile("a.txt"))
            {
                Assert.Throws<IOException>(() => Directory.Move(child.FullName, child.FullName + "-renamed"));
                Assert.Throws<IOException>(() => File.WriteAllText(Path.Combine(child.FullName, "a.txt"), "intruder"));
            }
            File.WriteAllText(Path.Combine(child.FullName, "a.txt"), "released");
        }
        finally { root.Delete(true); }
    }

    [Fact]
    public void DestinationChangeOrLateLockDoesNotModifyAnyEarlierFile()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-export-safety-");
        try
        {
            File.WriteAllText(Path.Combine(root.FullName, "a.txt"), "old");
            File.WriteAllText(Path.Combine(root.FullName, "b.txt"), "old");
            var project = Project(); var plan = project.Prepare(root.FullName);
            File.WriteAllText(Path.Combine(root.FullName, "b.txt"), "user edit");
            Assert.Throws<InvalidOperationException>(() => project.Apply(plan));
            Assert.Equal("old", File.ReadAllText(Path.Combine(root.FullName, "a.txt")));
            Assert.Equal("user edit", File.ReadAllText(Path.Combine(root.FullName, "b.txt")));
            Assert.False(File.Exists(Path.Combine(root.FullName, ".filspresso-export-manifest.json")));
            File.WriteAllText(Path.Combine(root.FullName, "b.txt"), "old");
            plan = project.Prepare(root.FullName);
            using (var locked = File.Open(Path.Combine(root.FullName, "b.txt"), FileMode.Open, FileAccess.ReadWrite, FileShare.None))
                Assert.Throws<IOException>(() => project.Apply(plan));
            Assert.Equal("old", File.ReadAllText(Path.Combine(root.FullName, "a.txt")));
        }
        finally { root.Delete(true); }
    }

    [Fact]
    public void ForeignStaleForgedAndReplayedPlansAreRejected()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-export-plan-");
        try
        {
            var project = Project(); var plan = project.Prepare(root.FullName);
            Assert.Throws<InvalidOperationException>(() => Project().Apply(plan));
            Assert.Throws<InvalidOperationException>(() => project.Apply(plan with { DestinationRoot = root.FullName + "-other" }));
            project.RecordWrite("a.txt", "newer");
            Assert.Throws<InvalidOperationException>(() => project.Apply(plan));
            plan = project.Prepare(root.FullName); project.Apply(plan);
            Assert.Throws<InvalidOperationException>(() => project.Apply(plan));
            Assert.NotEmpty(project.Prepare(root.FullName).Conflicts);
        }
        finally { root.Delete(true); }
    }

    [Fact]
    public void ImportRetainsBomCrLfAndEmptyFilesAndRejectsInvalidUtf8()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-import-exact-");
        try
        {
            File.WriteAllBytes(Path.Combine(root.FullName, "a.txt"), [0xef, 0xbb, 0xbf, 65, 13, 10]);
            File.WriteAllBytes(Path.Combine(root.FullName, "b.txt"), []);
            var files = ProjectCheckpoints.ImportPlan(root.FullName);
            Assert.Equal("\ufeffA\r\n", files[0].Contents); Assert.Equal("", files[1].Contents);
            File.WriteAllBytes(Path.Combine(root.FullName, "bad.txt"), [0xff, 0xfe]);
            Assert.Throws<DecoderFallbackException>(() => ProjectCheckpoints.ImportPlan(root.FullName));
        }
        finally { root.Delete(true); }
    }

    [Fact]
    public void HardLinkAliasesCannotImportOrOverwriteAnUnrelatedFile()
    {
        var root = Directory.CreateTempSubdirectory("filspresso-hardlink-");
        try
        {
            var project = Directory.CreateDirectory(Path.Combine(root.FullName, "project"));
            var original = Path.Combine(root.FullName, "unrelated.txt"); File.WriteAllText(original, "keep");
            Assert.True(CreateHardLink(Path.Combine(project.FullName, "a.txt"), original, IntPtr.Zero));
            Assert.Throws<InvalidOperationException>(() => ProjectCheckpoints.ImportPlan(project.FullName));
            var checkpoints = new ProjectCheckpoints(); checkpoints.RecordWrite("a.txt", "attack");
            Assert.Throws<InvalidOperationException>(() => checkpoints.Prepare(project.FullName));
            Assert.Equal("keep", File.ReadAllText(original));
        }
        finally { root.Delete(true); }
    }
}
