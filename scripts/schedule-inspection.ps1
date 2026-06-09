# ==============================================================================
# GlobalReach V2.0 — 自动化巡检调度器 (Automated Inspection Scheduler)
# O03: Windows Task Scheduler 定时巡检注册脚本
#
# Usage:
#   .\scripts\schedule-inspection.ps1                        # 使用默认参数
#   .\scripts\schedule-inspection.ps1 -Interval 1800         # 每30分钟
#   .\scripts\schedule-inspection.ps1 -Remove               # 移除定时任务
#   .\scripts\schedule-inspection.ps1 -Status                # 查看任务状态
#
# 默认行为:
#   - 创建每 6 小时执行一次的全量巡检任务
#   - 报告保存到 ./reports/inspection/
#   - 保留最近 30 天的报告
#   - 异常时发送通知（预留 webhook 接口）
#
# 与 schedule-backup.ps1 的关系:
#   - backup 脚本关注数据持久化（每日凌晨2点）
#   - inspection 脚本关注系统健康监控（每6小时循环）
#   - 两者互补，共同构成完整的运维自动化体系
# ==============================================================================

[CmdletBinding()]
param(
    [int]$Interval = 21600,                    # 巡检间隔(秒), 默认6小时 (21600s)
    [string]$ReportDir = "",                   # 报告目录, 默认 ./reports/inspection/
    [int]$RetentionDays = 30,                  # 报告保留天数
    [string]$WebhookUrl = "",                  # 异常通知 Webhook URL
    [string]$TaskName = "GlobalReach-Inspection-O03",
    [switch]$Quick,                            # 快速模式开关
    [switch]$Remove,                           # 移除定时任务
    [switch]$Status,                           # 查看任务状态
    [switch]$WhatIf,                           # 模拟执行
    [switch]$Force                             # 强制更新已有任务
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent)

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " GlobalReach V2.0 — 自动化巡检定时任务配置 (O03)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# ======================== 参数展示 ========================
Write-Host "`n[配置参数]" -ForegroundColor Yellow
Write-Host "  项目路径:      $ProjectRoot"
Write-Host "  巡检间隔:      $Interval 秒 ($([math]::Round($Interval/3600, 1)) 小时)"
Write-Host "  报告目录:      $(if ($ReportDir) { $ReportDir } else { "$ProjectRoot\reports\inspection" })"
Write-Host "  保留天数:      $RetentionDays 天"
Write-Host "  任务名称:      $TaskName"
Write-Host "  快速模式:      $(if ($Quick) { '启用' } else { '禁用' })"
Write-Host "  通知Webhook:   $(if ($WebhookUrl) { $WebhookUrl } else { '(未配置)' })"

# 设置默认报告目录
if ([string]::IsNullOrWhiteSpace($ReportDir)) {
    $ReportDir = Join-Path $ProjectRoot "reports\inspection"
}

