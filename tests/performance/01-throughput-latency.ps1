#!/usr/bin/env pwsh
<#
.SYNOPSIS
Performance tests for throughput, latency, and response time SLAs
#>

param(
    [string]$RepoRoot = "",
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

function Measure-OperationThroughput {
    param(
        [scriptblock]$Operation,
        [int]$Iterations = 100,
        [string]$OperationName
    )

    $times = @()
    $startTime = Get-Date

    for ($i = 0; $i -lt $Iterations; $i++) {
        $opStart = Get-Date
        & $Operation
        $opEnd = Get-Date
        $times += ($opEnd - $opStart).TotalMilliseconds
    }

    $endTime = Get-Date
    $totalDuration = $endTime - $startTime
    $avgTime = ($times | Measure-Object -Average).Average
    $minTime = ($times | Measure-Object -Minimum).Minimum
    $maxTime = ($times | Measure-Object -Maximum).Maximum
    
    $throughput = $Iterations / $totalDuration.TotalSeconds

    return @{
        Name = $OperationName
        Iterations = $Iterations
        Throughput = [Math]::Round($throughput, 2)
        AvgTimeMs = [Math]::Round($avgTime, 2)
        MinTimeMs = [Math]::Round($minTime, 2)
        MaxTimeMs = [Math]::Round($maxTime, 2)
        Times = $times
    }
}

function Get-Percentile {
    param(
        [double[]]$Values,
        [double]$Percentile
    )

    $sorted = $Values | Sort-Object
    $index = [int]($sorted.Count * ($Percentile / 100))
    if ($index -ge $sorted.Count) { $index = $sorted.Count - 1 }
    return $sorted[$index]
}

Invoke-TestGroup "Encryption Performance" {
    $result = Invoke-TestStep "Encryption throughput (ops/sec)" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const fs = require("node:fs");
process.env.ENCRYPTION_KEY = fs.readFileSync("./secrets/encryption_key.txt", "utf8").trim();
const encryption = require("./nestjs-backend/dist/common/utils/encryption.js");

const iterations = 100;
const times = [];
const start = process.hrtime.bigint();

for (let i = 0; i < iterations; i++) {
    const opStart = process.hrtime.bigint();
    const cipher = encryption.encrypt(`test-payload-${i}`);
    encryption.decrypt(cipher);
    const opEnd = process.hrtime.bigint();
    times.push(Number(opEnd - opStart) / 1000000);  // Convert to milliseconds
}

const end = process.hrtime.bigint();
const totalMs = Number(end - start) / 1000000;
const throughput = (iterations / totalMs) * 1000;

const sorted = times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b) / times.length;
const p50 = sorted[Math.floor(iterations * 0.5)];
const p95 = sorted[Math.floor(iterations * 0.95)];
const p99 = sorted[Math.floor(iterations * 0.99)];

process.stdout.write(JSON.stringify({
    throughput: Math.round(throughput),
    avgMs: Math.round(avg * 100) / 100,
    p50Ms: Math.round(p50 * 100) / 100,
    p95Ms: Math.round(p95 * 100) / 100,
    p99Ms: Math.round(p99 * 100) / 100,
}));
'@

        $result = Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const fs = require("node:fs");
process.env.ENCRYPTION_KEY = fs.readFileSync("./secrets/encryption_key.txt", "utf8").trim();
const encryption = require("./nestjs-backend/dist/common/utils/encryption.js");

const iterations = 100;
const times = [];
const start = process.hrtime.bigint();

for (let i = 0; i < iterations; i++) {
    const opStart = process.hrtime.bigint();
    const cipher = encryption.encrypt(`test-payload-${i}`);
    encryption.decrypt(cipher);
    const opEnd = process.hrtime.bigint();
    times.push(Number(opEnd - opStart) / 1000000);  // Convert to milliseconds
}

const end = process.hrtime.bigint();
const totalMs = Number(end - start) / 1000000;
const throughput = (iterations / totalMs) * 1000;

const sorted = times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b) / times.length;
const p50 = sorted[Math.floor(iterations * 0.5)];
const p95 = sorted[Math.floor(iterations * 0.95)];
const p99 = sorted[Math.floor(iterations * 0.99)];

