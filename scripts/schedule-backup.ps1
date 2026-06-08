# ==============================================================================
# GlobalReach V2.0 — Remote Backup Strategy (M-D06)
# Windows Task Scheduler 定时备份注册脚本
#
# Usage:
#   .\scripts\schedule-backup.ps1                    # 使用默认参数
#   .\scripts\schedule-backup.ps1 -BackupDir D:\backups  # 自定义目录
#   .\scripts\schedule-backup.ps1 -Remove             # 移除定时任务
#
# 默认行为:
#   - 创建每日凌晨 2:00 执行的 Windows 计划任务
#   - 备份到 C:\backups\globalreach\
#   - 保留最近 30 天的备份
# ==============================================================================

[CmdletBinding()]
param(
    [string]$BackupDir = "C:\backups\globalreach",
    [int]$RetentionDays = 30,
    [string]$NotifyEmail = "",
    [string]$TaskName = "GlobalReach-DailyBackup-MD06",
    [switch]$Remove,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent)

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " GlobalReach V2.0 — 远程备份定时任务配置 (M-D06)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# ======================== 参数展示 ========================
Write-Host "`n[配置参数]" -ForegroundColor Yellow
Write-Host "  项目路径:      $ProjectRoot"
Write-Host "  备份目录:      $BackupDir"
Write-Host "  保留天数:      $RetentionDays"
Write-Host "  任务名称:      $TaskName"
Write-Host "  通知邮箱:      $(if ($NotifyEmail) { $NotifyEmail } else { '(未配置)' })"

# ======================== 移除模式 ========================
if ($Remove) {
    Write-Host "`n[操作] 移除定时任务: $TaskName" -ForegroundColor Yellow

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        if ($WhatIf) {
            Write-Host "  [WHATIF] 将执行: Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false" -ForegroundColor DarkGray
        } else {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
            Write-Host "  [OK] 定时任务已移除" -ForegroundColor Green
        }
    } else {
        Write-Host "  [WARN] 任务 '$TaskName' 不存在，无需移除" -ForegroundColor DarkYellow
    }

    # 同时清理 WSL crontab 条目（如果存在）
    Write-Host "`n[提示] 如使用 WSL2/bash 执行，请手动清理 crontab:" -ForegroundColor DarkGray
    Write-Host "  crontab -l | grep -v backup.sh | crontab -" -ForegroundColor DarkGray
    return
}

# ======================== 前置检查 ========================
Write-Host "`n[前置检查]" -ForegroundColor Yellow

# 检查 Docker 是否可用
$dockerAvailable = $false
try {
    $null = docker info --format "{{.ServerVersion}}" 2>$null
    $dockerAvailable = $true
    Write-Host "  [OK] Docker 可用" -ForegroundColor Green
} catch {
    Write-Host "  [WARN] Docker 当前不可用（计划任务运行时需确保Docker正在运行）" -ForegroundColor DarkYellow
}

# 检查 bash/WSL 是否可用
$bashAvailable = $false
try {
    $null = bash --version 2>$null
    $bashAvailable = $true
    Write-Host "  [OK] Bash (WSL2/GitBash) 可用" -ForegroundColor Green
} catch {
    Write-Host "  [WARN] Bash 不可用，将尝试使用 PowerShell 方式调用" -ForegroundColor DarkYellow
}

# 创建备份目录
if (-not (Test-Path $BackupDir)) {
    if ($WhatIf) {
        Write-Host "  [WHATIF] 将创建目录: $BackupDir" -ForegroundColor DarkGray
    } else {
        New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
        Write-Host "  [OK] 已创建备份目录: $BackupDir" -ForegroundColor Green
    }
}

# ======================== 构建备份命令 ========================
Write-Host "`n[构建执行命令]" -ForegroundColor Yellow

$BackupScript = Join-Path $ProjectRoot "scripts\backup.sh"
$logDir = Join-Path $ProjectRoot "logs"

# 确保日志目录存在
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