# ======================== 状态查看模式 ========================
if ($Status) {
    Write-Host "`n[任务状态] $TaskName" -ForegroundColor Yellow

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue

        Write-Host "`n  任务状态:" -ForegroundColor White
        Write-Host "    状态:     $($task.State)" -ForegroundColor Green
        Write-Host "    描述:     $($task.Description)" -ForegroundColor Gray
        if ($taskInfo) {
            Write-Host "    上次运行: $(if($taskInfo.LastRunTime -gt [datetime]::MinValue){ $taskInfo.LastRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { '从未运行' })" -ForegroundColor Gray
            Write-Host "    上次结果: $($taskInfo.LastTaskResult)" -ForegroundColor $(if ($taskInfo.LastTaskResult -eq 0) { 'Green' } else { 'Yellow' })
            Write-Host "    下次运行: $($task.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Gray
            Write-Host "    运行次数: $($taskInfo.RunCount)" -ForegroundColor Gray
        }

        Write-Host "`n  触发器:" -ForegroundColor White
        foreach ($trigger in $task.Triggers) {
            Write-Host "    类型: $($trigger.CimClass.CimClassName.Replace('MSFT_Task', ''))" -ForegroundColor Gray
            if ($trigger.Repetition) {
                Write-Host "    重复: 每 $($trigger.Repetition.Interval) (持续:$($trigger.Repetition.Duration))" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "  [INFO] 任务 '$TaskName' 不存在，尚未注册" -ForegroundColor DarkGray
    }

    # 显示最近报告
    Write-Host "`n  最近报告:" -ForegroundColor White
    if (Test-Path $ReportDir) {
        $recentReports = Get-ChildItem -Path $ReportDir -Filter "*.json" -Recurse `
            | Sort-Object LastWriteTime -Descending | Select-Object -First 5

        if ($recentReports.Count -gt 0) {
            foreach ($report in $recentReports) {
                $age = ((Get-Date) - $report.LastWriteTime)
                $ageStr = if ($age.Days -gt 0) { "$($age.Days)天前" }
                          elseif ($age.Hours -gt 0) { "$($age.Hours)小时前" }
                          else { "$($age.Minutes)分钟前" }
                Write-Host "    [$ageStr] $($report.Name)" -ForegroundColor $(if ($age.Hours -lt 24) { 'Green' } else { 'Yellow' })
            }
        } else {
            Write-Host "    (无报告文件)" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "    (报告目录不存在)" -ForegroundColor DarkGray
    }

    return
}

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
    Write-Host "  crontab -l | grep health-inspection | crontab -" -ForegroundColor DarkGray
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

# 检查巡检脚本是否存在
$InspectionScript = Join-Path $ProjectRoot "scripts\health-inspection.sh"
if (-not (Test-Path $InspectionScript)) {
    throw "巡检脚本不存在: $InspectionScript`n请先创建 scripts/health-inspection.sh"
}
Write-Host "  [OK] 巡检脚本存在: $InspectionScript" -ForegroundColor Green

# 创建报告目录
if (-not (Test-Path $ReportDir)) {
    if ($WhatIf) {
        Write-Host "  [WHATIF] 将创建目录: $ReportDir" -ForegroundColor DarkGray
    } else {
        New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
        Write-Host "  [OK] 已创建报告目录: $ReportDir" -ForegroundColor Green
    }
}

# 确保日志目录存在
$logDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# ======================== 构建巡检命令 ========================
Write-Host "`n[构建执行命令]" -ForegroundColor Yellow

# 构建环境变量和参数
$envVars = @(
    "RETENTION_DAYS=$RetentionDays"
)

if ($WebhookUrl) {
    $envVars += "INSPECTION_WEBHOOK_URL=$WebhookUrl"
}

$scriptArgs = "--report --output `"$ReportDir`""
if ($Quick) {
    $scriptArgs += " --quick"
}

if ($bashAvailable) {
    # 通过 bash 执行 health-inspection.sh（推荐方式）
    $envString = $envVars -join " "
    $action = New-ScheduledTaskAction `
        -Execute "bash.exe" `
        -Argument "-c `"${envString} bash '$InspectionScript' $scriptArgs 2>&1 | tee -a '$logDir\scheduled_inspection.log'`""
    Write-Host "  执行方式: bash.exe → health-inspection.sh" -ForegroundColor White
} else {
    # 回退到 PowerShell 调用（兼容模式）
    $psInspectionScript = Join-Path $ProjectRoot "scripts\inspection-engine.ps1"
    if (-not (Test-Path $psInspectionScript)) {
        Write-Host "  [WARN] PowerShell回退脚本不存在，将直接调用bash" -ForegroundColor DarkYellow
        $action = New-ScheduledTaskAction `
            -Execute "bash.exe" `
            -Argument "-c `"bash '$InspectionScript' $scriptArgs 2>&1 | tee -a '$logDir\scheduled_inspection.log'`""
    } else {
        $action = New-ScheduledTaskAction `
            -Execute "powershell.exe" `
            -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$psInspectionScript`"" `
            -WorkingDirectory $ProjectRoot
        Write-Host "  执行方式: powershell.exe → inspection-engine.ps1 (回退)" -ForegroundColor DarkYellow
    }
}

# ======================== 触发器: 根据间隔设置 ========================
Write-Host "`n[触发器配置]" -ForegroundColor Yellow

# 计算触发器类型
if ($Interval -ge 86400) {
    # >= 24小时：每天执行
    $dailyInterval = [math]::Floor($Interval / 3600)
    $trigger = New-ScheduledTaskTrigger -Daily -At (Get-Date -Hour 0 -Minute 0 -Second 0)
    Write-Host "  触发类型: 每日执行" -ForegroundColor White
    Write-Host "  执行时间: 00:00 (每 ${dailyInterval} 小时等效)" -ForegroundColor White
} elseif ($Interval -ge 3600) {
    # >= 1小时：每小时重复
    $hours = [math]::Floor($Interval / 3600)
    $minutes = [math]::Floor(($Interval % 3600) / 60)
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours $hours -Minutes $minutes) -RepetitionDuration ([TimeSpan]::MaxValue)
    Write-Host "  触发类型: 重复执行" -ForegroundColor White
    Write-Host "  间隔: ${hours}h ${minutes}m" -ForegroundColor White
} else {
    # < 1小时：按分钟重复
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Seconds $Interval) -RepetitionDuration ([TimeSpan]::MaxValue)
    Write-Host "  触发类型: 频繁重复" -ForegroundColor White
    Write-Host "  间隔: ${Interval} 秒" -ForegroundColor White
}

# ======================== 设置 ========================
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `       # 巡检最长执行1小时
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5)           # 失败后重试3次，间隔5分钟

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
    Write-Host "  运行身份:     SYSTEM (最高权限)" -ForegroundColor White
    Write-Host "  超时限制:     1 小时" -ForegroundColor White
    Write-Host "  重试策略:     3次 / 间隔5分钟" -ForegroundColor White
    Write-Host "  报告输出:     $ReportDir" -ForegroundColor White
    Write-Host "  数据保留:     $RetentionDays 天" -ForegroundColor White
} else {
    if ($existingTask -and -not $Force) {
        Write-Host "  [WARN] 任务已存在: $TaskName" -ForegroundColor Yellow
        Write-Host "  使用 -Force 参数强制更新，或先使用 -Remove 移除" -ForegroundColor DarkGray
        return
    } elseif ($existingTask -and $Force) {
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
            -Description "GlobalReach V2.0 O03 自动化健康巡检引擎 (5维度全量检查 + HTML报告生成)" `
            -ErrorAction Stop | Out-Null
        Write-Host "  [OK] 已注册新任务: $TaskName" -ForegroundColor Green
    }
}

