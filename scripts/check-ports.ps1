# Preflight: detect host port conflicts before docker compose up.
param(
    [string[]]$Ports = @("127.0.0.1:3020"),
    [string]$ComposeProject = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not $ComposeProject) {
    $folder = Split-Path -Leaf $Root
    $ComposeProject = ($folder -replace '[^a-zA-Z0-9]', '').ToLower()
}

function Get-ListeningEndpoints {
    $results = @()
    netstat -ano | Select-String "LISTENING" | ForEach-Object {
        if ($_ -match '^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)') {
            $results += [PSCustomObject]@{
                Address = $Matches[1]
                Port    = [int]$Matches[2]
                Pid     = [int]$Matches[3]
            }
        }
    }
    return $results
}

function Get-DockerPortOwners {
    $owners = @{}
    try {
        docker ps --format "{{.Names}}|{{.Ports}}" 2>$null | ForEach-Object {
            if (-not $_) { return }
            $parts = $_ -split '\|', 2
            $name = $parts[0]
            $ports = $parts[1]
            if (-not $ports) { return }
            foreach ($segment in ($ports -split ',')) {
                $segment = $segment.Trim()
                if ($segment -match '^([^:]+):(\d+)->') {
                    $hostIp = $Matches[1]
                    $hostPort = [int]$Matches[2]
                    $key = "${hostIp}:$hostPort"
                    if (-not $owners.ContainsKey($key)) { $owners[$key] = [System.Collections.Generic.List[string]]::new() }
                    $owners[$key].Add($name)
                }
            }
        }
    } catch { }
    return $owners
}

function Test-PortBinding {
    param([string]$Binding)
    $hostIp = "0.0.0.0"
    $port = 0
    if ($Binding -match '^([^:]+):(\d+)$') {
        $hostIp = $Matches[1]
        $port = [int]$Matches[2]
    } elseif ($Binding -match '^(\d+)$') {
        $port = [int]$Matches[1]
    } else {
        throw "Invalid port binding: $Binding"
    }

    $listeners = @(Get-ListeningEndpoints | Where-Object { $_.Port -eq $port })
    if ($listeners.Count -eq 0) {
        Write-Host "OK   port $Binding is free"
        return $true
    }

    $dockerOwners = Get-DockerPortOwners
    $conflicts = @()
    foreach ($l in $listeners) {
        $keys = @("$($l.Address):$port", "0.0.0.0:$port", "[::]:$port", "[::1]:$port")
        $ownerNames = @()
        foreach ($k in $keys) {
            if ($dockerOwners.ContainsKey($k)) {
                $ownerNames += $dockerOwners[$k]
            }
        }
        $ownerNames = $ownerNames | Select-Object -Unique

        $isOurs = $false
        foreach ($n in $ownerNames) {
            if ($n -like "*$ComposeProject*") {
                $isOurs = $true
                break
            }
        }

        if (-not $isOurs) {
            $ownerLabel = if ($ownerNames.Count -gt 0) { ($ownerNames -join ", ") } else { "PID $($l.Pid) (non-Docker or unknown)" }
            $conflicts += "$($l.Address):$port ($ownerLabel)"
        }
    }

    if ($conflicts.Count -gt 0) {
        Write-Host "FAIL port $Binding - in use by: $($conflicts -join '; ')"
        return $false
    }

    if ($listeners.Count -gt 0) {
        Write-Host "OK   port $Binding (owned by this compose project)"
        return $true
    }

    Write-Host "OK   port $Binding is free"
    return $true
}

Write-Host "Checking required host ports (compose project: $ComposeProject)..."
$ok = $true
foreach ($p in $Ports) {
    if (-not (Test-PortBinding $p)) { $ok = $false }
}

if (-not $ok) {
    Write-Host ""
    Write-Host "Nearby ports in use on this host (docker):"
    docker ps --format 'table {{.Names}}\t{{.Ports}}' | Select-String -Pattern '3000|3040|54332|54322|3100|3001|3002'
    Write-Host ""
    Write-Host "Change bindings in docker-compose.yml or stop the conflicting container."
    exit 1
}

exit 0
