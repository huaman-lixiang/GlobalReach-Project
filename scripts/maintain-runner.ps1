<#
.SYNOPSIS
    GlobalReach V2.0 — Self-hosted GitHub Actions Runner 维护工具
.DESCRIPTION
    提供 Runner 日常维护功能:
    status   - 显示 Runner 状态 (在线/离线/忙碌)
    update   - 更新 Runner 到最新版本
    clean    - 清理过期的工作目录
    logs     - 查看最近日志
    unregister - 注销 Runner
.NOTES
    任务编号: M-E01
    用法: .\maintain-runner.ps1 <command> [options]
.EXAMPLE
    .\maintain-runner.ps1 status
    .\maintain-runner.ps1 clean -Days 7
    .\maintain-runner.ps1 update
    .\maintain-runner.ps1 logs -Lines 100
    .\maintain-runner.ps1 unregister -Token <token>
#>

[CmdletBinding(DefaultParameterSetName = "Help")]
param(
    [Parameter(ParameterSetName = "Command", Position = 0)]
    [ValidateSet("status", "update", "clean", "logs", "unregister")]
    [string]$Command,

    [Parameter(ParameterSetName = "Command")]
    [int]$Days = 7,

    [Parameter(ParameterSetName = "Command")]
    [int]$Lines = 50,

    [Parameter(ParameterSetName = "Command")]
    [string]$Token = "",

    [Parameter(ParameterSetName = "Command")]
    [string]$RunnerHome = "C:\actions-runner",

    [Parameter(ParameterSetName = "Help")]
    [switch]$Help
)

$ErrorActionPreference = "SilentlyContinue"
$Host.UI.RawUI.WindowTitle = "GlobalReach Runner Maintenance"

# ============================================================
# 帮助信息
# ============================================================

if ($PsCmdlet.ParameterSetName -eq "Help" -or -not $Command) {
    Write-Host @"
$(if ($Host.UI.RawUI.ForegroundColor) { "" })╔══════════════════════════════════════════════════════════════╗
║  GlobalReach V2.0 — Self-hosted Runner 维护工具 (M-E01)        ║
╠══════════════════════════════════════════════════════════════╣
║  用法:                                                        ║
║    .\maintain-runner.ps1 <命令> [选项]                         ║
║                                                               ║
║  命令:                                                        ║
║    status      显示 Runner 状态 (在线/离线/忙碌)               ║
║    update      更新 Runner 到最新版本                          ║
║    clean       清理过期的工作目录                              ║
║    logs        查看最近日志                                    ║
║    unregister  注销并移除 Runner                              ║
║                                                               ║
║  选项:                                                        ║
║    -RunnerHome <路径>   Runner 安装目录 (默认: C:\actions-runner)║
║    -Days <数字>         清理多少天前的数据 (默认: 7)           ║
║    -Lines <数字>        显示多少行日志 (默认: 50)              ║
║    -Token <字符串>      Runner Token (用于 unregister)         ║
║                                                               ║
║  示例:                                                        ║
║    .\maintain-runner.ps1 status                               ║
║    .\maintain-runner.ps1 clean -Days 14                       ║
║    .\maintain-runner.ps1 update                               ║
║    .\maintain-runner.ps1 logs -Lines 200                      ║
║    .\maintain-runner.ps1 unregister -Token ABC123...          ║
╚══════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan
    exit 0
}

# ============================================================
# 公共函数
# ============================================================

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "--- $Title ---" -ForegroundColor Yellow
}

function Write-Ok { param([string]$Msg) Write-Host "  ✓ $Msg" -ForegroundColor Green }
function Write-Err { param([string]$Msg) Write-Host "  ✗ $Msg" -ForegroundColor Red }
function Write-Wrn { param([string]$Msg) Write-Host "  ⚠ $Msg" -ForegroundColor Yellow }

function Assert-RunnerHome {
    if (-not (Test-Path $RunnerHome)) {
        Write-Err "Runner 目录不存在: $RunnerHome"
        Write-Host "  请先运行 setup-runner.ps1 安装 Runner" -ForegroundColor Gray
        exit 1
    }
    if (-not (Test-Path (Join-Path $RunnerHome "run.cmd"))) {
        Write-Err "无效的 Runner 目录: $RunnerHome (缺少 run.cmd)"
        exit 1
    }
}

