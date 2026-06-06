# ============================================================
# GlobalReach V2.0 — SSL Certificate Auto-Renewal (Windows)
# S101/PhaseH: Let's Encrypt Integration
# ============================================================
#
# USAGE:
#   Manual renew:    .\scripts\renew-ssl-certs.ps1
#   Dry-run test:    .\scripts\renew-ssl-certs.ps1 -DryRun
#   Scheduled Task:  Create via: .\scripts\renew-ssl-certs.ps1 -InstallTask
#
# PREREQUISITES:
#   - Docker Desktop running
#   - docker-compose.prod.yml with certbot service
#   - Nginx container with ACME challenge location
#   - Valid DNS A records (for production issuance)
#
# ============================================================

param(
    [switch]$DryRun,
    [switch]$InstallTask,
    [switch]$UninstallTask
)

$ErrorActionPreference = "Stop"
$COMPOSE_FILE = "docker-compose.prod.yml"
$CERTBOT_PROFILE = "ssl"
$LOG_PREFIX = "[SSL-RENEWAL]"
$TIMESTAMP = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

function Write-LogInfo($msg)  { Write-Host "$LOG_PREFIX [INFO]  $msg" -ForegroundColor Green }
function Write-LogWarn($msg)  { Write-Host "$LOG_PREFIX [WARN]  $msg" -ForegroundColor Yellow }
function Write-LogError($msg) { Write-Host "$LOG_PREFIX [ERROR] $msg" -ForegroundColor Red }

function Test-Prerequisites {
    Write-LogInfo "Checking prerequisites..."

    # Check Docker
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-LogError "Docker is not installed or not in PATH"
        exit 1
    }

    # Check docker compose
    $composeVersion = docker compose version 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-LogError "Docker Compose is not available"
        exit 1
    }

    # Check compose file exists
    if (-not (Test-Path $COMPOSE_FILE)) {
        Write-LogError "Compose file not found: $COMPOSE_FILE"
        exit 1
    }

    # Check Nginx container
    $nginxRunning = docker ps --format "{{.Names}}" | Select-String "globalreach-nginx-prod"
    if (-not $nginxRunning) {
        Write-LogWarn "Nginx container not running — ACME challenges may fail"
    } else {
        Write-LogInfo "Nginx container found ✓"
    }

    Write-LogInfo "Prerequisites check passed ✓"
}

function Invoke-CertificateRenewal {
    param([bool]$IsDryRun)

    Write-LogInfo "Starting certificate renewal process..."

    $cmd = "docker compose -f $COMPOSE_FILE --profile $CERTBOT_PROFILE run --rm certbot"

    if ($IsDryRun) {
        $cmd += " renew --dry-run"
        Write-LogInfo "Running in DRY-RUN mode (no actual changes)"
    } else {
        $cmd += " renew --quiet"
    }

    Invoke-Expression $cmd

    if ($LASTEXITCODE -eq 0) {
        Write-LogInfo "Certificate renewal completed successfully ✓"
        return $true
    } else {
        Write-LogError "Certificate renewal failed"
        return $false
    }
}

function Reload-Nginx {
    Write-LogInfo "Reloading Nginx to apply new certificates..."

    $testResult = docker exec globalreach-nginx-prod nginx -t 2>&1
    if ($LASTEXITCODE -eq 0) {
        docker exec globalreach-nginx-prod nginx -s reload 2>&1 | Out-Null
        Write-LogInfo "Nginx reloaded successfully ✓"
    } else {
        Write-LogError "Nginx config test failed — skipping reload"
        Write-LogError $testResult
        return $false
    }
}

function Get-CertificateExpiry {
    $certPath = ".\nginx\ssl\letsencrypt\live\globalreach.com\fullchain.pem"

    if (-not (Test-Path $certPath)) {
        Write-LogWarn "Certificate file not found at $certPath"
        return
    }

    # Use certutil on Windows to check certificate expiry
    $certInfo = certutil -dump $certPath 2>$null | Select-String "NotAfter"
    if ($certInfo) {
        Write-LogInfo "Certificate info: $($certInfo.Line.Trim())"
    }
}

function Install-ScheduledTask {
    Write-LogInfo "Installing scheduled task for auto-renewal..."

    $taskName = "GlobalReach-SSL-Renewal"
    $scriptPath = $PSCommandPath
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
    $trigger = New-ScheduledTaskTrigger -Daily -At "03:00"
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable

    Register-ScheduledTask -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description "GlobalReach Let's Encrypt SSL Certificate Auto-Renewal" `
        -Force

    Write-LogInfo "Scheduled task '$taskName' installed ✓ (runs daily at 03:00)"
}

function Uninstall-ScheduledTask {
    $taskName = "GlobalReach-SSL-Renewal"

    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-LogInfo "Scheduled task '$taskName' removed ✓"
    } else {
        Write-LogWarn "Scheduled task '$taskName' not found"
    }
}

# ---- Main ----
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  GlobalReach SSL Certificate Renewal" -ForegroundColor Cyan
Write-Host "  $TIMESTAMP" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

if ($UninstallTask) {
    Uninstall-ScheduledTask
    exit 0
}

if ($InstallTask) {
    Test-Prerequisites
    Install-ScheduledTask
    exit 0
}

Test-Prerequisites

if (Invoke-CertificateRenewal -IsDryRun $DryRun.IsPresent) {
    if (-not $DryRun.IsPresent) {
        Reload-Nginx
        Get-CertificateExpiry
    }
    Write-LogInfo "Renewal process complete ✓"
    exit 0
} else {
    Write-LogError "Renewal process failed ✗"
    exit 1
}
