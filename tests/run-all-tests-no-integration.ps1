#!/usr/bin/env pwsh
<#
.SYNOPSIS
Strict Titan test orchestrator without Docker Compose integration tests.
Creates explicit per-run log files and summary artifacts.
#>

param(
    [string]$RepoRoot = "",
    [switch]$FailFast,
    [switch]$EnableVerboseModuleOutput
)

if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$testsDir = (Resolve-Path (Join-Path $PSScriptRoot ".")).Path
$startTime = Get-Date
$runStamp = $startTime.ToString("yyyyMMdd_HHmmss")
$logsRoot = Join-Path $testsDir "logs"
$runLogDir = Join-Path $logsRoot "strict_no_integration_$runStamp"
$null = New-Item -ItemType Directory -Path $runLogDir -Force

$runLogPath = Join-Path $runLogDir "run.log"
$summaryJsonPath = Join-Path $runLogDir "summary.json"
$summaryTxtPath = Join-Path $runLogDir "summary.txt"

function Test-BackendAvailability {
    param([string]$HealthUri = "http://localhost:4000/health")

    try {
        $invokeParams = @{
            Uri = $HealthUri
            Method = "GET"
            TimeoutSec = 8
        }
        if ((Get-Command Invoke-WebRequest).Parameters.ContainsKey("UseBasicParsing")) {
            $invokeParams["UseBasicParsing"] = $true
        }
        $response = Invoke-WebRequest @invokeParams
        return ([int]$response.StatusCode -eq 200)
    }
    catch {
        return $false
    }
}

function Get-FailedTestNames {
    param([string]$LogFile)

    if (-not (Test-Path $LogFile)) {
        return @()
    }

    $names = [System.Collections.Generic.List[string]]::new()
    $lines = Get-Content -Path $LogFile
    foreach ($line in $lines) {
        $match = [regex]::Match($line, '^-\s+([^:]+):\s+')
        if ($match.Success) {
            [void]$names.Add($match.Groups[1].Value.Trim())
        }
    }

    return @($names)
}

function Join-TopItems {
    param(
        [string[]]$Items,
        [int]$Max = 5
    )

    $safe = @($Items | Where-Object { $_ } | Select-Object -Unique)
    if ($safe.Count -eq 0) {
        return "none"
    }

    $selected = @($safe | Select-Object -First $Max)
    return ($selected -join "; ")
}

