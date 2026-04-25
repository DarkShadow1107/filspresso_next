#!/usr/bin/env pwsh
<#
.SYNOPSIS
Titan V0.74 Test Suite Orchestrator
Runs comprehensive modular tests for security, performance, and reliability
#>

param(
    [string]$RepoRoot = "",
    [string]$ComposeEnvFile = "security.env.example",
    [switch]$SkipSignedHistory,
    [switch]$RepairGoOpsMtls,
    [switch]$FailFast,
    [ValidateSet("unit", "integration", "security", "performance", "reliability", "all")]
    [string]$TestCategory = "all"
)

if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$testsDir = (Resolve-Path (Join-Path $PSScriptRoot ".")).Path
$startTime = Get-Date

# Import test utilities
. (Join-Path $testsDir "shared\test-utils.ps1")

Write-Host "╔════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║        Titan V0.74 Comprehensive Test Suite                        ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "Repository: $RepoRoot" -ForegroundColor DarkCyan
Write-Host "Test Category: $TestCategory" -ForegroundColor DarkCyan
Write-Host "Start time: $($startTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor DarkCyan
Write-Host ""

$allResults = @{
    Total = 0
    Passed = 0
    Failed = 0
    Skipped = 0
    Categories = @()
}

function Run-TestModule {
    param(
        [string]$ModulePath,
        [string]$ModuleName
    )

    Write-Host ""
    Write-Host "▶ Running: $ModuleName" -ForegroundColor Yellow

    try {
        $output = & pwsh -NoProfile -File $ModulePath `
            -RepoRoot $RepoRoot `
            -ComposeEnvFile $ComposeEnvFile `
            -SkipSignedHistory:$SkipSignedHistory `
            -RepairGoOpsMtls:$RepairGoOpsMtls `
            -FailFast:$FailFast 2>&1

        $exitCode = $LASTEXITCODE
        $outputText = [string]($output -join [Environment]::NewLine)
        Write-Host $outputText

        $summaryMatch = [regex]::Match($outputText, '\[SUMMARY\]\s+tests=(\d+)\s+passed=(\d+)\s+failed=(\d+)\s+skipped=(\d+)')
        $summary = if ($summaryMatch.Success) {
            [pscustomobject]@{
                Tests = [int]$summaryMatch.Groups[1].Value
                Passed = [int]$summaryMatch.Groups[2].Value
                Failed = [int]$summaryMatch.Groups[3].Value
                Skipped = [int]$summaryMatch.Groups[4].Value
            }
        } else {
            [pscustomobject]@{
                Tests = 0
                Passed = 0
                Failed = 0
                Skipped = 0
            }
        }

        return @{
            Name = $ModuleName
            Path = $ModulePath
            ExitCode = $exitCode
            Success = $exitCode -eq 0
            Summary = $summary
        }
    }
    catch {
        Write-Host "✗ FAILED: $($_.Exception.Message)" -ForegroundColor Red
        return @{
            Name = $ModuleName
            Path = $ModulePath
            ExitCode = -1
            Success = $false
        }
    }
}

$testModules = @()

# Unit Tests
if ($TestCategory -in "unit", "all") {
    $testModules += @(
        @{ Name = "Unit: Utilities"; Path = "$testsDir\unit\01-utilities.ps1" }
    )
}

# Integration Tests
if ($TestCategory -in "integration", "all") {
    $testModules += @(
        @{ Name = "Integration: Docker Compose"; Path = "$testsDir\integration\01-docker-compose.ps1" }
    )
}

# Security Tests
if ($TestCategory -in "security", "all") {
    $testModules += @(
        @{ Name = "Security: Authentication"; Path = "$testsDir\security\01-authentication.ps1" },
        @{ Name = "Security: Abuse Resistance"; Path = "$testsDir\security\02-abuse-resistance.ps1" }
    )
}

# Performance Tests
if ($TestCategory -in "performance", "all") {
    $testModules += @(
        @{ Name = "Performance: Throughput & Latency"; Path = "$testsDir\performance\01-throughput-latency.ps1" }
    )
}

# Reliability Tests
if ($TestCategory -in "reliability", "all") {
    $testModules += @(
        @{ Name = "Reliability: Failure Recovery"; Path = "$testsDir\reliability\01-failure-recovery.ps1" }
    )
}

$results = @()
$totalTests = 0
$totalPassedTests = 0
$totalFailedTests = 0
$totalSkippedTests = 0
foreach ($module in $testModules) {
    if (-not (Test-Path $module.Path)) {
        Write-Host ""
        Write-Host "⊘ Skipped: $($module.Name) (file not found)" -ForegroundColor Yellow
        continue
    }

    $result = Run-TestModule -ModulePath $module.Path -ModuleName $module.Name
    $results += $result
    $totalTests += $result.Summary.Tests
    $totalPassedTests += $result.Summary.Passed
    $totalFailedTests += $result.Summary.Failed
    $totalSkippedTests += $result.Summary.Skipped

    if (-not $result.Success) {
        if ($FailFast) {
            Write-Host ""
            Write-Host "✗ Test suite failed (FailFast enabled)" -ForegroundColor Red
            break
        }
    }
}

# Summary
Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                      TEST SUITE SUMMARY                            ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$passedCount = @($results | Where-Object { $_.Success }).Count
$failedCount = @($results | Where-Object { -not $_.Success }).Count
$totalCount = $results.Count

Write-Host "Total Modules: $totalCount" -ForegroundColor White
Write-Host "Passed: $passedCount" -ForegroundColor Green
Write-Host "Failed: $failedCount" -ForegroundColor Red
Write-Host "Total Tests: $totalTests" -ForegroundColor White
Write-Host "Tests Passed: $totalPassedTests" -ForegroundColor Green
Write-Host "Tests Failed: $totalFailedTests" -ForegroundColor Red
Write-Host "Tests Skipped: $totalSkippedTests" -ForegroundColor Yellow
Write-Host ""

if ($failedCount -gt 0) {
    Write-Host "Failed Modules:" -ForegroundColor Red
    foreach ($result in $results | Where-Object { -not $_.Success }) {
        Write-Host "  ✗ $($result.Name)" -ForegroundColor Red
        Write-Host "    Exit code: $($result.ExitCode)" -ForegroundColor DarkRed
    }
    Write-Host ""
}

$endTime = Get-Date
$duration = $endTime - $startTime
Write-Host "Duration: $([Math]::Round($duration.TotalSeconds, 2))s" -ForegroundColor DarkCyan
Write-Host "End time: $($endTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor DarkCyan

# Exit with appropriate code
$exitCode = 0
if ($failedCount -gt 0) {
    $exitCode = 1
}

exit $exitCode
