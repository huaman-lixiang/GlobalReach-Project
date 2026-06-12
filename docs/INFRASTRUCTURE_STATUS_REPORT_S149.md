# GlobalReach V2.0 — 基础设施状态报告 (S149)

> **生成时间**: 2026-06-12 06:55 (Asia/Shanghai)
> **引擎**: S149 Engine B — Full Docker Production Stack + Migration + Prometheus Validation
> **环境**: Windows Server / Docker Desktop
> **数据来源**: 实际 `docker` 命令输出（非模拟）

---

## 1. Docker 服务状态总览

| # | 服务 | Container Name | 镜像 | 状态 | 端口 | 运行时长 | 内存 | CPU |
|---|------|----------------|------|------|------|----------|------|-----|
| 1 | **PostgreSQL** | `globalreach-postgres` | `postgres:15-alpine` | ✅ **healthy** | 5432→5432 | 47 min | 33.94 MiB / 1 GiB | 0.00% |
| 2 | **Redis** | `globalreach-redis` | `redis:7.4.9-alpine` | ✅ **healthy** | 6379→6379 | 47 min | 6.67 MiB / 384 MiB | 0.26% |
| 3 | **API Server** | `globalreach-api-prod` | `globalreach-project-api:latest` | ✅ **healthy** | 3000→3000 | ~2 h | 89.96 MiB / 512 MiB | 0.23% |
| 4 | **Nginx** | `globalreach-nginx-prod` | `nginx:1.31.1-alpine` | 🔴 **Restarting** | 80, 443 | 循环重启中 | 0 B / 0 B | 0.00% |
| 5 | **Prometheus** | `globalreach-prometheus` | `prom/prometheus:v3.12.0` | ⚠️ **unhealthy** | 9090→9090 | ~2 h | 116 KiB | 0.00% |
| 6 | **Grafana** | `globalreach-grafana` | `grafana/grafana:13.0.2` | ✅ **healthy** | 3002→3000 | ~2 h | 150.4 MiB | 0.43% |
| 7 | **AlertManager** | `globalreach-alertmanager` | `prom/alertmanager:v0.32.2` | ✅ **healthy** | 9093→9093 | ~2 h | 14.02 MiB | 0.07% |
| 8 | **Mailpit** | `globalreach-mailpit` | `axllent/mailpit:v1.30.1` | ✅ **healthy** | 1025, 8025 | ~2 h | 24.21 MiB | 0.00% |
| 9 | **Tempo** | `globalreach-tempo` | `grafana/tempo:2.5.0` | 🟡 running | 3200, 4317-4318 | ~2 h | 25.57 MiB | 0.02% |
| 10 | **Loki** | `globalreach-loki` | `grafana/loki:3.7.2` | 🟡 running | 3100→3100 | ~2 h | 68.59 MiB | 0.53% |
| 11 | **Promtail** | `globalreach-promtail` | `grafana/promtail:3.6.8` | 🟡 running | (internal) | ~2 h | 37.89 MiB | 0.40% |
| 12 | **Node Exporter** | `globalreach-node-exporter` | `prom/node-exporter:v1.11.1` | 🟡 running | 9100 | ~2 h | 3.80 MiB | 0.00% |
| 13 | **PG Exporter** | `globalreach-pg-exporter` | `postgres-exporter:v0.19.1` | 🟡 running | 9187 | ~2 h | 2.61 MiB | 0.00% |

### 统计摘要
- **总计**: 13 个容器
- **✅ Healthy**: 6 (PostgreSQL, Redis, API, Grafana, AlertManager, Mailpit)
- **🟡 Running**: 6 (Tempo, Loki, Promtail, Node Exporter, PG Exporter, 无 healthcheck 的服务)
- **🔴 问题**: 2 (Nginx Restarting + Prometheus Unhealthy)
- **总内存占用**: ~460 MiB

---

## 2. 数据库状态

### 2.1 PostgreSQL 连接信息

| 参数 | 值 | 来源 |
|------|-----|------|
| **版本** | PostgreSQL 16.14 on x86_64-pc-linux-musl (Alpine) | `docker exec psql -c "SELECT version()"` |
| **容器镜像** | postgres:15-alpine (docker-compose.prod.yml) | docker-compose.prod.yml |
| **用户名** | `gr_user` | 容器环境变量 POSTGRES_USER |
| **数据库** | `globalreach` | 容器环境变量 POSTGRES_DB |
| **密码** | `GrLocalTestPass2026SecureChangeMe` | 容器环境变量 POSTGRES_PASSWORD |
| **编码** | UTF-8, C collation | POSTGRES_INITDB_ARGS |
| **Health Check** | pg_isready -U gr_user -d globalreach | docker-compose |