process.stdout.write(JSON.stringify({
    throughput: Math.round(throughput),
    avgMs: Math.round(avg * 100) / 100,
    p50Ms: Math.round(p50 * 100) / 100,
    p95Ms: Math.round(p95 * 100) / 100,
    p99Ms: Math.round(p99 * 100) / 100,
}));
'@
        $parsed = $result | ConvertFrom-Json
        Write-Host "  Throughput: $($parsed.throughput) ops/sec"
        Write-Host "  Average latency: $($parsed.avgMs)ms"
        Write-Host "  p50 latency: $($parsed.p50Ms)ms"
        Write-Host "  p95 latency: $($parsed.p95Ms)ms"
        Write-Host "  p99 latency: $($parsed.p99Ms)ms"

        if ([double]$parsed.p95Ms -gt 5.0) {
            throw "Encryption p95 latency SLA breached: actual=$($parsed.p95Ms)ms target<=5ms"
        }
    }
    Add-TestResult $result
}

Invoke-TestGroup "Password Hashing Performance" {
    $result = Invoke-TestStep "Password hash latency (should have bcrypt cost)" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const passwords = require("./nestjs-backend/dist/common/utils/passwords.js");

(async () => {
    const iterations = 5;  // Bcrypt is intentionally slow
    const times = [];
    
    for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        await passwords.hashPassword(`password-${i}`);
        const end = process.hrtime.bigint();
        times.push(Number(end - start) / 1000000);  // Convert to milliseconds
    }

    const avg = times.reduce((a, b) => a + b) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    // Bcrypt with cost 10-12 should take 50-300ms per hash
    if (avg < 50) {
        process.stderr.write("WARNING: Password hashing too fast - cost factor may be too low");
        process.exit(1);
    }

    process.stdout.write(JSON.stringify({
        avgMs: Math.round(avg),
        minMs: Math.round(min),
        maxMs: Math.round(max),
    }));
})().catch((error) => { console.error(error); process.exit(1); });
'@

        $result = Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const passwords = require("./nestjs-backend/dist/common/utils/passwords.js");

(async () => {
    const iterations = 5;  // Bcrypt is intentionally slow
    const times = [];
    
    for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        await passwords.hashPassword(`password-${i}`);
        const end = process.hrtime.bigint();
        times.push(Number(end - start) / 1000000);  // Convert to milliseconds
    }

    const avg = times.reduce((a, b) => a + b) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    // Bcrypt with cost 10-12 should take 50-300ms per hash
    if (avg < 50) {
        process.stderr.write("WARNING: Password hashing too fast - cost factor may be too low");
        process.exit(1);
    }

    process.stdout.write(JSON.stringify({
        avgMs: Math.round(avg),
        minMs: Math.round(min),
        maxMs: Math.round(max),
    }));
})().catch((error) => { console.error(error); process.exit(1); });
'@
        $parsed = $result | ConvertFrom-Json
        Write-Host "  Average hash time: $($parsed.avgMs)ms (intentionally slow for security)"
        Write-Host "  Min hash time: $($parsed.minMs)ms"
        Write-Host "  Max hash time: $($parsed.maxMs)ms"
    }
    Add-TestResult $result
}

