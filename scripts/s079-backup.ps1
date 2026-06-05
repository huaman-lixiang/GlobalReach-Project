# GlobalReach V2.0 — Production Backup Script
# S079: Automated Backup Strategy
# Usage: docker exec -i or cron-scheduled execution

$ErrorActionPreference = "Stop"
$PROJECT = "C:\Users\Administrator\Documents\trae_projects\GlobalReach-Project"
$BACKUP_DIR = "$PROJECT\backups"
$DATE = Get-Date -Format "yyyyMMdd_HHmmss"

Write-Host "[Backup] GlobalReach V2.0 Production Backup - $DATE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Gray

# Ensure backup directory exists
if (!(Test-Path $BACKUP_DIR)) { New-Item -ItemType Directory -Path $BACKUP_DIR -Force | Out-Null }

# --- 1. PostgreSQL Database Backup ---
Write-Host "`n[1/4] PostgreSQL Database Backup..." -ForegroundColor Yellow
$PG_BACKUP = "$BACKUP_DIR\pg_globalreach_${DATE}.sql"
docker exec globalreach-postgres pg_dump -U globalreach_user globalreach_prod > $PG_BACKUP 2>&1
if ($LASTEXITCODE -eq 0) {
    $size = [math]::Round((Get-Item $PG_BACKUP).Length / 1KB, 1)
    Write-Host "      OK: $PG_BACKUP (${size}KB)" -ForegroundColor Green
} else {
    Write-Host "      FAIL: pg_dump error" -ForegroundColor Red
}

# --- 2. Redis Export ---
Write-Host "`n[2/4] Redis Data Export..." -ForegroundColor Yellow
$REDIS_BACKUP = "$BACKUP_DIR\redis_dump_${DATE}.rdb"
docker cp globalreach-redis:/data/dump.rdb $REDIS_BACKUP 2>&1 | Out-Null
if (Test-Path $REDIS_BACKUP) {
    $size = [math]::Round((Get-Item $REDIS_BACKUP).Length / 1KB, 1)
    Write-Host "      OK: $REDIS_BACKUP (${size}KB)" -ForegroundColor Green
} else {
    Write-Host "      SKIP: No Redis data to export" -ForegroundColor DarkGray
}

# --- 3. Docker Compose Config Backup ---
Write-Host "`n[3/4] Configuration Backup..." -ForegroundColor Yellow
$CONFIG_BACKUP = "$BACKUP_DIR\config_${DATE}.zip"
Compress-Archive -Path `
    "$PROJECT\docker-compose.prod.yml",
    "$PROJECT\.env",
    "$PROJECT\nginx\conf.d",
    "$PROJECT\api\config" `
    -DestinationPath $CONFIG_BACKUP -Force
Write-Host "      OK: $CONFIG_BACKUP" -ForegroundColor Green

# --- 4. Git Repository State ---
Write-Host "`n[4/4] Git State Snapshot..." -ForegroundColor Yellow
Push-Location $PROJECT
git log --oneline -10 > "$BACKUP_DIR\git_log_${DATE}.txt"
git status --short >> "$BACKUP_DIR\git_log_${DATE}.txt" 2>$null
Pop-Location
Write-Host "      OK: git_log_${DATE}.txt" -ForegroundColor Green

# --- Cleanup: Keep only last 7 days of backups ---
Write-Host "`n[cleanup] Removing backups older than 7 days..." -ForegroundColor Yellow
Get-ChildItem $BACKUP_DIR -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
    ForEach-Object { Remove-Item $_.FullName -Force; Write-Host "      Removed: $($_.Name)" -ForegroundColor DarkGray }

# --- Summary ---
Write-Host "`n========================================" -ForegroundColor Gray
$totalSize = [math]::Round(((Get-ChildItem $BACKUP_DIR -File | Measure-Object -Property Length -Sum).Sum) / 1MB, 2)
Write-Host "[Backup Complete] Total backup size: ${totalSize}MB" -ForegroundColor Cyan
Write-Host "[Location] $BACKUP_DIR" -ForegroundColor Gray
