param(
    [string]$RepoRoot = "",
    [string]$ComposeEnvFile = "security.env.example",
    [switch]$SkipDocker,
    [switch]$SkipSignedHistory,
    [switch]$FailFast,
    [string]$ServiceEventsKey = "",
    [string]$ServiceAssertionToken = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$results = New-Object System.Collections.Generic.List[object]

function Add-Result {
    param(
        [string]$Name,
        [string]$Status,
        [string]$Details
    )

    $results.Add([pscustomobject]@{
        Name = $Name
        Status = $Status
        Details = $Details
    })
}

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Action,
        [switch]$Optional
    )

    try {
        & $Action
        Add-Result -Name $Name -Status "PASS" -Details "ok"
        Write-Host "[PASS] $Name" -ForegroundColor Green
    }
    catch {
        if ($Optional) {
            Add-Result -Name $Name -Status "SKIP" -Details ($_.Exception.Message)
            Write-Host "[SKIP] $Name - $($_.Exception.Message)" -ForegroundColor Yellow
            return
        }

        Add-Result -Name $Name -Status "FAIL" -Details ($_.Exception.Message)
        Write-Host "[FAIL] $Name - $($_.Exception.Message)" -ForegroundColor Red
        if ($FailFast) {
            throw
        }
    }
}

function Invoke-Cmd {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
        }
    }
    finally {
        Pop-Location
    }
}

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Uri,
        [hashtable]$Headers = @{},
        [string]$Method = "GET",
        [object]$Body = $null,
        [int]$ExpectedStatus = 200
    )

    $invokeParams = @{
        Uri = $Uri
        Method = $Method
        Headers = $Headers
        TimeoutSec = 15
    }
    if ($null -ne $Body) {
        $invokeParams["Body"] = $Body
        $invokeParams["ContentType"] = "application/json"
    }
    if ((Get-Command Invoke-WebRequest).Parameters.ContainsKey("UseBasicParsing")) {
        $invokeParams["UseBasicParsing"] = $true
    }

    try {
        $response = Invoke-WebRequest @invokeParams
        if ([int]$response.StatusCode -ne $ExpectedStatus) {
            throw "Expected status $ExpectedStatus but got $($response.StatusCode)"
        }
    }
    catch {
        $exception = $_.Exception
        $hasResponse = $null -ne $exception -and $exception.PSObject.Properties.Match("Response").Count -gt 0 -and $null -ne $exception.Response
        if ($hasResponse) {
            $responseStatus = $exception.Response.StatusCode
            if ($null -ne $responseStatus) {
                $statusCode = [int]$responseStatus
                if ($statusCode -eq $ExpectedStatus) {
                    return
                }
                throw "Expected status $ExpectedStatus but got $statusCode"
            }
        }
        throw
    }
}

function Test-SecuritySecretsLayout {
    param(
        [string]$RepoRootPath
    )

    $requiredFiles = @(
        "db_password.txt",
        "backend_db_password.txt",
        "ai_db_password.txt",
        "jwt_secret.txt",
        "jwt_signing_private_key.pem",
        "jwt_signing_public_key.pem",
        "encryption_key.txt",
        "service_events_api_key.txt",
        "service_assertion_public_key.pem",
        "service_assertion_private_key.pem",
        "go_ops_api_key.txt",
        "redis_password.txt",
        "go_ops_client_cert.pem",
        "go_ops_client_key.pem",
        "go_ops_server_cert.pem",
        "go_ops_server_key.pem",
        "filspresso_ca_cert.pem",
        "vault_kek.txt"
    )

    $issues = New-Object System.Collections.Generic.List[string]
    foreach ($fileName in $requiredFiles) {
        $path = Join-Path $RepoRootPath "secrets/$fileName"
        if (-not (Test-Path $path)) {
            $issues.Add("missing file: secrets/$fileName")
            continue
        }

        if (Test-Path $path -PathType Container) {
            $issues.Add("expected file but found directory: secrets/$fileName")
            continue
        }

        $value = (Get-Content -Path $path -Raw).Trim()
        if (-not $value) {
            $issues.Add("empty file: secrets/$fileName")
        }
    }

    if ($issues.Count -gt 0) {
        $details = $issues -join "; "
        throw "Invalid secrets layout for security compose: $details. Run 'npm run security:bootstrap-secrets -- --force' after populating .env, or replace broken directories with secret files."
    }
}

