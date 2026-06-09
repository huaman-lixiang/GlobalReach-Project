# ==============================================================================
# GlobalReach V2.0 — 备份定时任务注册脚本 (M-D01)
# Windows Task Scheduler 一键注册/注销/状态查询
#
# 用法:
#   .\register-backup-task.ps1                     # 查看当前任务状态
#   .\register-backup-task.ps1 -Action Register     # 注册定时任务
#   .\register-backup-task.ps1 -Action UnRegister    # 注销定时任务
#   .\register-backup-task.ps1 -Action Status        # 查看详细状态
#
# 可选参数:
#   -BackupScriptPath  备份脚本路径 (默认: scripts/backup.sh)
#   -ScheduleTime      计划执行时间 (默认: 02:00)
#   -BackupDir         备份目标目录 (默认: C:\backups\globalreach)
#   -RetentionDays     备份保留天数 (默认: 30)
#   -NotifyEmail       通知邮箱 (可选)
#
# 兼容性:
#   - Windows Server 2019+
#   - 支持 WSL2 bash.exe 和 Git Bash 两种执行方式
# ==============================================================================

[CmdletBinding()]
param(
    [ValidateSet("Register","UnRegister","Status")]
    [string]$Action = "Status",

    [string]$BackupScriptPath = "$PSScriptRoot\backup.sh",
    [string]$ScheduleTime = "02:00",
    [string]$BackupDir = "C:\backups\globalreach",
    [int]$RetentionDays = 30,
    [string]$NotifyEmail = ""
)

$ErrorActionPreference = "Stop"
$TaskName = "GlobalReach-DailyBackup"
$ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent)

# ======================== 颜色工具函数 ========================
function Write-Header([string]$Text) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host " $Text" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
}

function Write-Section([string]$Text) {
    Write-Host "`n[$Text]" -ForegroundColor Yellow
}

# ======================== Bash 探测 ========================
function Test-BashAvailable {
    <#
    .SYNOPSIS
    检测系统中可用的 Bash 环境 (WSL2 / Git Bash / MSYS2)
    #>
    $bashPaths = @(
        "C:\Windows\System32\bash.exe",          # WSL2 默认路径
        "C:\Program Files\Git\bin\bash.exe",      # Git for Windows
        "C:\Program Files\Git\usr\bin\bash.exe",
        "${env:ProgramFiles(x86)}\Git\bin\bash.exe"
    )

    foreach ($p in $bashPaths) {
        if (Test-Path $p) {
            return @{
                Path = $p
                Type = if ($p -match "System32") { "WSL2" } else { "Git Bash" }
            }
        }
    }

    # 尝试通过 PATH 查找
    try {
        $found = Get-Command bash -ErrorAction Stop | Select-Object -First 1
        return @{
            Path = found.Source
            Type = "PATH"
        }
    } catch {}

    return $null
}

