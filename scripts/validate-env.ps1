# Fail fast if .env is missing values required for a working deploy.
param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $Root ".env"

if (-not (Test-Path $EnvFile)) {
    Write-Host "FAIL .env not found - run .\scripts\bootstrap.ps1"
    exit 1
}

& (Join-Path $Root "scripts\ensure-env.ps1")

Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        Set-Item -Path "Env:$($Matches[1].Trim())" -Value $Matches[2].Trim().Trim('"').Trim("'") -Force
    }
}

$errors = @()

function Require-Var {
    param([string]$Name, [string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match 'replace-with') {
        $script:errors += $Name
    }
}

$url = if ($env:SUPABASE_URL) { $env:SUPABASE_URL } else { $env:VITE_SUPABASE_URL }
$anon = if ($env:SUPABASE_PUBLISHABLE_KEY) { $env:SUPABASE_PUBLISHABLE_KEY } else { $env:VITE_SUPABASE_PUBLISHABLE_KEY }

Require-Var "SUPABASE_URL" $url
Require-Var "SUPABASE_PUBLISHABLE_KEY" $anon
Require-Var "SUPABASE_SERVICE_ROLE_KEY" $env:SUPABASE_SERVICE_ROLE_KEY
Require-Var "FIELD_ENCRYPTION_KEY" $env:FIELD_ENCRYPTION_KEY
Require-Var "WORKER_INGEST_TOKEN" $env:WORKER_INGEST_TOKEN
Require-Var "METRICS_TOKEN" $env:METRICS_TOKEN

if ($env:FIELD_ENCRYPTION_KEY -and $env:FIELD_ENCRYPTION_KEY -notmatch '^[0-9a-fA-F]{64}$') {
    $script:errors += "FIELD_ENCRYPTION_KEY (must be 64 hex characters)"
}

if ($env:GRIDWIRE_DEPLOYMENT -eq "onprem") {
    Require-Var "POSTGRES_PASSWORD" $env:POSTGRES_PASSWORD
    Require-Var "JWT_SECRET" $env:JWT_SECRET
    Require-Var "DATABASE_URL" $env:DATABASE_URL
    Require-Var "INBOUND_WEBHOOK_SECRET" $env:INBOUND_WEBHOOK_SECRET
    $publicApp = if ($env:PUBLIC_APP_URL) { $env:PUBLIC_APP_URL } else { $env:SITE_URL }
    if ([string]::IsNullOrWhiteSpace($publicApp)) {
        Write-Host "WARN PUBLIC_APP_URL / SITE_URL unset — password-reset emails may use localhost"
    } elseif ($publicApp -match '127\.0\.0\.1|localhost') {
        Write-Host "WARN PUBLIC_APP_URL/SITE_URL is loopback ($publicApp) — set your public Cloudflare hostname for external password resets"
    }
}

if ($errors.Count -gt 0) {
    Write-Host ""
    Write-Host "ENV VALIDATION FAILED"
    foreach ($e in $errors) { Write-Host "  - $e" }
    Write-Host ""
    Write-Host "Without SUPABASE_SERVICE_ROLE_KEY the app shows ""This page did not load""."
    Write-Host "Supabase Dashboard -> Project Settings -> API -> service_role key"
    exit 1
}

Write-Host "OK   .env has required Gridwire variables"
exit 0
