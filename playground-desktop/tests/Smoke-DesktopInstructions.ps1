param(
    [Parameter(Mandatory = $true)][string]$AppPath,
    [string]$OutputDirectory = "$env:LOCALAPPDATA\Temp\opencode\filspresso-desktop-instructions"
)
# Run with Windows PowerShell (UIAutomationClient); only a fresh test profile is opened.
# No sign-in, paid inference, download, feature enablement or installer action occurs.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
$prefix = "Filspresso.InstructionsSmoke.$([guid]::NewGuid().ToString('N'))"
$previousProfile = $env:FILSPRESSO_PROFILE_DIR
$previousPrefix = $env:FILSPRESSO_CREDENTIAL_PREFIX
$profile = Join-Path $OutputDirectory ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $profile -Force | Out-Null
$env:FILSPRESSO_PROFILE_DIR = $profile
$env:FILSPRESSO_CREDENTIAL_PREFIX = $prefix
$process = $null
function Find-Named($root, [string]$name) {
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
    return $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}
try {
    $process = Start-Process -FilePath (Resolve-Path -LiteralPath $AppPath).Path -PassThru
    $deadline = [datetime]::UtcNow.AddSeconds(30)
    $window = $null
    do {
        $process.Refresh()
        if ($process.HasExited) { throw "Desktop process exited before showing a window: $($process.ExitCode)" }
        if ($process.MainWindowHandle -ne 0) { $window = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle) }
        if (!$window) { Start-Sleep -Milliseconds 150 }
    } until ($window -or [datetime]::UtcNow -ge $deadline)
    if (!$window) { throw 'Desktop window did not appear.' }
    $button = Find-Named $window 'Open desktop instructions'
    if (!$button) { throw 'Instructions icon is not accessible from the signed-out shell.' }
    ([System.Windows.Automation.InvokePattern]$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    $deadline = [datetime]::UtcNow.AddSeconds(15)
    do {
        $guide = Find-Named $window 'Windows desktop guide'
        if (!$guide) { Start-Sleep -Milliseconds 150 }
    } until ($guide -or [datetime]::UtcNow -ge $deadline)
    if (!$guide) { throw 'Desktop-specific guide did not open.' }
    $facts = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) |
        ForEach-Object { $_.Current.Name }
    if (!($facts | Where-Object { $_ -like '*edition:*build:*' })) { throw 'Actual edition/build facts were not rendered.' }
    $update = Find-Named $window 'Check for updates'
    if (!$update -or $update.Current.IsEnabled) { throw 'Signed-out update check must remain unavailable.' }
    $bounds = $window.Current.BoundingRectangle
    $bitmap = New-Object System.Drawing.Bitmap([int]$bounds.Width, [int]$bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen([int]$bounds.X, [int]$bounds.Y, 0, 0, $bitmap.Size)
        $bitmap.Save((Join-Path $OutputDirectory 'desktop-instructions.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
    Write-Output 'PASS: unpackaged desktop guide opens without sign-in, reads native edition/build and exposes honest update status. No live qualification or MSI lifecycle claim.'
} finally {
    if ($process -and !$process.HasExited) { $process.CloseMainWindow() | Out-Null; if (!$process.WaitForExit(5000)) { Stop-Process -Id $process.Id } }
    cmdkey.exe "/delete:$prefix/device-id" | Out-Null
    $env:FILSPRESSO_PROFILE_DIR = $previousProfile
    $env:FILSPRESSO_CREDENTIAL_PREFIX = $previousPrefix
}
