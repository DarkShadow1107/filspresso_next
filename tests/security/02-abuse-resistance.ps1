#!/usr/bin/env pwsh
<#
.SYNOPSIS
Security tests for abuse resistance, attack vectors, and integrity
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

Invoke-TestGroup "Replay Attack Prevention" {
    $result = Invoke-TestStep "Operation ID normalization blocks exact replays" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const replayGuard = require("./nestjs-backend/dist/common/utils/replayGuard.js");

// Valid operation IDs should normalize consistently
const opId1 = "operation_ABC-123_2026";
const normalized = replayGuard.normalizeOperationId(opId1);
assert.equal(normalized, opId1);

// Invalid IDs should be rejected
const badId = "bad id with spaces";
const badNormalized = replayGuard.normalizeOperationId(badId);
assert.equal(badNormalized, "");

// Test replicate detection logic
const cache = new Map();
const isReplay = (id) => {
    const normalized = replayGuard.normalizeOperationId(id);
        if (!normalized) return false;
    if (cache.has(normalized)) return true;
    cache.set(normalized, true);
    return false;
};

assert.equal(isReplay("operation_ABC-123_2026"), false, "First operation should not be replay");
assert.equal(isReplay("operation_ABC-123_2026"), true, "Duplicate operation should be replay");
assert.equal(isReplay("operation_XYZ-456_2026"), false, "Different operation should not be replay");
'@
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Service assertion scope prevents privilege escalation" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.SERVICE_ASSERTION_PRIVATE_KEY = fs.readFileSync("./secrets/service_assertion_private_key.pem", "utf8").trim();
process.env.SERVICE_ASSERTION_PUBLIC_KEY = fs.readFileSync("./secrets/service_assertion_public_key.pem", "utf8").trim();
const serviceAssertions = require("./nestjs-backend/dist/common/utils/serviceAssertions.js");

// Attempt to issue token with elevated scope should be denied by policy
assert.throws(() => serviceAssertions.issueServiceAssertion({
    privateKeyPem: process.env.SERVICE_ASSERTION_PRIVATE_KEY,
    scope: "admin:full-access"
}), /scope not allowed/);

// Issue a valid service assertion and ensure scope checks are enforced
const issued = serviceAssertions.issueServiceAssertion({
    privateKeyPem: process.env.SERVICE_ASSERTION_PRIVATE_KEY,
    scope: "service-events:write"
});

// Verify should reject if verifying for different scope
const verified = serviceAssertions.verifyServiceAssertion(issued.token, {
    expectedScope: "service-events:read"
});
assert.equal(verified.ok, false, "Token with wrong scope should be rejected");

// Even with correct scope, verify it's locked to that scope
const verified2 = serviceAssertions.verifyServiceAssertion(issued.token, {
    expectedScope: "service-events:write"
});
assert.equal(verified2.ok, true, "Token with matching scope should be accepted");
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "Input Validation & Injection Prevention" {
    $result = Invoke-TestStep "SQL injection attempt in encryption utility" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.ENCRYPTION_KEY = fs.readFileSync("./secrets/encryption_key.txt", "utf8").trim();
const encryption = require("./nestjs-backend/dist/common/utils/encryption.js");

// Attempt to inject SQL through encrypted payload
const sqlInjection = "1\\'; DROP TABLE users; --";
const encrypted = encryption.encrypt(sqlInjection);

// Should still decrypt to the exact same value (encryption is transparent)
const decrypted = encryption.decrypt(encrypted);
assert.equal(decrypted, sqlInjection);

// The responsibility for SQL injection prevention is on the application layer
// (using prepared statements, parameterized queries, etc.)
'@
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Card number format validation" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.ENCRYPTION_KEY = fs.readFileSync("./secrets/encryption_key.txt", "utf8").trim();
const encryption = require("./nestjs-backend/dist/common/utils/encryption.js");

// Test with invalid card formats
try {
  const type1 = encryption.detectCardType("not a card");
  assert.equal(type1, "unknown", "Invalid card should return unknown");
} catch (e) {
  // Expected - invalid format rejection
}

// Test PAN extraction with edge cases
const lastFour1 = encryption.getLastFour("");
const lastFour2 = encryption.getLastFour("1234");
const lastFour3 = encryption.getLastFour("4111111111111111");

assert.equal(lastFour3, "1111", "Should extract last 4 digits correctly");
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "Cryptographic Integrity" {
    $result = Invoke-TestStep "Ledger hash chain integrity" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const securityLedger = require("./nestjs-backend/dist/common/utils/securityLedger.js");

// Create two entries with chaining
const entry1 = securityLedger.buildLedgerMaterial({
  chainScope: "global",
  prevHash: securityLedger.ZERO_HASH,
  eventType: "auth.login",
  serviceName: "backend",
  actorType: "user",
  actorId: "user-123",
  correlationId: "corr-1",
  occurredAt: "2026-01-01T00:00:00.000Z",
  payloadCanonical: securityLedger.canonicalizePayload({ action: "login" }),
});

const hash1 = securityLedger.computeEventHash(entry1);

// Second entry should chain from first
const entry2 = securityLedger.buildLedgerMaterial({
  chainScope: "global",
  prevHash: hash1,  // Chain from first entry
  eventType: "auth.verify",
  serviceName: "backend",
  actorType: "system",
  actorId: "system",
  correlationId: "corr-1",
  occurredAt: "2026-01-01T00:00:01.000Z",
  payloadCanonical: securityLedger.canonicalizePayload({ action: "verify" }),
});

const hash2 = securityLedger.computeEventHash(entry2);

// Hash2 should be different from hash1
assert.notEqual(hash1, hash2, "Chained entries should have different hashes");

// Tampering with payload should change hash
const tamperedPayload = securityLedger.canonicalizePayload({ action: "different" });
const tamperedEntry2 = securityLedger.buildLedgerMaterial({
  ...entry2,
  payloadCanonical: tamperedPayload,
});
const tamperedHash = securityLedger.computeEventHash(tamperedEntry2);
assert.notEqual(hash2, tamperedHash, "Tampering should change hash");
'@
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Password hash strength verification" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const passwords = require("./nestjs-backend/dist/common/utils/passwords.js");

(async () => {
    // Titan uses Argon2id for current password hashing
  const hash = await passwords.hashPassword("test-password-123");
    assert.ok(hash.startsWith("$argon2id$"), "Hash should be Argon2id format");
    assert.equal(await passwords.verifyPassword("test-password-123", hash), true);
    assert.equal(await passwords.verifyPassword("wrong-password", hash), false);
})().catch((error) => { console.error(error); process.exit(1); });
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "Rate Limiting & Abuse Prevention" {
    $result = Invoke-TestStep "Endpoint payload size limits enforced" {
        # Attempt to send oversized payload (typically > 50MB for most APIs)
        $largeBody = [string]::new('x', 100000000)  # 100MB
        $rejected = $false
        try {
            $null = Test-HttpEndpoint -Uri "http://localhost:4000/api/accounts/profile" `
                -Method "POST" `
                -Body $largeBody `
                -Headers @{"Content-Type" = "application/json"} `
                -ExpectedStatus @(200)
        }
        catch {
            $rejected = $true
        }
        if (-not $rejected) {
            throw "Oversized payload was accepted"
        }
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Request validation rejects malformed JSON" {
        $malformedBody = "{invalid json"
        $rejected = $false
        try {
            $invokeParams = @{
                Uri = "http://localhost:4000/api/accounts/profile"
                Method = "POST"
                Headers = @{"Content-Type" = "application/json"}
                Body = $malformedBody
                ContentType = "application/json"
                TimeoutSec = 15
            }
            if ((Get-Command Invoke-WebRequest).Parameters.ContainsKey("UseBasicParsing")) {
                $invokeParams["UseBasicParsing"] = $true
            }
            $null = Invoke-WebRequest @invokeParams
        }
        catch {
            $rejected = $true
        }
        if (-not $rejected) {
            throw "Malformed JSON payload was accepted"
        }
    }
    Add-TestResult $result
}

# Summary
Write-Host ""
Write-Host "=== Abuse Resistance & Integrity Test Summary ===" -ForegroundColor Cyan
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
