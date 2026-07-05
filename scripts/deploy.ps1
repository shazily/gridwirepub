# Gridwire touchless deploy - Windows entry point.
param(
    [Parameter(Position = 0)]
    [ValidateSet("up", "down", "status", "smoke", "migrate", "install-backup", "bootstrap")]
    [string]$Command = "up",
    [switch]$SkipMigrations,
    [switch]$SkipSmoke
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$OnPremCompose = Join-Path $Root "docker-compose.onprem.yml"

function Load-EnvFile {
    $EnvFile = Join-Path $Root ".env"
    if (-not (Test-Path $EnvFile)) { return $false }
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            Set-Item -Path "Env:$($Matches[1].Trim())" -Value $Matches[2].Trim().Trim('"').Trim("'") -Force
        }
    }
    return $true
}

function Test-OnPremMode {
    return ($env:GRIDWIRE_DEPLOYMENT -eq "onprem") -and (Test-Path $OnPremCompose)
}

function Get-ComposeArgs {
    if (Test-OnPremMode) {
        return @("-f", "docker-compose.onprem.yml")
    }
    $files = @("-f", "docker-compose.yml")
    $backend = Join-Path $Root "docker-compose.backend.yml"
    if ($env:GRIDWIRE_INCLUDE_BACKEND -eq "1" -and (Test-Path $backend)) {
        $files += @("-f", "docker-compose.backend.yml")
    }
    return $files
}

function Start-BackendStack {
    if (-not (Test-OnPremMode)) { return }
    Write-Host "Starting on-prem backend (Postgres + Auth + API gateway)..."
    docker compose @((Get-ComposeArgs)) up -d db auth rest kong --wait
    if ($LASTEXITCODE -ne 0) { throw "Backend stack failed to become healthy" }
}

switch ($Command) {
    "bootstrap" {
        & (Join-Path $Root "scripts\bootstrap-onprem.ps1")
        break
    }
    "migrate" {
        if (-not (Load-EnvFile)) { throw ".env not found - run .\scripts\deploy.ps1 bootstrap" }
        if (Test-OnPremMode) { Start-BackendStack }
        & (Join-Path $Root "scripts\apply-migrations.ps1")
        break
    }
    "install-backup" {
        & (Join-Path $Root "scripts\install-backup-task.ps1")
        break
    }
    "down" {
        if (Load-EnvFile) { }
        docker compose @((Get-ComposeArgs)) down
        break
    }
    "status" {
        if (-not (Load-EnvFile)) { throw ".env not found" }
        $HostPort = if ($env:GRIDWIRE_HOST_PORT) { $env:GRIDWIRE_HOST_PORT } else { "3020" }
        docker compose @((Get-ComposeArgs)) ps
        & (Join-Path $Root "scripts\smoke-test.ps1") -PortalUrl "http://127.0.0.1:$HostPort" -SkipWorker
        break
    }
    "smoke" {
        if (-not (Load-EnvFile)) { throw ".env not found" }
        $HostPort = if ($env:GRIDWIRE_HOST_PORT) { $env:GRIDWIRE_HOST_PORT } else { "3020" }
        & (Join-Path $Root "scripts\smoke-test.ps1") -PortalUrl "http://127.0.0.1:$HostPort"
        break
    }
    "up" {
        if (-not (Test-Path (Join-Path $Root ".env"))) {
            Write-Host "No .env - bootstrapping on-prem configuration..."
            & (Join-Path $Root "scripts\bootstrap-onprem.ps1")
        } else {
            & (Join-Path $Root "scripts\ensure-env.ps1")
        }
        if (-not (Load-EnvFile)) { throw "bootstrap failed to create .env" }

        if ($env:GRIDWIRE_DEPLOYMENT -ne "onprem") {
            Write-Host "WARN GRIDWIRE_DEPLOYMENT is not 'onprem'. For full air-gap stack run:"
            Write-Host "  .\scripts\bootstrap-onprem.ps1 -Force"
        }

        & (Join-Path $Root "scripts\validate-env.ps1")
        if ($LASTEXITCODE -ne 0) { throw "Environment validation failed" }

        $HostPort = if ($env:GRIDWIRE_HOST_PORT) { $env:GRIDWIRE_HOST_PORT } else { "3020" }

        $portBindings = @("127.0.0.1:$HostPort")
        if (Test-OnPremMode) {
            $apiPort = if ($env:GRIDWIRE_API_PORT) { $env:GRIDWIRE_API_PORT } else { "3040" }
            $dbPort = if ($env:GRIDWIRE_DB_PORT) { $env:GRIDWIRE_DB_PORT } else { "54332" }
            $portBindings += @("127.0.0.1:$apiPort", "127.0.0.1:$dbPort")
        } elseif ($env:GRIDWIRE_INCLUDE_BACKEND -eq "1") {
            $portBindings += @("127.0.0.1:3040", "127.0.0.1:54332")
        }
        & (Join-Path $Root "scripts\check-ports.ps1") -Ports $portBindings
        if ($LASTEXITCODE -ne 0) { throw "Port preflight failed" }

        if (Test-OnPremMode) {
            Start-BackendStack
            if (-not $SkipMigrations) {
                & (Join-Path $Root "scripts\apply-migrations.ps1")
                if ($LASTEXITCODE -ne 0) { throw "Migrations failed" }
            }
        } elseif (-not $SkipMigrations) {
            if ($env:DATABASE_URL -or $env:PGHOST) {
                try {
                    & (Join-Path $Root "scripts\apply-migrations.ps1")
                } catch {
                    Write-Host "WARN Migrations skipped: $($_.Exception.Message)"
                }
            } else {
                Write-Host "WARN Migrations skipped - set DATABASE_URL or use on-prem bootstrap"
            }
        }

        $gitSha = ""
        try { $gitSha = (git rev-parse --short HEAD 2>$null) } catch { }
        if ($gitSha) {
            $env:GRIDWIRE_IMAGE_TAG = "git-$gitSha"
            Set-Content -Path (Join-Path $Root ".deploy-state") -Value "GRIDWIRE_IMAGE_TAG=git-$gitSha`n" -Encoding UTF8
        }

        if (Test-OnPremMode) {
            Write-Host "Building and starting portal + worker..."
            docker compose @((Get-ComposeArgs)) up -d --build portal worker clamav --wait
        } else {
            docker compose @((Get-ComposeArgs)) up -d --build --wait
        }
        if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

        if (-not $SkipSmoke) {
            & (Join-Path $Root "scripts\smoke-test.ps1") -PortalUrl "http://127.0.0.1:$HostPort"
            if ($LASTEXITCODE -ne 0) { throw "Smoke tests failed" }
        }

        Write-Host ""
        Write-Host "Deploy complete."
        Write-Host "  Portal: http://127.0.0.1:$HostPort"
        if (Test-OnPremMode) {
            $apiPort = if ($env:GRIDWIRE_API_PORT) { $env:GRIDWIRE_API_PORT } else { "3040" }
            Write-Host "  API gateway: http://127.0.0.1:$apiPort"
            Write-Host "  Fully on-prem - no cloud services required."
        } else {
            Write-Host "  Point Cloudflare tunnel at http://127.0.0.1:$HostPort"
        }
        break
    }
}
