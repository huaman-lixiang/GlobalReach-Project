# ==============================================================================
# GlobalReach V2.0 — 备份手动触发测试脚本 (M-D01)
# 手动执行一次完整备份 + 输出文件完整性验证
#
# 用法:
#   .\test-backup.ps1                              # 使用默认参数
#   .\test-backup.ps1 -BackupDir D:\test-backups   # 指定备份目录
#   .\test-backup.ps1 -VerifyOnly                  # 仅验证已有备份
#
# 功能:
#   1. 环境预检 (Docker / Bash / 磁盘空间)
#   2. 执行 backup.sh (或 PowerShell 回退)
#   3. 验证输出文件完整性 (SHA256 / tar.gz 结构)
#   4. 显示备份耗时和大小
#   5. 生成测试报告
# ==============================================================================

[CmdletBinding()]
param(
    [string]$BackupDir = "C:\backups\globalreach",
    [int]$RetentionDays = 30,
    [switch]$VerifyOnly,
    [string]$BackupScriptPath = "$PSScriptRoot\backup.sh"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent)

# ======================== 颜色工具 ========================
function Write-Header([string]$Text) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host " $Text" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
}

function Write-Section([string]$Text) {
    Write-Host "`n[$Text]" -ForegroundColor Yellow
}

Write-Header "GlobalReach V2.0 — 备份手动触发与验证 (M-D01)"

# ======================== 步骤 0: 仅验证模式 ========================
if ($VerifyOnly) {
    Write-Section "仅验证模式 — 不执行新备份"

    if (-not (Test-Path $BackupDir)) {
        Write-Host "  [ERROR] 备份目录不存在: $BackupDir" -ForegroundColor Red
        exit 1
    }

    $backups = Get-ChildItem -Path $BackupDir -Filter "globalreach_backup_*.tar.gz" -ErrorAction SilentlyContinue |
               Sort-Object LastWriteTime -Descending

    if ($backups.Count -eq 0) {
        Write-Host "  [WARN] 未找到任何备份文件" -ForegroundColor DarkYellow
        exit 0
    }

    # 验证最新的备份
    $latestBackup = $backups | Select-Object -First 1

    Write-Section "最新备份文件"
    Write-Host "  文件名:     $($latestBackup.Name)" -ForegroundColor White
    Write-Host "  文件大小:   $([math]::Round($latestBackup.Length / 1MB, 2)) MB" -ForegroundColor White
    Write-Host "  创建时间:   $($latestBackup.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor White
    Write-Host "  文件路径:   $($latestBackup.FullName)" -ForegroundColor DarkGray

    # SHA256 校验
    Write-Section "SHA256 校验"
    $sha256File = "$($latestBackup.FullName).sha256"

    if (Test-Path $sha256File) {
        $storedHash = (Get-Content $sha256File -TotalCount 1) -split '\s+'
        if ($storedHash) {
            $computedHash = (Get-FileHash -Algorithm SHA256 $latestBackup.FullName).Hash.ToLower()
            if ($storedHash[0] -eq $computedHash) {
                Write-Host "  [PASS] SHA256 校验通过: $($computedHash.Substring(0,16))..." -ForegroundColor Green
            } else {
                Write-Host "  [FAIL] SHA256 校验不匹配!" -ForegroundColor Red
                Write-Host "         存储: $($storedHash[0])" -ForegroundColor Red
                Write-Host "         计算: $computedHash" -ForegroundColor Red
            }
        }
    } else {
        # 无 .sha256 文件，现场计算
        $hash = (Get-FileHash -Algorithm SHA256 $latestBackup.FullName).Hash
        Write-Host "  [INFO] 未找到 .sha256 文件，现场计算:" -ForegroundColor DarkGray
        Write-Host "  SHA256: $hash" -ForegroundColor White
    }

    # tar.gz 完整性
    Write-Section "归档完整性"
    Write-Host "  [INFO] 使用 tar 验证归档结构..." -ForegroundColor DarkGray
    try {
        $tarResult = bash -c "tar -tzf '$($latestBackup.FullName -replace '\\','/')' 2>&1 | head -30"
        if ($LASTEXITCODE -eq 0) {
            $fileCount = (bash -c "tar -tzf '$($latestBackup.FullName -replace '\\','/')' 2>/dev/null | wc -l")
            Write-Host "  [PASS] 归档结构有效，包含约 $fileCount 个条目" -ForegroundColor Green
            Write-Host "  内容预览 (前20行):" -ForegroundColor DarkGray
            $tarResult | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        } else {
            Write-Host "  [FAIL] 归档损坏或格式不正确" -ForegroundColor Red
        }
    } catch {
        Write-Host "  [WARN] 无法使用 tar 验证 (Bash 不可用)" -ForegroundColor DarkYellow
    }

    Write-Header "验证完成"
    return
}

