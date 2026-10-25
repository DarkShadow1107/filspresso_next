using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace Filspresso.Sandbox;

/// <summary>Trusted PowerShell waits for a private stdin handshake until enrolled. Closing
/// this job (including parent process death) kills administration and its descendants.</summary>
internal sealed class HostProcessJob : IDisposable
{
    private readonly SafeFileHandle _handle;
    internal HostProcessJob()
    {
        _handle = CreateJobObject(IntPtr.Zero, null);
        if (_handle.IsInvalid) throw new Win32Exception();
        var limits = new Limits { Basic = new Basic { Flags = 0x2000 } };
        if (!SetInformationJobObject(_handle, 9, ref limits, Marshal.SizeOf<Limits>()))
        { _handle.Dispose(); throw new Win32Exception(); }
    }
    internal void Assign(Process process)
    { if (!AssignProcessToJobObject(_handle, process.Handle)) throw new Win32Exception(); }
    internal void Terminate()
    {
        if (!TerminateJobObject(_handle, 1)) throw new Win32Exception();
        var clock = Stopwatch.StartNew();
        for (;;)
        {
            if (!QueryInformationJobObject(_handle, 1, out var accounting, Marshal.SizeOf<Accounting>(), IntPtr.Zero)) throw new Win32Exception();
            if (accounting.Active == 0) return;
            if (clock.Elapsed > TimeSpan.FromSeconds(5)) throw new PowerShellProcessCleanupException();
            Thread.Sleep(10);
        }
    }
    public void Dispose() => _handle.Dispose();
    [StructLayout(LayoutKind.Sequential)] private struct Basic
    { public long ProcessTime, JobTime; public uint Flags; public UIntPtr Min, Max; public uint Processes; public UIntPtr Affinity; public uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)] private struct Limits
    { public Basic Basic; public ulong Read, Write, Other, ReadBytes, WriteBytes, OtherBytes; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
    [StructLayout(LayoutKind.Sequential)] private struct Accounting
    { public long User, Kernel, PeriodUser, PeriodKernel; public uint Faults, Total, Active, Terminated; }
    [DllImport("kernel32.dll", EntryPoint = "CreateJobObjectW", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateJobObject(IntPtr security, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(SafeFileHandle job, int kind, ref Limits limits, int bytes);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(SafeFileHandle job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(SafeFileHandle job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(SafeFileHandle job, int kind, out Accounting accounting, int size, IntPtr returned);
}
