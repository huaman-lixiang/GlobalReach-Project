# GlobalReach V2.0 — 自动化巡检引擎 (Automated Inspection Engine)

> **O03: 自动化巡检引擎** | 版本: 1.0.0 | 最后更新: 2026-06-09

---

## 📋 目录

1. [概述与目标](#1-概述与目标)
2. [系统架构](#2-系统架构)
3. [核心组件详解](#3-核心组件详解)
4. [五大巡检维度规格](#4-五大巡检维度规格)
5. [阈值配置体系](#5-阈值配置体系)
6. [运行模式说明](#6-运行模式说明)
7. [输出格式规范](#7-输出格式规范)
8. [与现有监控系统的关系](#8-与现有监控系统的关系)
9. [集成方案](#9-集成方案)
10. [扩展指南](#10-扩展指南)
11. [安全考量](#11-安全考量)
12. [故障排查](#12-故障排查)
13. [性能优化](#13-性能优化)
14. [附录](#14-附录)

---

## 1. 概述与目标

### 1.1 项目背景

GlobalReach V2.0 作为企业级邮件营销平台，由 **13个容器** 组成的复杂微服务架构。随着系统规模的增长，传统的手动运维检查已经无法满足以下需求：

- **实时性要求**: 系统健康状态需要持续监控，而非定期人工检查
- **全面性需求**: 跨越基础设施、应用、安全、数据、监控五大层面的综合评估
- **可追溯性**: 历史巡检数据用于趋势分析和容量规划
- **自动化**: 减少人工干预，降低运维成本和人为错误

### 1.2 核心目标

| 目标 | 描述 | 优先级 |
|------|------|--------|
| **全面性** | 覆盖所有关键子系统和依赖组件 | P0 |
| **自动化** | 无需人工干预的定时巡检能力 | P0 |
| **可视化** | 直观的报告展示和趋势分析 | P1 |
| **集成性** | 与 Prometheus/Grafana/AlertManager 无缝对接 | P1 |
| **安全性** | 只读操作，不修改任何生产环境配置 | P0 |
| **兼容性** | 支持 Windows (Git Bash/WSL2) 和 Linux 环境 | P1 |

### 1.3 设计原则

#### 1.3.1 只读原则 (Read-Only Principle)

巡检引擎严格遵循**只读操作**原则：

```
✅ 允许的操作:
   - docker ps / docker stats (查看状态)
   - curl GET 请求 (探测服务)
   - SQL SELECT 查询 (读取数据库元数据)
   - redis-cli INFO/PING (查看Redis状态)
   - 文件读取 (检查备份文件、证书等)

❌ 禁止的操作:
   - docker restart (重启容器)
   - SQL UPDATE/DELETE (修改数据)
   - redis-cli FLUSHALL (清空缓存)
   - 文件写入/修改 (修改配置)
   - systemctl start/stop (管理系统服务)
```

#### 1.3.2 幂等性原则 (Idempotency)

多次执行相同巡检应产生一致的结果。每次巡检都是独立的快照，不会产生副作用。

#### 1.3.3 最小权限原则 (Least Privilege)

巡检脚本仅使用必要的最小权限：
- 不需要 root/administrator 权限（除非检查系统级指标）
- Docker 访问使用标准 docker 命令（非 socket 直接访问）
- 数据库连接使用只读用户（如果可用）

### 1.4 适用场景

| 场景 | 使用方式 | 频率 |
|------|----------|------|
| **日常运维** | `--daemon` 定时巡检 | 每6小时 |
| **发布前检查** | `--quick` 快速验证 | 按需 |
| **CI/CD流水线** | `--json` JSON输出 | 每次部署 |
| **故障排查** | `--dimension data` 定向排查 | 按需 |
| **合规审计** | `--report --output ./audit/` 审计报告 | 每月 |
| **值班监控** | REST API + Grafana Dashboard | 实时 |

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                    GlobalReach 自动化巡检引擎                        │
│                         (O03 Architecture)                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────┐    ┌──────────────┐    ┌──────────────────────────┐  │
│  │  触发器    │───▶│  采集引擎    │───▶│      分析引擎            │  │
│  │ Trigger   │    │  Collector  │    │     Analyzer             │  │
│  └───────────┘    └──────────────┘    └──────────────────────────┘  │
│       │                  │                       │                 │
│       │  Cron/Scheduler  │  Shell Commands        │  Score Calc     │
│       │  REST API        │  HTTP Requests         │  Threshold      │
│       │  Manual          │  DB Queries            │  Comparison     │
│       ▼                  ▼                       ▼                 │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                      报告生成器                              │   │
│  │                    Report Generator                         │   │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │   │
│  │  │ Terminal │  │   JSON   │  │   HTML   │  │  Webhook    │  │   │
│  │  │ Output  │  │  Format  │  │  Report  │  │  Notify     │  │   │
│  │  └─────────┘  └──────────┘  └──────────┘  └─────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     存储层                                   │   │
│  │                   Storage Layer                             │   │
│  │  reports/inspection/YYYY/MM/DD/INS-*.json                    │   │
│  │  reports/inspection/YYYY/MM/DD/INS-*.html                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流 Pipeline

```
[触发] → [采集] → [分析] → [评分] → [输出] → [存储] → [通知]
  │        │       │       │       │        │        │
  │        │       │       │       │        │        ├──▶ Webhook (可选)
  │        │       │       │       │        │        └──▶ 日志文件
  │        │       │       │       │        └──▶ reports/
  │        │       │       │       └──▶ 分数计算
  │        │       │       └──▶ 阈值比较
  │        │       └──▶ 结果解析
  │        └──▶ 命令执行
  └──▶ 手动/API/Cron
```

### 2.3 组件职责

| 组件 | 技术实现 | 职责 |
|------|----------|------|
| **触发器 (Trigger)** | Cron / Windows Task Scheduler / REST API | 控制巡检启动时机 |
| **采集引擎 (Collector)** | Bash commands, curl, docker CLI | 从各子系统收集原始数据 |
| **分析引擎 (Analyzer)** | Shell script logic | 解析数据并与阈值比较 |
| **评分系统 (Scorer)** | 加权算法 | 将各维度结果聚合为总分 |
| **报告生成器 (Reporter)** | Template rendering | 多格式输出 (Terminal/JSON/HTML) |
| **存储层 (Storage)** | File system | 持久化历史记录 |
| **通知器 (Notifier)** | Webhook POST | 异常告警推送 |

### 2.4 文件结构

```
GlobalReach-Project/
├── scripts/
│   ├── health-inspection.sh           # 🔧 核心巡检脚本 (主入口)
│   ├── schedule-inspection.ps1        # ⏰ Windows Task Scheduler 注册
│   └── templates/
│       └── inspection-report.html     # 📄 HTML 报告模板
├── api/
│   └── routes/
│       └── inspection.js              # 🌐 REST API 路由
├── reports/
│   └── inspection/                    # 📁 巡检报告存储目录
│       ├── 2026/
│       │   ├── 06/
│       │   │   ├── 09/
│       │   │   │   ├── INS-20260609-180000.json
│       │   │   │   └── INS-20260609-180000.html
│       │   │   └── ...
│       │   └── ...
│       └── ...
├── docs/
│   └── AUTOMATED_INSPECTION_ENGINE.md # 📘 本文档
└── docker-compose.prod.yml            # 🐳 服务定义参考
```

---

## 3. 核心组件详解

### 3.1 核心巡检脚本 (`health-inspection.sh`)

#### 3.1.1 脚本特性

```bash
#!/usr/bin/env bash
# 特性清单:
✅ set -euo pipefail (严格错误处理)
✅ 跨平台兼容 (Windows Git Bash / WSL2 / Linux)
✅ 彩色终端输出 (自动检测交互式环境)
✅ JSON 输出模式 (--json for CI/CD)
✅ 可配置阈值 (环境变量覆盖)
✅ 维度过滤 (--dimension)
✅ 报告生成 (--report)
✅ 守护进程模式 (--daemon)
✅ 进度条可视化
✅ 详细的诊断和建议信息
```

#### 3.1.2 全局变量设计

```bash
# 运行模式控制
MODE="full"                    # full | quick | json | daemon | report
TARGET_DIMENSION=""            # 空=全量 或指定维度名

# 结果收集
declare -a RESULTS=()          # 所有检查结果数组
declare -a FAILURES=()         # 失败项详情
declare -a WARNINGS=()         # 警告项详情

# 维度统计 (关联数组)
declare -A DIM_SCORES=()       # 各维度分数
declare -A DIM_TOTALS=()       # 各维度总检查数
declare -A DIM_PASSES=()       # 各维度通过数
declare -A DIM_WARNS=()        # 各维度警告数
declare -A DIM_FAILS=()        # 各维度失败数
```

#### 3.1.3 关键函数说明

| 函数 | 用途 | 参数 |
|------|------|------|
| `add_result()` | 记录单个检查项结果 | dimension, name, status, message [, diagnosis, suggestion] |
| `generate_terminal_report()` | 生成终端格式报告 | 无 |
| `generate_json_report()` | 生成JSON格式报告 | 无 |
| `save_report()` | 保存报告到文件系统 | output_dir |
| `calculate_scores()` | 计算各维度和总体分数 | 无 |
| `http_request()` | HTTP请求辅助函数 | url, timeout, method |
| `parse_json_field()` | 安全JSON字段提取 | json_str, field |

### 3.2 HTML报告模板 (`inspection-report.html`)

#### 3.2.1 技术栈

- **纯前端实现**: HTML + CSS + JavaScript (无框架依赖)
- **响应式设计**: 支持桌面端和移动端浏览
- **打印优化**: `@media print` 样式支持PDF导出
- **动态渲染**: JavaScript从JSON数据生成DOM元素

#### 3.2.2 主要组件

```html
<!-- 1. 分数仪表盘 (SVG圆环进度) -->
<div class="score-gauge-container">
    <div class="score-circle">
        <svg> <!-- 渐变圆环 --> </svg>
        <div class="score-value">85%</div>
    </div>
</div>

<!-- 2. 维度分数条 -->
<div class="dimension-bars">
    <div class="dimension-item">
        <span>D1 基础设施</span>
        <div class="bar" style="width: 100%">100%</div>
    </div>
</div>

<!-- 3. 详细结果表格 -->
<table>
    <thead><tr><th>检查项</th><th>状态</th><th>详情</th></tr></thead>
    <tbody id="table-infrastructure"><!-- 动态生成 --></tbody>
</table>

<!-- 4. 失败/警告详情卡片 -->
<div class="detail-card detail-fail">
    <div class="detail-diagnosis">诊断信息...</div>
    <div class="detail-suggestion">建议操作...</div>
</div>
```

#### 3.2.3 数据加载策略

模板支持三种数据源（按优先级）:

1. **内嵌JSON** (推荐): 脚本替换 `{{INSPECTION_JSON}}` 占位符
2. **URL参数**: `?json=<encoded_json>` (适合小数据量)
3. **示例数据**: 用于模板预览和开发调试

### 3.3 Windows调度器 (`schedule-inspection.ps1`)

#### 3.3.1 功能矩阵

| 功能 | 命令参数 | 说明 |
|------|----------|------|
| 注册任务 | 默认执行 | 创建Windows计划任务 |
| 更新任务 | `-Force` | 强制更新已有任务 |
| 移除任务 | `-Remove` | 注销计划任务 |
| 查看状态 | `-Status` | 显示任务信息和最近报告 |
| 自定义间隔 | `-Interval 1800` | 设置巡检间隔(秒) |
| 快速模式 | `-Quick` | 启用快速检查模式 |
| 配置Webhook | `-WebhookUrl URL` | 异常通知地址 |

#### 3.3.2 任务配置

```powershell
# 默认配置值
$TaskName = "GlobalReach-Inspection-O03"
$Interval = 21600          # 6小时 (秒)
$RetentionDays = 30         # 保留30天报告
$ReportDir = "./reports/inspection"

# Windows Task Scheduler 设置
$principal = SYSTEM (最高权限)
$settings = {
    AllowStartIfOnBatteries = true
    ExecutionTimeLimit = 1小时
    RestartCount = 3次
    RestartInterval = 5分钟
}
```

### 3.4 REST API接口 (`inspection.js`)

#### 3.4.1 API端点一览

| 方法 | 路径 | 功能 | 认证 |
|------|------|------|------|
| `GET` | `/api/v1/inspection/last` | 获取最近一次巡检结果 | ✅ |
| `GET` | `/api/v1/inspection/history` | 历史巡检记录列表 | ✅ |
| `POST` | `/api/v1/inspection/trigger` | 手动触发巡检 | ✅ + Rate Limit |
| `GET` | `/api/v1/inspection/trends` | 巡检趋势数据 | ✅ |
| `GET` | `/api/v1/inspection/stats` | 聚合统计数据 | ✅ |

#### 3.4.2 数据流示例

```
Client → GET /api/v1/inspection/last
  ↓
Router: scanInspectionFiles()
  ↓
File System: reports/inspection/2026/06/09/INS-*.json
  ↓
Parse: extractSummary(data)
  ↓
Response: { success: true, data: {...}, meta: {...} }
```

#### 3.4.3 安全措施

- **路径验证**: `isPathSafe()` 防止目录遍历攻击
- **速率限制**: Trigger端点60秒冷却期
- **超时控制**: 脚本执行120秒超时
- **缓冲区限制**: 1MB输出缓冲区防止内存溢出

---

## 4. 五大巡检维度规格

### 4.1 D1: 基础设施层 (Infrastructure)

**目标**: 确保底层运行环境的稳定性和资源充足性

| # | 检查项 | 采集方法 | 通过标准 | 权重 |
|---|--------|----------|----------|------|
| I1 | Docker Daemon | `docker info` | exit code 0 | 高 |
| I2 | 容器健康状态 | `docker compose ps` | ≥12/13 Up | 关键 |
| I3 | CPU使用率 | `/proc/stat` or `docker stats` | < 80% 平均 | 中 |
| I4 | 内存使用率 | `free -m` or `/proc/meminfo` | < 85% | 关键 |
| I5 | 磁盘使用率 | `df -h /` | < 85% | 高 |
| I6 | 网络连通性 | `ping localhost` | 延迟 < 10ms | 中 |
| I7 | Docker网络 | `docker network inspect` | 正常 | 低 |
| I8 | Docker版本 | `docker version` | 信息展示 | 信息 |

**典型失败场景**:
- Docker守护进程崩溃 → I1 FAIL
- 容器OOM Kill → I2 WARN + I4 FAIL
- 磁盘日志爆满 → I5 FAIL
- DNS解析异常 → I6 FAIL

**诊断建议映射**:

```bash
# I1 FAIL
诊断: "Docker daemon未运行或权限不足"
建议: "sudo systemctl start docker"

# I2 WARN (部分容器宕机)
诊断: "可能影响系统功能"
建议: "docker compose -f docker-compose.prod.yml ps 查看详情"

# I4 FAIL (内存耗尽)
诊断: "可能导致OOM Kill"
建议: "释放内存或增加swap空间"
```

### 4.2 D2: 应用层 (Application)

**目标**: 验证业务应用的可访问性和响应性能

| # | 检查项 | 采集方法 | 通过标准 | 权重 |
|---|--------|----------|----------|------|
| A1 | API可达性 | `curl localhost:3000/api/v1/health` | HTTP 200 | 关键 |
| A2 | API响应时间 | `curl -w %{time_total}` | < 500ms | 高 |
| A3 | Health Score | 解析 /health JSON | >= 80 | 高 |
| A4 | Redis连接 | `redis-cli ping` | PONG | 高 |
| A5 | Nginx状态 | `curl localhost:443` | 200/301/302 | 中 |
| A6 | Prometheus目标 | `/api/v1/targets` | >90% up | 中 |
| A7 | DB连接池 | health endpoint | active < max*0.8 | 中 |
| A8 | Email队列 | health endpoint | healthy | 低 |
| A9 | M7/M8引擎 | health endpoint | healthy/not_configured | 低 |

**API Health Endpoint 结构** (来自 `api/routes/health.js`):

```json
{
  "status": "healthy",
  "healthScore": { "score": 85, "totalChecks": 5 },
  "checks": {
    "database": { "status": "healthy", "latencyMs": 12 },
    "redis": { "status": "healthy", "details": { "response": "PONG" } },
    "engine": { "status": "not_configured" },
    "email_queue": { "status": "healthy" },
    "system_resources": { "status": "degraded", "memoryStatus": "warning" }
  }
}
```

### 4.3 D3: 安全层 (Security)

**目标**: 检测潜在的安全风险和配置缺陷

| # | 检查项 | 采集方法 | 通过标准 | 权重 |
|---|--------|----------|----------|------|
| S1 | TLS证书有效性 | `openssl s_client` / 文件存在 | 有效 > 30天 | 关键 |
| S2 | 开放端口扫描 | `netstat/ss` | 仅预期端口 | 高 |
| S3 | 敏感信息检查 | grep .env 文件 | 无明显弱密码 | 高 |
| S4 | JWT Secret强度 | 检查长度 | >= 32字符 | 关键 |
| S5 | Rate Limiter | 高频请求测试 | 429 响应生效 | 中 |
| S6 | HTTPS强制跳转 | curl http://80 | 重定向到HTTPS | 中 |

**预期端口白名单**:

```bash
EXPECTED_PORTS=(
    3000   # API
    80     # HTTP
    443    # HTTPS
    9090   # Prometheus
    3002   # Grafana (映射)
    9093   # AlertManager
    9100   # Node Exporter
    9630   # PG Exporter
    3100   # Loki
    3200   # Tempo
    8025   # Mailpit Web UI
    1025   # Mailpit SMTP
    6379   # Redis (内部)
    5432   # PostgreSQL (内部)
)
```

**已知例外处理**:
- Phase L Blocked: TLS证书缺失 → 标记为WARN而非FAIL
- SSL证书问题导致Nginx 443不可达 → 尝试 `-sk` 跳过验证后判断

### 4.4 D4: 数据层 (Data)

**目标**: 确保数据持久化层的健康和数据安全

| # | 检查项 | 采集方法 | 通过标准 | 权重 |
|---|--------|----------|----------|------|
| D1 | PG连接数 | `docker exec psql` | < max*0.8 | 高 |
| D2 | PG数据库大小 | `pg_size_pretty()` | 有增长但不过快 | 低 |
| D3 | 最近备份 | find backup dir | < 24h | 关键 |
| D4 | Redis内存 | `redis-cli info memory` | < maxmemory*0.8 | 高 |
| D5 | Redis Key数量 | `redis-cli dbsize` | 合理范围 | 低 |
| D6 | 备份完整性 | SHA256校验 | 与MANIFEST匹配 | 高 |
| D7 | PG表数量 | information_schema | >0 | 信息 |

**备份目录搜索顺序**:

```bash
backup_dirs=(
    "$PROJECT_ROOT/backups"           # 项目本地备份
    "$PROJECT_ROOT/data/backups"      # 数据目录备份
    "/opt/globalreach/backups"        # 系统级备份
)
```

**SHA256校验流程**:

```
1. 查找最新备份文件
2. 提取 MANIFEST.txt 中的校验和 (如有)
3. 计算 sha256sum 当前文件
4. 比较:
   - 匹配 → PASS
   - 不匹配 → FAIL (可能损坏或篡改)
   - 无校验文件 → WARN (无法验证)
```

### 4.5 D5: 监控层 (Monitoring)

**目标**: 验证监控系统本身的可用性和正确性

| # | 检查项 | 采集方法 | 通过标准 | 权重 |
|---|--------|----------|----------|------|
| M1 | Prometheus运行 | `curl :9090/-/healthy` | HTTP 200 | 关键 |
| M2 | Grafana运行 | `curl :3001/:3002/api/health` | HTTP 200 | 高 |
| M3 | AlertManager运行 | `curl :9093/-/healthy` | HTTP 200 | 高 |
| M4 | Loki就绪 | `curl :3100/ready` | HTTP 200 | 中 |
| M5 | 活跃告警数 | `/api/v1/alerts` | < 10 | 中 |
| M6 | 规则加载状态 | `/api/v1/rules` | 无ERROR规则 | 高 |
| M7 | NodeExporter | `curl :9100/metrics` | HTTP 200 | 低 |
| M8 | Tempo可达性 | `curl :3200` | 200/307/404 | 低 |

**Prometheus Targets 解析逻辑**:

```python
# 伪代码: 解析targets API响应
data = requests.get('http://localhost:9090/api/v1/targets').json()
targets = data['data']['activeTargets']

up_count = sum(1 for t in targets if t['health'] == 'up')
total_count = len(targets)
up_ratio = up_count / total_count * 100

if up_ratio >= 90:  # PROMETHEUS_UP_RATIO
    status = "PASS"
else:
    status = "WARN"
```

**特殊处理**:
- Grafana端口映射: 主机3002 → 容器3000
- Tempo根路径返回404是正常的（无内容）
- Loki distroless镜像无curl，只能外部探测

---

## 5. 阈值配置体系

### 5.1 阈值变量一览

| 变量名 | 默认值 | 说明 | 环境变量格式 |
|--------|--------|------|--------------|
| `CPU_THRESHOLD` | 80 | CPU使用率上限 (%) | `INSPECT_CPU_THRESHOLD` |
| `MEMORY_THRESHOLD` | 85 | 内存使用率上限 (%) | `INSPECT_MEMORY_THRESHOLD` |
| `DISK_THRESHOLD` | 85 | 磁盘使用率上限 (%) | `INSPECT_DISK_THRESHOLD` |
| `API_RESPONSE_TIME_MS` | 500 | API响应时间上限 (ms) | `INSPECT_API_RESPONSE_MS` |
| `HEALTH_SCORE_MIN` | 80 | 最低健康评分 | `INSPECT_HEALTH_SCORE_MIN` |
| `TLS_DAYS_WARNING` | 30 | TLS证书警告天数 | `INSPECT_TLS_DAYS` |
| `PG_CONN_RATIO` | 0.8 | PG连接数比例上限 | `INSPECT_PG_CONN_RATIO` |
| `REDIS_MEM_RATIO` | 0.8 | Redis内存比例上限 | `INSPECT_REDIS_MEM_RATIO` |
| `BACKUP_MAX_AGE_HOURS` | 24 | 备份最大年龄(小时) | `INSPECT_BACKUP_AGE_HOURS` |
| `PROMETHEUS_UP_RATIO` | 0.9 | Prometheus targets up比例 | `INSPECT_PROM_UP_RATIO` |
| `MAX_ALERT_COUNT` | 10 | 最大活跃告警数 | `INSPECT_MAX_ALERTS` |
| `NETWORK_LATENCY_MS` | 10 | 网络延迟上限(ms) | `INSPECT_NET_LATENCY_MS` |

### 5.2 阈值自定义方法

#### 方法一: 环境变量 (推荐)

```bash
# Linux/Mac
export INSPECT_CPU_THRESHOLD=90
export INSPECT_MEMORY_THRESHOLD=90
./scripts/health-inspection.sh

# Windows PowerShell
$env:INSPECT_CPU_THRESHOLD=90
bash scripts/health-inspection.sh
```

#### 方法二: 配置文件 (未来支持)

```yaml
# config/inspection-thresholds.yml (规划中)
thresholds:
  infrastructure:
    cpu_percent: 80
    memory_percent: 85
    disk_percent: 85
  application:
    api_response_time_ms: 500
    health_score_min: 80
  security:
    tls_days_warning: 30
    jwt_min_length: 32
  data:
    pg_conn_ratio: 0.8
    backup_max_age_hours: 24
  monitoring:
    prometheus_up_ratio: 0.9
    max_alert_count: 10
```

#### 方法三: 命令行参数 (未来扩展)

```bash
# 规划中: 支持直接传入阈值
./scripts/health-inspection.sh \
    --threshold cpu=90 \
    --threshold memory=90 \
    --threshold api-response=1000
```

### 5.3 阈值调优指南

| 场景 | 建议调整 | 原因 |
|------|----------|------|
| **开发环境** | 降低阈值至70% | 开发机资源有限 |
| **高负载生产** | CPU阈值提升至90% | 业务峰值容忍度高 |
| **合规审计** | TLS_DAYS_WARNING提升至90天 | 提前预警 |
| **小规模部署** | MAX_ALERT_COUNT降至5 | 更敏感的告警 |
| **测试环境** | BACKUP_MAX_AGE_HOURS放宽至168h | 测试环境无需频繁备份 |

---

## 6. 运行模式说明

### 6.1 全量模式 (Full Mode) — 默认

```bash
./scripts/health-inspection.sh
# 或
./scripts/health-inspection.sh --mode full
```

**特点**:
- 执行所有5大维度的全部40+检查项
- 生成完整的终端报告
- 预计耗时: 15-30秒 (取决于网络延迟)

**适用场景**: 日常例行巡检、首次运行、深度诊断

### 6.2 快速模式 (Quick Mode)

```bash
./scripts/health-inspection.sh --quick
```

**特点**:
- 仅执行关键检查项 (P0级别)
- 跳过耗时操作 (如完整端口扫描)
- 安全层简化为基本检查
- 预计耗时: 5-10秒

**快速模式执行的检查项**:
- ✅ Docker Daemon 状态
- ✅ 容器健康状态
- ✅ API可达性
- ✅ API响应时间
- ✅ Redis连接
- ✅ Prometheus/Grafana/AlertManager 健康检查
- ⏭️ 跳过: 端口扫描、TLS证书详细检查、备份完整性等

### 6.3 JSON模式 (CI/CD Integration)

```bash
./scripts/health-inspection.sh --json
```

**输出示例**:

```json
{
  "inspectionId": "INS-20260609-180000",
  "timestamp": "2026-06-09T18:00:00+08:00",
  "mode": "json",
  "overall": {
    "score": 85,
    "total": 40,
    "pass": 34,
    "warn": 5,
    "fail": 1
  },
  "dimensions": { ... },
  "results": [ ... ],
  "failures": [ ... ],
  "warnings": [ ... ]
}
```

**适用场景**:
- CI/CD 流水线质量门禁
- 自动化测试脚本调用
- 第三方系统集成
- 日志聚合平台采集

**退出码约定**:
```
0 = 全部通过 (或仅有WARN)
1 = 存在FAIL项 (阻断部署)
2 = 内部错误 (脚本bug)
```

### 6.4 维度定向模式

```bash
./scripts/health-inspection.sh --dimension infrastructure
./scripts/health-inspection.sh --dimension application
./scripts/health-inspection.sh --dimension security
./scripts/health-inspection.sh --dimension data
./scripts/health-inspection.sh --dimension monitoring

# 缩写也支持
./scripts/health-inspection.sh --dimension infra
```

**适用场景**: 故障排查时的定向检查

### 6.5 报告生成模式

```bash
./scripts/health-inspection.sh --report --output ./reports/

# 同时指定其他选项
./scripts/health-inspection.sh --report --output ./audit/ --quick
```

**生成的文件结构**:

```
./reports/
└── inspection/
    └── 2026/
        └── 06/
            └── 09/
                ├── INS-20260609-180000.json   # 原始数据
                └── INS-20260609-180000.html   # 可视化报告
```

**自动清理**: 超过30天的旧报告会被自动删除

### 6.6 守护进程模式 (Daemon Mode)

```bash
# 每1小时巡检一次
./scripts/health-inspection.sh --daemon --interval 3600

# 每6小时巡检一次 (默认)
./scripts/health-inspection.sh --daemon

# 配合报告保存
./scripts/health-inspection.sh --daemon --interval 3600 --report --output ./reports/
```

**行为特点**:
- 循环执行直到手动终止 (Ctrl+C)
- 每次循环输出完整报告
- 自动保存到指定目录 (如果有 `--output`)
- 异常时发送Webhook通知 (如果配置了 `INSPECTION_WEBHOOK_URL`)

**Webhook通知格式**:

```http
POST {INSPECTION_WEBHOOK_URL}
Content-Type: application/json

{ <完整的巡检JSON报告> }
```

**停止守护进程**:
```bash
Ctrl+C  # 或 kill <pid>
```

---

## 7. 输出格式规范

### 7.1 终端输出格式

```
╔══════════════════════════════════════════════════╗
║  GlobalReach 自动化巡检报告                      ║
║  时间: 2026-06-09 18:00:00 UTC+8                ║
║  巡检ID: INS-20260609-180000                    ║
║  模式: FULL                                     ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║  📊 总览: ████████░░ 85% (34/40 通过)            ║
║       ✅ 34 PASS │ ⚠️ 5 WARN │ ❌ 1 FAIL         ║
║                                                  ║
║  D1 基础设施: ██████████ 100% (8/8) ✅           ║
║  D2 应用层:   ████████░░ 78% (7/9) ⚠️           ║
║  D3 安全层:   ████████░░ 75% (4/6) ⚠️           ║
║  D4 数据层:   █████████░ 88% (7/8) ⚠️           ║
║  D5 监控层:   ██████████ 95% (8/8) ✅            ║
║                                                  ║
╚══════════════════════════════════════════════════╝

[FAIL] D2-API响应时间: 1200ms > 500ms threshold
  → 诊断: 可能DB查询慢或GC压力
  → 建议: 检查慢查询日志, 查看 metrics.js 输出

[WARN] D3-TLS证书: 证书文件不存在 (已知: Phase L Blocked)
[WARN] D4-PG备份: 最后备份 26h 前 (>24h threshold)
```

### 7.2 JSON Schema

```typescript
interface InspectionResult {
  // 元数据
  inspectionId: string;          // "INS-20260609-180000"
  timestamp: string;             // ISO 8601 格式
  mode: "full" | "quick" | "json";
  gitHead: string;               // Git commit hash

  // 时间范围
  duration: {
    start: string;
    end: string;
  };

  // 总体评分
  overall: {
    score: number;               // 0-100
    total: number;               // 总检查项数
    pass: number;                // 通过数
    warn: number;                // 警告数
    fail: number;                // 失败数
    error: number;               // 错误数
  };

  // 各维度评分
  dimensions: {
    infrastructure: DimensionScore;
    application: DimensionScore;
    security: DimensionScore;
    data: DimensionScore;
    monitoring: DimensionScore;
  };

  // 详细结果列表
  results: InspectionItem[];

  // 失败/警告汇总
  failures: string[];
  warnings: string[];
}

interface DimensionScore {
  score: number;                 // 0-100
  total: number;
  pass: number;
  warn: number;
  fail: number;
}

interface InspectionItem {
  dimension: string;             // "infrastructure" | ...
  name: string;                  // "Docker Daemon"
  status: "pass" | "warn" | "fail" | "error";
  message: string;               // 人类可读描述
  diagnosis?: string;            // 问题诊断
  suggestion?: string;           // 修复建议
}
```

### 7.3 评分算法

```python
def calculate_dimension_score(passes, warns, fails, total):
    """
    维度评分算法:
    - PASS = 100分
    - WARN = 70分
    - FAIL = 0分
    - 最终得分 = 加权平均
    """

    if total == 0:
        return 0

    weighted_sum = passes * 100 + warns * 70 + fails * 0
    score = weighted_sum / total

    return round(score)


def calculate_overall_score(dimensions):
    """
    总体评分算法:
    - 各维度等权重的平均值
    - 可选: 对关键维度(infrastructure, application)加权
    """

    scores = [d.score for d in dimensions.values()]
    overall = sum(scores) / len(scores)

    return round(overall)
```

**分数等级对照表**:

| 分数范围 | 等级 | 颜色 | 含义 |
|----------|------|------|------|
| 90-100 | ✨ 优秀 | 绿色 | 系统完全健康 |
| 70-89 | 👍 良好 | 蓝色 | 轻微问题但不影响运行 |
| 50-69 | ⚠️ 注意 | 黄色 | 存在需要关注的问题 |
| 0-49 | ❌ 危急 | 红色 | 严重问题需立即处理 |

---

## 8. 与现有监控系统的关系

### 8.1 Prometheus vs 巡检引擎

| 维度 | Prometheus | 巡检引擎 (Inspection Engine) |
|------|------------|------------------------------|
| **定位** | 实时指标采集与告警 | 定期健康检查与报告 |
| **数据类型** | 数值时间序列 | 结构化检查结果 (PASS/WARN/FAIL) |
| **粒度** | 秒级采样 | 小时级/按需执行 |
| **关注点** | 趋势、容量、异常检测 | 配置正确性、连通性、完整性 |
| **输出** | Grafana Dashboard | 终端报告/JSON/HTML |
| **主动性** | 被动接收metrics | 主动探测各子系统 |
| **适用场景** | 性能分析、容量规划 | 发布检查、合规审计、故障诊断 |

### 8.2 互补关系图

```
                    ┌─────────────────┐
                    │   运维全景视图    │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
    │  Prometheus  │  │  Inspection │  │   Logs      │
    │  (实时指标)  │  │  (定期巡检)  │  │   (Loki)    │
    └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
           │                │                │
           ▼                ▼                ▼
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
    │   Grafana   │  │  HTML Report│  │   Promtail  │
    │  Dashboard  │  │  (可视化)    │  │  (日志采集)  │
    └─────────────┘  └─────────────┘  └─────────────┘
           │                │
           ▼                ▼
    ┌─────────────────────────────────┐
    │         AlertManager             │
    │    (统一告警路由与通知)           │
    └─────────────────────────────────┘
```

### 8.3 数据重叠与差异化

**重叠区域** (两者都能检测):
- 服务可用性 (HTTP状态码)
- 资源使用率 (CPU/内存)
- 容器健康状态

**巡检引擎独有**:
- TLS证书有效期检查
- 配置文件语法验证
- 备份完整性校验
- JWT密钥强度检测
- 端口扫描
- 环境变量安全审计

**Prometheus独有**:
- QPS/延迟百分位数趋势
- 错误率时间序列
- 自定义业务指标
- 容量预测 (基于历史数据)

### 8.4 集成建议

不要用巡检引擎替代 Prometheus，而是作为补充:

```yaml
# 推荐的监控架构:
实时监控层 (Prometheus + Grafana):
  - 1分钟粒度的指标采集
  - 实时Dashboard
  - 自动化告警规则
  - 趋势预测

定期巡检层 (Inspection Engine):
  - 每6小时全量检查
  - 发布前快速验证
  - 月度合规报告
  - 配置漂移检测

统一告警层 (AlertManager):
  - 汇聚两个来源的告警
  - 智能去重和抑制
  - 多通道通知 (邮件/Webhook/钉钉)
```

---

## 9. 集成方案

### 9.1 与 Grafana 集成

#### 方案A: JSON Data Plugin (推荐)

1. 安装 Grafana Simple JSON Data Source 插件
2. 配置数据源指向 Inspection API
3. 创建 Dashboard 使用趋势数据

```json
// Grafana Data Source Configuration
{
  "type": "marcusolsson-json-datasource",
  "url": "http://localhost:3000/api/v1/inspection",
  "access": "proxy"
}
```

#### 方案B: 嵌入iframe

在 Grafana Panel 中嵌入 HTML 报告:

```html
<iframe src="/reports/inspection/latest.html" width="100%" height="800"></iframe>
```

### 9.2 与 AlertManager 集成

#### 触发条件

当巡检发现 **FAIL** 级别问题时，可通过 Webhook 通知 AlertManager:

```yaml
# alertmanager.yml (添加路由)
route:
  receiver: 'inspection-webhook'
  routes:
  - match:
      source: inspection-engine
    receiver: inspection-alerts
    continue: true

receivers:
- name: 'inspection-alerts'
  webhook_configs:
  - url: 'http://localhost:9093/api/v2/alerts'
    send_resolved: true
```

#### 告警格式转换

巡检引擎的 JSON 结果转换为 AlertManager 格式:

```javascript
// 伪代码: 转换函数
function convertToAlertmanagerAlerts(inspectionResult) {
  const alerts = [];

  for (const failure of inspectionResult.failures) {
    alerts.push({
      labels: {
        alertname: 'InspectionFailure',
        severity: 'critical',
        dimension: failure.dimension,
        check_name: failure.name,
        source: 'inspection-engine',
      },
      annotations: {
        summary: `[${failure.dimension}] ${failure.name}`,
        description: failure.message,
        diagnosis: failure.diagnosis || '',
        suggestion: failure.suggestion || '',
        inspection_id: inspectionResult.inspectionId,
      },
      startsAt: inspectionResult.timestamp,
      generatorURL: `http://localhost:3000/reports/${inspectionResult.inspectionId}.html`,
    });
  }

  return alerts;
}
```

### 9.3 CI/CD 流水线集成

#### GitHub Actions 示例

```yaml
# .github/workflows/inspection.yml
name: Pre-deployment Health Check

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  inspection:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Health Inspection
        run: |
          chmod +x scripts/health-inspection.sh
          bash scripts/health-inspection.sh --json > inspection-result.json
          
          # 上传报告为artifact
          
      - name: Upload Report
        uses: actions/upload-artifact@v4
        with:
          name: inspection-report
          path: inspection-result.json

      - name: Check Results
        run: |
          SCORE=$(jq '.overall.score' inspection-result.json)
          FAILS=$(jq '.overall.fail' inspection-result.json)
          
          echo "📊 Inspection Score: $SCORE%"
          echo "❌ Failures: $FAILS"
          
          if [ "$FAILS" -gt 0 ]; then
            echo "::error::Inspection found $FAILS failing checks!"
            exit 1
          fi
          
          if [ "$SCORE" -lt 70 ]; then
            echo "::warning::Score below 70%, review warnings"
          fi
```

#### Jenkinsfile 示例

```groovy
pipeline {
  agent any
  
  stages {
    stage('Health Inspection') {
      steps {
        sh '''
          chmod +x scripts/health-inspection.sh
          bash scripts/health-inspection.sh --json > result.json
        '''
        
        script {
          def result = readJSON file: 'result.json'
          def score = result.overall.score
          def fails = result.overall.fail
          
          println "Score: ${score}% | Fails: ${fails}"
          
          if (fails > 0) {
            error("Inspection failed with ${fails} issues")
          }
        }
      }
      
      post {
        always {
          archiveArtifacts artifacts: 'result.json'
        }
      }
    }
  }
}
```

### 9.4 前端 Dashboard 集成

#### React/Vue 组件示例

```jsx
// React: InspectionStatusWidget.jsx
import React, { useState, useEffect } from 'react';

export function InspectionStatusWidget() {
  const [lastResult, setResult] = useState(null);
  
  useEffect(() => {
    fetch('/api/v1/inspection/last')
      .then(r => r.json())
      .then(data => setResult(data.data));
  }, []);

  if (!lastResult) return <div>Loading...</div>;

  const { overall, dimensions } = lastResult;
  
  return (
    <div className="inspection-widget">
      <div className="score-circle">
        <svg>{/* 圆环进度 */}</svg>
        <span>{overall.score}</span>
      </div>
      <div className="dimensions">
        {Object.entries(dimensions).map(([key, dim]) => (
          <div key={key} className="dim-bar">
            <label>{key}</label>
            <progress value={dim.score} max={100} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 10. 扩展指南

### 10.1 新增检查项的方法

以新增一个 **"自定义业务指标检查"** 为例:

#### Step 1: 在对应维度的检查函数中添加

```bash
# 在 check_application() 函数末尾添加:

# A10. 自定义业务指标 (示例: 活跃用户数)
check_active_users() {
    local dim="application"
    
    # 调用自定义API获取业务指标
    local api_response
    api_response=$(curl -s --max-time 5 "http://localhost:3000/api/v1/metrics/active-users" 2>/dev/null || echo "{}")
    
    local active_user_count
    active_user_count=$(echo "$api_response" | parse_json_field "count" || echo "0")
    
    local MIN_ACTIVE_USERS=${INSPECT_MIN_ACTIVE_USERS:-10}
    
    if [ "$active_user_count" -ge "$MIN_ACTIVE_USERS" ]; then
        add_result "$dim" "活跃用户数" "pass" "${active_user_count} 人在线 (>=${MIN_ACTIVE_USERS})"
    else
        add_result "$dim" "活跃用户数" "warn" "${active_user_count} 人在线 (<${MIN_ACTIVE_USERS})" \
            "活跃用户数低于预期" \
            "检查用户登录服务和会话管理"
    fi
}
```

#### Step 2: 更新计数器和表格

```bash
# 确保TOTAL_CHECKS会自动递增 (add_result已处理)
# 如果有HTML报告，确保表格能显示新项目 (自动适配)
```

#### Step 3: 添加阈值配置 (可选)

```bash
# 在全局变量区添加:
MIN_ACTIVE_USERS=${INSPECT_MIN_ACTIVE_USERS:-10}
```

#### Step 4: 测试验证

```bash
# 单维度测试
./scripts/health-inspection.sh --dimension application

# 确认新检查项出现且结果符合预期
```

### 10.2 新增维度 (高级)

如果要添加全新的第6维度 (例如: **Business Logic Layer**):

1. **创建新的检查函数**:

```bash
check_business_logic() {
    init_dimension "business"
    local dim="business"
    
    log_section "[D6 业务逻辑层 (Business)]"
    
    # 添加具体的业务检查项...
    add_result "$dim" "订单处理" "pass" "正常"
    add_result "$dim" "支付网关" "pass" "可达"
}
```

2. **注册到主流程**:

```bash
main() {
    # ...existing checks...
    check_business_logic  # 新增
    
    # ...rest of main...
}
```

3. **更新维度名称映射** (API和HTML):

```javascript
// inspection.js
const allDimensions = [
    'infrastructure', 'application', 'security',
    'data', 'monitoring', 'business'  // 新增
];
```

4. **更新文档和Schema**

### 10.3 自定义输出格式

如需添加 XML/YAML 输出支持:

```bash
# 在 generate_*_report() 函数旁添加:

generate_xml_report() {
    # 使用XML工具或echo构建
    cat <<EOF
<?xml version="1.0"?>
<inspection id="$INSPECTION_ID">
  <timestamp>$START_TIME</timestamp>
  <overall score="$OVERALL_SCORE"/>
  <!-- ... -->
</inspection>
EOF
}

# 在 main() 的 case 语句中添加:
xml)
    generate_xml_report
    ;;
```

---

## 11. 安全考量

### 11.1 权限最小化

巡检脚本需要的最低权限:

| 操作 | 所需权限 | 风险等级 |
|------|----------|----------|
| `docker ps` | docker组用户权限 | 低 |
| `curl localhost:*` | 网络访问 | 无 |
| `docker exec psql` | docker组 + DB只读用户 | 中 |
| `redis-cli ping` | 网络访问 | 无 |
| `openssl x509` | 文件读取 | 无 |
| `netstat/ss` | 普通用户 | 无 |

**不建议**:
- ❌ 以 root 用户运行
- ❌ 挂载 Docker socket (promtail除外)
- ❌ 使用数据库超级用户账号

### 11.2 敏感信息保护

巡检过程中可能接触到的敏感信息:

| 信息类型 | 处理方式 | 是否记录到报告 |
|----------|----------|----------------|
| JWT Secret | 仅检查长度，不显示内容 | ❌ 不记录 |
| 数据库密码 | 环境变量引用，不解码 | ❌ 不记录 |
| TLS证书内容 | 仅检查有效期 | ❌ 不记录 |
| IP地址/端口 | 列表形式展示 | ✅ 必要时记录 |
| 容器名称 | 公开信息 | ✅ 记录 |

### 11.3 API安全

REST API的安全措施:

1. **认证中间件**: 由父路由提供JWT认证
2. **CORS配置**: 限制允许的来源
3. **Rate Limiting**: Trigger端点60秒冷却
4. **输入验证**: 所有query参数类型检查
5. **路径遍历防护**: `isPathSafe()` 函数
6. **错误信息脱敏**: 不暴露服务器内部路径

### 11.4 审计日志

建议记录的关键事件:

```
[2026-06-09 18:00:00] INFO  Inspection started: INS-20260609-180000
[2026-06-09 18:00:05] INFO  D1-Infrastructure: 8/8 passed
[2026-06-09 18:00:12] WARN  D2-API Response Time: 1200ms (>500ms)
[2026-06-09 18:00:20] INFO  Inspection completed: Score 85%
[2026-06-09 19:00:01] INFO  Manual trigger by user: admin@globalreach.com
```

---

## 12. 故障排查

### 12.1 常见问题速查表

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| `docker: command not found` | PATH未包含docker | 安装Docker Desktop或WSL2 |
| `permission denied` | 用户不在docker组 | `sudo usermod -aG docker $USER` |
| `curl: (7) Failed to connect` | 服务未启动 | `docker compose up -d <service>` |
| `redis-cli: command not found` | 未安装redis-tools | `apt install redis-tools` 或用docker exec |
| `python3: not found` | JSON解析回退失败 | 安装Python3或简化检查逻辑 |
| 报告目录无写入权限 | 文件系统权限 | `chmod 755 reports/inspection` |
| JSON输出被截断 | 输出超过buffer | 增加maxBuffer或减少检查项 |
| 守护进程内存泄漏 | 长时间运行累积 | 使用cron替代daemon模式 |

### 12.2 调试技巧

#### 启用详细输出

```bash
# 使用bash -x跟踪执行
bash -x scripts/health-inspection.sh --quick 2>&1 | tee debug.log

# 仅调试特定函数
bash -x scripts/health-inspection.sh --dimension infra 2>&1 | grep "check_docker\|add_result"
```

#### 模拟特定场景

```bash
# 模拟Docker宕机
DOCKER_MOCK=fail bash scripts/health-inspection.sh

# 模拟网络不通
# (临时修改localhost解析或使用mock server)
```

#### 检查环境依赖

```bash
# 验证所有必需命令
for cmd in docker curl ping free df netstat openssl redis-cli python3; do
    if command -v $cmd &>/dev/null; then
        echo "✅ $cmd: $(command -v $cmd)"
    else
        echo "❌ $cmd: NOT FOUND"
    fi
done
```

### 12.3 日志位置

| 组件 | 日志路径 | 内容 |
|------|----------|------|
| 定时任务 | `logs/scheduled_inspection.log` | Scheduler执行日志 |
| Cron模式 | `logs/cron_inspection.log` | Crontab执行日志 |
| Docker日志 | `docker logs globalreach-api-prod` | API容器日志 |
| Nginx日志 | `nginx_logs/` 目录 | Web访问和错误日志 |
| Application | PM2/Node.js stdout | 应用程序日志 |

---

## 13. 性能优化

### 13.1 执行时间分析

| 阶段 | 耗时 | 占比 | 优化方向 |
|------|------|------|----------|
| Docker命令 | 3-5s | 25% | 并行执行, 缓存结果 |
| HTTP请求 | 5-10s | 40% | 减少超时, 并发请求 |
| 数据库查询 | 2-3s | 15% | 连接复用, 简化SQL |
| JSON解析 | 1-2s | 10% | 使用更快的解析器 |
| 报告生成 | <1s | 5% | 流式输出 |

**当前总耗时**: ~15-30秒 (全量模式)
**优化目标**: <10秒 (全量模式)

### 13.2 优化策略

#### 并行化检查项

```bash
# 未来改进: 使用后台进程并行执行独立检查
check_infrastructure &
check_application &
check_security &
check_data &
check_monitoring &
wait
```

#### 结果缓存

```bash
# 短期缓存 (同一分钟内的重复调用)
CACHE_DIR="/tmp/inspection-cache"
CACHE_TTL=60  # seconds

get_cached_or_fresh() {
    local cache_key="$1"
    local cache_file="$CACHE_DIR/$cache_key"
    
    if [ -f "$cache_file" ] && [ $(( $(date +%s) - $(stat -c %Y "$cache_file") )) -lt $CACHE_TTL ]; then
        cat "$cache_file"
    else
        eval "$1" | tee "$cache_file"
    fi
}
```

#### 增量检查

```bash
# 仅检查自上次巡检后有变化的项目
LAST_INSPECTION_FILE=".last-inspection-timestamp"

if [ -f "$LAST_INSPECTION_FILE" ]; then
    LAST_TIME=$(cat "$LAST_INSPECTION_FILE")
    # 只检查mtime > LAST_TIME 的相关文件
fi
```

### 13.3 资源消耗

| 资源 | 消耗量 | 说明 |
|------|--------|------|
| CPU | <5% (峰值) | 主要在JSON解析阶段 |
| 内存 | ~50MB | Bash进程 + 子进程 |
| 磁盘I/O | 极低 | 仅读写小型JSON文件 |
| 网络 | ~20请求 | 内部HTTP探测 |
| 并发连接 | 1-3个 | 串行执行curl命令 |

---

## 14. 附录

### 14.1 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-06-09 | 初始版本，5大维度40+检查项 |

### 14.2 相关文档

- [S132 配置验证防护网](../docs/S132_CONFIG_VALIDATION.md)
- [M-D06 远程备份策略](../docs/REMOTE_BACKUP_STRATEGY.md)
- [Phase L SSL证书方案](../docs/SSL_SETUP.md)
- [D14 Deep Health Check](../api/routes/health.js)
- [Docker Compose 生产配置](../docker-compose.prod.yml)

### 14.3 术语表

| 术语 | 定义 |
|------|------|
| **巡检 (Inspection)** | 定期的系统健康检查过程 |
| **维度 (Dimension)** | 检查的分类层面 (基础设施/应用/安全/数据/监控) |
| **检查项 (Check Item)** | 单个具体的检测点 |
| **阈值 (Threshold)** | 判断通过/警告/失败的临界值 |
| **守护进程 (Daemon)** | 后台循环运行的长期进程 |
| **Webhook** | HTTP回调通知机制 |
| **幂等性 (Idempotent)** | 多次执行结果一致的特性 |

### 14.4 致谢与贡献

- **架构设计**: O03 团队
- **代码审查**: S132 团队 (validate-configs.sh 参考实现)
- **测试反馈**: DevOps 团队
- **文档审阅**: 技术写作团队

### 14.5 许可证

本文档属于 GlobalReach V2.0 项目内部技术文档，仅供团队内部使用。

---

> **文档结束**
>
> 最后更新: 2026-06-09 18:00 CST
> 下次审核: 2026-07-09 (或重大变更时)
> 维护者: O03 自动化巡检引擎团队
