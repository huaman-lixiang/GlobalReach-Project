# GlobalReach V2.0 — 运维操作手册 (Operations Manual)

> **版本**: 2.0.0 | **最后更新**: 2026-06-05 | **适用环境**: Production (Docker Compose)
>
> 本手册面向运维工程师和系统管理员，提供 GlobalReach V2.0 企业邮件营销平台的完整运维指南。

---

## 目录

- [第1章：系统架构总览](#第1章系统架构总览)
- [第2章：服务启停操作](#第2章服务启停操作)
- [第3章：日常巡检清单](#第3章日常巡检清单)
- [第4章：备份与恢复操作](#第4章备份与恢复操作)
- [第5章：日志查看与分析](#第5章日志查看与分析)
- [第6章：监控面板解读](#第6章监控面板解读)
- [第7章：告警处理 SOP](#第7章告警处理-sop)
- [第8章：用户账号管理](#第8章用户账号管理)
- [第9章：性能调优参考](#第9章性能调优参考)
- [第10章：紧急联系人及升级路径](#第10章紧急联系人及升级路径)

---

## 第1章：系统架构总览

### 1.1 架构拓扑图

```
┌─────────────────────────────────────────────────────────────────────┐
│                           用户浏览器                                 │
│                    (HTTP/HTTPS :80/:443)                            │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         Nginx 反向代理                               │
│              (globalreach-nginx-prod)  端口: 80 / 443               │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  • SSL/TLS 终端                                              │   │
│   │  • 静态资源服务 (frontend-dist)                              │   │
│   │  • API 反向代理 → api:3000                                   │   │
│   │  • 速率限制                                                  │   │
│   └─────────────────────────────────────────────────────────────┘   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     API 服务网关 (Node.js)                          │
│            (globalreach-api-prod)  端口: 3000                        │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  Express + Sequelize ORM                                    │   │
│   │  V8 Heap: 256MB | Periodic GC: 60s                         │   │
│   │  bcrypt saltRounds: 10                                      │   │
│   │  DB Pool: max=10, min=2                                     │   │
│   └────────────────────────┬────────────────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐    ┌─────────────────────────────────┐
│     PostgreSQL 15       │    │         Redis 7                 │
│ (globalreach-postgres)  │    │   (globalreach-redis)           │
│      端口: 5432          │    │       端口: 6379                │
│                         │    │                                 │
│  • 主数据存储             │    │  • 会话缓存                     │
│  • 用户/客户/活动数据     │    │  • 邮件队列状态                 │
│  • 审计日志 / 错误日志    │    │  • 速率限制计数器               │
└─────────────────────────┘    └─────────────────────────────────┘

═════════════════════════════════════════════════════════════════════
                      监控层 (Monitoring Layer)
═════════════════════════════════════════════════════════════════════

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│    Prometheus    │  │     Grafana      │  │   node-exporter     │
│ 端口: 9090       │◄─┤ 端口: 3002(映射)  │  │  主机指标采集        │
│ 指标采集 + 告警   │  │ 可视化仪表盘      │  │  CPU/Mem/Disk/Net   │
└──────────────────┘  └──────────────────┘  └──────────────────────┘
                                                     │
                                          ┌──────────────────────┐
                                          │ postgres-exporter    │
                                          │ PG 指标采集          │
                                          │ 连接数/查询性能等     │
                                          └──────────────────────┘
```

### 1.2 八大容器角色说明

| 序号 | 容器名称 | 镜像 | 对外端口 | 角色 | 资源限制 |
|:---:|---------|------|:-------:|------|----------|
| 1 | `globalreach-api-prod` | globalreach-project-api:latest | **3000** | 核心 API 网关，处理所有业务逻辑 | 内存 512MB / CPU 1.0 |
| 2 | `globalreach-postgres` | postgres:15-alpine | 5432 (内部) | 关系型数据库主存储 | 默认 |
| 3 | `globalreach-redis` | redis:7-alpine | 6379 (内部) | 缓存、会话、队列状态 | 默认 |
| 4 | `globalreach-nginx-prod` | nginx:alpine | **80 / 443** | 反向代理 + SSL 终端 + 静态文件 | 默认 |
| 5 | `globalreach-prometheus` | prom/prometheus:latest | **9090** | 时序指标采集 + 告警规则引擎 | 默认 |
| 6 | `globalreach-grafana` | grafana/grafana:latest | **3002** (→3000) | 监控可视化仪表盘 (6个面板) | 默认 |
| 7 | `globalreach-node-exporter` | prom/node-exporter:latest | 9100 (内部) | 主机级系统指标采集 | 内存 128MB |
| 8 | `globalreach-pg-exporter` | postgres-exporter:latest | 9187 (内部) | PostgreSQL 数据库指标采集 | 内存 128MB |

### 1.3 技术栈总览

| 层级 | 技术 | 版本 | 说明 |
|------|------|:----:|------|
| 运行时 | Node.js | 20 LTS (Alpine) | V8 引擎, --max-old-space-size=256 |
| Web 框架 | Express | ^4.18.2 | RESTful API 网关 |
| ORM | Sequelize | ^6.37.8 | PostgreSQL 数据访问层 |
| 数据库 | PostgreSQL | 15 Alpine | 主数据持久化存储 |
| 缓存 | Redis | 7 Alpine | 会话/缓存/限流 |
| 反向代理 | Nginx | Alpine 最新 | SSL + 负载均衡 |
| 监控采集 | Prometheus | latest | 15s 采样间隔 |
| 可视化 | Grafana | latest | 6 个预置 Dashboard |
| 认证 | JWT + bcryptjs | - | Access Token (24h) + Refresh Token Rotation |
| 日志 | Morgan + 自定义中间件 | - | 结构化 JSON 日志, requestId 追踪 |

### 1.4 核心数据模型

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `users` | 用户账户 | id(UUID), email, role(ADMIN/USER/VIEWER), **isActive**, is_email_verified |
| `email_accounts` | 邮箱账户池 | platform(GMAIL/OUTLOOK/QQ/...), status, health_score, daily_limit |
| `clients` | 客户资料 | status(PROSPECT→CUSTOMER), tags, custom_fields |
| `campaigns` | 营销活动 | type, status(DRAFT→COMPLETED), stats(JSON) |
| `emails` | 邮件记录 | status(PENDING→BOUNCED), provider_message_id |
| `refresh_tokens` | 刷新令牌 | token_hash, expires_at, revoked_at |
| `audit_logs` | 操作审计 | action, resource_type, ip_address |
| `error_logs` | 错误日志 | error_type, stack_trace, request_url |
| `feedbacks` | 用户反馈 | type(bug/feature/improvement), rating |
| `maintenance_logs` | 维护记录 | event_type, message, details |

### 1.5 网络 & 存储卷

```
网络: globalreach-network (外部网络)

卷 (Docker Named Volumes):
  ├── postgres_data     → PostgreSQL 数据持久化 (/var/lib/postgresql/data)
  ├── redis_data        → Redis RDB 持久化 (/data)
  ├── nginx_logs        → Nginx 访问/错误日志
  ├── prometheus_data   → Prometheus TSDB 时间序列数据
  └── grafana_data      → Grafana 仪表盘/用户配置
```

---

## 第2章：服务启停操作

### 2.1 全量启动

```powershell
# 进入项目根目录
cd C:\Users\Administrator\Documents\trae_projects\GlobalReach-Project

# 生产环境全量启动（后台运行）
docker compose -f docker-compose.prod.yml up -d
```

**启动顺序** (由 depends_on 自动管理):
```
postgres → redis → api → nginx → prometheus → grafana
                                                    ↓
                                             node-exporter (并行)
                                             postgres-exporter (并行)
```

### 2.2 全量停止

```powershell
# 停止并移除所有容器（保留数据卷）
docker compose -f docker-compose.prod.yml down

# 停止并移除所有容器 + 数据卷 ⚠️ 会丢失数据！
docker compose -f docker-compose.prod.yml down -v
```

### 2.3 单服务重启

```powershell
# 重启 API 服务（最常用）
docker compose -f docker-compose.prod.yml restart api

# 重启 Nginx（修改配置后）
docker compose -f docker-compose.prod.yml restart nginx

# 重启 PostgreSQL（需谨慎，会断开所有连接）
docker compose -f docker-compose.prod.yml restart postgres

# 重启 Redis
docker compose -f docker-compose.prod.yml restart redis

# 重启监控组件
docker compose -f docker-compose.prod.yml restart prometheus grafana
```

**重建单个服务** (代码更新后):

```powershell
# 重建 API 镜像并重启
docker compose -f docker-compose.prod.yml up -d --build api

# 仅重建不重启
docker compose -f docker-compose.prod.yml build api
```

### 2.4 优雅关闭流程

在执行维护性停机前，按以下顺序操作：

```
步骤 1: 通知用户（如有维护公告机制）
    ↓
步骤 2: 查看 API 健康状态
    curl http://localhost:3000/api/v1/health
    ↓
步骤 3: 等待进行中的邮件发送任务完成
    # 检查 email_queue 状态（通过 health endpoint 的 queue check）
    ↓
步骤 4: 停止接受新请求（Nginx 返回 503）
    # 或直接 down，Nginx 先断开上游连接
    ↓
步骤 5: 执行停止命令
    docker compose -f docker-compose.prod.yml down
    ↓
步骤 6: 验证所有容器已停止
    docker ps -a --filter "name=globalreach"
```

### 2.5 启动后健康检查验证

```powershell
# 方式一：使用项目自带脚本
pwsh -File scripts/health-check.ps1

# 方式二：手动检查各端点
# API 健康检查（深度检查 5 个子系统）
curl http://localhost:3000/api/v1/health | ConvertFrom-Json | ConvertTo-Json -Depth 5

# API 就绪探针（仅检查 DB）
curl http://localhost:3000/api/v1/health/ready

# API 存活探针（仅检查进程）
curl http://localhost:3000/api/v1/health/live

# Nginx 可达性
curl http://localhost:80/health

# Prometheus 目标状态
curl http://localhost:9090/api/v1/targets

# 所有容器状态一览
docker ps --filter "name=globalreach" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

**预期健康响应示例**:

```json
{
  "status": "healthy",
  "service": "GlobalReach V2.0 Enterprise API",
  "version": "2.0.0",
  "healthScore": { "score": 100, "status": "healthy" },
  "checks": {
    "database":    { "status": "healthy", "latencyMs": 12 },
    "redis":       { "status": "healthy", "latencyMs": 3 },
    "engine":      { "status": "healthy" },
    "email_queue": { "status": "healthy" },
    "system_resources": {
      "status": "healthy",
      "details": {
        "memory": { "heapUsed": "64 MB", "heapTotal": "256 MB", "heapUsagePercent": 25 }
      }
    }
  }
}
```

> **注意**: 当 `system_resources.heapUsagePercent > 90%` 时，整体状态将降级为 `"degraded"`。

---

## 第3章：日常巡检清单

### 3.1 每日晨间巡检 (Daily Morning Checklist)

| # | 检查项 | 命令 | 正常标准 | 异常处理 |
|:-:|--------|------|----------|----------|
| 1 | **容器运行状态** | `docker ps -f name=globalreach --format "{{.Names}}: {{.Status}}"` | 8 个容器全部 `Up` | 查看异常容器日志 |
| 2 | **API 健康端点** | `curl -s http://localhost:3000/api/v1/health` | `status: "healthy"`, score ≥ 75 | 见第7章告警SOP |
| 3 | **磁盘空间** | `Get-PSDrive C \| Select-Object Used, Free, @{N='Pct';E={[math]::Round($_.Used/($_.Used+$_.Free)*100)}}` | 使用率 < 80% | 清理旧备份/日志 |
| 4 | **内存占用** | `docker stats --no-stream --format "table {{.Name}}\t{{.CPerc}}\t{{.MemUsage}}"` | API < 512MB 总量 | 见第9章调优 |
| 5 | **错误日志增量** | `docker logs --since 24h globalreach-api-prod 2>&1 \| Select-String "ERROR"` | 无持续 ERROR | 排查具体报错 |
| 6 | **Nginx 访问正常** | `curl -s -o /dev/null -w "%{http_code}" http://localhost:80/` | 返回 200 或 302 | 检查 nginx 配置 |

**一键每日巡检脚本**:

```powershell
# 快速日常检查（复制到 PowerShell 执行）
Write-Host "=== GlobalReach V2.0 每日巡检 ===" -ForegroundColor Cyan
$containers = docker ps -f name=globalreach --format "{{.Names}}: {{.Status}}"
$up = ($containers -split "`n").Where({ $_ -match "Up" }).Count
Write-Host "[容器] $up/8 运行中" $(if($up -eq 8){"✅"}else{"⚠️"})
try {
    $h = Invoke-RestMethod http://localhost:3000/api/v1/health -TimeoutSec 5
    Write-Host "[健康] $($h.status) (得分: $($h.healthScore.score)%)" $(if($h.status -eq 'healthy'){"✅"}else{"⚠️"})
} catch { Write-Host "[健康] ❌ 无法连接" }
$disk = Get-PSDrive C; $pct = [math]::Round($disk.Used/($disk.Used+$disk.Free)*100)
Write-Host "[磁盘] C盘使用 ${pct}%" $(if($pct -lt 80){"✅"}else{"⚠️"})
```

### 3.2 每周巡检 (Weekly Checklist)

| # | 检查项 | 操作 | 说明 |
|:-:|--------|------|------|
| 1 | **备份完整性验证** | 检查 `backups/` 目录最近 7 天的备份文件 | 应有 pg_*.sql 和 redis_*.rdb |
| 2 | **日志轮转检查** | `docker inspect globalreach-api-prod --format '{{.LogConfig}}'` | 确认 max-size:10m, max-file:3 |
| 3 | **SSL 证书有效期** | `echo | openssl s_client -connect localhost:443 2>/dev/null | openssl x509 -noout -dates` | 距过期 > 30 天 |
| 4 | **Docker 镜像清理** | `docker image prune -f` | 清除悬空镜像释放空间 |
| 5 | **Prometheus 告警回顾** | 访问 Grafana Alerts 页面 | 检查一周内触发的告警 |
| 6 | **Redis 内存趋势** | Grafana → Infrastructure Dashboard → Redis Panel | 确认无异常增长 |

### 3.3 每月巡检 (Monthly Checklist)

| # | 检查项 | 操作 |
|:-:|--------|------|
| 1 | **安全审计** | 检查 `.env` 文件中密钥是否为默认值；审查 AuditLog 表异常操作 |
| 2 | **依赖更新审查** | `cd api && npm outdated` → 评估安全补丁版本 |
| 3 | **容量规划** | 回顾 Prometheus 30天趋势：用户增长、DB大小增长、API QPS |
| 4 | **备份恢复演练** | 在测试环境执行一次 PG 恢复操作（见第4章） |
| 5 | **Runbook 更新** | 对照本月事件更新本手册相关章节 |

---

## 第4章：备份与恢复操作

### 4.1 自动备份脚本

备份脚本位置: `scripts/s079-backup.ps1`

```powershell
# 手动执行完整备份
pwsh -File scripts\s079-backup.ps1
```

**脚本自动完成以下 4 项备份**:

| 步骤 | 备份内容 | 输出文件 | 说明 |
|:----:|----------|----------|------|
| 1/4 | PostgreSQL 数据库 | `backups/pg_globalreach_{时间戳}.sql` | `pg_dump` 全量 SQL 导出 |
| 2/4 | Redis 数据 | `backups/redis_dump_{时间戳}.rdb` | `docker cp` 复制 RDB 文件 |
| 3/4 | 配置文件 | `backups/config_{时间戳}.zip` | docker-compose.yml + .env + nginx + api config |
| 4/4 | Git 状态快照 | `backups/git_log_{时间戳}.txt` | 最近 10 条 commit + git status |

**保留策略**: 自动清理 7 天前的备份文件。

### 4.2 手动备份命令

#### PostgreSQL 手动备份

```powershell
# 全量 SQL 备份（推荐用于跨版本迁移）
docker exec globalreach-postgres pg_dump -U globalreach_user globalreach_prod > backups\pg_manual_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql

# 仅结构备份（不含数据）
docker exec globalreach-postgres pg_dump -U globalreach_user globalreach_prod --schema-only > backups\pg_schema_$(Get-Date -Format 'yyyyMMdd').sql

# 仅数据备份（不含建表语句）
docker exec globalreach-postgres pg_dump -U globalreach_user globalreach_prod --data-only > backups\pg_data_$(Get-Date -Format 'yyyyMMdd').sql
```

#### Redis 手动备份

```powershell
# 触发 Redis SAVE 并复制 RDB 文件
docker exec globalreach-redis redis-cli SAVE
Start-Sleep -Seconds 2
docker cp globalreach-redis:/data/dump.rdb backups\redis_manual_$(Get-Date -Format 'yyyyMMdd_HHmmss').rdb

# 检查 Redis 当前数据库大小
docker exec globalreach-redis redis-cli DBSIZE
docker exec globalreach-redis redis-cli INFO memory
```

### 4.3 恢复操作

#### PostgreSQL 恢复

```powershell
# ⚠️ 恢复操作会覆盖现有数据，请先确认！

# 步骤 1: 停止 API 服务（避免写入冲突）
docker compose -f docker-compose.prod.yml stop api

# 步骤 2: 恢复数据库（从 SQL 文件）
$type backupFile = "backups\pg_globalreach_20260605_080000.sql"  # 替换为实际文件
docker exec -i globalreach-postgres psql -U globalreach_user -d globalreach_prod < $backupFile

# 步骤 3: 重启 API 服务
docker compose -f docker-compose.prod.yml start api

# 步骤 4: 验证恢复结果
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "SELECT COUNT(*) FROM users;"
```

#### Redis 恢复

```powershell
# ⚠️ Redis 恢复需要重启服务

# 步骤 1: 停止 Redis 容器
docker compose -f docker-compose.prod.yml stop redis

# 步骤 2: 备份当前 RDB（以防万一）
Copy-Item "GlobalReach-Project\data\globalreach-redis_data\_data\dump.rdb" `
    "backups\redis_before_restore_$(Get-Date -Format 'yyyyMMdd_HHmmss').rdb"

# 步骤 3: 将备份 RDB 复制到卷目录
Copy-Item "backups\redis_dump_20260605_080000.rdb" `
    "GlobalReach-Project\data\globalreach-redis_data\_data\dump.rdb" -Force

# 步骤 4: 启动 Redis
docker compose -f docker-compose.prod.yml start redis

# 步骤 5: 验证
docker exec globalreach-redis redis-cli DBSIZE
```

### 4.4 备份完整性校验

```powershell
# 校验 PostgreSQL 备份文件
docker run --rm -v "${PWD}\backups:/backup" postgres:15-alpine \
    psql "postgresql://globalreach_user:changeme@host.docker.internal:5432/globalreach_prod?sslmode=disable" \
    -f /backup/pg_globalreach_latest.sql --echo-all 2>&1 | Select-Object -Last 20

# 校验 Redis RDB 文件（检查文件头）
$bytes = Get-Content backups\redis_dump_*.rdb -Encoding Byte -TotalCount 5 -ErrorAction SilentlyContinue
if ($bytes[0] -eq 0x52 -and $bytes[1] -eq 0x45 -and $bytes[2] -eq 0x44) {
    Write-Host "✅ Redis RDB 文件头正确 (REDIS)"
} else {
    Write-Host "❌ Redis RDB 文件可能损坏"
}
```

---

## 第5章：日志查看与分析

### 5.1 各服务日志查看命令

```powershell
# ===== API 服务日志（最重要） =====
# 实时跟踪
docker logs -f globalreach-api-prod

# 最近 100 行
docker logs --tail 100 globalreach-api-prod

# 最近 1 小时
docker logs --since 1h globalreach-api-prod

# 最近 1 小时且只显示 ERROR
docker logs --since 1h globalreach-api-prod 2>&1 | Select-String "ERROR"

# ===== Nginx 日志 =====
docker logs globalreach-nginx-prod

# ===== PostgreSQL 日志 =====
docker logs globalreach-postgres

# ===== Redis 日志 =====
docker logs globalreach-redis

# ===== Prometheus 日志 =====
docker logs globalreach-prometheus

# ===== 组合查看所有服务最新日志 =====
docker ps -f name=globalreach --format "{{.Names}}" | ForEach-Object {
    Write-Host "--- $_ ---" -ForegroundColor Yellow
    docker logs --tail 5 $_ 2>&1
}
```

### 5.2 结构化日志格式

API 服务采用自定义结构化 JSON 日志格式，关键字段如下：

```json
{
  "timestamp": "2026-06-05T08:30:15.123Z",
  "level": "INFO",
  "message": "Request completed",
  "requestId": "req-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "traceId": "trace-xyz-789",
  "method": "POST",
  "url": "/api/auth/login",
  "statusCode": 200,
  "responseTime": 145,
  "userAgent": "Mozilla/5.0 ...",
  "ip": "192.168.1.100",
  "userId": "usr-uuid-here"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `timestamp` | ISO 8601 | 请求完成时间戳 |
| `level` | ENUM | ERROR / WARN / INFO / DEBUG |
| `requestId` | UUID | 每次请求唯一标识，用于关联同一次请求的所有日志 |
| `traceId` | String | 分布式追踪 ID，可跨服务链路追踪 |
| `responseTime` | Number | 请求耗时（毫秒） |
| `statusCode` | Number | HTTP 响应状态码 |

**敏感数据脱敏**: 日志自动屏蔽 password、token、secret、csrfToken 等字段（替换为 `***MASKED***`）。

### 5.3 关键日志模式

#### 需要立即关注的模式

| 模式 | 严重程度 | 含义 | 可能原因 |
|------|:--------:|------|----------|
| `ECONNREFUSED` on port 5432 | 🔴 严重 | 无法连接 PostgreSQL | PG 容器未启动或崩溃 |
| `ECONNREFUSED` on port 6379 | 🔴 严重 | 无法连接 Redis | Redis 容器未启动或崩溃 |
| `bcrypt.compare timed out` | 🔴 严重 | 密码比对超时 | DEFECT-001 已修复(rounds=10)，如仍出现需检查CPU |
| `SequelizeConnectionError` | 🔴 严重 | 数据库连接失败 | PG 连接池耗尽或网络问题 |
| `heap out of memory` | 🔴 严重 | V8 堆内存溢出 | 内存泄漏或流量突增 |
| `rate limit exceeded` | 🟡 警告 | 触发速率限制 | 正常限流或疑似攻击 |
| `JWT expired` | 🟡 信息 | Token 过期 | 客户端需刷新 Token |
| `login failed` | 🟡 警告 | 登录失败 | 密码错误或账号被禁用 |

#### 常用搜索模式 (PowerShell/grep)

```powershell
# 搜索所有 ERROR 级别日志
docker logs globalreach-api-prod 2>&1 | Select-String '"level":"ERROR"'

# 搜索特定 requestId 的完整链路
docker logs globalreach-api-prod 2>&1 | Select-String 'req-a1b2c3d4'

# 搜索慢请求 (>1000ms)
docker logs globalreach-api-prod 2>&1 | Where-Object { $_ -match '"responseTime":[1-9]\d{3}' }

# 搜索 5xx 错误
docker logs globalreach-api-prod 2>&1 | Select-String '"statusCode":5\d\d'

# 搜索认证相关日志
docker logs globalreach-api-prod 2>&1 | Select-String '/auth/'

# 搜索最近的数据库错误
docker logs --since 6h globalreach-api-prod 2>&1 | Select-String 'Sequelize|ECONNREFUSED|pool.*drain'
```

### 5.4 日志聚合建议

- **短期排查**: 直接使用 `docker logs -f` 实时跟踪
- **中期分析**: 导出到文件后用 `Select-String`/`grep` 过滤
- **长期归档**: 考虑接入 ELK Stack (Elasticsearch + Logstash + Kibana) 或 Loki
- **告警联动**: 配置 Prometheus + Alertmanager 将 ERROR 率超标转为 PagerDuty/钉钉通知

---

## 第6章：监控面板解读

### 6.1 Grafana 访问信息

| 项目 | 值 |
|------|-----|
| **地址** | http://localhost:3002 |
| **默认用户名** | admin |
| **默认密码** | admin123 (可通过 `GRAFANA_ADMIN_PASSWORD` 环境变量修改) |
| **数据源** | Prometheus (http://prometheus:9090) |

> ⚠️ **生产环境必须修改默认密码！**

### 6.2 六大 Dashboard 详解

#### Dashboard 1: GlobalReach Overview（总览面板）

| 面板名称 | 指标含义 | 正常阈值 | 告警阈值 |
|----------|----------|:-------:|:--------:|
| API Uptime | API 服务在线率 | 100% | < 99% |
| Request Rate (QPS) | 每秒请求数 | 取决于业务 | 突增 > 3x |
| Error Rate (%) | 5xx 错误占比 | < 1% | > 10% (Critical) |
| Active Users | 当前活跃用户数 | - | - |
| P50/P95/P99 Latency | 请求延迟分位数 | P95 < 500ms | P95 > 2000ms |

#### Dashboard 2: API Performance（API 性能）

| 面板名称 | 指标含义 | PromQL 示例 |
|----------|----------|-------------|
| HTTP Request Duration | HTTP 请求延迟分布 (Histogram) | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))` |
| Request By Method | 按 HTTP 方法分类的请求数 | `sum by (method)(rate(http_requests_total[5m]))` |
| Request By Status Code | 按状态码分类 | `sum by (status)(rate(http_requests_total[5m]))` |
| Throughput | 吞吐量趋势 | `sum(rate(http_requests_total[5m]))` |

#### Dashboard 3: Error Tracking（错误追踪）

| 面板名称 | 指标含义 |
|----------|----------|
| Error Rate Over Time | 错误率时序曲线 |
| Top Error URLs | 出错最多的 URL 排行 |
| Error By Type | 按错误类型分类 (DB/Auth/Validation) |
| 5xx vs 4xx | 客户端错误与服务端错误对比 |

#### Dashboard 4: Resource Usage（资源用量）

| 面板名称 | 指标含义 | 数据来源 |
|----------|----------|----------|
| API Memory (RSS/Heap) | API 进程内存占用 | `/api/v1/health` system_resources |
| API Container Memory | Docker 容器内存 | node-exporter |
| Host CPU Usage | 主机 CPU 使用率 | node-exporter |
| Host Memory Usage | 主机内存使用率 | node-exporter |
| Disk I/O | 磁盘读写速率 | node-exporter |
| Network I/O | 网络收发速率 | node-exporter |

#### Dashboard 5: Infrastructure（基础设施）

| 面板名称 | 指标含义 |
|----------|----------|
| PostgreSQL Connections | PG 活跃连接数 (`pg_stat_activity_count`) |
| PostgreSQL Query Latency | 查询延迟分布 |
| Redis Memory Usage | Redis 内存使用量 / 最大内存比 |
| Redis Hit Rate | Redis 缓存命中率 |
| Container Restart Count | 容器重启次数 |
| Container Uptime | 各容器运行时长 |

#### Dashboard 6: Business Metrics（业务指标）

| 面板名称 | 指标含义 |
|----------|----------|
| Emails Sent Today | 今日发送邮件数 |
| Active Campaigns | 进行中的营销活动数 |
| Email Account Health | 邮箱账户池健康评分 |
| New Registrations | 新注册用户数 |

### 6.3 Prometheus 查询基础

#### 常用查询语法

```promql
# ---- 基础查询 ----

# 检查所有目标是否在线
up{}

# API 是否在线
up{job="globalreach-api"}

# ---- 速率计算 ----

# 每 5 分钟平均 QPS
sum(rate(http_requests_total[5m]))

# 5xx 错误率
sum(rate(http_requests_total{status=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m]))

# ---- 直方图分位数 ----

# P95 延迟
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# P99 延迟
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))

# ---- 主机资源 ----

# CPU 使用率
100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# 内存使用率
(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)
/ node_memory_MemTotal_bytes * 100

# 磁盘可用比例
node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"}
/ node_filesystem_size_bytes{fstype!~"tmpfs|overlay"}

# ---- 数据库指标 ----

# PG 活跃连接数
pg_stat_activity_count

# Redis 内存使用率
redis_used_memory / redis_maxmemory
```

### 6.4 告警规则参考表

| # | 告警名称 | 严重级别 | 检测条件 | 持续时间 | 立即动作 |
|:-:|----------|:--------:|----------|:--------:|----------|
| 1 | **APIDown** | 🔴 Critical | `up{job="globalreach-api"} == 0` | 1 分钟 | 立即重启 API 容器 |
| 2 | **HighErrorRate** | 🔴 Critical | 5xx 错误率 > 10% | 5 分钟 | 查看日志，定位错误源头 |
| 3 | **ContainerRestartLoop** | 🟡 Warning | 1 小时内重启 > 5 次 | 5 分钟 | 检查 OOM 或配置错误 |
| 4 | **HighLatency** | 🟡 Warning | P95 延迟 > 2 秒 | 10 分钟 | 检查 DB 慢查询 / GC 压力 |
| 5 | **PostgresConnectionHigh** | 🟡 Warning | PG 连接数 > 80 | 15 分钟 | 检查连接泄漏，考虑调整 pool |
| 6 | **RedisMemoryHigh** | 🟡 Warning | Redis 内存 > 80% | 10 分钟 | 检查缓存膨胀，清理 key |
| 7 | **NodeFileSystemFull** | 🟡 Warning | 磁盘剩余 < 20% | 15 分钟 | 立即清理日志/备份 |
| 8 | **NodeHighMemory** | 🟡 Warning | 主机内存 > 85% | 15 分钟 | 检查内存消耗进程 |
| 9 | **NodeHighCPU** | 🟡 Warning | 主机 CPU > 90% | 15 分钟 | 检查高 CPU 进程 |

---

## 第7章：告警处理 SOP

### 7.1 Critical 告警处理

#### 🔴 APIDown — API 服务宕机

| 项目 | 内容 |
|------|------|
| **检测条件** | `up{job="globalreach-api"} == 0` 持续 1 分钟 |
| **影响范围** | 全部 API 功能不可用，前端无法加载 |
| **立即行动** | |
| Step 1 | `docker ps -a -f name=globalreach-api` — 检查容器状态 |
| Step 2 | `docker logs --tail 50 globalreach-api-prod` — 查看崩溃原因 |
| Step 3 | 若 OOM Killed → 见第9章内存调优 |
| Step 4 | `docker compose -f docker-compose.prod.yml restart api` — 尝试重启 |
| Step 5 | 若重启无效 → `docker compose -f docker-compose.prod.yml up -d --build api` — 重建 |
| Step 6 | 验证: `curl http://localhost:3000/api/v1/health` |
| **升级路径** | 5分钟未恢复 → 通知技术负责人 → 15分钟 → 通知管理层 |
| **呼叫树** | 一线运维 → 二线开发(Team Lead) → 技术总监 → CTO |

#### 🔴 HighErrorRate — 高错误率

| 项目 | 内容 |
|------|------|
| **检测条件** | 5xx 错误占比 > 10%，持续 5 分钟 |
| **影响范围** | 大量用户请求失败 |
| **立即行动** | |
| Step 1 | `docker logs --since 10m globalreach-api-prod 2>&1 \| Select-String '"statusCode":5\d\d'` — 提取 5xx 日志 |
| Step 2 | 分析错误集中出现的 URL 和错误类型 |
| Step 3 | 常见场景: |
| ‣ | DB 连接失败 → 检查 PG 容器和连接池 |
| ‣ | 认证失败(JWT) → 检查 JWT_SECRET 配置 |
| ‣ | 验证失败(422) → 检查最近代码变更是否引入 schema 变更 |
| Step 4 | 如确认是已知问题且有热修复 → 重建部署 |
| **升级路径** | 错误率 > 30% 立即升级；否则 15 分钟观察期 |

### 7.2 Warning 告警处理

#### 🟡 HighLatency — 高延迟 (P95 > 2s)

**调查步骤**:
```
Step 1: 确认延迟来源
  ├─ DB 慓查询? → docker exec globalreach-postgres psql ... (启用 slow query log)
  ├─ bcrypt 哈希? → 已优化至 rounds=10 (~200ms), 若仍慢则检查 CPU 争用
  ├─ GC Pause? → 检查 heapUsagePercent, 若 > 75% 则 GC 压力大
  └─ 外部依赖? → 邮件服务商 API 调用超时

Step 2: 缓解措施
  ├─ 临时: 降低 SEND_CONCURRENCY (环境变量)
  ├─ 短期: 重启 API 容器释放内存碎片
  └─ 长期: 见第9章性能调优
```

#### 🟡 PostgresConnectionHigh — PG 连接数过高 (>80)

**调查步骤**:
```
Step 1: 查看当前连接数和来源
  docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
    -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"

Step 2: 检查是否有空闲连接未释放 (idle in transaction)

Step 3: 如确认为连接泄漏
  ├─ 检查 Sequelize pool.acquireTimeout 设置 (当前 30s)
  ├─ 考虑降低 DB_POOL_MAX (当前 10)
  └─ 重启 API 释放连接
```

#### 🟡 RedisMemoryHigh — Redis 内存 > 80%

**调查步骤**:
```
Step 1: 查看 Redis 内存详情
  docker exec globalreach-redis redis-cli INFO memory

Step 2: 查看大 Key
  docker exec globalreach-redis redis-cli --bigkeys

Step 3: 常见原因及处理
  ├─ 会话缓存过多 → 缩短 JWT_EXPIRES_IN
  ├─ 限流计数器累积 → 多数有 TTL 自动清理
  └─ 队列积压 → 检查 SendWorker 是否正常运行
```

#### 🟡 NodeFileSystemFull / NodeHighMemory / NodeHighCPU

统一处理思路:
```
Step 1: 确认资源消耗进程
  docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.CPerc}}"

Step 2: 磁盘满 → 清理 Docker 日志和旧备份
  docker system prune -f
  # 或手动清理旧备份

Step 3: 内存/CPU 高 → 定位异常容器并重启
```

### 7.3 事后复盘模板

每次 Critical/Warning 告警处理后，填写以下模板：

```markdown
# 事件报告 — [事件编号]

## 基本信息
- **发生时间**: YYYY-MM-DD HH:MM:SS
- **发现方式**: Prometheus 告警 / 用户反馈 / 巡检发现
- **告警类型**: APIDown / HighErrorRate / ...
- **影响范围**: XX 用户 / XX 分钟
- **严重等级**: P1(Critical) / P2(Warning)

## 时间线
| 时间 | 事件 | 操作人 |
|------|------|--------|
| HH:MM | 告警触发 | System |
| HH:MM | 开始排查 | Operator A |
| HH:MM | 确认原因 | Operator A |
| HH:MM | 执行恢复 | Operator A |
| HH:MM | 服务恢复 | System |

## 根因分析
- **直接原因**: (如: PG 连接池耗尽)
- **根本原因**: (如: 某接口未正确释放连接)
- **证据**: (日志片段/截图)

## 解决措施
- **临时措施**: (已执行)
- **长期方案**: (待实施)
- **预防措施**: (改进点)

## 经验教训
-
```

---

## 第8章：用户账号管理

### 8.1 用户模型关键信息

```
表: users (Sequelize Model)
├── id: UUID (主键)
├── email: STRING(255) UNIQUE (登录凭证)
├── passwordHash: STRING(255) (bcrypt 加密, field: password_hash)
├── name: STRING(100) (显示名称)
├── role: ENUM('ADMIN', 'USER', 'VIEWER') (默认: USER)
├── isActive: BOOLEAN (默认: true, field: is_active) ← 账号启用/禁用
├── isEmailVerified: BOOLEAN (field: is_email_verified)
├── avatar: STRING (头像URL)
└── lastLoginAt: DATE (field: last_login_at)
```

### 8.2 创建管理员账号

#### 方式一：通过 Seed 脚本（推荐初始化时使用）

Seed 脚本位于 `api/db/seed.js` 和 `api/prisma/seed.js`，内置 ADMIN 账号创建逻辑：

```javascript
// seed.js 中的默认管理员
{
  email: 'admin@globalreach.com',
  name: 'System Administrator',
  role: 'ADMIN',
  // password: 需在 .env 中配置或手动设置
}
```

#### 方式二：通过数据库直接插入（紧急情况）

```powershell
# 生成 bcrypt 哈希 (saltRounds=10)
docker exec globalreach-api-prod node -e "
const bcrypt = require('bcryptjs');
bcrypt.hash('YourSecurePassword123!', 10).then(h => console.log(h));
"

# 使用生成的哈希值插入管理员记录
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
INSERT INTO users (id, email, password_hash, name, role, is_active, is_email_verified, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'admin@globalreach.com',
  '<粘贴上面生成的哈希值>',
  'System Administrator',
  'ADMIN',
  true,
  true,
  NOW(),
  NOW()
);
"

# 验证
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT id, email, role, is_active FROM users WHERE email = 'admin@globalreach.com';
"
```

#### 方式三：通过 API 注册（自动分配 USER 角色）

```bash
# 注册新用户 (返回 201, 自动获得 USER 角色)
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@example.com","password":"SecurePass123!","name":"New User"}'

# 然后通过 DB 升级为 ADMIN
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
UPDATE users SET role = 'ADMIN' WHERE email = 'newuser@example.com';
"
```

### 8.3 密码重置流程

GlobalReach 支持两步密码重置：

```
步骤 1: 用户发起重置请求
  POST /api/auth/forgot-password
  Body: { "email": "user@example.com" }

  → 系统:
    1. 验证邮箱存在且 isActive=true
    2. 生成 reset token (crypto.randomBytes)
    3. 发送重置链接到用户邮箱
    4. 返回 200 (无论邮箱是否存在，防枚举)

步骤 2: 用户使用 token 重置密码
  POST /api/auth/reset-password
  Body: { "token": "<from-email>", "password": "NewPass123!", "confirmPassword": "NewPass123!" }

  → 系统:
    1. 验证 token 有效性和时效性
    2. 验证新密码复杂度 (min 8, upper+lower+number/special)
    3. bcrypt.hash(newPassword, 10) — 更新 password_hash
    4. 使该用户所有 refresh_token 失效 (强制重新登录)
    5. 返回 200
```

**运维强制重置密码** (绕过邮箱):

```powershell
# 生成新密码哈希
$newHash = docker exec globalreach-api-prod node -e "const b=require('bcryptjs');b.hash('TempPass123!',10).then(h=>console.log(h))"

# 直接更新数据库
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
UPDATE users SET password_hash = '$newHash' WHERE email = 'target-user@example.com';

-- 同时使该用户所有 refresh token 失效
UPDATE refresh_tokens SET revoked_at = NOW()
WHERE user_id = (SELECT id FROM users WHERE email = 'target-user@example.com')
AND revoked_at IS NULL;
"
```

### 8.4 角色权限矩阵

| 权限 | ADMIN | USER | VIEWER |
|------|:-----:|:----:|:------:|
| 创建/编辑/删除Campaign | ✅ | ✅ (仅自己的) | ❌ |
| 查看所有Campaign | ✅ | ❌ (仅自己的) | ✅ (只读) |
| 管理用户账号 | ✅ | ❌ | ❌ |
| 查看系统统计 | ✅ | ❌ | ❌ |
| 管理邮箱账户池 | ✅ | ✅ (仅自己的) | ❌ |
| 查看审计日志 | ✅ | ❌ | ❌ |
| API 完整访问 | ✅ | 受 RBAC 限制 | 只读端点 |

**修改用户角色**:

```sql
-- 升级为 ADMIN
UPDATE users SET role = 'ADMIN' WHERE email = 'user@example.com';

-- 降级为 VIEWER
UPDATE users SET role = 'VIEWER' WHERE email = 'user@example.com';
```

### 8.5 账号禁用与激活

```sql
-- 禁用账号 (用户无法登录, Login 返回 403)
UPDATE users SET is_active = false WHERE email = 'user@example.com';

-- 重新激活账号
UPDATE users SET is_active = true WHERE email = 'user@example.com';

-- 查看所有禁用账号
SELECT id, email, name, role, is_active, last_login_at
FROM users WHERE is_active = false;
```

> **重要**: `isActive` 字段对应数据库列 `is_active`。该字段在 S085/L04 中修复过缺失问题——之前模型定义缺少此字段导致 `user.isActive` 始终为 `undefined`，Login 接口误判为禁用而返回 403。

### 8.6 Refresh Token 管理

```
Token 体系:
├── AccessToken (JWT)
│   ├── 有效期: 24小时 (JWT_EXPIRES_IN 环境变量)
│   ├── 包含: userId, email, role
│   └── 用于: API 请求认证 (Bearer Token)
│
└── RefreshToken (存储于 DB refresh_tokens 表)
    ├── 有效期: 通常 7-30天 (代码设定)
    ├── 字段: tokenHash, expiresAt, revokedAt
    ├── 特性: 单次使用 (Rotation — 使用后旧 token 即失效)
    └── 用于: 获取新的 AccessToken
```

**常见 Token 操作**:

```sql
-- 强制某用户下线 (使所有 refresh token 失效)
UPDATE refresh_tokens SET revoked_at = NOW()
WHERE user_id = '<user-uuid>' AND revoked_at IS NULL;

-- 查看活跃 session 数
SELECT user_id, COUNT(*) as active_sessions
FROM refresh_tokens
WHERE revoked_at IS NULL AND expires_at > NOW()
GROUP BY user_id;

-- 清理过期 token (可设定期任务)
DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked_at IS NOT NULL;
```

---

## 第9章：性能调优参考

### 9.1 当前调优参数基线

| 参数 | 当前值 | 位置 | 说明 |
|------|:-----:|------|------|
| **V8 Heap 上限** | **256 MB** | `api/server.js:5` | `--max-old-space-size=256` |
| **手动 GC 间隔** | **60 秒** | `api/server.js:387` | `setInterval(global.gc, 60000)` |
| **bcrypt 盐轮次** | **10** | `api/routes/auth.js:27` | `BCRYPT_ROUNDS=10` (原 12, 修复 DEFECT-001) |
| **DB 连接池最大** | **10** | `api/db/index.js:11` | `DB_POOL_MAX=10` |
| **DB 连接池最小** | **2** | `api/db/index.js:12` | `DB_POOL_MIN=2` |
| **DB 连接获取超时** | **30 秒** | `api/db/index.js:13` | `DB_ACQUIRE_TIMEOUT=30000` |
| **DB 空闲超时** | **10 秒** | `api/db/index.js:14` | `DB_IDLE_TIMEOUT=10000` |
| **容器内存上限** | **512 MB** | `docker-compose.prod.yml:80` | deploy.resources.limits.memory |
| **容器 CPU 上限** | **1.0 核** | `docker-compose.prod.yml:81` | deploy.resources.limits.cpus |
| **Docker NODE_OPTIONS** | **384 MB** | `docker-compose.prod.yml:52` | 容器级堆上限 (server.js 中覆盖为 256) |
| **日志单文件上限** | **10 MB** | `docker-compose.prod.yml:87` | max-size: 10m |
| **日志文件数量** | **3** | `docker-compose.prod.yml:88` | max-file:3 (最多 30MB) |
| **Schema 同步模式** | **alter:true** | `api/server.js:322` | Sequelize.sync({alter:true}) 自动添加新列 |
| **邮件并发数** | **5** | `api/server.js:51` | `SEND_CONCURRENCY=5` |
| **邮件重试次数** | **3** | `api/server.js:52` | `SEND_MAX_RETRIES=3` |
| **邮件发送限速** | **3/秒** | `api/server.js:54` | `SEND_RATE_LIMIT=3` |

### 9.2 内存使用基线

基于当前 512MB 容器限制 + 256MB V8 Heap 配置：

| 指标 | 正常值 | 警告值 | 危险值 |
|------|:-----:|:-----:|:-----:|
| Heap Used | ~64 MB | > 180 MB (70%) | > 230 MB (90%) |
| Heap % of Total | ~25% | > 70% | > 90% → degraded |
| RSS (进程常驻) | ~72 MB | > 200 MB | > 400 MB |
| 容器总内存 | ~140 MB | > 350 MB | > 480 MB |

> 当 `heapUsagePercent > 90%` 时，Health Endpoint 返回 `status: "degraded"`。

### 9.3 各参数何时需要调整

#### V8 Heap (--max-old-space-size)

| 场景 | 建议 | 命令 |
|------|------|------|
| 常驻内存不足, OOM | 增大到 384 | 修改 `server.js:5` 为 384 |
| 内存充裕但 GC 频繁 | 保持 256 或微调 | 观察 GC pause 时间 |
| 容器升级到 1GB | 可增大到 512 | 同步修改 docker-compose limits |

#### bcrypt Salt Rounds

| 场景 | 建议 | 注意事项 |
|------|------|----------|
| 当前 rounds=10 足够 | 保持 | ~1024 次迭代, OWASP 最低可接受 |
| 安全合规要求更高 | 增到 12 | ⚠️ 会导致登录超时 (DEFECT-001 教训) |
| 极低安全要求 | 不可低于 8 | 安全风险显著增加 |

#### DB Connection Pool

| 场景 | 建议 |
|------|------|
| 连接数经常 > 80 (告警触发) | 降低 max 到 8 或 6 |
| 大量并发请求导致等待连接 | 增大 max 到 15 (需同步增加容器内存) |
| 空闲连接占用过多内存 | 降低 min 从 2 到 1 |

#### 邮件发送参数

| 场景 | 建议 |
|------|------|
| 邮件服务商限速 | 降低 RATE_LIMIT 到 1-2 |
| 发送太慢 | 增大 CONCURRENCY 到 8-10 (注意 IP 信誉) |
| 重试过于频繁 | 增大 RETRY_DELAY (默认 5000ms) |

### 9.4 已知瓶颈与规避方法

| 瓶颈 | 影响 | 规避方法 |
|------|------|----------|
| **bcrypt 同步阻塞** | 登录/注册时 Event Loop 阻塞 ~200ms | 已优化 rounds=10; 未来考虑 argon2id (异步) |
| **Sequelize sync({alter:true})** | 启动时扫描全表, 大表时慢 | 数据量大时改用 migration |
| **Redis 无持久化策略** | 容器重启可能丢数据 | 已挂载 volume (redis_data); 可加 AOF |
| **单实例 API** | 无水平扩展能力 | 未来考虑 Kubernetes + 多副本 |
| **Docker json-file 日志驱动** | 高吞吐下写放大 | 生产环境建议 fluentd/loki sidecar |
| **无 Alertmanager** | 告警无法自动通知 | 部署 Alertmanager + 钉钉/邮件 webhook |

---

## 第10章：紧急联系人及升级路径

### 10.1 值班概念 (On-Call Rotation)

GlobalReach V2.0 采用分级值班制度：

| 级别 | 角色 | 响应 SLA | 职责范围 |
|:----:|------|:-------:|----------|
| **L1** | 一线运维 | ≤ 5 分钟 | 告警确认、初步排查、常规重启、日志收集 |
| **L2** | 后端开发 | ≤ 15 分钟 | 问题定位、代码分析、热修复、数据修复 |
| **L3** | 技术负责人 | ≤ 30 分钟 | 架构决策、重大故障指挥、对外沟通 |
| **L4** | 管理层 | ≤ 1 小时 | 业务影响评估、客户沟通、资源协调 |

### 10.2 升级路径 (Escalation Tiers)

```
┌─────────────────────────────────────────────────────────────────┐
│                    告警触发 (Prometheus/Grafana)                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                ┌────────────────────────┐
                │   L1 一线运维 (5 min)    │
                │  • 确认告警真实性         │
                │  • 执行标准 SOP (第7章)   │
                │  • 收集初步信息           │
                └────┬───────────────┬────┘
                     │               │
              已解决 ✗         未解决 / Critical
                     │               │
                     ▼               ▼
            (记录并关闭)    ┌────────────────────────┐
                           │   L2 后端开发 (15 min)   │
                           │  • 深入分析根因           │
                           │  • 代码层面修复           │
                           │  • 数据库操作             │
                           └────┬───────────────┬────┘
                                │               │
                         已解决 ✗         未解决 / 影响面大
                                │               │
                                ▼               ▼
                       (记录并关闭)    ┌────────────────────────┐
                                      │   L3 技术负责人 (30 min) │
                                      │  • 架构级决策            │
                                      │  • 跨团队协调            │
                                      │  • 客户沟通准备           │
                                      └────┬───────────────┬────┘
                                           │               │
                                    已解决 ✗         持续影响业务
                                           │               │
                                           ▼               ▼
                                  (记录并关闭)    ┌────────────────┐
                                                 │ L4 管理层 (1h)  │
                                                 │ • 业务连续性决策 │
                                                 │ • 客户/公关沟通  │
                                                 │ • 资源调配审批   │
                                                 └────────────────┘
```

### 10.3 故障通信模板

#### 内部通知 (IM/钉钉/企业微信)

```text
🚨 [GlobalReach 故障通告]

【故障等级】P1-Critical / P2-Warning
【故障时间】YYYY-MM-DD HH:MM:SS
【影响范围】描述受影响的功能和用户群体
【当前状态】🔴 正在排查 / 🟡 已定位 / 🟢 已恢复
【负责人】XXX (L1/L2/L3)
【最新进展】简要说明当前进展
【预计恢复】预计 HH:MM 恢复 / 不确定
```

#### 用户通知 (邮件/站内信)

```text
尊敬的用户：

我们检测到 GlobalReach 平台在 [时间段] 出现了 [问题描述]。
我们的技术团队正在全力处理，预计 [时间] 恢复正常。

给您带来的不便，我们深表歉意。如有紧急需求，请联系：
📧 support@globalreach.com
📞 400-XXX-XXXX

— GlobalReach 技术团队
```

### 10.4 Runbook 更新流程

```
触发条件 (满足任一即应更新):
├── 新增/移除了 Docker 服务
├── 修改了端口映射或环境变量
├── 新增了告警规则
├── 发生了未覆盖的故障类型
├── 依赖版本有大版本升级
└── 每月例行 review 发现过时内容

更新流程:
  1. 在 docs/ 目录编辑本文件
  2. 更新版本号和日期
  3. 在变更摘要处注明修改内容
  4. 提交 Git 并关联 issue/ticket
  5. 通知所有运维人员 reviewed

审核要求:
  - 至少 1 名 L2+ 级别人员 Review
  - 涉及安全变更需 L3 审批
  - 紧急修复可在事后 48 小时内补审
```

---

## 附录

### A. 快速命令速查卡

```powershell
# === 生命周期 ===
docker compose -f docker-compose.prod.yml up -d          # 启动
docker compose -f docker-compose.prod.yml down           # 停止
docker compose -f docker-compose.prod.yml restart api    # 重启 API

# === 健康检查 ===
curl http://localhost:3000/api/v1/health                 # 深度检查
curl http://localhost:3000/api/v1/health/ready           # 就绪探针
pwsh -File scripts/health-check.ps1                      # 脚本检查

# === 日志 ===
docker logs -f globalreach-api-prod                      # 实时日志
docker logs --since 1h globalreach-api-prod 2>&1 | Select-String "ERROR"  # 近1h错误

# === 备份 ===
pwsh -File scripts\s079-backup.ps1                       # 全量备份

# === 容器状态 ===
docker ps -f name=globalreach --format "table {{.Names}}\t{{.Status}}"
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.CPerc}}"

# === 监控 ===
# Prometheus: http://localhost:9090
# Grafana:    http://localhost:3002 (admin/admin123)
```

### B. 关键文件索引

| 文件路径 | 用途 |
|----------|------|
| `docker-compose.prod.yml` | 生产环境编排定义 (8 个服务) |
| `Dockerfile` | API 服务构建 (Node 20 Alpine, 多阶段构建) |
| `api/server.js` | API 入口 (V8 调优、GC、路由注册) |
| `api/db/index.js` | 数据模型定义 (11 张表, 连接池配置) |
| `api/routes/health.js` | 健康检查端点 (5 子系统深度检查) |
| `api/routes/auth.js` | 认证路由 (bcrypt rounds=10) |
| `api/middleware/logger.js` | 结构化日志中间件 (requestId/traceId) |
| `prometheus/rules/alerts.yml` | 9 条告警规则定义 |
| `prometheus/prometheus.yml` | Prometheus 采集配置 (4 个 job) |
| `scripts/s079-backup.ps1` | 自动化备份脚本 (PG+Redis+Config+Git) |
| `scripts/health-check.ps1` | 健康检查脚本 |
| `.env.prod` / `.env.production` | 生产环境变量配置 |
| `nginx/conf.d/` | Nginx 站点配置 |
| `grafana/provisioning/dashboards/` | 6 个 Grafana 预置 Dashboard JSON |

### C. 版本历史

| 版本 | 日期 | 作者 | 变更摘要 |
|:----:|------|------|----------|
| 2.0.0 | 2026-06-05 | Ops Team | 初始版本，涵盖全部 10 章节 |

---

> **文档维护**: 本手册与 GlobalReach V2.0 代码仓库同步维护。
> **反馈渠道**: 发现手册内容不准确或有改进建议，请提交 Issue 或联系运维团队。
