<#
.SYNOPSIS
    GlobalReach Smart Sync Tool v2.1
.DESCRIPTION
    Detect changes and intelligently sync to D drive publish area
.EXAMPLE
    .\smart-sync.ps1 -Mode Auto          # Auto mode (only sync changed files)
    .\smart-sync.ps1 -Mode Full -Verbose # Full sync (show details)
    .\smart-sync.ps1 -Mode DryRun        # Preview mode (no actual execution)
#>

param(
    [ValidateSet("Auto","Full","DryRun")]
    [string]$Mode = "Auto",
    [switch]$Verbose = $false
)

$SourceRoot = "C:\Users\Administrator\Documents\trae_projects\GlobalReach-Project"
$TargetRoot = "D:\trae\1海外客户业务拓展-GlobalReach系统"
$logFile = "$SourceRoot\sync-log_$(Get-Date -Format 'yyyyMMdd_HHmmss').txt"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  GlobalReach Smart Sync Tool v2.1" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Write-Host ""
Write-Host "[SOURCE] Source: $SourceRoot" -ForegroundColor White
Write-Host "[TARGET] Target: $TargetRoot" -ForegroundColor White
Write-Host "[MODE]   Mode: $Mode" -ForegroundColor Yellow

if ($Mode -eq "DryRun") {
    Write-Host ""
    Write-Host "[PREVIEW] Preview mode - no files will be modified" -ForegroundColor Red
}

$stats = @{
    NewFiles = 0
    UpdatedFiles = 0  
    SkippedFiles = 0
    ErrorCount = 0
}

Start-Transcript -Path $logFile -Force | Out-Null

try {
    $coreDocsDir = "$SourceRoot\01-CORE-DOCUMENTS"
    $targetDocsDir = "$TargetRoot\01-CORE-DOCUMENTS"
    
    if (-not (Test-Path $targetDocsDir)) {
        New-Item -ItemType Directory -Force -Path $targetDocsDir | Out-Null
        Write-Host ""
        Write-Host "[CREATE] Created target directory: 01-CORE-DOCUMENTS" -ForegroundColor Green
    }
    
    Write-Host ""
    Write-Host "[START] Starting core document sync..." -ForegroundColor Yellow
    
    $files = Get-ChildItem -Path $coreDocsDir -Filter "*.md"
    
    foreach ($file in $files) {
        $targetFile = Join-Path $targetDocsDir $file.Name
        
        try {
            if (-not (Test-Path $targetFile)) {
                if ($Mode -ne "DryRun") {
                    Copy-Item $file.FullName $targetFile
                }
                Write-Host "  [NEW] Added: $($file.Name)" -ForegroundColor Green
                $stats.NewFiles++
            }
            else {
                $sourceHash = (Get-FileHash $file.FullName -Algorithm SHA256).Hash
                $targetHash = (Get-FileHash $targetFile -Algorithm SHA256).Hash
                
                if ($sourceHash -ne $targetHash) {
                    if ($Mode -ne "DryRun") {
                        Copy-Item $file.FullName $targetFile -Force
                    }
                    Write-Host "  [UPDATE] Updated: $($file.Name)" -ForegroundColor Yellow
                    $stats.UpdatedFiles++
                }
                elseif ($Verbose) {
                    Write-Host "  [SKIP] Skipped: $($file.Name)" -ForegroundColor DarkGray
                    $stats.SkippedFiles++
                }
                else {
                    $stats.SkippedFiles++
                }
            }
        }
        catch {
            Write-Host "  [ERROR] Error: $($file.Name) - $($_.Exception.Message)" -ForegroundColor Red
            $stats.ErrorCount++
        }
    }
    
    Write-Host ""
    Write-Host "----------------------------------------" -ForegroundColor DarkGray
    
    $totalProcessed = $stats.NewFiles + $stats.UpdatedFiles + $stats.SkippedFiles
    
    Write-Host ""
    Write-Host "[STATS] Sync Statistics:" -ForegroundColor Cyan
    Write-Host "  Total processed: $totalProcessed files" -ForegroundColor White
    Write-Host "  New files: $($stats.NewFiles)" -ForegroundColor Green
    Write-Host "  Updated files: $($stats.UpdatedFiles)" -ForegroundColor Yellow
    Write-Host "  Skipped files: $($stats.SkippedFiles)" -ForegroundColor DarkGray
    if ($stats.ErrorCount -gt 0) {
        Write-Host "  Errors: $($stats.ErrorCount)" -ForegroundColor Red
    }
    
    if ($totalProcessed -eq 0) {
        Write-Host ""
        Write-Host "[WARN] No files found to sync" -ForegroundColor Yellow
    }
    elseif (($stats.NewFiles + $stats.UpdatedFiles) -gt 0) {
        Write-Host ""
        Write-Host "[DONE] Sync completed! Processed $($stats.NewFiles + $stats.UpdatedFiles) changes" -ForegroundColor Green
        
        if ($Mode -eq "DryRun") {
            Write-Host "[TIP] Use -Mode Full to execute actual sync" -ForegroundColor Cyan
        }
    }
    else {
        Write-Host ""
        Write-Host "[OK] All files are up to date" -ForegroundColor Green
    }
    
    Write-Host ""
    Write-Host "[LOG] Detailed log: $logFile" -ForegroundColor DarkGray
    
}
finally {
    Stop-Transcript | Out-Null
}

Write-Host ""
Write-Host "[SUCCESS] Sync task completed!" -ForegroundColor Cyan