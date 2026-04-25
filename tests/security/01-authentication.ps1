#!/usr/bin/env pwsh
<#
.SYNOPSIS
Security tests for authentication, authorization, CSRF, headers, and CORS
#>

param(
    [string]$RepoRoot = "",
    [string]$ComposeEnvFile = "security.env.example",
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

function Test-BackendOnline {
    try {
        $null = Test-HttpEndpoint -Uri "http://localhost:4000/health" -ExpectedStatus 200 -TimeoutSec 8
        return $true
    }
    catch {
        return $false
    }
}

$backendOnline = Test-BackendOnline

Invoke-TestGroup "Execution Preconditions" {
    $result = Invoke-TestStep "Backend service is reachable for HTTP security checks" {
        if (-not $backendOnline) {
            throw "Backend is not reachable on http://localhost:4000. Start docker/services before interpreting HTTP security failures."
        }
    }
    Add-TestResult $result
}

Invoke-TestGroup "Authentication & Authorization" {
    $result = Invoke-TestStep "Missing auth token rejected" {
        try {
            Test-HttpEndpoint -Uri "http://localhost:4000/api/accounts/profile" -ExpectedStatus 401
            throw "Should have failed with 401"
        }
        catch {
            if ($_ -match "401") {
                return
            }
            throw $_
        }
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Invalid auth token rejected" {
        $invalidToken = "Bearer invalid.token.here"
        try {
            Test-HttpEndpoint -Uri "http://localhost:4000/api/accounts/profile" `
                -Headers @{"Authorization" = $invalidToken} `
                -ExpectedStatus 401
            throw "Should have failed with 401"
        }
        catch {
            if ($_ -match "401") {
                return
            }
            throw $_
        }
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Expired token rejected" {
        $expiredToken = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjB9.test"
        try {
            Test-HttpEndpoint -Uri "http://localhost:4000/api/accounts/profile" `
                -Headers @{"Authorization" = $expiredToken} `
                -ExpectedStatus 401
            throw "Should have failed with 401"
        }
        catch {
            if ($_ -match "401") {
                return
            }
            throw $_
        }
    }
    Add-TestResult $result
}

Invoke-TestGroup "Admin Access Control" {
    $result = Invoke-TestStep "Admin endpoints require authentication" {
        try {
            Test-HttpEndpoint -Uri "http://localhost:4000/api/admin/users" -ExpectedStatus 401
            throw "Should have failed with 401"
        }
        catch {
            if ($_ -match "401") {
                return
            }
            throw $_
        }
    }
    Add-TestResult $result

    $result = Invoke-TestStep "Admin extra path not found" {
        try {
            Test-HttpEndpoint -Uri "http://localhost:4000/api/admin/extra/path" -ExpectedStatus 404
            throw "Should have failed with 404"
        }
        catch {
            if ($_ -match "404") {
                return
            }
            throw $_
        }
    }
    Add-TestResult $result
}

Invoke-TestGroup "Security Headers" {
    $result = Invoke-TestStep "Security headers present" {
        $response = Test-HttpEndpoint -Uri "http://localhost:4000/health" -ExpectedStatus 200

        $requiredHeaders = @(
            "X-Content-Type-Options",
            "X-Frame-Options",
            "Strict-Transport-Security",
            "Content-Security-Policy"
        )

        foreach ($header in $requiredHeaders) {
            if (-not $response.Headers[$header]) {
                throw "Missing security header: $header"
            }
        }
    }
    Add-TestResult $result

    $result = Invoke-TestStep "CORS origin policy validation" {
        Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const corsUtils = require("./nestjs-backend/dist/common/utils/cors-origin.js");

const configured = corsUtils.parseConfiguredOrigins("http://localhost:3000,https://filspresso.app");
assert.equal(corsUtils.isAllowedCorsOrigin("http://localhost:3000", configured, false), true);
assert.equal(corsUtils.isAllowedCorsOrigin("https://filspresso.app", configured, true), true);
assert.equal(corsUtils.isAllowedCorsOrigin("http://evil.local", configured, true), false);
assert.equal(corsUtils.isAllowedCorsOrigin("http://127.0.0.1:3001", configured, false), true);
'@
    }
    Add-TestResult $result
}

Invoke-TestGroup "CSRF Protection" {
        $result = Invoke-TestStep "Origin guard blocks cross-site cookie-authenticated writes" {
                Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
process.env.CORS_ORIGIN = "http://localhost:3000";
process.env.CSRF_REQUIRE_ORIGIN_FOR_COOKIE = "true";
process.env.CSRF_ENFORCE_FETCH_METADATA = "true";
const { originGuardMiddleware } = require("./nestjs-backend/dist/common/middleware/origin-guard.middleware.js");

const req = {
    method: "POST",
    headers: {
        cookie: "sid=abc",
        "sec-fetch-site": "cross-site",
        origin: "http://evil.local"
    },
    path: "/api/auth/change-password",
    requestId: "req_test_1",
    ip: "127.0.0.1"
};

const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
};

let nextCalled = false;
originGuardMiddleware(req, res, () => { nextCalled = true; });

assert.equal(nextCalled, false);
assert.equal(res.statusCode, 403);
assert.equal(String(res.body?.error || ""), "Origin check failed");
'@
        }
        Add-TestResult $result

        $result = Invoke-TestStep "Origin guard blocks missing Origin/Referer for cookie write" {
                Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
process.env.CORS_ORIGIN = "http://localhost:3000";
process.env.CSRF_REQUIRE_ORIGIN_FOR_COOKIE = "true";
process.env.CSRF_ENFORCE_FETCH_METADATA = "false";
const { originGuardMiddleware } = require("./nestjs-backend/dist/common/middleware/origin-guard.middleware.js");

const req = {
    method: "PUT",
    headers: {
        cookie: "sid=abc"
    },
    path: "/api/accounts/1",
    requestId: "req_test_2",
    ip: "127.0.0.1"
};

const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
};

let nextCalled = false;
originGuardMiddleware(req, res, () => { nextCalled = true; });

assert.equal(nextCalled, false);
assert.equal(res.statusCode, 403);
assert.match(String(res.body?.reason || ""), /Missing Origin\/Referer/);
'@
        }
        Add-TestResult $result

        $result = Invoke-TestStep "Origin guard allows trusted same-origin cookie write" {
                Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
process.env.CORS_ORIGIN = "http://localhost:3000,https://filspresso.app";
process.env.CSRF_REQUIRE_ORIGIN_FOR_COOKIE = "true";
process.env.CSRF_ENFORCE_FETCH_METADATA = "true";
const { originGuardMiddleware } = require("./nestjs-backend/dist/common/middleware/origin-guard.middleware.js");

const req = {
    method: "POST",
    headers: {
        cookie: "sid=abc",
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin"
    },
    path: "/api/cart",
    requestId: "req_test_3",
    ip: "127.0.0.1"
};

const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
};

