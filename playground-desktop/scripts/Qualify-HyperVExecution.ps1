#Requires -RunAsAdministrator
#Requires -Version 5.1
<#
.SYNOPSIS
Operator qualification for local Hyper-V desktop execution (Filspresso Playground).

.DESCRIPTION
Validates one preprovisioned, unattached Windows Generation 2 guest image and records a
machine-bound receipt the desktop client reads when composing the agent conversation:

    %LOCALAPPDATA%\Filspresso\Playground\qualification\hyper-v.json

There is no image download or OS provisioning here: the operator owns the guest image and
its credentials. This script only proves the environment and writes the receipt. It must be
run from an elevated PowerShell on the machine that will run the desktop client; a receipt
copied elsewhere is refused (machine binding).

Gates (same names the client requires, in order):
  hyper-v-admin      Elevated host, Hyper-V module present, VM management service running.
  image-hash-verified  The image SHA-256 and byte length are measured (read-only).
  image-unattached   The image is not mounted and is not itself a differencing disk.
  no-network-adapter The qualification VM is created with zero network adapters.
  guest-ready        PowerShell Direct reaches the booted guest within the readiness budget.
  workspace-fenced   The guest workspace sentinel file is created/read/deleted inside
                     C:\filspresso-workspace.
  cleanup-confirmed  VM, differencing disk and state directory leftovers are confirmed gone.

The receipt is Enablement evidence for the client; it is NEVER consent. The signed-in user
still approves every single write or command from the window at the time it is proposed.
Receipt max age is 30 days: re-run this script after image or policy changes.

Optionally (-SaveGuestCredential) stores the dedicated guest credential in Windows
Credential Manager under the target name the client reads:

    Filspresso.Playground.HyperVGuest

Never store the Filspresso sign-in password or host login there; this credential belongs to
the per-machine qualification image only.

.EXAMPLE
.\Qualify-HyperVExecution.ps1 -ImagePath "D:\Images\filspresso-guest.vhdx"

