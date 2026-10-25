param([switch]$SkipBuild, [string]$DockerSocket = '/var/run/docker.sock', [string]$PostgresImage = 'filspresso_next-postgres:latest')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$name = 'filspresso-agent-check-' + [Guid]::NewGuid().ToString('N').Substring(0, 10)
$brokerName = "$name-broker"
$databaseName = "$name-db"
$brokerPort = Get-Random -Minimum 18000 -Maximum 19000
$databasePort = Get-Random -Minimum 19000 -Maximum 20000
$keys = @('PLAYGROUND_SANDBOX_KEY', 'PLAYGROUND_SANDBOX_TEST_URL', 'PLAYGROUND_SANDBOX_NAMESPACE', 'PLAYGROUND_AGENT_TEST_DATABASE_URL', 'PLAYGROUND_AGENT_ACTION_KEY', 'POSTGRES_PASSWORD')
$previous = @{}
foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
$brokerCreated = $false
$databaseCreated = $false
try {
    if (-not $SkipBuild) {
        docker build -f "$PSScriptRoot/Dockerfile.runtime" -t filspresso-playground-runtime:dev $root
        if ($LASTEXITCODE -ne 0) { throw 'Runtime image build failed' }
        docker build -f "$PSScriptRoot/Dockerfile" -t filspresso-playground-broker:dev $root
        if ($LASTEXITCODE -ne 0) { throw 'Broker image build failed' }
    }
    $env:POSTGRES_PASSWORD = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $env:PLAYGROUND_SANDBOX_KEY = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $env:PLAYGROUND_AGENT_ACTION_KEY = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $env:PLAYGROUND_SANDBOX_NAMESPACE = $name
    $env:PLAYGROUND_SANDBOX_TEST_URL = "http://127.0.0.1:$brokerPort"
    $env:PLAYGROUND_AGENT_TEST_DATABASE_URL = "postgresql://agent_smoke:$env:POSTGRES_PASSWORD@127.0.0.1:$databasePort/agent_smoke"
    # No application database/volume is mounted. Mask image init scripts and use only tmpfs.
    docker run --detach --name $databaseName --publish "127.0.0.1:${databasePort}:5432" --env POSTGRES_PASSWORD --env POSTGRES_USER=agent_smoke --env POSTGRES_DB=agent_smoke --env PGDATA=/var/lib/postgresql/data --tmpfs /var/lib/postgresql/data:rw,size=256m --tmpfs /docker-entrypoint-initdb.d:ro,size=1m --pids-limit 128 --memory 512m --cpus 1 $PostgresImage postgres
    if ($LASTEXITCODE -ne 0) { throw 'Could not start temporary PostgreSQL' }
    $databaseCreated = $true
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        docker exec $databaseName pg_isready -U agent_smoke -d agent_smoke *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 300
    }
    if (-not $ready) { throw 'Temporary PostgreSQL did not become ready' }
    docker run --detach --name $brokerName --mount "type=bind,source=$DockerSocket,target=/var/run/docker.sock" --publish "127.0.0.1:${brokerPort}:8095" --env PLAYGROUND_SANDBOX_KEY --env PLAYGROUND_SANDBOX_NAMESPACE --read-only --tmpfs /tmp:rw,size=16m --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 128 --memory 256m --cpus 0.5 filspresso-playground-broker:dev
    if ($LASTEXITCODE -ne 0) { throw 'Could not start temporary broker' }
    $brokerCreated = $true
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try { $null = Invoke-RestMethod -Uri "$env:PLAYGROUND_SANDBOX_TEST_URL/health" -Headers @{ 'x-sandbox-key' = $env:PLAYGROUND_SANDBOX_KEY; 'x-sandbox-owner' = '42' } -TimeoutSec 3; $ready = $true; break }
        catch { Start-Sleep -Milliseconds 300 }
    }
    if (-not $ready) { throw 'Temporary broker did not become ready' }
    node "$root/nestjs-backend/node_modules/tsx/dist/cli.mjs" --tsconfig "$root/nestjs-backend/tsconfig.json" "$root/nestjs-backend/test/integration/playground-agent-smoke.ts"
    if ($LASTEXITCODE -ne 0) { throw 'Agent execution integration checks failed' }
} catch {
    if ($brokerCreated) { docker logs $brokerName }
    throw
} finally {
    $workloads = @(docker ps --all --quiet --filter 'label=filspresso.playground.sandbox=1' --filter "label=filspresso.namespace=$name")
    foreach ($workload in $workloads) { docker rm --force $workload }
    if ($brokerCreated) { docker rm --force $brokerName }
    if ($databaseCreated) { docker rm --force $databaseName }
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
}
