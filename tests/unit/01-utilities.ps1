#!/usr/bin/env pwsh
<#
.SYNOPSIS
Utility unit tests for encryption, authentication, service contracts, and security
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

Invoke-TestGroup "Crypto Utility: Encryption" {
    # Roundtrip encryption/decryption
    $result = Invoke-TestStep "Encrypt/decrypt roundtrip" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.ENCRYPTION_KEY = fs.readFileSync("./secrets/encryption_key.txt", "utf8").trim();
const encryption = require("./nestjs-backend/dist/common/utils/encryption.js");
const cipher = encryption.encrypt("espresso-2026");
assert.ok(cipher.startsWith("v2:gcm:"));
assert.equal(encryption.decrypt(cipher), "espresso-2026");
'@
    }
    Add-TestResult $result

    # Empty payload handling
    $result = Invoke-TestStep "Empty payload encryption" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.ENCRYPTION_KEY = fs.readFileSync("./secrets/encryption_key.txt", "utf8").trim();
const encryption = require("./nestjs-backend/dist/common/utils/encryption.js");
assert.equal(encryption.encrypt(""), "");
assert.equal(encryption.decrypt(""), "");
'@
    }
    Add-TestResult $result

    # Card helpers (PAN masking, type detection)
    $result = Invoke-TestStep "Card utility helpers" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.ENCRYPTION_KEY = fs.readFileSync("./secrets/encryption_key.txt", "utf8").trim();
const encryption = require("./nestjs-backend/dist/common/utils/encryption.js");
assert.equal(encryption.getLastFour("4111 1111 1111 1111"), "1111");
assert.equal(encryption.detectCardType("4111111111111111"), "visa");
assert.equal(encryption.detectCardType("5555555555554444"), "mastercard");
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "Password Utility: Hashing & Verification" {
    # Bcrypt hashing and verification
    $result = Invoke-TestStep "Hash and verify password" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const passwords = require("./nestjs-backend/dist/common/utils/passwords.js");
(async () => {
  const hash = await passwords.hashPassword("espresso-pass");
  assert.equal(await passwords.verifyPassword("espresso-pass", hash), true);
  assert.equal(await passwords.verifyPassword("wrong-pass", hash), false);
})().catch((error) => { console.error(error); process.exit(1); });
'@
    }
    Add-TestResult $result

    # Rehash detection
    $result = Invoke-TestStep "Detect password rehash requirement" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const passwords = require("./nestjs-backend/dist/common/utils/passwords.js");
assert.equal(passwords.needsPasswordRehash("$2b$10$C6UzMDM.H6dfI/f/IKcEeO1K3BxE0bX4YfQ5e6Qf1P2uG5w8V8Hn6"), true);
assert.equal(passwords.needsPasswordRehash(""), true);
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "JWT Utility: Token Generation & Verification" {
    # Token roundtrip
    $result = Invoke-TestStep "Generate and verify JWT token" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
process.env.JWT_SECRET = "titan-local-jwt-secret";
const authTokens = require("./nestjs-backend/dist/common/utils/auth-tokens.js");
const token = authTokens.generateToken({ id: 7, username: "tester", email: "tester@example.com" });
const decoded = authTokens.verifyToken(token);
assert.ok(decoded);
assert.equal(String(decoded.id), "7");
assert.equal(decoded.email, "tester@example.com");
'@
    }
    Add-TestResult $result

    # Tamper rejection
    $result = Invoke-TestStep "Reject tampered JWT tokens" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