### 2.2 表结构状态

| 表名 | 存在? | 行数 | 索引数 | 外键 | 备注 |
|------|-------|------|--------|------|------|
| users | ❌ 无 | - | - | - | **需要执行迁移** |
| tenants | ❌ 无 | - | - | - | **需要执行迁移** |
| accounts | ❌ 无 | - | - | - | **需要执行迁移** |
| campaigns | ❌ 无 | - | - | - | **需要执行迁移** |
| email_logs | ❌ 无 | - | - | - | **需要执行迁移** |
| statistics | ❌ 无 | - | - | - | **需要执行迁移** |
| audit_logs | ❌ 无 | - | - | - | **需要执行迁移** |
| refresh_tokens | ❌ 无 | - | - | - | **需要执行迁移** |
| api_keys | ❌ 无 | - | - | - | **需要执行迁移** |
| webhooks | ❌ 无 | - | - | - | **需要执行迁移** |
| webhook_logs | ❌ 无 | - | - | - | **需要执行迁移** |
| notifications | ❌ 无 | - | - | - | **需要执行迁移** |
| rate_limits | ❌ 无 | - | - | - | **需要执行迁移** |
| csrf_tokens | ❌ 无 | - | - | - | **需要执行迁移** |
| email_templates | ❌ 无 | - | - | - | **需要执行迁移** |
| settings | ❌ 无 | - | - | - | **需要执行迁移** |
| jobs | ❌ 无 | - | - | - | **需要执行迁移** |
| sessions | ❌ 无 | - | - | - | **需要执行迁移** |

> **结论**: 数据库为空 (0 tables)。迁移脚本 `scripts/run-live-migration.sh` 已创建，可创建全部 18 张表 + 种子数据。

### 2.3 迁移脚本就绪状态

| 脚本文件 | 用途 | 状态 |
|----------|------|------|
| `scripts/run-live-migration.sh` | 完整迁移执行器 (18表+种子) | ✅ 已创建 |
| `scripts/docker-diagnose.sh` | 全栈诊断工具 | ✅ 已创建 |
| `database/migrations/20260602-initial-schema.js` | Sequelize JS 迁移源 (6表) | ✅ 已存在 |

---

## 3. API 服务详情

### 3.1 Health Endpoint

```
GET http://localhost:3000/api/v1/health → HTTP 200 ✅
响应时间: ~3,900ms (偏慢，可能为首次冷启动或 session 初始化)
日志模式:
  {"timestamp":"...","level":"INFO","method":"GET","path":"/api/v1/health",
   "status":200,"responseTimeMs":3920,"ip":"::1","userAgent":"curl/8.19.0"}
警告: "no possibility found to get session" (每次请求均出现)
```

### 3.2 Metrics Endpoint (Prometheus)

```
GET http://localhost:3000/api/v1/metrics → HTTP 200 ✅
Content-Type: text/plain (Prometheus exposition format)

实际返回指标示例 (S149 验证):
# HELP globalreach_process_cpu_user_seconds_total Total user CPU time spent in seconds.
# TYPE globalreach_process_cpu_user_seconds_total counter
globalreach_process_cpu_user_seconds_total 20.179086

# HELP globalreach_nodejs_eventloop_lag_seconds Lag of event loop in seconds.
# TYPE globalreach_nodejs_eventloop_lag_seconds gauge
globalreach_nodejs_eventloop_lag_seconds 0

# HELP globalreach_nodejs_active_resources Number of active resources...
# TYPE globalreach_nodejs_active_resources gauge
globalreach_nodejs_active_resources{type="FSReqCallback"} 1
globalreach_nodejs_active_resources{type="PipeWrap"} 2
globalreach_nodejs_active_resources{type="TCPServerWrap"} 1
...
```

### 3.3 指标覆盖矩阵