# ======================== 步骤 1: 环境预检 ========================
Write-Section "环境预检"

# 1.1 Docker
$dockerOk = $false
try {
    $null = docker info --format "{{.ServerVersion}}" 2>$null
    $dockerOk = $true
    Write-Host "  [OK] Docker 可用" -ForegroundColor Green
} catch {
    Write-Host "  [FAIL] Docker 不可用! 备份需要 Docker 环境" -ForegroundColor Red
    exit 1
}

# 1.2 Bash
$bashOk = $false
try {
    $null = bash --version 2>$null
    $bashOk = $true
    Write-Host "  [OK] Bash 可用" -ForegroundColor Green
} catch {
    Write-Host "  [WARN] Bash 不可用，将尝试 PowerShell 回退" -ForegroundColor DarkYellow
}

# 1.3 备份脚本
if (-not (Test-Path $BackupScriptPath)) {
    Write-Host "  [FAIL] 备份脚本不存在: $BackupScriptPath" -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] 备份脚本存在: $BackupScriptPath" -ForegroundColor Green

# 1.4 磁盘空间检查
$driveRoot = (New-Object System.IO.DriveInfo((Split-Path $BackupDir -Qualifier))).Name
$drive = Get-WmiObject Win32_LogicalDisk -Filter "DeviceID='$driveRoot'"
$freeGB = [math]::Round($drive.FreeSpace / 1GB, 2)
$totalGB = [math]::Round($drive.Size / 1GB, 2)
$freePct = [math]::Round(($drive.FreeSpace / $drive.Size) * 100, 1)

if ($freeGB -lt 5) {
    Write-Host "  [WARN] 磁盘空间不足! 剩余 ${freeGB} GB (${freePct}%)" -ForegroundColor Red
    exit 1
} elseif ($freeGB -lt 20) {
    Write-Host "  [WARN] 磁盘空间偏低: 剩余 ${freeGB} GB / ${totalGB} GB (${freePct}%)" -ForegroundColor DarkYellow
} else {
    Write-Host "  [OK] 磁盘空间充足: 剩余 ${freeGB} GB / ${totalGB} GB (${freePct}%)" -ForegroundColor Green
}

# 1.5 创建目录
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    Write-Host "  [OK] 已创建备份目录: $BackupDir" -ForegroundColor Green
}

$logDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# ======================== 步骤 2: 执行备份 ========================
Write-Section "执行备份"
Write-Host "  备份目标:   $BackupDir" -ForegroundColor White
Write-Host "  开始时间:   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor White
Write-Host ""

$sw = [System.Diagnostics.Stopwatch]::StartNew()

$backupSuccess = $false
$backupOutput = ""
$exitCode = -1

