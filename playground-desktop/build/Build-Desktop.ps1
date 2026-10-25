param(
    [string]$ProductVersion = '0.3.0',
    [switch]$SkipTests,
    [string]$PackageDirectory
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath "$root\src\Filspresso.App")) { throw 'Run this script from the desktop source tree.' }
$artifacts = Join-Path $root 'artifacts'
$packageRoot = if ([string]::IsNullOrWhiteSpace($PackageDirectory)) { $artifacts } else { [IO.Path]::GetFullPath($PackageDirectory) }
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $install) { throw 'Visual Studio MSBuild and the x64 C++ build tools are required.' }
$msbuild = Join-Path $install 'MSBuild\Current\Bin\MSBuild.exe'

function Invoke-Checked([scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "Build command failed with exit code $LASTEXITCODE." }
}

Invoke-Checked { node "$PSScriptRoot\Generate-Icons.cjs" }

if (-not $SkipTests) {
    Invoke-Checked { dotnet test "$root\Filspresso.Desktop.sln" -c Release -p:PlatformTarget=x64 --nologo }
    Invoke-Checked { & $msbuild "$root\installer\native\Filspresso.Maintenance.Tests.vcxproj" -p:Configuration=Release -p:Platform=x64 -nologo -v:minimal }
    Invoke-Checked { & "$artifacts\maintenance-tests\MaintenanceTests.exe" }
}
Invoke-Checked { & $msbuild "$root\installer\native\Filspresso.Maintenance.vcxproj" -p:Configuration=Release -p:Platform=x64 -nologo -v:minimal }

$publish = Join-Path $packageRoot 'publish-next'
Invoke-Checked { & $msbuild "$root\src\Filspresso.App\Filspresso.App.csproj" -restore -t:Publish -p:Configuration=Release -p:Platform=x64 "-p:PublishDir=$publish\" -nologo -v:minimal }
foreach ($file in @('Filspresso.Playground.pri', 'App.xbf', 'MainWindow.xbf', 'PlaygroundPage.xbf', 'RunHistoryPage.xbf', 'AgentReviewPage.xbf', 'AgentWorkspacePage.xbf', 'SettingsPage.xbf', 'Assets\Filspresso.ico', 'Assets\Icons\settings.svg', 'Assets\Icons\github.svg')) {
    if (-not (Test-Path -LiteralPath (Join-Path $publish $file))) { throw "Missing WinUI runtime resource: $file" }
}

$branding = Join-Path $packageRoot 'branding'
New-Item -ItemType Directory -Path $branding -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $publish 'Assets\Filspresso.ico') -Destination (Join-Path $branding 'Filspresso.ico') -Force
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

$nextMsi = Join-Path $packageRoot 'Filspresso.Playground.next.msi'
Invoke-Checked { wix build "$root\installer\Filspresso.Installer.wxs" -arch x64 `
    -d "AppPublishDir=$publish" -d "ProductVersion=$ProductVersion" `
    -d "MaintenanceDir=$artifacts\maintenance" -d "InstallerSourceDir=$root\installer" -d "BrandingDir=$branding" `
    -loc "$root\installer\Filspresso.en-us.wxl" -ext WixToolset.UI.wixext -ext WixToolset.Util.wixext -o $nextMsi }
if ((Get-Item -LiteralPath $nextMsi).Length -lt 1MB) { throw 'The installer is missing its application payload.' }
# Publish only after compilation and packaging succeed, so the web download never points at a partial MSI.
$msi = Join-Path $packageRoot 'Filspresso.Playground.msi'
Move-Item -LiteralPath $nextMsi -Destination $msi -Force
$manifest = [ordered]@{
    version = 1; productVersion = $ProductVersion; file = 'Filspresso.Playground.msi'
    bytes = (Get-Item -LiteralPath $msi).Length
    sha256 = (Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash.ToLowerInvariant()
    signature = [string](Get-AuthenticodeSignature -LiteralPath $msi).Status
    installQualified = $false
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $packageRoot 'package-manifest.json') -Encoding utf8
Write-Output "Built $msi ($ProductVersion). Unsigned package build only; install/upgrade/uninstall are not qualified."