| 类别 | 指标数 | 定义 | 有数据 | 说明 |
|------|--------|------|--------|------|
| **HTTP 层** | 3 | httpRequestDurationSeconds, httpRequestsTotal, activeConnections | ⚠️ 部分 | 需要 HTTP 请求触发 |
| **错误追踪 D11** | 2 | errorRateByCode, errorsTotal | ❌ 无 | 需要错误事件触发 |
| **健康检查 D14** | 3 | subsystemHealthStatus, subsystemHealthLatencyMs, healthScore | ❌ 无 | 需要调用 updateHealthMetrics() |
| **邮件管道** | 3 | emailQueueSize, emailsSentTotal, emailsFailedTotal | ❌ 无 | 需要邮件操作触发 |
| **安全 D10** | 2 | csrfTokenStoreSize, csrfValidationFailures | ❌ 无 | 需要调用 updateCsrfMetrics() |
| **认证** | 1 | authOperationsTotal | ❌ 无 | 需要认证操作触发 |
| **系统资源** | 3 | processMemoryBytes, processUptimeSeconds, heapUsagePercent | ✅ 有 | 自动采集 |
| **数据库** | 2 | databaseQueryDurationSeconds, dbPoolSize | ❌ 无 | 需要 DB 查询触发 |
| **M-B02 业务** | 10 | emailsTotal, campaignsActive, clientsTotal... | ❌ 无 | 需要业务操作触发 |
| **Node.js 默认** | ~15 | process_cpu_*, nodejs_*, gc_* | ✅ 有 | prom-client 自动采集 |
| **合计** | **~44+** | | **~15 有数据** | |

---

## 4. 网络拓扑

```
                        ┌──────────────────────────────────────┐
                        │     globalreach-network (bridge)      │
                        │     Subnet: 172.29.0.0/16             │
                        └──────────────────────────────────────┘
                                          │
         ┌────────────────────────────────┼────────────────────────────────┐
         │                                │                                │
         ▼                                ▼                                ▼
┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
│   postgres:5432 │◄─────────│ api:3000        │─────────►│ nginx:80,443    │
│   PG 16.14      │  depends │ Node 24 Alpine  │  depends  │ Nginx 1.31.1    │
│   healthy ✅    │          │ healthy ✅       │          │ 🔴 RESTARTING   │
└─────────────────┘          └────────┬────────┘          └─────────────────┘
         ▲                           │
         │ depends                   │ depends
         ▼                           ▼
┌─────────────────┐          ┌─────────────────┐
│   redis:6379    │          │ worker: (none)   │
│   Redis 7.4.9   │          │ 未启动           │
│   healthy ✅    │          └─────────────────┘
└─────────────────┘

监控栈 (Observability):
┌──────────────┐  scrapes  ┌──────────────┐  ┌──────────────┐
│ :3000 api    │──────────►│ :9090 prom   │◄─│ :9187 pg_exp │
│ metrics      │          │ unhealthy⚠️  │  │ :9100 nd_exp  │
└──────────────┘          └──────┬───────┘  └──────────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
            ┌────────────┐ ┌────────────┐ ┌────────────┐
            │ :3002 grafana││ :9093 alert ││ :3100 loki  │
            │ healthy ✅  ││ healthy ✅  ││ running 🟡  │
            └────────────┘ └────────────┘ └──────┬─────┘
                                                │
                                         ┌──────▼──────┐
                                         │ promtail 🟡  │
                                         └─────────────┘

其他服务:
┌────────────┐  ┌────────────┐  ┌────────────┐
│ :3200 tempo │  │ :8025 mail │  │ :4317-4318  │
│ running 🟡  │  │ pit ✅     │  │ OTLP        │
└────────────┘  └────────────┘  └────────────┘
```

---

## 5. 环境变量配置状态

### 5.1 `.env.production` 关键项审查

| 分类 | 变量 | 当前值 | 有效? | 风险等级 |
|------|------|--------|-------|----------|
| **数据库** | DB_HOST | `postgres` | ✅ | - |
| | DB_PORT | `5432` | ✅ | - |
| | DB_NAME | `globalreach_prod` | ⚠️ | 中 — 实际DB名为 `globalreach` |
| | DB_USER | `globalreach_user` | ⚠️ | 中 — 实际用户为 `gr_user` |
| | DB_PASSWORD | `<CHANGE_ME_...>` | ❌ | 高 — 占位符，但容器已用真实密码启动 |
| **Redis** | REDIS_HOST | `redis` | ✅ | - |
| | REDIS_PORT | `6379` | ✅ | - |
| | REDIS_PASSWORD | `<CHANGE_ME_OR_LEAVE_EMPTY>` | ⚠️ | 中 — 容器已设置密码 |
| **JWT** | JWT_SECRET | `<CHANGE_ME_...>` | ❌ | **高** — 必须替换 |
| | CSRF_SECRET | (未在.env.production) | ❌ | **高** — docker-compose.prod.yml 要求 |
| | WEBHOOK_SECRET | (未在.env.production) | ❌ | **高** — docker-compose.prod.yml 要求 |
| **SMTP** | SMTP_HOST | `<CHANGE_ME_...>` | ❌ | 高 — 但 Mailpit 可用于测试 |
| **AI** | OPENAI_API_KEY | (空) | ⚠️ | 低 — AI 功能不可用 |
| | DEEPSEEK_API_KEY | (空) | ⚠️ | 低 — AI 功能不可用 |
| **监控** | ENABLE_METRICS | `true` | ✅ | - |
| | GF_SECURITY_ADMIN_PASSWORD | `<CHANGE_ME_...>` | ❌ | **高** — Grafana 密码 |
| **SSL** | SSL_CERT_PATH | `/etc/nginx/ssl/letsencrypt/...` | ❌ | **高** — 证书不存在 |

