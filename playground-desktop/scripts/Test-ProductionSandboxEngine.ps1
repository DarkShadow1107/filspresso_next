#Requires -Version 5.1
<# Read-only preflight of an explicitly selected production candidate. Does not switch
contexts, install Docker, create containers, or issue a production qualification receipt. #>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$DockerContext)
$ErrorActionPreference = 'Stop'
$raw = & docker --context $DockerContext info --format '{{json .}}'
if ($LASTEXITCODE -ne 0) { throw 'The selected Docker engine is unreachable.' }
$info = $raw | ConvertFrom-Json
$rootless = @($info.SecurityOptions | Where-Object { $_ -eq 'name=rootless' }).Count -gt 0
$seccomp = @($info.SecurityOptions | Where-Object { $_ -like 'name=seccomp*' }).Count -gt 0
[ordered]@{
    version = 1; context = $DockerContext; observedUtc = [DateTime]::UtcNow.ToString('o')
    linux = $info.OSType -eq 'linux'; rootless = $rootless; seccomp = $seccomp
    cgroupVersion = $info.CgroupVersion; memoryLimit = $info.MemoryLimit; pidsLimit = $info.PidsLimit
    productionQualified = $false
    remaining = 'Requires operator-confirmed dedicated engine, existing real lifecycle/crash smokes, resource/hostile-workload tests and deployment access controls. This read-only check is not certification.'
} | ConvertTo-Json
if ($info.OSType -ne 'linux' -or -not $rootless -or -not $seccomp -or $info.CgroupVersion -ne '2' -or -not $info.MemoryLimit -or -not $info.PidsLimit) {
    throw 'Production candidate does not meet Linux/rootless/seccomp/cgroup-v2/memory/PID prerequisites. Existing infrastructure was not changed.'
}
