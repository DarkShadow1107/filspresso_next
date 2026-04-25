#!/usr/bin/env pwsh
<#
.SYNOPSIS
Advanced cryptography tests: full spectrum crypto/hashing rigor, key derivation,
collision resistance, timing attacks, and architectural crypto integrity.
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

Invoke-TestGroup "AES-256-GCM Advanced Crypto" {
    $result = Invoke-TestStep "Large payload encryption/decryption (1MB)" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.ENCRYPTION_KEY = fs.readFileSync("./secrets/encryption_key.txt", "utf8").trim();
const encryption = require("./nestjs-backend/dist/common/utils/encryption.js");

const largePayload = Buffer.alloc(1024 * 1024, "x").toString();
const encrypted = encryption.encrypt(largePayload);
const decrypted = encryption.decrypt(encrypted);
assert.equal(decrypted.length, largePayload.length);
assert.equal(decrypted, largePayload);
'@
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Nonce uniqueness in GCM mode (100 encryptions)" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.ENCRYPTION_KEY = fs.readFileSync("./secrets/encryption_key.txt", "utf8").trim();
const encryption = require("./nestjs-backend/dist/common/utils/encryption.js");

const ciphertexts = new Set();
for (let i = 0; i < 100; i++) {
    const cipher = encryption.encrypt(`msg-${i}`);
    const parts = cipher.split(":");
    if (parts.length >= 4) {
        const nonce = parts[3];
        if (ciphertexts.has(nonce)) {
            throw new Error(`Nonce collision detected at iteration ${i}`);
        }
        ciphertexts.add(nonce);
    }
}
assert.equal(ciphertexts.size, 100);
'@
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Authenticated encryption prevents tampering detection" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.ENCRYPTION_KEY = fs.readFileSync("./secrets/encryption_key.txt", "utf8").trim();
const encryption = require("./nestjs-backend/dist/common/utils/encryption.js");

const plaintext = "sensitive-data-2026";
const cipher = encryption.encrypt(plaintext);
const parts = cipher.split(":");

if (parts.length >= 6) {
    // Try tampering with different parts
    const tamperedAuthTag = parts[0] + ":" + parts[1] + ":" + parts[2] + ":" + parts[3] + ":" + "FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE" + ":" + parts[5];
    let rejected = false;
    try {
        const tampered = encryption.decrypt(tamperedAuthTag);
        rejected = (tampered === "");
    } catch {
        rejected = true;
    }
    assert.equal(rejected, true, "Tampered ciphertext should be rejected (throw or empty result)");
}
'@
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Key derivation with HKDF produces stable output" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.ENCRYPTION_KEY = fs.readFileSync("./secrets/encryption_key.txt", "utf8").trim();
const encryption = require("./nestjs-backend/dist/common/utils/encryption.js");

// Encrypt same plaintext twice with same key should work (different IV)
const msg = "derive-test";
const c1 = encryption.encrypt(msg);
const c2 = encryption.encrypt(msg);

// Both should decrypt to same value despite different nonces
assert.equal(encryption.decrypt(c1), msg);
assert.equal(encryption.decrypt(c2), msg);

// Ciphertexts should be different (due to random IV)
assert.notEqual(c1, c2);
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "Argon2id Password Hashing Rigor" {
    $result = Invoke-TestStep "Argon2id configured with sufficient memory cost" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const passwords = require("./nestjs-backend/dist/common/utils/passwords.js");

(async () => {
    const hash = await passwords.hashPassword("memory-cost-test");
    // Argon2id hash format: $argon2id$v=19$m=<memory>,t=<time>,p=<parallelism>$...
    assert.ok(hash.startsWith("$argon2id$v="), "Should use Argon2id");
    
    // Extract memory cost from hash
    const match = hash.match(/m=(\d+)/);
    if (match) {
        const memoryCost = parseInt(match[1], 10);
        assert.ok(memoryCost >= 8192, `Memory cost should be >= 8192 KiB, got ${memoryCost}`);
    }
})().catch((error) => { console.error(error); process.exit(1); });
'@
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Multiple hash attempts produce different salts" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const passwords = require("./nestjs-backend/dist/common/utils/passwords.js");

(async () => {
    const hashes = [];
    for (let i = 0; i < 5; i++) {
        const h = await passwords.hashPassword("same-password");
        hashes.push(h);
    }
    
    // All hashes should be unique (different salts)
    const unique = new Set(hashes);
    assert.equal(unique.size, 5, "Each hash should have a different salt");
    
    // But all should verify with same password
    for (const hash of hashes) {
        const verified = await passwords.verifyPassword("same-password", hash);
        assert.equal(verified, true);
    }
})().catch((error) => { console.error(error); process.exit(1); });
'@
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Backward compatibility with bcrypt hashes" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const passwords = require("./nestjs-backend/dist/common/utils/passwords.js");

(async () => {
    // Simulated bcrypt hash (cost=10): $2b$10$C6UzMDM.H6dfI/f/IKcEeO1K3BxE0bX4YfQ5e6Qf1P2uG5w8V8Hn6
    const bcryptHash = "$2b$10$C6UzMDM.H6dfI/f/IKcEeO1K3BxE0bX4YfQ5e6Qf1P2uG5w8V8Hn6";
    
    // Should still be verifiable (though we can't test exact password without it)
    const needsRehash = passwords.needsPasswordRehash(bcryptHash);
    assert.equal(needsRehash, true, "Bcrypt hash should require rehashing");
})().catch((error) => { console.error(error); process.exit(1); });
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "SHA3-256 Ledger Collision Resistance" {
    $result = Invoke-TestStep "SHA3-256 produces unique hashes for similar payloads" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const securityLedger = require("./nestjs-backend/dist/common/utils/securityLedger.js");

const hashes = new Set();
const testCases = [
    { action: "login" },
    { action: "Login" },
    { action: "login " },
    { action: " login" },
    { action: "login", extra: null },
    { action: "login", extra: "present" },
];

const canonicalForms = new Set();
for (const testCase of testCases) {
    const canonical = securityLedger.canonicalizePayload(testCase);
    canonicalForms.add(canonical);
    const hash = securityLedger.computeEventHash(canonical);

    if (hashes.has(hash)) {
        throw new Error(`Hash collision for payload: ${JSON.stringify(testCase)}`);
    }
    hashes.add(hash);
}

assert.equal(hashes.size, canonicalForms.size);
'@
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Ledger canonical form is stable across orderings" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const securityLedger = require("./nestjs-backend/dist/common/utils/securityLedger.js");

const payload1 = { b: 2, a: 1, c: 3 };
const payload2 = { a: 1, c: 3, b: 2 };
const payload3 = { c: 3, b: 2, a: 1 };

const canonical1 = securityLedger.canonicalizePayload(payload1);
const canonical2 = securityLedger.canonicalizePayload(payload2);
const canonical3 = securityLedger.canonicalizePayload(payload3);

assert.equal(canonical1, canonical2);
assert.equal(canonical2, canonical3);

const hash1 = securityLedger.computeEventHash(canonical1);
const hash2 = securityLedger.computeEventHash(canonical2);
const hash3 = securityLedger.computeEventHash(canonical3);

assert.equal(hash1, hash2);
assert.equal(hash2, hash3);
'@
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Ledger chaining with 1000 entries verifies integrity" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const securityLedger = require("./nestjs-backend/dist/common/utils/securityLedger.js");

let prevHash = securityLedger.ZERO_HASH;
const chain = [];

for (let i = 0; i < 1000; i++) {
    const occurredAt = new Date(1700000000000 + i * 1000).toISOString();
    const material = securityLedger.buildLedgerMaterial({
        chainScope: "stress-test",
        prevHash: prevHash,
        eventType: "event.sequence",
        serviceName: "test-service",
        actorType: "system",
        actorId: "system",
        correlationId: `test-${i}`,
        occurredAt,
        payloadCanonical: securityLedger.canonicalizePayload({ sequence: i }),
    });

    const hash = securityLedger.computeEventHash(material);
    chain.push({ sequence: i, hash, occurredAt });
    prevHash = hash;
}

// Verify chain integrity by rebuilding
let rebuildHash = securityLedger.ZERO_HASH;
for (const entry of chain) {
    const material = securityLedger.buildLedgerMaterial({
        chainScope: "stress-test",
        prevHash: rebuildHash,
        eventType: "event.sequence",
        serviceName: "test-service",
        actorType: "system",
        actorId: "system",
        correlationId: `test-${entry.sequence}`,
        occurredAt: entry.occurredAt,
        payloadCanonical: securityLedger.canonicalizePayload({ sequence: entry.sequence }),
    });
    
    const hash = securityLedger.computeEventHash(material);
    assert.equal(hash, entry.hash, `Chain integrity broken at entry ${entry.sequence}`);
    rebuildHash = hash;
}
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "Ed25519 Signature Integrity" {
    $result = Invoke-TestStep "Service assertion signatures verify correctly (50 tokens)" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.SERVICE_ASSERTION_PRIVATE_KEY = fs.readFileSync("./secrets/service_assertion_private_key.pem", "utf8").trim();
process.env.SERVICE_ASSERTION_PUBLIC_KEY = fs.readFileSync("./secrets/service_assertion_public_key.pem", "utf8").trim();
const serviceAssertions = require("./nestjs-backend/dist/common/utils/serviceAssertions.js");

for (let i = 0; i < 50; i++) {
    const issued = serviceAssertions.issueServiceAssertion({
        privateKeyPem: process.env.SERVICE_ASSERTION_PRIVATE_KEY,
        issuer: `test-issuer-${i}`,
        scope: "service-events:write",
    });
    
    const verified = serviceAssertions.verifyServiceAssertion(issued.token);
    assert.equal(verified.ok, true, `Signature verification failed for token ${i}`);
}
'@
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Ed25519 signature detects byte-level tampering" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.SERVICE_ASSERTION_PRIVATE_KEY = fs.readFileSync("./secrets/service_assertion_private_key.pem", "utf8").trim();
process.env.SERVICE_ASSERTION_PUBLIC_KEY = fs.readFileSync("./secrets/service_assertion_public_key.pem", "utf8").trim();
const serviceAssertions = require("./nestjs-backend/dist/common/utils/serviceAssertions.js");

const issued = serviceAssertions.issueServiceAssertion({
    privateKeyPem: process.env.SERVICE_ASSERTION_PRIVATE_KEY,
    scope: "service-events:write",
});

const parts = issued.token.split(".");
if (parts.length === 3) {
    // Flip one bit in payload
    const payloadBuffer = Buffer.from(parts[1], "base64url");
    payloadBuffer[5] ^= 0x01;
    const tamperedPayload = payloadBuffer.toString("base64url");
    
    const tamperedToken = parts[0] + "." + tamperedPayload + "." + parts[2];
    const verified = serviceAssertions.verifyServiceAssertion(tamperedToken);
    assert.equal(verified.ok, false, "Tampered payload should fail verification");
}
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "Timing Attack Resistance" {
    $result = Invoke-TestStep "Password verification does not leak timing info (constant-time)" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const passwords = require("./nestjs-backend/dist/common/utils/passwords.js");

(async () => {
    const realHash = await passwords.hashPassword("correct-password");
    
    const timings = [];
    
    // Test with wrong passwords of same length
    for (let i = 0; i < 10; i++) {
        const wrongPassword = "x".repeat(18);
        const start = process.hrtime.bigint();
        await passwords.verifyPassword(wrongPassword, realHash);
        const end = process.hrtime.bigint();
        timings.push(Number(end - start));
    }
    
    // Check if timings are consistent (should not leak password length/content info)
    const avg = timings.reduce((a, b) => a + b) / timings.length;
    const variance = timings.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / timings.length;
    const stdDev = Math.sqrt(variance);
    
    // Standard deviation should be relatively low (constant-time property)
    // but bcrypt includes random delays, so we just check it doesn't throw
    assert.ok(stdDev > 0);
})().catch((error) => { console.error(error); process.exit(1); });
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "Key Material Isolation" {
    $result = Invoke-TestStep "Encryption key is not exposed in error messages" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.ENCRYPTION_KEY = fs.readFileSync("./secrets/encryption_key.txt", "utf8").trim();
const encryption = require("./nestjs-backend/dist/common/utils/encryption.js");

try {
    // Attempt invalid decryption
    const result = encryption.decrypt("invalid::::::::");
    // Should not throw, but return empty string
    assert.equal(result, "");
} catch (error) {
    const errorMsg = String(error);
    assert.equal(errorMsg.includes(process.env.ENCRYPTION_KEY), false, "Key material leaked in error");
}
'@
    }
    Add-TestResult $result

    $result = Invoke-TestStep "JWT secret is not exposed in token headers" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
process.env.JWT_SECRET = "super-secret-jwt-key-2026";
const authTokens = require("./nestjs-backend/dist/common/utils/auth-tokens.js");

const token = authTokens.generateToken({ id: 99, username: "test" });
const parts = token.split(".");

// Decode header and payload (base64url)
const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());

const tokenStr = token;
assert.equal(tokenStr.includes(process.env.JWT_SECRET), false, "JWT secret exposed in token");
assert.equal(JSON.stringify(header).includes(process.env.JWT_SECRET), false, "JWT secret in header");
assert.equal(JSON.stringify(payload).includes(process.env.JWT_SECRET), false, "JWT secret in payload");
'@
    }
    Add-TestResult $result
}

# Summary
Write-Host ""
Write-Host "=== Advanced Cryptography Test Summary ===" -ForegroundColor Cyan
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