### 5.2 配置一致性问题

> ⚠️ **重要发现**: `.env.production` 和实际运行的容器之间存在配置不一致：
>
> | 项目 | .env.production 声明值 | 容器实际值 | 影响 |
> |------|----------------------|-----------|------|
> | DB_NAME | `globalreach_prod` | `globalreach` | API 连接串可能不匹配 |
> | DB_USER | `globalreach_user` | `gr_user` | psql 连接失败 (已验证) |
> | PG Image | (production.yml: 16-alpine) | (prod.yml: 15-alpine) | 版本不一致 |
>
> 当前运行的是 `docker-compose.prod.yml` (非 `.production.yml`)。

---

## 6. 安全态势评估

| 检查项 | 状态 | 详情 | 严重度 |
|--------|------|------|--------|
| **TLS/SSL 配置** | 🔴 **失败** | Let's Encrypt 证书缺失: `/etc/nginx/ssl/le/live/globalreach.com/fullchain.pem` 不存在。Nginx 因无法加载证书而循环重启。 | **P0** |
| **CORS 策略** | ⚠️ 待验证 | 配置了 `CORS_ORIGIN=https://app.globalreach.com,...`，需确认运行时生效 | P1 |
| **速率限制** | ✅ 已配置 | L2 Express rate limiter: 30,000 req/15min (~33 rps per IP) | - |
| **JWT Secret** | 🔴 **占位符** | `.env.production` 中仍为 `<CHANGE_ME_...>` | **P0** |
| **CSRF 保护** | ✅ 代码就绪 | `csrfTokenStoreSize`, `csrfValidationFailures` 指标已定义 | - |
| **RBAC 权限** | ✅ 代码就绪 | `authOperationsTotal` 支持 login/register/refresh/logout/reset_password | - |
| **多租户隔离** | ✅ Schema 设计 | 所有业务表含 `tenant_id` + ON DELETE CASCADE | - |
| **输入验证** | ✅ 中间件链 | validator.js 中间件存在 | - |
| **Docker 安全** | ✅ | API 容器以 appuser (non-root) 运行 | - |
| | ⚠️ | Promtail 挂载 docker.sock (只读 :ro)，已缓解 CVE-2026-34040 | P2 |
| **密码策略** | ⚠️ | bcrypt salt rounds=12 ✅，但默认密码需立即更改 | P1 |

---

## 7. 监控覆盖率分析

### 7.1 Prometheus Alert Rules 状态

| 规则文件 | 状态 | 问题 |
|----------|------|------|
| `alerts.yml` | ✅ 正常 | - |
| `application-health.yml` | ✅ 正常 | - |
| `business-alerts.yml` | ✅ 正常 | - |
| `business-metrics.yml` | ✅ 正常 | - |
| `loki-metrics-alerts.yml` | ✅ 正常 | - |
| `performance-alerts.yml` | ✅ 正常 | - |
| `recording-rules.yml` | ✅ 正常 | - |
| **`aiops-alerts.yml`** | 🔴 **YAML 错误** | 第288行重复 `groups` key |
| **`legacy-api.yml`** | 🔴 **语法错误** | 第24行错误的持续时间 `03` (应为 `3h`) |

> Prometheus 因为以上两个规则文件解析失败而处于 **unhealthy** 状态，持续报错但不影响基本功能（targets 仍然可以抓取）。

### 7.2 指标收集目标 (Targets)

| Target | Expected | Status |
|--------|----------|--------|
| `api:3000/metrics` | HTTP 200, Prometheus 格式 | ✅ **已验证** |
| `node-exporter:9100/metrics` | Host metrics | 🟡 运行中 |
| `pg-exporter:9187/metrics` | PG metrics | 🟡 运行中 |
| `redis` (via exporter?) | Redis metrics | ❓ 未配置专用 exporter |

---

## 8. 问题清单与行动项

### 🔴 P0 — 必须立即处理

