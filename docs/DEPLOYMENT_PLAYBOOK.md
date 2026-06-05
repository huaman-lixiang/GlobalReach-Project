# GlobalReach V2.0 — 部署操作手册 (Deployment Playbook)

> **版本**: 1.0.0 | **日期**: 2026-06-05 | **当前已知可用 Commit**: `403e2c9`
> **UAT 通过率**: 17/20 (85%), 0 BLOCKED | **已修复关键 Bug**: DEFECT-001 (validateRequest), L04 (isActive column)

---

## 目录

- [第 1 节：部署概览](#第-1-节部署概览)
- [第 2 节：首次部署（全新环境）](#第-2-节首次部署全新环境)
- [第 3 节：常规更新部署](#第-3-节常规更新部署)
- [第 4 节：蓝绿部署（未来方案）](#第-4-节蓝绿部署未来方案)
- [第 5 节：回滚程序](#第-5-节回滚程序)
- [第 6 节：CI/CD 流水线集成](#第-6-节cicd-流水线集成)
- [第 7 节：环境特定配置](#第-7-节环境特定配置)
- [第 8 节：部署安全注意事项](#第-8-节部署安全注意事项)
- [第 9 节：部署验证](#第-9-节部署验证)
- [第 10 节：部署运行记录模板](#第-10-节部署运行记录模板)

---

## 第 1 节：部署概览

### 1.1 目标环境

| 环境 | 用途 | 部署方式 | 触发条件 |
|------|------|----------|----------|
| **Local Development** | 本地开发调试 | Docker Compose (`docker-compose.yml`) | 开发者手动 |
| **Staging** | 预发布验证 | Docker Compose (`docker-compose.prod.yml`) + 环境变量覆盖 | 手动 / PR 触发 |
| **Production** | 生产运行 | GitHub Actions CI/CD → SSH Deploy → Docker Compose | Push to main |

### 1.2 当前部署方法

```
┌─────────────────────────────────────────────────────────────────────┐
│                    GlobalReach V2.0 部署架构                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌───────────┐    HTTP/HTTPS    ┌──────────────────────────────┐  │
│   │  用户请求  │ ──────────────→ │         Nginx (:80/:443)      │  │
│   │ (Browser) │                  │  nginx:alpine                 │  │
│   └───────────┘                  │  - SSL Termination            │  │
│                                  │  - Reverse Proxy              │  │
│                                  │  - Rate Limiting              │  │
│                                  └──────────────┬───────────────┘  │
│                                                 │                   │
│                                  ┌──────────────▼───────────────┐  │
│                                  │     API Service (:3000)       │  │
│                                  │  node:20-alpine               │  │
│                                  │  GlobalReach V2 Backend       │  │
│                                  └──────┬───────────┬───────────┘  │
│                                         │           │             │
│                    ┌────────────────────▼──┐  ┌─────▼──────────┐  │
│                    │ PostgreSQL 15 (:5432) │  │ Redis 7 (:6379)│  │
│                    │ postgres:15-alpine    │  │ redis:7-alpine │  │
│                    └───────────────────────┘  └────────────────┘  │
│                                                                     │
│   ┌────────────────── 监控层 ──────────────────────────────────┐   │
│   │                                                           │   │
│   │  Prometheus (:9090) ← Node Exporter (:9100)                │   │
│   │                    ← Postgres Exporter (:9187)             │   │
│   │                    ← API Metrics (/api/v1/metrics)        │   │
│   │                                                           │   │
│   │  Grafana (:3002) → 可视化仪表盘                            │   │
│   └───────────────────────────────────────────────────────────┘   │
│                                                                     │
│   ┌────────────────── CI/CD 层 ─────────────────────────────────┐   │
│   │  GitHub Actions:                                            │   │
│   │  Quality Gate → Unit Tests → Docker Build → Trivy Scan     │   │
│   │  → SSH Deploy (PROD_HOST)                                   │   │
│   └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 服务清单（8 个容器）

| # | 服务名 | 容器名 | 基础镜像 | 内部端口 | 外部端口 | 用途 |
|---|--------|--------|----------|----------|----------|------|
| 1 | `postgres` | globalreach-postgres | `postgres:15-alpine` | 5432 | — (仅内部) | 主数据库 |
| 2 | `redis` | globalreach-redis | `redis:7-alpine` | 6379 | — (仅内部) | 缓存 / Session |
| 3 | `api` | globalreach-api-prod | `node:20-alpine` (自构建) | 3000 | 3000 | API 后端服务 |
| 4 | `nginx` | globalreach-nginx-prod | `nginx:alpine` | 80, 443 | 80, 443 | 反向代理 / SSL |
| 5 | `prometheus` | globalreach-prometheus | `prom/prometheus:latest` | 9090 | 9090 | 指标采集 |
| 6 | `grafana` | globalreach-grafana | `grafana/grafana:latest` | 3000 | 3002 | 可视化面板 |
| 7 | `node-exporter` | globalreach-node-exporter | `prom/node-exporter:latest` | 9100 | — (仅内部) | 主机指标 |
| 8 | `postgres-exporter` | globalreach-pg-exporter | `prometheuscommunity/postgres-exporter:latest` | 9187 | — (仅内部) | DB 指标 |

### 1.4 各环境前置条件检查清单

#### Local Development

```powershell
# ✅ 检查项
# [ ] Docker Desktop for Windows 已安装并运行
# [ ] Git 已安装 (git --version)
# [ ] Node.js 20.x 已安装 (可选，Docker 内部使用)
# [ ] 端口 3000, 5432, 6379 未被占用
# [ ] 至少 4GB 可用内存 (Docker 推荐)

# 快速检查命令
docker info >$null 2>&1; if ($LASTEXITCODE -eq 0) { Write-Host "✅ Docker 运行中" } else { Write-Host "❌ Docker 未运行" }
git --version
netstat -an | Select-String ":3000 :5432 :6379" | Select-Object -First 5
```

#### Staging / Production

```powershell
# ✅ 检查项
# [ ] Docker Engine + Compose v2 已安装
# [ ] Git 仓库已克隆到目标服务器
# [ ] .env 文件已配置（所有密钥已替换）
# [ ] SSL 证书已放置在 nginx/ssl/globalreach/ 目录
# [ ] 以下端口可用：80, 443, 3000, 3002, 5432, 6379, 9090, 9100, 9187
# [ ] Docker 网络 globalreach-project_globalreach-network 已创建
# [ ] 防火墙规则已配置（入站 80/443，出站允许）
# [ ] 磁盘空间 ≥ 20GB 可用
# [ ] 内存 ≥ 4GB 可用

# 一键前置检查脚本
Write-Host "=== GlobalReach 部署前置条件检查 ===" -ForegroundColor Cyan

# 1. Docker
docker info >$null 2>&1
if ($LASTEXITCODE -eq 0) { Write-Host "[✅] Docker Engine 正常" } else { Write-Host "[❌] Docker Engine 异常" }

# 2. Docker Compose
docker compose version >$null 2>&1
if ($LASTEXITCODE -eq 0) { Write-Host "[✅] Docker Compose 正常" } else { Write-Host "[❌] Docker Compose 异常" }

# 3. 端口占用检查
$ports = @(80, 443, 3000, 3002, 5432, 6379, 9090)
foreach ($p in $ports) {
    $used = netstat -an | Select-String ":$p\s.*LISTEN"
    if ($used) { Write-Host "[⚠️] 端口 $p 已被占用" } else { Write-Host "[✅] 端口 $p 可用" }
}

# 4. 磁盘空间
$disk = Get-PSDrive C | Select-Object Used, Free
$pctFree = [math]::Round(($disk.Free / ($disk.Used + $disk.Free)) * 100, 1)
Write-Host "[✅] C 盘剩余空间: $([math]::Round($disk.Free/1GB, 1)) GB ($pctFree% free)"

# 5. 内存
$mem = Get-CimInstance Win32_OperatingSystem
$freeGB = [math]::Round($mem.FreePhysicalMemory / 1MB, 1)
$totalGB = [math]::Round($mem.TotalVisibleMemorySize / 1MB, 1)
Write-Host "[✅] 可用内存: ${freeGB}GB / ${totalGB}GB"
```

---

## 第 2 节：首次部署（全新环境）

> **适用场景**: 全新机器、从零开始搭建 GlobalReach V2.0 完整环境

### 2.1 环境准备

```powershell
# ═══════════════════════════════════════════════════════════════
# 前置依赖
# ═══════════════════════════════════════════════════════════════
# - Docker Desktop (Windows) 已安装并启动
# - Git 已安装
# - PowerShell 5.1+ (Windows 自带)
#
# 需要开放的端口：
#   80    → Nginx HTTP
#   443   → Nginx HTTPS
#   3000  → API 直接访问（生产环境通过 Nginx 代理）
#   3002  → Grafana
#   5432  → PostgreSQL（仅 Docker 内部网络）
#   6379  → Redis（仅 Docker 内部网络）
#   9090  → Prometheus
#   9100  → Node Exporter（内部）
#   9187  → Postgres Exporter（内部）
# ═══════════════════════════════════════════════════════════════
```

### 2.2 初始设置步骤（逐步执行）

#### 步骤 1：克隆代码仓库

```powershell
# 切换到工作目录
cd C:\Users\Administrator\Documents\trae_projects

# 克隆仓库（如果尚未克隆）
if (!(Test-Path "GlobalReach-Project")) {
    git clone https://github.com/huaman-lixiang/GlobalReach-Project.git
}

# 进入项目目录
cd GlobalReach-Project

# 确认当前分支和最新 commit
git branch -a
git log --oneline -5
```

#### 步骤 2：配置 .env 文件

```powershell
# 从模板复制 .env 配置文件
Copy-Item .env.example .env -Force

# 使用默认编辑器打开编辑（或手动修改下方内容）
notepad .env
```

**`.env` 生产配置模板**（根据实际环境修改）：

```env
# ============================================================
# GlobalReach V2.0 — 生产环境配置 (.env)
# ⚠️ 部署前必须修改所有密码和密钥！
# ============================================================

# ---- 数据库配置 ----
DB_NAME=globalreach_prod
DB_USER=globalreach_user
DB_PASSWORD=GlobalReach2026!
DB_HOST=postgres
DB_PORT=5432

# ---- Redis 配置 ----
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=

# ---- JWT 安全配置（必须 ≥ 32 字符）----
JWT_SECRET=CHANGE-ME-TO-A-SECURE-RANDOM-STRING-AT-LEAST-32-CHARACTERS-LONG!!!
JWT_EXPIRES_IN=24h

# ---- CSRF 保护 ----
CSRF_SECRET=CHANGE-ME-CSRF-SECRET-STRING-HERE

# ---- 应用配置 ----
NODE_ENV=production
APP_NAME=GlobalReach-V2
API_PORT=3000
LOG_LEVEL=info

# ---- Grafana 管理员密码 ----
GRAFANA_ADMIN_PASSWORD=your_secure_grafana_password

# ---- 邮件服务（SendGrid）----
SENDGRID_API_KEY=your_sendgrid_api_key_here
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your_sendgrid_api_key_here

# ---- 限流配置 ----
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=900000

# ---- Docker 镜像标签 ----
IMAGE_TAG=latest
```

> **安全提示**: `.env` 文件已在 `.gitignore` 中，不会被提交到版本库。请勿将包含真实密码的 `.env` 文件推送到 Git。

#### 步骤 3：生成/配置 SSL 证书

```powershell
# 方案 A：使用已有证书（推荐生产环境）
# 将证书文件放置到以下目录：
#   nginx/ssl/globalreach/globalreach.crt      (证书文件)
#   nginx/ssl/globalreach/globalreach.key      (私钥文件)
#   nginx/ssl/globalreach/globalreach-ca.crt   (CA 证书，如有)

# 方案 B：生成自签名开发证书（仅用于本地测试）
if (!(Test-Path "nginx\ssl\globalreach")) {
    New-Item -ItemType Directory -Path "nginx\ssl\globalreach" -Force
}

# 使用 OpenSSL 生成自签名证书（需要 OpenSSL 或 Git Bash）
# 在 Git Bash 中执行以下命令：
# openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
#   -keyout nginx/ssl/globalreach/globalreach.key \
#   -out nginx/ssl/globalreach/globalreach.crt \
#   -subj "/C=CN/ST=Beijing/L=Beijing/O=GlobalReach/CN=localhost"

Write-Host "SSL 证书目录: $(Resolve-Path 'nginx\ssl\globalreach')"
Get-ChildItem "nginx\ssl\globalreach" -ErrorAction SilentlyContinue
```

#### 步骤 4：创建 Docker 网络

```powershell
# 创建外部网络（docker-compose.prod.yml 引用的 external network）
$networkName = "globalreach-project_globalreach-network"
$existing = docker network ls --format "{{.Name}}" | Select-String $networkName

if (-not $existing) {
    docker network create $networkName
    Write-Host "✅ Docker 网络已创建: $networkName"
} else {
    Write-Host "ℹ️ Docker 网络已存在: $networkName"
}
```

#### 步骤 5：初始化数据库（迁移 + 种子数据）

```powershell
# 启动数据库服务（先只启动 postgres 和 redis）
docker compose -f docker-compose.prod.yml up -d postgres redis

# 等待 PostgreSQL 就绪（最多等待 60 秒）
Write-Host "等待 PostgreSQL 就绪..."
for ($i = 1; $i -le 20; $i++) {
    $ready = docker exec globalreach-postgres pg_isready -U globalreach_user -d globalreach_prod 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ PostgreSQL 已就绪 (尝试 $i)"
        break
    }
    Start-Sleep -Seconds 3
}

# 执行数据库迁移（Sequelize sync）
Write-Host "执行数据库迁移..."
docker compose -f docker-compose.prod.yml run --rm api node -e "
const { Sequelize } = require('sequelize');
const db = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false
});
db.sync({ alter: true })
  .then(() => { console.log('✅ 数据库表结构同步完成'); process.exit(0); })
  .catch((err) => { console.error('❌ 迁移失败:', err.message); process.exit(1); });
"

# 如果有种子数据脚本，在此执行
# docker compose -f docker-compose.prod.yml run --rm api npm run seed
```

#### 步骤 6：启动全部服务

```powershell
# 启动所有 8 个服务
docker compose -f docker-compose.prod.yml up -d

# 查看容器状态
Write-Host "`n=== 容器启动状态 ==="
docker compose -f docker-compose.prod.yml ps

# 等待所有健康检查通过（约 60-90 秒）
Write-Host "`n等待服务就绪..."
Start-Sleep -Seconds 30

# 再次确认状态
docker compose -f docker-compose.prod.yml ps
```

#### 步骤 7：健康检查验证

```powershell
# API 健康检查端点
Write-Host "=== API 健康检查 ===" -ForegroundColor Cyan
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/health" -TimeoutSec 10
    $health | ConvertTo-Json -Depth 5
    $score = $health.score
    if ($score -ge 75) {
        Write-Host "✅ 健康评分: $score (≥75，状态正常)" -ForegroundColor Green
    } elseif ($score -ge 50) {
        Write-Host "⚠️ 健康评分: $score (50-74，部分降级)" -ForegroundColor Yellow
    } else {
        Write-Host "❌ 健康评分: $score (<50，严重异常)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ API 健康检查失败: $_" -ForegroundColor Red
}
```

#### 步骤 8：创建初始管理员用户

```powershell
# 通过 API 注册管理员账户（如果支持注册接口）
$body = @{
    email = "admin@globalreach.com"
    password = "InitialAdminPass2026!"
    name = "GlobalReach Admin"
    role = "admin"
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/auth/register" `
        -Method Post -ContentType "application/json" -Body $body -TimeoutSec 10
    Write-Host "✅ 管理员创建成功:" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 3
} catch {
    # 如果注册接口不可用，可能需要直接写入 DB
    Write-Host "ℹ️ 通过 API 创建管理员失败，请手动通过数据库插入或使用管理面板" -ForegroundColor Yellow
}
```

> **重要**: 首次登录后立即修改管理员默认密码！

### 2.3 部署后验证清单

```powershell
# ═══════════════════════════════════════════════════════════════
# 首次部署验证清单（逐项检查）
# ═══════════════════════════════════════════════════════════════

Write-Host "`n========== GlobalReach V2.0 部署验证 ==========" -ForegroundColor Cyan

# --- 检查 1: 所有 8 个容器运行中 ---
Write-Host "`n[检查 1] 容器状态" -ForegroundColor Yellow
$containers = @(
    "globalreach-postgres",
    "globalreach-redis",
    "globalreach-api-prod",
    "globalreach-nginx-prod",
    "globalreach-prometheus",
    "globalreach-grafana",
    "globalreach-node-exporter",
    "globalreach-pg-exporter"
)
$runningCount = 0
foreach ($c in $containers) {
    $status = docker inspect -f '{{.State.Status}}' $c 2>$null
    if ($status -eq "running") {
        Write-Host "  ✅ $c — running"
        $runningCount++
    } else {
        Write-Host "  ❌ $c — $status"
    }
}
Write-Host "  📊 运行中: $runningCount / 8"

# --- 检查 2: API 健康端点 ---
Write-Host "`n[检查 2] API 健康端点" -ForegroundColor Yellow
try {
    $h = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/health" -TimeoutSec 10
    $s = $h.score
    $st = $h.status
    if ($s -ge 75) { Write-Host "  ✅ 状态=$st, 评分=$s (合格)" -ForegroundColor Green }
    else { Write-Host "  ⚠️ 状态=$st, 评分=$s (<75)" -ForegroundColor Yellow }
} catch { Write-Host "  ❌ 无法连接: $_" -ForegroundColor Red }

# --- 检查 3: 认证流程 ---
Write-Host "`n[检查 3] 认证流程 (Register → Login → Profile)" -ForegroundColor Yellow
try {
    # 尝试登录
    $loginBody = @{ email = "admin@globalreach.com"; password = "InitialAdminPass2026!" } | ConvertTo-Json
    $loginRes = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/auth/login" `
        -Method Post -ContentType "application/json" -Body $loginBody -TimeoutSec 10
    Write-Host "  ✅ 登录成功，获取到 token" -ForegroundColor Green
} catch {
    Write-Host "  ℹ️ 登录测试跳过（可能需先注册）: $($_.Exception.Message)" -ForegroundColor Gray
}

# --- 检查 4: Prometheus Targets ---
Write-Host "`n[检查 4] Prometheus Target 状态" -ForegroundColor Yellow
try {
    $targets = Invoke-RestMethod -Uri "http://localhost:9090/api/v1/targets" -TimeoutSec 10
    $upTargets = ($targets.data.activeTargets | Where-Object { $_.health -eq "up" }).Count
    $totalTargets = $targets.data.activeTargets.Count
    Write-Host "  📊 UP: $upTargets / $totalTargets targets"
    foreach ($t in $targets.data.activeTargets) {
        $label = $t.labels.job
        $health = $t.health.ToUpper()
        if ($health -eq "UP") { Write-Host "    ✅ $label" }
        else { Write-Host "    ❌ $label — $health" }
    }
} catch { Write-Host "  ❌ Prometheus 不可达" -ForegroundColor Red }

# --- 检查 5: Grafana ---
Write-Host "`n[检查 5] Grafana 可访问性" -ForegroundColor Yellow
try {
    $grafana = Invoke-RestMethod -Uri "http://localhost:3002/api/health" -TimeoutSec 10
    Write-Host "  ✅ Grafana 正常 (version: $($grafana.version))" -ForegroundColor Green
} catch { Write-Host "  ❌ Grafana 不可达" -ForegroundColor Red }

# --- 检查 6: Nginx ---
Write-Host "`n[检查 6] Nginx 服务" -ForegroundColor Yellow
$httpTest = Invoke-WebRequest -Uri "http://localhost/nginx-health" -TimeoutSec 5 -UseBasicParsing
if ($httpTest.StatusCode -eq 200) {
    Write-Host "  ✅ Nginx HTTP (:80) 正常" -ForegroundColor Green
} else { Write-Host "  ❌ Nginx HTTP 异常" -ForegroundColor Red }

# HTTPS 测试（如果有有效证书）
try {
    $httpsTest = Invoke-WebRequest -Uri "https://localhost/api/v1/health" -SkipCertificateCheck -TimeoutSec 5 -UseBasicParsing
    if ($httpsTest.StatusCode -eq 200) {
        Write-Host "  ✅ Nginx HTTPS (:443) 正常" -ForegroundColor Green
    }
} catch {
    Write-Host "  ℹ️ Nginx HTTPS 跳过（可能是自签名证书）" -ForegroundColor Gray
}

Write-Host "`n========== 验证完成 ==========" -ForegroundColor Cyan
```

---

## 第 3 节：常规更新部署

> **适用场景**: 日常功能更新、Bug 修复、小版本迭代
> **目标**: 零停机时间 (Zero-Downtime Deployment)

### 3.1 标准更新流程

```powershell
# ═══════════════════════════════════════════════════════════════
# 标准更新部署流程（PowerShell，可复制粘贴执行）
# ═══════════════════════════════════════════════════════════════

# === 前置步骤：记录当前状态 ===
cd C:\Users\Administrator\Documents\trae_projects\GlobalReach-Project
$beforeCommit = git rev-parse --short HEAD
$beforeDate = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Host "📋 当前 Commit: $beforeCommit | 时间: $beforeDate"

# === Step 1: 备份当前镜像标签（用于回滚）===
$currentImage = docker images --format "{{.Repository}}:{{.Tag}}" | Select-String "globalreach-project-api"
if ($currentImage) {
    docker tag globalreach-project-api:latest globalreach-project-api:rollback-$beforeCommit
    Write-Host "📦 已备份回滚镜像: globalreach-project-api:rollback-$beforeCommit"
}

# === Step 2: 拉取最新代码 ===
Write-Host "`n--- Step 1: 拉取最新代码 ---"
git pull origin main
$afterCommit = git rev-parse --short HEAD
Write-Host "📋 更新后 Commit: $afterCommit"

# === Step 3: 仅重建受影响的服务（API）===
Write-Host "`n--- Step 2: 重建 API 镜像 ---"
docker compose -f docker-compose.prod.yml build --no-cache api

# === Step 4: 滚动重启（一次一个服务）===
Write-Host "`n--- Step 3: 滚动重启 API 服务 ---"
docker compose -f docker-compose.prod.yml up -d --force-recreate api

# === Step 5: 等待健康检查通过 ===
Write-Host "`n--- Step 4: 等待健康检查 ---"
Start-Sleep -Seconds 15

$maxAttempts = 10
$healthy = $false
for ($i = 1; $i -le $maxAttempts; $i++) {
    try {
        $health = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/health" -TimeoutSec 5
        $status = $health.status
        $score = $health.score
        Write-Host "  尝试 [$i/$maxAttempts]: status=$status, score=$score"
        if ($status -eq "healthy" -or $status -eq "degraded") {
            if ($score -ge 75) {
                $healthy = $true
                Write-Host "  ✅ 健康检查通过!" -ForegroundColor Green
                break
            }
        }
    } catch {
        Write-Host "  尝试 [$i/$maxAttempts]: 连接中..."
    }
    Start-Sleep -Seconds 3
}

if (-not $healthy) {
    Write-Host "❌ 健康检查未通过！建议执行回滚。" -ForegroundColor Red
    exit 1
}

# === Step 6: 验证关键端点 ===
Write-Host "`n--- Step 5: 验证关键端点 ---"

# Health endpoint
$h = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/health" -TimeoutSec 5
Write-Host "  Health: $($h.status) (score: $($h.score))"

# Auth login test
try {
    $loginR = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/auth/login" `
        -Method Post -ContentType "application/json" -Body '{"email":"test@test.com","password":"test"}' `
        -TimeoutSec 5
    Write-Host "  Auth Login: 响应正常 (status: $($loginR.statusCode))"
} catch {
    # 401/400 是预期的（测试凭据无效），说明路由可达
    if ($_.Exception.Response.StatusCode.value__ -in @(400, 401, 404)) {
        Write-Host "  Auth Login: ✅ 端点可达 (HTTP $($_.Exception.Response.StatusCode.value__))"
    } else {
        Write-Host "  Auth Login: ⚠️ $($_.Exception.Message)"
    }
}

# Metrics endpoint
try {
    $m = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/metrics" -TimeoutSec 5
    Write-Host "  Metrics: ✅ 可访问"
} catch { Write-Host "  Metrics: ⚠️ $($_.Exception.Message)" }

Write-Host "`n🚀 部署完成! $beforeCommit → $afterCommit" -ForegroundColor Green
```

### 3.2 数据库迁移处理

#### 自动迁移（sync 模式）

当前 GlobalReach 使用 Sequelize ORM 的 `sync({alter:true})` 模式进行自动 schema 同步：

```powershell
# 应用启动时自动执行 sync({alter:true})
# 位置: API server.js 启动入口
# 行为: 对比模型定义与实际 DB 表结构，自动添加缺失的列/表
# 适用场景: 新增字段、新增表等非破坏性变更
```

**何时触发自动迁移**:
- 每次 API 容器启动时
- `docker compose up -d --force-recreate api` 后

#### 手动迁移（破坏性变更）

当涉及以下变更时，**必须手动处理**：

```powershell
# ═══════════════════════════════════════════════════════════════
# 需要手动迁移的场景：
# - 删除列/表
# - 修改列类型（可能导致数据丢失）
# - 重命名列/表
# - 添加 NOT NULL 约束到已有数据的列
# - 修改主键/外键关系
# ═══════════════════════════════════════════════════════════════
```

**手动迁移标准流程**：

```powershell
# Step 1: 迁移前备份（强制要求！）
$backupTime = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = "backups/pg_globalreach_${backupTime}.sql"

if (!(Test-Path "backups")) { New-Item -ItemType Directory -Path "backups" -Force }

docker exec globalreach-postgres pg_dump -U globalreach_user -d globalreach_prod > $backupFile
Write-Host "📦 数据库已备份至: $backupFile ($(Get-Item $backupFile).Length bytes)"

# Step 2: 执行迁移 SQL
# 将你的 migration.sql 放在项目根目录，然后：
# docker exec -i globalreach-postgres psql -U globalreach_user -d globalreach_prod < migration.sql

# Step 3: 验证迁移结果
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "\dt"

# Step 4: 如果迁移失败 — 立即回滚
# docker exec -i globalreach-postgres psql -U globalreach_user -d globalreach_prod < $backupFile
# Write-Host "🔄 已从备份恢复数据库"
```

#### 迁移失败回滚决策树

```
迁移执行
  ├── 成功 → 继续 Step 3 验证
  │     ├── 验证通过 → ✅ 迁移完成
  │     └── 验证失败 → 从备份恢复 → 排查原因
  └── 失败 → 立即停止！
        ├── 有备份 → 恢复备份 → 回滚代码 → 通知团队
        └── 无备份 → 🔴 紧急联系 DBA → 不要尝试修复！
```

### 3.3 仅配置变更（无代码改动）

当只需要更新 `.env` 变量而不涉及代码变更时：

```powershell
# 场景示例：更新 JWT_SECRET、调整限流参数、更换邮件服务商配置

# Step 1: 编辑 .env 文件
notepad .env

# Step 2: 重启受影响的服务（无需 rebuild）
# 如果改了 DB/Redis 相关变量 → 重启 api
docker compose -f docker-compose.prod.yml restart api

# 如果改了 Grafana 密码 → 重启 grafana
# docker compose -f docker-compose.prod.yml restart grafana

# 如果改了多个服务的配置 → 全部重启
# docker compose -f docker-compose.prod.yml restart

# Step 3: 验证
Start-Sleep -Seconds 10
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/health" | ConvertTo-Json
```

**热重载能力说明**:

| 服务 | 支持 Hot Reload | 说明 |
|------|-----------------|------|
| API | ❌ | 需要 restart 才能读取新环境变量 |
| Nginx | ✅ | `docker exec globalreach-nginx-prod nginx -s reload` |
| Redis | ✅ | 大多数配置可通过 CONFIG SET 动态调整 |
| PostgreSQL | 部分 | 部分参数需要 reload/restart |
| Prometheus | ❌ | 需要重启加载新规则 |
| Grafana | ✅ | 数据源/Dashboard 通过 UI 修改即时生效 |

```powershell
# Nginx 热重载示例（不中断连接）
docker exec globalreach-nginx-prod nginx -t && docker exec globalreach-nginx-prod nginx -s reload
Write-Host "✅ Nginx 配置已热重载"
```

---

## 第 4 节：蓝绿部署（未来方案）

> **当前状态**: 计划中，待远程服务器到位后实施
> **参考**: G11 任务 — 远程服务器部署架构设计

### 4.1 概念说明

蓝绿部署 (Blue-Green Deployment) 是一种实现零停机发布的策略：

```
                     ┌──────────────┐
                     │   Load       │
                     │   Balancer   │
                     │   (Nginx)    │
                     └──────┬───────┘
                            │
                 ┌──────────┼──────────┐
                 ▼                     ▼
        ┌────────────┐        ┌────────────┐
        │   BLUE     │        │   GREEN    │
        │  (当前生产) │        │  (新版本)  │
        │  v2.0.1    │        │  v2.0.2    │
        │  ✅ Active  │        │  🔄 Standby│
        └────────────┘        └────────────┘

切换流量只需修改 Nginx upstream 配置，秒级完成。
```

### 4.2 Docker Compose 蓝绿策略

```powershell
# ═══════════════════════════════════════════════════════════════
# 蓝绿部署 — 命令参考（远程服务器上执行）
# ═══════════════════════════════════════════════════════════════

# --- Phase 1: 部署 Green 环境 ---
# 使用不同端口避免冲突
IMAGE_TAG=v2.0.2-green docker compose -f docker-compose.prod.yml up -d api

# 修改 green 的 API 映射到 3001 端口
# （需要在 compose override 中指定）

# --- Phase 2: 验证 Green 环境 ---
# 对 3001 端口进行完整冒烟测试
curl.exe http://localhost:3001/api/v1/health

# --- Phase 3: 切换流量 ---
# 更新 Nginx upstream 指向 Green (3001)
# docker exec globalreach-nginx-prod nginx -s reload

# --- Phase 4: 确认后下线 Blue ---
# docker stop globalreach-api-blue
```

### 4.3 流量切换（Nginx Upstream）

```nginx
# nginx/conf.d/blue-green.conf 示例
upstream globalreach_api_blue {
    server globalreach-api-blue:3000;
}

upstream globalreach_api_green {
    server globalreach-api-green:3001;
}

# 默认指向 Blue
server {
    location / {
        proxy_pass http://globalreach_api_blue;
    }
}

# 切换到 Green 时，将 upstream 改为 globalreach_api_green 后 reload
```

### 4.4 回滚方式

蓝绿部署的最大优势是**瞬时回滚**：

```powershell
# 回滚 = 切换流量回到 Blue（之前的版本）
# 无需重新构建、无需等待启动、秒级恢复

# 方法: 修改 Nginx upstream 指向 Blue → nginx -s reload
# 或: 如果 Green 有问题，直接 stop Green 容器即可
docker stop globalreach-api-green
```

---

## 第 5 节：回滚程序

> **详细文档**: 参考 `docs/ROLLBACK_PROCEDURE.md`
> 本节提供快速回滚命令速查。

### 5.1 快速回滚命令

```powershell
# ═══════════════════════════════════════════════════════════════
# 场景 A: API 容器崩溃 / 部署失败 — 最快恢复 (< 2 分钟)
# ═══════════════════════════════════════════════════════════════

# Step 1: 查看当前状态
docker ps --filter "name=globalreach" --format "table {{.Names}}\t{{.Status}}"

# Step 2: 重启 API 服务
cd C:\Users\Administrator\Documents\trae_projects\GlobalReach-Project
docker compose -f docker-compose.prod.yml restart api

# Step 3: 等待 30 秒后验证
Start-Sleep 30
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/health"

# Step 4: 如果重启仍失败，强制重建
docker compose -f docker-compose.prod.yml up -d --force-recreate api
```

```powershell
# ═══════════════════════════════════════════════════════════════
# 场景 B: 代码推送导致问题 — 回退到上一个可用 commit
# ═══════════════════════════════════════════════════════════════

# Step 1: 查看最近的 commit 历史，确定最后一个可用的版本
git log --oneline -10
# 输出示例：
# 403e2c9 (HEAD -> main) Fix: isActive column missing (L04) ← 当前（有问题）
# abc1234 Fix: validateRequest middleware (DEFECT-001) ← 上一个可用
# def5678 Feature: email campaign scheduling
# ...

# Step 2: 回退到上一个好的 commit
git revert HEAD          # 推荐：创建一个 revert commit（保留历史）
# 或者
# git reset --hard abc1234  # 强制回退（会丢失后续 commit）

# Step 3: 重新部署
docker compose -f docker-compose.prod.yml build --no-cache api
docker compose -f docker-compose.prod.yml up -d --force-recreate api

# Step 4: 推送修复（如果是 revert 方式）
git push origin main
# CI/CD 会自动部署修复后的版本
```

```powershell
# ═══════════════════════════════════════════════════════════════
# 场景 C: 使用之前保存的镜像标签回滚
# ═══════════════════════════════════════════════════════════════

# 前提：在更新前已执行了 docker tag 备份（见 3.1 节 Step 1）

# Step 1: 查看可用的回滚镜像
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}" | Select-String "rollback"

# Step 2: 使用回滚镜像重新打标签
docker tag globalreach-project-api:rollback-403e2c9 globalreach-project-api:latest

# Step 3: 重建容器
docker compose -f docker-compose.prod.yml up -d --force-recreate api

# Step 4: 验证
Start-Sleep 15
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/health"
```

### 5.2 数据库回滚

```powershell
# ═══════════════════════════════════════════════════════════════
# 数据库回滚 — 从备份恢复
# ═══════════════════════════════════════════════════════════════

# Step 1: 停止依赖 DB 的服务
docker compose -f docker-compose.prod.yml stop api

# Step 2: 查找最新的备份文件
$latestBackup = Get-ChildItem "backups\pg_globalreach_*.sql |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
Write-Host "📦 使用备份: $($latestBackup.FullName)"

# Step 3: 恢复数据库
Get-Content $latestBackup.FullName |
    docker exec -i globalreach-postgres psql -U globalreach_user -d globalreach_prod

# Step 4: 重启服务
docker compose -f docker-compose.prod.yml start api

# Step 5: 验证数据完整性
Start-Sleep 10
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/health"
```

### 5.3 确定回滚点

| 方法 | 命令 | 说明 |
|------|------|------|
| 查看 commit 历史 | `git log --oneline -10` | 找到最后一个正常的 commit |
| 查看镜像列表 | `docker images \| grep globalreach` | 找到最后一个可用的镜像 tag |
| 查看容器日志 | `docker logs globalreach-api-prod --tail 100` | 定位出错的时间点和原因 |
| 查看 CI/CD 记录 | GitHub Actions 页面 | 找到最后一次绿色通过的 workflow run |

**当前已知可用状态**:

| 组件 | 版本 | 最后验证 | 回滚目标 |
|------|------|----------|----------|
| API Image | `globalreach-project-api:latest` (SHA: `403e2c9`) | S083 | `403e2c9` tag |
| Docker Compose | `docker-compose.prod.yml` (8 services) | S083 | Previous commit |
| DB Schema | PostgreSQL 15, 11 tables | S083 | Latest .sql backup |
| SSL Cert | `*.globalreach.com` → 2031-06-04 | S067 | CA-signed PKI chain |

### 5.4 回滚后验证

```powershell
# 回滚后必须执行的验证步骤
Write-Host "=== 回滚后验证 ===" -ForegroundColor Cyan

# 1. 容器状态
docker compose -f docker-compose.prod.yml ps

# 2. API 健康
$h = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/health"
Write-Host "Health: $($h.status) (score: $($h.score))"

# 3. 关键业务流程
# - 登录是否正常
# - 数据查询是否正常
# - 邮件发送是否正常

# 4. 记录回滚事件
Write-Host "`n📝 请记录本次回滚到部署日志中" -ForegroundColor Yellow
```

---

## 第 6 节：CI/CD 流水线集成

### 6.1 当前流水线状态

```
┌─────────────────────────────────────────────────────────────────┐
│              GlobalReach CI/CD Pipeline 架构                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  trigger: push to main / PR to main / manual dispatch           │
│                                                                 │
│  ┌─────────────┐                                               │
│  │ Job 1:      │  ESLint + TypeScript Check + Security Audit   │
│  │ Quality Gate│  (continue-on-error: true)                     │
│  └──────┬──────┘                                               │
│         │                                                       │
│  ┌──────▼──────┐                                               │
│  │ Job 2:      │  Unit Tests (PostgreSQL + Redis services)      │
│  │ Unit Tests  │  Coverage report upload                        │
│  └──────┬──────┘                                               │
│         │                                                       │
│  ┌──────▼──────────────┐                                       │
│  │ Job 3:              │  Docker Buildx → GHCR Push             │
│  │ Docker Build & Push │  Trivy Vulnerability Scan              │
│  └──────┬──────────────┘                                       │
│         │ (only on push to main)                                │
│  ┌──────▼──────────────┐                                       │
│  │ Job 4:              │  SSH Deploy → PROD_HOST               │
│  │ Deploy (SKIP) ⚠️   │  docker pull → up -d → health check   │
│  └──────┬──────────────┘                                       │
│         │                                                       │
│  ┌──────▼──────────────┐                                       │
│  │ Job 5: Notify       │  Slack notification + Summary          │
│  │ (always runs)       │                                        │
│  └─────────────────────┘                                       │
│                                                                 │
│  Registry: ghcr.io/huaman-lixiang/globalreach-project/api       │
│  Image Tag: <sha>, latest, <branch>, <semver>                   │
└─────────────────────────────────────────────────────────────────┘
```

**流水线详情**:

| Job 名称 | 用途 | 条件 | 平均耗时 |
|----------|------|------|----------|
| Quality Gate | Lint + TypeCheck + Audit | 始终运行 | ~30s |
| Unit Tests | 单元测试 + 覆盖率报告 | 非 skip_tests | ~2min |
| Docker Build | 构建镜像 + 推送 GHCR + Trivy 扫描 | push to main only | ~3min |
| Deploy | SSH 部署到生产服务器 | push to main only | ~2min |
| Notify | Slack 通知 + Summary | always | ~10s |

### 6.2 启用远程部署

当前 Deploy Job 因缺少以下 Secrets 而处于 **SKIP 状态**：

| Secret 名称 | 说明 | 如何获取 |
|-------------|------|----------|
| `PROD_HOST` | 生产服务器 IP 或域名 | 服务器运维提供 |
| `PROD_USER` | SSH 登录用户名 | 通常是 `root` 或 `deploy` |
| `PROD_SSH_KEY` | SSH 私钥 (PEM 格式) | `cat ~/.ssh/id_ed25519` |

**配置步骤**：

```powershell
# 1. 生成 SSH 密钥对（如果没有）
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/globalreach_deploy
# 公钥添加到生产服务器的 authorized_keys

# 2. 在 GitHub 仓库中添加 Secrets
# 进入: Settings → Secrets and variables → Actions → New repository secret
# 分别添加以上 3 个 secret

# 3. 验证配置
# 手动触发 workflow_dispatch 进行测试
```

**SSH Deploy Job 核心逻辑**（来自 `.github/workflows/ci-cd.yml`）：

```yaml
# Deploy Job 执行流程:
# 1. SSH 到 PROD_HOST
# 2. cd 到项目目录
# 3. docker pull 最新镜像 (带 SHA tag)
# 4. 停旧容器 → 启新容器
# 5. 循环等待 /api/v1/health 返回 healthy/degraded
# 6. 验证 HTTPS 端点
```

**Self-hosted Runner 替代方案**（G11 任务）：

```powershell
# 如果无法使用 SSH deploy，可以在生产服务器上运行 self-hosted runner:
# 1. 在 GitHub 仓库 Settings → Actions → Runners → New self-hosted runner
# 2. 下载并配置 runner 在生产服务器上运行
# 3. 修改 ci-cd.yml 中 deploy job 的 runs-on: [self-hosted, linux]
# 4. Runner 可以直接执行 docker 命令，无需 SSH
```

### 6.3 流水线故障排查

| 故障点 | 常见原因 | 解决方案 |
|--------|----------|----------|
| **Quality Gate 失败** | ESLint 报错 / 类型错误 | 本地运行 `npm run lint` 和 `npm run typecheck` 修复 |
| **Unit Tests 失败** | 测试用例失败 / DB 连接超时 | 检查测试日志 artifact；本地 `npm test` 复现 |
| **Docker Build 失败** | Dockerfile 语法错误 / 基础镜像拉取失败 | 本地 `docker build -t test .` 验证；检查 Dockerfile |
| **Trivy Scan 高危漏洞** | 依赖包有已知 CVE | `npm audit fix` 升级依赖；评估风险接受度 |
| **Deploy 失败** | SSH 连接失败 / Secrets 未配置 | 检查 PROD_HOST/PROD_USER/PROD_SSH_KEY 是否正确 |
| **Health Check 超时** | API 启动慢 / DB 未就绪 | 检查 `start_period: 60s` 是否足够；查看容器日志 |

**如何重新运行失败的 Job**：

```powershell
# 方法 1: GitHub UI 操作
# 进入: Actions → 选择失败的 workflow run → 点击 failed job → Re-run jobs

# 方法 2: 手动重新触发
# 使用 workflow_dispatch 手动触发（可勾选 skip_tests 加速）

# 方法 3: 本地复现流水线失败
# 安装 act 工具（模拟 GitHub Actions 本地运行）
# npm install -g act
# act -j unit-tests   # 只运行 unit-tests job
```

**本地复现指南**：

```powershell
# 复现 Quality Gate
cd api
npm ci
npm run lint
npm run typecheck
npm audit --audit-level=moderate

# 复现 Unit Tests（需要本地 Docker 跑 PG + Redis）
docker run -d --name test-pg -e POSTGRES_DB=globalreach_test -e POSTGRES_USER=test_user -e POSTGRES_PASSWORD=test_pass -p 5432:5432 postgres:15-alpine
docker run -d --name test-redis -p 6379:6379 redis:7-alpine
Start-Sleep 10
$env:DATABASE_URL = "postgresql://test_user:test_pass@localhost:5432/globalreach_test"
$env:JWT_SECRET = "test-secret-key-for-ci-purposes-only-32chars!!"
npm test -- --coverage --forceExit --detectOpenHandles

# 清理
docker rm -f test-pg test-redis
```

---

## 第 7 节：环境特定配置

### 7.1 Development 环境 (`.env.dev`)

```env
# ============================================================
# GlobalReach V2.0 — 开发环境配置
# 用途: 本地开发调试，优先便捷性
# ============================================================

NODE_ENV=development
APP_NAME=GlobalReach-V2-Dev
LOG_LEVEL=debug
API_PORT=3000

# Database (本地 SQLite 或 PostgreSQL)
DB_PATH=./data/dev.db
# 或使用 PostgreSQL:
# DB_HOST=localhost
# DB_PORT=5432
# DB_NAME=globalreach_dev
# DB_USER=globalreach_user
# DB_PASSWORD=dev_password

# Redis (本地)
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT (开发用短过期)
JWT_SECRET=dev-secret-key-not-for-production!!
JWT_EXPIRES_IN=1h

CSRF_SECRET=dev-csrf-secret

# CORS (允许所有来源)
CORS_ORIGIN=*

# Rate Limiting (宽松限制或不启用)
RATE_LIMIT_MAX=9999
RATE_LIMIT_WINDOW_MS=60000

# Hot Reload (nodemon/pm2)
WATCH=true
```

**开发环境特征**：

| 特征 | 配置值 | 说明 |
|------|--------|------|
| 日志级别 | `debug` | 输出详细调试信息 |
| 热重载 | 启用 | 代码修改后自动重启 |
| 限流 | 关闭/极宽松 | 不干扰开发调试 |
| 数据库 | SQLite 或本地 PG | 无需 volume 持久化 |
| CORS | `*` | 允许所有前端来源 |
| JWT 过期 | `1h` | 方便频繁测试认证 |

### 7.2 Staging 环境 (`.env.staging`)

```env
# ============================================================
# GlobalReach V2.0 — 预发布环境配置
# 用途: 生产前的最终验证，镜像生产配置
# ============================================================

NODE_ENV=production
APP_NAME=GlobalReach-V2-Staging
LOG_LEVEL=info
API_PORT=3000

# Database (独立 Staging 库)
DB_HOST=postgres
DB_PORT=5432
DB_NAME=globalreach_staging
DB_USER=globalreach_user
DB_PASSWORD=staging_secure_password_2026!

DATABASE_URL=postgresql://globalreach_user:staging_secure_password_2026!@postgres:5432/globalreach_staging?schema=public

# Redis (独立实例或不同 DB)
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=1

# JWT
JWT_SECRET=staging-jwt-secret-min-32-chars-long!!!
JWT_EXPIRES_IN=24h

CSRF_SECRET=staging-csrf-secret

# CORS (预发布域名)
CORS_ORIGIN=https://staging.globalreach.com,https://app-staging.globalreach.com

# Rate Limiting (适度严格)
RATE_LIMIT_MAX=200
RATE_LIMIT_WINDOW_MS=900000

# Grafana
GRAFANA_ADMIN_PASSWORD=staging_grafana_pass

# Email (使用测试模式，不发送真实邮件)
SENDGRID_API_KEY=test_key
SMTP_HOST=mailpit   # 使用 Mailpit 捕获邮件
SMTP_PORT=1025

# Monitoring
ENABLE_METRICS=true
```

**Staging 环境特征**：

| 特征 | 配置值 | 说明 |
|------|--------|------|
| 日志级别 | `info` | 正常生产级日志 |
| 数据库 | 独立 `globalreach_staging` | 与生产完全隔离 |
| 资源限制 | 减半 | API: 256MB, 其他: 64MB |
| 邮件 | Mailpit 捕获 | 不发送真实邮件 |
| 超时 | 延长 | 方便调试慢请求 |
| 测试数据 | 预填充 | 包含各类边界场景数据 |

### 7.3 Production 环境 (`.env.prod`)

```env
# ============================================================
# GlobalReach V2.0 — 生产环境配置
# ⚠️ 所有密码和密钥必须在部署前替换为真实值！
# ============================================================

# ---- 应用基础 ----
NODE_ENV=production
APP_NAME=GlobalReach-V2
APP_VERSION=2.0.0
APP_URL=https://api.globalreach.com

# ---- API Server ----
PORT=3000
HOST=0.0.0.0
API_PORT=3000

# ---- 安全配置（必须修改！）----
JWT_SECRET=<REPLACE_WITH_MIN_32_CHARS_SECURE_RANDOM_STRING>
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d
BCRYPT_SALT_ROUNDS=12
CSRF_SECRET=<REPLACE_WITH_SECURE_CSRF_SECRET>

# ---- 数据库 ----
DB_HOST=postgres
DB_PORT=5432
DB_NAME=globalreach_prod
DB_USER=globalreach_user
DB_PASSWORD=GlobalReach2026!
DB_POOL_MIN=5
DB_POOL_MAX=20
DB_ACQUIRE_TIMEOUT=30000
DB_IDLE_TIMEOUT=10000
DATABASE_URL=postgresql://globalreach_user:GlobalReach2026!@postgres:5432/globalreach_prod?schema=public

# ---- Redis ----
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TTL=3600

# ---- CORS ----
CORS_ORIGIN=https://app.globalreach.com,https://api.globalreach.com

# ---- 限流（严格）----
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_API_KEY_WINDOW_MS=60000
RATE_LIMIT_API_KEY_MAX_REQUESTS=1000

# ---- 日志 ----
LOG_LEVEL=warn
LOG_FORMAT=json

# ---- 文件上传 ----
MAX_FILE_SIZE=10485760
UPLOAD_DIR=/app/uploads

# ---- 邮件服务 ----
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=<REPLACE_WITH_SENDGRID_API_KEY>
EMAIL_FROM=GlobalReach <noreply@globalreach.com>

# ---- 监控 ----
ENABLE_METRICS=true
METRICS_PORT=9090

# ---- SSL/TLS ----
SSL_CERT_PATH=/etc/nginx/ssl/globalreach/globalreach.crt
SSL_KEY_PATH=/etc/nginx/ssl/globalreach/globalreach.key

# ---- 功能开关 ----
ENABLE_REGISTRATION=false
ENABLE_EMAIL_VERIFICATION=true
MAX_ACCOUNTS_PER_USER=50
MAX_CAMPAIGNS_PER_DAY=10

# ---- Grafana ----
GRAFANA_ADMIN_PASSWORD=<REPLACE_WITH_SECURE_GRAFANA_PASSWORD>

# ---- Docker ----
IMAGE_TAG=latest
```

**Production 资源限制**（来自 `docker-compose.prod.yml`）：

| 服务 | 内存限制 (limit) | 内存保留 (reservation) | CPU 限制 |
|------|------------------|------------------------|----------|
| **API** | **512M** | 256M | 1.0 core |
| Nginx | 128M | — | — |
| Node Exporter | 128M | — | — |
| Postgres Exporter | 128M | — | — |
| PostgreSQL | 未设限制 | — | — |
| Redis | 未设限制 | — | — |
| Prometheus | 未设限制 | — | — |
| Grafana | 未设限制 | — | — |

**Production 安全头**（Nginx 配置）：

| Header | 值 | 用途 |
|--------|-----|------|
| Strict-Transport-Security | `max-age=15768000; includeSubDomains; preload` | HSTS (6个月) |
| X-Frame-Options | `SAMEORIGIN` | 防点击劫持 |
| X-Content-Type-Options | `nosniff` | 防 MIME 嗅探 |
| X-XSS-Protection | `1; mode=block` | XSS 过滤 |
| Referrer-Policy | `strict-origin-when-cross-origin` | 引用策略 |
| Content-Security-Policy | `default-src 'self'; ...` | 内容安全策略 |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()` | 权限策略 |

**Production 备份计划**：

| 备份类型 | 频率 | 保留期 | 命令 |
|----------|------|--------|------|
| PostgreSQL Full Dump | 每日 02:00 | 30 天 | `pg_dump` |
| PostgreSQL WAL Archive | 持续 | 7 天 | PostgreSQL 内置 |
| Redis RDB | 每小时 | 3 天 | Redis `SAVE` |
| Nginx Logs | 持续轮转 | 14 天 | Docker log driver |
| SSL Certs | 手动/自动续期 | — | Certbot / 手动 |

```powershell
# 生产环境每日备份定时任务 (Windows Task Scheduler)
# 创建任务: Task Scheduler → Basic Task → Daily → 02:00 AM
# Action: Start Program → powershell.exe
# Arguments: -ExecutionPolicy Bypass -File C:\scripts\globalreach-backup.ps1

# backup script 示例:
<#
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = "C:\backups\globalreach"
if (!(Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force }

# DB Backup
docker exec globalreach-postgres pg_dump -U globalreach_user -d globalreach_prod >
    "$backupDir\pg_$timestamp.sql"

# Clean old backups (> 30 days)
Get-ChildItem "$backupDir\pg_*.sql" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force

Write-Host "Backup completed: $timestamp"
#>
```

---

## 第 8 节：部署安全注意事项

### 8.1 密钥管理

```powershell
# ═══════════════════════════════════════════════════════════════
# 密钥安全管理原则
# ═══════════════════════════════════════════════════════════════

# ✅ 正确做法:
# 1. .env 文件在 .gitignore 中（已配置）
# 2. 敏感信息存储在 GitHub Secrets 中
# 3. 生产密码使用强随机字符串（≥ 32 字符）
# 4. 定期轮换密钥（每 90 天）

# ❌ 禁止事项:
# 1. 将 .env 文件提交到 Git
# 2. 在代码中硬编码密码
# 3. 在日志中输出敏感信息
# 4. 多个环境共享相同密码

# 验证 .gitignore 是否包含 .env
Select-String ".env" .gitignore
```

**密钥轮换检查清单**：

| 密钥 | 位置 | 轮换频率 | 影响范围 |
|------|------|----------|----------|
| `DB_PASSWORD` | .env | 每 90 天 | 需要重启 postgres + api |
| `JWT_SECRET` | .env / GitHub Secrets | 每 90 天 | 所有已签发的 Token 失效 |
| `CSRF_SECRET` | .env | 每 90 天 | 所有活跃 Session 失效 |
| `GRAFANA_ADMIN_PASSWORD` | .env | 每 90 天 | Grafana 管理员登录 |
| `SENDGRID_API_KEY` | .env / GitHub Secrets | 按 SendGrid 建议 | 邮件发送功能 |
| SSH Key (PROD_SSH_KEY) | GitHub Secrets | 每 180 天 | CI/CD 部署能力 |

### 8.2 SSL 证书部署

```powershell
# 当前 SSL 证书状态
# 位置: nginx/ssl/globalreach/
# 证书: *.globalreach.com 通配符证书
# 到期: 2031-06-04
# 类型: CA-signed PKI chain

# 证书文件清单:
Get-ChildItem "nginx\ssl\globalreach\" -Recurse | Select-Object Name, Length
```

**证书更新流程**：

```powershell
# 1. 获取新证书（从 CA 或 Let's Encrypt）
# 2. 替换证书文件
Copy-Item "new-cert.crt" "nginx/ssl/globalreach/globalreach.crt" -Force
Copy-Item "new-key.key" "nginx/ssl/globalreach/globalreach.key" -Force

# 3. 测试 Nginx 配置
docker exec globalreach-nginx-prod nginx -t

# 4. 热重载 Nginx（不断开现有连接）
docker exec globalreach-nginx-prod nginx -s reload

# 5. 验证 HTTPS
curl.exe -skI https://localhost/api/v1/health | Select-String "HTTP/ SSL expire"
```

### 8.3 初始管理员密码

```powershell
# ⚠️ 首次部署后必须立即执行！

# 1. 使用默认密码登录
# 2. 进入个人设置页面
# 3. 修改为符合要求的强密码:
#    - 最少 12 个字符
#    - 包含大小写字母 + 数字 + 特殊字符
#    - 不与任何其他系统密码重复

# 4. 如果忘记修改，可以通过 API 重置:
# docker exec -it globalreach-api-prod sh
# 然后在容器内执行密码重置命令（具体取决于应用实现）
```

### 8.4 防火墙规则

```powershell
# ═══════════════════════════════════════════════════════════════
# 生产服务器防火墙规则参考 (Windows Firewall / iptables)
# ═══════════════════════════════════════════════════════════════

# 入站规则 (Inbound):
#   Port 22/tcp   → SSH (限制 IP 白名单)
#   Port 80/tcp   → HTTP (全开放)
#   Port 443/tcp  → HTTPS (全开放)
#   其余端口      → DENY（Docker 内部通信不需要暴露）

# 出站规则 (Outbound):
#   允许所有出站（用于拉取镜像、发送邮件等）

# Windows Firewall PowerShell 示例:
# New-NetFirewallRule -DisplayName "GlobalReach-HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
# New-NetFirewallRule -DisplayName "GlobalReach-HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

### 8.5 网络分段（Docker Networks）

```
┌────────────────────────────────────────────────────┐
│                Host Network                         │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │  globalreach-project_globalreach-network     │  │
│  │  (Bridge Network — 隔离的内部网络)            │  │
│  │                                              │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────────┐  │  │
│  │  │postgres │  │  redis  │  │     api     │  │  │
│  │  │ :5432   │  │  :6379  │  │    :3000    │  │  │
│  │  └─────────┘  └─────────┘  └──────┬──────┘  │  │
│  │                                     │         │  │
│  │  ┌─────────┐  ┌─────────┐  ┌──────▼──────┐  │  │
│  │  │prometheus│  │ grafana │  │   nginx    │  │  │
│  │  │ :9090   │  │ :3002   │  │  :80 :443   │  │  │
│  │  └─────────┘  └─────────┘  └─────────────┘  │  │
│  │                                              │  │
│  │  ┌─────────────┐  ┌──────────────────┐      │  │
│  │  │node-exporter│  │postgres-exporter  │      │  │
│  │  │   :9100     │  │     :9187        │      │  │
│  │  └─────────────┘  └──────────────────┘      │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  只有 nginx 和 prometheus/grafana 的端口映射到 Host │
│  postgres, redis, exporters 仅在内部网络可访问       │
└────────────────────────────────────────────────────┘
```

**安全要点**：
- PostgreSQL (5432) 和 Redis (6379) **不映射到宿主机端口**
- Node Exporter (9100) 和 Postgres Exporter (9187) **不映射到宿主机端口**
- 所有内部服务间通信走 Docker bridge 网络
- 外部只能通过 Nginx (80/443)、Prometheus (9090)、Grafana (3002) 访问

### 8.6 部署后安全扫描

```powershell
# ═══════════════════════════════════════════════════════════════
# 每次部署后建议执行的安全检查
# ═══════════════════════════════════════════════════════════════

# 1. 检查是否有意外暴露的端口
Write-Host "--- 端口暴露检查 ---"
docker compose -f docker-compose.prod.yml ps --format "table {{.Name}}\t{{.Ports}}" |
    Where-Object { $_ -match "0\.0\.0\.0" }

# 2. 检查容器是否以 root 运行（应使用非 root 用户）
Write-Host "--- 容器用户检查 ---"
foreach ($c in @("globalreach-api-prod", "globalreach-nginx-prod")) {
    $user = docker exec $c whoami 2>$null
    Write-Host "  $c → $user"
}

# 3. 检查 TLS 配置强度
Write-Host "--- TLS 配置检查 ---"
try {
    $tls = curl.exe -skI https://localhost/api/v1/health 2>$null | Select-String "SSL|TLS|HTTP/"
    $tls
} catch { Write-Host "  TLS 检查跳过" }

# 4. 检查安全响应头
Write-Host "--- 安全响应头检查 ---"
$headers = Invoke-WebRequest -Uri "https://localhost/api/v1/health" -SkipCertificateCheck -UseBasicParsing
$securityHeaders = @("X-Frame-Options", "X-Content-Type-Options", "Strict-Transport-Security",
                      "X-XSS-Protection", "Content-Security-Policy", "Referrer-Policy")
foreach ($h in $securityHeaders) {
    $val = $headers.Headers[$h]
    if ($val) { Write-Host "  ✅ $h : $val" }
    else { Write-Host "  ❌ $h : 缺失!" }
}
```

---

## 第 9 节：部署验证

### 9.1 自动化冒烟测试 (Smoke Tests)

> **每次部署后必须执行**，确保核心功能正常。

```powershell
# ═══════════════════════════════════════════════════════════════
# GlobalReach V2.0 — 部署冒烟测试脚本
# 用途: 每次部署后快速验证系统核心功能
# 通过标准: 5/5 项检查全部通过
# ═══════════════════════════════════════════════════════════════

function Test-SmokeEndpoint {
    param(
        [string]$Name,
        [string]$Url,
        [int]$ExpectedStatus = 200,
        [int]$TimeoutSec = 10
    )
    try {
        $resp = Invoke-WebRequest -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing
        if ($resp.StatusCode -eq $ExpectedStatus) {
            Write-Host "  ✅ $Name — HTTP $($resp.StatusCode)" -ForegroundColor Green
            return $true
        } else {
            Write-Host "  ❌ $Name — 期望 $ExpectedStatus, 实际 $($resp.StatusCode)" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "  ❌ $Name — $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

Write-Host "`n========== GlobalReach 冒烟测试 ========== " -ForegroundColor Cyan
Write-Host "时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n" -ForegroundColor Gray

$passed = 0
$total = 5

# --- Test 1: API Health Endpoint ---
Write-Host "[1/5] API Health Endpoint" -ForegroundColor Yellow
try {
    $h = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/health" -TimeoutSec 10
    if ($h.status -match "healthy|degraded" -and $h.score -ge 75) {
        Write-Host "  ✅ Health — status=$($h.status), score=$($h.score)" -ForegroundColor Green; $passed++
    } else {
        Write-Host "  ❌ Health — status=$($h.status), score=$($h.score) (需 ≥75)" -ForegroundColor Red
    }
} catch { Write-Host "  ❌ Health — $($_.Exception.Message)" -ForegroundColor Red }

# --- Test 2: Auth Flow Smoke Test ---
Write-Host "[2/5] Auth Flow (Login endpoint reachable)" -ForegroundColor Yellow
try {
    $body = '{"email":"smoke@test.com","password":"smoketest123"}'
    $r = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/auth/login" `
        -Method Post -ContentType "application/json" -Body $body -TimeoutSec 10 -UseBasicParsing
    # 401/400 表示端点可达（只是凭据无效），这是预期行为
    if ($r.StatusCode -in @(200, 400, 401, 404)) {
        Write-Host "  ✅ Auth — 端点可达 (HTTP $($r.StatusCode))" -ForegroundColor Green; $passed++
    }
} catch { Write-Host "  ❌ Auth — $($_.Exception.Message)" -ForegroundColor Red }

# --- Test 3: Database Connectivity ---
Write-Host "[3/5] Database Connectivity" -ForegroundColor Yellow
$dbCheck = docker exec globalreach-postgres pg_isready -U globalreach_user -d globalreach_prod 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✅ Database — PostgreSQL ready" -ForegroundColor Green; $passed++
} else {
    Write-Host "  ❌ Database — PostgreSQL not ready (exit code: $LASTEXITCODE)" -ForegroundColor Red
}

# --- Test 4: Redis Connectivity ---
Write-Host "[4/5] Redis Connectivity" -ForegroundColor Yellow
$redisCheck = docker exec globalreach-redis redis-cli ping 2>$null
if ($redisCheck -eq "PONG") {
    Write-Host "  ✅ Redis — PONG" -ForegroundColor Green; $passed++
} else {
    Write-Host "  ❌ Redis — response: $redisCheck" -ForegroundColor Red
}

# --- Test 5: Metrics Endpoint ---
Write-Host "[5/5] Metrics Endpoint" -ForegroundColor Yellow
if (Test-SmokeEndpoint -Name "Metrics" -Url "http://localhost:3000/api/v1/metrics") {
    $passed++
}

# --- 结果汇总 ---
Write-Host "`n========== 冒烟测试结果: $passed / $total ==========" -ForegroundColor Cyan
if ($passed -eq $total) {
    Write-Host "🎉 全部通过! 部署验证成功." -ForegroundColor Green
    exit 0
} else {
    Write-Host "⚠️ $passed / $total 通过。请检查上述失败项." -ForegroundColor Yellow
    exit 1
}
```

### 9.2 完整 UAT 触发（重大版本）

> **参考**: G07 UAT 框架（20 个测试用例）
> **触发条件**: 大版本发布、数据库结构变更、核心模块重构

**UAT 通过标准**：

| 标准 | 阈值 | 说明 |
|------|------|------|
| 总体通过率 | **≥ 95%** (≥ 19/20) | 低于此值不允许上线 |
| P0 失败数 | **0** | P0 为阻塞级缺陷 |
| BLOCKED 数 | **0** | 不能有用例被阻塞无法执行 |
| 当前基准 | **17/20 (85%)** | 需改进至 ≥ 95% |

**当前 UAT 状态** (S083):

```
UAT Report: UAT_REPORT_S083_G07.md
总用例数: 20
通过: 17
失败: 2
阻塞: 0
P0 缺陷: 0
通过率: 85%
结论: ⚠️ 未达到 95% 上线标准，需修复剩余 3 个用例后重新测试
```

**UAT 执行命令**：

```powershell
# 运行完整 UAT 测试套件
cd api
npm run test:uat
# 或
npm test -- --grep "UAT" --reporter spec

# 生成 UAT 报告
npm run test:uat -- --reporter=json > ../docs/uat-results.json
```

### 9.3 性能基线对比

```powershell
# ═══════════════════════════════════════════════════════════════
# 性能回归检测 — 部署前后对比
# ═══════════════════════════════════════════════════════════════

Write-Host "=== 性能基线对比 ===" -ForegroundColor Cyan

# --- 1. 内存使用量检测 ---
Write-Host "`n[内存使用]" -ForegroundColor Yellow
$apiStats = docker stats globalreach-api-prod --no-stream --format "{{.MemUsage}}"
Write-Host "  API 容器内存: $apiStats"
# 基准: API 正常运行时应 < 384MB (NODE_OPTIONS limit)
# 警告阈值: > 350MB (接近上限)
# 回归阈值: > 400MB (超过限制，说明内存泄漏)

# --- 2. 响应时间检测 ---
Write-Host "`n[响应时间]" -ForegroundColor Yellow
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try { Invoke-RestMethod -Uri "http://localhost:3000/api/v1/health" -TimeoutSec 10 | Out-Null } catch {}
$sw.Stop()
$ms = $sw.ElapsedMilliseconds
Write-Host "  Health 端点响应: ${ms}ms"
# 基准: < 200ms
# 警告: > 500ms
# 回归: > 2000ms

# --- 3. Prometheus 指标查询 ---
Write-Host "`n[Prometheus 指标]" -ForegroundColor Yellow
try {
    # P95 延迟
    $p95 = Invoke-RestMethod -Uri "http://localhost:9090/api/v1/query?query=histogram_quantile(0.95,rate(http_request_duration_seconds_bucket[5m]))"
    $p95Val = $p95.data.result[0].value[1]
    Write-Host "  P95 Latency: $([math]::Round([double]$p95Val, 2))s"

    # 错误率
    $errorRate = Invoke-RestMethod -Uri "http://localhost:9090/api/v1/query?query=rate(http_requests_total{status=~'5..'}[5m])/rate(http_requests_total[5m])"
    $errVal = $errorRate.data.result[0].value[1]
    Write-Host "  Error Rate: $([math]::Round([double]$errVal * 100, 2))%"
} catch {
    Write-Host "  ℹ️ Prometheus 指标暂不可用（可能刚启动）" -ForegroundColor Gray
}

# --- 4. 容器资源趋势 ---
Write-Host "`n[资源趋势]" -ForegroundColor Yellow
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}" |
    Select-String "globalreach"
```

**性能回归判断标准**：

| 指标 | 基准值 | 警告阈值 | 回归阈值 | 操作 |
|------|--------|----------|----------|------|
| API 内存 | < 256MB | > 300MB | > 450MB | 检查内存泄漏 |
| Health 响应时间 | < 100ms | > 300ms | > 2000ms | 检查性能瓶颈 |
| P95 延迟 | < 500ms | > 1500ms | > 5000ms | 检查慢查询 |
| 错误率 | < 1% | > 5% | > 10% | 立即排查 |
| CPU 使用率 | < 30% | > 60% | > 90% | 检查死循环/密集计算 |

---

## 第 10 节：部署运行记录模板

> 每次正式部署都必须填写此记录，存档于 `docs/deploy-logs/` 目录。

```markdown
<!-- 
  使用说明: 复制以下模板，填入每次部署的实际信息。
  文件命名格式: deploy-log-YYYYMMDD-HHMMSS-operator.md
-->

# GlobalReach V2.0 部署运行记录

## 基本信息

| 项目 | 内容 |
|------|------|
| **部署日期** | YYYY-MM-DD |
| **部署时间** | HH:MM - HH:MM (UTC+8) |
| **操作人员** | [姓名/ID] |
| **部署类型** | [ ] 首次部署  [ ] 常规更新  [ ] 紧急修复  [ ] 回滚  [ ] 扩容 |
| **目标环境** | [ ] Development  [ ] Staging  [ ] Production |

## 版本信息

| 项目 | 内容 |
|------|------|
| **部署前 Commit SHA** | `___________` |
| **部署后 Commit SHA** | `___________` |
| **Git 分支** | `main` / `____________` |
| **镜像 Tag** | `____________` |
| **镜像 Digest** | `____________` |
| **Docker Compose 版本** | `docker-compose.prod.yml @ _____________` |
| **关联 Issue/PR** | #__ / PR #__ |

## Pre-Deployment Checklist（部署前检查）

| # | 检查项 | 状态 | 签字/备注 |
|---|--------|------|-----------|
| 1 | 代码已通过 Quality Gate (Lint/TypeCheck/Audit) | [ ] 通过 | |
| 2 | 单元测试通过（覆盖率 ≥ 阈值） | [ ] 通过 | |
| 3 | Docker 镜像构建成功 | [ ] 通过 | |
| 4 | Trivy 安全扫描无 CRITICAL/HIGH 漏洞（或有豁免） | [ ] 通过 | |
| 5 | 数据库备份已完成 | [ ] 通过 | 备份文件: ______ |
| 6 | .env 配置已审查（无硬编码密钥） | [ ] 通过 | |
| 7 | Rollback 方案已确认（回滚点已知） | [ ] 通过 | 回滚到: ______ |
| 8 | 相关团队已通知（Stakeholder） | [ ] 通过 | 通知方式: ______ |
| 9 | 维护窗口已确认（如需停机） | [ ] 通过 | 窗口: ______ |
| 10 | 冒烟测试脚本准备就绪 | [ ] 通过 | |

**Pre-Deploy 签字**: ________________ 日期: ____________

## 部署执行步骤

| Step | 操作 | 命令 | 执行时间 | 结果 |
|------|------|------|----------|------|
| 1 | 拉取最新代码 | `git pull origin main` | HH:MM:SS | ✅/❌ |
| 2 | 备份当前镜像 | `docker tag ... rollback-...` | HH:MM:SS | ✅/❌ |
| 3 | 备份数据库 | `pg_dump ... > backup.sql` | HH:MM:SS | ✅/❌ |
| 4 | 重建 API 镜像 | `docker compose build ...` | HH:MM:SS | ✅/❌ |
| 5 | 滚动重启 API | `docker compose up -d ...` | HH:MM:SS | ✅/❌ |
| 6 | 等待健康检查 | (等待 ~30s) | HH:MM:SS | ✅/❌ |
| 7 | 验证关键端点 | smoke tests | HH:MM:SS | ✅/❌ |
| 8 | Nginx 热重载 | `nginx -s reload` | HH:MM:SS | ✅/❌ |

**部署开始时间**: ______  **部署完成时间**: ______  **总耗时**: ______

## Post-Deployment Verification（部署后验证）

| # | 验证项 | 预期结果 | 实际结果 | 状态 |
|---|--------|----------|----------|------|
| 1 | 8 个容器全部运行 | 8/8 UP | ___/8 | [ ] |
| 2 | API Health Score | ≥ 75 | score=___ | [ ] |
| 3 | API Status | healthy/degraded | status=___ | [ ] |
| 4 | Auth Login 端点 | HTTP 200/401/400 | HTTP=___ | [ ] |
| 5 | DB 连接 | pg_isready OK | ___ | [ ] |
| 6 | Redis 连接 | PONG | ___ | [ ] |
| 7 | Metrics 端点 | HTTP 200 | HTTP=___ | [ ] |
| 8 | Prometheus Targets | 4/4 UP | ___/4 | [ ] |
| 9 | Grafana 可访问 | HTTP 200 | HTTP=___ | [ ] |
| 10 | Nginx HTTPS | HTTP 200 | HTTP=___ | [ ] |
| 11 | 冒烟测试总分 | 5/5 | ___/5 | [ ] |
| 12 | 内存使用 | < 450MB | ___MB | [ ] |
| 13 | P95 响应时间 | < 2000ms | ___ms | [ ] |

**Post-Deploy 签字**: ________________ 日期: ____________

## 问题记录

| # | 问题描述 | 严重程度 | 影响 | 解决措施 | 状态 |
|---|----------|----------|------|----------|------|
| 1 | | Low/Med/High/Crit | | | Open/Closed |
| 2 | | | | | |
| 3 | | | | | |

## 回滚决策

| 项目 | 内容 |
|------|------|
| **是否执行回滚** | [ ] 否（正常完成）  [ ] 是（见下方） |
| **回滚原因** | _________________________________________________ |
| **回滚方式** | [ ] docker restart  [ ] git revert  [ ] 镜像回滚  [ ] DB 恢复 |
| **回滚目标** | Commit: `___________` / Image: `___________` |
| **回滚执行时间** | ______ |
| **回滚后验证** | [ ] 通过  [ ] 失败 |
| **Root Cause 分析** | _________________________________________________ |

## 最终签字

| 角色 | 姓名 | 签字 | 日期 |
|------|------|------|------|
| **执行人** | | | |
| **审核人** | | | |
| **批准人** | | | |

## 备注

_____________________________________________________________________________
_____________________________________________________________________________
_____________________________________________________________________________

---
*文档版本: DEPLOYMENT_PLAYBOOK v1.0.0*
*基于 GlobalReach V2.0 项目实际配置生成*
*最后更新: 2026-06-05*