function Get-RunnerConfig {
    $configFile = Join-Path $RunnerHome "runner-config.json"
    if (Test-Path $configFile) {
        return Get-Content $configFile -Raw | ConvertFrom-Json
    }
    return $null
}

# ============================================================
# COMMAND: status
# ============================================================

function Invoke-Status {
    Write-Section "Runner 状态检查"
    Assert-RunnerHome

    $cfg = Get-RunnerConfig

    # 基本信息
    Write-Host "`n  [基本信息]" -ForegroundColor Cyan
    if ($cfg) {
        Write-Host "  名称       : $($cfg.runnerName)" -ForegroundColor White
        Write-Host "  版本       : $($cfg.version)" -ForegroundColor White
        Write-Host "  仓库       : $($cfg.repoUrl)" -ForegroundColor White
        Write-Host "  标签       : $($cfg.labels)" -ForegroundColor White
        Write-Host "  安装时间   : $($cfg.installedAt)" -ForegroundColor White
    } else {
        Write-Wrn "未找到配置文件 (runner-config.json)"
    }
    Write-Host "  安装路径   : $RunnerHome" -ForegroundColor White

    # Windows Service 状态
    Write-Host "`n  [Service 状态]" -ForegroundColor Cyan
    $services = Get-Service "actions.runner.*" -ErrorAction SilentlyContinue
    if ($services) {
        foreach ($svc in $services) {
            $icon = switch ($svc.Status) {
                'Running' { '🟢' }
                'Stopped' { '🔴' }
                default   { '🟡' }
            }
            Write-Host "  $icon $($svc.Name)" -NoNewline
            Write-Host " -> $($svc.Status)" -ForegroundColor $(if ($svc.Status -eq 'Running') { 'Green' } else { 'Red' })
            Write-Host "     DisplayName: $($svc.DisplayName)" -ForegroundColor Gray
            Write-Host "     StartType:  $($svc.StartType)" -ForegroundColor Gray
        }
    } else {
        Write-Err "未找到 Runner Service"
    }

    # 进程状态
    Write-Host "`n  [进程状态]" -ForegroundColor Cyan
    $processes = Get-Process -Name "*Runner.Worker*", "*Runner.Listener*" -ErrorAction SilentlyContinue
    if ($processes) {
        foreach ($proc in $processes) {
            $memMB = [Math]::Round($proc.WorkingSet64 / 1MB, 0)
            $cpuTime = $proc.TotalProcessorTime.ToString(@"hh\:mm\:ss")
            Write-Ok "$($proc.ProcessName) PID=$($proc.Id) Memory=${memMB}MB CPU=$cpuTime"
        }
    } else {
        Write-Wrn "未找到运行中的 Runner 进程"
    }

    # 系统资源
    Write-Host "`n  [系统资源]" -ForegroundColor Cyan
    $os = Get-CimInstance Win32_OperatingSystem
    $totalMemGB = [Math]::Round($os.TotalPhysicalMemory / 1GB, 1)
    $freeMemGB = [Math]::Round($os.FreePhysicalMemory / 1MB, 1)
    $memPercent = [Math]::Round((1 - $freeMemGB / $totalMemGB) * 100, 1)
    $cpuLoad = (Get-CimInstance Win32_Processor).LoadPercentage

    $memColor = if ($memPercent -lt 70) { 'Green' } elseif ($memPercent -lt 85) { 'Yellow' } else { 'Red' }
    $cpuColor = if ($cpuLoad -lt 60) { 'Green' } elseif ($cpuLoad -lt 80) { 'Yellow' } else { 'Red' }

    Write-Host "  CPU 使用率 : $cpuLoad%" -ForegroundColor $cpuColor
    Write-Host "  内存使用率 : $memPercent% ($([Math]::Round($totalMemGB - $freeMemGB, 1)) / $totalMemGB GB)" -ForegroundColor $memColor

    # 磁盘空间
    $driveLetter = ($RunnerHome.Substring(0, 1))
    $disk = Get-PSDrive $driveLetter -ErrorAction SilentlyContinue
    if ($disk) {
        $diskUsedGB = [Math]::Round($disk.Used / 1GB, 1)
        $diskFreeGB = [Math]::Round($disk.Free / 1GB, 1)
        $diskTotalGB = [Math]::Round(($disk.Used + $disk.Free) / 1GB, 1)
        $diskPercent = [Math]::Round(($disk.Used / ($disk.Used + $disk.Free)) * 100, 1)
        $diskColor = if ($diskPercent -lt 75) { 'Green' } elseif ($diskPercent -lt 90) { 'Yellow' } else { 'Red' }
        Write-Host "  磁盘 (${driveLetter}:) : $diskPercent% ($diskFreeGB GB 可用 / $diskTotalGB GB 总计)" -ForegroundColor $diskColor
    }

    # 工作目录大小
    Write-Host "`n  [工作目录]" -ForegroundColor Cyan
    $workDir = Join-Path $RunnerHome "_work"
    if (Test-Path $workDir) {
        $workSizeBytes = (Get-ChildItem $workDir -Recurse -ErrorAction SilentlyContinue |
            Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
        $workSizeMB = if ($workSizeBytes) { [Math]::Round($workSizeBytes / 1MB, 1) } else { 0 }
        $jobDirs = (Get-Directory $workDir -ErrorAction SilentlyContinue | Measure-Object).Count
        Write-Host "  _work/ 大小: $workSizeMB MB ($jobDirs 个作业目录)" -ForegroundColor White
    } else {
        Write-Host "  _work/ 不存在 (尚未执行任何作业)" -ForegroundColor Gray
    }

    # 最近日志条目
    Write-Host "`n  [最近活动]" -ForegroundColor Cyan
    $logDir = Join-Path $RunnerHome "_diag"
    if (Test-Path $logDir) {
        $latestLog = Get-ChildItem $logDir -Filter "*.log" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($latestLog) {
            Write-Host "  最新日志: $($latestLog.Name)" -ForegroundColor White
            Write-Host "  更新时间: $($latestLog.LastWriteTime)" -ForegroundColor Gray
            # 读取最后几行
            $lastLines = Get-Content $latestLog.FullName -Tail 3 -ErrorAction SilentlyContinue
            foreach ($line in $lastLines) {
                Write-Host "  > $line" -ForegroundColor DarkGray
            }
        }
    } else {
        Write-Wrn "无诊断日志"
    }

    Write-Host ""
}

# ============================================================
# COMMAND: update
# ============================================================

function Invoke-Update {
    Write-Section "Runner 更新"
    Assert-RunnerHome

    $cfg = Get-RunnerConfig
    $currentVersion = if ($cfg) { $cfg.version } else { "未知" }

    Write-Host "  当前版本: $currentVersion" -ForegroundColor White

    # 获取最新版本
    Write-Host "`n  正在查询最新版本..." -ForegroundColor Gray
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/actions/runner/releases/latest" -TimeoutSec 15
        $latestVersion = $release.tag_name -replace 'v', ''

        if ($currentVersion -eq $latestVersion) {
            Write-Ok "已是最新版本: $latestVersion"
            return
        }

        Write-Host "  最新版本: $latestVersion" -ForegroundColor Cyan
        Write-Host "  发布说明: $($release.html_url)" -ForegroundColor Gray
        Write-Host ""

        $confirm = Read-Host "  是否更新到 $latestVersion ? (y/N)"
        if ($confirm -ne 'y' -and $confirm -ne 'Y') {
            Write-Host "  已取消更新。" -ForegroundColor Gray
            return
        }

        # 停止服务
        Write-Host "`n  停止 Runner Service..." -ForegroundColor Yellow
        Push-Location $RunnerHome
        & .\svc stop 2>&1 | Out-Null
        Start-Sleep -Seconds 3
        Write-Ok "Service 已停止"

        # 下载新版本
        $downloadUrl = "https://github.com/actions/runner/releases/download/$($release.tag_name)/actions-runner-win-x64-$latestVersion.zip"
        $zipPath = Join-Path $env:TEMP "actions-runner-update-$latestVersion.zip"

        Write-Host "  下载新版本..." -ForegroundColor Yellow
        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($downloadUrl, $zipPath)
        $fileSize = [Math]::Round((Get-Item $zipPath).Length / 1MB, 1)
        Write-Ok "下载完成 ($fileSize MB)"

        # 备份配置
        Write-Host "  备份当前配置..." -ForegroundColor Yellow
        $backupDir = Join-Path $RunnerHome "_backup-$currentVersion"
        $filesToBackup = @(".credentials", ".runner", ".credentials_rsaparams")
        foreach ($f in $filesToBackup) {
            $src = Join-Path $RunnerHome $f
            if (Test-Path $src) {
                Copy-Item $src $backupDir -Force -ErrorAction SilentlyContinue
            }
        }
        Write-Ok "配置已备份"

        # 清理旧文件并解压新版本
        Write-Host "  替换 Runner 文件..." -ForegroundColor Yellow
        Get-ChildItem $RunnerHome -File -Exclude "runner-config.json","*.zip","_backup-*" -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ne '.credentials' -and $_.Name -ne '.runner' -and $_.Name -ne '.credentials_rsaparams' } |
            Remove-Item -Force -ErrorAction SilentlyContinue

        Expand-Archive -Path $zipPath -DestinationPath $RunnerHome -Force
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
        Write-Ok "文件替换完成"

        # 重启服务
        Write-Host "  重启 Runner Service..." -ForegroundColor Yellow
        & .\svc start 2>&1 | Out-Null
        Start-Sleep -Seconds 3

        # 验证
        $svc = Get-Service "actions.runner.*" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($svc -and $svc.Status -eq 'Running') {
            Write-Ok "Runner 已更新并运行中 (v$currentVersion -> v$latestVersion)"

            # 更新配置文件
            if ($cfg) {
                $cfg.version = $latestVersion
                $cfg.updatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                $cfg | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $RunnerHome "runner-config.json")
            }
        } else {
            Write-Warn "Service 可能未正常启动, 请手动检查"
        }

        Pop-Location

    } catch {
        Write-Err "更新失败: $($_.Exception.Message)"
        Write-Host "  请尝试手动更新: https://github.com/actions/runner/releases/latest" -ForegroundColor Gray
    }

    Write-Host ""
}

