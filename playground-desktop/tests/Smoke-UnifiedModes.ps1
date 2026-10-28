param([Parameter(Mandatory = $true)][string]$AppPath, [Parameter(Mandatory = $true)][string]$FixtureUrl)
$ErrorActionPreference = 'Stop'
if ($FixtureUrl -notmatch '^http://127\.0\.0\.1:\d+/$') { throw 'Only a loopback fixture is allowed.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
$prefix = "Filspresso.UnifiedSmoke.$([guid]::NewGuid().ToString('N'))"
$saved = @{}; foreach ($key in @('FILSPRESSO_BACKEND_URL','FILSPRESSO_PROFILE_DIR','FILSPRESSO_CREDENTIAL_PREFIX')) { $saved[$key] = [Environment]::GetEnvironmentVariable($key) }
$profile = Join-Path $env:LOCALAPPDATA "Temp\opencode\$prefix"
New-Item -ItemType Directory -Path $profile | Out-Null
$env:FILSPRESSO_BACKEND_URL = $FixtureUrl; $env:FILSPRESSO_PROFILE_DIR = $profile; $env:FILSPRESSO_CREDENTIAL_PREFIX = $prefix
$script:appProcess = $null
function Find([string]$name) {
    $script:appProcess.Refresh()
    if ($script:appProcess.HasExited) { throw "App exited: $($script:appProcess.ExitCode)" }
    if ($script:appProcess.MainWindowHandle -eq 0) { return $null }
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($script:appProcess.MainWindowHandle)
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
    return $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}
function Wait-Element([string]$name) {
    $until = [datetime]::UtcNow.AddSeconds(15)
    do { $element = Find $name; if ($element) { return $element }; Start-Sleep -Milliseconds 100 } while ([datetime]::UtcNow -lt $until)
    $script:appProcess.Refresh()
    if ($script:appProcess.MainWindowHandle -ne 0) {
        $window = [System.Windows.Automation.AutomationElement]::FromHandle($script:appProcess.MainWindowHandle)
        $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { "UI: $($_.Current.AutomationId) | $($_.Current.Name)" } | Select-Object -First 60 | Write-Output
    }
    throw "Missing UI element: $name"
}
function Invoke-Element($element) {
    $pattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { ([System.Windows.Automation.InvokePattern]$pattern).Invoke(); return }
    if ($element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { ([System.Windows.Automation.TogglePattern]$pattern).Toggle(); return }
    if ($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { ([System.Windows.Automation.SelectionItemPattern]$pattern).Select(); return }
    throw "Not an invokable control: $($element.Current.Name) $($element.Current.ControlType.ProgrammaticName)"
}
function Set-Value($element, [string]$value) { ([System.Windows.Automation.ValuePattern]$element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($value) }
function By-Id([string]$id) {
    $until = [datetime]::UtcNow.AddSeconds(15)
    do {
        $script:appProcess.Refresh()
        if ($script:appProcess.HasExited) { throw "App exited before $id : $($script:appProcess.ExitCode)" }
        $window = [System.Windows.Automation.AutomationElement]::FromHandle($script:appProcess.MainWindowHandle)
        $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
        $element = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
        if ($element) { return $element }
        Start-Sleep -Milliseconds 150
    } while ([datetime]::UtcNow -lt $until)
    throw "Missing automation id: $id"
}
try {
    # Restore a fake session from this test's private vault namespace. No real credentials
    # are read. Login-field UIAutomation is unstable on this Windows/WinUI host (also in
    # the prior candidate), so this test is not a qualification of the sign-in controls.
    $session = @{ AccessToken='fixture-access-not-a-real-token'; RefreshToken='fixture-refresh-not-a-real-token'; AccessTokenExpiresAt=[DateTimeOffset]::UtcNow.AddHours(1).ToString('o'); RefreshTokenExpiresAt=[DateTimeOffset]::UtcNow.AddDays(1).ToString('o'); Email='fixture@example.invalid'; DeviceId=[guid]::NewGuid().ToString(); AccountName='fixture' } | ConvertTo-Json -Compress
    cmdkey.exe "/generic:$prefix/session" /user:fixture "/pass:$session" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated fixture credential.' }
    $script:appProcess = Start-Process -FilePath (Resolve-Path $AppPath).Path -PassThru
    $script:appProcess.WaitForInputIdle(15000) | Out-Null
    $until = [datetime]::UtcNow.AddSeconds(20)
    do { $script:appProcess.Refresh(); if ($script:appProcess.MainWindowHandle -ne 0) { break }; Start-Sleep -Milliseconds 150 } while ([datetime]::UtcNow -lt $until)
    # The native HWND precedes WinUI's accessibility tree on cold startup.
    Start-Sleep -Seconds 2
    $message = By-Id 'PromptBox'; Set-Value $message 'Keep this draft across modes'
    foreach ($mode in @('Plan','Build','Chat')) {
        Invoke-Element (Wait-Element 'Playground mode'); Invoke-Element (Wait-Element $mode)
        $same = Wait-Element 'Message'
        if (![System.Windows.Automation.Automation]::Compare($message, $same)) { throw "Composer replaced in $mode" }
        $text = ([System.Windows.Automation.ValuePattern]$same.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).Current.Value
        if ($text -ne 'Keep this draft across modes') { throw "Draft lost in $mode" }
        if (Find 'Back to chat') { throw 'Separate agent page is still reachable from mode selection.' }
    }
    $thinking = Wait-Element 'Thinking mode'
    if ($thinking.Current.HelpText -notlike '*Thinking*') { throw 'Thinking tooltip is missing.' }
    Invoke-Element (Wait-Element 'Playground mode'); Invoke-Element (Wait-Element 'Build')
    Invoke-Element (Wait-Element 'Workspace…')
    Wait-Element 'Workspace setup' | Out-Null
    Invoke-Element (Wait-Element 'Done')
    $script:appProcess.Refresh(); $window = [System.Windows.Automation.AutomationElement]::FromHandle($script:appProcess.MainWindowHandle)
    $bounds = $window.Current.BoundingRectangle
    $bitmap = New-Object System.Drawing.Bitmap([int]$bounds.Width, [int]$bounds.Height); $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try { $graphics.CopyFromScreen([int]$bounds.X, [int]$bounds.Y, 0, 0, $bitmap.Size); $bitmap.Save((Join-Path $env:LOCALAPPDATA 'Temp\opencode\desktop-unified-modes.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
    finally { $graphics.Dispose(); $bitmap.Dispose() }
    'PASS: installed-style payload uses one composer/draft for Chat, Plan and Build, a Thinking tooltip and optional workspace setup. API is a loopback fixture; no execution or MSI install.'
} finally {
    if ($script:appProcess -and !$script:appProcess.HasExited) { $script:appProcess.CloseMainWindow() | Out-Null; if (!$script:appProcess.WaitForExit(5000)) { Stop-Process -Id $script:appProcess.Id } }
    cmdkey.exe "/delete:$prefix/session" | Out-Null; cmdkey.exe "/delete:$prefix/device-id" | Out-Null
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key]) }
}