process.env.JWT_SECRET = "titan-local-jwt-secret";
const authTokens = require("./nestjs-backend/dist/common/utils/auth-tokens.js");
const token = authTokens.generateToken({ id: 8, username: "tester2", email: "tester2@example.com" });
const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
assert.equal(authTokens.verifyToken(tampered), null);
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "Service Assertion: Ed25519 Tokens" {
    # Issue and verify
    $result = Invoke-TestStep "Issue and verify service assertion" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.SERVICE_ASSERTION_PRIVATE_KEY = fs.readFileSync("./secrets/service_assertion_private_key.pem", "utf8").trim();
process.env.SERVICE_ASSERTION_PUBLIC_KEY = fs.readFileSync("./secrets/service_assertion_public_key.pem", "utf8").trim();
const serviceAssertions = require("./nestjs-backend/dist/common/utils/serviceAssertions.js");
const issued = serviceAssertions.issueServiceAssertion({
  privateKeyPem: process.env.SERVICE_ASSERTION_PRIVATE_KEY,
  issuer: "filspresso-service",
  subject: "service-events-client",
  audience: "filspresso-service-events",
  scope: "service-events:write",
});
const verified = serviceAssertions.verifyServiceAssertion(issued.token, {
  expectedScope: "service-events:write",
  expectedAudience: "filspresso-service-events",
});
assert.equal(verified.ok, true);
'@
    }
    Add-TestResult $result

    # Scope rejection
    $result = Invoke-TestStep "Reject assertion with wrong scope" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.SERVICE_ASSERTION_PRIVATE_KEY = fs.readFileSync("./secrets/service_assertion_private_key.pem", "utf8").trim();
process.env.SERVICE_ASSERTION_PUBLIC_KEY = fs.readFileSync("./secrets/service_assertion_public_key.pem", "utf8").trim();
const serviceAssertions = require("./nestjs-backend/dist/common/utils/serviceAssertions.js");
const issued = serviceAssertions.issueServiceAssertion({ privateKeyPem: process.env.SERVICE_ASSERTION_PRIVATE_KEY, scope: "service-events:write" });
const verified = serviceAssertions.verifyServiceAssertion(issued.token, { expectedScope: "service-events:read" });
assert.equal(verified.ok, false);
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "Service Contracts: Payload Validation" {
    # Invoice contract
    $result = Invoke-TestStep "Validate invoice contract payload" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const serviceContracts = require("./nestjs-backend/dist/common/utils/serviceContracts.js");
const validPayload = {
    invoiceNumber: "INV-2026-001",
    orderNumber: "ORD-2026-001",
  items: [
    { name: "Coffee", quantity: 2, unitPrice: 3.5, totalPrice: 7 },
  ],
};
assert.equal(serviceContracts.assertServiceContract("invoice_render_request_v1", validPayload), true);
'@
    }
    Add-TestResult $result

    # Contract rejection
    $result = Invoke-TestStep "Reject invalid contract payload" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const serviceContracts = require("./nestjs-backend/dist/common/utils/serviceContracts.js");
assert.throws(() => serviceContracts.assertServiceContract("invoice_render_request_v1", { invoiceId: "bad" }));
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "Security Ledger: Immutability & Chaining" {
    # Canonicalization
    $result = Invoke-TestStep "Canonicalize ledger payloads" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const securityLedger = require("./nestjs-backend/dist/common/utils/securityLedger.js");
const left = securityLedger.canonicalizePayload({ b: 2, a: 1, nested: { z: 9, y: 8 } });
const right = securityLedger.canonicalizePayload({ nested: { y: 8, z: 9 }, a: 1, b: 2 });
assert.equal(left, right);
'@
    }
    Add-TestResult $result

    # Hash stability
    $result = Invoke-TestStep "Ledger hash stability and consistency" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const securityLedger = require("./nestjs-backend/dist/common/utils/securityLedger.js");
const material = securityLedger.buildLedgerMaterial({
  chainScope: "global",
  prevHash: securityLedger.ZERO_HASH,
  eventType: "audit.event",
  serviceName: "backend",
  actorType: "service",
  actorId: "service-events-client",
  correlationId: "corr-123",
  occurredAt: "2026-01-01T00:00:00.000Z",
  payloadCanonical: securityLedger.canonicalizePayload({ action: "verify" }),
});
assert.equal(securityLedger.computeEventHash(material), securityLedger.computeEventHash(material));
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "Replay Guard: Operation Normalization" {
    # Operation ID normalization
    $result = Invoke-TestStep "Normalize operation IDs" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const replayGuard = require("./nestjs-backend/dist/common/utils/replayGuard.js");
assert.equal(replayGuard.normalizeOperationId("operation_ABC-123_2026"), "operation_ABC-123_2026");
assert.equal(replayGuard.normalizeOperationId("bad id"), "");
'@
    }
    Add-TestResult $result
}

# Summary
Write-Host ""
Write-Host "=== Unit Test Summary ===" -ForegroundColor Cyan
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
