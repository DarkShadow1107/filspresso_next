using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Filspresso.Core.Tools;

/// <summary>
/// Holds every directory from the volume root without FILE_SHARE_WRITE/DELETE, and opens the
/// final component without following reparse points. Windows sharing checks prevent an
/// unprivileged process from renaming a pinned ancestor. This is not protection from an
/// administrator, a compromised kernel, remote filesystems or a malicious disk driver.
/// </summary>
public sealed class PinnedLocalPath : IDisposable
{
    private readonly List<SafeFileHandle> _directories = new();
    public string DirectoryPath { get; }
    private bool _disposed;

    public static string Normalize(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Length < 3 || !char.IsAsciiLetter(path[0]) ||
            path[1] != ':' || path[2] != '\\' || path.Contains('/') || path.AsSpan(2).Contains(':'))
            throw new InvalidOperationException("Choose an absolute local drive path, not a share, device or stream.");
        var full = Path.GetFullPath(path);
        if (new DriveInfo(full[..3]).DriveType != DriveType.Fixed)
            throw new InvalidOperationException("A fixed local drive is required.");
        return Path.TrimEndingDirectorySeparator(full);
    }

    public PinnedLocalPath(string directory, bool create = false)
    {
        DirectoryPath = Normalize(directory);
        try
        {
            var current = DirectoryPath[..3];
            Pin(current);
            foreach (var part in DirectoryPath[3..].Split('\\', StringSplitOptions.RemoveEmptyEntries))
            {
                current = Path.Combine(current, part);
                if (create && !Directory.Exists(current)) Directory.CreateDirectory(current);
                Pin(current);
            }
        }
        catch { Dispose(); throw; }
    }

    private void Pin(string path)
    {
        // Deny write as well as delete sharing: an in-place FSCTL_SET_REPARSE_POINT
        // must not mutate an already-pinned ancestor without renaming it.
        var handle = CreateFile(path, 0x80, 1, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
        if (handle.IsInvalid)
        {
            var error = Marshal.GetLastWin32Error(); handle.Dispose();
            if (error is 2 or 3) throw new DirectoryNotFoundException("A local directory is missing.");
            throw new IOException("Cannot pin local directory.", new Win32Exception(error));
        }
        try
        {
            var info = Inspect(handle);
            if ((info.Attributes & FileAttributes.ReparsePoint) != 0 || (info.Attributes & FileAttributes.Directory) == 0)
                throw new InvalidOperationException("Project/image paths must not contain reparse points.");
            _directories.Add(handle);
        }
        catch { handle.Dispose(); throw; }
    }

    public FileStream OpenFile(string name, FileAccess access = FileAccess.Read, bool createNew = false)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (string.IsNullOrEmpty(name) || name is "." or ".." || name.IndexOfAny(['\\', '/', ':']) >= 0)
            throw new InvalidOperationException("Open only a single file component in the pinned directory.");
        var rights = access == FileAccess.Read ? 0x80000000u : 0xc0000000u;
        var handle = CreateFile(Path.Combine(DirectoryPath, name), rights, 0, IntPtr.Zero, createNew ? 1u : 3u, 0x00200000, IntPtr.Zero);
        if (handle.IsInvalid)
        {
            var error = Marshal.GetLastWin32Error(); handle.Dispose();
            if (error is 2 or 3) throw new FileNotFoundException("The local file is missing.");
            throw new IOException("Cannot exclusively open local file.", new Win32Exception(error));
        }
        try
        {
            var info = Inspect(handle);
            if ((info.Attributes & (FileAttributes.ReparsePoint | FileAttributes.Directory | FileAttributes.Device)) != 0 || info.Links != 1)
                throw new InvalidOperationException("Only regular, single-link local files are accepted.");
            return new FileStream(handle, access);
        }
        catch { handle.Dispose(); throw; }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        for (var index = _directories.Count - 1; index >= 0; index--) _directories[index].Dispose();
        _directories.Clear();
    }

    private static Information Inspect(SafeFileHandle handle)
    {
        if (!GetFileInformationByHandle(handle, out var info)) throw new IOException("Cannot inspect local file handle.", new Win32Exception(Marshal.GetLastWin32Error()));
        return info;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Information
    {
        public FileAttributes Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint sharing, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Information information);
}
