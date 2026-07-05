# Bootstrap a complete on-prem Gridwire .env (no cloud services).
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $Root ".env"

function New-HexSecret {
    param([int]$Bytes = 32)
    $buf = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    return ([BitConverter]::ToString($buf) -replace '-', '').ToLower()
}

function New-Password {
    param([int]$Length = 32)
    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    $buf = New-Object byte[] $Length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    return -join ($buf | ForEach-Object { $chars[$_ % $chars.Length] })
}

if ((Test-Path $EnvFile) -and -not $Force) {
    $existing = Get-Content $EnvFile -Raw
    if ($existing -match 'GRIDWIRE_DEPLOYMENT=onprem') {
        Write-Host ".env already configured for on-prem. Use -Force to regenerate secrets."
        exit 0
    }
    Write-Host "Backing up existing .env to .env.cloud-backup"
    Copy-Item $EnvFile (Join-Path $Root ".env.cloud-backup") -Force
}

$hostPort = "3020"
$apiPort = "3040"
$dbPort = "54332"
$siteUrl = "http://127.0.0.1:$hostPort"
$apiExternal = "http://127.0.0.1:$apiPort"

$postgresPassword = New-Password 32
$jwtSecret = New-HexSecret 48
$fieldKey = New-HexSecret 32
$workerToken = New-HexSecret 32
$metricsToken = New-HexSecret 32
$inboundWebhookSecret = New-HexSecret 32

$keysJson = node (Join-Path $Root "scripts\generate-supabase-jwt-keys.mjs") $jwtSecret
if ($LASTEXITCODE -ne 0) { throw "JWT key generation failed" }
$keys = $keysJson | ConvertFrom-Json
$anonKey = $keys.anon_key
$serviceKey = $keys.service_role_key

$databaseUrl = "postgresql://postgres:${postgresPassword}@127.0.0.1:${dbPort}/postgres"

$storageAccessKey = "gridwire"
$storageSecretKey = New-Password 32
$minioRootPassword = $storageSecretKey

$lines = @(
    "GRIDWIRE_DEPLOYMENT=onprem"
    "DEPLOYMENT_MODE=onprem"
    ""
    "# On-prem API gateway (browser) and internal portal URL"
    "SUPABASE_URL=http://kong:8000"
    "VITE_SUPABASE_URL=$apiExternal"
    "API_EXTERNAL_URL=$apiExternal"
    "SITE_URL=$siteUrl"
    "PUBLIC_APP_URL=$siteUrl"
    ""
    "VITE_GITHUB_REPO_URL=https://github.com/shazily/gridwirepub"
    ""
    "SUPABASE_PUBLISHABLE_KEY=$anonKey"
    "VITE_SUPABASE_PUBLISHABLE_KEY=$anonKey"
    "SUPABASE_SERVICE_ROLE_KEY=$serviceKey"
    ""
    "POSTGRES_PASSWORD=$postgresPassword"
    "JWT_SECRET=$jwtSecret"
    "DATABASE_URL=$databaseUrl"
    ""
    "FIELD_ENCRYPTION_KEY=$fieldKey"
    "WORKER_INGEST_TOKEN=$workerToken"
    "METRICS_TOKEN=$metricsToken"
    "INBOUND_WEBHOOK_SECRET=$inboundWebhookSecret"
    ""
    "GRIDWIRE_HOST_PORT=$hostPort"
    "GRIDWIRE_API_PORT=$apiPort"
    "GRIDWIRE_DB_PORT=$dbPort"
    ""
    "GOTRUE_MAILER_AUTOCONFIRM=true"
    "POLL_CRON=*/5 * * * *"
    "SFTP_SECRETS={}"
    ""
    "API_RATE_LIMIT_PER_MIN=60"
    "API_RATE_LIMIT_BURST=20"
    ""
    "# Object storage (MinIO on-prem)"
    "STORAGE_ACCESS_KEY=$storageAccessKey"
    "STORAGE_SECRET_KEY=$storageSecretKey"
    "MINIO_ROOT_PASSWORD=$minioRootPassword"
    "STORAGE_BUCKET=gridwire"
    ""
    "# Optional Postmark / SMTP (leave SMTP_HOST blank to skip email delivery)"
    "SKIP_EMAIL=false"
    "POSTMARK_API_TOKEN="
    "POSTMARK_MESSAGE_STREAM=outbound"
    "EMAIL_FROM_NOREPLY=noreply@gridwire.local"
    "EMAIL_FROM_NOTIFICATIONS=notifications@gridwire.local"
    "EMAIL_FROM_SUPPORT=support@gridwire.local"
    "EMAIL_FROM_INFO=info@gridwire.local"
    "EMAIL_FROM_AUTH=auth@gridwire.local"
    "SMTP_HOST="
    "SMTP_PORT=587"
    "SMTP_USER="
    "SMTP_PASS="
    "SMTP_FROM=noreply@gridwire.local"
    "SMTP_SECURE=false"
    "SMTP_SENDER_NAME=Gridwire"
)

Set-Content -Path $EnvFile -Value ($lines -join "`n") -Encoding UTF8
Write-Host ""
Write-Host "Created on-prem .env at $EnvFile"
Write-Host "  Portal:  $siteUrl"
Write-Host "  API:     $apiExternal"
Write-Host "  Postgres: 127.0.0.1:$dbPort"
Write-Host ""
Write-Host "Next: .\scripts\deploy.ps1 up"
