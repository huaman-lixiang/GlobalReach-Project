@echo off
chcp 65001 >nul
echo ============================================
echo   GlobalReach V2.0 - Quick Start Script
echo ============================================
echo.

if not exist .env (
    echo [INFO] Creating .env from template...
    copy .env.example .env >nul
    echo [WARN] Please edit .env file before starting!
    echo.
    pause
)

echo [1/4] Building Docker images...
docker-compose build --quiet
if errorlevel 1 (
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

echo.
echo [2/4] Starting services...
docker-compose up -d
if errorlevel 1 (
    echo [ERROR] Failed to start services!
    pause
    exit /b 1
)

echo.
echo [3/4] Waiting for services to be healthy...
timeout /t 10 /nobreak >nul

echo.
echo [4/4] Checking service status...
docker ps --filter "name=globalreach" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo.
echo ============================================
echo ✅ Deployment Complete!
echo.
echo API Documentation: http://localhost:3000/api-docs
echo Health Check:      http://localhost:3000/api/health
echo Nginx (HTTP):      http://localhost:80
echo Nginx (HTTPS):     https://localhost:443
echo ============================================
echo.
pause
