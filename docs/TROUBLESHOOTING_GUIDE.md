# GlobalReach V2.0 综合故障排查指南

> **版本**: V2.0 | **适用环境**: Docker Compose 生产部署 (8 个服务) | **最后更新**: 2026-06-05
>
> 本文档为 GlobalReach 企业级邮件营销平台的运维故障排查手册，包含 **S081-S086 会话期间发现并修复的真实 Bug**。这些是经过实战验证的宝贵知识资产。

---

## 目录

1. [快速诊断流程图](#section-1-快速诊断流程图)
2. [容器级别问题](#section-2-容器级别问题)
3. [网络与连接问题](#section-3-网络与连接问题)
4. [数据库问题 (PostgreSQL)](#section-4-数据库问题-postgresql)
5. [认证问题 (关键 - 含真实 Bug 修复!)](#section-5-认证问题关键--含真实-bug-修复)
6. [性能问题](#section-6-性能问题)
7. [安全事件](#section-7-安全事件)
8. [CI/CD 流水线问题](#section-8-cicd-流水线问题)
9. [应急程序](#section-9-应急程序)
10. [命令速查卡](#section-10-命令速查卡)

---

## Section 1: 快速诊断流程图

### 1.1 决策树：服务故障诊断

```
┌─────────────────────┐
│   服务不可用？       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐     否      ┌─────────────────────┐
│ 容器是否在运行？      │────────────►│ 检查容器启动日志     │
│ docker ps -a        │             │ docker logs <name>   │
└──────────┬──────────┘             └─────────────────────┘
           │ 是
           ▼
┌─────────────────────┐     否      ┌─────────────────────┐
│ 端口是否正常监听？    │────────────►│ 检查端口冲突         │
│ netstat/ss/lsof     │             │ 端口被其他进程占用    │
└──────────┬──────────┘             └─────────────────────┘
           │ 是
           ▼
┌─────────────────────┐     异常     ┌─────────────────────┐
│ 容器健康状态如何？    │◄────────────│ 检查应用层错误       │
│ docker inspect      │             │ 查看最近异常日志     │
└──────────┬──────────┘             └─────────────────────┘
           │ healthy
           ▼
┌─────────────────────┐     失败     ┌─────────────────────┐
│ 依赖服务是否正常？    │────────────►│ 检查 PostgreSQL/Redis │
│ postgres/redis ping  │             │ 网络连通性测试       │
└──────────┬──────────┘             └─────────────────────┘
           │ 正常
           ▼
┌─────────────────────┐
│   检查 Nginx 反向代理 │
│   检查防火墙规则      │
│   检查 DNS 解析      │
└─────────────────────┘
```

### 1.2 Top 5 最常见问题及一键诊断

| 排名 | 问题现象 | 一键诊断命令 | 典型原因 |
|:---:|---------|-------------|---------|
| **#1** | API 无响应 | `docker logs globalreach-api-prod --tail 50` | 应用崩溃 / OOM / 中间件挂起 |
| **#2** | 数据库连接失败 | `docker exec globalreach-postgres pg_isready -U globalreach_user` | PG 未就绪 / 连接池耗尽 |
| **#3** | Redis 连接拒绝 | `docker exec globalreach-redis redis-cli ping` | Redis 未启动 / 网络隔离 |
| **#4** | 认证接口超时 | `curl -m 10 -X POST http://localhost:3000/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"test@test.com","password":"test"}'` | **DEFECT-001 中间件模式错误** |
| **#5** | 前端无法访问 | `curl -I https://api.globalreach.com/api/v1/health` | Nginx 配置 / SSL 证书 / DNS |

---

## Section 2: 容器级别问题

### 2.1 容器无法启动

#### 镜像构建失败（npm install 错误）

```bash
# 查看构建日志
docker compose -f docker-compose.prod.yml build api 2>&1 | tail -100

# 常见错误及解决方案:
# 错误: npm ERR! network timeout → 检查 Docker daemon DNS 配置
# 错误: npm ERR! ERESOLVE dependency conflict → 清除 node_modules 重装
# 解决: 在 api/ 目录下执行 rm -rf node_modules package-lock.json && npm install

# Docker BuildKit 严格模式 vs 本地 daemon 容忍差异
# CI/CD 中 BuildKit 对依赖版本更严格，本地可能通过但 CI 失败
DOCKER_BUILDKIT=1 docker compose build api
```

#### 端口冲突（已被占用）

```bash
# 检查端口占用情况
netstat -ano | findstr :3000
netstat -ano | findstr :80
netstat -ano | findstr :443
netstat -ano | findstr :5432
netstat -ano | findstr :6379

# 或使用 PowerShell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue

# 解决方案: 修改 docker-compose.prod.yml 中的端口映射
# 例如: 将 "${API_PORT:-3000}:3000" 改为 "3001:3000"
```

#### 环境变量缺失（.env 未加载）

```bash
# 验证 .env 文件是否被正确加载
docker compose -f docker-compose.prod.yml config | grep -E "(DB_|REDIS_|JWT_)" | head -20

# 常见遗漏变量检查清单:
# ✅ DATABASE_URL (完整连接串)
# ✅ DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
# ✅ REDIS_HOST / REDIS_PORT
# ✅ JWT_SECRET (至少 32 字符!)
# ✅ NODE_OPTIONS (--max-old-space-size=384)

# .env 文件位置要求: 必须与 docker-compose.prod.yml 同级目录
```

#### Volume 挂载权限问题（Windows Docker Desktop）

```bash
# Windows Docker Desktop 常见权限错误:
# Error: mkdir /var/lib/postgresql/data: permission denied

# 解决方案 1: 使用 WSL2 后端 (推荐)
# Docker Desktop → Settings → General → Use the WSL 2 based engine

# 解决方案 2: 调整文件共享设置
# Docker Desktop → Settings → Resources → File Sharing → 添加项目路径

# 解决方案 3: 以管理员身份运行 Docker Desktop
```

### 2.2 容器持续重启（Restart Loop）

```bash
# 查看重启次数和退出码
docker inspect globalreach-api-prod --format='{{.State.ExitCode}} {{.RestartCount}}'

# 退出码含义:
# ExitCode 0: 正常退出 (可能是健康检查失败导致 restart policy 触发)
# ExitCode 1: 应用错误 (uncaught exception / syntax error)
# ExitCode 137: OOMKilled (内存超限被 kill)
# ExitCode 143: SIGTERM (优雅关闭)
# ExitCode > 128: 信号终止 (128 + signal number)
```

#### OOMKilled（内存限制超出）

```bash
# 确认是否因 OOM 被杀
docker inspect globalreach-api-prod --format='{{.State.OOMKilled}}'
# 输出: true → 确认是 OOM

# 当前资源限制 (来自 docker-compose.prod.yml):
# memory limit: 512MB
# memory reservation: 256MB
# V8 heap ceiling: --max-old-space-size=384 (NODE_OPTIONS)

# 临时调大内存限制:
# 编辑 docker-compose.prod.yml → deploy.resources.limits.memory: "768M"
# 然后: docker compose -f docker-compose.prod.yml up -d api

# 监控实际内存使用:
docker stats globalreach-api-prod --no-stream
```

#### 应用启动时崩溃（未捕获异常）

```bash
# 查看完整崩溃堆栈
docker logs globalreach-api-prod --tail 200 2>&1 | grep -A 20 "Error\|error\|FATAL"

# 常见启动崩溃场景:
# 1. 数据库连接失败 → Sequelize connection error
# 2. Redis 连接失败 → Redis connection refused
# 3. 环境变量缺失 → Cannot read property of undefined
# 4. 端口绑定失败 → EADDRINUSE: address already in use :::3000

# 进入容器手动调试:
docker exec -it globalreach-api-prod sh
node -e "require('./server.js')"
```

#### 依赖服务不可用（PG/Redis 未就绪）

```bash
# 检查依赖服务状态
docker compose -f docker-compose.prod.yml ps

# 手动验证 PG 连通性
docker exec globalreach-postgres pg_isready -U globalreach_user -d globalreach_prod

# 手动验证 Redis 连通性
docker exec globalreach-redis redis-cli ping
# 期望输出: PONG

# API 的 depends_on 仅保证 service_started，不保证 service_healthy!
# 如果需要等待健康检查完成，使用 wait-for-it.sh 或类似工具
```

#### HEALTHCHECK 反复失败

```bash
# 查看 HEALTHCHECK 详细状态
docker inspect globalreach-api-prod --format='{{json .State.Health}}' | python -m json.tool

# 当前 HEALTHCHECK 配置 (Dockerfile):
# interval: 30s, timeout: 10s, start_period: 60s, retries: 3
# 检测端点: curl -f http://localhost:3000/api/v1/health

# start_period=60s 给了 API 60 秒初始化时间（含 DB migration）
# 如果 60 秒内未通过连续 3 次检查，标记为 unhealthy
```

### 2.3 容器运行但不健康

**"Running" ≠ "Healthy"**

| 状态 | 含义 | Docker 显示 |
|------|------|------------|
| **running** | 容器进程存在，但不确定服务可用 | `Up X seconds` |
| **healthy** | HEALTHCHECK 连续通过 | `Up X seconds (healthy)` |
| **unhealthy** | HEALTHCHECK 连续失败 | `Up X seconds (unhealthy)` |

**常见不健康原因:**

1. **启动过慢** — DB migration 耗时超过 `start_period`（当前 60s）
2. **依赖延迟** — PG/Redis 在 network 中响应慢
3. **资源饥饿** — CPU/Memory 被 host 上其他进程抢占
4. **死锁/阻塞** — 事件循环被同步操作阻塞（**参考 DEFECT-001**）

---

## Section 3: 网络与连接问题

### 3.1 无法从浏览器访问 API

#### Nginx 反向代理配置错误

```bash
# 检查 Nginx 配置语法
docker exec globalreach-nginx-prod nginx -t

# 检查 Nginx 错误日志
docker logs globalreach-nginx-prod --tail 30 2>&1

# 测试 Nginx 到 API 的内部转发
docker exec globalreach-nginx-prod wget -qO- http://api:3000/api/v1/health

# 关键配置点 (nginx/conf.d/):
# - upstream 定义必须指向正确的 service name (api:3000)
# - proxy_pass 必须匹配 upstream name
# - location 块的 proxy_set_header 必须包含 Host/X-Real-IP
```

#### 防火墙阻止端口

```bash
# Windows Firewall 检查
Get-NetFirewallRule -Direction Inbound | Where-Object { $_.Enabled -eq 'True' } | Select-Object DisplayName, Direction, Action

# Linux 服务器防火墙检查
sudo iptables -L -n | grep -E "(80|443|3000)"
sudo ufw status

# 云服务器安全组检查 (AWS/Azure/阿里云):
# 确保入站规则允许 80/443 端口
```

#### DNS 解析问题

```bash
# 检查域名解析
nslookup api.globalreach.com
dig api.globalreach.com +short

# 检查本地 hosts 文件 (开发环境)
type C:\Windows\System32\drivers\etc\hosts | findstr globalreach

# Docker 内部 DNS 测试
docker exec globalreach-api-prod nslookup postgres
docker exec globalreach-api-prod nslookup redis
```

#### HTTPS 证书问题

```bash
# 检查证书有效性
echo | openssl s_client -connect api.globalreach.com:443 -servername api.globalreach.com 2>/dev/null | openssl x509 -noout -dates -subject

# 当前证书信息:
# 通配符证书: *.globalreach.com
# 有效期至: 2031-06-04
# 存放路径: ./nginx/ssl/globalreach/

# 证书链完整性检查
openssl s_client -connect api.globalreach.com:443 -showcerts
```

### 3.2 容器间通信失败

#### Network Mode 不匹配

```bash
# 所有服务必须在同一 network 下才能通过 service name 通信
docker network ls | grep globalreach

# 当前配置: external network "globalreach-project_globalreach-network"
# 如果此 network 不存在，需先创建:
docker network create globalreach-project_globalreach-network

# 检查各容器的 network attachment
docker inspect globalreach-api-prod --format='{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

#### Service Name 解析问题

```bash
# Compose 内部服务名解析规则:
# postgres → 解析到 globalreach-postgres 容器 IP
# redis    → 解析到 globalreach-redis 容器 IP
# api      → 解析到 globalreach-api-prod 容器 IP

# 从 API 容器内测试所有依赖连接
docker exec -it globalreach-api-prod sh
# inside container:
wget -qO- http://postgres:5432  # 应该连接失败但能解析 (PG 不是 HTTP)
redis-cli -h redis ping         # 期望: PONG
```

#### Redis Connection Refused

```bash
# 症状: Error: Redis connection to redis:6379 failed - connect ECONNREFUSED

# 诊断步骤:
# 1. Redis 容器是否运行?
docker ps | grep redis

# 2. Redis 是否在同一 network?
docker inspect globalreach-redis --format='{{json .NetworkSettings.Networks}}'

# 3. Redis 内部是否正常?
docker exec globalreach-redis redis-cli ping

# 4. 从 API 容器能否到达 Redis?
docker exec globalreach-api-prod nc -zv redis 6379
```

#### PostgreSQL Connection Timeout

```bash
# 症状: Error: connect ETIMEDOUT or SequelizeConnectionTimeoutError

# 诊断步骤:
# 1. PG 容器状态和健康检查
docker inspect globalreach-postgres --format='{{.State.Health.Status}}'

# 2. PG 最大连接数检查
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "SHOW max_connections;"

# 3. 当前活跃连接数
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';"

# 4. 连接超时配置 (Sequelize 默认 10s，可调整)
# dialectOptions: { connectTimeout: 10000 }
```

---

## Section 4: 数据库问题 (PostgreSQL)

### 4.1 连接池耗尽

**症状:** 日志中出现 `"connection acquire timeout"` 错误

```bash
# 监控活跃连接数 (关键诊断查询)
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT
  state,
  count(*) AS connections,
  min(query_start) AS oldest_query
FROM pg_stat_activity
WHERE datname = 'globalreach_prod'
GROUP BY state
ORDER BY connections DESC;
"

# 当前连接池配置 (Sequelize):
# pool.max: 10 (从原始 20 降低，节省 ~100MB 内存)
# pool.min: 2  (从原始 5 降低)
# pool.acquire: 60000 (获取连接超时: 60s)
# pool.idle: 10000 (空闲连接回收: 10s)

# 查找长时间运行的查询 (可能阻塞连接池)
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes'
ORDER BY duration DESC;
"

# 终止长时间占用连接 (谨慎操作!)
# SELECT pg_terminate_backend(pid) FROM ...;
```

### 4.2 Schema Migration 失败

#### `{alter:true}` 行为与风险

```javascript
// 当前使用的 sync 策略: sequelize.sync({ alter: true })
// ⚠️ 注意: alter: true 的行为:

// ✅ 会执行的操作:
// - 添加新列 (ADD COLUMN)
// - 删除不再存在于 Model 定义的列 (DROP COLUMN) ⚠️ 危险!
// - 修改列类型 (ALTER COLUMN) ⚠️ 可能丢数据!
// - 添加/删除索引

// ❌ 不会执行的操作:
// - 重命名列 (只能 DROP + ADD)
// - 修改表名
// - 数据迁移/转换

// ⚠️ 生产环境强烈建议使用 migrations 替代 sync({alter:true})
// npx sequelize-cli migration:create --name=add_is_active_to_users
```

#### Column Already Exists 错误

```bash
# 症状: 执行 sync({alter:true}) 时报错 "column xxx already exists"
# 原因: Model 定义与数据库 schema 已一致，但 sync 尝试重复添加

# 解决方案 1: 先同步 Model 与 DB schema，再启动
# 解决方案 2: 使用 { force: false } 仅做差异对比
# 解决方案 3: 手动检查并修复不一致
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "\d users"
```

#### 数据丢失预防

```bash
# ⚠️ 在执行任何 schema 变更前，务必备份!

# 自动备份脚本思路:
docker exec globalreach-postgres pg_dump -U globalreach_user -d globalreach_prod \
  --format=custom --file=/tmp/pre_migration_backup.dump

# 从容器复制备份到宿主机
docker cp globalreach-postgres:/tmp/pre_migration_backup.dump ./backups/

# 恢复 (如迁移出错):
docker cp ./backups/pre_migration_backup.dump globalreach-postgres:/tmp/
docker exec globalreach-postgres pg_restore -U globalreach_user -d globalreach_prod --clean /tmp/pre_migration_backup.dump
```

#### 手动 Migration 操作

```bash
# 进入 PostgreSQL 交互式终端
docker exec -it globalreach-postgres psql -U globalreach_user -d globalreach_prod

# 常用手动操作示例:

-- 添加 isActive 列 (对应 L04 Bug 修复)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- 查看表结构
\d users
\d+ users

-- 查看所有索引
\di

-- 查看当前数据库大小
SELECT pg_size_pretty(pg_database_size('globalreach_prod'));

-- 查看各表行数
SELECT relname AS table_name, n_live_tup AS row_count
FROM pg_stat_user_tables ORDER BY n_live_tup DESC;
```

### 4.3 数据损坏 / 不一致性

#### 损坏检测方法

```sql
-- 数据完整性校验查询示例:

-- 1. 检查外键约束违反
SELECT conname, conrelid::regclass
FROM pg_constraint
WHERE contype = 'f'
AND NOT convalidated;

-- 2. 检查 NULL 违反 NOT NULL 约束
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'users'
AND is_nullable = 'NO';

-- 3. 检查重复唯一键
SELECT email, count(*)
FROM users
GROUP BY email
HAVING count(*) > 1;

-- 4. 数据行数合理性检查
SELECT 'users' as tbl, count(*) FROM users
UNION ALL
SELECT 'campaigns', count(*) FROM campaigns
UNION ALL
SELECT 'email_logs', count(*) FROM email_logs;
```

#### pg_dump 恢复流程

```bash
# === 完整备份 ===
docker exec globalreach-postgres pg_dump -U globalreach_user -d globalreach_prod \
  --format=custom --compress=9 \
  --file=/tmp/globalreach_full_$(date +%Y%m%d_%H%M%S).dump

# === 仅数据备份 (不含 schema) ===
docker exec globalreach-postgres pg_dump -U globalreach_user -d globalreach_prod \
  --data-only \
  --file=/tmp/globalreach_data_only.sql

# === 仅 Schema 备份 ===
docker exec globalreach-postgres pg_dump -U globalreach_user -d globalreach_prod \
  --schema-only \
  --file=/tmp/globalreach_schema_only.sql

# === 恢复完整备份 ===
docker exec -i globalreach-postgres psql -U globalreach_user -d globalreach_prod < backup_file.sql
# 或 custom format:
docker exec -i globalreach-postgres pg_restore -U globalreach_user -d globalreach_prod --clean backup_file.dump
```

#### Point-in-Time Recovery (PITR) 概念

> **注意**: PITR 需要 WAL 归档配置，当前生产环境可能未启用。
> 如需启用，请咨询 DBA 并评估存储成本。

```bash
# PITR 前置条件:
# 1. postgresql.conf: wal_level = replica
# 2. archive_mode = on
# 3. archive_command 配置归档目标
# 4. 定期基础备份 (pg_basebackup)

# 恢复到特定时间点的概念步骤:
# 1. 恢复最近的 base backup
# 2. 重放 WAL 到目标时间点
# recovery_target_time = '2026-06-05 14:30:00 CST'
# recovery_target_action = 'promote'
```

---

## Section 5: 认证问题 (关键 - 含真实 Bug 修复!)

> **⚠️ 重要提示**: 本章包含 S081-S086 会话中发现的 **两个真实 Bug** 及其完整修复过程。
> 这些是经过多轮调试、定位、验证后确认的根本性缺陷，具有极高的学习价值。

---

### 🔴 DEFECT-001: Auth Endpoint 超时 (>30秒挂起) — ★★★ 真实 Bug

> **发现会话**: S081-S083 | **严重程度**: P0-Critical | **影响范围**: 全部认证接口

#### 症状描述

```
POST /api/v1/auth/register  →  永久挂起，0 bytes returned
POST /api/v1/auth/login     →  永久挂起，0 bytes returned
POST /api/v1/auth/refresh   →  永久挂起，0 bytes returned
```

客户端表现：
- curl 请求无任何返回，直到超时（默认 120s 或用户设定的 `-m` 参数）
- 浏览器显示 "pending" 状态无限转圈
- **没有任何错误信息返回** — 这是最难排查的特征

#### 根本原因分析

**文件**: `api/middleware/auth.js` — `validateRequest()` 函数

```javascript
// ❌ BUG 代码 (修复前): validateRequest 被定义为 FACTORY FUNCTION
const validateRequest = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map(v => v.run(req))); // ← 致命行
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  };
};
```

**但在路由中被当作 DIRECT MIDDLEWARE 使用（45+ 个路由）:**

```javascript
// ❌ 路由中的错误用法 (缺少调用括号!)
router.post('/register', validateRequest([
  body('email').isEmail(),
  body('password').isLength({ min: 8 })
]), authController.register);

// Express 调用时: validateRequest(req, res, next)
// 此时 validations 参数 = req (整个 request 对象!)
```

**灾难链式反应:**

```
Express 调用 validateRequest(req, res, next)
  ↓
validations = req (request 对象，不是 validation 数组!)
  ↓
validations.map(v => v.run(req))
  ↓
遍历 request 对象的所有属性 (headers, query, body, params, route, ...)
  ↓
对每个属性调用 .run(req) 方法
  ↓
大多数属性没有 .run 方法 → TypeError? 不，更糟:
  ↓
某些属性触发意外的迭代行为 → 无限循环 / 深度递归
  ↓
事件循环完全阻塞 → 整个 API 无响应
```

#### 修复方案

```javascript
// ✅ 修复后代码: 改为 DIRECT MIDDLEWARE
const validateRequest = async (req, res, next) => {
  // 直接检查 validationResult，不做 factory 包装
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};
```

**同时更新路由用法（两种方式均可）:**

```javascript
// 方式 A: 保持原样 (body() 等 validator 会自动将结果存入 request)
router.post('/login', [
  body('email').isEmail(),
  body('password').exists()
], validateRequest, authController.login);  // ← validateRequest 作为纯中间件

// 方式 B: 如果仍想用 factory 模式，必须正确调用
// router.post('/login', validateRequest([body('email').isEmail()]), ...)  ← 加括号!
```

#### 如何诊断此类问题

当遇到"请求永久挂起、无错误返回"的情况时，按以下步骤排查：

```bash
# Step 1: 创建最小化 Express 测试应用
docker exec -it globalreach-api-prod sh
cat > /tmp/debug_app.js << 'EOF'
const express = require('express');
const app = express();
app.use(express.json());

// 测试 1: 无中间件 — 应该正常工作
app.post('/test1', (req, res) => res.json({ ok: true }));

// 测试 2: 有问题的中间件 — 会挂起
const badMiddleware = (validations) => async (req, res, next) => {
  await Promise.all(validations.map(v => v.run(req)));
  next();
};
app.post('/test2', badMiddleware([{run:(r)=>Promise.resolve()}]), (req,res)=>res.json({ok:true}));

app.listen(3999, () => console.log('Debug server on :3999'));
EOF
node /tmp/debug_app.js &

# Step 2: 分别测试两个端点
curl -m 5 -X POST http://localhost:3999/test1 -d '{}'          # ✅ 正常返回
curl -m 5 -X POST http://localhost:3999/test2 -d '{}'          # ❌ 挂起!

# Step 3: 用 --inspect 启动，Chrome DevTools 断点调试
node --inspect /tmp/debug_app.js
# 打开 chrome://inspect 连接，在 middleware 入口处设断点
```

#### 预防措施

| 预防策略 | 说明 |
|---------|------|
| **中间件模式一致性** | Factory 函数必须显式调用 `factory(args)`；直接中间件不要接收多余参数 |
| **单元测试覆盖** | 每个 middleware 必须有独立的 unit test，模拟 Express 调用签名 |
| **Code Review 检查项** | 新增 middleware 时审查 `(req,res,next)` 签名是否匹配定义模式 |
| **ESLint 规则** | 可考虑自定义 rule 检测 `function(x){return function(...args)` 但直接使用的模式 |
| **类型安全** | TypeScript 项目可利用函数重载签名检测此类 misuse |

---

### 🟠 L04: Login 返回 403 ACCOUNT_DISABLED — ★★ 真实 Bug

> **发现会话**: S084-S085 | **严重程度**: P1-High | **影响范围**: 用户登录功能

#### 症状描述

```
POST /api/v1/auth/login
  → 第一次请求: 500 Internal Server Error
  → 第二次请求: 403 Forbidden {"message": "ACCOUNT_DISABLED"}
  → 即使使用完全正确的邮箱和密码也是如此
```

**关键线索**: 错误信息提到 `ACCOUNT_DISABLED`，但系统从未实现过账户禁用功能！

#### 根本原因分析

**双重缺陷组合:**

**缺陷 A — User Model 缺少 `isActive` 列定义**

**文件**: `api/db/index.js` — User 模型定义

```javascript
// ❌ 修复前的 User Model (缺少 isActive 字段)
const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  email: { type: DataTypes.STRING, unique: true, allowNull: false },
  password: { type: DataTypes.STRING, allowNull: false },
  // ... 其他字段 ...
  // ❌ 缺少: isActive 字段!
}, {
  tableName: 'users',
  timestamps: true,
});
```

**缺陷 B — Auth Controller 引用了不存在的字段**

**文件**: `api/routes/auth.js` (或 controller 层)

```javascript
// Auth Controller 中的逻辑 (伪代码):
const login = async (req, res) => {
  const user = await User.findOne({ where: { email } });
  if (!user) return res.status(401).json({ message: 'INVALID_CREDENTIALS' });

  // ← 这里访问了 user.isActive，但该字段不存在于 model 和 DB!
  if (!user.isActive) {
    return res.status(403).json({ message: 'ACCOUNT_DISABLED' });
  }

  // 密码验证...
};
```

**值传播链路断裂:**

```
Database 表 users (无 is_active 列)
  ↓
Sequelize User Model (无 isActive 定义)
  ↓
查询结果: user.isActive = undefined (不是 false，是 undefined!)
  ↓
if (!undefined) → if (true) → 总是进入 ACCOUNT_DISABLED 分支!
  ↓
所有登录请求都被拒绝，无论密码是否正确
```

#### 修复方案

**Step 1: 补充 User Model 定义**

```javascript
// ✅ 修复后的 User Model (api/db/index.js)
const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  email: { type: DataTypes.STRING, unique: true, allowNull: false },
  password: { type: DataTypes.STRING, allowNull: false },
  // ... 其他字段保持不变 ...

  // ✅ 新增: 账户激活状态字段
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,       // 默认新用户为激活状态
    field: 'is_active'        // 映射到数据库列名 snake_case
  },

  // ... 继续其他字段 ...
}, {
  tableName: 'users',
  timestamps: true,
});
```

**Step 2: 修改 Sync 策略以同步 Schema**

```javascript
// ❌ 修复前: db.sync({ alter: false }) — 只创建新表，不修改已有表结构
// ✅ 修复后: db.sync({ alter: true }) — 同步模型变更到已有表

// ⚠️ alter: true 在生产环境有风险！建议改用正式 migration:
await db.sync({ alter: process.env.NODE_ENV === 'development' ? true : false });
// 或者使用 sequelize-cli migration
```

**Step 3: 验证数据库 Schema**

```bash
# 确认 is_active 列已添加
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "\d users"

# 期望输出中包含:
# Column    | Type    | Default
#-----------|---------|----------
# ...
# is_active | boolean | true
```

#### 诊断方法论

```bash
# 当遇到 500/403 交替出现的情况时:

# 1. 查看容器日志中的具体错误栈
docker logs globalreach-api-prod --tail 100 2>&1 | grep -A 10 "Error\|error"

# 2. 检查数据库实际 Schema 与 Model 定义的一致性
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;
"

# 3. 对比 Model 定义的属性列表与 DB 实际列
# 在 Node REPL 中:
docker exec -it globalreach-api-prod node -e "
const db = require('./db');
Object.keys(db.models.User.rawAttributes).forEach(k => console.log(k));
"

# 4. 测试单个字段的读取
docker exec -it globalreach-api-prod node -e "
const { User } = require('./db');
User.findOne({ where: { id: 1 } }).then(u => {
  console.log('isActive:', u?.isActive, typeof u?.isActive);
  console.log('all keys:', Object.keys(u?.toJSON() || {}));
  process.exit(0);
});
"
```

#### 经验教训总结

| 维度 | 教训 |
|------|------|
| **Schema Drift** | Model 定义和数据库 Schema 可能不同步，尤其在 `{alter:false}` 模式下 |
| **Undefined != False** | JavaScript 中 `!undefined === true`，布尔判断要格外小心 |
| **防御性编程** | 访问可能不存在的属性时，应使用 `?? defaultValue` 或显式检查 |
| **错误消息准确性** | "ACCOUNT_DISABLED" 这个错误消息误导了排查方向——应先确保字段存在再抛业务错误 |
| **Migration 策略** | 开发阶段可以用 `sync({alter:true})`，生产环境必须走正式 migration |

---

### 5.3 bcrypt 性能问题

#### 症状

注册/登录操作非常缓慢（>5 秒响应时间），在高并发下更明显。

#### 原因分析

```bash
# bcrypt 的计算复杂度由 saltRounds 控制
# 每增加 1 round，hash 时间翻倍
# round=12: ~250ms/hash (标准安全推荐值)
# round=11: ~125ms/hash
# round=10: ~70ms/hash  ← 当前生产值
# round=9:  ~35ms/hash (最低推荐值)

# 当前环境变量配置:
BCRYPT_ROUNDS=10  # 从初始的 12 降低到 10
```

#### 实际性能测量数据 (容器内)

```
测量环境: Node.js 20 Alpine / Docker / 1 CPU / 512MB 内存限制

bcrypt.hash(password, 10)  →  ~70ms  (可接受)
bcrypt.compare(pass, hash) →  ~134ms (可接受)

对比 round=12:
bcrypt.hash(password, 12)  →  ~280ms (慢 4 倍!)
bcrypt.compare(pass, hash) →  ~520ms (慢 4 倍!)
```

#### 优化措施

```javascript
// 1. 降低 saltRounds (已实施)
const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || '10');

// 2. remove normalizeEmail() — 该函数可能触发 DNS lookup 导致挂起
// 已从注册/登录流程中移除

// 3. 异步哈希 (始终使用)
const hashedPassword = await bcrypt.hash(password, saltRounds);
// 不要用 bcrypt.hashSync() — 它会阻塞事件循环!
```

#### 性能监控

```bash
# 在容器内实时监测 bcrypt 操作耗时
docker exec -it globalreach-api-prod node -e "
const bcrypt = require('bcrypt');
const testPass = 'TestPassword123!';
async function bench() {
  const t0 = Date.now();
  await bcrypt.hash(testPass, 10);
  console.log('Hash time:', Date.now() - t0, 'ms');

  const hash = '\$2b\$10\$...'; // 一个真实的 hash
  const t1 = Date.now();
  await bcrypt.compare(testPass, hash);
  console.log('Compare time:', Date.now() - t1, 'ms');
}
bench();
"
```

---

### 5.4 JWT Token 问题

#### Token 过期处理

```javascript
// 当前配置:
JWT_EXPIRES_IN=24h        // Access Token 有效期: 24 小时
JWT_REFRESH_EXPIRES_IN=7d  // Refresh Token 有效期: 7 天 (如有实现)

// 前端处理策略:
// 1. 收到 401 响应时，尝试用 refresh token 获取新 access token
// 2. refresh 也失败则跳转登录页
// 3. 不要在 localStorage 存储敏感 token (XSS 风险)
// 推荐: HttpOnly Cookie 存储 refresh token
```

#### Refresh Token 轮换

```javascript
// 安全最佳实践: 每次 refresh 后使旧 token 失效
// 防止 token 重放攻击

// 实现要点:
// 1. 存储 token 版本号 (tokenVersion) 在 User 表
// 2. 每次 refresh 成功后 tokenVersion += 1
// 3. 验证时检查 token 中的 version == DB 中的 version
// 4. 不匹配则拒绝 (说明已被轮换过)
```

#### Secret Key 配置

```bash
# ⚠️ JWT_SECRET 必须满足:
# - 至少 32 字符
# - 高熵随机字符串
# - 生产环境绝不能用默认值!
# - 更换 secret 会导致所有已签发 token 立即失效

# 生成安全的 JWT Secret:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 验证当前 secret 强度:
echo $JWT_SECRET | wc -c  # 应 >= 33 (含换行符)
```

#### 容器间时钟偏差 (Clock Skew)

```bash
# JWT 的 exp/nbf 字段依赖系统时间
# 如果 API 容器和客户端时钟偏差过大 (>5min)，会导致:
# - token 提前被认为过期
# - nbf (not before) token 被拒绝

# 检查容器时间同步
docker exec globalreach-api-prod date
docker exec globalreach-postgres date
date  # 宿主机时间

# 确保所有容器使用同一时区 (Dockerfile 中已设置为 Asia/Shanghai)
# Dockerfile: cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
```

---

## Section 6: 性能问题

### 6.1 高内存使用 (>70%)

#### 当前资源配置

| 资源 | 当前值 | 历史值 | 优化效果 |
|------|--------|--------|---------|
| V8 Heap Ceiling (`--max-old-space-size`) | **256 MB** | 384 MB | 节省 128MB |
| Periodic GC Interval | 60 s | 60 s | - |
| DB Pool Max | **10** | 20 | 节省 ~100MB |
| DB Pool Min | **2** | 5 | 节省 ~30MB |
| Container Memory Limit | 512 MB | 512 MB | - |
| Container Memory Reservation | 256 MB | 256 MB | - |

#### 内存诊断命令

```bash
# 实时查看容器内存使用
docker stats globalreach-api-prod --no-stream --format "table {{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}"

# 通过 API health endpoint 查看系统资源 (如果实现了 system_resources 检查)
curl -s http://localhost:3000/api/v1/health | python -m json.tool

# V8 Heap 详情 (需要在容器内启用 --expose-gc)
# Dockerfile CMD 改为: node --expose-gc --max-old-space-size=256 server.js
# 然后在 API 中暴露 heap stats endpoint
```

#### GC 优化配置

```javascript
// 当前启用的周期性 GC (在 server.js 入口处):
if (global.gc) {
  setInterval(() => {
    global.gc();  // 每 60 秒强制执行一次 Full GC
  }, 60000);
}

// ⚠️ --expose-gc 仅用于调试/生产调优!
// 不应在长期生产环境中依赖它作为主要内存管理手段
```

### 6.2 高 CPU 使用

#### Node 事件循环阻塞

```bash
# 症状: API 响应变慢，docker stats 显示 CPU 持续 >80%

# 常见阻塞源:
# 1. 同步文件操作 (fs.readFileSync, fs.readdirSync)
# 2. 大 JSON 序列化/反序列化 (JSON.parse on huge payload)
# 3. 加密操作 (bcrypt.hashSync — 绝对禁止!)
# 4. 正则表达式回溯 (ReDoS)
# 5. ⭐ DEFECT-001 类型的中间件无限循环

# 诊断: 使用 clinic.js 或 node --prof
docker exec -it globalreach-api-prod node --prof server.js
# 运行一段时间后 Ctrl+C，生成 isolate-*.log
# 分析: node --prof-process isolate-*.log | head -50
```

#### Prometheus Scrape 开销

```yaml
# prometheus.yml scrape_interval 配置:
# 当前建议: 15s (平衡精度与开销)
# 过低 (<5s) 会显著增加 API 负载

global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'globalreach-api'
    metrics_path: '/api/v1/metrics'
    static_configs:
      - targets: ['api:3000']
```

#### GC Spike（垃圾回收峰值）

```
GC Spike 特征:
- 内存使用曲线呈锯齿状
- 每隔一段时间 CPU 突然飙升到 100%
- 升降间隔约等于 GC 周期 (当前 60s)

缓解措施:
1. 减少 object 创建频率 (对象池模式)
2. 避免在大循环中创建闭包
3. 监控 heap size 趋势，提前预警
```

### 6.3 慢 API 响应

#### 数据库查询优化

```sql
-- 慢查询检测 (需要 pg_stat_statements 扩展)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 查询 TOP 10 最慢 SQL
SELECT query, calls, total_time, mean_time, rows
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- 常见优化方向:
-- 1. 缺失索引 → CREATE INDEX CONCURRENTLY
-- 2. N+1 查询 → 使用 Sequelize include/eager loading
-- 3. SELECT * → 只选择需要的列 (attributes 选项)
-- 4. 全表扫描 → 添加 WHERE 条件索引
```

#### Redis Cache Miss 分析

```bash
# 监控 Redis 命中率
docker exec globalreach-redis redis-cli info stats | grep -E "(keyspace_misses|keyspace_hits)"

# 计算命中率:
# hit_rate = keyspace_hits / (keyspace_hits + keyspace_misses)
# 目标: > 90%

# 常见 cache miss 原因:
# 1. TTL 设置过短
# 2. key 命名不一致 (前后有空格、大小写等)
# 3. 序列化格式不匹配
# 4. Redis 内存不足导致 eviction
docker exec globalreach-redis redis-cli info memory | grep used_memory_human
```

#### Nginx 缓冲设置

```nginx
# nginx/conf.d/api.conf 优化配置:

location /api/ {
    proxy_pass http://api:3000;

    # 缓冲优化 (防止 slow client 阻塞上游)
    proxy_buffering on;
    proxy_buffer_size 4k;
    proxy_buffers 8 4k;
    proxy_busy_buffers_size 8k;

    # 超时设置
    proxy_connect_timeout 10s;
    proxy_send_timeout 30s;
    proxy_read_timeout 60s;  # ⚠️ 认证接口可能需要更长

    # Keep-alive
    proxy_http_version 1.1;
    proxy_set_header Connection "";
}
```

---

## Section 7: 安全事件

### 7.1 可疑入侵检测

#### 审计日志审查步骤

```bash
# 1. 检查异常登录尝试
docker logs globalreach-api-prod 2>&1 | grep -i "login\|auth\|failed" | tail -100

# 2. 检查异常 IP 的请求频率
docker logs globalreach-nginx-prod 2>&1 | awk '{print $1}' | sort | uniq -c | sort -rn | head -20

# 3. 检查容器内是否有可疑进程
docker exec globalreach-api-prod ps aux

# 4. 检查是否有非预期的新文件
docker diff globalreach-api-prod | grep "^A"

# 5. 检查网络连接
docker exec globalreach-api-prod netstat -tulpn 2>/dev/null || docker exec globalreach-api-prod ss -tulpn
```

#### 容器隔离性检查

```bash
# 确认容器未使用 privileged 模式
docker inspect globalreach-api-prod --format='{{.HostConfig.Privileged}}'
# 期望输出: false

# 确认没有挂载敏感宿主机目录
docker inspect globalreach-api-prod --format='{{json .Mounts}}' | python -m json.tool
# 检查是否有 /etc, /var/run/docker.sock 等危险挂载

# 检查 capabilities
docker inspect globalreach-api-prod --format='{{.HostConfig.CapAdd}} {{.HostConfig.CapDrop}}'
```

#### 凭证轮换程序

```bash
# 当怀疑凭证泄露时的紧急轮换步骤:

# 1. 生成新的 JWT_SECRET
NEW_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")

# 2. 更新 .env 文件中的 JWT_SECRET
# 3. 更新数据库密码 (DB_PASSWORD)
# 4. 更新 Redis 密码 (如果设置了 requirepass)

# 5. 重启所有服务
docker compose -f docker-compose.prod.yml down && docker compose -f docker-compose.prod.yml up -d

# 6. 通知所有用户重新登录 (旧 token 全部失效)
```

### 7.2 SSL/TLS 证书过期

#### 当前证书状态

```
证书类型: 通配符证书 (*.globalreach.com)
颁发机构: (参见证书详情)
有效期至: 2031-06-04
存放路径: ./nginx/ssl/globalreach/
文件命名: cert.pem (证书), key.pem (私钥)
```

#### 证书续期程序

```bash
# 1. 检查剩余有效期
echo | openssl s_client -connect api.globalreach.com:443 -servername api.globalreach.com 2>/dev/null | openssl x509 -noout -enddate

# 2. 设置到期提醒 (建议提前 30 天)
# 可使用 cron + 脚本或 Let's Encrypt 自动续期

# 3. Let's Encrypt 自动续期 (如果使用 certbot)
# 安装: apt-get install certbot
# 续期: certbot renew --dry-run
# 定时任务: 0 0 1 * * certbot renew --quiet --deploy-hook "docker restart globalreach-nginx-prod"

# 4. 手动续期后更新容器
cp new_cert.pem ./nginx/ssl/globalreach/cert.pem
cp new_key.pem ./nginx/ssl/globalreach/key.pem
docker compose -f docker-compose.prod.yml restart nginx
```

#### 证书链验证

```bash
# 完整证书链验证
openssl s_client -connect api.globalreach.com:443 -showcerts </dev/null 2>/dev/null | openssl verify -CAfile /etc/ssl/certs/ca-bundle.crt

# 检查中间证书是否完整
# 正常链: Root CA → Intermediate CA → Server Certificate
# 常见问题: 缺少 Intermediate CA 导致部分客户端报错
```

### 7.3 Rate Limiting 触发

#### 当前限流配置

```javascript
// 当前 Rate Limit 配置:
const rateLimitConfig = {
  windowMs: 15 * 60 * 1000,  // 15 分钟窗口
  max: 10,                    // 每 IP 最多 10 次请求
  message: { success: false, message: 'TOO_MANY_REQUESTS' },
  standardHeaders: true,      // 返回 RateLimit-* headers
  legacyHeaders: false,
};

// 适用范围: /api/v1/auth/* 下的所有端点
// 包括: register, login, logout, refresh, forgot-password, reset-password
```

#### 如何解除合法用户的封锁

```bash
# 方案 1: 等待自动解除 (15 分钟窗口结束后自动重置)

# 方案 2: 如果使用 Redis 存储 rate limit 计数器
# 查看 Redis 中的 rate limit key
docker exec globalreach-redis redis-cli KEYS "*rate*"
docker exec globalreach-redis redis-cli GET "rate_limit:<client_ip>"
# 删除该 key 即可立即解除
docker exec globalreach-redis redis-cli DEL "rate_limit:<client_ip>"

# 方案 3: 调整阈值 (临时)
# 修改代码中的 max 值或 windowMs，然后重新部署
```

#### 调整限流阈值

```javascript
// 根据业务需求调整建议:

// 场景 A: 公网开放注册 (严格)
{ windowMs: 900000, max: 5 }   // 15分钟5次

// 场景 B: 内部企业使用 (宽松)
{ windowMs: 900000, max: 50 }  // 15分钟50次

// 场景 C: 营销活动期间 (临时放宽)
{ windowMs: 900000, max: 100 } // 15分钟100次

// 建议: 将阈值配置化为环境变量
RATE_LIMIT_MAX=${RATE_LIMIT_MAX:-10}
RATE_LIMIT_WINDOW_MS=${RATE_LIMIT_WINDOW_MS:-900000}
```

---

## Section 8: CI/CD 流水线问题

### 8.1 构建失败

#### npm Audit 漏洞

```bash
# 当前漏洞状态 (最近一次扫描):
# 总计: 14 个漏洞
#   - Moderate: 9 个
#   - High:     5 个
#   - Critical: 0 个

# 本地扫描:
cd api && npm audit

# CI 中的审计配置 (ci-cd.yml):
npm audit --audit-level=moderate || true  # 目前仅警告不阻断

# 修复高危漏洞:
npm audit fix                    # 自动修复 (可能破坏兼容性)
npm audit fix --force            # 强制修复 (风险更高)
# 手动: npm update <package-name>

# 建议定期 (每周) 审查并修复 High/Critical 漏洞
```

#### Docker BuildKit 严格性差异

```yaml
# CI/CD 使用 GitHub Actions + BuildKit:
# - 严格的 layer caching 校验
# - 严格的 COPY checksum 验证
# - 严格的 .dockerignore 规则执行

# 本地 Docker Desktop 可能更宽容:
# - 可能使用缓存的旧 layers
# - 可能忽略某些 warning

# 常见 CI 构建失败而本地通过的原因:
# 1. package-lock.json 不同步 → 在 CI 中 npm ci 使用 lock 文件
# 2. Node.js 版本差异 → CI 固定 20.x，本地可能不同
# 3. 平台差异 → CI 是 Linux，本地可能是 Windows/macOS

# 解决: 确保 lock 文件提交且与 package.json 一致
rm -rf node_modules package-lock.json && npm install && git add package-lock.json
```

#### Trivy GHCR Image-Ref 大小写敏感性

```yaml
# ⚠️ Trivy 扫描 GHCR 镜像时，image-ref 必须**全小写**!
# 即使 GitHub repository 名包含大写，也必须转换为小写

# 错误写法 (会导致 image not found):
image-ref: ghcr.io/org/GlobalReach-Project/api:sha-abc123

# 正确写法:
image-ref: ghcr.io/org/globalreach-project/api:sha-abc123

# ci-cd.yml 中的当前配置 (第 229 行):
image-ref: ${{ fromJSON(steps.meta.outputs.json).tags[0] }}
# docker/metadata-action 生成的 tags 已经是小写的 ✓
```

### 8.2 测试失败

#### Unit Test 环境搭建

```yaml
# CI/CD 测试环境 (ci-cd.yml unit-tests job):
services:
  postgres:
    image: postgres:15-alpine
    env:
      POSTGRES_DB: globalreach_test
      POSTGRES_USER: test_user
      POSTGRES_PASSWORD: test_pass
  redis:
    image: redis:7-alpine

env:
  DATABASE_URL: postgresql://test_user:test_pass@localhost:5432/globalreach_test
  REDIS_HOST: localhost
  REDIS_PORT: 6379
  JWT_SECRET: test-secret-key-for-ci-purposes-only-32chars!!
```

#### Test Database 清理

```javascript
// 每个测试套件前后清理数据库的策略:

// 方案 A: 每个测试后 truncate (快但有外键约束问题)
afterEach(async () => {
  await sequelize.truncate({ cascade: true, restartIdentity: true });
});

// 方案 B: 使用事务回滚 (推荐，最干净)
beforeEach(async () => {
  transaction = await sequelize.transaction();
});

afterEach(async () => {
  await transaction.rollback();
});

// 方案 C: 使用独立测试数据库 (CI/CD 当前做法)
// 每次测试运行都是全新的 database
```

#### Flaky Test 识别

```bash
# Flaky Test 特征:
# 1. 同一个测试有时通过有时失败
# 2. 失败通常与执行顺序有关
# 3. 并发运行更容易失败
# 4. 通常涉及异步操作 / 定时器 / 外部依赖

# 诊断命令:
# 多次运行同一个测试文件
npx jest tests/auth.test.js --repeat=5 --verbose

# 检查测试覆盖率变化 (flaky test 往往伴随 coverage 波动)
npx jest --coverage --coverageReporters=text

# 常见 flaky 原因及修复:
# 原因                     | 修复
# ------------------------|------------------
# 异步未 await            | 确保所有 async/await 正确
# 定时器依赖              | 使用 fake timers (jest.useFakeTimers())
# 端口竞争                | 使用 port=0 让 OS 分配
# 测试间数据污染          | 每个测试独立事务
# 外部 API 依赖           | mock 外部依赖
```

---

## Section 9: 应急程序

### 9.1 全系统恢复

**从完全故障恢复到正常运行的标准操作程序 (SOP)**

```
优先级顺序: PostgreSQL → Redis → API → Nginx → Monitoring
```

#### Phase 1: 基础设施恢复 (0-5 分钟)

```bash
# Step 1: 确认 Docker Daemon 运行中
docker info > /dev/null 2>&1 && echo "Docker OK" || echo "Docker DOWN!"

# Step 2: 确认 network 存在
docker network inspect globalreach-project_globalreach-network >/dev/null 2>&1 ||
  docker network create globalreach-project_globalreach-network

# Step 3: 按优先级依次启动
docker compose -f docker-compose.prod.yml up -d postgres redis
```

#### Phase 2: 数据层恢复 (5-15 分钟)

```bash
# Step 4: 等待 PG 就绪
for i in $(seq 1 30); do
  docker exec globalreach-postgres pg_isready -U globalreach_user && break
  sleep 2
done

# Step 5: 验证 PG 数据完整性
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "SELECT count(*) FROM users;"

# Step 6: 验证 Redis
docker exec globalreach-redis redis-cli ping
# 期望: PONG

# Step 7: 如需数据恢复 (详见 4.3 节)
# docker exec -i globalreach-postgres psql ... < latest_backup.sql
```

#### Phase 3: 应用层恢复 (15-25 分钟)

```bash
# Step 8: 启动 API
docker compose -f docker-compose.prod.yml up -d api

# Step 9: 等待 Health Check 通过 (最多 3 分钟)
for i in $(seq 1 18); do
  STATUS=$(curl -sf http://localhost:3000/api/v1/health | grep -o '"status":"[^"]*"')
  echo "[$(date +%H:%M:%S)] Health: $STATUS"
  echo "$STATUS" | grep -q "healthy\|degraded" && break
  sleep 10
done

# Step 10: 启动 Nginx
docker compose -f docker-compose.prod.yml up -d nginx
```

#### Phase 4: 监控恢复 (25-30 分钟)

```bash
# Step 11: 启动监控组件
docker compose -f docker-compose.prod.yml up -d prometheus grafana node-exporter postgres-exporter

# Step 12: 端到端验证
echo "=== 最终验证 ==="
curl -sk -o /dev/null -w "HTTP: %{http_code}\n" http://localhost:80/
curl -sk -o /dev/null -w "HTTPS: %{http_code}\n" https://api.globalreach.com/api/v1/health
curl -s http://localhost:3000/api/v1/health | python -m json.tool
```

#### 恢复检查清单

```
□ Docker Daemon 运行正常
□ globalreach-network 已创建
□ PostgreSQL 容器 running + healthy
□ Redis 容器 running + healthy
□ API 容器 running + healthy (HealthCheck 通过)
□ Nginx 容器 running + healthy
□ Prometheus 可访问 (http://localhost:9090)
□ Grafana 可访问 (http://localhost:3002)
□ HTTPS 端点返回正确响应
□ 认证接口 (login/register) 正常工作
```

### 9.2 数据丢失场景

#### 最后手段恢复选项

| 恢复方式 | RPO (数据丢失容忍) | RTO (恢复时间) | 适用场景 |
|---------|-------------------|---------------|---------|
| 从 pg_dump 恢复 | 最近一次备份至今 | 5-15 分钟 | 表误删/误更新 |
| Point-in-Time Recovery | 取决于 WAL 保留 | 30-60 分钟 | 需要精确时间点 |
| 从 Replica 恢复 | < 1 秒 (如果有同步复制) | 10-30 分钟 | 主库硬件故障 |
| 从冷备恢复 | 每日/每周备份点 | 30-60 分钟 | 完全灾难恢复 |

#### RPO/RTO 目标

```
当前设定:
- RPO (Recovery Point Objective): ≤ 24 小时 (基于每日备份策略)
- RTO (Recovery Time Objective): ≤ 1 小时 (基于 SOP 执行时间)

建议改进:
- RPO: 实施 WAL 归档后可达 ≤ 5 分钟
- RTO: 自动化恢复脚本后可达 ≤ 15 分钟
```

#### 利益相关者通知

```
数据丢失事件通知模板:

【紧急】GlobalReach 数据事件通知

时间: [事件发生时间]
影响范围: [受影响的数据/功能]
当前状态: [正在恢复 / 已恢复 / 恢复中]
预计恢复: [预计完成时间]
用户影响: [是否影响终端用户]

技术负责人: [姓名]
联系方式: [电话/即时通讯]
```

### 9.3 安全 breach 响应

#### 包含步骤

```bash
# === CONTAINMENT (遏制) — 前 15 分钟 ===

# 1. 立即隔离受影响的服务
docker compose -f docker-compose.prod.yml stop api nginx
# 不要直接 delete! 需要保留取证数据

# 2. 截断外部访问 (防火墙层面)
# AWS: security group 移除 inbound rule
# 阿里云: 安全组移除 80/443 端口规则
# iptables: iptables -A INPUT -p tcp --dport 80,443 -j DROP

# 3. 保存现场快照 (Forensics)
mkdir -p /opt/incident-$(date +%Y%m%d_%H%M%S)
docker logs globalreach-api-prod > /opt/incident-*/api_logs.txt
docker logs globalreach-nginx-prod > /opt/incident-*/nginx_logs.txt
docker export globalreach-api-prod > /opt/incident-*/api_container.tar

# === FORENSICS (取证) — 15-60 分钟 ===

# 4. 收集证据
docker diff globalreach-api-prod > /opt/incident-*/filesystem_changes.txt
docker exec globalreach-api-prod ps aux > /opt/incident-*/processes.txt
docker exec globalreach-api-prod netstat -tulpn > /opt/incident-*/network_connections.txt
docker exec globalreach-api-prod cat /proc/*/cmdline 2>/dev/null > /opt/incident-*/all_commands.txt

# 5. 数据库完整性检查
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT count(*) as total_users FROM users;
SELECT max(created_at) as last_registration FROM users;
" > /opt/incident-*/db_snapshot.txt

# === ERADICATION (根除) — 按需 ===

# 6. 凭证全面轮换 (参见 7.1 节)
# 7. 漏洞修复 / 补丁
# 8. 镜像重建并重新部署

# === COMMUNICATION (沟通) — 持续 ===

# 通知层级:
# Level 1: 技术团队 (立即)
# Level 2: 管理层 (30 分钟内)
# Level 3: 用户 (根据影响范围决定)
# Level 4: 监管机构 (如涉及个人数据泄露，72 小时内)
```

---

## Section 10: 命令速查卡

> **一页纸速查参考** — 按类别整理的最常用诊断命令

### 容器管理

```bash
# ===== 容器状态概览 =====
docker compose -f docker-compose.prod.yml ps -a              # 所有服务状态
docker stats --no-stream                                    # 实时资源使用

# ===== 单容器诊断 =====
docker logs globalreach-api-prod --tail 100                 # API 日志
docker logs globalreach-api-prod --since 5m                  # 最近 5 分钟日志
docker logs globalreach-api-prod -f                          # 实时跟踪日志
docker inspect globalreach-api-prod --format='{{.State.Status}} {{.State.Health.Status}}'  # 健康+运行状态
docker inspect globalreach-api-prod --format='{{.State.OOMKilled}}'  # 是否 OOM
docker inspect globalreach-api-prod --format='{{.State.ExitCode}}'   # 退出码

# ===== 容器操作 =====
docker compose -f docker-compose.prod.yml restart api        # 重启 API
docker compose -f docker-compose.prod.yml down && docker compose -f docker-compose.prod.yml up -d  # 全量重启
docker exec -it globalreach-api-prod sh                      # 进入 API 容器
```

### 网络 & 连通性

```bash
# ===== 端口检查 =====
netstat -ano | findstr ":3000 :80 :443 :5432 :6379"         # Windows
ss -tlnp | grep -E "3000|80|443|5432|6379"                  # Linux

# ===== 容器间连通性 =====
docker exec globalreach-api-prod wget -qO- http://postgres:5432 2>&1 | head -1
docker exec globalreach-api-prod nc -zv redis 6379
docker exec globalreach-nginx-prod wget -qO- http://api:3000/api/v1/health

# ===== 外部访问测试 =====
curl -m 5 -s http://localhost:3000/api/v1/health             # HTTP 直连 API
curl -m 5 -sk https://api.globalreach.com/api/v1/health     # HTTPS 通过域名
curl -m 5 -I https://globalreach.com                         # 前端站点
```

### PostgreSQL 诊断

```bash
# ===== 连接检查 =====
docker exec globalreach-postgres pg_isready -U globalreach_user -d globalreach_prod

# ===== 进入交互终端 =====
docker exec -it globalreach-postgres psql -U globalreach_user -d globalreach_prod

# ===== 常用监控查询 =====
# 活跃连接数
SELECT count(*) FROM pg_stat_activity WHERE state = 'active';
# 连接数按状态分组
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;
# 表大小排行
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) as size
  FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;
# 长时间运行的查询
SELECT pid, now() - query_start as duration, query
  FROM pg_stat_activity WHERE (now() - query_start) > interval '5 minutes';
# 锁等待
SELECT blocked_locks.pid AS blocked_pid, blocking_locks.pid AS blocking_pid
  FROM pg_catalog.pg_locks blocked_locks
  JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype;
```

### Redis 诊断

```bash
# ===== 基础检查 =====
docker exec globalreach-redis redis-cli ping                   # 连通性
docker exec globalreach-redis redis-cli info server            # 服务器信息
docker exec globalreach-redis redis-cli info memory            # 内存使用
docker exec globalreach-redis redis-cli info stats             # 统计信息
docker exec globalreach-redis redis-cli dbsize                 # key 总数

# ===== 常用操作 =====
docker exec globalreach-redis redis-cli KEYS "*"               # 列出所有 key (慎用大数据集)
docker exec globalreach-redis redis-cli FLUSHALL              # ⚠️ 清空所有数据!
docker exec globalreach-redis redis-cli MONITOR                # 实时监控所有命令
```

### 监控 & 指标

```bash
# ===== Prometheus =====
curl -s http://localhost:9090/api/v1/targets | python -m json.tool  # targets 状态
curl -s http://localhost:9090/api/v1/alerts                        # 活跃告警

# ===== Grafana =====
# 访问: http://localhost:3000 (映射到宿主机 3002)
# 默认账号: admin / admin123 (生产环境务必修改!)

# ===== 自定义指标端点 =====
curl -s http://localhost:3000/api/v1/health                       # 健康检查
curl -s http://localhost:3000/api/v1/metrics                      # Prometheus 指标
```

### 认证专项 (含 Bug 回顾!)

```bash
# ===== DEFECT-001 验证: 认证接口是否响应 =====
curl -m 10 -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test123456"}'
# ✅ 正常: 返回 JSON (即使 credentials 错误也应该返回错误信息)
# ❌ DEFECT-001: 永久挂起，0 bytes returned

# ===== L04 验证: 登录是否返回正确错误码 =====
# 期望: 401 INVALID_CREDENTIALS (密码错误时)
# ❌ L04 Bug: 500 → 403 ACCOUNT_DISABLED (即使密码正确)

# ===== bcrypt 性能基准测试 =====
docker exec -it globalreach-api-prod node -e "
const bcrypt = require('bcrypt');
const t0 = Date.now();
bcrypt.hash('BenchmarkPass!', 10).then(() => console.log('Hash:', Date.now()-t0,'ms'));
"

# ===== JWT 配置验证 =====
docker exec globalreach-api-prod printenv | grep JWT
# 确认 JWT_SECRET 长度 >= 32 字符
```

### 一键全套诊断脚本

```bash
# 将以下内容保存为 diagnose.sh，一键执行全部诊断
#!/bin/bash
echo "=== GlobalReach V2.0 全套诊断 ==="
echo ""
echo "[1/8] Docker 状态:"
docker compose -f docker-compose.prod.yml ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || echo "Compose 文件未找到"
echo ""
echo "[2/8] 容器健康检查:"
for c in globalreach-api-prod globalreach-postgres globalreach-redis globalreach-nginx-prod; do
  status=$(docker inspect $c --format='{{.State.Health.Status}}' 2>/dev/null || echo "N/A")
  echo "  $c: $status"
done
echo ""
echo "[3/8] 端口监听:"
for p in 3000 80 443 5432 6379 9090 3002; do
  result=$(netstat -tlnp 2>/dev/null | grep ":$p " | head -1 || echo "not listening")
  echo "  Port $p: $result"
done
echo ""
echo "[4/8] PostgreSQL:"
docker exec globalreach-postgres pg_isready -U globalreach_user 2>/dev/null && echo "  PG: OK" || echo "  PG: FAIL"
echo ""
echo "[5/8] Redis:"
docker exec globalreach-redis redis-cli ping 2>/dev/null && echo "  Redis: OK" || echo "  Redis: FAIL"
echo ""
echo "[6/8] API Health:"
curl -sf http://localhost:3000/api/v1/health 2>/dev/null && echo "  API: OK" || echo "  API: UNREACHABLE"
echo ""
echo "[7/8] 内存使用:"
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}" 2>/dev/null | grep globalreach
echo ""
echo "[8/8] 最近错误日志:"
docker logs globalreach-api-prod --tail 5 2>&1 | grep -i "error\|fail" || echo "  No recent errors"
echo ""
echo "=== 诊断完成 ==="
```

---

## 附录: 服务架构速览

```
┌─────────────────────────────────────────────────────────────────┐
│                    GlobalReach V2.0 架构                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐               │
│   │  Nginx   │────▶│   API    │────▶│PostgreSQL│               │
│   │  :80/:443│     │  :3000   │     │  :5432   │               │
│   └──────────┘     └────┬─────┘     └──────────┘               │
│                         │                                       │
│                         ▼                                       │
│                   ┌──────────┐                                  │
│                   │  Redis   │                                  │
│                   │  :6379   │                                  │
│                   └──────────┘                                  │
│                                                                  │
│   ┌────────────┐  ┌──────────┐  ┌────────────────┐             │
│   │ Prometheus │  │ Grafana  │  │ Node Exporter  │             │
│   │  :9090     │  │  :3002   │  │ (Host Metrics) │             │
│   └────────────┘  └──────────┘  └────────────────┘             │
│                                                                  │
│   Network: globalreach-project_globalreach-network (external)    │
│   Total Services: 8                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 附录: 真实 Bug 索引

| Bug ID | 名称 | 发现会话 | 严重度 | 状态 | 所在章节 |
|--------|------|---------|--------|------|---------|
| **DEFECT-001** | Auth Endpoint Timeout (中间件工厂模式误用) | S081-S083 | P0-Critical | ✅ 已修复 | [Section 5.1](#defect-001-auth-endpoint-超时-30秒挂起--★★★-真实-bug) |
| **L04** | Login Returns 403 ACCOUNT_DISABLED (Model 缺字段) | S084-S085 | P1-High | ✅ 已修复 | [Section 5.2](#l04-login-返回-403-account_disabled--★★-真实-bug) |

---

> **文档维护说明**: 本指南应随每次版本发布更新。新增 Bug 修复时，请在 Section 5 添加新条目并在附录索引表中登记。
>
> **反馈渠道**: 如发现文档错误或有补充建议，请通过项目 Issue Tracker 提交。
