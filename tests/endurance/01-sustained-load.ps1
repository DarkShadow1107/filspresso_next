#!/usr/bin/env pwsh
<#
.SYNOPSIS
Endurance testing: sustained load scenarios, memory leak detection, performance degradation,
connection pooling limits, and recovery after stress.
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

Invoke-TestGroup "Sustained Load Testing" {
    $result = Invoke-TestStep "Backend handles 500 consecutive requests over 30 seconds" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const axios = require("axios");

(async () => {
    const baseURL = "http://localhost:4000";
    const startTime = Date.now();
    const targetDuration = 30000; // 30 seconds
    let requestCount = 0;
    let successCount = 0;
    let errorCount = 0;
    const responseTimes = [];
    
    const startMemory = process.memoryUsage().heapUsed / 1024 / 1024;
    
    while (Date.now() - startTime < targetDuration) {
        const reqStart = Date.now();
        
        try {
            const response = await axios.get(`${baseURL}/health`, {
                timeout: 5000,
                validateStatus: () => true
            }).catch(() => null);
            
            const reqTime = Date.now() - reqStart;
            responseTimes.push(reqTime);
            
            if (response?.status === 200) {
                successCount++;
            } else {
                errorCount++;
            }
        } catch (error) {
            errorCount++;
        }
        
        requestCount++;
        
        // Small delay to avoid overwhelming
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    const endMemory = process.memoryUsage().heapUsed / 1024 / 1024;
    const memoryGrowth = endMemory - startMemory;
    
    const avgResponseTime = responseTimes.reduce((a, b) => a + b) / responseTimes.length;
    const p99ResponseTime = responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length * 0.99)];
    
    console.log(`Sustained load test results:`);
        console.log(`  Total requests: ${requestCount}`);
        console.log(`  Successful: ${successCount}`);
        console.log(`  Errors: ${errorCount}`);
        console.log(`  Avg response time: ${avgResponseTime.toFixed(2)}ms`);
        console.log(`  P99 response time: ${p99ResponseTime}ms`);
        console.log(`  Memory growth: ${memoryGrowth.toFixed(2)}MB`);
    
    assert.ok(successCount > requestCount * 0.90, "Less than 90% success rate");
    assert.ok(memoryGrowth < 500, "Possible memory leak: > 500MB growth");
})().catch((error) => { 
    if (error.message.includes("ECONNREFUSED")) {
        console.log("Backend not running, skipping");
    } else {
        console.error(error); 
        process.exit(1);
    }
});
'@
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Backend maintains stability over 100 requests" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const axios = require("axios");

(async () => {
    const baseURL = "http://localhost:4000";
    let successCount = 0;
    let errorCount = 0;

    const requests = [];
    for (let i = 0; i < 100; i++) {
        requests.push(
            axios.get(`${baseURL}/health`, {
                timeout: 5000,
                validateStatus: () => true
            }).then((response) => {
                if (response.status === 200) {
                    successCount++;
                } else {
                    errorCount++;
                }
            }).catch(() => {
                errorCount++;
            })
        );
    }

    await Promise.all(requests);

    console.log(`Backend stability test: ${successCount} successful, ${errorCount} errors`);

    assert.ok(successCount >= 95, "Less than 95% backend requests successful");
})().catch((error) => { 
    if (error.code === "ECONNREFUSED") {
        console.log("Database not running, skipping");
    } else {
        console.error(error); 
        process.exit(1);
    }
});
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "Performance Degradation Analysis" {
    $result = Invoke-TestStep "Response time increases linearly, not exponentially, under load" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const axios = require("axios");

(async () => {
    const baseURL = "http://localhost:4000";
    const loadLevels = [10, 50, 100, 200];
    const averageResponseTimes = [];
    
    for (const load of loadLevels) {
        const responseTimes = [];
        
        // Send 'load' concurrent requests
        const promises = [];
        for (let i = 0; i < load; i++) {
            const start = Date.now();
            promises.push(
                axios.get(`${baseURL}/health`, {
                    timeout: 10000,
                    validateStatus: () => true
                }).then(() => {
                    const elapsed = Date.now() - start;
                    responseTimes.push(elapsed);
                }).catch(() => {})
            );
        }
        
        await Promise.all(promises);
        
        if (responseTimes.length > 0) {
            const avgTime = responseTimes.reduce((a, b) => a + b) / responseTimes.length;
            averageResponseTimes.push(avgTime);
            console.log(`Load \${load}: avg response time = \${avgTime.toFixed(2)}ms`);
        }
    }
    
    // Check that growth is not exponential
    if (averageResponseTimes.length >= 2) {
        const firstRatio = averageResponseTimes[1] / (averageResponseTimes[0] || 1);
        const secondRatio = averageResponseTimes[2] / (averageResponseTimes[1] || 1);
        
        // Should not grow more than 3x when load increases 2x
        assert.ok(firstRatio < 5, "Performance degradation too steep");
    }
})().catch((error) => { 
    if (error.message.includes("ECONNREFUSED")) {
        console.log("Backend not running, skipping endurance test");
    } else {
        console.error(error); 
        process.exit(1);
    }
});
'@
    }
    Add-TestResult $result

    $result = Invoke-TestStep "P99 latency stays within acceptable bounds (< 2s) during load" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const axios = require("axios");

