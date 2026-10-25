#Requires -Version 5.1
<# Read-only diagnostics. Does not read secrets, boot a VM, enable features or install MSI. #>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$version = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$service = Get-Service vmms -ErrorAction SilentlyContinue
$security = @()
if (Get-Command docker -ErrorAction SilentlyContinue) {
    try { $security = @((& docker info --format '{{json .SecurityOptions}}' 2>$null) | ConvertFrom-Json) } catch { }
}

# The desktop app's publication, as the backend would serve it. The repo root is two
# levels above this script's directory; desktop-installers/<version>/ mirrors exactly
# what DESKTOP_INSTALLER_DIR is expected to hold, so this answers "would the download
# work from this checkout" without touching the backend. Verification here is the same
# hash check the backend performs before streaming; a mismatch is the finding, and no
# file is modified.
$installerPublished = $false
$installerLatestVersion = $null
$installerLatestShaMatches = $null
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$installersRoot = Join-Path $repoRoot 'desktop-installers'
$index = Join-Path $installersRoot 'index.json'
$versions = @()
if (Test-Path -LiteralPath $index) {
    try { $versions = @((Get-Content -LiteralPath $index -Raw | ConvertFrom-Json).versions) } catch { $versions = @() }
}
$latest = $versions | Select-Object -Last 1
if ($null -eq $latest) {
    # No committed index: scan the versioned manifest directories instead.
    $manifests = @(Get-ChildItem -Path $installersRoot -Filter 'package-manifest.json' -Recurse -ErrorAction SilentlyContinue |
        ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json })
    $latest = $manifests | Sort-Object productVersion | Select-Object -Last 1
}
if ($null -ne $latest) {
    $installerPublished = $true
    $installerLatestVersion = [string]$latest.productVersion
    $packageDir = Join-Path $installersRoot $installerLatestVersion
    $packageFile = Join-Path $packageDir 'Filspresso.Playground.msi'
    if (Test-Path -LiteralPath $packageFile) {
        $actual = (Get-FileHash -LiteralPath $packageFile -Algorithm SHA256).Hash.ToLowerInvariant()
        $installerLatestShaMatches = $actual -eq ([string]$latest.sha256).ToLowerInvariant()
    }
}

[ordered]@{
    version = 1
    observedUtc = [DateTime]::UtcNow.ToString('o')
    os = $os.Caption
    windowsBuild = "$($version.CurrentBuild).$($version.UBR)"
    windowsSandboxCli = Test-Path (Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\wsb.exe')
    windowsSandboxPackages = @(Get-AppxPackage '*WindowsSandbox*' | Select-Object -ExpandProperty PackageFullName)
    ramGiB = [Math]::Round($computer.TotalPhysicalMemory / 1GB, 1)
    hypervisorPresent = [bool]$computer.HypervisorPresent
    # These CPU flags can read false after the hypervisor takes ownership of VT-x/SLAT.
    cpuFlagsConclusive = -not [bool]$computer.HypervisorPresent
    virtualizationFirmwareFlag = [bool]$cpu.VirtualizationFirmwareEnabled
    slatFlag = [bool]$cpu.SecondLevelAddressTranslationExtensions
    elevated = $admin
    hyperVModule = [bool](Get-Module -ListAvailable Hyper-V)
    vmManagementService = if ($null -eq $service) { 'Absent' } else { [string]$service.Status }
    dockerReachable = $security.Count -gt 0
    dockerRootless = @($security | Where-Object { $_ -eq 'name=rootless' }).Count -gt 0
    receiptPresent = Test-Path (Join-Path $env:LOCALAPPDATA 'Filspresso\Playground\qualification\windows-sandbox.bin')
    legacyHyperVReceiptPresent = Test-Path (Join-Path $env:LOCALAPPDATA 'Filspresso\Playground\qualification\hyper-v.json')
    nativeRestrictedReceiptPresent = Test-Path (Join-Path $env:LOCALAPPDATA 'Filspresso\Playground\qualification\native-restricted.bin')
    # The installer publication the backend would serve from this checkout. A published
    # SHA mismatch means the download would refuse at serve time (INSTALLER_INTEGRITY).
    installerPublished = $installerPublished
    installerLatestVersion = $installerLatestVersion
    installerLatestSha256Matches = $installerLatestShaMatches
    # null means the VM receipt exists but only the app's own validation can confirm it.
    desktopExecutionReleaseReady = if (-not (Test-Path (Join-Path $env:LOCALAPPDATA 'Filspresso\Playground\qualification\windows-sandbox.bin'))) { $false } else { $null }
    qualification = 'Readiness diagnostics only; the app verifies Windows Sandbox machine/Windows/client/exact-build/freshness evidence, and separately the native restricted receipt. Legacy Hyper-V receipts cannot enable either backend.'
} | ConvertTo-Json -Depth 3