function Resolve-ServiceEventsKey {
    param(
        [string]$Explicit,
        [string]$RepoRootPath
    )

    if ($Explicit) {
        return $Explicit
    }

    $secretFile = Join-Path $RepoRootPath "secrets/service_events_api_key.txt"
    if (Test-Path $secretFile) {
        $value = (Get-Content -Path $secretFile -Raw).Trim()
        if ($value) {
            return $value
        }
    }

    if ($env:SERVICE_EVENTS_API_KEY) {
        return [string]$env:SERVICE_EVENTS_API_KEY
    }

    return ""
}

function Get-BackendRuntimeEnvValue {
    param(
        [string]$RepoRootPath,
        [string]$Name
    )

    if (-not $Name) {
        return ""
    }

    Push-Location $RepoRootPath
    try {
        $snippet = "process.stdout.write(String(process.env['$Name'] || '').trim())"
        $value = docker compose exec -T backend node -e $snippet 2>$null
        if ($LASTEXITCODE -eq 0 -and $value) {
            return [string]$value
        }
    }
    catch {
        # fall back to local defaults if the backend container is unavailable
    }
    finally {
        Pop-Location
    }

    return ""
}

Write-Host "Running Titan V0.74 verification suite from: $RepoRoot" -ForegroundColor Cyan

Invoke-Step -Name "Node available" -Action {
    Invoke-Cmd -FilePath "node" -Arguments @("--version") -WorkingDirectory $RepoRoot
}

Invoke-Step -Name "npm available" -Action {
    Invoke-Cmd -FilePath "npm" -Arguments @("--version") -WorkingDirectory $RepoRoot
}

$verifyScripts = Get-ChildItem -Path (Join-Path $RepoRoot "scripts") -Filter "verify*.mjs" | Sort-Object Name
foreach ($script in $verifyScripts) {
    if ($SkipSignedHistory -and $script.Name -eq "verifySignedHistory.mjs") {
        Add-Result -Name "scripts/$($script.Name)" -Status "SKIP" -Details "Skipped by -SkipSignedHistory"
        Write-Host "[SKIP] scripts/$($script.Name) - skipped by flag" -ForegroundColor Yellow
        continue
    }

    Invoke-Step -Name "scripts/$($script.Name)" -Action {
        Invoke-Cmd -FilePath "node" -Arguments @("scripts/$($script.Name)") -WorkingDirectory $RepoRoot
    }
}

Invoke-Step -Name "Express internal assertion matrix" -Action {
    Invoke-Cmd -FilePath "npm" -Arguments @("run", "test:internal-assertion-matrix") -WorkingDirectory (Join-Path $RepoRoot "express-api")
}

Invoke-Step -Name "Syntax check express-api/server.js" -Action {
    Invoke-Cmd -FilePath "node" -Arguments @("--check", "server.js") -WorkingDirectory (Join-Path $RepoRoot "express-api")
}