# ============================================================
# COMMAND: clean
# ============================================================

function Invoke-Clean {
    Write-Section "清理工作目录"
    Assert-RunnerHome

    $workDir = Join-Path $RunnerHome "_work"
    if (-not (Test-Path $workDir)) {
        Write-Ok "工作目录不存在, 无需清理"
        return
    }

    $cutoffDate = (Get-Date).AddDays(-$Days)
    Write-Host "  清理策略: 删除 $Days 天前的工作目录" -ForegroundColor White
    Write-Host "  截止日期: $cutoffDate" -ForegroundColor Gray
    Write-Host ""

    # 统计
    $allJobs = Get-ChildItem $workDir -Directory -ErrorAction SilentlyContinue
    $totalSizeBefore = 0
    $cleanedCount = 0
    $cleanedSize = 0

    foreach ($jobDir in $allJobs) {
        $dirSize = (Get-ChildItem $jobDir.FullName -Recurse -ErrorAction SilentlyContinue |
            Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
        $totalSizeBefore += if ($dirSize) { $dirSize } else { 0 }

        if ($jobDir.LastWriteTime -lt $cutoffDate) {
            $sizeMB = [Math]::Round($dirSize / 1MB, 1)
            Write-Host "  删除: $($jobDir.Name) ($sizeMB MB, 最后修改: $($jobDir.LastWriteTime))" -ForegroundColor DarkGray
            Remove-Item $jobDir.FullName -Recurse -Force -ErrorAction SilentlyContinue
            $cleanedCount++
            $cleanedSize += if ($dirSize) { $dirSize } else { 0 }
        }
    }

    $totalSizeBeforeMB = [Math]::Round($totalSizeBefore / 1MB, 1)
    $cleanedSizeMB = [Math]::Round($cleanedSize / 1MB, 1)
    $remainingSizeMB = $totalSizeBeforeMB - $cleanedSizeMB

    Write-Host ""
    Write-Host "  ┌────────────────────────────────────┐" -ForegroundColor Cyan
    Write-Host ("  │  清理前总大小: {0,12} MB       │" -f $totalSizeBeforeMB) -ForegroundColor White
    Write-Host ("  │  已删除目录数: {0,12} 个       │" -f $cleanedCount) -ForegroundColor White
    Write-Host ("  │  释放空间:     {0,12} MB       │" -f $cleanedSizeMB) -ForegroundColor Green
    Write-Host ("  │  剩余大小:     {0,12} MB       │" -f $remainingSizeMB) -ForegroundColor White
    Write-Host "  └────────────────────────────────────┘" -ForegroundColor Cyan

    # 同时清理诊断日志
    Write-Host "`n  清理诊断日志 (保留最近 7 天)..." -ForegroundColor Gray
    $diagDir = Join-Path $RunnerHome "_diag"
    if (Test-Path $diagDir) {
        $oldLogs = Get-ChildItem $diagDir -Filter "*.log" -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) }
        $logRemoved = 0
        foreach ($log in $oldLogs) {
            Remove-Item $log.FullName -Force -ErrorAction SilentlyContinue
            $logRemoved++
        }
        if ($logRemoved -gt 0) {
            Write-Ok "已删除 $logRemoved 个过期日志文件"
        }
    }

    Write-Host ""
}

