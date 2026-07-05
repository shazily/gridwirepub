# Ensures required Gridwire secrets exist in .env (non-destructive merge).
param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $Root ".env"

function New-HexSecret {
    param([int]$Bytes = 32)
    $buf = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    return ([BitConverter]::ToString($buf) -replace '-', '').ToLower()
}

function Read-EnvMap {
    param([string]$Path)
    $map = @{}
    if (-not (Test-Path $Path)) { return $map }
    Get-Content $Path | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $map[$Matches[1].Trim()] = $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    return $map
}

function Write-EnvMap {
    param([string]$Path, [hashtable]$Map)
    $lines = $Map.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Key)=$($_.Value)" }
    Set-Content -Path $Path -Value (($lines -join "`n") + "`n") -Encoding UTF8
}

function New-Password {
    param([int]$Length = 32)
    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    $buf = New-Object byte[] $Length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    return -join ($buf | ForEach-Object { $chars[$_ % $chars.Length] })
}

if (-not (Test-Path $EnvFile)) {
    & (Join-Path $Root "scripts\bootstrap.ps1")
    return
}

$envMap = Read-EnvMap $EnvFile
$changed = $false

function Set-IfMissing {
    param([string]$Key, [string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return }
    if ($envMap.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace($envMap[$Key])) { return }
    $envMap[$Key] = $Value
    $script:changed = $true
    Write-Host "Added $Key to .env"
}

Set-IfMissing "FIELD_ENCRYPTION_KEY" (New-HexSecret 32)
Set-IfMissing "WORKER_INGEST_TOKEN" (New-HexSecret 32)
Set-IfMissing "METRICS_TOKEN" (New-HexSecret 32)
Set-IfMissing "GRIDWIRE_HOST_PORT" "3020"

# Mirror VITE_* into server-side names for Docker when only browser vars are set.
Set-IfMissing "SUPABASE_URL" $envMap["VITE_SUPABASE_URL"]
Set-IfMissing "SUPABASE_PUBLISHABLE_KEY" $envMap["VITE_SUPABASE_PUBLISHABLE_KEY"]
Set-IfMissing "VITE_SUPABASE_URL" $envMap["SUPABASE_URL"]
Set-IfMissing "VITE_SUPABASE_PUBLISHABLE_KEY" $envMap["SUPABASE_PUBLISHABLE_KEY"]

$storageSecret = New-Password 32
Set-IfMissing "STORAGE_ACCESS_KEY" "gridwire"
Set-IfMissing "STORAGE_SECRET_KEY" $storageSecret
Set-IfMissing "MINIO_ROOT_PASSWORD" $storageSecret
Set-IfMissing "STORAGE_BUCKET" "gridwire"

if ($changed) {
    Write-EnvMap $EnvFile $envMap
}

$envMap = Read-EnvMap $EnvFile
if ([string]::IsNullOrWhiteSpace($envMap["SUPABASE_SERVICE_ROLE_KEY"])) {
    Write-Host ""
    Write-Host "REQUIRED: SUPABASE_SERVICE_ROLE_KEY is missing from .env"
    Write-Host "  Supabase Dashboard -> Project Settings -> API -> service_role (secret)"
    Write-Host "  Add: SUPABASE_SERVICE_ROLE_KEY=<your-service-role-jwt>"
    Write-Host ""
}

if ([string]::IsNullOrWhiteSpace($envMap["DATABASE_URL"])) {
    Write-Host "WARN DATABASE_URL missing - migrations will be skipped until set"
}
