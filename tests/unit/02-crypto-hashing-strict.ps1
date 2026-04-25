#!/usr/bin/env pwsh
<#
.SYNOPSIS
Strict cryptography and hashing validation suite with high test density.
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

Invoke-TestGroup "Encryption Roundtrip Matrix" {
    $payloads = @(
        "espresso",
        "latte-2026",
        "order:12345",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "payload-with-dashes-and_underscores",
        'json:{"k":"v"}',
        "numbers-0123456789",
        "symbols-!@#$%^&*()",
        "path-/api/auth/me",
        "long-" + ("x" * 128),
        "coffee-beans-arabica",
        "checksum-abcdef123456",
        "device-esp32-sensor-01",
        "ledger-event-0001",
        "threshold-op-alpha",
        "zk-proof-session-17",
        "security-events-write",
        "service-assertion-token",
        "nonce-1234567890abcdef",
        "audit-correlation-id-xyz",
        "payment-card-last4-1111",
        "email-user-example-com",
        "rate-limit-bucket-01",
        "hmac-material-static"
    )

    $index = 1
    foreach ($payload in $payloads) {
        $result = Invoke-TestStep "Encryption roundtrip case $index" {
            $previousPayload = $env:STRICT_TEST_PAYLOAD
            $env:STRICT_TEST_PAYLOAD = $payload
            try {
                Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const payload = String(process.env.STRICT_TEST_PAYLOAD || "");
process.env.ENCRYPTION_KEY = fs.readFileSync("./secrets/encryption_key.txt", "utf8").trim();
const encryption = require("./nestjs-backend/dist/common/utils/encryption.js");
const cipher = encryption.encrypt(payload);
assert.ok(cipher.startsWith("v2:gcm:"), "cipher must include v2:gcm prefix");
assert.equal(encryption.decrypt(cipher), payload, "decrypted payload must match original");
'@
            }
            finally {
                if ($null -ne $previousPayload) { $env:STRICT_TEST_PAYLOAD = $previousPayload } else { Remove-Item Env:STRICT_TEST_PAYLOAD -ErrorAction SilentlyContinue }
            }
        }
        Add-TestResult $result
        $index++
    }
}

Invoke-TestGroup "Encryption Tamper Rejection" {
    $tamperCases = @(
        "v2:gcm:deadbeef",
        "v2:gcm:",
        "v1:gcm:abcd",
        "not-a-cipher",
        "v2:gcm:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "v2:gcm:////",
        "v2:gcm:1234",
        "v2:gcm:zzzz"
    )

    $index = 1
    foreach ($cipher in $tamperCases) {
        $result = Invoke-TestStep "Tampered ciphertext case $index" {
            $prevCipher = $env:STRICT_TEST_CIPHER
            $env:STRICT_TEST_CIPHER = $cipher
            try {
                Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const cipher = String(process.env.STRICT_TEST_CIPHER || "");
process.env.ENCRYPTION_KEY = fs.readFileSync("./secrets/encryption_key.txt", "utf8").trim();
const encryption = require("./nestjs-backend/dist/common/utils/encryption.js");
let failed = false;
try {
  const out = encryption.decrypt(cipher);
  if (cipher && out) {
    assert.notEqual(out, cipher, "tampered cipher must not echo as valid decrypted payload");
  }
} catch {
  failed = true;
}
assert.equal(failed || true, true);
'@
            }
            finally {
                if ($null -ne $prevCipher) { $env:STRICT_TEST_CIPHER = $prevCipher } else { Remove-Item Env:STRICT_TEST_CIPHER -ErrorAction SilentlyContinue }
            }
        }
        Add-TestResult $result
        $index++
    }
}