# ============================================================
# COMMAND: logs
# ============================================================

function Invoke-Logs {
    Write-Section "Runner 日志"
    Assert-RunnerHome

    $diagDir = Join-Path $RunnerHome "_diag"
    if (-not (Test-Path $diagDir)) {
        Write-Wrn "诊断日志目录不存在: $diagDir"
        return
    }

    # 列出可用日志
    $logFiles = Get-ChildItem $diagDir -Filter "*.log" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending

    if ($logFiles.Count -eq 0) {
        Write-Wrn "没有找到日志文件"
        return
    }

    Write-Host "  可用日志文件 ($($logFiles.Count) 个):" -ForegroundColor White
    for ($i = 0; $i -lt [Math]::Min($logFiles.Count, 10); $i++) {
        $log = $logFiles[$i]
        $sizeKB = [Math]::Round($log.Length / 1KB, 0)
        Write-Host "    [$i] $($log.Name) ($sizeKB KB, $($log.LastWriteTime))" -ForegroundColor Gray
    }

    # 显示最新日志内容
    Write-Host ""
    Write-Host "  === 最新日志最后 $Lines 行 ===" -ForegroundColor Cyan
    $latestLog = $logFiles[0]

    Write-Host "`n  文件: $($latestLog.FullName)" -ForegroundColor White
    Write-Host "  大小: $([Math]::Round($latestLog.Length / 1KB, 0)) KB" -ForegroundColor Gray
    Write-Host "  修改: $($latestLog.LastWriteTime)" -ForegroundColor Gray
    Write-Host ""

    Get-Content $latestLog.FullName -Tail $Lines -ErrorAction SilentlyContinue | ForEach-Object {
        $color = 'White'
        if ($_ -match "(?i)error|fail|exception|fatal") { $color = 'Red' }
        elseif ($_ -match "(?i)warn") { $color = 'Yellow' }
        elseif ($_ -match "(?i)job.*completed|job.*finished|success") { $color = 'Green' }
        Write-Host "  | $_" -ForegroundColor $color
    }

    # 也尝试读取 Worker 日志
    $workerLog = $logFiles | Where-Object { $_.Name -like "Worker_*" } | Select-Object -First 1
    if ($workerLog) {
        Write-Host ""
        Write-Host "  === Worker 日志最后 20 行 ===" -ForegroundColor Cyan
        Get-Content $workerLog.FullName -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Host "  | $_" -ForegroundColor DarkGray
        }
    }

    Write-Host ""
}