if ($bashAvailable) {
    # 通过 bash 执行 backup.sh（推荐方式）
    $action = New-ScheduledTaskAction `
        -Execute "bash.exe" `
        -Argument "-c `"BACKUP_DIR=$BackupDir RETENTION_DAYS=$RetentionDays bash '$BackupScript' 2>&1 | tee -a '$logDir\scheduled_backup.log'`""
    Write-Host "  执行方式: bash.exe → backup.sh" -ForegroundColor White
} else {
    # 回退到 PowerShell 调用（兼容模式）
    $psBackupScript = Join-Path $ProjectRoot "scripts\s079-backup.ps1"
    $action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$psBackupScript`"" `
        -WorkingDirectory $ProjectRoot
    Write-Host "  执行方式: powershell.exe → s079-backup.ps1 (回退)" -ForegroundColor DarkYellow
}

# ======================== 触发器: 每日 02:00 ========================
$trigger = New-ScheduledTaskTrigger -Daily -At "02:00"
Write-Host "  触发时间: 每日 02:00" -ForegroundColor White

# ======================== 设置 ========================
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `  # 最长执行2小时
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5)       # 失败后重试3次，间隔5分钟

$principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest

# ======================== 注册/更新任务 ========================
Write-Host "`n[注册定时任务]" -ForegroundColor Yellow

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($WhatIf) {
    Write-Host "  [WHATIF] 模式 — 不做实际修改" -ForegroundColor Magenta
    Write-Host "  任务名称:     $TaskName" -ForegroundColor White
    Write-Host "  执行程序:     $($action.Execute)" -ForegroundColor White
    Write-Host "  参数:         $($action.Arguments)" -ForegroundColor White
    Write-Host "  触发器:       每日 02:00" -ForegroundColor White
    Write-Host "  运行身份:     SYSTEM (最高权限)" -ForegroundColor White
    Write-Host "  超时限制:     2 小时" -ForegroundColor White
    Write-Host "  重试策略:     3次 / 间隔5分钟" -ForegroundColor White
} else {
    if ($existingTask) {
        # 更新现有任务
        Set-ScheduledTask -TaskName $TaskName `
            -Action $action `
            -Trigger $trigger `
            -Settings $settings `
            -Principal $principal `
            -ErrorAction Stop | Out-Null
        Write-Host "  [OK] 已更新现有任务: $TaskName" -ForegroundColor Green
    } else {
        # 注册新任务
        Register-ScheduledTask -TaskName $TaskName `
            -Action $action `
            -Trigger $trigger `
            -Settings $settings `
            -Principal $principal `
            -Description "GlobalReach V2.0 M-D06 远程每日自动备份 (PostgreSQL + Redis + Grafana + Nginx)" `
            -ErrorAction Stop | Out-Null
        Write-Host "  [OK] 已注册新任务: $TaskName" -ForegroundColor Green
    }
}

# ======================== 邮件通知配置（可选）========================
if ($NotifyEmail) {
    Write-Host "`n[邮件通知]" -ForegroundColor Yellow
    Write-Host "  提示: 请在 Grafana Alertmanager 中配置邮件通知" -ForegroundColor DarkGray
    Write-Host "  目标邮箱: $NotifyEmail" -ForegroundColor White
}

# ======================== WSL Crontab 备选方案 ========================
Write-Host "`n[WSL2 Crontab 备选方案]" -ForegroundColor Yellow
$cronEntry = "0 2 * * * BACKUP_DIR=$BackupDir RETENTION_DAYS=$RetentionDays $BackupScript >> $logDir/cron_backup.log 2>&1"
Write-Host "  如需在 WSL2 中使用 cron，添加以下行到 crontab:" -ForegroundColor DarkGray
Write-Host "  $cronEntry" -ForegroundColor White

# ======================== 手动测试命令 ========================
Write-Host "`n[手动测试]" -ForegroundColor Yellow
Write-Host "  立即执行一次备份以验证:" -ForegroundColor DarkGray
Write-Host "  cd $ProjectRoot && bash scripts/backup.sh $BackupDir" -ForegroundColor White

# ======================== 完成 ========================
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " 配置完成!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  任务名:    $TaskName" -ForegroundColor White
Write-Host "  下次执行:  明日 02:00 (或立即手动触发测试)" -ForegroundColor White
Write-Host "  备份路径:  $BackupDir" -ForegroundColor White
Write-Host "  日志路径:  $logDir\scheduled_backup.log" -ForegroundColor White
Write-Host "" -ForegroundColor White
Write-Host "  管理命令:" -ForegroundColor DarkGray
Write-Host "    查看任务:  Get-ScheduledTask -TaskName '$TaskName'" -ForegroundColor DarkGray
Write-Host "    手动触发:  Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor DarkGray
Write-Host "    查看日志:  Get-ScheduledTaskInfo -TaskName '$TaskName'" -ForegroundColor DarkGray
Write-Host "    移除任务:  .\scripts\schedule-backup.ps1 -Remove" -ForegroundColor DarkGray
Write-Host "============================================================" -ForegroundColor Green
