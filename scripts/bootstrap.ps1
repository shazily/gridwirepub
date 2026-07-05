# One-time bootstrap: create .env with generated secrets.
param(
    [string]$SupabaseUrl = "",
    [string]$AnonKey = "",
    [string]$ServiceRoleKey = "",
    [string]$PublicAppUrl = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvExample = Join-Path $Root ".env.example"
$EnvFile = Join-Path $Root ".env"

if (Test-Path $EnvFile) {
    Write-Host ".env already exists — bootstrap skipped. Delete .env to regenerate."
    exit 0
}

if (-not (Test-Path $EnvExample)) {
    throw ".env.example not found"
}

function New-HexSecret {
    param([int]$Bytes = 32)
    $buf = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    return ([BitConverter]::ToString($buf) -replace '-', '').ToLower()
}

Copy-Item $EnvExample $EnvFile

$content = Get-Content $EnvFile -Raw
$content = $content -replace 'replace-with-64-hex-chars', (New-HexSecret 32)
$content = $content -replace 'replace-with-shared-worker-token', (New-HexSecret 32)
$content = $content -replace 'replace-with-openssl-rand-hex-32', (New-HexSecret 32)

if ($SupabaseUrl) {
    $content = $content -replace 'https://api.your-company.com', $SupabaseUrl
}
if ($AnonKey) {
    $content = $content -replace 'replace-with-your-anon-key', $AnonKey
}
if ($ServiceRoleKey) {
    $content = $content -replace 'replace-with-your-service-role-key', $ServiceRoleKey
}
if ($PublicAppUrl) {
    if ($content -notmatch 'PUBLIC_APP_URL=') {
        $content += "`nPUBLIC_APP_URL=$PublicAppUrl`n"
    } else {
        $content = $content -replace '(?m)^PUBLIC_APP_URL=.*$', "PUBLIC_APP_URL=$PublicAppUrl"
    }
}

Set-Content -Path $EnvFile -Value $content -Encoding UTF8
Write-Host "Created $EnvFile with generated secrets."

if ($content -match 'replace-with-your-anon-key') {
    Write-Host ""
    Write-Host "ACTION REQUIRED: Edit .env and set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY"
    Write-Host "  Or re-run: .\scripts\bootstrap.ps1 -SupabaseUrl ... -AnonKey ... -ServiceRoleKey ..."
}