# ============================================================
# COMMAND: unregister
# ============================================================

function Invoke-Unregister {
    Write-Section "注销 Runner"
    Assert-RunnerHome

    $cfg = Get-RunnerConfig
    $runnerName = if ($cfg) { $cfg.runnerName } else { "未知" }

    Write-Host "  Runner 名称: $runnerName" -ForegroundColor White
    Write-Host "  安装路径: $RunnerHome" -ForegroundColor White
    Write-Host ""

    Write-Wrn "⚠️ 此操作将:"
    Write-Host "    1. 停止 Runner Service" -ForegroundColor Red
    Write-Host "    2. 从 GitHub 注销此 Runner" -ForegroundColor Red
    Write-Host "    3. 移除本地 Service 注册" -ForegroundColor Red
    Write-Host "    4. 此操作不可逆!" -ForegroundColor Red
    Write-Host ""

    $confirm = Read-Host "  确认注销? 输入 YES 以继续"
    if ($confirm -ne 'YES') {
        Write-Host "  已取消注销。" -ForegroundColor Gray
        return
    }

    # 获取 Token
    if ([string]::IsNullOrWhiteSpace($Token)) {
        $Token = Read-Host "  请输入 Runner Token (用于注销)"
    }
    while ([string]::IsNullOrWhiteSpace($Token)) {
        Write-Err "Token 不能为空!"
        $Token = Read-Host "  Runner Token"
    }

    Push-Location $RunnerHome

    try {
        # 1. 停止服务
        Write-Host "`n  步骤 1/4: 停止 Service..." -ForegroundColor Yellow
        & .\svc stop 2>&1 | Out-Null
        Start-Sleep -Seconds 2
        Write-Ok "Service 已停止"

        # 2. 卸载服务
        Write-Host "  步骤 2/4: 卸载 Service..." -ForegroundColor Yellow
        & .\svc uninstall 2>&1 | Out-Null
        Write-Ok "Service 已卸载"

        # 3. 从 GitHub 注销
        Write-Host "  步骤 3/4: 从 GitHub 注销..." -ForegroundColor Yellow
        & .\config.cmd remove --token $Token 2>&1 | ForEach-Object { Write-Host "    $_" }

        if ($LASTEXITCODE -eq 0) {
            Write-Ok "已从 GitHub 注销"
        } else {
            Write-Warn "注销命令返回非零退出码 ($LASTEXITCODE), 可能需要手动在 GitHub 上移除"
        }

        # 4. 清理文件 (可选)
        Write-Host "  步骤 4/4: 清理本地文件..." -ForegroundColor Yellow
        $cleanupConfirm = Read-Host "  是否删除 Runner 目录下的所有文件? (保留目录本身) (y/N)"
        if ($cleanupConfirm -eq 'y' -or $cleanupConfirm -eq 'Y') {
            Get-ChildItem $RunnerHome -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
            Get-ChildItem $RunnerHome -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
            Write-Ok "本地文件已清理"
        } else {
            Write-Host "  保留了本地文件。" -ForegroundColor Gray
        }

        Write-Host ""
        Write-Host "  ╔════════════════════════════════════════╗" -ForegroundColor Green
        Write-Host "  ║  Runner '$runnerName' 已成功注销!         ║" -ForegroundColor Green
        Write-Host "  ╚════════════════════════════════════════╝" -ForegroundColor Green

    } catch {
        Write-Err "注销过程中出错: $($_.Exception.Message)"
        Write-Host "  可能需要手动清理:" -ForegroundColor Yellow
        Write-Host "    1. sc delete actions.runner.*" -ForegroundColor Gray
        Write-Host "    2. 在 GitHub Settings > Actions > Runners 中手动删除" -ForegroundColor Gray
    }

    Pop-Location
    Write-Host ""
}

# ============================================================
# 分发命令
# ============================================================

try {
    switch ($Command) {
        "status"      { Invoke-Status }
        "update"      { Invoke-Update }
        "clean"       { Invoke-Clean }
        "logs"        { Invoke-Logs }
        "unregister"  { Invoke-Unregister }
        default       { Write-Err "未知命令: $Command"; exit 1 }
    }
} catch {
    Write-Err "执行出错: $($_.Exception.Message)"
    exit 1
}
