param(
    # Where the desktop build left its outputs: an MSI, package-manifest.json, the
    # publish-next payload and the qualification probes. The sandbox build used by the
    # agent writes it under %LOCALAPPDATA%\Temp\opencode\ by default.
    [string]$SourceDirectory,
    # The repository root that owns the desktop-installers/ directory.
    [string]$RepositoryRoot
)
$ErrorActionPreference = 'Stop'

# Default to the artifacts the build script produced in this tree; callers that promote a
# sandbox-built package point -SourceDirectory at that sandbox's output folder.
if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $RepositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}
if ([string]::IsNullOrWhiteSpace($SourceDirectory)) {
    $SourceDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts'
}

$source = [IO.Path]::GetFullPath($SourceDirectory)
$desktop = Join-Path $RepositoryRoot 'desktop-installers'
$manifestPath = Join-Path $source 'package-manifest.json'
$msiSource = Join-Path $source 'Filspresso.Playground.msi'

foreach ($required in @($manifestPath, $msiSource)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Missing required build output: $required" }
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$productVersion = [string]$manifest.productVersion
if ($productVersion -notmatch '^[0-9]+(\.[0-9]+){1,3}$') { throw "package-manifest.json does not name a valid productVersion." }

$targetVersionDir = Join-Path $desktop $productVersion
New-Item -ItemType Directory -Path $targetVersionDir -Force | Out-Null

$msiTarget = Join-Path $targetVersionDir 'Filspresso.Playground.msi'
Copy-Item -LiteralPath $msiSource -Destination $msiTarget -Force

# The copy is verified against what it claims, not trusted out of transit. A mismatch here
# stops the promotion: the backend would otherwise refuse this publication at serve time
# and the failure would be found at download time instead of now.
$copiedHash = (Get-FileHash -LiteralPath $msiTarget -Algorithm SHA256).Hash.ToLowerInvariant()
if ($manifest.sha256 -and $copiedHash -ne ([string]$manifest.sha256).ToLowerInvariant()) {
    throw "The copied MSI does not match the manifest sha256. Promotion refused."
}
$copiedBytes = (Get-Item -LiteralPath $msiTarget).Length
if ($manifest.bytes -and $copiedBytes -ne [long]$manifest.bytes) {
    throw "The copied MSI does not match the manifest byte count. Promotion refused."
}

$publishedManifest = [ordered]@{
    version = 1
    productVersion = $productVersion
    file = 'Filspresso.Playground.msi'
    bytes = $copiedBytes
    sha256 = $copiedHash
    signature = [string]$manifest.signature
    installQualified = [bool]$manifest.installQualified
    publishedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$publishedManifestJson = $publishedManifest | ConvertTo-Json
[IO.File]::WriteAllText(
    (Join-Path $targetVersionDir 'package-manifest.json'),
    $publishedManifestJson + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false)
)

# index.json lists the versions in the tree, newest last. It is a committed artifact, so a
# checkout without the gitignored binary files still tells the reviewer what was published.
$indexPath = Join-Path $desktop 'index.json'
$versions = @()
if (Test-Path -LiteralPath $indexPath) {
    $existing = Get-Content -LiteralPath $indexPath -Raw | ConvertFrom-Json
    $versions = @($existing.versions | ForEach-Object { $_.productVersion })
}
if ($versions -notcontains $productVersion) { $versions += $productVersion }
$list = @()
foreach ($entry in ($versions | Select-Object -Unique)) {
    $entryManifest = Join-Path (Join-Path $desktop $entry) 'package-manifest.json'
    if (-not (Test-Path -LiteralPath $entryManifest)) { continue }
    $recorded = Get-Content -LiteralPath $entryManifest -Raw | ConvertFrom-Json
    $list += [ordered]@{
        productVersion = [string]$recorded.productVersion
        bytes = [long]$recorded.bytes
        sha256 = [string]$recorded.sha256
        signature = [string]$recorded.signature
        installQualified = [bool]$recorded.installQualified
    }
}
$index = [ordered]@{ version = 1; latest = ($list | Select-Object -Last 1).productVersion; versions = $list }
$indexJson = $index | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($indexPath, $indexJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

Write-Output "Published $productVersion to $msiTarget (sha256 $copiedHash). index.json updated."