if ($bashOk) {
    Write-Host "  执行方式: Bash → backup.sh" -ForegroundColor Cyan
    try {
        $resolvedScript = Resolve-Path $BackupScriptPath
        $env:BACKUP_DIR = $BackupDir
        $env:RETENTION_DAYS = "$RetentionDays"
        $output = bash -c "BACKUP_DIR=$BackupDir RETENTION_DAYS=$RetentionDays bash '$resolvedScript' 2>&1" 2>&1
        $exitCode = $LASTEXITCODE
        $backupOutput = $output -join "`n"
        Write-Host $backupOutput
    } catch {
        $backupOutput = $_.Exception.Message
        $exitCode = 1
        Write-Host "[EXCEPTION] $_" -ForegroundColor Red
    }
} else {
    Write-Host "  执行方式: PowerShell → s079-backup.ps1 (回退)" -ForegroundColor Cyan
    $psBackupScript = Join-Path $ProjectRoot "scripts\s079-backup.ps1"
    try {
        $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass `
            -File $psBackupScript `
            -BackupDir $BackupDir `
            -RetentionDays $RetentionDays 2>&1
        $exitCode = $LASTEXITCODE
        $backupOutput = $output -join "`n"
        Write-Host $backupOutput
    } catch {
        $backupOutput = $_.Exception.Message
        $exitCode = 1
        Write-Host "[EXCEPTION] $_" -ForegroundColor Red
    }
}

$sw.Stop()
$elapsed = $sw.Elapsed.ToString('mm\:ss\.fff')

Write-Host ""
Write-Host "  结束时间:   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor White
Write-Host "  耗时:       $elapsed" -ForegroundColor $(if ($exitCode -eq 0) { "Green" } else { "Red" })

if ($exitCode -eq 0) {
    $backupSuccess = $true
    Write-Host "  结果:       成功" -ForegroundColor Green
} else {
    Write-Host "  结果:       失败 (exit code: $exitCode)" -ForegroundColor Red
}

# ======================== 步骤 3: 验证输出文件 ========================
Write-Section "输出文件验证"

# 查找刚生成的备份文件
$newBackups = Get-ChildItem -Path $BackupDir -Filter "globalreach_backup_*.tar.gz" -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending |
              Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-10) }

if ($newBackups.Count -eq 0) {
    # 回退：找最新的
    $newBackups = Get-ChildItem -Path $BackupDir -Filter "globalreach_backup_*.tar.gz" -ErrorAction SilentlyContinue |
                  Sort-Object LastWriteTime -Descending |
                  Select-Object -First 1
}

if (-not $newBackups) {
    Write-Host "  [FAIL] 未找到备份输出文件!" -ForegroundColor Red
    Write-Header "测试完成 (有错误)"
    exit 1
}

$backupFile = @($newBackups)[0]
Write-Host "  目标文件:   $($backupFile.Name)" -ForegroundColor White
Write-Host "  文件大小:   $([math]::Round($backupFile.Length / 1MB, 2)) MB" -ForegroundColor White
Write-Host "  创建时间:   $($backupFile.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor White

# 3.1 SHA256 校验
Write-Section "SHA256 完整性校验"
$sha256File = "$($backupFile.FullName).sha256"
$hashResult = "UNKNOWN"

if (Test-Path $sha256File) {
    $storedContent = Get-Content $sha256File -TotalCount 1 -ErrorAction SilentlyContinue
    $storedHash = ($storedContent -split '\s+')[0]
    $computedHash = (Get-FileHash -Algorithm SHA256 $backupFile.FullName).Hash.ToLower()

    if ($storedHash -and $storedHash -eq $computedHash) {
        $hashResult = "PASS"
        Write-Host "  [PASS] SHA256 校验通过" -ForegroundColor Green
        Write-Host "         Hash: ${computedHash}..." -ForegroundColor DarkGray
    } elseif ($storedHash) {
        $hashResult = "FAIL"
        Write-Host "  [FAIL] SHA256 不匹配!" -ForegroundColor Red
        Write-Host "         期望: $storedHash" -ForegroundColor Red
        Write-Host "         实际: $computedHash" -ForegroundColor Red
    }
} else {
    $computedHash = (Get-FileHash -Algorithm SHA256 $backupFile.FullName).Hash
    $hashResult = "COMPUTED"
    Write-Host "  [INFO] 无 .sha256 文件，现场计算: $computedHash" -ForegroundColor DarkYellow
}

