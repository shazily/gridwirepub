# Registers a daily Gridwire database backup via Windows Task Scheduler.
param(
    [string]$BackupDir = "C:\Backups\gridwire",
    [int]$RetentionDays = 14,
    [string]$TaskName = "GridwireDailyBackup"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BackupScript = Join-Path $Root "deploy\scripts\backup.sh"

if (-not (Test-Path $BackupScript)) {
    throw "Backup script not found: $BackupScript"
}

$bash = Get-Command bash -ErrorAction SilentlyContinue
if (-not $bash) {
    Write-Host "Git Bash / WSL bash required for pg_dump backup script."
    Write-Host "Install Git for Windows or run backups manually:"
    Write-Host "  DATABASE_URL=... BACKUP_DIR=$BackupDir bash deploy/scripts/backup.sh"
    exit 1
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$action = New-ScheduledTaskAction -Execute $bash.Source -Argument "-lc `"cd '$($Root -replace '\\','/')' && DATABASE_URL=`$env:DATABASE_URL BACKUP_DIR='$BackupDir' RETENTION_DAYS=$RetentionDays ./deploy/scripts/backup.sh`""
$trigger = New-ScheduledTaskTrigger -Daily -At 2am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force
Write-Host "Registered scheduled task '$TaskName' → daily backup to $BackupDir"
Write-Host "Ensure DATABASE_URL is set in the user environment for the task account."