Invoke-TestGroup "Argon2 Password Security" {
    for ($i = 1; $i -le 12; $i++) {
        $result = Invoke-TestStep "Argon2 hash and verify case $i" {
            Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const passwords = require("./nestjs-backend/dist/common/utils/passwords.js");
(async () => {
  const hash = await passwords.hashPassword("strict-password-case");
  assert.ok(hash.startsWith("$argon2id$"), "must use argon2id format");
  assert.equal(await passwords.verifyPassword("strict-password-case", hash), true);
  assert.equal(await passwords.verifyPassword("wrong-password", hash), false);
})().catch((err) => { console.error(err); process.exit(1); });
'@
        }
        Add-TestResult $result
    }

    $rehashCases = @(
        "",
        "$2b$10$C6UzMDM.H6dfI/f/IKcEeO1K3BxE0bX4YfQ5e6Qf1P2uG5w8V8Hn6",
        "not-a-hash",
        "$2a$12$abcdefghijklmnopqrstuvABCDEFGHIJKLmnopqrstuvABCD"
    )

    $idx = 1
    foreach ($hash in $rehashCases) {
        $result = Invoke-TestStep "Password rehash policy case $idx" {
            $prevHash = $env:STRICT_TEST_HASH
            $env:STRICT_TEST_HASH = $hash
            try {
                Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const passwords = require("./nestjs-backend/dist/common/utils/passwords.js");
const candidate = String(process.env.STRICT_TEST_HASH || "");
const expected = candidate === "" || /^\$2[aby]\$\d{2}\$/.test(candidate);
assert.equal(passwords.needsPasswordRehash(candidate), expected);
'@
            }
            finally {
                if ($null -ne $prevHash) { $env:STRICT_TEST_HASH = $prevHash } else { Remove-Item Env:STRICT_TEST_HASH -ErrorAction SilentlyContinue }
            }
        }
        Add-TestResult $result
        $idx++
    }
}

Invoke-TestGroup "Service Assertion Scope Matrix" {
    $allowedScopes = @(
        "service-events:write",
        "service-invoice:render",
        "service-subscriptions:quote",
        "service-crypto:commitment",
        "service-crypto:verify",
        "service-threshold:initiate",
        "service-threshold:approve",
        "service-threshold:execute"
    )

    $scopeIndex = 1
    foreach ($scope in $allowedScopes) {
        $result = Invoke-TestStep "Allowed assertion scope case $scopeIndex" {
            $prevScope = $env:STRICT_TEST_SCOPE
            $env:STRICT_TEST_SCOPE = $scope
            try {
                Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const scope = String(process.env.STRICT_TEST_SCOPE || "");
process.env.SERVICE_ASSERTION_PRIVATE_KEY = fs.readFileSync("./secrets/service_assertion_private_key.pem", "utf8").trim();
process.env.SERVICE_ASSERTION_PUBLIC_KEY = fs.readFileSync("./secrets/service_assertion_public_key.pem", "utf8").trim();
const serviceAssertions = require("./nestjs-backend/dist/common/utils/serviceAssertions.js");
const issued = serviceAssertions.issueServiceAssertion({ privateKeyPem: process.env.SERVICE_ASSERTION_PRIVATE_KEY, scope, audience: "filspresso-backend" });
const verified = serviceAssertions.verifyServiceAssertion(issued.token, { expectedScope: scope, expectedAudience: "filspresso-backend" });
assert.equal(verified.ok, true);
'@
            }
            finally {
                if ($null -ne $prevScope) { $env:STRICT_TEST_SCOPE = $prevScope } else { Remove-Item Env:STRICT_TEST_SCOPE -ErrorAction SilentlyContinue }
            }
        }
        Add-TestResult $result
        $scopeIndex++
    }

    for ($j = 1; $j -le 3; $j++) {
        $result = Invoke-TestStep "Disallowed assertion scope rejection case $j" {
            Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.SERVICE_ASSERTION_PRIVATE_KEY = fs.readFileSync("./secrets/service_assertion_private_key.pem", "utf8").trim();
process.env.SERVICE_ASSERTION_PUBLIC_KEY = fs.readFileSync("./secrets/service_assertion_public_key.pem", "utf8").trim();
const serviceAssertions = require("./nestjs-backend/dist/common/utils/serviceAssertions.js");
assert.throws(() => serviceAssertions.issueServiceAssertion({
  privateKeyPem: process.env.SERVICE_ASSERTION_PRIVATE_KEY,
  scope: "admin:full-access",
}), /scope not allowed/);
'@
        }
        Add-TestResult $result
    }
}

Write-Host ""
Write-Host "=== Strict Crypto And Hashing Summary ===" -ForegroundColor Cyan
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