# 3.2 tar.gz 结构验证
Write-Section "归档结构验证"
$tarResult = "UNKNOWN"
if ($bashOk) {
    try {
        $tarList = bash -c "tar -tzf '$($backupFile.FullName -replace '\\','/')' 2>/dev/null"
        if ($LASTEXITCODE -eq 0) {
            $fileCount = ($tarList | Measure-Object).Count
            $tarResult = "PASS"
            Write-Host "  [PASS] 归档有效，包含 $fileCount 个条目" -ForegroundColor Green

            # 关键文件检查
            Write-Host "" -ForegroundColor DarkGray
            Write-Host "  关键组件检查:" -ForegroundColor DarkGray

            $criticalPaths = @(
                @{ Name="PostgreSQL Dump"; Pattern="postgresql/globalreach_prod" },
                @{ Name="Redis RDB";      Pattern="redis/dump.rdb" },
                @{ Name="Grafana DB";     Pattern="grafana/grafana.db" },
                @{ Name="Nginx Config";   Pattern="nginx/nginx.conf" },
                @{ Name="MANIFEST";       Pattern="MANIFEST.txt" }
            )

            foreach ($cp in $criticalPaths) {
                $found = $tarList | Where-Object { $_ -match [regex]::Escape($cp.Pattern) }
                if ($found) {
                    Write-Host "    [OK] $($cp.Name): 存在" -ForegroundColor Green
                } else {
                    Write-Host "    [MISS] $($cp.Name): 未找到" -ForegroundColor DarkYellow
                }
            }
        } else {
            $tarResult = "FAIL"
            Write-Host "  [FAIL] 归档损坏或无法读取" -ForegroundColor Red
        }
    } catch {
        $tarResult = "SKIP"
        Write-Host "  [WARN] 无法验证 (tar 不可用)" -ForegroundColor DarkYellow
    }
} else {
    $tarResult = "SKIP"
    Write-Host "  [WARN] Bash 不可用，跳过 tar 验证" -ForegroundColor DarkYellow
}

# ======================== 步骤 4: 测试报告汇总 ========================
Write-Header "备份测试报告"

$overallStatus = if ($backupSuccess -and $hashResult -eq "PASS" -and $tarResult -eq "PASS") {
    "✅ PASS"
} elseif ($backupSuccess) {
    "⚠️ WARN (备份成功但验证有警告)"
} else {
    "❌ FAIL"
}

$statusColor = switch -Regex ($overallStatus) {
    "PASS" { "Green" }
    "WARN" { "DarkYellow" }
    default { "Red" }
}

Write-Host ""
Write-Host "  总体结果:   $overallStatus" -ForegroundColor $statusColor
Write-Host "  ──────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  备份执行:   $(if ($backupSuccess) {'[PASS] 成功'} else {'[FAIL] 失败'})" -ForegroundColor $(if ($backupSuccess) {"Green"} else {"Red"})
Write-Host "  执行耗时:   $elapsed" -ForegroundColor White
Write-Host "  文件大小:   $([math]::Round($backupFile.Length / 1MB, 2)) MB" -ForegroundColor White
Write-Host "  SHA256:     $hashResult" -ForegroundColor $(switch ($hashResult) { "PASS" { "Green" }; "FAIL" { "Red" }; default { "DarkYellow" } })
Write-Host "  归档结构:   $tarResult" -ForegroundColor $(switch ($tarResult) { "PASS" { "Green" }; "FAIL" { "Red" }; default { "DarkYellow" } })
Write-Host "  文件路径:   $($backupFile.FullName)" -ForegroundColor DarkGray
Write-Host "  ──────────────────────────────────────" -ForegroundColor DarkGray

# 写入日志
$reportLog = Join-Path $logDir "test_backup_report_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"
@"
===============================================
GlobalReach Backup Test Report (M-D01)
Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Overall:   $overallStatus
-----------------------------------------------
Backup Success:  $backupSuccess
Elapsed:         $elapsed
File Size:       $([math]::Round($backupFile.Length / 1MB, 2)) MB
SHA256 Result:   $hashResult
TAR Result:      $tarResult
File Path:       $($backupFile.FullName)
===============================================
"@ | Out-File -FilePath $reportLog -Encoding UTF8
Write-Host "  报告日志:   $reportLog" -ForegroundColor DarkGray

Write-Header "测试完成"
