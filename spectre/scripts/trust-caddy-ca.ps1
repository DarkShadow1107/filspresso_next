[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $projectRoot "docker-compose.yml"
$certificatePath = Join-Path ([System.IO.Path]::GetTempPath()) "sentinelforge-caddy-root.crt"

function Get-CaddyContainerId {
    $containerId = & docker compose -f $composeFile ps -q caddy
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to query the Caddy container."
    }
    return $containerId.Trim()
}

$containerId = Get-CaddyContainerId
if (-not $containerId) {
    & docker compose -f $composeFile up -d caddy
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to start Caddy."
    }
}

for ($attempt = 1; $attempt -le 15; $attempt++) {
    $containerId = Get-CaddyContainerId
    if ($containerId) {
        & docker cp "${containerId}:/data/caddy/pki/authorities/local/root.crt" $certificatePath
        if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $certificatePath)) {
            break
        }
    }
    Start-Sleep -Seconds 1
}

if (-not (Test-Path -LiteralPath $certificatePath)) {
    throw "Caddy's local CA was not created within 15 seconds."
}

try {
    $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificatePath)
    $existing = Get-ChildItem -Path Cert:\CurrentUser\Root |
        Where-Object Thumbprint -eq $certificate.Thumbprint
    if ($existing) {
        "Caddy local CA is already trusted for the current Windows user."
    } else {
        & certutil.exe -user -f -addstore Root $certificatePath | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to add Caddy's local CA to the Current User trust store."
        }
        "Caddy local CA is now trusted for the current Windows user."
    }
} finally {
    Remove-Item -LiteralPath $certificatePath -Force -ErrorAction SilentlyContinue
}
