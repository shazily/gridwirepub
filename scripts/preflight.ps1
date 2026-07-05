# Full pre-deploy gate: env, unit tests, production build.
param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "=== Gridwire preflight ==="

& (Join-Path $Root "scripts\validate-env.ps1")
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ""
Write-Host "Running unit tests..."
bun run test
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ""
Write-Host "Running production build..."
bun run build
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ""
Write-Host "Preflight passed."
exit 0
