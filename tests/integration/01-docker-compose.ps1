#!/usr/bin/env pwsh
<#
.SYNOPSIS
Integration tests for Docker Compose and service health checks
#>

param(
    [string]$RepoRoot = "",
    [string]$ComposeEnvFile = "security.env.example",
    [switch]$RepairGoOpsMtls,
    [switch]$FailFast
)

if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

. (Join-Path $PSScriptRoot "..\shared\test-utils.ps1")

$testResults = [System.Collections.Generic.List[object]]::new()

function Add-TestResult {
    param($Result)
    [void]$script:testResults.Add($Result)
}

Invoke-TestGroup "Docker & Container Setup" {
    $result = Invoke-TestStep "Docker available" {
        Invoke-CmdShell -FilePath "docker" -Arguments @("--version") -WorkingDirectory $RepoRoot
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Docker Compose render validation" {
        Push-Location $RepoRoot
        try {
            $null = docker compose --env-file $ComposeEnvFile -f docker-compose.yml -f docker-compose.security.yml config 2>&1
            if ($LASTEXITCODE -ne 0) {
                throw "Docker Compose config validation failed"
            }
        }
        finally {
            Pop-Location
        }
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Compose stack exists (no recreate)" {
        Push-Location $RepoRoot
        try {
            $null = docker compose --env-file $ComposeEnvFile -f docker-compose.yml -f docker-compose.security.yml ps --format json 2>&1
            if ($LASTEXITCODE -ne 0) {
                throw "Compose stack query failed"
            }
        }
        finally {
            Pop-Location
        }
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Start hardened security stack" {
        Push-Location $RepoRoot
        try {
            $null = docker compose --env-file $ComposeEnvFile -f docker-compose.yml -f docker-compose.security.yml up -d 2>&1
            if ($LASTEXITCODE -ne 0) {
                throw "Docker Compose up failed"
            }
        }
        finally {
            Pop-Location
        }
    }
    Add-TestResult $result
}

Invoke-TestGroup "Service Health & Readiness" {
    $result = Invoke-TestStep "Wait for services to become healthy" -Optional {
        Wait-ComposeServices -RepoRootPath $RepoRoot -ComposeEnvFilePath $ComposeEnvFile `
            -TimeoutSeconds 600 -PollSeconds 5 -StableSeconds 45
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Backend health endpoint" -Optional {
        Test-HttpEndpoint -Uri "http://localhost:4000/health" -ExpectedStatus 200
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Backend service dependencies health" -Optional {
        Test-HttpEndpoint -Uri "http://localhost:4000/health/services" -ExpectedStatus 200
    }
    Add-TestResult $result
}

Invoke-TestGroup "Service Restart & Resilience" {
    $result = Invoke-TestStep "Restart services without recreate" -Optional {
        Push-Location $RepoRoot
        try {
            docker compose --env-file $ComposeEnvFile -f docker-compose.yml -f docker-compose.security.yml restart 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                throw "Service restart failed"
            }
        }
        finally {
            Pop-Location
        }
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Services recover after restart" -Optional {
        Wait-ComposeServices -RepoRootPath $RepoRoot -ComposeEnvFilePath $ComposeEnvFile `
            -ServiceNames @("backend", "go_ops", "rust_crypto", "invoice_java", "kotlin_subscriptions") `
            -TimeoutSeconds 420 -PollSeconds 5 -StableSeconds 60
    }
    Add-TestResult $result
}

# Summary
Write-Host ""
Write-Host "=== Integration Test Summary ===" -ForegroundColor Cyan
$passed = @($testResults | Where-Object { $_.Status -eq "PASS" })
$failed = @($testResults | Where-Object { $_.Status -eq "FAIL" })
$skipped = @($testResults | Where-Object { $_.Status -eq "SKIP" })

Write-Host "Passed: $($passed.Count)" -ForegroundColor Green
Write-Host "Failed: $($failed.Count)" -ForegroundColor Red
Write-Host "Skipped: $($skipped.Count)" -ForegroundColor Yellow
Write-Host "[SUMMARY] tests=$($testResults.Count) passed=$($passed.Count) failed=$($failed.Count) skipped=$($skipped.Count)"

if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "Failed tests:" -ForegroundColor Red
    foreach ($item in $failed) {
        Write-Host "- $($item.Name): $($item.Details)" -ForegroundColor Red
    }
    exit 1
}

exit 0
