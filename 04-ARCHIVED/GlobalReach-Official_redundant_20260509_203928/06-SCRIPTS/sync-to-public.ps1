# ═══════════════════════════════════════════════════════════
#  GlobalReach 项目文件同步脚本 v1.0
#  用途: 将工作区(轨道A)文档一键同步到发布区(轨道B)
#  使用: .\sync-to-public.ps1 [-WhatIf] [-Verbose]
# ═══════════════════════════════════════════════════════════

param(
    [string]$SourcePath = "C:\Users\Administrator\Documents\trae_projects\GlobalReach-Official",
    [string]$TargetPath = "D:\trae\1海外客户业务拓展-GlobalReach系统",
    [switch]$WhatIf = $false,
    [switch]$Verbose = $false
)

Write-Host ""
Write-Host "╔════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     🔄 GlobalReach 文件同步工具 v1.0           ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Step 1: 验证源目录存在
if (-not (Test-Path $SourcePath)) {
    Write-Host "❌ 错误: 源目录不存在" -ForegroundColor Red
    Write-Host "   路径: $SourcePath" -ForegroundColor Red
    exit 1
}
Write-Host "✅ 源目录确认: $SourcePath" -ForegroundColor Green

# Step 2: 验证/创建目标目录
if (-not (Test-Path $TargetPath)) {
    Write-Host "⚠️  目标目录不存在, 正在创建..." -ForegroundColor Yellow
    try {
        New-Item -ItemType Directory -Path $TargetPath -Force | Out-Null
        Write-Host "✅ 目标目录已创建: $TargetPath" -ForegroundColor Green
    }
    catch {
        Write-Host "❌ 无法创建目标目录: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

# Step 3: 定义需要同步的文件模式
$syncPatterns = @(
    "GLOBALREACH_*.md",           # 所有核心文档 (9个)
    "README.md",                 # 项目说明
    "FILE-MANAGEMENT-RULES.md"    # 归档规则本身
)

# Step 4: 执行同步
$syncCount = 0
$errorCount = 0
$skippedCount = 0

Write-Host ""
Write-Host "📂 开始同步文件..." -ForegroundColor Yellow
Write-Host "─" * 50 -ForegroundColor Gray

foreach ($pattern in $syncPatterns) {
    $files = Get-ChildItem -Path $SourcePath -Filter $pattern -File -ErrorAction SilentlyContinue
    
    if ($files) {
        foreach ($file in $files) {
            $sourceFile = $file.FullName
            $targetFile = Join-Path $TargetPath $file.Name
            
            # 检查目标文件是否已存在且相同
            if (Test-Path $targetFile) {
                $sourceHash = (Get-FileHash $sourceFile -Algorithm SHA256).Hash
                $targetHash = (Get-FileHash $targetFile -Algorithm SHA256).Hash
                
                if ($sourceHash -eq $targetHash) {
                    if ($Verbose) {
                        Write-Host "⏭️  跳过(相同): $($file.Name)" -ForegroundColor DarkGray
                    }
                    $skippedCount++
                    continue
                }
            }
            
            # 执行复制
            if ($WhatIf) {
                Write-Host "[预览] 会复制: $($file.Name)" -ForegroundColor Yellow
                $syncCount++
            }
            else {
                try {
                    Copy-Item -Path $sourceFile -Destination $targetFile -Force
                    $syncCount++
                    
                    if ($Verbose) {
                        Write-Host "✅ 已同步: $($file.Name)" -ForegroundColor Green
                    }
                }
                catch {
                    $errorCount++
                    Write-Host "❌ 失败: $($file.Name)" -ForegroundColor Red
                    Write-Host "   原因: $($_.Exception.Message)" -ForegroundColor DarkRed
                }
            }
        }
    }
}

# Step 5: 同步子目录中的文件 (01-CORE-DOCUMENTS 等)
$subDirsToSync = @(
    "01-CORE-DOCUMENTS"
)

foreach ($dirName in $subDirsToSync) {
    $subSourcePath = Join-Path $SourcePath $dirName
    $subTargetPath = Join-Path $TargetPath $dirName
    
    if (Test-Path $subSourcePath) {
        if (-not (Test-Path $subTargetPath)) {
            New-Item -ItemType Directory -Path $subTargetPath -Force | Out-Null
        }
        
        $subFiles = Get-ChildItem -Path $subSourcePath -File -ErrorAction SilentlyContinue
        foreach ($subFile in $subFiles) {
            $srcFile = $subFile.FullName
            $tgtFile = Join-Path $subTargetPath $subFile.Name
            
            if (-not $WhatIf) {
                try {
                    Copy-Item -Path $srcFile -Destination $tgtFile -Force
                    $syncCount++
                    if ($Verbose) { Write-Host "✅ [$dirName] $($subFile.Name)" -ForegroundColor Green }
                }
                catch {
                    $errorCount++
                }
            }
            else {
                $syncCount++
            }
        }
    }
}

# Step 6: 生成版本标记
$versionStamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$versionContent = @"
========================================
 GlobalReach Project Files - Sync Status
========================================

Sync Timestamp: $versionStamp
Source (Working Dir): $SourcePath
Target (Publication): $TargetPath

Statistics:
  Files Synced: $syncCount
  Files Skipped (unchanged): $skippedCount  
  Errors: $errorCount
  Total Processed: $($syncCount + $skippedCount + $errorCount)

Directory Structure:
  Core Documents: 9 files (GLOBALREACH_*.md)
  Rules File: FILE-MANAGEMENT-RULES.md
  
Notes:
  - This is a mirror of the working directory
  - Do NOT edit files in this directory directly
  - All edits should be done in the Source directory
  - Re-run this script to sync updates
========================================
"@
$versionContent | Out-File (Join-Path $TargetPath "VERSION.txt") -Encoding UTF8

# Step 7: 显示结果
Write-Host ""
Write-Host "═" * 55 -ForegroundColor White
Write-Host " 📊 同步完成!" -ForegroundColor White
Write-Host "─" * 55 -ForegroundColor Gray
Write-Host "" 
Write-Host " ✅ 成功同步: $syncCount 个文件" -ForegroundColor Green
if ($skippedCount -gt 0) {
    Write-Host " ⏭️  跳过(未变更): $skippedCount 个文件" -ForegroundColor DarkGray
}
if ($errorCount -gt 0) {
    Write-Host " ❌ 失败数量: $errorCount 个文件" -ForegroundColor Red
}
else {
    Write-Host " ❌ 失败数量: 0" -ForegroundColor Green
}
Write-Host ""
Write-Host " 📍 工作区(源):" -ForegroundColor Cyan
Write-Host "   $SourcePath" -ForegroundColor Gray
Write-Host ""
Write-Host " 📍 发布区(目标):" -ForegroundColor Cyan
Write-Host "   $TargetPath" -ForegroundColor Gray
Write-Host ""
Write-Host " 🕐 同步时间:" -ForegroundColor White
Write-Host "   $versionStamp" -ForegroundColor White
Write-Host ""
Write-Host "═" * 55 -ForegroundColor White

if ($errorCount -eq 0) {
    Write-Host " 🎉 状态: 全部成功! 发布区已是最新." -ForegroundColor Green
    Write-Host "" 
    Write-Host " 💡 提示: 您现在可以在发布区查看所有最新文档." -ForegroundColor Yellow
}
else {
    Write-Host " ⚠️  状态: 部分失败, 请检查上方错误信息." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "╚════════════════════════════════════════════╝" -ForegroundColor Cyan