Invoke-TestGroup "Service Ledger Performance" {
    $result = Invoke-TestStep "Ledger event hash computation throughput" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const securityLedger = require("./nestjs-backend/dist/common/utils/securityLedger.js");

const iterations = 1000;
const times = [];
const start = process.hrtime.bigint();

for (let i = 0; i < iterations; i++) {
    const opStart = process.hrtime.bigint();
    const material = securityLedger.buildLedgerMaterial({
      chainScope: "global",
      prevHash: securityLedger.ZERO_HASH,
      eventType: "audit.event",
      serviceName: "backend",
      actorType: "user",
      actorId: `user-${i}`,
      correlationId: `corr-${i}`,
      occurredAt: new Date().toISOString(),
      payloadCanonical: securityLedger.canonicalizePayload({ index: i }),
    });
    securityLedger.computeEventHash(material);
    const opEnd = process.hrtime.bigint();
    times.push(Number(opEnd - opStart) / 1000000);
}

const end = process.hrtime.bigint();
const totalMs = Number(end - start) / 1000000;
const throughput = (iterations / totalMs) * 1000;

const sorted = times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b) / times.length;
const p95 = sorted[Math.floor(iterations * 0.95)];

process.stdout.write(JSON.stringify({
    throughput: Math.round(throughput),
    avgMs: Math.round(avg * 1000) / 1000,
    p95Ms: Math.round(p95 * 1000) / 1000,
}));
'@
        $result = Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const securityLedger = require("./nestjs-backend/dist/common/utils/securityLedger.js");

const iterations = 1000;
const times = [];
const start = process.hrtime.bigint();

for (let i = 0; i < iterations; i++) {
    const opStart = process.hrtime.bigint();
    const material = securityLedger.buildLedgerMaterial({
      chainScope: "global",
      prevHash: securityLedger.ZERO_HASH,
      eventType: "audit.event",
      serviceName: "backend",
      actorType: "user",
      actorId: `user-${i}`,
      correlationId: `corr-${i}`,
      occurredAt: new Date().toISOString(),
      payloadCanonical: securityLedger.canonicalizePayload({ index: i }),
    });
    securityLedger.computeEventHash(material);
    const opEnd = process.hrtime.bigint();
    times.push(Number(opEnd - opStart) / 1000000);
}

const end = process.hrtime.bigint();
const totalMs = Number(end - start) / 1000000;
const throughput = (iterations / totalMs) * 1000;

const sorted = times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b) / times.length;
const p95 = sorted[Math.floor(iterations * 0.95)];

process.stdout.write(JSON.stringify({
    throughput: Math.round(throughput),
    avgMs: Math.round(avg * 1000) / 1000,
    p95Ms: Math.round(p95 * 1000) / 1000,
}));
'@
        $parsed = $result | ConvertFrom-Json
        Write-Host "  Throughput: $($parsed.throughput) ops/sec"
        Write-Host "  Average latency: $($parsed.avgMs)ms"
        Write-Host "  p95 latency: $($parsed.p95Ms)ms"

        if ([double]$parsed.p95Ms -gt 2.0) {
            throw "Ledger p95 latency SLA breached: actual=$($parsed.p95Ms)ms target<=2ms"
        }
    }
    Add-TestResult $result
}

Invoke-TestGroup "HTTP Endpoint Performance" {
    $result = Invoke-TestStep "Health endpoint latency (p50/p95)" {
        $times = @()
        for ($i = 0; $i -lt 20; $i++) {
            $start = Get-Date
            $null = Test-HttpEndpoint -Uri "http://localhost:4000/health" -ExpectedStatus 200
            $end = Get-Date
            $times += ($end - $start).TotalMilliseconds
        }

        $sorted = $times | Sort-Object
        $p50 = $sorted[[int]($times.Count * 0.5)]
        $p95 = $sorted[[int]($times.Count * 0.95)]
        $avg = ($times | Measure-Object -Average).Average

        Write-Host "  Average latency: $([Math]::Round($avg, 2))ms"
        Write-Host "  p50 latency: $([Math]::Round($p50, 2))ms"
        Write-Host "  p95 latency: $([Math]::Round($p95, 2))ms"

        if ($p95 -gt 100) {
            throw "Health endpoint p95 latency SLA breached: actual=$([Math]::Round($p95, 2))ms target<=100ms"
        }
    }
    Add-TestResult $result
}

# Summary
Write-Host ""
Write-Host "=== Performance Test Summary ===" -ForegroundColor Cyan
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
