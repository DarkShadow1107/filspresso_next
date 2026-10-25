param([switch]$SkipBuild, [string]$DockerSocket = '/var/run/docker.sock')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$previousKey = $env:PLAYGROUND_SANDBOX_KEY
$previousUrl = $env:PLAYGROUND_SANDBOX_TEST_URL
$previousNamespace = $env:PLAYGROUND_SANDBOX_NAMESPACE
$name = 'filspresso-playground-broker-check-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$port = Get-Random -Minimum 18000 -Maximum 19000
$created = $false
try {
    if (-not $SkipBuild) {
        docker build -f "$PSScriptRoot/Dockerfile.runtime" -t filspresso-playground-runtime:dev $root
        if ($LASTEXITCODE -ne 0) { throw 'Runtime image build failed' }
        docker build -f "$PSScriptRoot/Dockerfile" -t filspresso-playground-broker:dev $root
        if ($LASTEXITCODE -ne 0) { throw 'Broker image build failed' }
    }
    $env:PLAYGROUND_SANDBOX_KEY = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $env:PLAYGROUND_SANDBOX_TEST_URL = "http://127.0.0.1:$port"
    $env:PLAYGROUND_SANDBOX_NAMESPACE = $name
    docker run --detach --name $name --mount "type=bind,source=$DockerSocket,target=/var/run/docker.sock" --publish "127.0.0.1:${port}:8095" --env PLAYGROUND_SANDBOX_KEY --env PLAYGROUND_SANDBOX_NAMESPACE --read-only --tmpfs /tmp:rw,size=16m --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 128 --memory 256m --cpus 0.5 filspresso-playground-broker:dev
    if ($LASTEXITCODE -ne 0) { throw 'Could not start test broker' }
    $created = $true
    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            $null = Invoke-RestMethod -Uri "$env:PLAYGROUND_SANDBOX_TEST_URL/health" -Headers @{ 'x-sandbox-key' = $env:PLAYGROUND_SANDBOX_KEY; 'x-sandbox-owner' = '987654321' } -TimeoutSec 3
            $ready = $true
            break
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) { throw 'Test broker did not become ready' }
    python "$PSScriptRoot/smoke.py"
    if ($LASTEXITCODE -ne 0) { throw 'Docker sandbox integration checks failed' }
    python "$PSScriptRoot/smoke_restart.py"
    if ($LASTEXITCODE -ne 0) { throw 'Docker broker crash/restart checks failed' }
} catch {
    if ($created) { docker logs $name }
    throw
} finally {
    # A failed assertion or disconnected stream must not leave test workloads behind after
    # the temporary broker (and its reaper) is gone. Only this random test namespace is removed.
    $workloads = @(docker ps --all --quiet --filter 'label=filspresso.playground.sandbox=1' --filter "label=filspresso.namespace=$name")
    foreach ($workload in $workloads) {
        docker rm --force $workload
        if ($LASTEXITCODE -ne 0) { Write-Warning "Could not remove test workload $workload in namespace $name" }
    }
    if ($created) { docker rm --force $name }
    $env:PLAYGROUND_SANDBOX_KEY = $previousKey
    $env:PLAYGROUND_SANDBOX_TEST_URL = $previousUrl
    $env:PLAYGROUND_SANDBOX_NAMESPACE = $previousNamespace
}
