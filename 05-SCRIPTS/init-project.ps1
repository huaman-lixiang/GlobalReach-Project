<#
.SYNOPSIS
    GlobalReach Project Initialization Tool v1.1
.DESCRIPTION
    Create standardized project directory structure
.EXAMPLE
    .\init-project.ps1
#>

param(
    [string]$ProjectRoot = "C:\Users\Administrator\Documents\trae_projects\GlobalReach-Project"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  GlobalReach Project Init Tool v1.1" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Write-Host ""
Write-Host "[INIT] Creating project directory structure..." -ForegroundColor Yellow

$directories = @(
    "01-CORE-DOCUMENTS",
    "02-DEVELOPMENT", 
    "03-TEMPLATES",
    "04-ARCHIVED",
    "05-SCRIPTS"
)

foreach ($dir in $directories) {
    $path = Join-Path $ProjectRoot $dir
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Force -Path $path | Out-Null
        Write-Host "  [OK] Created: $dir" -ForegroundColor Green
    }
    else {
        Write-Host "  [INFO] Exists: $dir" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "[DONE] Project initialization complete!" -ForegroundColor Green
Write-Host "[PATH] Workspace: $ProjectRoot" -ForegroundColor Cyan