if (-not $SkipDocker) {
    Invoke-Step -Name "Docker available" -Action {
        Invoke-Cmd -FilePath "docker" -Arguments @("--version") -WorkingDirectory $RepoRoot
    }

    Invoke-Step -Name "Security secrets file sanity" -Action {
        Test-SecuritySecretsLayout -RepoRootPath $RepoRoot
    }

    Invoke-Step -Name "Compose render validation" -Action {
        Push-Location $RepoRoot
        try {
            $null = docker compose --env-file $ComposeEnvFile -f docker-compose.yml -f docker-compose.security.yml config
            if ($LASTEXITCODE -ne 0) {
                throw "docker compose config failed with exit code ${LASTEXITCODE}"
            }
        }
        finally {
            Pop-Location
        }
    }

    Invoke-Step -Name "Compose services running" -Action {
        $json = docker compose ps --format json
        if (-not $json) {
            throw "No compose services detected"
        }

        $services = $json | ConvertFrom-Json
        if ($services -isnot [System.Array]) {
            $services = @($services)
        }

        $unhealthy = @($services | Where-Object {
            $status = [string]$_.State
            $health = [string]$_.Health
            $status -ne "running" -or ($health -and $health -ne "healthy")
        })

        if ($unhealthy.Count -gt 0) {
            $details = $unhealthy | ForEach-Object { "$($_.Service): state=$($_.State), health=$($_.Health)" }
            throw ("Unhealthy services: " + ($details -join "; "))
        }
    }

    Invoke-Step -Name "Backend health endpoint" -Action {
        Test-Endpoint -Name "backend-health" -Uri "http://localhost:4000/health" -ExpectedStatus 200
    }

    Invoke-Step -Name "Backend service health endpoint" -Action {
        Test-Endpoint -Name "backend-services-health" -Uri "http://localhost:4000/health/services" -ExpectedStatus 200
    }

    $key = Resolve-ServiceEventsKey -Explicit $ServiceEventsKey -RepoRootPath $RepoRoot
    $strictServiceAssertion = $false
    $strictRaw = (Get-BackendRuntimeEnvValue -RepoRootPath $RepoRoot -Name "INTERNAL_SERVICE_ASSERTION_STRICT").Trim().ToLower()
    if (-not $strictRaw) {
        # Backend defaults this flag to true when unset.
        $strictRaw = "true"
    }
    if ($strictRaw -eq "true") {
        $strictServiceAssertion = $true
    }

    $serviceHeaders = @{}
    $expectedSecurityStatus = 200

    if ($strictServiceAssertion) {
        if ($ServiceAssertionToken) {
            $serviceHeaders = @{ "x-service-assertion" = $ServiceAssertionToken; "x-service-name" = "service-events-client" }
            $expectedSecurityStatus = 200
        }
        else {
            if ($key) {
                $serviceHeaders = @{ "x-service-events-key" = $key }
            }
            $expectedSecurityStatus = 401
        }
    }
    else {
        if ($key) {
            $serviceHeaders = @{ "x-service-events-key" = $key }
            $expectedSecurityStatus = 200
        }
        else {
            Add-Result -Name "Security observability endpoints" -Status "SKIP" -Details "No ServiceEventsKey provided"
            Write-Host "[SKIP] Security observability endpoints - provide -ServiceEventsKey or SERVICE_EVENTS_API_KEY env var" -ForegroundColor Yellow
        }
    }

    if ($serviceHeaders.Count -gt 0 -or $strictServiceAssertion) {
        Invoke-Step -Name "Security observability endpoint" -Action {
            Test-Endpoint -Name "security-observability" -Uri "http://localhost:4000/health/security/observability" -Headers $serviceHeaders -ExpectedStatus $expectedSecurityStatus
        }

        Invoke-Step -Name "Security alerts endpoint" -Action {
            Test-Endpoint -Name "security-alerts" -Uri "http://localhost:4000/health/security/alerts" -Headers $serviceHeaders -ExpectedStatus $expectedSecurityStatus
        }

        Invoke-Step -Name "Security alert dispatch endpoint" -Action {
            Test-Endpoint -Name "security-alert-dispatch" -Uri "http://localhost:4000/health/security/alerts/dispatch" -Method "POST" -Headers $serviceHeaders -Body '{"force":"true"}' -ExpectedStatus $expectedSecurityStatus
        }
    }

    Invoke-Step -Name "CSRF enforcement check" -Action {
        $statusCode = curl.exe -sS -o NUL -w "%{http_code}" -X POST "http://localhost:4000/api/auth/login" -H "Content-Type: application/json" -H "Cookie: sid=test" --data "{}"
        if ([string]$statusCode -ne "403") {
            throw "Expected status 403 but got $statusCode"
        }
    }
}

$failed = @($results | Where-Object { $_.Status -eq "FAIL" })
$skipped = @($results | Where-Object { $_.Status -eq "SKIP" })
$passed = @($results | Where-Object { $_.Status -eq "PASS" })

Write-Host ""
Write-Host "Titan V0.74 verification summary" -ForegroundColor Cyan
Write-Host "Passed: $($passed.Count)" -ForegroundColor Green
Write-Host "Skipped: $($skipped.Count)" -ForegroundColor Yellow
Write-Host "Failed: $($failed.Count)" -ForegroundColor Red

if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "Failed checks:" -ForegroundColor Red
    foreach ($item in $failed) {
        Write-Host "- $($item.Name): $($item.Details)" -ForegroundColor Red
    }
    exit 1
}

exit 0