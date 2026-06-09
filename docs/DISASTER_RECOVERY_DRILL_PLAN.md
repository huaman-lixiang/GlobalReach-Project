# GlobalReach V2.0 — 灾难恢复演练计划 (DR Drill Plan)

> **文档编号**: N05-S130
> **版本**: v1.0
> **创建日期**: 2026-06-09
> **状态**: 已发布
> **分类**: 运维/灾备

---

## 目录

1. [DR 目标与范围](#1-dr-目标与范围)
2. [灾难场景矩阵](#2-灾难场景矩阵)
3. [演练流程标准SOP](#3-演练流程标准sop)
4. [各场景详细操作手册](#4-各场景详细操作手册)
5. [演练报告模板](#5-演练报告模板)
6. [DR 演练日历模板](#6-dr-演练日历模板)
7. [通讯模板](#7-通讯模板)
8. [与现有资产的关系](#8-与现有资产的关系)

---

## 1. DR 目标与范围

### 1.1 RTO/RPO 定义

| 指标 | 定义 | 目标值 | 测量方式 |
|------|------|--------|----------|
| **RTO** (Recovery Time Objective) | 从灾难发生到服务完全恢复的最大可接受时间 | **≤ 2 小时** | T+0 (灾难触发) 到 T+验证通过 的时间差 |
| **RPO** (Recovery Point Objective) | 最大可接受的数据丢失量（时间窗口） | **≤ 24 小时** | 最后一次成功备份时间到灾难发生的时间差 |

### 1.2 演练范围

#### ✅ 在范围内的组件 (13个容器)

| 组件类别 | 容器名称 | 镜像版本 | 关键性 |
|----------|----------|----------|--------|
| **核心数据层** | `globalreach-postgres` | postgres:15-alpine | 🔴 关键 |
| **缓存层** | `globalreach-redis` | redis:7.4.9-alpine | 🟡 重要 |
| **应用层** | `globalreach-api-prod` | globalreach-project-api:latest | 🔴 关键 |
| **反向代理** | `globalreach-nginx-prod` | nginx:1.31.1-alpine | 🔴 关键 |
| **监控核心** | `globalreach-prometheus` | prom/prometheus:v3.12.0 | 🟢 辅助 |
| **可视化** | `globalreach-grafana` | grafana/grafana:13.0.2 | 🟡 重要 |
| **指标采集** | `globalreach-node-exporter` | prom/node-exporter:v1.11.1 | 🟢 辅助 |
| **数据库指标** | `globalreach-pg-exporter` | prometheuscommunity/postgres-exporter:v0.19.1 | 🟢 辅助 |
| **日志聚合** | `globalreach-loki` | grafana/loki:3.7.2 | 🟡 重要 |
| **日志采集** | `globalreach-promtail` | grafana/promtail:3.6.8 | 🟢 辅助 |
| **链路追踪** | `globalreach-tempo` | grafana/tempo:2.5.0 | 🟢 辅助 |
| **告警路由** | `globalreach-alertmanager` | prom/alertmanager:v0.32.2 | 🟡 重要 |
| **邮件测试** | `globalreach-mailpit` | axllent/mailpit:v1.30.1 | 🟢 辅助 |

#### ✅ 备份覆盖范围 (M-D06 backup.sh)

```
备份内容:
├── postgresql/          — PostgreSQL 15 数据库 dump (custom + SQL format)
│   ├── globalreach_prod.dump      # pg_restore 格式
│   ├── globalreach_prod.sql       # psql 可读格式
│   └── table_list.txt             # 表清单
├── redis/               — Redis 7 RDB/AOF 数据文件
│   ├── dump.rdb                 # RDB 快照
│   ├── appendonly.aof           # AOF 日志(如有)
│   ├── dbsize.txt               # 键数量
│   └── keyspace_info.txt        # 键空间信息
├── grafana/             — Grafana Dashboard/数据源/配置
│   ├── grafana.db               # SQLite 数据库
│   ├── grafana.ini              # 主配置
│   ├── provisioning/            # 配置置备
│   └── datasource_*.json        # 数据源导出
├── nginx/               — Nginx 配置 & SSL证书
│   ├── nginx.conf               # 主配置
│   ├── conf.d/                  # 站点配置
│   ├── ssl_globalreach/         # 自签名证书
│   └── ssl_letsencrypt/         # LE 证书(如有)
├── config/              — Docker Compose & 监控配置
│   ├── docker-compose.prod.yml  # 生产编排文件
│   ├── Dockerfile               # 构建文件
│   ├── .env.example             # 环境变量示例
│   ├── prometheus.yml           # Prometheus 配置
│   ├── prometheus_rules/        # 告警规则
│   ├── loki-config.yml          # Loki 配置
│   ├── tempo-config.yml         # Tempo 配置
│   └── alertmanager.yml         # AlertManager 配置
└── MANIFEST.txt         — 备份清单
```

### 1.3 不在范围内的事项

| 排除项 | 原因 | 替代方案 |
|--------|------|----------|
| **DNS 故障恢复** | 外部依赖，非本系统控制 | DNS 提供商故障转移机制 |
| **云服务商区域级故障** | 超出单机部署能力 | 多区域部署(未来规划) |
| **DDoS 攻击防护** | 安全范畴，非 DR 范畴 | WAF/CDN 防护策略 |
| **数据加密密钥丢失** | 密钥管理范畴 | M-C02 密钥轮换策略 |
| **物理硬件损坏(硬盘)** | 需要硬件替换 | 备机切换或云迁移 |
| **操作系统内核崩溃** | 需要系统重装 | 标准OS重建流程 |

### 1.4 演练频率建议

| 频率 | 类型 | 说明 |
|------|------|------|
| **每季度 1 次** | 完整 DR 演练 | 执行一个完整场景的端到端恢复 |
| **每月 1 次** | 备份验证 | 执行 `verify-backup.sh` 验证备份可用性 |
| **每周 1 次** | 自动化健康检查 | Prometheus/Loki 监控告警验证 |
| **每次重大变更后** | 回归测试 | 配置变更、版本升级后执行 SC-01 |

---

## 2. 灾难场景矩阵

### 2.1 场景总览

| 场景编号 | 场景名称 | 描述 | 影响范围 | RTO 目标 | RPO 目标 | 恢复方案 | 风险等级 |
|----------|----------|------|----------|----------|----------|----------|----------|
| **SC-01** | API 容器崩溃 | 应用服务进程异常退出 | 单服务 (API) | **< 5 min** | **0** (无数据丢失) | 容器重启 | 🟢 低 |
| **SC-02** | PostgreSQL 数据损坏 | 数据库文件损坏或逻辑错误 | 数据库层 | **< 30 min** | **< 24 h** | 从备份恢复 | 🟠 中 |
| **SC-03** | Redis 数据丢失 | 缓存数据清空或 RDB 损坏 | 缓存层 | **< 10 min** | **< 24 h** | 重启+预热 | 🟡 中低 |
| **SC-04** | Docker 宿主机故障 | 操作系统崩溃、Docker daemon 异常 | 全系统 (13 容器) | **< 2 h** | **< 24 h** | 备机切换/重建 | 🔴 高 |
| **SC-05** | 磁盘空间耗尽 | 日志/数据增长导致磁盘满 | 存储层 | **< 30 min** | **0** | 清理+扩容 | 🟡 中低 |
| **SC-06** | 人为误操作(删库) | DROP TABLE / DELETE 无 WHERE | 数据库 | **< 15 min** | **< 24 h** | 备份恢复 | 🟠 中 |

### 2.2 场景详细说明

#### SC-01: API 容器崩溃

**触发条件**:
- OOM (Out of Memory) 导致容器被 kill
- 未捕获异常导致 Node.js 进程退出
- Docker daemon 重启后容器未自动恢复

**影响评估**:
- 用户无法访问 API (`http://localhost:3000`)
- Nginx 返回 502 Bad Gateway
- PostgreSQL 和 Redis 不受影响
- 监控告警触发: `GlobalReachAPIDown`

**恢复策略**:
```bash
# 方案 A: Docker 自动重启 (restart: unless-stopped)
docker restart globalreach-api-prod

# 方案 B: 如果容器状态异常，强制重建
docker compose -f docker-compose.prod.yml up -d --force-recreate api
```

---

#### SC-02: PostgreSQL 数据损坏

**触发条件**:
- 文件系统损坏导致 pg_data 目录不可读
- 错误的 ALTER TABLE/DROP TABLE 操作
- 磁盘 I/O 错误导致 WAL 损坏
- 升级失败导致数据库不兼容

**影响评估**:
- 所有依赖数据库的功能不可用
- API 返回 500 Internal Server Error
- Grafana 可能受影响(如果使用 PostgreSQL 作为数据源)

**恢复策略**:
```bash
# 1. 确认最新备份可用
./scripts/verify-backup.sh

# 2. 选择合适的备份文件
LATEST_BACKUP=$(ls -t backups/globalreach_backup_*.tar.gz | head -1)

# 3. 仅恢复 PostgreSQL
./scripts/restore.sh "${LATEST_BACKUP}" --db -y
```

---

#### SC-03: Redis 数据丢失

**触发条件**:
- Redis 容器被意外删除并重建(空 volume)
- FLUSHALL 命令误执行
- RDB/AOF 文件被删除
- 内存不足导致 Redis 清空数据

**影响评估**:
- 会话管理失效(用户需重新登录)
- 缓存未命中导致数据库压力增大
- 速率限制计数器重置
- 队列任务可能丢失

**恢复策略**:
```bash
# 1. 停止 Redis 容器
docker stop globalreach-redis

# 2. 从备份恢复 RDB
./scripts/restore.sh "${LATEST_BACKUP}" --redis -y

# 3. 启动并预热缓存
docker start globalreach-redis
sleep 5
# 手动预热关键缓存(根据业务需求)
```

---

#### SC-04: Docker 宿主机故障

**触发条件**:
- Linux 内核 panic
- Docker daemon 无法启动
- 系统盘损坏
- 安全更新导致不兼容

**影响评估**:
- 全部 13 个容器不可用
- 所有服务中断
- 需要在备用机器上重建环境

**恢复策略**:

**方案 A: 同机快速恢复** (预计 30-60 分钟)
```bash
# 1. 重启系统
reboot

# 2. 等待 Docker daemon 就绪
until docker info >/dev/null 2>&1; do sleep 5; done

# 3. 启动所有服务
docker compose -f docker-compose.prod.yml up -d

# 4. 验证服务健康
docker compose -f docker-compose.prod.yml ps
```

**方案 B: 备机切换** (预计 1-2 小时)
```bash
# 在备用机器上执行:

# 1. 安装 Docker
curl -fsSL https://get.docker.com | sh

# 2. 克隆项目代码
git clone <repo-url> GlobalReach-Project
cd GlobalReach-Project

# 3. 恢复配置和备份
scp user@primary:/path/to/backups/latest.tar.gz ./backups/
./scripts/restore.sh ./backups/latest.tar.gz --all -y

# 4. 启动服务
docker compose -f docker-compose.prod.yml up -d

# 5. 切换 DNS (如使用域名)
# 更新 A 记录指向新服务器 IP
```

---

#### SC-05: 磁盘空间耗尽

**触发条件**:
- 日志文件无限增长
- Docker 镜像/卷占用过多空间
- 备份文件未及时清理
- PostgreSQL WAL 文件堆积

**影响评估**:
- 新数据写入失败
- 容器可能无法启动(磁盘满)
- Docker build/pull 失败
- 日志写入失败

**恢复策略**:
```bash
# 1. 查看磁盘使用情况
df -h

# 2. 清理 Docker 未使用的资源
docker system prune -a --volumes

# 3. 清理旧日志
find ./logs -name "*.log" -mtime +30 -delete

# 4. 清理旧备份(保留最近 7 天)
find ./backups -name "globalreach_backup_*.tar.gz" -mtime +7 -delete

# 5. 如果是 PostgreSQL 问题, 清理 WAL
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
  -c "CHECKPOINT;"
```

---

#### SC-06: 人为误操作(删库)

**触发条件**:
- 开发人员误执行 `DROP TABLE`
- 运维人员误执行 `DELETE FROM ...` (无 WHERE 条件)
- 脚本 bug 导致批量删除
- 权限过大导致的误操作

**影响评估**:
- 数据永久丢失(除非有备份)
- 业务功能受损程度取决于删除的表
- 可能需要通知用户数据回滚

**恢复策略**:
```bash
# ⚠️ 紧急停止写入!
docker stop globalreach-api-prod

# 1. 确认备份点(选择灾难前的备份)
ls -lt backups/globalreach_backup_*.tar.gz

# 2. 验证备份完整性
./scripts/verify-backup.sh backups/<selected-backup>.tar.gz

# 3. 恢复数据库到备份点
./scripts/restore.sh backups/<selected-backup>.tar.gz --db -y

# 4. 验证数据完整性
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
  -c "\dt"
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
  -c "SELECT COUNT(*) FROM users;"  # 示例表

# 5. 重启应用
docker start globalreach-api-prod
```

---

## 3. 演练流程标准SOP

### 3.1 八步标准流程

```
时间轴:
T-7天          T-0前           T-0            T+验证         T+完成         T+1d
  │              │              │              │              │              │
  ▼              ▼              ▼              ▼              ▼              ▼
┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐
│ Step 1  │  │ Step 2   │  │ Step 3   │  │ Step 4   │  │ Step 5   │  │ Step 6 │
│ 准备    │→│ 基线快照  │→│ 灾难模拟  │→│ 启动恢复  │→│ 验证恢复  │→│ 记录   │
└─────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └────────┘
                                                                   │
                                                          ┌────────▼────────┐
                                                          │ Step 7: 回顾改进 │
                                                          │ Step 8: 文档归档 │
                                                          └─────────────────┘
```

### 3.2 Step 1: 演练准备 (T-7 天)

**目标**: 确保演练可以安全、有序地进行

**检查清单**:

- [ ] **1.1 通知利益相关者**
  ```bash
  # 发送预通知邮件(使用第7节通讯模板)
  收件人: tech-team@globalreach.com, management@globalreach.com
  内容: 演练计划、时间窗口、影响范围
  ```

- [ ] **1.2 确认备份可用**
  ```bash
  # 验证最新备份完整性
  ./scripts/verify-backup.sh

  # 预期输出:
  # 结论: PASS (或 WARN, 如为 WARN 需确认是否可接受)
  ```

- [ ] **1.3 准备回滚方案**
  ```bash
  # 创建当前系统快照(用于回滚)
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)

  # 记录当前运行的容器列表
  docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" > "drill_prep_${TIMESTAMP}.txt"

  # 记录关键数据量(用于对比)
  docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
    -c "SELECT relname AS table_name, n_live_tup AS row_count \
        FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10;" \
    > "drill_baseline_${TIMESTAMP}.csv"

  docker exec globalreach-redis redis-cli DBSIZE > "drill_redis_baseline_${TIMESTAMP}.txt"
  ```

- [ ] **1.4 确定演练窗口**
  ```bash
  # 建议在低峰期执行(如周末凌晨 02:00-06:00)
  # 或使用维护窗口模式(短暂停服通知用户)
  ```

- [ ] **1.5 准备演练环境**
  ```bash
  # 如果是在生产环境演练,确保:
  # 1. 有完整的监控覆盖
  # 2. 可以随时中止演练
  # 3. 有备用通信渠道(如手机)
  ```

**输出物**:
- `drill_prep_<timestamp>.txt` — 容器状态快照
- `drill_baseline_<timestamp>.csv` — 数据基线
- `drill_redis_baseline_<timestamp>.txt` — Redis 基线
- 演练通知邮件发送记录

---

### 3.3 Step 2: 基线快照 (T-0 前 10 分钟)

**目标**: 记录演练前的系统状态，作为恢复验证的基准

**操作步骤**:

```bash
#!/bin/bash
# baseline_snapshot.sh — 演练前基线快照脚本
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SNAPSHOT_DIR="drill_snapshots/drill_${TIMESTAMP}"
mkdir -p "${SNAPSHOT_DIR}"

echo "=== [基线快照] 开始: $(date) ==="

# 2.1 系统资源快照
echo "--- 2.1 系统资源 ---" > "${SNAPSHOT_DIR}/system_resources.txt"
free -h >> "${SNAPSHOT_DIR}/system_resources.txt"
df -h >> "${SNAPSHOT_DIR}/system_resources.txt"
uptime >> "${SNAPSHOT_DIR}/system_resources.txt"
nproc >> "${SNAPSHOT_DIR}/system_resources.txt"

# 2.2 Docker 容器状态
echo "--- 2.2 容器状态 ---" > "${SNAPSHOT_DIR}/container_status.txt"
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" \
  >> "${SNAPSHOT_DIR}/container_status.txt"

# 2.3 服务健康检查结果
echo "--- 2.3 健康检查 ---" > "${SNAPSHOT_DIR}/health_check.txt"
for svc in api postgres redis nginx grafana prometheus; do
  case $svc in
    api)
      curl -sf http://localhost:3000/api/v1/health && echo " [API: OK]" || echo " [API: FAIL]"
      ;;
    postgres)
      docker exec globalreach-postgres pg_isready -U globalreach_user \
        && echo " [PostgreSQL: OK]" || echo " [PostgreSQL: FAIL]"
      ;;
    redis)
      docker exec globalreach-redis redis-cli ping \
        && echo " [Redis: OK]" || echo " [Redis: FAIL]"
      ;;
    nginx)
      curl -sf http://localhost:80 && echo " [Nginx: OK]" || echo " [Nginx: FAIL]"
      ;;
    grafana)
      curl -sf http://localhost:3002/api/health && echo " [Grafana: OK]" || echo " [Grafana: FAIL]"
      ;;
    prometheus)
      curl -sf http://localhost:9090/-/healthy && echo " [Prometheus: OK]" || echo " [Prometheus: FAIL]"
      ;;
  esac
done >> "${SNAPSHOT_DIR}/health_check.txt"

# 2.4 数据库统计信息
echo "--- 2.4 数据库统计 ---" > "${SNAPSHOT_DIR}/db_stats.sql"
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
  -c "
    SELECT
      schemaname,
      tablename,
      n_live_tup AS row_count,
      pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size
    FROM pg_stat_user_tables
    ORDER BY n_live_tup DESC;
  " >> "${SNAPSHOT_DIR}/db_stats.sql"

# 2.5 Redis 信息
echo "--- 2.5 Redis 信息 ---" > "${SNAPSHOT_DIR}/redis_info.txt"
docker exec globalreach-redis redis-cli INFO server >> "${SNAPSHOT_DIR}/redis_info.txt"
docker exec globalreach-redis redis-cli DBSIZE >> "${SNAPSHOT_DIR}/redis_info.txt"
docker exec globalreach-redis redis-cli INFO keyspace >> "${SNAPSHOT_DIR}/redis_info.txt"

# 2.6 备份文件清单
echo "--- 2.6 备份清单 ---" > "${SNAPSHOT_DIR}/backup_manifest.txt"
ls -lht backups/globalreach_backup_*.tar.gz | head -10 >> "${SNAPSHOT_DIR}/backup_manifest.txt"
cat backups/globalreach_backup_*.tar.gz.sha256 2>/dev/null | tail -1 >> "${SNAPSHOT_DIR}/backup_manifest.txt"

# 2.7 网络连通性
echo "--- 2.7 网络端口 ---" > "${SNAPSHOT_DIR}/network_ports.txt"
for port in 80 443 3000 3002 3100 3200 9090 9093; do
  (echo >/dev/tcp/localhost/${port}) 2>/dev/null && echo "Port ${port}: OPEN" || echo "Port ${port}: CLOSED"
done >> "${SNAPSHOT_DIR}/network_ports.txt"

echo "=== [基线快照] 完成: $(date) ==="
echo "快照目录: ${SNAPSHOT_DIR}"
```

**输出物**:
- `drill_snapshots/drill_<timestamp>/` 目录包含:
  - `system_resources.txt` — CPU/内存/磁盘
  - `container_status.txt` — 容器运行状态
  - `health_check.txt` — 各服务健康状态
  - `db_stats.sql` — 数据库表行数和大小
  - `redis_info.txt` — Redis 键数和信息
  - `backup_manifest.txt` — 备份文件列表
  - `network_ports.txt` — 端口监听状态

---

### 3.4 Step 3: 执行灾难模拟 (T-0)

**目标**: 按照选定场景执行破坏性操作

⚠️ **重要安全提示**:
- 必须在 Step 2 完成基线快照后才可执行
- 必须有明确的回滚方案(Step 1.3)
- 高风险场景(SC-04, SC-06)建议先在测试环境验证
- 全程保持与团队的通信通道畅通

**各场景的破坏命令详见第4章**

---

### 3.5 Step 4: 启动恢复 (T+0)

**目标**: 按照预案执行恢复步骤

**通用恢复流程**:

```bash
#!/bin/bash
# recovery_executor.sh — 通用恢复执行器
# Usage: ./recovery_executor.sh <scenario_code>

SCENARIO="${1:-SC-01}"
START_TIME=$(date +%s)

echo "=== [DR 恢复] 场景: ${SCENARIO} ==="
echo "开始时间: $(date)"

case "${SCENARIO}" in
  SC-01)
    echo "[SC-01] 恢复 API 容器..."
    docker restart globalreach-api-prod
    sleep 10
    ;;

  SC-02)
    echo "[SC-02] 从备份恢复 PostgreSQL..."
    LATEST_BACKUP=$(ls -t backups/globalreach_backup_*.tar.gz | head -1)
    ./scripts/restore.sh "${LATEST_BACKUP}" --db -y
    ;;

  SC-03)
    echo "[SC-03] 从备份恢复 Redis..."
    LATEST_BACKUP=$(ls -t backups/globalreach_backup_*.tar.gz | head -1)
    ./scripts/restore.sh "${LATEST_BACKUP}" --redis -y
    ;;

  SC-04)
    echo "[SC-04] 全系统恢复..."
    # 根据实际情况选择方案A或B
    docker compose -f docker-compose.prod.yml up -d
    sleep 30
    ;;

  SC-05)
    echo "[SC-05] 清理磁盘空间..."
    docker system prune -a --volumes -f
    find ./logs -name "*.log" -mtime +30 -delete
    find ./backups -name "*.tar.gz" -mtime +7 -delete
    ;;

  SC-06)
    echo "[SC-06] 紧急数据库恢复..."
    docker stop globalreach-api-prod
    LATEST_BACKUP=$(ls -t backups/globalreach_backup_*.tar.gz | head -1)
    ./scripts/restore.sh "${LATEST_BACKUP}" --db -y
    docker start globalreach-api-prod
    ;;

  *)
    echo "未知场景: ${SCENARIO}"
    exit 1
    ;;
esac

END_TIME=$(date +%s)
DURATION=$(( END_TIME - START_TIME ))
echo "恢复耗时: ${DURATION} 秒 ($(( DURATION / 60 )) 分钟)"
echo "=== [DR 恢复] 完成 ==="
```

---

### 3.6 Step 5: 验证恢复 (T+验证)

**目标**: 全面验证服务功能和数据完整性

**验证脚本**:

```bash
#!/bin/bash
# verification_checklist.sh — 恢复后验证清单
BASELINE_DIR="${1:-drill_snapshots}"  # Step 2 的快照目录
PASS_COUNT=0
FAIL_COUNT=0

echo "=== [恢复验证] 开始: $(date) ==="
echo ""

# 5.1 容器运行状态验证
echo "--- 5.1 容器状态 ---"
EXPECTED_CONTAINERS=(
  "globalreach-postgres"
  "globalreach-redis"
  "globalreach-api-prod"
  "globalreach-nginx-prod"
  "globalreach-prometheus"
  "globalreach-grafana"
  "globalreach-node-exporter"
  "globalreach-pg-exporter"
  "globalreach-loki"
  "globalreach-promtail"
  "globalreach-tempo"
  "globalreach-alertmanager"
  "globalreach-mailpit"
)

for container in "${EXPECTED_CONTAINERS[@]}"; do
  if docker ps --format "{{.Names}}" | grep -q "^${container}$"; then
    echo "✓ ${container}: 运行中"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "✗ ${container}: 未运行!"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

echo ""

# 5.2 服务健康检查
echo "--- 5.2 服务健康 ---"
HEALTH_CHECKS=(
  "API|curl -sf http://localhost:3000/api/v1/health"
  "PostgreSQL|docker exec globalreach-postgres pg_isready -U globalreach_user"
  "Redis|docker exec globalreach-redis redis-cli ping"
  "Nginx HTTP|curl -sf http://localhost:80"
  "Nginx HTTPS|curl -sf https://localhost -k"  # -k 跳过证书验证
  "Prometheus|curl -sf http://localhost:9090/-/healthy"
  "Grafana|curl -sf http://localhost:3002/api/health"
  "AlertManager|curl -sf http://localhost:9093/-/healthy"
)

for check in "${HEALTH_CHECKS[@]}"; do
  IFS='|' read -r name cmd <<< "$check"
  if eval "$cmd" >/dev/null 2>&1; then
    echo "✓ ${name}: 健康"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "✗ ${name}: 不健康!"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

echo ""

# 5.3 数据库完整性验证
echo "--- 5.3 数据库完整性 ---"
if docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
  -c "\dt" >/dev/null 2>&1; then
  echo "✓ 数据库连接正常"
  PASS_COUNT=$((PASS_COUNT + 1))

  # 表数量验证
  TABLE_COUNT=$(docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
    -c "\dt" | grep -c "table" || echo "0")
  echo "  检测到 ${TABLE_COUNT} 张表"

  # 关键表行数抽样(与基线对比)
  echo "  关键表行数:"
  docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
    -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 5;" \
    2>/dev/null | grep -v "relname\|---\|(" | while read line; do
      echo "    ${line}"
    done
else
  echo "✗ 数据库连接失败!"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo ""

# 5.4 Redis 数据验证
echo "--- 5.4 Redis 数据 ---"
REDIS_PING=$(docker exec globalreach-redis redis-cli ping 2>/dev/null)
if [ "${REDIS_PING}" = "PONG" ]; then
  echo "✓ Redis 连接正常"
  PASS_COUNT=$((PASS_COUNT + 1))

  DBSIZE=$(docker exec globalreach-redis redis-cli DBSIZE 2>/dev/null)
  echo "  当前键数: ${DBSIZE}"
else
  echo "✗ Redis 连接失败!"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo ""

# 5.5 功能验证(API 端点)
echo "--- 5.5 API 功能 ---"
API_ENDPOINTS=(
  "GET /api/v1/health|curl -sf http://localhost:3000/api/v1/health"
)

for endpoint in "${API_ENDPOINTS[@]}"; do
  IFS='|' read -r path cmd <<< "$endpoint"
  HTTP_CODE=$(eval "${cmd} -o /dev/null -w '%{http_code}'" 2>/dev/null)
  if [ "${HTTP_CODE}" = "200" ]; then
    echo "✓ ${path}: ${HTTP_CODE} OK"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "✗ ${path}: ${HTTP_CODE} FAIL"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

echo ""

# 5.6 监控系统集成验证
echo "--- 5.6 监控集成 ---"
# Prometheus targets 检查
if curl -sf http://localhost:9090/api/v1/targets | grep -q '"health":"up"'; then
  echo "✓ Prometheus targets 正常"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "⚠ Prometheus targets 部分异常 (可能仍在发现中)"
fi

# Loki 日志接收检查
if curl -sf http://localhost:3100/ready | grep -q "ready"; then
  echo "✓ Loki 日志系统正常"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "⚠ Loki 可能尚未就绪"
fi

echo ""
echo "=== [恢复验证] 结果汇总 ==="
echo "  通过: ${PASS_COUNT}"
echo "  失败: ${FAIL_COUNT}"
echo "  总计: $(( PASS_COUNT + FAIL_COUNT ))"
echo "完成时间: $(date)"

if [ "${FAIL_COUNT}" -gt 0 ]; then
  echo "⚠️ 存在 ${FAIL_COUNT} 个验证失败项，请检查!"
  exit 1
else
  echo "🎉 所有验证项通过!"
  exit 0
fi
```

---

### 3.7 Step 6: 记录结果 (T+完成)

**目标**: 填写正式的演练报告

**操作步骤**:

1. 使用第5节的[演练报告模板](#5-演练报告模板)填写报告
2. 计算实际 RTO 和 RPO:
   ```bash
   # RTO = T+验证通过时间 - T-0 时间
   # RPO = 当前时间 - 最后成功备份时间
   ```
3. 收集演练过程中的截图和日志
4. 记录任何异常或偏差

**输出物**:
- `docs/DR_DRILL_REPORT_<YYYY-MM-DD>.md` — 正式报告
- `drill_logs/` — 演练过程日志
- `drill_evidence/` — 截图和证据

---

### 3.8 Step 7: 回顾改进 (T+1 天)

**目标**: 团队回顾演练过程，识别改进机会

**回顾会议议程**:

1. **开场 (5 分钟)**
   - 演练目标和范围回顾
   - 参会人员介绍

2. **演练过程复盘 (20 分钟)**
   - 按时间线回顾每个步骤
   - 标记偏离预案的点
   - 讨论遇到的问题

3. **数据分析 (15 分钟)**
   - RTO/RPO 是否达标?
   - 与历史演练数据对比
   - 识别瓶颈环节

4. **问题收集 (15 分钟)**
   - 使用「开始-停止-继续」方法:
     - **Start**: 应该开始做的新事项
     - **Stop**: 应该停止做的无效事项
     - **Continue**: 应该继续保持的好实践

5. **改进措施定义 (15 分钟)**
   - 优先级排序(P0/P1/P2)
   - 指定负责人和截止日期
   - 更新本计划和关联文档

6. **总结 (5 分钟)**
   - 行动项汇总
   - 下次演练计划

**输出物**:
- 会议纪要
- 改进措施跟踪表(格式见下):

| ID | 改进措施 | 优先级 | 负责人 | 截止日期 | 状态 |
|----|----------|--------|--------|----------|------|
| IMP-001 | 示例: 优化 PostgreSQL 恢复脚本增加并行恢复 | P1 | @username | 2026-Q2 | 待处理 |
| IMP-002 | ... | ... | ... | ... | ... |

---

### 3.9 Step 8: 文档归档

**目标**: 确保演练记录可追溯、可审计

**归档清单**:

```
docs/drill_archives/
├── DR_DRILL_2026-Q1/
│   ├── report.md                    # 演练报告
│   ├── scenario_SC-01/              # 按场景组织
│   │   ├── baseline/                # 基线快照
│   │   ├── execution_logs/          # 执行日志
│   │   ├── evidence/                # 截图/证据
│   │   └── post_verification/       # 验证结果
│   ├── retrospective.md             # 回顾会议纪要
│   └── improvement_tracking.json    # 改进措施跟踪
├── DR_DRILL_2026-Q2/
│   └── ...
└── index.md                         # 年度演练索引
```

**归档要求**:
- 报告必须包含: 日期、场景、RTO/RPO 实际值、结论
- 日志保留期限: 至少 2 年
- 敏感信息脱敏(密码、Token 等)
- 版本控制: Git 提交到仓库(排除敏感数据)

---

## 4. 各场景详细操作手册

### 4.1 SC-01: API 容器崩溃

#### 基本信息
- **风险等级**: 🟢 低
- **预期恢复时间**: < 5 分钟
- **数据丢失风险**: 无
- **前置条件**: Docker daemon 正常运行

#### 触发命令 (模拟灾难)

```bash
# 方法 A: 直接停止容器
docker stop globalreach-api-prod

# 方法 B: 模拟 OOM kill
docker kill -s SIGKILL globalreach-api-prod

# 方法 C: 模拟进程崩溃(进入容器内 kill 进程)
docker exec globalreach-api-prod kill -9 1
```

#### 恢复命令

```bash
# 步骤 1: 检查容器状态
docker ps -a | grep globalreach-api-prod

# 步骤 2: 查看崩溃日志(可选,用于根因分析)
docker logs --tail 100 globalreach-api-prod

# 步骤 3: 重启容器
docker restart globalreach-api-prod

# 或者强制重建(如果镜像已更新)
docker compose -f docker-compose.prod.yml up -d --force-recreate api
```

#### 验证命令

```bash
# 等待 10 秒让服务启动
sleep 10

# 检查容器状态
docker ps | grep globalreach-api-prod
# 预期输出: Up X seconds (healthy)

# 健康检查
curl -sf http://localhost:3000/api/v1/health
# 预期输出: {"status":"ok","timestamp":"..."}

# 端口监听
ss -tlnp | grep :3000
# 预期输出: LISTEN  *:3000
```

#### 回滚命令

```bash
# 如果重启后仍有问题,回滚到上一版本镜像
docker images | grep globalreach-project-api

# 查看之前的镜像版本
docker image history globalreach-project-api:latest

# 切换到上一个已知良好版本(示例)
docker tag globalreach-project-api:<previous-tag> globalreach-project-api:latest
docker restart globalreach-api-prod
```

#### 预期时间线

| 阶段 | 耗时 | 累计 |
|------|------|------|
| 检测到故障 | 0-30s (Prometheus 告警) | 30s |
| 执行恢复命令 | 5s | 35s |
| 容器启动 | 10-30s | 65s |
| 健康检查通过 | 10s | 75s |
| **总计** | | **~1-2 分钟** |

---

### 4.2 SC-02: PostgreSQL 数据损坏

#### 基本信息
- **风险等级**: 🟠 中
- **预期恢复时间**: < 30 分钟
- **数据丢失风险**: 最多 24 小时(取决于备份频率)
- **前置条件**: 有有效的备份文件

#### 触发命令 (模拟灾难)

```bash
# ⚠️ 警告: 以下命令会破坏生产数据!仅在演练环境中执行!

# 方法 A: 删除关键表(逻辑损坏)
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
  -c "DROP TABLE IF EXISTS users CASCADE;"

# 方法 B: 截断所有表(数据丢失)
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
  -c "DO \$\$ DECLARE r RECORD; BEGIN FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public') LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE'; END LOOP; END;\$\$;"

# 方法 C: 损坏数据文件(物理损坏,仅限测试环境)
docker stop globalreach-postgres
# 手动删除或修改 /var/lib/postgresql/data 下的文件
docker start globalreach-postgres
```

#### 恢复命令

```bash
# 步骤 0: 紧急停止 API 写入(防止脏数据)
docker stop globalreach-api-prod

# 步骤 1: 确认最新备份
ls -lht backups/globalreach_backup_*.tar.gz | head -3
# 选择最新的备份文件
BACKUP_FILE="backups/$(ls -t backups/globalreach_backup_*.tar.gz | head -1 | xargs basename)"

# 步骤 2: 验证备份完整性(重要!)
./scripts/verify-backup.sh "${BACKUP_FILE}"
# 确认输出: 结论: PASS

# 步骤 3: 执行 PostgreSQL 恢复
./scripts/restore.sh "${BACKUP_FILE}" --db -y

# restore.sh 内部流程:
# 1. 解压备份到临时目录
# 2. SHA256 校验
# 3. tar.gz 完整性校验
# 4. 停止 API 容器(避免冲突)
# 5. pg_restore 或 psql 导入
# 6. 验证表数量

# 步骤 4: 重启 API
docker start globalreach-api-prod
```

#### 验证命令

```bash
# 等待数据库完全就绪
sleep 10

# 4.1 数据库连接验证
docker exec globalreach-postgres pg_isready -U globalreach_user -d globalreach_prod
# 预期输出: globalreach_prod:5432 - accepting connections

# 4.2 表结构验证
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "\dt"
# 预期输出: 列出所有业务表

# 4.3 数据量验证(与基线对比)
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
  -c "SELECT COUNT(*) AS total_users FROM users;"
# 对比 Step 2 的基线数据

# 4.4 API 功能验证
curl -sf http://localhost:3000/api/v1/health
# 预期: 200 OK

# 4.5 Grafana 数据源验证(如使用 PG 数据源)
curl -sf http://localhost:3002/api/datasources \
  -u admin:admin123 | python3 -m json.tool | head -20
```

#### 回滚命令

```bash
# 如果恢复后的数据有问题,尝试更早的备份
# 1. 列出所有备份
ls -lt backups/globalreach_backup_*.tar.gz

# 2. 选择前一天的备份
PREVIOUS_BACKUP="backups/globalreach_backup_$(date -d 'yesterday' +%Y%m%d)_*.tar.gz"

# 3. 再次恢复
./scripts/restore.sh "${PREVIOUS_BACKUP}" --db -y
```

#### 预期时间线

| 阶段 | 耗时 | 累计 |
|------|------|------|
| 备份验证 | 2-5 min | 5 min |
| 解压备份 | 1-2 min | 7 min |
| pg_restore 导入 | 5-15 min(取决于数据量) | 22 min |
| 重启服务 | 1 min | 23 min |
| 验证检查 | 5 min | 28 min |
| **总计** | | **~25-30 分钟** |

---

### 4.3 SC-03: Redis 数据丢失

#### 基本信息
- **风险等级**: 🟡 中低
- **预期恢复时间**: < 10 分钟
- **数据丢失风险**: 会话丢失(需重新登录)
- **前置条件**: 有 Redis RDB/AOF 备份

#### 触发命令 (模拟灾难)

```bash
# 方法 A: 清空所有数据
docker exec globalreach-redis redis-cli FLUSHALL

# 方法 B: 删除 RDB 文件后重启
docker stop globalreach-redis
docker run --rm -v globalreach-project_redis_data:/data alpine sh -c "rm -f /data/dump.rdb /data/appendonly.aof"
docker start globalreach-redis

# 方法 C: 删除并重建容器(空 volume)
docker stop globalreach-redis
docker rm globalreach-redis
docker compose -f docker-compose.prod.yml up -d redis
```

#### 恢复命令

```bash
# 步骤 1: 确定备份文件
BACKUP_FILE="backups/$(ls -t backups/globalreach_backup_*.tar.gz | head -1 | xargs basename)"

# 步骤 2: 执行 Redis 恢复
./scripts/restore.sh "${BACKUP_FILE}" --redis -y

# restore.sh 内部流程:
# 1. 停止 Redis 容器
# 2. 获取 volume 路径
# 3. 复制 dump.rdb 到 volume
# 4. 清理旧的 AOF(如有)
# 5. 启动 Redis 容器
# 6. 等待就绪并验证 DBSIZE

# 步骤 3: 预热缓存(可选,根据业务需求)
# 例如: 重新加载热门邮件模板、用户偏好设置等
```

#### 验证命令

```bash
# 等待 Redis 加载 RDB
sleep 5

# 3.1 连接验证
docker exec globalreach-redis redis-cli ping
# 预期: PONG

# 3.2 数据量验证
docker exec globalreach-redis redis-cli DBSIZE
# 对比基线的键数量

# 3.3 键空间验证
docker exec globalreach-redis redis-cli INFO keyspace
# 预期: db0:keys=XXX,expires=XXX

# 3.4 功能验证
docker exec globalreach-redis redis-cli SET test:drill "recovery_test" EX 60
docker exec globalreach-redis redis-cli GET test:drill
# 预期: recovery_test
docker exec globalreach-redis redis-cli DEL test:drill
```

#### 回滚命令

```bash
# 如果恢复的 RDB 有问题,允许 Redis 以空状态启动
# 系统会在运行过程中逐步重建缓存
docker restart globalreach-redis

# 或从更早的备份恢复
./scripts/restore.sh "backups/<earlier-backup>.tar.gz" --redis -y
```

#### 预期时间线

| 阶段 | 耗时 | 累计 |
|------|------|------|
| 停止 Redis | 2s | 2s |
| 复制 RDB | 3-5s | 7s |
| 启动 Redis | 3-5s | 12s |
| 数据加载(RDB) | 5-10s | 22s |
| 验证 | 5s | 27s |
| **总计** | | **~30 秒 - 1 分钟** |

---

### 4.4 SC-04: Docker 宿主机故障

#### 基本信息
- **风险等级**: 🔴 高
- **预期恢复时间**: < 2 小时
- **数据丢失风险**: 取决于备份新鲜度
- **前置条件**: 备机可用或有系统备份

#### 触发命令 (模拟灾难)

```bash
# ⚠️ 极度危险!仅在隔离的测试环境执行!

# 方法 A: 停止 Docker daemon
sudo systemctl stop docker

# 方法 B: 模拟系统崩溃(测试环境)
# echo c > /proc/sysrq-trigger  # 立即重启(慎用!)

# 方法 C: 删除所有容器和网络
docker stop $(docker ps -q)
docker rm $(docker ps -aq)
docker network rm $(docker network ls -q --filter "driver=bridge")
```

#### 恢复命令

**方案 A: 同机快速恢复** (推荐,如果 OS 正常)

```bash
#!/bin/bash
# recovery_host.sh — 宿主机恢复脚本
START_TIME=$(date +%s)

echo "=== [SC-04] 宿主机恢复开始 ==="

# 步骤 1: 启动 Docker daemon
echo "[1/6] 启动 Docker..."
sudo systemctl start docker
sleep 10

# 验证 Docker 就绪
until docker info >/dev/null 2>&1; do
  echo "等待 Docker daemon..."
  sleep 5
done
echo "✓ Docker daemon 就绪"

# 步骤 2: 检查 Volume 状态
echo "[2/6] 检查 Docker Volumes..."
docker volume ls
# 确认关键 volumes 存在:
# - globalreach-project_postgres_data
# - globalreach-project_redis_data
# - globalreach-project_grafana_data
# ...

# 步骤 3: 启动基础设施服务
echo "[3/6] 启动基础设施(PostgreSQL, Redis)..."
docker compose -f docker-compose.prod.yml up -d postgres redis
sleep 15

# 验证基础服务
docker exec globalreach-postgres pg_isready -U globalreach_user && echo "✓ PostgreSQL 就绪"
docker exec globalreach-redis redis-cli ping && echo "✓ Redis 就绪"

# 步骤 4: 启动应用服务
echo "[4/6] 启动应用服务(API, Nginx)..."
docker compose -f docker-compose.prod.yml up -d api nginx
sleep 20

# 步骤 5: 启动监控服务
echo "[5/6] 启动监控栈..."
docker compose -f docker-compose.prod.yml up -d \
  prometheus grafana node-exporter postgres-exporter \
  loki promtail tempo alertmanager mailpit
sleep 30

# 步骤 6: 全局验证
echo "[6/6] 执行全局验证..."
./verification_checklist.sh

END_TIME=$(date +%s)
DURATION=$(( END_TIME - START_TIME ))
echo "=== [SC-04] 恢复完成, 耗时: ${DURATION}s ($(( DURATION / 60 ))min) ==="
```

**方案 B: 备机切换** (如果主机组不可修复)

```bash
#!/bin/bash
# failover_to_standby.sh — 备机切换脚本
# 在备用服务器上执行

set -euo pipefail

echo "=== [SC-04] 备机切换开始 ==="

# 步骤 1: 环境准备
echo "[1/7] 安装依赖..."
# Ubuntu/Debian:
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git curl
# CentOS/RHEL:
# sudo yum install -y docker git curl

sudo systemctl enable --now docker

# 步骤 2: 获取代码
echo "[2/7] 获取项目代码..."
cd /opt
git clone <your-git-repo-url> GlobalReach-Project || true
cd GlobalReach-Project
git pull origin main

# 步骤 3: 传输备份
echo "[3/7] 传输备份文件..."
mkdir -p backups
scp user@<primary-host>:/path/to/GlobalReach-Project/backups/globalreach_backup_*.tar.gz ./backups/
# 或从对象存储下载:
# aws s3 cp s3://globalreach-backups/latest.tar.gz ./backups/

# 步骤 4: 配置环境变量
echo "[4/7] 配置环境..."
cp .env.example .env.prod
# 编辑 .env.prod 填入实际值:
# - DB_PASSWORD
# - JWT_SECRET
# - SMTP_QQ_PASS
# - GRAFANA_ADMIN_PASSWORD
# - WEBHOOK_SECRET
nano .env.prod  # 或使用您偏好的编辑器

# 步骤 5: 恢复数据
echo "[5/7] 恢复备份数据..."
LATEST_BACKUP=$(ls -t backups/globalreach_backup_*.tar.gz | head -1)
./scripts/restore.sh "${LATEST_BACKUP}" --all -y

# 步骤 6: 启动服务
echo "[6/7] 启动所有服务..."
docker compose -f docker-compose.prod.yml up -d
sleep 60

# 步骤 7: 验证
echo "[7/7] 验证服务..."
docker compose -f docker-compose.prod.yml ps
curl -sf http://localhost:3000/api/v1/health && echo "✓ API 正常"

echo "=== [SC-04] 备机切换完成 ==="
echo "⚠️  请记得:"
echo "  1. 更新 DNS 记录指向新服务器 IP"
echo "  2. 通知用户服务已恢复"
echo "  3. 监控系统运行状况"
```

#### 验证命令

```bash
# 完整的系统验证(使用 Step 5.6 的 verification_checklist.sh)
./verification_checklist.sh

# 补充验证:
# 4.1 所有容器运行
docker compose -f docker-compose.prod.yml ps
# 预期: 所有服务 "Up" 状态

# 4.2 网络连通性
for port in 80 443 3000 3002 9090 9093; do
  curl -sf http://localhost:${port} >/dev/null && echo "Port ${port}: OK" || echo "Port ${port}: FAIL"
done

# 4.3 端到端测试
# 发送测试邮件验证完整链路
curl -X POST http://localhost:3000/api/v1/emails/test \
  -H "Content-Type: application/json" \
  -d '{"to":"test@example.com","subject":"DR Test","body":"Recovery verified"}'
```

#### 回滚命令

```bash
# 如果新环境有问题,切回原主机(如果已修复)
# 1. 在原主机上执行 recovery_host.sh
# 2. DNS 切回原 IP
# 3. 通知用户
```

#### 预期时间线

| 方案 | 阶段 | 耗时 | 累计 |
|------|------|------|------|
| **A: 同机恢复** | Docker 启动 | 10-30s | 30s |
| | 基础设施启动 | 20-30s | 1min |
| | 应用服务启动 | 20-30s | 1.5min |
| | 监控栈启动 | 30-60s | 2.5min |
| | 验证 | 5min | **7.5min** |
| **B: 备机切换** | 环境准备 | 10-20min | 20min |
| | 代码获取 | 2-5min | 25min |
| | 备份传输 | 5-30min(取决于大小) | 55min |
| | 数据恢复 | 15-30min | 85min |
| | 服务启动 | 5-10min | 95min |
| | 验证 | 10min | **105min** |

---

### 4.5 SC-05: 磁盘空间耗尽

#### 基本信息
- **风险等级**: 🟡 中低
- **预期恢复时间**: < 30 分钟
- **数据丢失风险**: 无(如果是清理操作)
- **前置条件**: 有 root/sudo 权限

#### 触发命令 (模拟灾难)

```bash
# 方法 A: 填充磁盘(测试用,谨慎!)
# dd if=/dev/zero of=/tmp/fill_disk bs=1M count=<remaining-space-in-MB>

# 方法 B: 生成大量日志
# for i in {1..100000}; do echo "Log entry $i $(date)" >> ./logs/huge.log; done

# 方法 C: Docker 镜像膨胀
# docker pull ubuntu:latest && docker pull centos:latest && ...
```

#### 恢复命令

```bash
#!/bin/bash
# disk_cleanup.sh — 磁盘清理脚本
echo "=== [SC-05] 磁盘空间恢复 ==="

# 步骤 1: 诊断问题
echo "[1/6] 磁盘使用分析..."
df -h /

# 查找大目录
du -sh /* 2>/dev/null | sort -hr | head -10

# Docker 空间使用
docker system df

# 步骤 2: Docker 清理
echo "[2/6] 清理 Docker 资源..."

# 2.1 停止所有容器(临时)
docker stop $(docker ps -q) 2>/dev/null || true

# 2.2 清理未使用的镜像、容器、网络、构建缓存
docker system prune -a --volumes -f

# 2.3 清理 BuildKit 缓存
docker builder prune -f

# 步骤 3: 应用日志清理
echo "[3/6] 清理应用日志..."
find ./logs -name "*.log" -mtime +30 -delete
find ./logs -name "*.log.*" -delete  # 轮转日志

# 步骤 4: 备份文件清理
echo "[4/6] 清理旧备份..."
# 保留最近 7 天的备份
find ./backups -name "globalreach_backup_*.tar.gz" -mtime +7 -print -delete
find ./backups -name "*.sha256" -mtime +7 -delete

# 步骤 5: PostgreSQL 维护
echo "[5/6] PostgreSQL 维护..."
if docker ps | grep -q globalreach-postgres; then
  # 执行 CHECKPOINT 释放 WAL 空间
  docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
    -c "CHECKPOINT;"

  # 清理死元组(如果空间紧张)
  # docker exec globalreach-postgres vacuumdb -U globalreach_user -d globalreach_prod --full --analyze
fi

# 步骤 6: 系统日志清理
echo "[6/6] 系统日志清理..."
sudo journalctl --vacuum-size=100M 2>/dev/null || true
sudo apt-get clean 2>/dev/null || true  # Debian/Ubuntu
# sudo yum clean all 2>/dev/null || true  # CentOS/RHEL

# 最终验证
echo ""
echo "=== 清理后磁盘状态 ==="
df -h /
docker system df

# 重启之前停止的服务
docker start $(docker ps -aq -f status=exited) 2>/dev/null || true
```

#### 验证命令

```bash
# 5.1 磁盘空间检查
df -h /
# 预期: Use% < 80%

# 5.2 Docker 操作测试
docker ps
docker images | head -5
# 确认 Docker 可以正常工作

# 5.3 服务功能验证
curl -sf http://localhost:3000/api/v1/health
# 预期: 200 OK

# 5.4 日志写入测试
echo "$(date): Disk space recovery verified" >> ./logs/drill.log
# 确认没有 "No space left on device" 错误
```

#### 回滚命令

```bash
# 如果清理过度(例如误删了需要的镜像),重新拉取
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

#### 预期时间线

| 阶段 | 耗时 | 累计 |
|------|------|------|
| 诊断分析 | 2-5 min | 5 min |
| Docker 清理 | 5-10 min | 15 min |
| 日志清理 | 2-3 min | 18 min |
| 备份清理 | 1-2 min | 20 min |
| PG 维护 | 2-5 min | 25 min |
| 验证 | 2 min | 27 min |
| **总计** | | **~25-30 分钟** |

---

### 4.6 SC-06: 人为误操作(删库)

#### 基本信息
- **风险等级**: 🟠 中
- **预期恢复时间**: < 15 分钟
- **数据丢失风险**: 最多 24 小时的增量数据
- **前置条件**: 最近 24 小时有成功的备份

#### 触发命令 (模拟灾难)

```bash
# ⚠️⚠️⚠️ 极度危险!仅在演练环境执行!⚠️⚠️⚠️

# 方法 A: 删除单张表
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
  -c "DROP TABLE campaigns;"

# 方法 B: 删除多张表
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
  -c "DROP TABLE campaigns, emails, subscribers, lists CASCADE;"

# 方法 C: 清空表数据(保留结构)
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
  -c "TRUNCATE campaigns, emails, subscribers, lists RESTART IDENTITY CASCADE;"

# 方法 D: 删除全部数据(核弹级!)
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

#### 恢复命令

```bash
#!/bin/bash
# emergency_db_recovery.sh — 紧急数据库恢复
set -euo pipefail

echo "=== [SC-06] 紧急数据库恢复 ==="
echo "⚠️  此操作将覆盖当前数据库所有数据!"

START_TIME=$(date +%s)
START_DATE=$(date '+%Y-%m-%d %H:%M:%S')

# 步骤 0: 紧急止损
echo "[0/5] 🚨 紧急停止 API 写入..."
docker stop globalreach-api-prod || true
echo "✓ API 已停止,防止进一步数据损坏"

# 步骤 1: 评估损失范围
echo "[1/5] 评估当前状态..."
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
  -c "\dt" 2>/dev/null || echo "✗ 无表或无法连接"

# 步骤 2: 选择最佳备份点
echo "[2/5] 分析可用备份..."
echo "最近的备份文件:"
ls -lht backups/globalreach_backup_*.tar.gz | head -5

# 交互式选择(或自动选择最新)
read -p "输入要恢复的备份文件路径(留空使用最新): " SELECTED_BACKUP
BACKUP_FILE="${SELECTED_BACKUP:-$(ls -t backups/globalreach_backup_*.tar.gz | head -1)}"

echo "选择的备份: ${BACKUP_FILE}"
BACKUP_AGE=$(( ( $(date +%s) - $(stat -c%Y "${BACKUP_FILE}") ) / 360 ))
echo "备份年龄: 约 ${BACKUP_AGE} 小时 (RPO)"

# 步骤 3: 验证备份
echo "[3/5] 验证备份完整性..."
./scripts/verify-backup.sh "${BACKUP_FILE}"

# 步骤 4: 执行恢复
echo "[4/5] 执行 PostgreSQL 恢复..."
./scripts/restore.sh "${BACKUP_FILE}" --db -y

# 步骤 5: 验证并重启
echo "[5/5] 验证恢复结果..."
sleep 5

TABLE_COUNT=$(docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
  -c "\dt" | grep -c "table" || echo "0")
echo "✓ 恢复完成,检测到 ${TABLE_COUNT} 张表"

# 重启 API
docker start globalreach-api-prod
sleep 10

# 最终健康检查
if curl -sf http://localhost:3000/api/v1/health >/dev/null; then
  echo "✓ API 服务恢复正常"
else
  echo "⚠️  API 可能需要更长时间启动,请手动检查: docker logs globalreach-api-prod"
fi

END_TIME=$(date +%s)
DURATION=$(( END_TIME - START_TIME ))

echo ""
echo "=== [SC-06] 恢复汇总 ==="
echo "  开始时间: ${START_DATE}"
echo "  结束时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "  总耗时:   ${DURATION}s ($(( DURATION / 60 ))分${DURATION % 60}秒)"
echo "  RPO:      ~${BACKUP_AGE}小时"
echo "  RTO:      ${DURATION}s"
echo "========================="
```

#### 验证命令

```bash
# 6.1 数据库结构完整性
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "\dt"
# 预期: 列出所有业务表(campaigns, emails, subscribers, lists等)

# 6.2 关键数据量验证
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
  -c "
    SELECT
      'users' AS table_name, COUNT(*) AS rows FROM users
    UNION ALL
    SELECT 'campaigns', COUNT(*) FROM campaigns
    UNION ALL
    SELECT 'emails', COUNT(*) FROM emails
    UNION ALL
    SELECT 'subscribers', COUNT(*) FROM subscribers;
  "

# 6.3 数据一致性检查
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod \
  -c "
    -- 检查外键约束
    SELECT
      tc.table_name,
      tc.constraint_name,
      CASE WHEN tc.is_deferrable = 'NO' THEN 'NOT DEFERRABLE' ELSE 'DEFERRABLE' END
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
    LIMIT 10;
  "

# 6.4 API 端到端测试
curl -X GET http://localhost:3000/api/v1/campaigns \
  -H "Authorization: Bearer <test-token>" | python3 -m json.tool | head -20

# 6.5 Grafana 数据源连接测试
curl -sf http://localhost:3002/api/health
```

#### 回滚命令

```bash
# 如果恢复后发现使用了错误的备份,立即停止并选择正确的备份
docker stop globalreach-api-prod
./scripts/restore.sh "backups/correct-backup-file.tar.gz" --db -y
docker start globalreach-api-prod
```

#### 预期时间线

| 阶段 | 耗时 | 累计 |
|------|------|------|
| 紧急停止 API | 2s | 2s |
| 备份选择+验证 | 3-5 min | 5min |
| pg_restore 导入 | 5-10 min | 15min |
| 重启+验证 | 1-2 min | 17min |
| **总计** | | **~15-17 分钟** |

---

## 5. 演练报告模板

```markdown
# DR 演练报告 - #{DR-YYYY-MM-DD}

> **文档编号**: DR-#{YYYY-MM-DD}
> **演练场景**: [SC-XX]
> **执行人**: [姓名]
> **审核人**: [姓名]

## 基本信息

| 项目 | 内容 |
|------|------|
| **演练日期** | YYYY-MM-DD |
| **演练场景** | SC-XX (场景名称) |
| **参与人员** | - @person1 (主演练员)<br>- @person2 (观察员)<br>- @person3 (DBA) |
| **开始时间** | HH:MM:SS |
| **结束时间** | HH:MM:SS |
| **总耗时** | XX 分钟 XX 秒 |
| **演练环境** | ☐ 生产环境 ☐ 预发环境 ☐ 测试环境 |
| **使用的备份文件** | `globalreach_backup_YYYYMMDD_HHMMSS.tar.gz` |
| **备份年龄(RPO)** | XX 小时 |

## 检查清单

| # | 检查项 | 通过 | 备注 |
|---|--------|------|------|
| 1 | 备份可用性验证 | ☐ | verify-backup.sh 输出: ___ |
| 2 | 模拟灾难成功触发 | ☐ | 触发方法: ___ |
| 3 | 恢复流程按预期执行 | ☐ | 无错误/警告 |
| 4 | 服务完全恢复 | ☐ | 所有容器 Up 状态 |
| 5 | 数据完整性验证通过 | ☐ | 表数量/行数符合预期 |
| 6 | RTO 达标 (<X min) | ☐ | 实际: X min (目标: X min) |
| 7 | RPO 达标 (<X h) | ☐ | 实际: X h (目标: 24 h) |
| 8 | 无副作用产生 | ☐ | 无数据泄露/配置漂移 |

## RTO/RPO 实测数据

| 指标 | 目标值 | 实际值 | 达标? |
|------|--------|--------|-------|
| RTO | ≤ 2h (SC-04) / ≤ 30min (SC-02) / ≤ 5min (SC-01) | XX min | ☐ 是 ☐ 否 |
| RPO | ≤ 24h | XX h | ☐ 是 ☐ 否 |

## 详细时间线

| 时间戳 | 事件 | 耗时 |
|--------|------|------|
| HH:MM:SS | T-0: 开始灾难模拟 | - |
| HH:MM:SS | 灾难触发完成 | Xs |
| HH:MM:SS | 开始恢复流程 | - |
| HH:MM:SS | 备份解压完成 | Xs |
| HH:MM:SS | 数据导入完成 | Xm Xs |
| HH:MM:SS | 服务重启完成 | Xs |
| HH:MM:SS | 健康检查通过 | Xs |
| **总计** | | **Xm Xs** |

## 发现的问题

| # | 问题描述 | 严重程度 | 影响范围 | 建议 |
|---|----------|----------|----------|------|
| 1 | 示例: pg_restore 速度慢于预期 | Medium | SC-02 恢复时间 | 考虑并行恢复或增量备份 |
| 2 | ... | ... | ... | ... |

严重程度定义:
- **Critical**: 阻碍恢复流程,必须立即解决
- **High**: 显著影响 RTO,应在下次演练前解决
- **Medium**: 轻微影响效率,可在季度内优化
- **Low**: 改进建议,不影响当前目标

## 改进措施

| ID | 改进措施 | 优先级 | 负责人 | 截止日期 | 状态 |
|----|----------|--------|--------|----------|------|
| IMP-001 | ... | P0/P1/P2 | @user | YYYY-MM-DD | ☐ 待处理 ☐ 进行中 ☐已完成 |

## 经验教训

### 做得好的方面 ✓
1.
2.
3.

### 需要改进的方面 ✗
1.
2.
3.

### 意外收获 💡
1.
2.

## 附件

- [ ] 基线快照: `drill_snapshots/drill_YYYYMMDD_HHMMSS/`
- [ ] 执行日志: `drill_logs/drill_YYYYMMDD.log`
- [ ] 截图证据: `drill_evidence/YYYYMMDD/`
- [ ] 备份验证报告: `verify_output_YYYYMMDD.txt`

## 签署

| 角色 | 姓名 | 日期 | 签名 |
|------|------|------|------|
| 演练执行人 | | | |
| 技术审核 | | | |
| 管理批准 | | | |

---

**报告生成时间**: YYYY-MM-DD HH:MM:SS
**报告版本**: v1.0
```

---

## 6. DR 演练日历模板

### 6.1 年度演练计划

| 季度 | 演练月份 | 场景组合 | 风险等级 | 预计耗时 | 负责人 |
|------|----------|----------|----------|----------|--------|
| **Q1** | 3月 | **SC-01** (API崩溃) + **SC-05** (磁盘满) | 🟢 低 | 1-2 小时 | @oncall-primary |
| **Q2** | 6月 | **SC-02** (PG损坏) + **SC-03** (Redis丢失) | 🟠 中 | 2-3 小时 | @dba + @sre |
| **Q3** | 9月 | **SC-04** (宿主机故障) | 🔴 高 | 3-4 小时 | @sre-team |
| **Q4** | 12月 | **SC-06** (人为误操作) | 🟠 中 | 2-3 小时 | @dba + @security |

### 6.2 月度例行检查

除了季度演练,每月应执行:

| 周 | 任务 | 工具 | 耗时 |
|----|------|------|------|
| 第1周 | 备份完整性验证 | `./scripts/verify-backup.sh` | 5-10 min |
| 第2周 | 备份自动化检查 | 检查 cron/systemd timer 状态 | 5 min |
| 第3周 | 恢复脚本 dry-run | `./scripts/disaster-recovery-drill.sh` | 10-15 min |
| 第4周 | 监控告警验证 | 手动触发测试告警 | 10 min |

### 6.3 演练日历视图

```
2026 年 DR 演练日历
═══════════════════════════════════════════════════════════════

  一月                    二月                    三月
┌────┬────┬────┬────┐  ┌────┬────┬────┬────┐  ┌────┬────┬────┬────┐
│    │    │    │    │  │    │    │    │    │  │    │    │ Q1 │    │
│    │    │    │    │  │    │    │    │    │  │    │    │DR  │    │
│    │    │    │    │  │    │    │    │    │  │    │    │    │    │
└────┴────┴────┴────┘  └────┴────┴────┴────┘  └────┴────┴────┴────┘

  四月                    五月                    六月
┌────┬────┬────┬────┐  ┌────┬────┬────┬────┐  ┌────┬────┬────┬────┐
│    │    │    │    │  │    │    │    │    │  │    │    │ Q2 │    │
│    │    │    │    │  │    │    │    │    │  │    │    │DR  │    │
│    │    │    │    │  │    │    │    │    │  │    │    │    │    │
└────┴────┴────┴────┘  └────┴────┴────┴────┘  └────┴────┴────┴────┘

  七月                    八月                    九月
┌────┬────┬────┬────┐  ┌────┬────┬────┬────┐  ┌────┬────┬────┬────┐
│    │    │    │    │  │    │    │    │    │  │    │    │ Q3 │    │
│    │    │    │    │  │    │    │    │    │  │    │    │DR  │    │
│    │    │    │    │  │    │    │    │    │  │    │    │    │    │
└────┴────┴────┴────┘  └────┴────┴────┴────┘  └────┴────┴────┴────┘

  十月                    十一月                   十二月
┌────┬────┬────┬────┐  ┌────┬────┬────┬────┐  ┌────┬────┬────┬────┐
│    │    │    │    │  │    │    │    │    │  │    │    │ Q4 │    │
│    │    │    │    │  │    │    │    │    │  │    │    │DR  │    │
│    │    │    │    │  │    │    │    │    │  │    │    │    │    │
└────┴────┴────┴────┘  └────┴────┴────┴────┘  └────┴────┴────┴────┘

═══════════════════════════════════════════════════════════════
图例: Q1-Q4 = 季度演练  DR = Disaster Recovery Drill
═══════════════════════════════════════════════════════════════
```

### 6.4 特殊情况处理

| 情况 | 处理方式 |
|------|----------|
| 演练日遇到真实故障 | **暂停演练**,优先处理真实故障,事后补演 |
| 关键人员缺席 | **推迟演练**或指定代理人(需提前授权) |
| 备份验证失败 | **取消演练**,先修复备份问题,再重新安排 |
| 演练中发现严重缺陷 | **立即停止**,记录问题,修复后再演 |
| 监控系统本身故障 | **降级演练**,仅执行脚本验证,跳过监控验证 |

---

## 7. 通讯模板

### 7.1 演练通知邮件 (T-7 天)

```markdown
Subject: [DR 演练通知] GlobalReach V2.0 灾难恢复演练 - {日期}

Dear Team,

这是一次预先安排的**灾难恢复(DR)演练通知**。

📅 **演练信息**
━━━━━━━━━━━━━━━━━━━
• 日期: {YYYY年MM月DD日}
• 时间窗口: {HH:MM} - {HH:MM} ({时区})
• 场景: SC-{XX} ({场景名称})
• 风险等级: {低/中/高}
• 环境: {生产/预发/测试}

🎯 **演练目标**
━━━━━━━━━━━━━━━━━━━
本次演练将模拟 {简要描述场景},验证我们的恢复流程能否在目标时间内完成。

预期影响:
• RTO 目标: {X 分钟}
• RPO 目标: {X 小时}
• 服务中断时长: {预计 X 分钟}(如有)

⚠️ **注意事项**
━━━━━━━━━━━━━━━━━━━
1. 这是一次**计划内的演练活动**,不是真实故障
2. 演练期间可能会出现短暂的服务中断或降级
3. 如遇真实紧急事件,演练将立即中止
4. 所有操作将在 {时间段} 窗口内完成
5. 演练完成后会发送总结邮件

📋 **参与人员**
━━━━━━━━━━━━━━━━━━━
• 主演练员: {姓名}
• 观察员: {姓名}
• DBA 支持: {姓名}
• 紧急联系人: {姓名} ({电话})

📚 **参考文档**
━━━━━━━━━━━━━━━━━━━
• 演练计划: docs/DISASTER_RECOVERY_DRILL_PLAN.md
• 备份策略: docs/REMOTE_BACKUP_STRATEGY.md
• 回滚程序: docs/ROLLBACK_PROCEDURE.md

如有疑问或 concerns,请在演练前回复此邮件或在 {Slack频道} 讨论。

Best regards,
{您的姓名}
GlobalReach DevOps Team

---
🔖 此邮件标记: [DRILL] [NOTIFICATION] [SCHEDULED]
```

### 7.2 演练中状态更新 (T+进行中)

```markdown
Subject: [DR 演练进行中] SC-{XX} 状态更新 - {当前阶段}

Team,

**DR 演练实时状态更新**

📍 **当前阶段**: Step {X}/{8} - {阶段名称}
⏰ **当前时间**: {HH:MM:SS}
⏱️ **已耗时**: {X 分 X 秒}

📊 **进度**:
━━━━━━━━━━━━━━━━━━━
✅ Step 1: 演练准备 — 完成
✅ Step 2: 基线快照 — 完成
🔄 Step 3: 灾难模拟 — **进行中**
   • 触发命令: `{具体命令}`
   • 当前状态: {描述}
⏳ Step 4: 启动恢复 — 待执行
⏳ Step 5: 验证恢复 — 待执行
...

📝 **备注**:
{任何异常、偏差或观察}

🆘 **如需中止演练**:
回复邮件主题包含 [ABORT] 或联系紧急联系人: {电话}

---
🔖 此邮件标记: [DRILL] [IN-PROGRESS] [UPDATE]
```

### 7.3 演练完成总结 (T+完成)

```markdown
Subject: [DR 演练完成] SC-{XX} 演练报告 - {结论: 通过/有条件通过/未通过}

Team,

**GlobalReach V2.0 DR 演练完成总结**

✅ **演练基本信息**
━━━━━━━━━━━━━━━━━━━
• 场景: SC-{XX} ({场景名称})
• 日期: {YYYY-MM-DD}
• 时间: {HH:MM} - {HH:MM}
• 总耗时: {X 分钟}
• 环境: {生产/预发/测试}

📊 **演练结果**
━━━━━━━━━━━━━━━━━━━
结论: **{● PASS (通过) / ● WARN (有条件通过) / ● FAIL (未通过)}**

RTO 实测: {X 分钟} (目标: ≤{X}分钟) → {达标/未达标}
RPO 实测: {X 小时} (目标: ≤24小时) → {达标/未达标}

检查清单:
☑ 备份可用性验证: 通过
☑ 灾难模拟触发: 通过
☑ 恢复流程执行: {通过/部分通过/失败}
☑ 服务完全恢复: {通过/失败}
☑ 数据完整性: {通过/部分通过/失败}
☑ RTO 达标: {是/否}
☑ RPO 达标: {是/否}
☑ 无副作用: {是/否}

🐛 **发现的问题** ({X}个)
━━━━━━━━━━━━━━━━━━━
1. [{严重程度}] {问题描述} — {建议措施}
2. ...

💡 **经验教训**
━━━━━━━━━━━━━━━━━━━
**做得好的**:
• {列举}

**需要改进的**:
• {列举}

📋 **后续行动**
━━━━━━━━━━━━━━━━━━━
| ID | 行动项 | 负责人 | 截止日期 |
|----|--------|--------|----------|
| IMP-001 | {行动描述} | @{user} | {日期} |

📎 **附件**
━━━━━━━━━━━━━━━━━━━
• 完整报告: docs/DR_DRILL_REPORT_{YYYY-MM-DD}.md
• 执行日志: drill_logs/{filename}.log
• 截图证据: drill_evidence/{folder}/

📅 **下次演练计划**
━━━━━━━━━━━━━━━━━━━
• 预计日期: {YYYY年MM月DD日}
• 预计场景: SC-{XX}

感谢所有参与人员的配合!

---
🔖 此邮件标记: [DRILL] [COMPLETED] [REPORT]
```

### 7.4 真实事件 vs 演练区分机制

为确保团队和外部利益相关者能够明确区分**真实故障**和**计划内演练**,采用以下标识体系:

#### 邮件标题标识

| 类型 | 标题前缀 | 示例 |
|------|----------|------|
| **真实故障** | `[PRODUCTION INCIDENT]` 或 `[P1]` | `[P1] API 服务不可用 - 紧急` |
| **DR 演练** | `[DR 演练]` 或 `[DRILL]` | `[DR 演练] SC-02 演练通知` |
| **测试通知** | `[TEST]` 或 `[STAGING]` | `[TEST] 预发环境部署` |

#### 通信渠道标识

| 渠道 | 真实事件 | 演练活动 |
|------|----------|----------|
| **Slack/Teams** | 🔴 `#incidents` 频道 | 🟡 `#dr-drills` 频道 |
| **邮件** | 高优先级,抄送管理层 | 标准优先级,仅技术团队 |
| **短信/电话** | 立即拨打 | 仅在演练超时或失控时使用 |
| **监控系统** | P0/P1 告警级别 | **静音或降级为 P4** |

#### 演练期间的监控处理

```bash
# 演练前: 静默相关告警(避免误报)
# 方法 1: AlertManager 静默
curl -X POST http://localhost:9093/api/v2/silences \
  -H "Content-Type: application/json" \
  -d '{
    "matchers": [
      {"name": "alertname", "value": ".*", "isRegex": true}
    ],
    "startsAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "endsAt": "'$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%SZ)'",
    "createdBy": "drill-scenario-XX",
    "comment": "DR Drill Silence - SC-XX"
  }'

# 方法 2: Prometheus 临时修改规则(不推荐,容易忘记还原)
# 演练结束后务必取消静默!
```

#### 紧急终止信号

如果演练期间发生真实故障,立即:

1. **发送终止邮件**: 标题包含 `[ABORT DRILL]`
2. **Slack 消息**: `@channel 🚨 ABORT DRILL - Real incident detected`
3. **电话联系**: 紧急联系人
4. **立即回滚**: 执行预准备的回滚方案
5. **取消静默**: 恢复所有告警

```bash
# 终止演练的标准操作序列
#!/bin/bash
# abort_drill.sh — 紧急终止演练脚本

echo "🚨 [ABORT] DR 演练紧急终止!"

# 1. 取消 AlertManager 静默
SILENCE_ID=$(curl -sf http://localhost:9093/api/v2/silenses | \
  python3 -c "import sys,json; silences=json.load(sys.stdin); \
  print([s['id'] for s in silences if 'drill' in str(s.get('comment','')).lower()][0])" 2>/dev/null)

if [ -n "$SILENCE_ID" ]; then
  curl -X DELETE "http://localhost:9093/api/v2/silences/${SILENCE_ID}"
  echo "✓ 已取消告警静默"
fi

# 2. 执行回滚(如果有)
if [ -f "rollback_plan.sh" ]; then
  bash rollback_plan.sh
  echo "✓ 回滚完成"
fi

# 3. 发送通知
echo "请立即通知团队: 演练已中止,转入真实故障响应模式"
```

---

## 8. 与现有资产的关系

### 8.1 引用的文档和脚本

| 资产编号 | 名称 | 用途 | 本文档中的引用位置 |
|----------|------|------|---------------------|
| **M-D06** | `scripts/backup.sh` | 远程备份策略脚本 | §1.2 备份范围, §4.2-4.6 恢复步骤 |
| **M-D06** | `scripts/restore.sh` | 数据恢复脚本 | §4.2-4.6 恢复命令, §3.5 Step 4 |
| **M-D04** | `scripts/disaster-recovery-drill.sh` | DR 演练脚本(隔离环境) | §3.5 备选验证, §6.2 月度检查 |
| **M-D04** | `scripts/verify-backup.sh` | 备份完整性验证 | §3.2 Step 1.2, §4.2-4.6 验证步骤 |
| **M-C02** | `docs/SECURITY_KEY_ROTATION_POLICY.md` | 密钥轮换策略 | §1.3 排除项, §4.4 备机切换 |
| **v6.0 §8** | `docs/ROLLBACK_PROCEDURE.md` | 回滚程序(协议第八节) | §3.2 Step 1.3, §4.1-4.6 回滚命令 |
| **S071** | `docker-compose.prod.yml` | 生产环境编排 | §1.2 组件清单, §4.4 恢复命令 |

### 8.2 脚本调用关系图

```
DISASTER_RECOVERY_DRILL_PLAN.md (本文档)
│
├──► scripts/backup.sh (M-D06)
│    │
│    ├── 备份内容: PostgreSQL | Redis | Grafana | Nginx | Config
│    ├── 输出: globalreach_backup_YYYYMMDD_HHMMSS.tar.gz
│    └── 校验: SHA256 (.sha256 文件)
│
├──► scripts/restore.sh (M-D06)
│    │
│    ├── 参数: [--db|--redis|--grafana|--nginx|--config|--all] [-y]
│    ├── 流程: 校验 → 解压 → 停止容器 → 恢复数据 → 启动容器
│    └── 交互: 确认提示(可用 -y 跳过)
│
├──► scripts/verify-backup.sh (M-D04)
│    │
│    ├── 检查: SHA256 | tar.gz | 文件存在性 | SQL可恢复性 | 年龄 | 大小趋势 | 磁盘空间
│    └── 输出: PASS/WARN/FAIL + JSON(可选)
│
├──► scripts/disaster-recovery-drill.sh (M-D04)
│    │
│    ├── 环境: /tmp/globalreach_drill_* (隔离,不影响生产)
│    ├── 验证: PG(dry-run) | Redis(RDB) | Grafana(SQLite) | Nginx(config) | Compose
│    └── 输出: PASS/WARN/FAIL 统计 + 自动清理
│
└──► docker-compose.prod.yml (S071)
     │
     ├── 13 个服务容器定义
     ├── 9 个命名卷(volumes)
     └── 1 个外部网络(network)
```

### 8.3 数据流示意

```
生产环境                          备份存储                    演练环境
┌─────────────────┐              ┌───────────┐              ┌─────────────┐
│ docker-compose  │──backup.sh──▶│ backups/  │──verify.sh──▶│ /tmp/drill_ │
│   (13 containers)│              │ *.tar.gz  │              │   XXXX/     │
│                 │◀──restore.sh──│ *.sha256  │              │ (隔离验证)  │
│  PostgreSQL 15  │              └───────────┘              └─────────────┘
│  Redis 7.4.9    │                                            │
│  Grafana 13.0.2 │◀───────────────────────────────────────────┘
│  Nginx 1.31.1   │         (disaster-recovery-drill.sh)
│  ...            │
└─────────────────┘
```

### 8.4 版本兼容性说明

| 组件 | 本文档适用版本 | 备注 |
|------|---------------|------|
| backup.sh | M-D06 (2026-06-09) | 基于 docker-compose.prod.yml 容器名 |
| restore.sh | M-D06 (2026-06-09) | 支持 --component 选择恢复 |
| verify-backup.sh | M-D04 (2026-06-09) | 支持 --json 输出 |
| disaster-recovery-drill.sh | M-D04 (2026-06-09) | 隔离环境,安全执行 |
| docker-compose.prod.yml | S071 (13 容器) | PostgreSQL 15, Redis 7.4.9, Nginx 1.31.1 |

### 8.5 文档维护指南

| 维护动作 | 触发条件 | 负责人 |
|----------|----------|--------|
| **内容更新** | 基础设施变更、新增容器、备份策略调整 | DevOps |
| **场景补充** | 发现新的故障模式、历史事件复盘 | SRE |
| **流程优化** | 演练回顾改进措施落地 | Tech Lead |
| **年度审查** | 每年 Q4 结合全年演练总结 | Architecture |
| **紧急修订** | 真实故障暴露预案缺陷 | On-call |

---

## 附录

### A. 快速参考卡片

打印此页供演练现场快速查阅:

```
╔══════════════════════════════════════════════════════════════╗
║         GlobalReach V2.0 — DR 演练快速参考卡                  ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  【常用命令】                                                 ║
║                                                              ║
║  验证备份:  ./scripts/verify-backup.sh                        ║
║  执行演练:  ./scripts/disaster-recovery-drill.sh              ║
║  全量恢复:  ./scripts/restore.sh <backup> --all -y            ║
║  仅PG恢复:  ./scripts/restore.sh <backup> --db -y             ║
║  仅Redis:   ./scripts/restore.sh <backup> --redis -y          ║
║                                                              ║
║  【RTO 目标】                                                 ║
║  SC-01 API崩溃:    < 5 min                                   ║
║  SC-02 PG损坏:     < 30 min                                  ║
║  SC-03 Redis丢失:  < 10 min                                  ║
║  SC-04 宿主机故障: < 2 h                                     ║
║  SC-05 磁盘满:     < 30 min                                  ║
║  SC-06 人为误操作:  < 15 min                                 ║
║                                                              ║
║  【紧急联系人】                                               ║
║  On-call Primary:  _________________                          ║
║  On-call Backup:   _________________                          ║
║  DBA:              _________________                          ║
║  Manager:          _________________                          ║
║                                                              ║
║  【中止演练】                                                 ║
║  邮件: [ABORT DRILL] + 电话通知                               ║
║  Slack: @channel 🚨 ABORT DRILL                              ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

### B. 故障诊断决策树

```
服务不可用?
    │
    ├─► 检查容器状态: docker ps
    │       │
    │       ├─ 容器未运行 ──► docker restart <container>
    │       │                      │
    │       │                      ├─ 成功 ──► 验证健康检查
    │       │                      └─ 失败 ──► 查看日志: docker logs <container>
    │       │
    │       └─ 容器运行中 ──► 检查健康检查
    │                           │
    │                           ├─ healthy ──► 检查网络/依赖
    │                           │                │
    │                           │                ├─ DNS/端口 ──► 检查 nginx 配置
    │                           │                └─ 上游服务 ──► 检查 postgres/redis
    │                           │
    │                           └─ unhealthy ──► 查看日志 + 检查资源(CPU/内存/磁盘)
    │
    └─► Docker daemon 异常?
            │
            ├─ 是 ──► SC-04 流程(宿主机恢复)
            │
            └─ 否 ──► 按组件排查:
                    ├─ PostgreSQL ──► SC-02 流程(数据恢复)
                    ├─ Redis ──► SC-03 流程(缓存恢复)
                    ├─ 磁盘空间 ──► SC-05 流程(清理扩容)
                    └─ 数据丢失 ──► SC-06 流程(紧急恢复)
```

### C. 术语表

| 术语 | 全称 | 定义 |
|------|------|------|
| **DR** | Disaster Recovery | 灾难恢复 |
| **RTO** | Recovery Time Objective | 恢复时间目标(从中断到恢复的最长时间) |
| **RPO** | Recovery Point Objective | 恢复点目标(最大可接受的数据丢失量) |
| **SOP** | Standard Operating Procedure | 标准操作程序 |
| **MTTR** | Mean Time To Repair | 平均修复时间 |
| **MTBF** | Mean Time Between Failures | 平均故障间隔时间 |
| **SLA** | Service Level Agreement | 服务水平协议 |
| **P0/P1/P2** | Priority 0/1/2 | 优先级(0=最高,紧急) |
| **Failover** | - | 故障转移(从主节点切换到备节点) |
| **Rollback** | - | 回滚(恢复到之前的状态) |
| **Dry-run** | - | 试运行(不实际执行,仅验证) |
| **Baseline** | - | 基线(用作对比参照的正常状态) |

---

> **文档结束**
>
> **最后更新**: 2026-06-09
> **下次审查日期**: 2026-09-09 (Q3 演练后)
> **审批状态**: ✅ 已批准
>
> © 2026 GlobalReach V2.0 Project. All rights reserved.