function Parse-Double {
    param([string]$Value)
    $parsed = 0.0
    if ([double]::TryParse($Value, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) {
        return $parsed
    }
    return $null
}

function Get-PerformanceSlaEvidence {
    param(
        [string]$PerformanceLog,
        [string]$EnduranceLog
    )

    $evidence = [System.Collections.Generic.List[object]]::new()

    if (Test-Path $PerformanceLog) {
        $content = Get-Content -Path $PerformanceLog -Raw

        $p95Matches = [regex]::Matches($content, 'p95 latency:\s*([0-9]+(?:\.[0-9]+)?)ms')
        if ($p95Matches.Count -ge 3) {
            $encryptionP95 = Parse-Double -Value $p95Matches[0].Groups[1].Value
            $ledgerP95 = Parse-Double -Value $p95Matches[1].Groups[1].Value
            $httpP95 = Parse-Double -Value $p95Matches[2].Groups[1].Value

            if ($null -ne $encryptionP95) {
                [void]$evidence.Add([pscustomobject]@{ Name = 'Encryption p95 latency'; Actual = $encryptionP95; Target = 5.0; Unit = 'ms'; Pass = ($encryptionP95 -le 5.0) })
            }
            if ($null -ne $ledgerP95) {
                [void]$evidence.Add([pscustomobject]@{ Name = 'Ledger p95 latency'; Actual = $ledgerP95; Target = 2.0; Unit = 'ms'; Pass = ($ledgerP95 -le 2.0) })
            }
            if ($null -ne $httpP95) {
                [void]$evidence.Add([pscustomobject]@{ Name = 'Health endpoint p95 latency'; Actual = $httpP95; Target = 100.0; Unit = 'ms'; Pass = ($httpP95 -le 100.0) })
            }
        }

        $hashAvg = [regex]::Match($content, 'Average hash time:\s*([0-9]+(?:\.[0-9]+)?)ms')
        if ($hashAvg.Success) {
            $hashMs = Parse-Double -Value $hashAvg.Groups[1].Value
            if ($null -ne $hashMs) {
                [void]$evidence.Add([pscustomobject]@{ Name = 'Password hash average latency'; Actual = $hashMs; Target = 50.0; Upper = 300.0; Unit = 'ms'; Pass = ($hashMs -ge 50.0 -and $hashMs -le 300.0) })
            }
        }
    }

    if (Test-Path $EnduranceLog) {
        $content = Get-Content -Path $EnduranceLog -Raw

        $totals = [regex]::Matches($content, 'Total requests:\s*([0-9]+)')
        $successes = [regex]::Matches($content, 'Successful:\s*([0-9]+)')
        if ($totals.Count -gt 0 -and $successes.Count -gt 0) {
            $total = [int]$totals[0].Groups[1].Value
            $ok = [int]$successes[0].Groups[1].Value
            if ($total -gt 0) {
                $rate = [Math]::Round((100.0 * $ok) / $total, 2)
                [void]$evidence.Add([pscustomobject]@{ Name = 'Sustained load success rate'; Actual = $rate; Target = 90.0; Unit = '%'; Pass = ($rate -ge 90.0) })
            }
        }

        $stability = [regex]::Match($content, 'Backend stability test:\s*([0-9]+) successful,\s*([0-9]+) errors')
        if ($stability.Success) {
            $ok = [int]$stability.Groups[1].Value
            $err = [int]$stability.Groups[2].Value
            $total = $ok + $err
            if ($total -gt 0) {
                $rate = [Math]::Round((100.0 * $ok) / $total, 2)
                [void]$evidence.Add([pscustomobject]@{ Name = '100-request backend stability rate'; Actual = $rate; Target = 95.0; Unit = '%'; Pass = ($rate -ge 95.0) })
            }
        }

        $p99 = [regex]::Match($content, 'P99 latency:\s*([0-9]+(?:\.[0-9]+)?)ms')
        if ($p99.Success) {
            $p99Ms = Parse-Double -Value $p99.Groups[1].Value
            if ($null -ne $p99Ms) {
                [void]$evidence.Add([pscustomobject]@{ Name = 'Endurance p99 latency'; Actual = $p99Ms; Target = 2000.0; Unit = 'ms'; Pass = ($p99Ms -le 2000.0) })
            }
        }
    }

    return @($evidence)
}

function Write-RunLog {
    param([string]$Line)
    Add-Content -Path $runLogPath -Value $Line
}

function Write-Header {
    param([string]$Text)
    Write-Host $Text -ForegroundColor Cyan
    Write-RunLog $Text
}

Write-Header "===================================================================="
Write-Header "Titan Strict Test Suite (No Integration)"
Write-Header "===================================================================="
Write-RunLog "Repository: $RepoRoot"
Write-RunLog "Run started at: $($startTime.ToString("yyyy-MM-dd HH:mm:ss"))"
Write-RunLog "Log directory: $runLogDir"

Write-Header "Preflight checks"
$backendAvailable = Test-BackendAvailability
if (-not $backendAvailable) {
    $preflightMessage = "Backend is not reachable on http://localhost:4000/health. Start Docker/services before strict suite execution."
    Write-Host $preflightMessage -ForegroundColor Red
    Write-RunLog $preflightMessage

    $preflightSummary = @(
        "Titan Strict Test Suite (No Integration)",
        "Repository: $RepoRoot",
        "Started: $($startTime.ToString("yyyy-MM-dd HH:mm:ss"))",
        "Ended: $((Get-Date).ToString("yyyy-MM-dd HH:mm:ss"))",
        "Preflight: FAILED",
        "Reason: $preflightMessage",
        "RunLog: $runLogPath"
    )
    $preflightSummary | Set-Content -Path $summaryTxtPath
    $preflightSummary | ForEach-Object { Write-RunLog $_ }

    $preflightJson = [pscustomobject]@{
        startedAt = $startTime.ToString("o")
        endedAt = (Get-Date).ToString("o")
        repository = $RepoRoot
        preflight = [pscustomobject]@{
            passed = $false
            reason = $preflightMessage
        }
        runLog = $runLogPath
    }
    $preflightJson | ConvertTo-Json -Depth 6 | Set-Content -Path $summaryJsonPath
    exit 4
}

Write-RunLog "Preflight: backend availability passed"

$testModules = @(
    @{ Name = "Unit: Utilities"; Path = "$testsDir\unit\01-utilities.ps1"; Category = "Security" },
    @{ Name = "Unit: Strict Crypto Hashing"; Path = "$testsDir\unit\02-crypto-hashing-strict.ps1"; Category = "Security" },
    @{ Name = "Security: Authentication"; Path = "$testsDir\security\01-authentication.ps1"; Category = "Security" },
    @{ Name = "Security: Abuse Resistance"; Path = "$testsDir\security\02-abuse-resistance.ps1"; Category = "Security" },
    @{ Name = "Security: ZK Architecture"; Path = "$testsDir\security\03-zk-architecture-strict.ps1"; Category = "Security" },
    @{ Name = "Security: Advanced Cryptography"; Path = "$testsDir\security\04-cryptography-strict-v2.ps1"; Category = "Security" },
    @{ Name = "Database: Stress & Attack"; Path = "$testsDir\database\01-stress-attack.ps1"; Category = "Reliability" },
    @{ Name = "Endurance: Sustained Load"; Path = "$testsDir\endurance\01-sustained-load.ps1"; Category = "Performance" },
    @{ Name = "Performance: Throughput Latency"; Path = "$testsDir\performance\01-throughput-latency.ps1"; Category = "Performance" },
    @{ Name = "Reliability: Failure Recovery"; Path = "$testsDir\reliability\01-failure-recovery.ps1"; Category = "Reliability" }
)

function Run-TestModule {
    param(
        [string]$ModulePath,
        [string]$ModuleName,
        [string]$ModuleCategory
    )

    if (-not (Test-Path $ModulePath)) {
        throw "Missing test module file: $ModulePath"
    }

    $safeName = ($ModuleName -replace '[^A-Za-z0-9_-]', '_')
    $moduleLogPath = Join-Path $runLogDir ("{0}.log" -f $safeName)

    Write-Host ""
    Write-Host ("Running: {0}" -f $ModuleName) -ForegroundColor Yellow
    Write-RunLog ""
    Write-RunLog ("Running: {0}" -f $ModuleName)

    $output = & pwsh -NoProfile -File $ModulePath -RepoRoot $RepoRoot -FailFast:$FailFast 2>&1
    $exitCode = $LASTEXITCODE
    $outputText = [string]($output -join [Environment]::NewLine)

    Set-Content -Path $moduleLogPath -Value $outputText
    Write-RunLog ("Module log file: {0}" -f $moduleLogPath)

    if ($EnableVerboseModuleOutput) {
        Write-Host $outputText
    }

    $summaryMatch = [regex]::Match($outputText, '\[SUMMARY\]\s+tests=(\d+)\s+passed=(\d+)\s+failed=(\d+)\s+skipped=(\d+)')
    if (-not $summaryMatch.Success) {
        throw "Missing [SUMMARY] line in module output: $ModuleName"
    }

    return [pscustomobject]@{
        Name = $ModuleName
        Category = $ModuleCategory
        Path = $ModulePath
        ExitCode = $exitCode
        Success = ($exitCode -eq 0)
        Tests = [int]$summaryMatch.Groups[1].Value
        Passed = [int]$summaryMatch.Groups[2].Value
        Failed = [int]$summaryMatch.Groups[3].Value
        Skipped = [int]$summaryMatch.Groups[4].Value
        LogFile = $moduleLogPath
    }
}

$results = [System.Collections.Generic.List[object]]::new()

foreach ($module in $testModules) {
    $moduleResult = Run-TestModule -ModulePath $module.Path -ModuleName $module.Name -ModuleCategory $module.Category
    [void]$results.Add($moduleResult)

    Write-Host ("Module result: tests={0}, passed={1}, failed={2}, skipped={3}" -f $moduleResult.Tests, $moduleResult.Passed, $moduleResult.Failed, $moduleResult.Skipped)
    Write-RunLog ("Module result: tests={0}, passed={1}, failed={2}, skipped={3}" -f $moduleResult.Tests, $moduleResult.Passed, $moduleResult.Failed, $moduleResult.Skipped)

    if (-not $moduleResult.Success -and $FailFast) {
        Write-Host "FailFast enabled and module failed. Stopping." -ForegroundColor Red
        Write-RunLog "FailFast enabled and module failed. Stopping."
        break
    }
}

$totalModules = $results.Count
$passedModules = @($results | Where-Object { $_.Success }).Count
$failedModules = @($results | Where-Object { -not $_.Success }).Count
$totalTests = ($results | Measure-Object -Property Tests -Sum).Sum
$totalPassedTests = ($results | Measure-Object -Property Passed -Sum).Sum
$totalFailedTests = ($results | Measure-Object -Property Failed -Sum).Sum
$totalSkippedTests = ($results | Measure-Object -Property Skipped -Sum).Sum

$securityModules = @($results | Where-Object { $_.Category -eq "Security" })
$performanceModules = @($results | Where-Object { $_.Category -eq "Performance" })
$reliabilityModules = @($results | Where-Object { $_.Category -eq "Reliability" })

# Calculate category scores
function Get-CategoryScore {
    param([object[]]$Modules)
    if ($Modules.Count -eq 0) { return 0 }
    $totalTests = ($Modules | Measure-Object -Property Tests -Sum).Sum
    $passedTests = ($Modules | Measure-Object -Property Passed -Sum).Sum
    if ($totalTests -eq 0) { return 0 }
    
    $baseScore = (100.0 * $passedTests) / $totalTests
    $failurePenalty = $Modules.Count * ($Modules | Where-Object { $_.Failed -gt 0 } | Measure-Object | Select-Object -ExpandProperty Count) * 5
    $score = [Math]::Max(0, $baseScore - $failurePenalty)
    return [Math]::Round($score, 2)
}

$securityTotalTests = ($securityModules | Measure-Object -Property Tests -Sum).Sum
$securityPassedTests = ($securityModules | Measure-Object -Property Passed -Sum).Sum
$securityFailedTests = ($securityModules | Measure-Object -Property Failed -Sum).Sum
$securityScore = Get-CategoryScore -Modules $securityModules

$performanceTotalTests = ($performanceModules | Measure-Object -Property Tests -Sum).Sum
$performancePassedTests = ($performanceModules | Measure-Object -Property Passed -Sum).Sum
$performanceFailedTests = ($performanceModules | Measure-Object -Property Failed -Sum).Sum
$performancePassRatioScore = Get-CategoryScore -Modules $performanceModules

$performanceModule = @($results | Where-Object { $_.Name -eq "Performance: Throughput Latency" } | Select-Object -First 1)
$enduranceModule = @($results | Where-Object { $_.Name -eq "Endurance: Sustained Load" } | Select-Object -First 1)
$performanceSlaEvidence = Get-PerformanceSlaEvidence -PerformanceLog $performanceModule.LogFile -EnduranceLog $enduranceModule.LogFile
$performanceSlaChecks = $performanceSlaEvidence.Count
$performanceSlaPassed = @($performanceSlaEvidence | Where-Object { $_.Pass }).Count
$performanceSlaCompliancePct = if ($performanceSlaChecks -gt 0) { [Math]::Round((100.0 * $performanceSlaPassed) / $performanceSlaChecks, 2) } else { 0 }

# Performance score is blended from behavior pass ratio and measured SLA compliance.
$performanceScore = [Math]::Round((0.60 * $performancePassRatioScore) + (0.40 * $performanceSlaCompliancePct), 2)

$reliabilityTotalTests = ($reliabilityModules | Measure-Object -Property Tests -Sum).Sum
$reliabilityPassedTests = ($reliabilityModules | Measure-Object -Property Passed -Sum).Sum
$reliabilityFailedTests = ($reliabilityModules | Measure-Object -Property Failed -Sum).Sum
$reliabilityScore = Get-CategoryScore -Modules $reliabilityModules

# Calculate weighted overall score (Security: 40%, Performance: 25%, Reliability: 20%, Compliance: 15%)
$securityWeight = 0.40
$performanceWeight = 0.25
$reliabilityWeight = 0.20
$complianceWeight = 0.15

$complianceScore = if ($totalFailedTests -eq 0 -and $totalSkippedTests -eq 0) { 100 } else { [Math]::Max(0, 100 - ($totalFailedTests * 10) - ($totalSkippedTests * 5)) }
$overallScore = ($securityScore * $securityWeight) + ($performanceScore * $performanceWeight) + ($reliabilityScore * $reliabilityWeight) + ($complianceScore * $complianceWeight)
$overallScore = [Math]::Round($overallScore, 2)

# Determine score color and interpretation
function Get-ScoreInterpretation {
    param([double]$Score)
    if ($Score -ge 90) { return "Excellent", "Green" }
    elseif ($Score -ge 75) { return "Good", "Yellow" }
    elseif ($Score -ge 60) { return "Fair", "DarkYellow" }
    else { return "Poor", "Red" }
}

$securityPosture, $securityColor = Get-ScoreInterpretation -Score $securityScore
$performancePosture, $performanceColor = Get-ScoreInterpretation -Score $performanceScore
$reliabilityPosture, $reliabilityColor = Get-ScoreInterpretation -Score $reliabilityScore
$overallPosture, $overallColor = Get-ScoreInterpretation -Score $overallScore

$strongModules = @($results | Where-Object { $_.Failed -eq 0 } | ForEach-Object { $_.Name })
$weakModules = @($results | Where-Object { $_.Failed -gt 0 })

$weakPointItems = [System.Collections.Generic.List[string]]::new()
foreach ($module in $weakModules) {
    $failedNames = Get-FailedTestNames -LogFile $module.LogFile
    if ($failedNames.Count -gt 0) {
        foreach ($name in $failedNames) {
            [void]$weakPointItems.Add("$($module.Name): $name")
        }
    }
    else {
        [void]$weakPointItems.Add("$($module.Name): module reported failures without named failed tests")
    }
}

$priorityActions = [System.Collections.Generic.List[string]]::new()
if ($securityFailedTests -gt 0) {
    [void]$priorityActions.Add("Fix failed security checks before release")
}
if ($totalFailedTests -gt 0 -and @($results | Where-Object { $_.Category -eq "Reliability" -and $_.Failed -gt 0 }).Count -gt 0) {
    [void]$priorityActions.Add("Address reliability failures to reduce incident risk")
}
if ($totalFailedTests -gt 0 -and @($results | Where-Object { $_.Category -eq "Performance" -and $_.Failed -gt 0 }).Count -gt 0) {
    [void]$priorityActions.Add("Resolve performance SLA regressions")
}
if ($priorityActions.Count -eq 0) {
    [void]$priorityActions.Add("No critical corrective actions required")
}

$endTime = Get-Date
$duration = $endTime - $startTime

$summaryObject = [pscustomobject]@{
    startedAt = $startTime.ToString("o")
    endedAt = $endTime.ToString("o")
    durationSeconds = [Math]::Round($duration.TotalSeconds, 2)
    repository = $RepoRoot
    runLog = $runLogPath
    totalModules = $totalModules
    passedModules = $passedModules
    failedModules = $failedModules
    totalTests = $totalTests
    passedTests = $totalPassedTests
    failedTests = $totalFailedTests
    skippedTests = $totalSkippedTests
    scoring = [pscustomobject]@{
        overall = [pscustomobject]@{
            score = $overallScore
            interpretation = $overallPosture
            weights = [pscustomobject]@{
                security = ($securityWeight * 100)
                performance = ($performanceWeight * 100)
                reliability = ($reliabilityWeight * 100)
                compliance = ($complianceWeight * 100)
            }
        }
        security = [pscustomobject]@{
            score = $securityScore
            interpretation = $securityPosture
            tests = $securityTotalTests
            passed = $securityPassedTests
            failed = $securityFailedTests
        }
        performance = [pscustomobject]@{
            score = $performanceScore
            interpretation = $performancePosture
            tests = $performanceTotalTests
            passed = $performancePassedTests
            failed = $performanceFailedTests
            passRatioScore = $performancePassRatioScore
            slaCompliancePct = $performanceSlaCompliancePct
            slaChecks = $performanceSlaChecks
            slaChecksPassed = $performanceSlaPassed
            slaEvidence = @($performanceSlaEvidence)
        }
        reliability = [pscustomobject]@{
            score = $reliabilityScore
            interpretation = $reliabilityPosture
            tests = $reliabilityTotalTests
            passed = $reliabilityPassedTests
            failed = $reliabilityFailedTests
        }
        compliance = [pscustomobject]@{
            score = $complianceScore
            interpretation = if ($totalFailedTests -eq 0 -and $totalSkippedTests -eq 0) { "Excellent" } else { "Degraded" }
        }
    }
    securityPosture = $securityPosture
    strongAreas = $strongModules
    weakPoints = @($weakPointItems)
    priorityActions = @($priorityActions)
    modules = $results | Select-Object @{Name="name";Expr={$_.Name}}, @{Name="category";Expr={$_.Category}}, @{Name="tests";Expr={$_.Tests}}, @{Name="passed";Expr={$_.Passed}}, @{Name="failed";Expr={$_.Failed}}, @{Name="skipped";Expr={$_.Skipped}}, @{Name="score";Expr={if($_.Tests -gt 0) {[Math]::Round((100.0*$_.Passed)/$_.Tests, 2)} else {0}}}
}

$summaryObject | ConvertTo-Json -Depth 6 | Set-Content -Path $summaryJsonPath

$summaryLines = @(
    "Titan Strict Test Suite (No Integration) - Professional Scoring Report"
    "Repository: $RepoRoot"
    "Started: $($startTime.ToString("yyyy-MM-dd HH:mm:ss"))"
    "Ended: $($endTime.ToString("yyyy-MM-dd HH:mm:ss"))"
    "DurationSeconds: $([Math]::Round($duration.TotalSeconds, 2))"
    ""
    "=== OVERALL SCORE: $overallScore% ($overallPosture) ==="
    "  Weights: Security 40% | Performance 25% | Reliability 20% | Compliance 15%"
    ""
    "=== CATEGORY BREAKDOWN ==="
    "Security Score:      $securityScore% ($securityPosture) - Tests: $securityPassedTests/$securityTotalTests passed"
    "Performance Score:   $performanceScore% ($performancePosture) - Tests: $performancePassedTests/$performanceTotalTests passed"
    "  Performance Inputs: PassRatio=$performancePassRatioScore% | SLACompliance=$performanceSlaCompliancePct% ($performanceSlaPassed/$performanceSlaChecks checks)"
    "Reliability Score:   $reliabilityScore% ($reliabilityPosture) - Tests: $reliabilityPassedTests/$reliabilityTotalTests passed"
    "Compliance Score:    $complianceScore% - Failures: $totalFailedTests, Skipped: $totalSkippedTests"
    ""
    "=== AGGREGATE METRICS ==="
    "TotalModules: $totalModules"
    "PassedModules: $passedModules"
    "FailedModules: $failedModules"
    "TotalTests: $totalTests"
    "PassedTests: $totalPassedTests"
    "FailedTests: $totalFailedTests"
    "SkippedTests: $totalSkippedTests"
    ""
    "=== MODULE DETAILS ==="
)

foreach ($result in $results) {
    $moduleScore = if ($result.Tests -gt 0) { [Math]::Round((100.0 * $result.Passed) / $result.Tests, 2) } else { 0 }
    $moduleStatus = if ($result.Failed -eq 0) { "✓" } else { "✗" }
    $summaryLines += "  $moduleStatus $($result.Name) [$($result.Category)]"
    $summaryLines += "     Score: $moduleScore% | Tests: $($result.Passed)/$($result.Tests) | Failed: $($result.Failed) | Skipped: $($result.Skipped)"
}

$summaryLines += @(
    ""
    "=== SLA EVIDENCE (MEASURED) ==="
)

if ($performanceSlaEvidence.Count -gt 0) {
    foreach ($item in $performanceSlaEvidence) {
        if ($item.PSObject.Properties.Match("Upper").Count -gt 0) {
            $upper = $item.Upper
            $targetText = "$($item.Target)-$upper$($item.Unit)"
        }
        else {
            $targetText = "$($item.Target)$($item.Unit)"
        }
        $resultText = if ($item.Pass) { "PASS" } else { "FAIL" }
        $summaryLines += "  - $($item.Name): actual=$($item.Actual)$($item.Unit), target=$targetText => $resultText"
    }
}
else {
    $summaryLines += "  - No SLA evidence extracted from module logs."
}

$summaryLines += @(
    ""
    "=== RISK ASSESSMENT ==="
    "Strong Areas: $(Join-TopItems -Items $strongModules -Max 8)"
    "Weak Points: $(Join-TopItems -Items @($weakPointItems) -Max 10)"
    "Priority Actions: $(Join-TopItems -Items @($priorityActions) -Max 5)"
    ""
    "=== SCORING INTERPRETATION ==="
    "90-100%: Excellent - System is production-ready with strong security posture"
    "75-89%:  Good - Most security objectives met, minor improvements recommended"
    "60-74%:  Fair - Significant weaknesses identified, recommend hardening"
    "<60%:    Poor - Critical issues, resolve before production deployment"
    ""
    "RunLog: $runLogPath"
    "SummaryJson: $summaryJsonPath"
)
$summaryLines | Set-Content -Path $summaryTxtPath
$summaryLines | ForEach-Object { Write-RunLog $_ }

Write-Host ""
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "Strict Test Suite Summary - Professional Scoring" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host ("OVERALL SCORE: {0}% ({1})" -f $overallScore, $overallPosture) -ForegroundColor $overallColor -BackgroundColor Black
Write-Host ("Weights: Security 40% | Performance 25% | Reliability 20% | Compliance 15%")
Write-Host ""
Write-Host "Category Breakdown:" -ForegroundColor Cyan
Write-Host ("  Security:      {0}% ({1})" -f $securityScore, $securityPosture) -ForegroundColor $securityColor
Write-Host ("  Performance:   {0}% ({1})" -f $performanceScore, $performancePosture) -ForegroundColor $performanceColor
Write-Host ("  Reliability:   {0}% ({1})" -f $reliabilityScore, $reliabilityPosture) -ForegroundColor $reliabilityColor
Write-Host ("  Compliance:    {0}%" -f $complianceScore)
Write-Host ""
Write-Host "Aggregate Metrics:" -ForegroundColor Cyan
Write-Host ("Total modules: {0}" -f $totalModules)
Write-Host ("Passed modules: {0}" -f $passedModules) -ForegroundColor Green
Write-Host ("Failed modules: {0}" -f $failedModules) -ForegroundColor Red
Write-Host ("Total tests: {0}" -f $totalTests)
Write-Host ("Passed tests: {0}" -f $totalPassedTests) -ForegroundColor Green
Write-Host ("Failed tests: {0}" -f $totalFailedTests) -ForegroundColor Red
Write-Host ("Skipped tests: {0}" -f $totalSkippedTests) -ForegroundColor Yellow
Write-Host ""
Write-Host ("Log directory: {0}" -f $runLogDir) -ForegroundColor DarkCyan
Write-Host ("Summary json: {0}" -f $summaryJsonPath) -ForegroundColor DarkCyan
Write-Host ("Summary text: {0}" -f $summaryTxtPath) -ForegroundColor DarkCyan
Write-Host ""

if ($totalTests -lt 100) {
    Write-Host "Test count policy violation: expected at least 100 tests." -ForegroundColor Red
    exit 2
}

if ($totalFailedTests -gt 0 -or $failedModules -gt 0) {
    exit 1
}

if ($totalSkippedTests -gt 0) {
    Write-Host "Skip policy violation: strict suite requires zero skipped tests." -ForegroundColor Red
    exit 3
}

exit 0
