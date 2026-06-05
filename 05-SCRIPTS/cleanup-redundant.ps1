<#
.SYNOPSIS
    GlobalReach Redundant File Cleanup Tool v1.1
.DESCRIPTION
    Cleanup scattered project files from trae_projects root directory
.EXAMPLE
    .\cleanup-redundant.ps1
    .\cleanup-redundant.ps1 -WhatIf  # Preview mode
#>

param(
    [switch]$WhatIf = $false
)

$basePath = "C:\Users\Administrator\Documents\trae_projects"
$projectDir = "$basePath\GlobalReach-Project"
$archiveDir = "$projectDir\04-ARCHIVED"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  GlobalReach File Cleanup Tool v1.1" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if ($WhatIf) {
    Write-Host ""
    Write-Host "[PREVIEW] No files will be moved" -ForegroundColor Red
}

$patterns = @(
    "GLOBALREACH_*.md",
    "*GlobalReach*.txt",
    "globalreach*.*"
)

$totalFound = 0
$totalMoved = 0

foreach ($pattern in $patterns) {
    Write-Host ""
    Write-Host "[SEARCH] Pattern: $pattern" -ForegroundColor Yellow
    
    $files = Get-ChildItem -Path $basePath -Filter $pattern -ErrorAction SilentlyContinue
    
    foreach ($file in $files) {
        $totalFound++
        
        if ($file.Directory.Name -eq "GlobalReach-Project") {
            Write-Host "  [KEEP] $($file.Name) (already in project)" -ForegroundColor Green
            continue
        }
        
        Write-Host "  [FOUND] $($file.FullName)" -ForegroundColor Red
        
        if (-not $WhatIf) {
            $timestamp = (Get-Date).ToString('yyyyMMdd_HHmmss')
            $newName = "$($file.BaseName)_redundant_$timestamp$($file.Extension)"
            $destination = Join-Path $archiveDir $newName
            
            Move-Item $file.FullName $destination -Force
            Write-Host "     -> Archived: 04-ARCHIVED\$newName" -ForegroundColor Green
            $totalMoved++
        }
        else {
            Write-Host "     -> Would archive to: 04-ARCHIVED\" -ForegroundColor DarkGray
        }
    }
}

Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor DarkGray

if ($totalFound -eq 0) {
    Write-Host ""
    Write-Host "[OK] Great! No redundant files found. Workspace is clean." -ForegroundColor Green
}
else {
    Write-Host ""
    Write-Host "[STATS] Cleanup Statistics:" -ForegroundColor Cyan
    Write-Host "  Files found: $totalFound" -ForegroundColor White
    Write-Host "  Files archived: $totalMoved" -ForegroundColor Green
    
    if ($WhatIf) {
        Write-Host ""
        Write-Host "[TIP] Remove -WhatIf parameter to execute cleanup" -ForegroundColor Cyan
    }
    else {
        Write-Host ""
        Write-Host "[DONE] Cleanup complete! All redundant files safely archived." -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "[PATH] Archive location: $archiveDir" -ForegroundColor DarkGray