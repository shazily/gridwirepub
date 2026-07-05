# Idempotent Gridwire SQL migrations.
param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$MigrationsDir = Join-Path $Root "supabase\migrations"
$OnPremCompose = Join-Path $Root "docker-compose.onprem.yml"

$EnvFile = Join-Path $Root ".env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $key = $Matches[1].Trim()
            $val = $Matches[2].Trim().Trim('"').Trim("'")
            if (-not [string]::IsNullOrWhiteSpace($key)) {
                Set-Item -Path "Env:$key" -Value $val -Force
            }
        }
    }
}

$UseDockerPsql = ($env:GRIDWIRE_DEPLOYMENT -eq "onprem") -and (Test-Path $OnPremCompose)

function Invoke-DockerPsql {
    param([string]$Sql, [string]$FilePath = "", [switch]$TuplesOnly)
    if (-not $env:POSTGRES_PASSWORD) { throw "POSTGRES_PASSWORD missing from .env" }
    Push-Location $Root
    try {
        $psqlArgs = @("psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1")
        if ($TuplesOnly) { $psqlArgs += @("-t", "-A") }
        $base = @(
            "compose", "-f", "docker-compose.onprem.yml",
            "exec", "-T", "-e", "PGPASSWORD=$($env:POSTGRES_PASSWORD)",
            "db"
        ) + $psqlArgs
        if ($FilePath) {
            Get-Content $FilePath -Raw | docker @base -f -
        } else {
            docker @base -c $Sql
        }
        if ($LASTEXITCODE -ne 0) { throw "psql failed (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
}

function Invoke-PsqlArgs {
    if ($env:DATABASE_URL) {
        return @($env:DATABASE_URL)
    }
    if (-not $env:PGHOST) { throw "Set DATABASE_URL or PGHOST" }
    if (-not $env:PGUSER) { throw "Set DATABASE_URL or PGUSER" }
    if (-not $env:PGDATABASE) { throw "Set DATABASE_URL or PGDATABASE" }
    $port = if ($env:PGPORT) { $env:PGPORT } else { "5432" }
    return @("-h", $env:PGHOST, "-p", $port, "-U", $env:PGUSER, "-d", $env:PGDATABASE)
}

function Invoke-Psql {
    param([string]$Sql, [switch]$TuplesOnly)
    if ($UseDockerPsql) {
        Invoke-DockerPsql -Sql $Sql -TuplesOnly:$TuplesOnly
        return
    }
    $args = Invoke-PsqlArgs
    $extra = @("-v", "ON_ERROR_STOP=1")
    if ($TuplesOnly) { $extra += @("-t", "-A") }
    if ($args.Count -eq 1) {
        & psql $args[0] @extra -c $Sql
    } else {
        & psql @args @extra -c $Sql
    }
}

function Invoke-PsqlFile {
    param([string]$Path)
    if ($UseDockerPsql) {
        Invoke-DockerPsql -FilePath $Path
        return
    }
    $args = Invoke-PsqlArgs
    if ($args.Count -eq 1) {
        & psql $args[0] -v ON_ERROR_STOP=1 -f $Path
    } else {
        & psql @args -v ON_ERROR_STOP=1 -f $Path
    }
}

$bootstrap = Join-Path $MigrationsDir "00000000000000_schema_migrations.sql"
if (Test-Path $bootstrap) {
    try { Invoke-PsqlFile $bootstrap | Out-Null } catch { }
}

$files = Get-ChildItem -Path $MigrationsDir -Filter "*.sql" | Sort-Object Name
$applied = 0
$skipped = 0

foreach ($file in $files) {
    $name = $file.Name
    if ($name -eq "00000000000000_schema_migrations.sql") { continue }
    $escaped = $name.Replace("'", "''")
    $check = ""
    try {
        $check = (Invoke-Psql "SELECT 1 FROM public.gridwire_schema_migrations WHERE filename = '$escaped' LIMIT 1;" -TuplesOnly 2>$null | Out-String).Trim()
    } catch { }
    if ($check -eq "1") {
        Write-Host "Skip (already applied): $name"
        $skipped++
        continue
    }
    Write-Host "Applying $name..."
    Invoke-PsqlFile $file.FullName
    Invoke-Psql "INSERT INTO public.gridwire_schema_migrations (filename) VALUES ('$escaped') ON CONFLICT (filename) DO NOTHING;"
    $applied++
}

Write-Host "Migrations complete. Applied: $applied, skipped: $skipped."

# Post-migration invariants — fail deploy if RLS helpers cannot run (onboarding loop).
function Assert-PsqlTrue {
    param([string]$Label, [string]$Sql)
    $result = (Invoke-Psql $Sql -TuplesOnly | Out-String).Trim()
    if ($result -ne "t") {
        throw "Migration security check failed: $Label (got '$result')"
    }
    Write-Host "OK   $Label"
}

Write-Host "Verifying migration security invariants..."
Assert-PsqlTrue "is_org_member EXECUTE for authenticated (RLS)" `
    "SELECT has_function_privilege('authenticated', 'public.is_org_member(uuid)', 'EXECUTE');"
Assert-PsqlTrue "has_org_role EXECUTE for authenticated (RLS)" `
    "SELECT has_function_privilege('authenticated', 'public.has_org_role(uuid,public.app_org_role[])', 'EXECUTE');"
Assert-PsqlTrue "org_members UPDATE revoked from authenticated" `
    "SELECT NOT has_table_privilege('authenticated', 'public.org_members', 'UPDATE');"
Assert-PsqlTrue "update_org_member_role callable by authenticated" `
    "SELECT has_function_privilege('authenticated', 'public.update_org_member_role(uuid,public.app_org_role)', 'EXECUTE');"
Write-Host "Migration security invariants passed."