# ======================== 通知配置 ========================
if ($WebhookUrl) {
    Write-Host "`n[异常通知]" -ForegroundColor Yellow
    Write-Host "  Webhook URL: $WebhookUrl" -ForegroundColor White
    Write-Host "  触发条件:   巡检发现 FAIL 级别问题时自动发送" -ForegroundColor Gray
    Write-Host "  Payload:     完整的 JSON 巡检报告" -ForegroundColor Gray
} else {
    Write-Host "`n[异常通知] 未配置 Webhook (可选)" -ForegroundColor DarkGray
    Write-Host "  配置方法:   -WebhookUrl 'https://your-webhook-url/notify'" -ForegroundColor DarkGray
}

# ======================== WSL Crontab 备选方案 ========================
Write-Host "`n[WSL2 Crontab 备选方案]" -ForegroundColor Yellow
$cronEntry = "*/6 * * * * cd $ProjectRoot && $envVars bash scripts/health-inspection.sh --report --output $ReportDir >> $logDir/cron_inspection.log 2>&1"
Write-Host "  如需在 WSL2 中使用 cron，添加以下行到 crontab:" -ForegroundColor DarkGray
Write-Host "  $cronEntry" -ForegroundColor White

# ======================== 报告清理策略 ========================
Write-Host "`n[报告清理策略]" -ForegroundColor Yellow
Write-Host "  保留周期:     最近 $RetentionDays 天" -ForegroundColor White
Write-Host "  清理方式:     脚本内置 find -mtime +N -delete" -ForegroundColor Gray
Write-Host "  输出格式:     JSON (原始数据) + HTML (可视化报告)" -ForegroundColor Gray

# ======================== 手动测试命令 ========================
Write-Host "`n[手动测试]" -ForegroundColor Yellow
Write-Host "  立即执行一次巡检以验证:" -ForegroundColor DarkGray
Write-Host "  cd $ProjectRoot && bash scripts/health-inspection.sh --report --output $ReportDir" -ForegroundColor White
Write-Host "" -ForegroundColor DarkGray
Write-Host "  快速模式测试:" -ForegroundColor DarkGray
Write-Host "  cd $ProjectRoot && bash scripts/health-inspection.sh --quick" -ForegroundColor White

# ======================== 完成 ========================
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " 配置完成!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  任务名:    $TaskName" -ForegroundColor White
Write-Host "  巡检间隔:  $([math]::Round($Interval/3600, 1)) 小时" -ForegroundColor White
Write-Host "  报告路径:  $ReportDir" -ForegroundColor White
Write-Host "  日志路径:  $logDir\scheduled_inspection.log" -ForegroundColor White
Write-Host "  首次执行:  即将开始 (或手动触发测试)" -ForegroundColor White
Write-Host "" -ForegroundColor White
Write-Host "  管理命令:" -ForegroundColor DarkGray
Write-Host "    查看状态:  .\scripts\schedule-inspection.ps1 -Status" -ForegroundColor DarkGray
Write-Host "    手动触发:  Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor DarkGray
Write-Host "    查看日志:  Get-ScheduledTaskInfo -TaskName '$TaskName'" -ForegroundColor DarkGray
Write-Host "    移除任务:  .\scripts\schedule-inspection.ps1 -Remove" -ForegroundColor DarkGray
Write-Host "    更新任务:  .\scripts\schedule-inspection.ps1 -Force" -ForegroundColor DarkGray
Write-Host "============================================================" -ForegroundColor Green