# ======================== Action: Status ========================
if ($Action -eq "Status") {
    Write-Header "GlobalReach V2.0 — 备份定时任务状态查询 (M-D01)"

    Write-Section "任务基本信息"
    Write-Host "  任务名称:     $TaskName" -ForegroundColor White
    Write-Host "  备份脚本:     $BackupScriptPath" -ForegroundColor White
    Write-Host "  计划时间:     每天 $ScheduleTime" -ForegroundColor White
    Write-Host "  备份目录:     $BackupDir" -ForegroundColor White

    # 检查任务是否存在
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

    if ($task) {
        Write-Section "任务状态"
        $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue

        $stateColor = switch ($task.State) {
            "Ready"       { "Green" }
            "Running"     { "Yellow" }
            "Disabled"    { "DarkGray" }
            default       { "Red" }
        }

        Write-Host "  注册状态:     已注册" -ForegroundColor Green
        Write-Host "  当前状态:     $($task.State)" -ForegroundColor $stateColor
        Write-Host "  描述:         $($task.Description)" -ForegroundColor DarkGray

        if ($taskInfo) {
            $lastRun = if ($taskInfo.LastRunTime -gt [DateTime]::MinValue) {
                $taskInfo.LastRunTime.ToString("yyyy-MM-dd HH:mm:ss")
            } else { "(从未运行)" }

            $nextRun = if ($taskInfo.NextRunTime -gt [DateTime]::MinValue) {
                $taskInfo.NextRunTime.ToString("yyyy-MM-dd HH:mm:ss")
            } else { "(未计划)" }

            $lastResult = switch ($taskInfo.LastTaskResult) {
                0       { "成功 (0x0000)" }
                267006  { "任务尚未运行" }
                267010  { "已有实例在运行" }
                default { "错误 (0x$($taskInfo.LastTaskResult.ToString('X8')))" }
            }

            Write-Host "  上次运行:     $lastRun" -ForegroundColor White
            Write-Host "  下次运行:     $nextRun" -ForegroundColor White
            Write-Host "  最后结果:     $lastResult" -ForegroundColor $(if ($taskInfo.LastTaskResult -eq 0) { "Green" } else { "Red" })
        }

        # 显示触发器详情
        Write-Section "触发器配置"
        foreach ($trigger in $task.Triggers) {
            Write-Host "  类型:         $($trigger.GetType().Name)" -ForegroundColor DarkGray
            if ($trigger.StartBoundary) {
                Write-Host "  计划时间:     $($trigger.StartBoundary)" -ForegroundColor White
            }
        }

        # 显示执行动作
        Write-Section "执行动作"
        foreach ($action in $task.Actions) {
            Write-Host "  执行程序:     $($action.Execute)" -ForegroundColor White
            Write-Host "  参数:         $($action.Arguments)" -ForegroundColor DarkGray
            if ($action.WorkingDirectory) {
                Write-Host "  工作目录:     $($action.WorkingDirectory)" -ForegroundColor DarkGray
            }
        }
    } else {
        Write-Section "任务状态"
        Write-Host "  注册状态:     未注册" -ForegroundColor Red
        Write-Host "" -ForegroundColor DarkGray
        Write-Host "  使用以下命令注册:" -ForegroundColor DarkGray
        Write-Host "  .\register-backup-task.ps1 -Action Register" -ForegroundColor White
    }

    # Bash 环境检测
    Write-Section "Bash 环境检测"
    $bashInfo = Test-BashAvailable
    if ($bashInfo) {
        Write-Host "  Bash 路径:    $($bashInfo.Path)" -ForegroundColor Green
        Write-Host "  环境类型:     $($bashInfo.Type)" -ForegroundColor Green
    } else {
        Write-Host "  Bash:         未检测到 WSL2/Git Bash" -ForegroundColor DarkYellow
        Write-Host "  回退方案:     将使用 PowerShell 方式调用备份" -ForegroundColor DarkYellow
    }

    # 备份目录检查
    Write-Section "备份目录"
    if (Test-Path $BackupDir) {
        $backups = Get-ChildItem -Path $BackupDir -Filter "globalreach_backup_*.tar.gz" -ErrorAction SilentlyContinue |
                   Sort-Object LastWriteTime -Descending |
                   Select-Object -First 5
        $totalSize = (Get-ChildItem -Path $BackupDir -Recurse -File -ErrorAction SilentlyContinue |
                      Measure-Object -Property Length -Sum).Sum

        Write-Host "  目录状态:     存在" -ForegroundColor Green
        Write-Host "  占用空间:     $([math]::Round($totalSize / 1MB, 2)) MB" -ForegroundColor White
        Write-Host "  最近备份:" -ForegroundColor White

        foreach ($b in $backups) {
            $sizeMB = [math]::Round($b.Length / 1MB, 2)
            $ageDays = ((Get-Date) - $b.LastWriteTime).Days
            $ageStr = if ($ageDays -eq 0) { "今天" } elseif ($ageDays -eq 1) { "昨天" } else { "$ageDays 天前" }
            Write-Host "    $($b.Name)  (${sizeMB} MB, $ageStr)" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  目录状态:     不存在 (注册时会自动创建)" -ForegroundColor DarkYellow
    }

    Write-Header "状态查询完成"
    return
}

# ======================== Action: UnRegister ========================
if ($Action -eq "UnRegister") {
    Write-Header "GlobalReach V2.0 — 注销备份定时任务 (M-D01)"

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

    if (-not $task) {
        Write-Host "`n  [INFO] 任务 '$TaskName' 不存在，无需注销" -ForegroundColor DarkYellow
        return
    }

    Write-Section "确认注销"
    Write-Host "  即将注销以下任务:" -ForegroundColor Yellow
    Write-Host "  名称: $TaskName" -ForegroundColor White
    Write-Host "  状态: $($task.State)" -ForegroundColor White
    Write-Host ""
    Write-Host "  ⚠️  注销后自动备份将停止!" -ForegroundColor Red
    Write-Host ""

    try {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
        Write-Host "  [OK] 任务 '$TaskName' 已成功注销" -ForegroundColor Green
    } catch {
        Write-Host "  [ERROR] 注销失败: $_" -ForegroundColor Red
        exit 1
    }

    Write-Section "后续操作提示"
    Write-Host "  如需重新注册，请运行:" -ForegroundColor DarkGray
    Write-Host "  .\register-backup-task.ps1 -Action Register" -ForegroundColor White
    Write-Host ""
    Write-Host "  手动执行一次备份验证:" -ForegroundColor DarkGray
    Write-Host "  .\test-backup.ps1" -ForegroundColor White

    Write-Header "注销完成"
    return
}

# ======================== Action: Register ========================
if ($Action -eq "Register") {
    Write-Header "GlobalReach V2.0 — 注册备份定时任务 (M-D01)"

    # ---- 参数展示 ----
    Write-Section "配置参数"
    Write-Host "  项目根目录:   $ProjectRoot"
    Write-Host "  备份脚本:     $BackupScriptPath"
    Write-Host "  计划时间:     每天 $ScheduleTime"
    Write-Host "  备份目录:     $BackupDir"
    Write-Host "  保留天数:     $RetentionDays"
    Write-Host "  通知邮箱:     $(if ($NotifyEmail) { $NotifyEmail } else { '(未配置)' })"

    # ---- 前置检查 ----
    Write-Section "前置检查"

    # 1. 备份脚本存在性
    if (-not (Test-Path $BackupScriptPath)) {
        Write-Host "  [ERROR] 备份脚本不存在: $BackupScriptPath" -ForegroundColor Red
        exit 1
    }
    Write-Host "  [OK] 备份脚本存在" -ForegroundColor Green

    # 2. Bash 环境检测
    $bashInfo = Test-BashAvailable
    if ($bashInfo) {
        Write-Host "  [OK] Bash 可用: $($bashInfo.Type) @ $($bashInfo.Path)" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] Bash 未检测到，将使用 PowerShell 回退模式" -ForegroundColor DarkYellow
    }

    # 3. Docker 可选检测
    $dockerOk = $false
    try {
        $null = docker info --format "{{.ServerVersion}}" 2>$null
        $dockerOk = $true
        Write-Host "  [OK] Docker 可用" -ForegroundColor Green
    } catch {
        Write-Host "  [WARN] Docker 当前不可用（计划任务运行时需确保Docker正在运行）" -ForegroundColor DarkYellow
    }

    # 4. 创建备份目录
    if (-not (Test-Path $BackupDir)) {
        New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
        Write-Host "  [OK] 已创建备份目录: $BackupDir" -ForegroundColor Green
    } else {
        Write-Host "  [OK] 备份目录已存在: $BackupDir" -ForegroundColor Green
    }

    # 5. 日志目录
    $logDir = Join-Path $ProjectRoot "logs"
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    # ---- 构建执行命令 ----
    Write-Section "构建执行命令"

    if ($bashInfo) {
        # 通过 bash 执行 backup.sh（推荐方式）
        $bashExe = $bashInfo.Path
        $action = New-ScheduledTaskAction `
            -Execute $bashExe `
            -Argument "-c `"BACKUP_DIR=$BackupDir RETENTION_DAYS=$RetentionDays bash '$(Resolve-Path $BackupScriptPath)' 2>&1 | tee -a '$logDir\scheduled_backup.log'`""
        Write-Host "  执行方式: $($bashInfo.Type) → backup.sh" -ForegroundColor White
    } else {
        # PowerShell 回退方式
        $psBackupScript = Join-Path $ProjectRoot "scripts\s079-backup.ps1"
        $action = New-ScheduledTaskAction `
            -Execute "powershell.exe" `
            -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$psBackupScript`"" `
            -WorkingDirectory $ProjectRoot
        Write-Host "  执行方式: powershell.exe → s079-backup.ps1 (回退模式)" -ForegroundColor DarkYellow
    }

    # ---- 触发器 ----
    $trigger = New-ScheduledTaskTrigger -Daily -At $ScheduleTime
    Write-Host "  触发器:   每天 $ScheduleTime" -ForegroundColor White

    # ---- 设置 (高可靠性) ----
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 5)

    # ---- 权限 (SYSTEM, 最高级别) ----
    $principal = New-ScheduledTaskPrincipal `
        -UserId "SYSTEM" `
        -LogonType ServiceAccount `
        -RunLevel Highest

    Write-Section "权限与策略"
    Write-Host "  运行身份:   SYSTEM (服务账户, 最高权限)" -ForegroundColor White
    Write-Host "  超时限制:   2 小时" -ForegroundColor White
    Write-Host "  重试策略:   失败后重试 3 次，间隔 5 分钟" -ForegroundColor White
    Write-Host "  电池策略:   允许电池供电时启动/继续" -ForegroundColor White

    # ---- 注册/更新任务 ----
    Write-Section "注册计划任务"

    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

    try {
        if ($existingTask) {
            Set-ScheduledTask -TaskName $TaskName `
                -Action $action `
                -Trigger $trigger `
                -Settings $settings `
                -Principal $principal `
                -ErrorAction Stop | Out-Null
            Write-Host "  [OK] 已更新现有任务: $TaskName" -ForegroundColor Green
        } else {
            Register-ScheduledTask -TaskName $TaskName `
                -Action $action `
                -Trigger $trigger `
                -Settings $settings `
                -Principal $principal `
                -Description "GlobalReach V2.0 M-D01 每日自动备份 (PostgreSQL + Redis + Grafana + Nginx + Config) via $($(if($bashInfo){$bashInfo.Type}else{'PowerShell'}))" `
                -ErrorAction Stop | Out-Null
            Write-Host "  [OK] 已注册新任务: $TaskName" -ForegroundColor Green
        }
    } catch {
        Write-Host "  [ERROR] 注册失败: $_" -ForegroundColor Red
        if ($_.Exception.Message -match "访问被拒绝|Access Denied") {
            Write-Host "  [HINT] 请以管理员身份运行此脚本!" -ForegroundColor Magenta
        }
        exit 1
    }

    # ---- 验证注册 ----
    Write-Section "验证注册结果"
    $verifyTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($verifyTask) {
        $verifyInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
        Write-Host "  [OK] 任务已确认注册" -ForegroundColor Green
        Write-Host "  状态: $($verifyTask.State)" -ForegroundColor White
        if ($verifyInfo -and $verifyInfo.NextRunTime -gt [DateTime]::MinValue) {
            Write-Host "  下次运行: $($verifyInfo.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor White
        }
    }

    # ---- 邮件通知提示 ----
    if ($NotifyEmail) {
        Write-Section "邮件通知"
        Write-Host "  目标邮箱: $NotifyEmail" -ForegroundColor White
        Write-Host "  提示: 请在 Grafana Alertmanager 中配置邮件通知通道" -ForegroundColor DarkGray
    }

    # ---- 完成 ----
    Write-Header "注册完成!"

    Write-Host ""
    Write-Host "  任务名称:   $TaskName" -ForegroundColor White
    Write-Host "  下次执行:   明天 $ScheduleTime (或立即手动触发测试)" -ForegroundColor White
    Write-Host "  备份路径:   $BackupDir" -ForegroundColor White
    Write-Host "  日志文件:   $logDir\scheduled_backup.log" -ForegroundColor White
    Write-Host ""
    Write-Host "  常用管理命令:" -ForegroundColor DarkGray
    Write-Host "    查看状态:  .\register-backup-task.ps1 -Action Status" -ForegroundColor DarkGray
    Write-Host "    手动触发:  Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor DarkGray
    Write-Host "    测试备份:  .\test-backup.ps1" -ForegroundColor DarkGray
    Write-Host "    注销任务:  .\register-backup-task.ps1 -Action UnRegister" -ForegroundColor DarkGray
    Write-Host ""
}
