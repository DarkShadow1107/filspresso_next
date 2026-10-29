// C# 5 / .NET Framework compatible: compiled by Windows PowerShell Add-Type IN THE GUEST.
// Also linked into the test assembly so the actual native implementation is exercised.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace Filspresso.Guest
{
    public sealed class Fence : IDisposable
    {
        readonly List<SafeFileHandle> pins = new List<SafeFileHandle>();
        public readonly string Path;
        public Fence(string root, string path, bool create)
        {
            root = System.IO.Path.GetFullPath(root).TrimEnd('\\');
            Path = System.IO.Path.GetFullPath(path).TrimEnd('\\');
            if (root.Length < 3 || root[1] != ':' || root.StartsWith("\\") ||
                (Path != root && !Path.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase)) || Path.IndexOf(':', 2) >= 0)
                throw new IOException("Outside workspace");
            try
            {
                var current = Path.Substring(0, 3);
                Pin(current);
                foreach (var part in Path.Substring(3).Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    current = System.IO.Path.Combine(current, part);
                    if (create && !Directory.Exists(current)) Directory.CreateDirectory(current);
                    Pin(current);
                }
            }
            catch { Dispose(); throw; }
        }
        void Pin(string path)
        {
            var handle = Native.CreateFile(path, 0x80, 1, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
            if (handle.IsInvalid)
            {
                var error = Marshal.GetLastWin32Error(); handle.Dispose();
                if (error == 2 || error == 3) throw new DirectoryNotFoundException();
                throw new IOException("Cannot pin workspace directory", new Win32Exception(error));
            }
            try
            {
                var info = Native.Info(handle);
                if ((info.Attributes & 0x400) != 0 || (info.Attributes & 0x10) == 0) throw new IOException("ReparsePoint or non-directory");
                pins.Add(handle);
            }
            catch { handle.Dispose(); throw; }
        }
        public FileStream Open(string name, bool write)
        {
            if (pins.Count == 0 || string.IsNullOrEmpty(name) || name == "." || name == ".." || name.TrimEnd(' ', '.') != name ||
                name.IndexOfAny(new[] { '\\', '/', ':' }) >= 0) throw new IOException("Invalid workspace file");
            // OPEN_ALWAYS never truncates before the opened object has been inspected.
            var handle = Native.CreateFile(System.IO.Path.Combine(Path, name), write ? 0xc0000000u : 0x80000000u, 0,
                IntPtr.Zero, write ? 4u : 3u, 0x00200000, IntPtr.Zero);
            if (handle.IsInvalid)
            {
                var error = Marshal.GetLastWin32Error(); handle.Dispose();
                if (error == 2 || error == 3) throw new FileNotFoundException();
                throw new IOException("Cannot exclusively open workspace file", new Win32Exception(error));
            }
            try
            {
                var info = Native.Info(handle);
                if ((info.Attributes & (0x400 | 0x10 | 0x40)) != 0 || info.Links != 1) throw new IOException("ReparsePoint or file alias");
                return new FileStream(handle, write ? FileAccess.ReadWrite : FileAccess.Read);
            }
            catch { handle.Dispose(); throw; }
        }
        public void Dispose() { for (var i = pins.Count - 1; i >= 0; i--) pins[i].Dispose(); pins.Clear(); }
    }

    public sealed class CommandResult
    {
        public int ExitCode;
        public string Stdout, Stderr;
        public bool TimedOut, OutputLimited, DescendantsClean;
    }

    public static class Command
    {
        public const int MaxOutput = 131072;
        // AppContainer denies host/guest-admin authority, network capabilities, and broker
        // activation outside its lowbox. Hyper-V remains the outer boundary, never this job.
        public static CommandResult Run(string workspace, string directory, string encoded, int milliseconds)
        { return RunCore(workspace, directory, encoded, milliseconds, "Filspresso." + Guid.NewGuid().ToString("N"), false); }
        // Native fallback is explicit, not a host-shell retry. A caller-owned identity allows
        // authenticated crash recovery; only the isolated child interprets generated source.
        public static CommandResult RunRestricted(string workspace, string directory, string encoded, int milliseconds, string profile)
        { return RunCore(workspace, directory, encoded, milliseconds, profile, true); }
        static CommandResult RunCore(string workspace, string directory, string encoded, int milliseconds, string profile, bool nativeHost)
        {
            if (milliseconds < 1 || milliseconds > 300000) throw new ArgumentOutOfRangeException("milliseconds");
            Guid profileId;
            if (profile == null || !profile.StartsWith("Filspresso.", StringComparison.Ordinal) || !Guid.TryParseExact(profile.Substring(11), "N", out profileId)) throw new ArgumentException("Invalid lowbox identity");
            IntPtr sid = IntPtr.Zero, job = IntPtr.Zero, attributes = IntPtr.Zero, caps = IntPtr.Zero, handleList = IntPtr.Zero;
            IntPtr environment = IntPtr.Zero, desktop = IntPtr.Zero;
            IntPtr stdoutRead = IntPtr.Zero, stdoutWrite = IntPtr.Zero, stderrRead = IntPtr.Zero, stderrWrite = IntPtr.Zero, stdin = IntPtr.Zero;
            var process = new Native.ProcessInformation();
            var createdProfile = false;
            using (var fence = new Fence(workspace, directory, false))
            try
            {
                var hr = Native.CreateAppContainerProfile(profile, profile, "Disposable offline command", IntPtr.Zero, 0, out sid);
                if (hr < 0) Marshal.ThrowExceptionForHR(hr);
                createdProfile = true;
                var identity = new SecurityIdentifier(sid);
                var root = new DirectoryInfo(workspace);
                var acl = root.GetAccessControl();
                var rule = new FileSystemAccessRule(identity, FileSystemRights.Modify, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                    PropagationFlags.None, AccessControlType.Allow);
                acl.AddAccessRule(rule); root.SetAccessControl(acl);
                // Lowbox token integrity is low. Only the disposable workspace is low-labelled.
                Native.LabelLow(workspace);
                Directory.CreateDirectory(System.IO.Path.Combine(workspace, ".tmp"));
                job = Native.CreateJobObject(IntPtr.Zero, null); Native.Check(job != IntPtr.Zero);
                var limits = new Native.ExtendedLimits();
                limits.Basic.Flags = 0x2000 | 0x8 | 0x100 | 0x200; // kill-on-close, active-process, process/job memory
                limits.Basic.ActiveProcesses = 32;
                limits.ProcessMemory = (UIntPtr)(512u * 1024 * 1024);
                limits.JobMemory = (UIntPtr)(1024u * 1024 * 1024);
                Native.SetJob(job, 9, limits);
                Native.SetJob(job, 15, new Native.CpuRate { Flags = 1 | 4, Rate = 2000 }); // hard 20% CPU cap
                Native.VerifyLimits(job);
                if (nativeHost)
                {
                    Native.SetJob(job, 4, 255u); // UI handles, clipboard, desktop and global UI changes denied
                    Native.VerifyUI(job);
                }
                var security = new Native.SecurityAttributes { Length = Marshal.SizeOf(typeof(Native.SecurityAttributes)), Inherit = true };
                Native.Check(Native.CreatePipe(out stdoutRead, out stdoutWrite, ref security, 0));
                Native.Check(Native.CreatePipe(out stderrRead, out stderrWrite, ref security, 0));
                Native.Check(Native.SetHandleInformation(stdoutRead, 1, 0));
                Native.Check(Native.SetHandleInformation(stderrRead, 1, 0));
                using (var input = Native.CreateFile("NUL", 0x80000000, 3, ref security, 3, 0, IntPtr.Zero))
                {
                    Native.Check(!input.IsInvalid); stdin = input.DangerousGetHandle();
                    var size = IntPtr.Zero;
                    Native.InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
                    attributes = Marshal.AllocHGlobal(size);
                    Native.Check(Native.InitializeProcThreadAttributeList(attributes, 2, 0, ref size));
                    caps = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Native.SecurityCapabilities)));
                    Marshal.StructureToPtr(new Native.SecurityCapabilities { Sid = sid }, caps, false);
                    Native.Check(Native.UpdateProcThreadAttribute(attributes, 0, (IntPtr)0x20009, caps,
                        (IntPtr)Marshal.SizeOf(typeof(Native.SecurityCapabilities)), IntPtr.Zero, IntPtr.Zero));
                    handleList = Marshal.AllocHGlobal(3 * IntPtr.Size);
                    Marshal.WriteIntPtr(handleList, 0, stdin); Marshal.WriteIntPtr(handleList, IntPtr.Size, stdoutWrite); Marshal.WriteIntPtr(handleList, 2 * IntPtr.Size, stderrWrite);
                    Native.Check(Native.UpdateProcThreadAttribute(attributes, 0, (IntPtr)0x20002, handleList, (IntPtr)(3 * IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
                    var startup = new Native.StartupInfoEx();
                    startup.Startup.Size = Marshal.SizeOf(typeof(Native.StartupInfoEx)); startup.Startup.Flags = 0x100;
                    startup.Startup.Input = stdin; startup.Startup.Output = stdoutWrite; startup.Startup.Error = stderrWrite; startup.Attributes = attributes;
                    if (nativeHost)
                    {
                        var desktopName = "Filspresso_" + Guid.NewGuid().ToString("N");
                        desktop = Native.PrivateDesktop(desktopName, identity.Value);
                        startup.Startup.Desktop = "WinSta0\\" + desktopName;
                    }
                    var executable = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
                    // Never inherit host API keys, tokens, proxies, module paths or user PATH.
                    var system = Environment.GetFolderPath(Environment.SpecialFolder.System);
                    var windows = System.IO.Directory.GetParent(system).FullName;
                    var trustedModules = System.IO.Path.Combine(system, @"WindowsPowerShell\v1.0\Modules");
                    var temporary = System.IO.Path.Combine(workspace, ".tmp");
                    var variables = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
                        { "APPDATA", temporary }, { "LOCALAPPDATA", temporary }, { "ComSpec", System.IO.Path.Combine(system, "cmd.exe") },
                        // The lowbox gets only the inbox Windows PowerShell modules, not the
                        // caller's PSModulePath. NativeSandbox explicitly imports the
                        // FileSystem provider from here before using New-PSDrive.
                        { "Path", system + ";" + System.IO.Path.GetDirectoryName(executable) }, { "PSModulePath", trustedModules }, { "SystemRoot", windows },
                        { "TEMP", temporary }, { "TMP", temporary }, { "USERPROFILE", temporary }, { "windir", windows }
                    };
                    var block = new StringBuilder(); foreach (var variable in variables) block.Append(variable.Key).Append('=').Append(variable.Value).Append('\0');
                    block.Append('\0'); environment = Marshal.StringToHGlobalUni(block.ToString());
                    // The only inherited handles are stdin/out/err; job and directory handles never enter the lowbox.
                    Native.Check(Native.CreateProcess(executable, new StringBuilder("\"" + executable + "\" -NoProfile -NonInteractive -EncodedCommand " + encoded),
                        IntPtr.Zero, IntPtr.Zero, true, 0x80000 | 0x4 | 0x08000000 | 0x400, environment, directory, ref startup, out process));
                }
                Native.Close(ref stdoutWrite); Native.Close(ref stderrWrite);
                // No user instruction can run until assignment and token verification succeed.
                Native.Check(Native.AssignProcessToJobObject(job, process.Process));
                Native.VerifyAppContainer(process.Process);
                Native.Check(Native.ResumeThread(process.Thread) != 0xffffffff);
                var output = new MemoryStream(); var error = new MemoryStream(); var clock = Stopwatch.StartNew();
                var result = new CommandResult();
                uint wait;
                while ((wait = Native.WaitForSingleObject(process.Process, 0)) == 258)
                {
                    if (!Drain(stdoutRead, output, error) || !Drain(stderrRead, error, output)) { result.OutputLimited = true; break; }
                    if (clock.ElapsedMilliseconds >= milliseconds) { result.TimedOut = true; break; }
                    Thread.Sleep(10);
                }
                if (wait != 0 && wait != 258) throw new IOException("Process wait failed");
                uint exit;
                Native.Check(Native.GetExitCodeProcess(process.Process, out exit)); result.ExitCode = unchecked((int)exit);
                // Always kill remaining children, even if the root exited successfully with detached descendants.
                Native.Check(Native.TerminateJobObject(job, 1));
                var cleanup = Stopwatch.StartNew();
                while (Native.Active(job) != 0)
                { if (cleanup.ElapsedMilliseconds > 5000) throw new IOException("Job cleanup unconfirmed"); Thread.Sleep(10); }
                result.DescendantsClean = true;
                if (!Drain(stdoutRead, output, error) || !Drain(stderrRead, error, output)) result.OutputLimited = true;
                result.Stdout = Encoding.UTF8.GetString(output.ToArray()); result.Stderr = Encoding.UTF8.GetString(error.ToArray());
                return result;
            }
            finally
            {
                if (job != IntPtr.Zero) Native.TerminateJobObject(job, 1);
                // An unassigned suspended child must also be killed on setup failure.
                if (process.Process != IntPtr.Zero) Native.TerminateProcess(process.Process, 1);
                Native.Close(ref process.Thread); Native.Close(ref process.Process); Native.Close(ref job);
                Native.Close(ref stdoutRead); Native.Close(ref stdoutWrite); Native.Close(ref stderrRead); Native.Close(ref stderrWrite);
                if (desktop != IntPtr.Zero) Native.CloseDesktop(desktop);
                if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
                if (attributes != IntPtr.Zero) { Native.DeleteProcThreadAttributeList(attributes); Marshal.FreeHGlobal(attributes); }
                if (caps != IntPtr.Zero) Marshal.FreeHGlobal(caps);
                if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
                if (createdProfile)
                {
                    // ACL cleanup is required; do not accumulate reusable lowbox identities.
                    var root = new DirectoryInfo(workspace); var acl = root.GetAccessControl();
                    acl.PurgeAccessRules(new SecurityIdentifier(sid)); root.SetAccessControl(acl);
                    var hr = Native.DeleteAppContainerProfile(profile); if (hr < 0) Marshal.ThrowExceptionForHR(hr);
                }
                if (sid != IntPtr.Zero) Native.FreeSid(sid);
            }
        }
        public static void RecoverProfile(string workspace, string profile)
        {
            Guid id;
            if (profile == null || !profile.StartsWith("Filspresso.", StringComparison.Ordinal) || !Guid.TryParseExact(profile.Substring(11), "N", out id)) throw new ArgumentException("Invalid lowbox identity");
            IntPtr sid;
            var hr = Native.DeriveAppContainerSidFromAppContainerName(profile, out sid);
            if (hr < 0) Marshal.ThrowExceptionForHR(hr);
            try
            {
                if (Directory.Exists(workspace))
                using (var fence = new Fence(workspace, workspace, false))
                {
                    var root = new DirectoryInfo(workspace); var acl = root.GetAccessControl();
                    acl.PurgeAccessRules(new SecurityIdentifier(sid)); root.SetAccessControl(acl);
                }
                hr = Native.DeleteAppContainerProfile(profile);
                if (hr < 0 && hr != unchecked((int)0x80070002) && hr != unchecked((int)0x80070490)) Marshal.ThrowExceptionForHR(hr);
            }
            finally { Native.FreeSid(sid); }
        }
        static bool Drain(IntPtr pipe, MemoryStream destination, MemoryStream other)
        {
            uint available;
            if (!Native.PeekNamedPipe(pipe, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero))
            { if (Marshal.GetLastWin32Error() == 109) return true; throw new IOException("Output pipe failure"); }
            while (available > 0)
            {
                var bytes = new byte[Math.Min(available, 4096)]; uint read;
                Native.Check(Native.ReadFile(pipe, bytes, (uint)bytes.Length, out read, IntPtr.Zero));
                if (destination.Length + other.Length + read > MaxOutput) return false;
                destination.Write(bytes, 0, (int)read); available -= read;
                if (read == 0) break;
            }
            return true;
        }
    }

    internal static class Native
    {
        internal static IntPtr PrivateDesktop(string name, string lowbox)
        {
            var user = WindowsIdentity.GetCurrent().User.Value;
            IntPtr descriptor; uint bytes;
            Check(ConvertStringSecurityDescriptorToSecurityDescriptor("D:P(A;;GA;;;SY)(A;;GA;;;" + user + ")(A;;GA;;;" + lowbox + ")S:(ML;;NW;;;LW)", 1, out descriptor, out bytes));
            try
            {
                var security = new SecurityAttributes { Length = Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor = descriptor };
                var desktop = CreateDesktop(name, null, IntPtr.Zero, 0, 0x1ff, ref security);
                Check(desktop != IntPtr.Zero); return desktop;
            }
            finally { LocalFree(descriptor); }
        }
        internal static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
        internal static void Close(ref IntPtr handle) { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
        internal static Information Info(SafeFileHandle handle) { Information info; Check(GetFileInformationByHandle(handle, out info)); return info; }
        internal static void SetJob<T>(IntPtr job, int kind, T value)
        { var size = Marshal.SizeOf(typeof(T)); var data = Marshal.AllocHGlobal(size); try { Marshal.StructureToPtr(value, data, false); Check(SetInformationJobObject(job, kind, data, (uint)size)); } finally { Marshal.FreeHGlobal(data); } }
        internal static uint Active(IntPtr job) { Accounting accounting; Check(QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero)); return accounting.Active; }
        internal static void VerifyAppContainer(IntPtr process)
        {
            IntPtr token; Check(OpenProcessToken(process, 8, out token));
            try
            {
                int value, size; Check(GetTokenInformation(token, 29, out value, 4, out size));
                if (value != 1) throw new IOException("No AppContainer token");
                GetTokenInformation(token, 30, IntPtr.Zero, 0, out size);
                if (size < 4 || size > 4096) throw new IOException("Invalid capabilities size");
                var buffer = Marshal.AllocHGlobal(size);
                try { Check(GetTokenInformation(token, 30, buffer, size, out size)); if (Marshal.ReadInt32(buffer) != 0) throw new IOException("Unexpected AppContainer capabilities"); }
                finally { Marshal.FreeHGlobal(buffer); }
            }
            finally { Close(ref token); }
        }
        internal static void VerifyLimits(IntPtr job)
        {
            ExtendedLimits limits; CpuRate cpu;
            Check(QueryInformationJobObject(job, 9, out limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits)), IntPtr.Zero));
            Check(QueryInformationJobObject(job, 15, out cpu, (uint)Marshal.SizeOf(typeof(CpuRate)), IntPtr.Zero));
            if ((limits.Basic.Flags & (0x2000 | 0x8 | 0x100 | 0x200)) != (0x2000 | 0x8 | 0x100 | 0x200) ||
                (limits.Basic.Flags & (0x800 | 0x1000)) != 0 || limits.Basic.ActiveProcesses != 32 ||
                limits.ProcessMemory.ToUInt64() != 512ul * 1024 * 1024 || limits.JobMemory.ToUInt64() != 1024ul * 1024 * 1024 ||
                cpu.Flags != 5 || cpu.Rate != 2000) throw new IOException("Job limits not enforced");
        }
        internal static void VerifyUI(IntPtr job)
        {
            uint restrictions; Check(QueryInformationJobObject(job, 4, out restrictions, 4, IntPtr.Zero));
            if (restrictions != 255) throw new IOException("Native UI restrictions missing");
        }
        internal static void LabelLow(string path)
        {
            IntPtr descriptor; uint size; Check(ConvertStringSecurityDescriptorToSecurityDescriptor("S:(ML;OICI;NW;;;LW)", 1, out descriptor, out size));
            try { bool present, defaulted; IntPtr sacl; Check(GetSecurityDescriptorSacl(descriptor, out present, out sacl, out defaulted)); var error = SetNamedSecurityInfo(path, 1, 0x10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl); if (error != 0) throw new Win32Exception((int)error); }
            finally { LocalFree(descriptor); }
        }
        [StructLayout(LayoutKind.Sequential)] internal struct Information { public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write; public uint Volume, High, Low, Links, IndexHigh, IndexLow; }
        [StructLayout(LayoutKind.Sequential)] internal struct BasicLimits { public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorking, MaxWorking; public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority, Scheduling; }
        [StructLayout(LayoutKind.Sequential)] internal struct ExtendedLimits { public BasicLimits Basic; public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
        [StructLayout(LayoutKind.Sequential)] internal struct Accounting { public long User, Kernel, PeriodUser, PeriodKernel; public uint Faults, Total, Active, Terminated; }
        [StructLayout(LayoutKind.Sequential)] internal struct CpuRate { public uint Flags, Rate; }
        [StructLayout(LayoutKind.Sequential)] internal struct SecurityAttributes { public int Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
        [StructLayout(LayoutKind.Sequential)] internal struct SecurityCapabilities { public IntPtr Sid, Capabilities; public uint Count, Reserved; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct StartupInfo { public int Size; public string Reserved, Desktop, Title; public int X, Y, Width, Height, XChars, YChars, Fill, Flags; public short Show, ReservedSize; public IntPtr ReservedData, Input, Output, Error; }
        [StructLayout(LayoutKind.Sequential)] internal struct StartupInfoEx { public StartupInfo Startup; public IntPtr Attributes; }
        [StructLayout(LayoutKind.Sequential)] internal struct ProcessInformation { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
        [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern SafeFileHandle CreateFile(string path, uint access, uint sharing, IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern SafeFileHandle CreateFile(string path, uint access, uint sharing, ref SecurityAttributes security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Information info);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr CreateJobObject(IntPtr security, string name);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr data, uint size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting data, uint size, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out ExtendedLimits data, uint size, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out CpuRate data, uint size, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out uint data, uint size, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool TerminateJobObject(IntPtr job, uint code);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool TerminateProcess(IntPtr process, uint code);
        [DllImport("kernel32.dll")] internal static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SecurityAttributes security, uint size);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
        [DllImport("kernel32.dll")] internal static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool CreateProcess(string application, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation process);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(IntPtr handle, uint time);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetExitCodeProcess(IntPtr process, out uint code);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool PeekNamedPipe(IntPtr pipe, IntPtr buffer, uint size, IntPtr read, out uint available, IntPtr remaining);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool ReadFile(IntPtr file, byte[] buffer, uint size, out uint read, IntPtr overlapped);
        [DllImport("userenv.dll", CharSet = CharSet.Unicode)] internal static extern int CreateAppContainerProfile(string name, string display, string description, IntPtr capabilities, uint count, out IntPtr sid);
        [DllImport("userenv.dll", CharSet = CharSet.Unicode)] internal static extern int DeleteAppContainerProfile(string name);
        [DllImport("userenv.dll", CharSet = CharSet.Unicode)] internal static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
        [DllImport("user32.dll", EntryPoint = "CreateDesktopW", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateDesktop(string name, string device, IntPtr mode, uint flags, uint access, ref SecurityAttributes security);
        [DllImport("user32.dll", SetLastError = true)] internal static extern bool CloseDesktop(IntPtr desktop);
        [DllImport("advapi32.dll")] internal static extern IntPtr FreeSid(IntPtr sid);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int kind, out int value, int size, out int returned);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr value, int size, out int returned);
        [DllImport("advapi32.dll", EntryPoint = "ConvertStringSecurityDescriptorToSecurityDescriptorW", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint revision, out IntPtr descriptor, out uint size);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetSecurityDescriptorSacl(IntPtr descriptor, out bool present, out IntPtr sacl, out bool defaulted);
        [DllImport("advapi32.dll", EntryPoint = "SetNamedSecurityInfoW", CharSet = CharSet.Unicode)] static extern uint SetNamedSecurityInfo(string path, int type, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
        [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
    }
}
