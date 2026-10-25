#Requires -Version 5.1
<# Read-only diagnostics. Does not read secrets, boot a VM, enable features or install MSI. #>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$service = Get-Service vmms -ErrorAction SilentlyContinue
$security = @()
if (Get-Command docker -ErrorAction SilentlyContinue) {
    try { $security = @((& docker info --format '{{json .SecurityOptions}}' 2>$null) | ConvertFrom-Json) } catch { }
}
[ordered]@{
    version = 1
    observedUtc = [DateTime]::UtcNow.ToString('o')
    os = $os.Caption
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
    desktopExecutionReleaseReady = $false
    qualification = 'NOT QUALIFIED: diagnostics are not boot/containment/model/production/MSI evidence'
} | ConvertTo-Json -Depth 3