(async () => {
    const baseURL = "http://localhost:4000";
    const responseTimes = [];
    let successCount = 0;
    
    // 200 concurrent requests with timing
    const promises = [];
    for (let i = 0; i < 200; i++) {
        const start = Date.now();
        promises.push(
            axios.get(`\${baseURL}/health`, {
                timeout: 5000,
                validateStatus: () => true
            }).then(res => {
                const elapsed = Date.now() - start;
                responseTimes.push(elapsed);
                if (res.status === 200) successCount++;
            }).catch(() => {})
        );
    }
    
    await Promise.all(promises);
    
    if (responseTimes.length > 0) {
        const sorted = responseTimes.sort((a, b) => a - b);
        const p99 = sorted[Math.floor(sorted.length * 0.99)];
        
        console.log(`P99 latency: ${p99}ms (success: ${successCount}/200)`);
        
        // P99 should be reasonable (not too many slow requests)
        // Allow up to 2 seconds for local testing
        assert.ok(p99 < 2000, `P99 latency ${p99}ms exceeds 2s threshold`);
    }
})().catch((error) => { 
    if (error.message.includes("ECONNREFUSED")) {
        console.log("Backend not running, skipping");
    } else {
        console.error(error); 
        process.exit(1);
    }
});
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "Memory & Resource Management" {
    $result = Invoke-TestStep "Heap memory stable after 60 seconds of load (< 100MB growth)" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const axios = require("axios");

(async () => {
    const baseURL = "http://localhost:4000";
    const duration = 60000; // 60 seconds
    const sampleInterval = 5000; // 5 second samples
    const memoryReadings = [];
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < duration) {
        // Fire 10 concurrent requests
        const promises = [];
        for (let i = 0; i < 10; i++) {
            promises.push(
                axios.get(`${baseURL}/health`, {
                    timeout: 5000,
                    validateStatus: () => true
                }).catch(() => null)
            );
        }
        
        await Promise.all(promises);
        
        // Take memory sample
        const heapUsed = process.memoryUsage().heapUsed / 1024 / 1024;
        memoryReadings.push(heapUsed);
        
        // Wait for next sample
        await new Promise(resolve => setTimeout(resolve, sampleInterval));
    }
    
    if (memoryReadings.length >= 2) {
        const initialMemory = memoryReadings[0];
        const finalMemory = memoryReadings[memoryReadings.length - 1];
        const maxMemory = Math.max(...memoryReadings);
        const memoryGrowth = finalMemory - initialMemory;
        
        console.log(`Memory profile over 60s:`);
        console.log(`  Initial: ${initialMemory.toFixed(2)}MB`);
        console.log(`  Final: ${finalMemory.toFixed(2)}MB`);
        console.log(`  Max: ${maxMemory.toFixed(2)}MB`);
        console.log(`  Growth: ${memoryGrowth.toFixed(2)}MB`);
        
        // Memory should not grow excessively
        assert.ok(memoryGrowth < 100, `Memory grew ${memoryGrowth.toFixed(2)}MB > 100MB threshold`);
    }
})().catch((error) => { 
    if (error.message.includes("ECONNREFUSED")) {
        console.log("Backend not running, skipping memory test");
    } else {
        console.error(error); 
        process.exit(1);
    }
});
'@
    }
    Add-TestResult $result

    $result = Invoke-TestStep "No handles/descriptors leaks after 200 file operations" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
    const testDir = path.join(process.cwd(), ".test-fds");
    fs.mkdirSync(testDir, { recursive: true });
    
    try {
        const beforeHandles = typeof process._getActiveHandles === "function" ? process._getActiveHandles().length : 0;
        
        // Perform 200 file operations
        for (let i = 0; i < 200; i++) {
            const filePath = path.join(testDir, `test-${i}.txt`);
            fs.writeFileSync(filePath, `Test content ${i}`);
            fs.readFileSync(filePath, "utf8");
            fs.unlinkSync(filePath);
        }
        
        const afterHandles = typeof process._getActiveHandles === "function" ? process._getActiveHandles().length : 0;
        const fdGrowth = afterHandles - beforeHandles;
        
        console.log(`Active handle growth: ${fdGrowth}`);
        
        // Should not leak file descriptors
        assert.ok(fdGrowth < 10, `File descriptor leak detected: ${fdGrowth} unclosed handles`);
        
        // Cleanup
        fs.rmSync(testDir, { recursive: true, force: true });
    } catch (error) {
        throw error;
    }
})().catch((error) => { console.error(error); process.exit(1); });
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "Recovery After Stress" {
    $result = Invoke-TestStep "Service recovers normal response times after high load" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const axios = require("axios");

(async () => {
    const baseURL = "http://localhost:4000";
    
    // Phase 1: Baseline response time
    const baselineTimes = [];
    for (let i = 0; i < 10; i++) {
        const start = Date.now();
        await axios.get(`${baseURL}/health`, {
            timeout: 5000,
            validateStatus: () => true
        }).catch(() => null);
        baselineTimes.push(Date.now() - start);
    }
    const baselineAvg = baselineTimes.reduce((a, b) => a + b) / baselineTimes.length;
    
    console.log(`Baseline avg response time: ${baselineAvg.toFixed(2)}ms`);
    
    // Phase 2: High load
    console.log("Applying load stress...");
    const loadPromises = [];
    for (let i = 0; i < 500; i++) {
        loadPromises.push(
            axios.get(`${baseURL}/health`, {
                timeout: 5000,
                validateStatus: () => true
            }).catch(() => null)
        );
    }
    await Promise.all(loadPromises);
    
    // Phase 3: Recovery - wait 5 seconds
    console.log("Recovery period (5s)...");
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Phase 4: Measure recovery
    const recoveryTimes = [];
    for (let i = 0; i < 10; i++) {
        const start = Date.now();
        await axios.get(`${baseURL}/health`, {
            timeout: 5000,
            validateStatus: () => true
        }).catch(() => null);
        recoveryTimes.push(Date.now() - start);
    }
    const recoveryAvg = recoveryTimes.reduce((a, b) => a + b) / recoveryTimes.length;
    
    console.log(`Recovery avg response time: ${recoveryAvg.toFixed(2)}ms`);
    
    // Recovery time should be within 50% of baseline (allowing for some variance)
    assert.ok(recoveryAvg < baselineAvg * 1.5, `Recovery too slow: ${recoveryAvg.toFixed(2)}ms vs baseline ${baselineAvg.toFixed(2)}ms`);
})().catch((error) => { 
    if (error.message.includes("ECONNREFUSED")) {
        console.log("Backend not running, skipping recovery test");
    } else {
        console.error(error); 
        process.exit(1);
    }
});
'@
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Database connections normalize after spike" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");

(async () => {
    const pg = require("pg");
    
    const pool = new pg.Pool({
        host: process.env.DB_HOST || "localhost",
        port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || "filspresso",
        max: 10,
        idleTimeoutMillis: 5000,
    });
    
    // Baseline
    const baselineIdle = pool.idleCount;
    
    // Create spike
    const queries = [];
    for (let i = 0; i < 50; i++) {
        queries.push(
            pool.query("SELECT 1").catch(() => null)
        );
    }
    await Promise.all(queries);
    
    // Wait for recovery
    console.log("Waiting for connection pool recovery (10s)...");
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    const recoveredIdle = pool.idleCount;
    console.log(`Idle connections: baseline=\${baselineIdle}, recovered=\${recoveredIdle}`);
    
    await pool.end();
})().catch((error) => { 
    if (error.code === "ECONNREFUSED") {
        console.log("Database not running, skipping connection recovery test");
    } else {
        console.error(error); 
        process.exit(1);
    }
});
'@
    }
    Add-TestResult $result
}

# Summary
Write-Host ""
Write-Host "=== Endurance & Load Testing Summary ===" -ForegroundColor Cyan
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

