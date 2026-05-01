# Shared test utilities for Titan test suite

function Invoke-TestGroup {
    param(
        [string]$GroupName,
        [scriptblock]$Action
    )

    Write-Host ""
    Write-Host "=== $GroupName ===" -ForegroundColor Cyan
    & $Action
}

function Invoke-TestStep {
    param(
        [string]$TestName,
        [scriptblock]$Action,
        [switch]$Optional
    )

    try {
        & $Action
        Write-Host "[PASS] $TestName" -ForegroundColor Green
        return @{ Name = $TestName; Status = "PASS"; Details = "ok" }
    }
    catch {
        $message = $_.Exception.Message
        if ($Optional) {
            Write-Host "[SKIP] $TestName - $message" -ForegroundColor Yellow
            return @{ Name = $TestName; Status = "SKIP"; Details = $message }
        }
        Write-Host "[FAIL] $TestName - $message" -ForegroundColor Red
        return @{ Name = $TestName; Status = "FAIL"; Details = $message }
    }
}

function Invoke-CmdShell {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

function Test-HttpEndpoint {
    param(
        [string]$Uri,
        [hashtable]$Headers = @{},
        [string]$Method = "GET",
        [object]$Body = $null,
        [int[]]$ExpectedStatus = @(200),
        [int]$TimeoutSec = 15,
        [int]$MaxRetries = 4,
        [int]$RetryDelaySec = 2
    )

    $attempt = 0
    $lastError = $null

    while ($attempt -lt $MaxRetries) {
        $attempt++
        $invokeParams = @{
            Uri = $Uri
            Method = $Method
            Headers = $Headers
            TimeoutSec = $TimeoutSec
        }
        if ($null -ne $Body) {
            $invokeParams["Body"] = $Body
            $invokeParams["ContentType"] = "application/json"
        }
        if ((Get-Command Invoke-WebRequest).Parameters.ContainsKey("UseBasicParsing")) {
            $invokeParams["UseBasicParsing"] = $true
        }

        try {
            $response = Invoke-WebRequest @invokeParams
            $statusCode = [int]$response.StatusCode
            if ($ExpectedStatus -notcontains $statusCode) {
                throw "Expected status $ExpectedStatus but got $statusCode"
            }
            return $response
        }
        catch {
            $lastError = $_
            $exception = $_.Exception
            $hasResponse =
                $null -ne $exception -and
                $exception.PSObject.Properties.Match("Response").Count -gt 0 -and
                $null -ne $exception.Response

            if ($hasResponse) {
                $statusCode = [int]$exception.Response.StatusCode
                if ($ExpectedStatus -contains $statusCode) {
                    return $exception.Response
                }
            }

            if ($attempt -lt $MaxRetries) {
                Start-Sleep -Seconds $RetryDelaySec
                continue
            }
        }
    }

    if ($null -ne $lastError) {
        throw $lastError
    }
    throw "HTTP endpoint test failed without captured error for $Uri"
}

function Invoke-NodeCode {
    param(
        [string]$WorkingDirectory,
        [string]$Code
    )

    Push-Location $WorkingDirectory
    try {
        $output = $Code | node - 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Node execution failed with exit code $LASTEXITCODE`:`n$output"
        }
        return [string]$output
    }
    finally {
        Pop-Location
    }
}

function Get-ComposeServices {
    param(
        [string]$RepoRootPath,
        [string]$ComposeEnvFilePath
    )

    Push-Location $RepoRootPath
    try {
        $json = docker compose --env-file $ComposeEnvFilePath -f docker-compose.yml -f docker-compose.security.yml ps --format json 2>$null
        if (-not $json) {
            return @()
        }
        $services = $json | ConvertFrom-Json
        if ($services -isnot [System.Array]) {
            return @($services)
        }
        return $services
    }
    finally {
        Pop-Location
    }
}

function Wait-ComposeServices {
    param(
        [string]$RepoRootPath,
        [string]$ComposeEnvFilePath,
        [string[]]$ServiceNames = @(),
        [int]$TimeoutSeconds = 300,
        [int]$PollSeconds = 5,
        [int]$StableSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $healthySince = $null

    while ((Get-Date) -lt $deadline) {
        $services = @(Get-ComposeServices -RepoRootPath $RepoRootPath -ComposeEnvFilePath $ComposeEnvFilePath)
        
        if ($ServiceNames.Count -gt 0) {
            $services = @($services | Where-Object { $_.Service -in $ServiceNames })
        }

        if ($services.Count -eq 0) {
            Start-Sleep -Seconds $PollSeconds
            continue
        }

        $unhealthy = @($services | Where-Object {
            $status = [string]$_.State
            $health = [string]$_.Health
            $status -ne "running" -or ($health -and $health -ne "healthy")
        })

        if ($unhealthy.Count -eq 0) {
            if ($null -eq $healthySince) {
                $healthySince = Get-Date
            }
            elseif (((Get-Date) - $healthySince).TotalSeconds -ge $StableSeconds) {
                return
            }
        }
        else {
            $healthySince = $null
        }

        Start-Sleep -Seconds $PollSeconds
    }

    throw "Services did not become healthy within ${TimeoutSeconds}s"
}
