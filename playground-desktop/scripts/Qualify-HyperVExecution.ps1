#Requires -RunAsAdministrator
#Requires -Version 5.1
<#
.SYNOPSIS
Run the real policy-3 Hyper-V qualification executable, not synthetic receipt checks.
.DESCRIPTION
Requires a licensed, preprovisioned Windows 10/11 Generation-2 VHDX, a dedicated guest
administrator credential for trusted remoting, and an exact matching application build.
Commands run under a capability-free AppContainer, not the remoting administrator.
Creates disposable offline VMs, runs hostile probes and kills a qualification worker to
prove recovery. Never downloads an OS, changes host features, or installs the MSI.
Every check must pass before a new machine/image/build-bound receipt is created.
The receipt is NOT consent and does not qualify production inference/billing or installation.
.EXAMPLE
.\Qualify-HyperVExecution.ps1 -ImagePath D:\Images\guest.vhdx -GuestCredential (Get-Credential) -SaveGuestCredential
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ImagePath,
    [Parameter(Mandatory = $true)][Management.Automation.PSCredential]$GuestCredential,
    [string]$QualifierPath = (Join-Path $PSScriptRoot '..\artifacts\qualification\Filspresso.Qualify.exe'),
    [string]$ApplicationSandboxAssembly = (Join-Path $PSScriptRoot '..\artifacts\publish-next\Filspresso.Sandbox.dll'),
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'Filspresso\Playground\sandbox'),
    [string]$ReceiptPath = (Join-Path $env:LOCALAPPDATA 'Filspresso\Playground\qualification\hyper-v.json'),
    [switch]$SaveGuestCredential
)
$ErrorActionPreference = 'Stop'
foreach ($path in @($ImagePath, $QualifierPath, $ApplicationSandboxAssembly, $StateRoot, $ReceiptPath)) {
    if ([string]::IsNullOrWhiteSpace($path) -or $path.Contains('"') -or $path.Contains("`n") -or $path.Contains("`r")) { throw 'Invalid operator path.' }
}
$QualifierPath = [IO.Path]::GetFullPath($QualifierPath)
$boundary = Join-Path (Split-Path -Parent $QualifierPath) 'Filspresso.Sandbox.dll'
if ((Get-FileHash -LiteralPath $boundary -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $ApplicationSandboxAssembly -Algorithm SHA256).Hash) {
    throw 'Qualifier/app sandbox assemblies differ. Build/package both together; a receipt from another build cannot enable the application.'
}
if (Test-Path -LiteralPath $ReceiptPath) { throw 'Receipt already exists. Archive it explicitly before requalification; it will not be overwritten.' }
$start = New-Object Diagnostics.ProcessStartInfo
$start.FileName = $QualifierPath
$start.Arguments = 'qualify "' + [IO.Path]::GetFullPath($ImagePath) + '" "' + [IO.Path]::GetFullPath($StateRoot) + '" "' + [IO.Path]::GetFullPath($ReceiptPath) + '"'
$start.UseShellExecute = $false
$start.RedirectStandardInput = $true
$start.CreateNoWindow = $true
$process = New-Object Diagnostics.Process
$process.StartInfo = $start
try {
    if (-not $process.Start()) { throw 'Cannot start qualification executable.' }
    $payload = @{ user = $GuestCredential.UserName; password = $GuestCredential.GetNetworkCredential().Password } | ConvertTo-Json -Compress
    $process.StandardInput.WriteLine($payload); $process.StandardInput.Close(); $payload = $null
    if (-not $process.WaitForExit(1900000)) { $process.Kill(); throw 'Qualification deadline exceeded; inspect retained recovery intents.' }
    if ($process.ExitCode -ne 0) { throw 'Qualification failed. No execution receipt was issued; do not bypass the failed gate.' }
} finally { $process.Dispose() }

if ($SaveGuestCredential) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FilspressoGuestCredential {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Credential {
        public uint Flags, Type; public string Target, Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME Written;
        public uint Size; public IntPtr Blob; public uint Persist, Count;
        public IntPtr Attributes; public string Alias, User;
    }
    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredWrite(ref Credential value, uint flags);
    public static void Save(string user, string password) {
        var secret = Marshal.StringToHGlobalUni(password);
        try {
            var row = new Credential { Type = 1, Target = "Filspresso.Playground.HyperVGuest",
                User = user, Blob = secret, Size = (uint)(password.Length * 2), Persist = 2 };
            if (!CredWrite(ref row, 0)) throw new System.ComponentModel.Win32Exception();
        } finally { Marshal.ZeroFreeGlobalAllocUnicode(secret); }
    }
}
'@
    [FilspressoGuestCredential]::Save($GuestCredential.UserName, $GuestCredential.GetNetworkCredential().Password)
}
Write-Host "Live qualification passed: $ReceiptPath"
Write-Host 'Use the same Windows account and exact application build. Every write/command still needs its own fresh approval.'
if (-not $SaveGuestCredential) { Write-Warning 'Provision the dedicated guest credential in Credential Manager before starting execution.' }
