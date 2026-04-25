#!/usr/bin/env pwsh
<#
.SYNOPSIS
Strict architecture checks for ZK, threshold, MPC, and replay guard wiring.
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

$cryptoControllerPath = Join-Path $RepoRoot "nestjs-backend/src/crypto/crypto.controller.ts"
$cryptoServicePath = Join-Path $RepoRoot "nestjs-backend/src/crypto/crypto.service.ts"
$replayGuardPath = Join-Path $RepoRoot "nestjs-backend/src/common/utils/replayGuard.ts"
$keyUsagePath = Join-Path $RepoRoot "nestjs-backend/src/common/utils/keyUsagePolicy.ts"
$contractsPath = Join-Path $RepoRoot "nestjs-backend/src/common/utils/serviceContracts.ts"

$cryptoController = Get-Content -Path $cryptoControllerPath -Raw
$cryptoService = Get-Content -Path $cryptoServicePath -Raw
$replayGuard = Get-Content -Path $replayGuardPath -Raw
$keyUsage = Get-Content -Path $keyUsagePath -Raw
$contracts = Get-Content -Path $contractsPath -Raw

Invoke-TestGroup "Crypto Controller Endpoint Coverage" {
    $controllerPatterns = @(
        '@Post("commitment")',
        '@Post("verify")',
        '@Post("threshold/operations")',
        '@Post("threshold/operations/:id/approve")',
        '@Post("threshold/operations/:id/execute")',
        '@Get("threshold/operations/:id")',
        '@Post("zk/circuits/register")',
        '@Post("zk/circuits/:id/status")',
        '@Post("zk/proofs/generate")',
        '@Post("zk/proofs/:id/verify")',
        '@Get("zk/proofs/:id")',
        '@Post("mpc/sessions")',
        '@Post("mpc/sessions/:id/sign")',
        '@Post("mpc/sessions/:id/finalize")',
        '@Get("mpc/sessions/:id")',
        '@UseReplayGuard("crypto-commitment", 900)',
        '@UseReplayGuard("crypto-verify", 900)',
        '@UseReplayGuard("zk-proof-generate", 1800)',
        '@UseReplayGuard("zk-proof-verify", 1800)',
        '@UseReplayGuard("mpc-session-sign", 3600)'
    )

    $index = 1
    foreach ($pattern in $controllerPatterns) {
        $result = Invoke-TestStep "Controller contract check $index" {
            if ($cryptoController -notmatch [regex]::Escape($pattern)) {
                throw "Missing controller pattern: $pattern"
            }
        }
        Add-TestResult $result
        $index++
    }
}

Invoke-TestGroup "Crypto Service ZK And MPC Methods" {
    $servicePatterns = @(
        'async registerZkCircuit',
        'async updateZkCircuitStatus',
        'async generateZkProof',
        'async verifyZkProof',
        'async getZkProof',
        'async createMpcSession',
        'async signMpcSession',
        'async finalizeMpcSession',
        'async getMpcSession',
        'async createThresholdOperation',
        'async approveThresholdOperation',
        'async executeThresholdOperation',
        'buildProofHash',
        'ZK_MAX_WITNESS_BYTES',
        'MPC_TRANSCRIPT_RATE_LIMIT_PER_MINUTE',
        'THRESHOLD_DEFAULT_APPROVALS',
        'securityLedger.appendSecurityLedgerEvent',
        'serviceContracts.assertServiceContract("rust_commitment_request_v1"',
        'serviceContracts.assertServiceContract("rust_commitment_response_v1"',
        'serviceContracts.assertServiceContract("rust_verify_request_v1"',
        'serviceContracts.assertServiceContract("rust_verify_response_v1"'
    )

    $index = 1
    foreach ($pattern in $servicePatterns) {
        $result = Invoke-TestStep "Service contract check $index" {
            if ($cryptoService -notmatch [regex]::Escape($pattern)) {
                throw "Missing service pattern: $pattern"
            }
        }
        Add-TestResult $result
        $index++
    }
}

Invoke-TestGroup "Replay Guard And Key Policy Hardening" {
    $replayPatterns = @(
        'DEFAULT_REPLAY_TTL_SECONDS',
        'OPERATION_ID_PATTERN',
        'normalizeOperationId',
        'extractOperationId',
        'reserveReplayOperation',
        'replay_detected',
        'invalid_operation_id',
        'operation_scope'
    )

    $index = 1
    foreach ($pattern in $replayPatterns) {
        $result = Invoke-TestStep "Replay guard check $index" {
            if ($replayGuard -notmatch [regex]::Escape($pattern)) {
                throw "Missing replay guard pattern: $pattern"
            }
        }
        Add-TestResult $result
        $index++
    }

    $policyPatterns = @(
        'service_assertion_signing',
        'user_identity_signing',
        'service-events:write',
        'service-invoice:render',
        'service-subscriptions:quote',
        'service-crypto:commitment',
        'service-crypto:verify',
        'service-threshold:initiate',
        'service-threshold:approve',
        'service-threshold:execute',
        'assertKeyUsage',
        'scope not allowed',
        'operation not allowed'
    )

    $policyIndex = 1
    foreach ($pattern in $policyPatterns) {
        $result = Invoke-TestStep "Key policy check $policyIndex" {
            if ($keyUsage -notmatch [regex]::Escape($pattern)) {
                throw "Missing key usage pattern: $pattern"
            }
        }
        Add-TestResult $result
        $policyIndex++
    }
}

Invoke-TestGroup "Service Contract Registry Coverage" {
    $contractPatterns = @(
        'go_ops_event_ingest_v1',
        'kotlin_quote_request_v1',
        'kotlin_quote_response_v1',
        'rust_commitment_request_v1',
        'rust_commitment_response_v1',
        'rust_verify_request_v1',
        'rust_verify_response_v1',
        'invoice_render_request_v1'
    )

    $index = 1
    foreach ($pattern in $contractPatterns) {
        $result = Invoke-TestStep "Service contract registry check $index" {
            if ($contracts -notmatch [regex]::Escape($pattern)) {
                throw "Missing service contract schema: $pattern"
            }
        }
        Add-TestResult $result
        $index++
    }
}

Write-Host ""
Write-Host "=== Strict ZK Architecture Summary ===" -ForegroundColor Cyan
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
