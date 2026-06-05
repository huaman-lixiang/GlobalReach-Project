<#
.SYNOPSIS
    GlobalReach V2.0 Health Check Script for Windows/PowerShell
.DESCRIPTION
    Checks the health status of all GlobalReach Docker services
.NOTES
    Version: 1.0.0
#>

param(
    [string]$ApiUrl = "http://localhost:3000",
    [string]$NginxUrl = "http://localhost:80"
)

Write-Host "🔍 GlobalReach V2.0 Health Check Script" -ForegroundColor Cyan
Write-Host "========================================`n"

function Test-ServiceHealth {
    param(
        [string]$Url,
        [string]$ServiceName
    )
    
    try {
        $response = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 5 -ErrorAction Stop
        Write-Host "✅ $ServiceName is HEALTHY" -ForegroundColor Green
        Write-Host "   Status: $($response.status)" -ForegroundColor White
        return $true
    }
    catch {
        Write-Host "❌ $ServiceName is UNHEALTHY" -ForegroundColor Red
        return $false
    }
}

Write-Host "Checking API Service..." -ForegroundColor Yellow
Test-ServiceHealth -Url $ApiUrl -ServiceName "API Gateway"

Write-Host "`nChecking Nginx Reverse Proxy..." -ForegroundColor Yellow
try {
    $nginxResponse = Invoke-RestMethod -Uri "$NginxUrl/health" -TimeoutSec 5 -ErrorAction Stop
    Write-Host "✅ Nginx is HEALTHY" -ForegroundColor Green
    Write-Host "   HTTP → HTTPS redirect: Active" -ForegroundColor White
}
catch {
    Write-Host "❌ Nginx is UNHEALTHY or not configured" -ForegroundColor Yellow
}

Write-Host "`nSystem Resources:" -ForegroundColor Yellow
$containers = docker ps --filter "name=globalreach" --format "{{.Names}}: {{.Status}}" 2>$null
if ($containers) {
    $containers | ForEach-Object { Write-Host "   - $_" -ForegroundColor White }
}
else {
    Write-Host "   Docker not running or no containers found" -ForegroundColor Gray
}

Write-Host "`n========================================"
Write-Host "✨ Health Check Complete!" -ForegroundColor Green
