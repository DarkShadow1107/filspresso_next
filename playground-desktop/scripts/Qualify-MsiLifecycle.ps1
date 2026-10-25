#Requires -RunAsAdministrator
#Requires -Version 5.1
<# Destructive OPERATOR-ONLY install/upgrade/uninstall qualification, never run automatically.
Requires a disposable VM/snapshot, two versioned packages, no existing installation/data and
a new typed approval immediately before each machine-changing operation. Signing deferred. #>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PreviousMsi,
    [Parameter(Mandatory = $true)][string]$CandidateMsi,
    [Parameter(Mandatory = $true)][switch]$DisposableMachineAcknowledged
)
$ErrorActionPreference = 'Stop'
if (-not $DisposableMachineAcknowledged) { throw 'Use an isolated disposable Windows VM/snapshot, not your development machine.' }
$installPath = Join-Path $env:ProgramFiles 'Filspresso Playground'
$dataPath = Join-Path $env:LOCALAPPDATA 'Filspresso\Playground'
if ((Test-Path -LiteralPath $installPath) -or (Test-Path -LiteralPath $dataPath)) { throw 'Existing product/data found. Refusing to modify this machine; use a clean disposable VM.' }
$installer = New-Object -ComObject WindowsInstaller.Installer
function Read-Package([string]$path) {
    $file = Get-Item -LiteralPath $path
    if ($file.Extension -ne '.msi' -or $file.FullName.Contains('"')) { throw 'Choose an MSI file.' }
    $db = $installer.OpenDatabase($file.FullName, 0)
    $codeView = $db.OpenView("SELECT Value FROM Property WHERE Property = 'ProductCode'"); $codeView.Execute(); $code = $codeView.Fetch().StringData(1); $codeView.Close()
    $versionView = $db.OpenView("SELECT Value FROM Property WHERE Property = 'ProductVersion'"); $versionView.Execute(); $version = $versionView.Fetch().StringData(1); $versionView.Close()
    $upgradeView = $db.OpenView("SELECT Value FROM Property WHERE Property = 'UpgradeCode'"); $upgradeView.Execute(); $upgrade = $upgradeView.Fetch().StringData(1); $upgradeView.Close()
    if ($upgrade -ne '{6F2C1A9E-4B7D-4E52-9C31-8D0A5E7B1F44}' -or $code -notmatch '^\{[0-9A-Fa-f-]{36}\}$') { throw 'This is not the expected Filspresso product family.' }
    return @{ path = $file.FullName; code = $code; version = [version]$version; sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$old = Read-Package $PreviousMsi; $next = Read-Package $CandidateMsi
if ($next.version -le $old.version -or $old.code -eq $next.code) { throw 'Upgrade qualification requires a strictly newer candidate with a distinct ProductCode.' }
$logs = Join-Path $env:LOCALAPPDATA ('Temp\opencode\msi-qualification-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $logs | Out-Null
function Invoke-Msi([string]$action, [string]$target, [string]$name) {
    if ((Read-Host "On this disposable machine, approve $name now? Type APPLY") -cne 'APPLY') { throw 'Cancelled. Existing installation state is retained; restore the snapshot or uninstall explicitly.' }
    $log = Join-Path $logs ($name + '.log')
    $process = Start-Process msiexec.exe -ArgumentList ($action + ' "' + $target + '" /qn /norestart /l*v "' + $log + '"') -PassThru
    try {
        if (-not $process.WaitForExit(600000)) { throw "MSI $name exceeded ten minutes. Installer service state is ambiguous; restore the disposable snapshot. Do not retry." }
        if ($process.ExitCode -ne 0) { throw "MSI $name returned $($process.ExitCode). Logs: $log. Restore the snapshot; no automatic retry." }
    } finally { $process.Dispose() }
}
Invoke-Msi '/i' $old.path 'install-previous'
if (-not (Test-Path -LiteralPath (Join-Path $installPath 'Filspresso.Playground.exe'))) { throw 'Install payload missing.' }
Invoke-Msi '/i' $next.path 'upgrade-candidate'
if (-not (Test-Path -LiteralPath (Join-Path $installPath 'Filspresso.Playground.exe'))) { throw 'Upgrade payload missing.' }
Invoke-Msi '/x' $next.code 'uninstall-candidate'
if ((Test-Path -LiteralPath (Join-Path $installPath 'Filspresso.Playground.exe')) -or (Test-Path -LiteralPath $dataPath)) { throw 'Uninstall cleanup was not confirmed.' }
[ordered]@{ version = 1; observedUtc = [DateTime]::UtcNow.ToString('o'); previousSha256 = $old.sha256; candidateSha256 = $next.sha256;
    checks = @('install', 'upgrade', 'uninstall'); interactiveUiQualified = $false; rebootRecoveryQualified = $false;
    limitation = 'Successful exit codes and payload/cleanup checks only; full interactive launch/auth and reboot/failure recovery still need testing.' } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logs 'evidence.json') -Encoding utf8
Write-Host "Lifecycle probes passed: $logs. Restore the disposable snapshot afterwards."