let nextCalled = false;
originGuardMiddleware(req, res, () => { nextCalled = true; });

assert.equal(nextCalled, true);
assert.equal(res.statusCode, 200);
'@
        }
        Add-TestResult $result
}

Invoke-TestGroup "Guard & Request Identity Hardening" {
        $result = Invoke-TestStep "Request ID middleware sanitizes attacker-controlled header" {
                Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
const { requestIdMiddleware } = require("./nestjs-backend/dist/common/middleware/request-id.middleware.js");

const req = {
    headers: {
        "x-request-id": "../../../etc/passwd<script>alert(1)</script>"
    }
};

const resHeaders = {};
const res = {
    setHeader(key, value) { resHeaders[String(key).toLowerCase()] = String(value); }
};

let nextCalled = false;
requestIdMiddleware(req, res, () => { nextCalled = true; });

assert.equal(nextCalled, true);
assert.ok(req.requestId);
assert.match(req.requestId, /^[A-Za-z0-9_-]{1,64}$/);
assert.equal(resHeaders["x-request-id"], req.requestId);
'@
        }
        Add-TestResult $result

        $result = Invoke-TestStep "JWT auth guard rejects malformed bearer tokens" {
                Invoke-NodeCode -WorkingDirectory $RepoRoot -Code @'
const assert = require("node:assert/strict");
process.env.JWT_SECRET = "titan-local-jwt-secret";
const { JwtAuthGuard } = require("./nestjs-backend/dist/common/guards/jwt-auth.guard.js");

const guard = new JwtAuthGuard();

const request = {
    headers: {
        authorization: "Bearer not.a.valid.token"
    }
};

const context = {
    switchToHttp() {
        return {
            getRequest() {
                return request;
            }
        };
    }
};

let thrown = null;
try {
    guard.canActivate(context);
} catch (error) {
    thrown = error;
}

assert.ok(thrown, "Guard should throw for malformed token");
assert.equal(thrown?.status, 401);
assert.equal(String(thrown?.response?.error || ""), "Invalid or expired token");
'@
    }
    Add-TestResult $result
}

# Summary
Write-Host ""
Write-Host "=== Security Test Summary ===" -ForegroundColor Cyan
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
