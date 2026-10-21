param(
    [string]$ProductVersion = '0.2.0',
    [switch]$SkipTests
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath "$root\src\Filspresso.App")) { throw 'Run this script from the desktop source tree.' }
$artifacts = Join-Path $root 'artifacts'
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $install) { throw 'Visual Studio MSBuild and the x64 C++ build tools are required.' }
$msbuild = Join-Path $install 'MSBuild\Current\Bin\MSBuild.exe'

function Invoke-Checked([scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "Build command failed with exit code $LASTEXITCODE." }
}

if (-not $SkipTests) {
    Invoke-Checked { dotnet test "$root\Filspresso.Desktop.sln" -c Release -p:PlatformTarget=x64 --nologo }
    Invoke-Checked { & $msbuild "$root\installer\native\Filspresso.Maintenance.Tests.vcxproj" -p:Configuration=Release -p:Platform=x64 -nologo -v:minimal }
    Invoke-Checked { & "$artifacts\maintenance-tests\MaintenanceTests.exe" }
}
Invoke-Checked { & $msbuild "$root\installer\native\Filspresso.Maintenance.vcxproj" -p:Configuration=Release -p:Platform=x64 -nologo -v:minimal }

$publish = Join-Path $artifacts 'publish-next'
Invoke-Checked { & $msbuild "$root\src\Filspresso.App\Filspresso.App.csproj" -restore -t:Publish -p:Configuration=Release -p:Platform=x64 "-p:PublishDir=$publish\" -nologo -v:minimal }
foreach ($file in @('Filspresso.Playground.pri', 'App.xbf', 'MainWindow.xbf', 'PlaygroundPage.xbf', 'SettingsPage.xbf')) {
    if (-not (Test-Path -LiteralPath (Join-Path $publish $file))) { throw "Missing WinUI runtime resource: $file" }
}

$branding = Join-Path $artifacts 'branding'
New-Item -ItemType Directory -Path $branding -Force | Out-Null
Add-Type -AssemblyName System.Drawing
$copper = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#BD8D65'))
$cream = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#F2E5DC'))
$dark = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#141213'))
$logo = [System.Drawing.Font]::new('Georgia', 11, [System.Drawing.FontStyle]::Italic)
$body = [System.Drawing.Font]::new('Segoe UI', 10)
try {
    $banner = [System.Drawing.Bitmap]::new(493, 58)
    $graphics = [System.Drawing.Graphics]::FromImage($banner)
    try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $graphics.DrawString('FILSPRESSO', $logo, $copper, 365, 18)
        $banner.Save((Join-Path $branding 'banner.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally { $graphics.Dispose(); $banner.Dispose() }
    $dialog = [System.Drawing.Bitmap]::new(493, 312)
    $graphics = [System.Drawing.Graphics]::FromImage($dialog)
    try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.FillRectangle($dark, 0, 0, 164, 312)
        $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $graphics.DrawString('FILSPRESSO', $logo, $copper, 19, 42)
        $graphics.DrawString("Spectre`nPlayground", $body, $cream, 21, 92)
        $graphics.DrawString("Your prompt.`nYour model.`nRoom to think.", $body, $copper, 21, 205)
        $dialog.Save((Join-Path $branding 'dialog.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally { $graphics.Dispose(); $dialog.Dispose() }
} finally { $logo.Dispose(); $body.Dispose(); $dark.Dispose(); $cream.Dispose(); $copper.Dispose() }

$nextMsi = Join-Path $artifacts 'Filspresso.Playground.next.msi'
Invoke-Checked { wix build "$root\installer\Filspresso.Installer.wxs" -arch x64 `
    -d "AppPublishDir=$publish" -d "ProductVersion=$ProductVersion" `
    -d "MaintenanceDir=$artifacts\maintenance" -d "InstallerSourceDir=$root\installer" -d "BrandingDir=$branding" `
    -loc "$root\installer\Filspresso.en-us.wxl" -ext WixToolset.UI.wixext -ext WixToolset.Util.wixext -o $nextMsi }
if ((Get-Item -LiteralPath $nextMsi).Length -lt 1MB) { throw 'The installer is missing its application payload.' }
# Publish only after compilation and packaging succeed, so the web download never points at a partial MSI.
Move-Item -LiteralPath $nextMsi -Destination (Join-Path $artifacts 'Filspresso.Playground.msi') -Force
Write-Output "Built $(Join-Path $artifacts 'Filspresso.Playground.msi') ($ProductVersion)."