.EXAMPLE
.\Qualify-HyperVExecution.ps1 -ImagePath "D:\Images\filspresso-guest.vhdx" `
    -GuestCredential (Get-Credential 'FILSPRESSO-GUEST\qualifier') -SaveGuestCredential
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ImagePath,

    # Optional: also store the guest credential for the desktop client. Never a host or
    # Filspresso account credential.
    [Parameter(Mandatory = $false)]
    [System.Management.Automation.PSCredential]$GuestCredential,
    [Parameter(Mandatory = $false)]
    [switch]$SaveGuestCredential,
    [Parameter(Mandatory = $false)]
    [string]$GuestTarget = 'Filspresso.Playground.HyperVGuest',

    # Two vCPU and 1-4 GB dynamic memory match the client's own sandbox sizing for the
    # disposable conversation VM. The qualification VM uses the same bound.
    [Parameter(Mandatory = $false)]
    [ValidateRange(2, 2)][int]$ProcessorCount = 2,
    [Parameter(Mandatory = $false)]
    [ValidateRange(1073741824, 1073741824)][long]$MinimumMemoryBytes = 1GB,
    [Parameter(Mandatory = $false)]
    [ValidateRange(4294967296, 4294967296)][long]$MaximumMemoryBytes = 4GB,
    [Parameter(Mandatory = $false)]
    [ValidateRange(15, 300)][int]$GuestReadySeconds = 300
)

$ErrorActionPreference = 'Stop'
$script:Checks = New-Object System.Collections.Generic.List[string]

function Exit-Qualification([string]$gate, [string]$reason) {
    throw "Gate '$gate' failed: $reason"
}

function Get-CanonicalMachineId {
    $guid = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name 'MachineGuid').MachineGuid
    if ([string]::IsNullOrWhiteSpace($guid)) { throw 'The machine id is unreadable; refusing to produce a receipt.' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ((($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($guid.Trim()))) |
            ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 32)
    } finally { $sha.Dispose() }
}

function Assert-HostAdministration {
    Write-Host 'Gate 1/7: hyper-v-admin'
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Exit-Qualification 'hyper-v-admin' 'Run this script from an elevated PowerShell.'
    }
    foreach ($command in 'New-VM', 'New-VHD', 'Get-VHD', 'Invoke-Command', 'Set-VMFirmware') {
        if ($null -eq (Get-Command $command -ErrorAction SilentlyContinue)) {
            Exit-Qualification 'hyper-v-admin' "The Hyper-V module is unavailable ($command missing)."
        }
    }
    $service = Get-Service -Name vmms -ErrorAction SilentlyContinue
    if ($null -eq $service -or $service.Status -ne 'Running') {
        Exit-Qualification 'hyper-v-admin' 'The Hyper-V Virtual Machine Management service is not running.'
    }
    $script:Checks.Add('hyper-v-admin')
}

function Measure-Image {
    Write-Host 'Gate 2/7: image-hash-verified'
    $item = Get-Item -LiteralPath $ImagePath -Force -ErrorAction Stop
    if ($item.PSIsContainer) { Exit-Qualification 'image-hash-verified' 'The image path is a directory.' }
    if ($item.FullName.Length -gt 240) {
        Exit-Qualification 'image-hash-verified' 'The image path exceeds the 240-character receipt limit; move the image closer to the drive root.'
    }
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Exit-Qualification 'image-hash-verified' 'The image path is a reparse point.'
    }
    $parent = $item.Directory
    while ($null -ne $parent) {
        if (($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Exit-Qualification 'image-hash-verified' "An image parent directory is a reparse point: $($parent.FullName)"
        }
        $parent = $parent.Parent
    }
    if (-not $item.FullName.EndsWith('.vhdx', [StringComparison]::OrdinalIgnoreCase)) {
        Exit-Qualification 'image-hash-verified' 'The image must be a .vhdx file.'
    }
    if ($item.Length -lt 16MB -or $item.Length -gt 256GB) {
        Exit-Qualification 'image-hash-verified' 'The image size is not plausible.'
    }
    $digest = (Get-FileHash -LiteralPath $ImagePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $script:ImageSha256 = $digest
    $script:ImageBytes = $item.Length
    Write-Host "  image $($item.FullName) ($($item.Length) bytes) sha256 $digest"
    $script:Checks.Add('image-hash-verified')
}

function Assert-ImageUnattached {
    Write-Host 'Gate 3/7: image-unattached'
    $vhd = Get-VHD -Path $ImagePath -ErrorAction Stop
    if ($vhd.Attached) { Exit-Qualification 'image-unattached' 'The image is attached to something right now.' }
    if ([string]$vhd.VhdFormat -ne 'VHDX') { Exit-Qualification 'image-unattached' "The image is not VHDX ($($vhd.VhdFormat))." }
    if ([string]$vhd.VhdType -eq 'Differencing') {
        Exit-Qualification 'image-unattached' 'The base image must not itself be a differencing disk.'
    }
    $script:Checks.Add('image-unattached')
}

function New-QualificationSession {
    Write-Host 'Gate 4/7: no-network-adapter'
    $name = 'filspresso-qualify-' + [Guid]::NewGuid().ToString('N')
    $root = Join-Path ([IO.Path]::Combine([Environment]::GetFolderPath('LocalApplicationData'), 'Filspresso', 'Playground', 'qualification')) $name
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    if ((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        Exit-Qualification 'no-network-adapter' "The qualification state directory is a reparse point: $root"
    }
    $script:StateRoot = $root
    $script:VmName = $name
    $script:DiskPath = Join-Path $root ($name + '.vhdx')

    # Probe first: fail before creating anything if the host cannot administer Hyper-V.
    $probe = $null
    try {
        $probe = & (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -NonInteractive -Command @'
$ErrorActionPreference = "Stop"
Get-Command New-VM, New-VHD, Get-VHD, Invoke-Command, Set-VMFirmware -ErrorAction Stop | Out-Null
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 1 }
if ((Get-Service vmms -ErrorAction Stop).Status -ne "Running") { exit 1 }
"PROBE_OK"
'@
    } catch { }
    $probeLine = $probe -split '\r?\n' | Where-Object { $_.Trim().Length -gt 0 } | Select-Object -Last 1
    if ($probeLine -isnot [string] -or $probeLine.Trim() -ne 'PROBE_OK') {
        Exit-Qualification 'no-network-adapter' 'The child PowerShell probe could not confirm Hyper-V administration.'
    }

    New-VHD -Path $script:DiskPath -ParentPath $ImagePath -Differencing -ErrorAction Stop | Out-Null
    $vm = New-VM -Name $name -Path $root -MemoryStartupBytes 2GB -VHDPath $script:DiskPath -Generation 2 -ErrorAction Stop
    $vm | Set-VMMemory -DynamicMemoryEnabled $true -MinimumBytes $MinimumMemoryBytes -MaximumBytes $MaximumMemoryBytes -ErrorAction Stop
    $vm | Set-VMProcessor -Count $ProcessorCount -ErrorAction Stop
    $vm | Set-VM -AutomaticStartAction Nothing -AutomaticStopAction TurnOff -CheckpointType Disabled -ErrorAction Stop
    # Remove even disconnected adapters. No virtual switch is configured anywhere in this flow.
    Get-VMNetworkAdapter -VM $vm -ErrorAction Stop | Remove-VMNetworkAdapter -Confirm:$false -ErrorAction Stop
    $adapters = @(Get-VMNetworkAdapter -VM $vm)
    if ($adapters.Count -ne 0) {
        $vm | Remove-VM -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $script:DiskPath -Force -ErrorAction SilentlyContinue
        Exit-Qualification 'no-network-adapter' 'Adapter removal failed; the qualification machine is not safe for the sandbox policy.'
    }
    $script:Checks.Add('no-network-adapter')
    $script:Vm = $vm
}

function Invoke-GuestDirect {
    param([scriptblock]$Work, [object[]]$ArgumentList = @())
    $guest = Invoke-Command -VMName $script:VmName -Credential $script:GuestCredential -ErrorAction Stop -ArgumentList $ArgumentList -ScriptBlock $Work
    if ($guest -isnot [string]) { throw 'Unexpected guest response type.' }
    return $guest
}

function Wait-GuestReady {
    Write-Host 'Gate 5/7: guest-ready (booting; this can take a couple of minutes)'
    if ($null -eq $script:GuestCredential) {
        $script:GuestCredential = Get-Credential -Message 'Dedicated guest image credential for the qualification VM'
        if ($null -eq $script:GuestCredential) { Exit-Qualification 'guest-ready' 'No guest credential was supplied.' }
    }
    $script:Vm | Set-VMFirmware -EnableSecureBoot On -ErrorAction Stop
    $disk = $script:Vm | Get-VMHardDiskDrive | Select-Object -First 1
    $script:Vm | Set-VMFirmware -FirstBootDevice $disk -ErrorAction Stop
    Start-VM -VM $script:Vm -ErrorAction Stop
    $deadline = [DateTime]::UtcNow.AddSeconds($GuestReadySeconds)
    do {
        Start-Sleep -Seconds 5
        try {
            $ready = Invoke-GuestDirect -Work {
                $workspace = 'C:\filspresso-workspace'
                if (-not (Test-Path -LiteralPath $workspace)) {
                    New-Item -ItemType Directory -Path $workspace -Force | Out-Null
                }
                if (-not (Test-Path -LiteralPath $workspace -PathType Container)) { throw 'workspace' }
                'READY'
            }
        } catch { Write-Host '  guest not reachable yet; waiting'; continue }
        if ($ready.Trim() -eq 'READY') {
            Write-Host '  guest ready over PowerShell Direct'
            $script:Checks.Add('guest-ready')
            return
        }
    } while ([DateTime]::UtcNow -lt $deadline)
    Exit-Qualification 'guest-ready' "The guest did not become reachable within $GuestReadySeconds seconds."
}

function Assert-WorkspaceFencing {
    Write-Host 'Gate 6/7: workspace-fenced'
    $sentinel = 'C:\filspresso-workspace\__qualify-sentinel.txt'
    $content = [Guid]::NewGuid().ToString('N')
    $round = Invoke-GuestDirect -Work {
        param($path, $expected)
        $bytes = [Text.Encoding]::UTF8.GetBytes($expected)
        [IO.File]::WriteAllBytes($path, $bytes)
        $read = [IO.File]::ReadAllBytes($path)
        if ($read.Length -ne $bytes.Length) { throw 'sentinel length mismatch' }
        for ($index = 0; $index -lt $bytes.Length; $index++) {
            if ($read[$index] -ne $bytes[$index]) { throw 'sentinel byte mismatch' }
        }
        [IO.File]::Delete($path)
        if (Test-Path -LiteralPath $path) { throw 'sentinel retained' }
        'SENTINEL_OK'
    } -ArgumentList @($sentinel, $content)
    if ($round.Trim() -ne 'SENTINEL_OK') {
        Exit-Qualification 'workspace-fenced' 'The workspace sentinel lifecycle failed inside the guest.'
    }
    $script:Checks.Add('workspace-fenced')
}

function Assert-Cleanup {
    Write-Host 'Gate 7/7: cleanup-confirmed'
    try {
        $vm = Get-VM -ErrorAction Stop | Where-Object Name -EQ $script:VmName
        if ($null -ne $vm) {
            if ($vm.State -ne 'Off') { $vm | Stop-VM -TurnOff -Force -Confirm:$false -ErrorAction Stop }
            $vm | Remove-VM -Force -Confirm:$false -ErrorAction Stop
        }
    } catch { Exit-Qualification 'cleanup-confirmed' "VM teardown failed: $($_.Exception.Message)" }
    foreach ($left in Get-VM -ErrorAction Stop | Where-Object { $_.Name -eq $script:VmName }) {
        Exit-Qualification 'cleanup-confirmed' "A leftover qualification VM remained: $($left.Name)"
    }
    if (Test-Path -LiteralPath $script:DiskPath) {
        try { Remove-Item -LiteralPath $script:DiskPath -Force -ErrorAction Stop } catch {
            Exit-Qualification 'cleanup-confirmed' "The differencing disk could not be removed: $($_.Exception.Message)"
        }
    }
    if (Test-Path -LiteralPath $script:DiskPath) { Exit-Qualification 'cleanup-confirmed' 'The differencing disk removal was not confirmed.' }
    # Only this invocation's randomly named directory, never a shared tmp tree.
    if (Test-Path -LiteralPath $script:StateRoot) { Remove-Item -LiteralPath $script:StateRoot -Force -Recurse -ErrorAction Stop }
    if (Test-Path -LiteralPath $script:StateRoot) { Exit-Qualification 'cleanup-confirmed' 'The private state directory remained.' }
    $script:Checks.Add('cleanup-confirmed')
}

function Save-GuestCredentialToVault {
    if (-not $SaveGuestCredential) { return }
    if ($null -eq $GuestCredential) {
        Exit-Qualification 'guest-credential' '-SaveGuestCredential was requested without -GuestCredential.'
    }
    if ([string]::IsNullOrWhiteSpace($GuestCredential.UserName)) {
        Exit-Qualification 'guest-credential' 'The guest credential user name is empty.'
    }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FilspressoCredWrite {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }
    [DllImport("advapi32.dll", SetLastError = true, EntryPoint = "CredWriteW", CharSet = CharSet.Unicode)]
    private static extern bool CredWriteW(ref CREDENTIAL credential, uint flags);
    public static void Write(string target, string user, string secret) {
        var blob = IntPtr.Zero;
        try {
            if (!string.IsNullOrEmpty(secret)) {
                blob = Marshal.StringToHGlobalUni(secret);
            }
            var row = new CREDENTIAL {
                Flags = 0,
                Type = 1,
                TargetName = target,
                Comment = "Filspresso Playground dedicated Hyper-V guest credential",
                CredentialBlobSize = (uint)(secret.Length * 2),
                CredentialBlob = blob,
                Persist = 2,
                AttributeCount = 0,
                Attributes = IntPtr.Zero,
                TargetAlias = null,
                UserName = user,
            };
            if (!CredWriteW(ref row, 0)) {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "CredWriteW failed.");
            }
        } finally {
            if (blob != IntPtr.Zero) { Marshal.ZeroFreeGlobalAllocUnicode(blob); }
        }
    }
}
'@
    $plain = [System.Net.NetworkCredential]::new($GuestCredential.UserName, $GuestCredential.Password).Password
    [FilspressoCredWrite]::Write($GuestTarget, $GuestCredential.UserName, $plain)
    Write-Host "  wrote guest credential to Credential Manager as $GuestTarget"
}

Assert-HostAdministration
Measure-Image
Assert-ImageUnattached
try {
    New-QualificationSession
    Wait-GuestReady
    Assert-WorkspaceFencing
} finally {
    if ($null -ne (Get-Variable -Name VmName -Scope Script -ErrorAction SilentlyContinue)) { Assert-Cleanup }
}
Save-GuestCredentialToVault

$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [Globalization.CultureInfo]::InvariantCulture)
$receipt = [ordered]@{
    version       = 1
    policyVersion = 2
    imagePath     = (Get-Item -LiteralPath $ImagePath).FullName
    imageSha256   = $script:ImageSha256
    imageBytes    = $script:ImageBytes
    createdUtc    = $stamp
    machineId     = Get-CanonicalMachineId
    checks        = @($script:Checks)
}
$directory = [IO.Path]::Combine([Environment]::GetFolderPath('LocalApplicationData'), 'Filspresso', 'Playground', 'qualification')
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$path = Join-Path $directory 'hyper-v.json'
$json = $receipt | ConvertTo-Json -Depth 3
# This is local environment-smoke evidence, NOT a release attestation or consent.
[IO.File]::WriteAllText($path, $json, [Text.UTF8Encoding]::new($false))
Write-Host ''
Write-Host "All seven gates passed. Receipt written: $path"
Write-Warning 'Desktop execution remains release-blocked. These checks do not qualify reparse races, descendants/job controls or durable crash recovery.'
if (-not $SaveGuestCredential) {
    Write-Host 'Remember to provision the guest credential, e.g.:'
    Write-Host ('  .\Qualify-HyperVExecution.ps1 -ImagePath <path> -GuestCredential (Get-Credential) -SaveGuestCredential')
}
exit 0