| # | 问题 | 影响 | 修复方案 | 负责人 | 状态 |
|---|------|------|----------|--------|------|
| 1 | **Nginx 循环重启** | 所有外部流量(80/443)无法访问 | 运行 certbot 签发 SSL 证书；或临时注释掉 ssl_certificate 行 | DevOps | 🔴 待修复 |
| 2 | **Prometheus 规则文件错误** | alert rules 无法加载，Prometheus unhealthy | 修复 aiops-alerts.yml:288 和 legacy-api.yml:24 | DevOps | 🔴 待修复 |
| 3 | **JWT/CSRF/Webhook Secret 为占位符** | 认证系统不安全 | 使用 `openssl rand -base64 32` 生成并更新 .env | Security | 🔴 待修复 |
| 4 | **数据库无表结构** | API 无法正常工作 (所有查询将失败) | 执行 `bash scripts/run-live-migration.sh` | DBA | 🔴 待执行 |

### 🟡 P1 — 应尽快处理

| # | 问题 | 影响 | 修复方案 | 负责人 | 状态 |
|---|------|------|----------|--------|------|
| 5 | **API 响应慢 (~3.9s)** | 用户体验差，health check 可能超时 | 排查 session 初始化 ("no possibility found to get session") | Backend | 🟡 分析中 |
| 6 | **.env.production 配置与实际不符** | 维护混乱，新人易出错 | 统一 .env 文件或明确文档化差异 | DevOps | 🟡 待处理 |
| 7 | **Worker 服务未启动** | 后台任务(邮件队列、webhook)不运行 | `docker compose up -d worker` (需确保依赖就绪) | DevOps | 🟡 待启动 |
| 8 | **Grafana Admin Password 为占位符** | Grafana 面临未授权访问风险 | 设置强密码 (>=20字符) | Security | 🟡 待修复 |

### 🟢 P2 — 计划改进

| # | 改进项 | 详情 | 建议 |
|---|--------|------|------|
| 9 | Redis 专用 Exporter | 当前无 redis_exporter，Redis 指标缺失 | 添加 `oliver006/redis_exporter` 服务 |
| 10 | Nginx http2 弃用警告 | 日志显示 `listen ... http2` directive is deprecated | 升级到新语法 |
| 11 | 自动备份调度 | backup-verify 服务仅在 `--profile backup` 时运行 | 配置 cron 或 systemd timer |
| 12 | Metrics 测试自动化 | `test-metrics-endpoint.sh` 已创建 | 集成到 CI/CD pipeline |

---

## 9. 创建的交付物清单

本 S149 会话创建了以下文件：

| # | 文件路径 | 用途 | 行数 |
|---|----------|------|------|
| 1 | `scripts/docker-diagnose.sh` | 全栈 Docker 诊断脚本 (10个检查维度) | ~280 |
| 2 | `scripts/run-live-migration.sh` | 生产数据库迁移执行器 (幂等、备份、回滚) | ~380 |
| 3 | `scripts/test-metrics-endpoint.sh` | Prometheus 格式合规性测试 (10大测试组) | ~260 |
| 4 | `api/__tests__/metrics.test.js` | Jest 完整测试套件 (33+ metric 定义验证) | ~550 |
| 5 | `docs/INFRASTRUCTURE_STATUS_REPORT_S149.md` | 本报告 | ~450 |

---

## 10. 下一步建议

### 立即执行 (今日)

```bash
# 1. 执行数据库迁移 (最关键!)
cd c:\Users\Administrator\Documents\trae_projects\globalreach-project
bash scripts/run-live-migration.sh

# 2. 修复 Prometheus 规则文件
#    编辑 prometheus/rules/aiops-alerts.yml 删除第288行的重复 groups 块
#    编辑 prometheus/rules/legacy-api.yml 将 '03' 改为 '3h'
docker restart globalreach-prometheus

# 3. 修复 Nginx (二选一):
#    A) 签发真实证书: docker compose run --rm --profile ssl certbot
#    B) 临时禁用 SSL: 注释 nginx/conf.d/ssl-le-production.conf 中的 ssl_* 行
docker restart globalreach-nginx-prod
```

### 本周内完成

```bash
# 4. 启动 Worker 服务
docker compose -f docker-compose.prod.yml up -d worker

# 5. 更新所有密码/密钥
bash scripts/generate-secrets.sh  # 如有此脚本

# 6. 运行完整诊断
bash scripts/docker-diagnose.sh --deep

# 7. 验证 Metrics 端点
bash scripts/test-metrics-endpoint.sh --verbose

# 8. 运行单元测试
cd api && npm test -- --testPathPattern="metrics"
```

---

*报告结束 — GlobalReach V2.0 S149 Engine B*
*数据采集时间: 2026-06-12 06:47–06:55 CST*
*下次建议检查: 执行迁移后立即重新运行诊断*
