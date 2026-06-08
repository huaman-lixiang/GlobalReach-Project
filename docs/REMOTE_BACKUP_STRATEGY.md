# GlobalReach V2.0 — 远程备份策略 (M-D06)

> **文档版本**: v1.0 | **生效日期**: 2026-06-08 | **运维阶段**: S128/M-D06

---

## 1. 备份架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                    GlobalReach V2.0 备份架构                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────── 每日 02:00 自动触发 ───────────────┐              │
│  │                                                  │              │
│  │   Windows Task Scheduler / WSL2 Cron              │              │
│  │         │                                        │              │
│  │         ▼                                        │              │
│  │  ┌──────────────────────┐                        │              │
│  │  │   scripts/backup.sh  │ ◄── Docker-aware 备份引擎 │              │
│  │  └──────────┬───────────┘                        │              │
│  │             │                                    │              │
│  │    ┌────────┼────────┬──────────┬────────┐      │              │
│  │    ▼        ▼        ▼          ▼        ▼      │              │
│  │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │              │
│  │ │PostgreSQL│ Redis │ Grafana│ Nginx │ Config│  │              │
│  │ │ pg_dump │ BGSAVE│ API+Vol│ SSL+CF│ yml   │  │              │
│  │ │ SQL+Custom│ RDB/AOF│ .db  │ certs │ rules │  │              │
│  │ └───┬───┘ └───┬──┘ └───┬──┘ └───┬──┘ └───┬──┘  │              │
│  │     └────────┴────────┴────────┴────────┘      │              │
│  │                      │                         │              │
│  │                      ▼                         │              │
│  │           globalreach_backup_YYYYMMDD_HHMMSS.tar.gz             │
│  │                      │                         │              │
│  │            ┌─────────┴─────────┐               │              │
│  │            ▼                   ▼               │              │
│  │     本地存储 (30天)       GPG加密 (可选)         │              │
│  │     C:\backups\globalreach\                    │              │
│  │                                                │              │
│  └────────────────────────────────────────────────┘              │
│                        │                                         │
│         ┌──────────────┼──────────────┐                           │
│         ▼              ▼              ▼                           │
│   ┌──────────┐  ┌──────────┐  ┌──────────────┐                    │
│   │ 异地传输  │  │ 云存储   │  │ 校验 & 告警  │                    │
│   │ rsync/   │  │ S3/OSS  │  │ SHA256 +     │                    │
│   │ SFTP     │  │ Azure   │  │ Grafana Alert│                    │
│   └──────────┘  └──────────┘  └──────────────┘                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

数据流:
  [Docker容器] → [backup.sh采集] → [tar.gz打包] → [本地存储] → [异地同步]
```

---

## 2. RTO/RPO 目标定义

| 指标 | 目标值 | 说明 |
|------|--------|------|
| **RPO (Recovery Point Objective)** | ≤ 24 小时 | 每日备份，最大数据丢失量 = 1天增量 |
| **RTO (Recovery Time Objective)** | ≤ 2 小时 | 从检测故障到完全恢复服务的时间上限 |
| **备份窗口** | 02:00 - 04:00 | 低峰期执行，避免影响业务 |
| **保留周期** | 30 天（本地） + 90 天（异地） | 符合企业合规要求 |

### 分组件恢复时间估算

| 组件 | 恢复操作 | 预估时间 |
|------|----------|----------|
| PostgreSQL | `pg_restore` 导入 | ~10-30 分钟 |
| Redis | 替换 RDB 文件 + 重启 | ~2-5 分钟 |
| Grafana | 替换 grafana.db + 重启 | ~3-5 分钟 |
| Nginx/SSL | 配置替换 + reload | ~1-2 分钟 |
| 全栈恢复 | 以上全部 + 服务验证 | ~30-60 分钟 |

---

## 3. 备份内容清单及大小估算

### 3.1 数据库层

| 组件 | 容器名 | Volume | 备份方式 | 初始估算 | 运行6月后估算 |
|------|--------|--------|----------|----------|---------------|
| PostgreSQL 15 | `globalreach-postgres` | `postgres_data` | `pg_dump` custom + SQL | ~500 KB | ~50-200 MB |
| - 11张业务表 | - | - | 含 schema + data + indexes | - | - |
| Redis 7 | `globalreach-redis` | `redis_data` | BGSAVE → docker cp RDB | ~100 KB | ~5-50 MB |

### 3.2 监控/可观测性层

| 组件 | 容器名 | Volume | 备份方式 | 估算大小 |
|------|--------|--------|----------|----------|
| Grafana | `globalreach-grafana` | `grafana_data` | grafana.db + provisioning | ~5-20 MB |
| Prometheus | `globalreach-prometheus` | `prometheus_data` | 配置文件 (yml/rules) | ~50 KB |
| Loki | `globalreach-loki` | `loki_data` | 配置文件 | ~10 KB |
| Tempo | `globalreach-tempo` | `tempo_data` | 配置文件 | ~10 KB |
| Alertmanager | `globalreach-alertmanager` | `alertmanager_data` | 配置文件 | ~5 KB |

### 3.3 基础设施层

| 内容 | 路径 | 估算大小 | 敏感性 |
|------|------|----------|--------|
| Nginx 主配置 | `nginx/nginx.conf` | ~2 KB | 低 |
| 站点配置 | `nginx/conf.d/` | ~5 KB | 低 |
| GlobalReach SSL证书 | `nginx/ssl/globalreach/` | ~4 KB | **高** |
| Let's Encrypt 证书 | `nginx/ssl/letsencrypt/` | ~10 KB | **高** |
| docker-compose.prod.yml | 项目根目录 | ~8 KB | 中 |
| Dockerfile | 项目根目录 | ~3 KB | 低 |
| Prometheus 规则 | `prometheus/rules/` | ~15 KB | 中 |

### 3.4 单次全量备份总估算

| 阶段 | 大小范围 |
|------|----------|
| 初期部署（空数据库） | ~1-2 MB |
| 运行 1 个月 | ~20-50 MB |
| 运行 6 个月 | ~100-300 MB |
| 运行 1 年 | ~200-500 MB |
| **压缩后 tar.gz** | **约原始大小的 60-70%** |

> **注意**: Prometheus/Loki/Tempo 的时序数据 volume 不在常规备份范围内（体量过大，通过各自保留策略管理）。仅备份其**配置文件**。

---

## 4. 恢复演练步骤

### 4.1 定期演练计划

- **频率**: 每季度一次完整演练
- **负责人**: DevOps / 运维工程师
- **演练环境**: 预生产环境 或 独立恢复测试机

### 4.2 完整恢复演练流程

```
阶段 0: 准备
├── 0.1 准备一台干净的 Windows Server / WSL2 环境
├── 0.2 安装 Docker Desktop + Docker Compose
├── 0.3 克隆项目代码: git clone <repo>
└── 0.4 准备最新备份文件 tar.gz

阶段 1: 基础设施恢复 (~15 min)
├── 1.1 恢复 docker-compose.prod.yml
│   $ ./scripts/restore.sh backup.tar.gz --config
├── 1.2 恢复 Nginx 配置和SSL证书
│   $ ./scripts/restore.sh backup.tar.gz --nginx
├── 1.3 启动基础服务
│   $ docker compose -f docker-compose.prod.yml up -d postgres redis nginx
└── 1.4 验证基础服务健康状态

阶段 2: 数据恢复 (~20 min)
├── 2.1 恢复 PostgreSQL 数据库
│   $ ./scripts/restore.sh backup.tar.gz --db
│   → 验证: docker exec postgres psql -c "\dt"
├── 2.2 恢复 Redis 缓存
│   $ ./scripts/restore.sh backup.tar.gz --redis
│   → 验证: docker exec redis redis-cli DBSIZE
└── 2.3 恢复 Grafana Dashboard
    $ ./scripts/restore.sh backup.tar.gz --grafana
    → 验证: curl localhost:3002/api/health

阶段 3: 全栈启动与验证 (~10 min)
├── 3.1 启动全部服务
│   $ docker compose -f docker-compose.prod.yml up -d
├── 3.2 健康检查端到端验证
│   ├── http://localhost:3000/api/v1/health  (API)
│   ├── http://localhost:80                  (Nginx)
│   ├── http://localhost:443                 (HTTPS)
│   ├── http://localhost:3002                (Grafana)
│   └── http://localhost:9090                (Prometheus)
├── 3.3 业务功能抽检
│   ├── 用户登录/注册
│   ├── 邮件营销发送
│   └── Dashboard 数据展示
└── 3.4 记录演练报告 (RTO实测值)

阶段 4: 清理
├── 4.1 销毁演练环境（如为临时环境）
└── 4.2 归档演练报告
```

### 4.3 选择性恢复场景

```bash
# 场景A: 仅数据库损坏 → 只恢复PostgreSQL
./scripts/restore.sh globalreach_backup_20260608_020000.tar.gz --db

# 场景B: Redis缓存异常 → 只恢复Redis
./scripts/restore.sh globalreach_backup_20260608_020000.tar.gz --redis

# 场景C: SSL证书过期 → 只恢复Nginx配置
./scripts/restore.sh globalreach_backup_20260608_020000.tar.gz --nginx

# 场景D: Grafana Dashboard丢失 → 只恢复Grafana
./scripts/restore.sh globalreach_backup_20260608_020000.tar.gz --grafana

# 场景E: 全量灾难恢复
./scripts/restore.sh globalreach_backup_20260608_020000.tar.gz --all

# 先查看备份内容再决定
./scripts/restore.sh --list globalreach_backup_20260608_020000.tar.gz
```

---

## 5. 异地传输方案

### 5.1 方案对比

| 方案 | 适用场景 | 加密 | 带宽需求 | 复杂度 | 推荐度 |
|------|----------|------|----------|--------|--------|
| **rsync over SSH** | 自建异地服务器 | SSH传输加密 | 中（增量同步友好） | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **SFTP / SCP** | 小规模/手动 | SSH传输加密 | 高（全量每次） | ⭐ | ⭐⭐⭐ |
| **云存储 S3** | AWS生态 | TLS + SSE-S3 | 低 | ⭐⭐ | ⭐⭐⭐⭐ |
| **阿里云 OSS** | 国内合规 | TLS + 服务端加密 | 低 | ⭐⭐ | ⭐⭐⭐⭐ |
| **Azure Blob** | Microsoft生态 | TLS + 加密 | 低 | ⭐⭐ | ⭐⭐⭐ |
| **rclone 多后端** | 混合云/多云 | 可选 GPG | 低 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

### 5.2 推荐方案: rclone + 云存储

#### 5.2.1 rclone 安装与配置

```bash
# 安装 rclone (Windows)
winget install rclone.rclone

# 或 Linux/WSL2
curl https://rclone.org/install.sh | bash

# 配置远程存储 (以阿里云 OSS 为例)
rclone config
# → 选择 oss / s3 / azureblob 等
# → 输入 access_key_id, access_key_secret
# → 设置 endpoint (如 oss-cn-hangzhou.aliyuncs.com)
# → 命名为: globalreach-backup-remote
```

#### 5.2.2 异步同步脚本示例

```bash
#!/bin/bash
# scripts/sync-remote.sh — 异地备份同步脚本
# 在 backup.sh 执行完成后调用，或独立定时任务

LOCAL_BACKUP_DIR="C:/backups/globalreach"
REMOTE_NAME="globalreach-backup-remote"
REMOTE_PATH="globalreach-backup/archives/"
LOG_FILE="logs/remote_sync_$(date +%Y%m%d).log"

echo "[$(date)] 开始异地同步..." | tee -a "$LOG_FILE"

# 使用 rclone copy（不删除远端旧文件，保留历史）
rclone copy "$LOCAL_BACKUP_DIR" "${REMOTE_NAME}:${REMOTE_PATH}" \
    --include "globalreach_backup_*.tar.gz*" \
    --include "*.sha256" \
    --transfers 4 \
    --log-file="$LOG_FILE" \
    --progress

# 可选: 同步时使用 GPG 加密
# rclone crypt 远程加密存储配置:
#   rclone remote create: globalreach-crypt
#   -> type = crypt
#   -> remote = globalreach-backup-remote:globalreach-backup/
#   -> filename_encryption = standard
#   -> password = <强密码>

SYNC_EXIT=$?
if [ $SYNC_EXIT -eq 0 ]; then
    echo "[$(date)] 异地同步成功" | tee -a "$LOG_FILE"
else
    echo "[$(date)] 异地同步失败! exit=$SYNC_EXIT" | tee -a "$LOG_FILE"
    # 发送告警 (可通过 Grafana Alertmanager webhook)
fi
```

#### 5.2.3 rsync 方案 (自建服务器)

```bash
#!/bin/bash
# 通过 rsync + SSH 推送到异地备份服务器
# 前提: 已配置 SSH key 免密登录

REMOTE_USER="backup_user"
REMOTE_HOST="backup.example.com"
REMOTE_DIR="/data/backups/globalreach/"
LOCAL_DIR="/backups/globalreach/"

rsync -avz \
    --progress \
    --delete \
    -e "ssh -p 22 -i ~/.ssh/backup_ed25519" \
    ${LOCAL_DIR} \
    ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}
```

### 5.3 传输调度建议

| 操作 | 频率 | 时间 | 方式 |
|------|------|------|------|
| 本地备份生成 | 每日 | 02:00 | Task Scheduler → backup.sh |
| 异地全量同步 | 每日 | 03:00 | rclone copy (备份完成后) |
| 异地增量同步 | 每6小时 | */6 | rclone sync (仅新增) |
| 一致性校验 | 每周 | 日 04:00 | SHA256 对比 |

---

## 6. 加密方案 (GPG)

### 6.1 为什么需要加密

备份文件包含:
- **SSL/TLS 私钥** (nginx/ssl/) — 泄露可导致中间人攻击
- **数据库完整数据** — 包含用户信息、邮件内容、客户资料
- **Grafana 配置** — 包含 SMTP 密码等敏感信息
- **API 密钥/连接串** — 如存在于配置中

### 6.2 GPG 加密实施

#### 6.2.1 生成 GPG 密钥对

```bash
# 生成专用备份加密密钥 (建议在离线/安全机器上操作)
gpg --full-generate-key
# 选择: (1) RSA and RSA
# 密钥长度: 4096
# 过期时间: 2y (定期轮换)
# 姓名: GlobalReach Backup Encryptor
# 邮箱: backup-encrypt@globalreach.com

# 导出公钥 (用于加密)
gpg --armor --export backup-encrypt@globalreach.com > backup-public.asc

# 导出私钥 (安全保管! 用于解密恢复)
gpg --armor --export-secret-keys backup-encrypt@globalreach.com > backup-private.asc
# → 存储到安全的密码管理器或硬件安全模块(HSM)
```

#### 6.2.2 使用 backup.sh 内置加密

```bash
# 方式一: 环境变量触发加密
ENCRYPT=true \
GPG_RECIPIENT="backup-encrypt@globalreach.com" \
./scripts/backup.sh

# 输出: globalreach_backup_YYYYMMDD_HHMMSS.tar.gz.gpg
```

#### 6.2.3 手动加解密

```bash
# 加密已有备份
gpg --trust-model always --batch --yes \
    --output backup.tar.gz.gpg \
    --encrypt --recipient backup-encrypt@globalreach.com \
    backup.tar.gz

# 解密 (需要私钥)
gpg --output backup.tar.gz --decrypt backup.tar.gz.gpg

# 解密并直接恢复 (管道操作)
gpg --decrypt backup.tar.gz.gpg | tar -xz
```

#### 6.2.4 密钥管理最佳实践

| 实践 | 要求 |
|------|------|
| 私钥存储 | 硬件令牌 (YubiKey) 或 离线冷存储 |
| 公钥分发 | 备份服务器、运维团队成员 |
| 密钥轮换 | 每 2 年更换一次 |
| 访问控制 | 最小权限原则，仅授权人员持有私钥 |
| 应急预案 | 将私钥拆分 Shamir Secret Sharing 给3人 |

---

## 7. 监控与告警

### 7.1 备份健康指标

在 Prometheus + Grafana 中监控以下指标:

| 指标 | 采集方式 | 告警阈值 |
|------|----------|----------|
| 备份文件大小 | `stat` backup dir | 连续3天 < 1MB 则告警 |
| 备份时间戳 | 文件修改时间 | 超过 26h 未更新则告警 |
| 备份SHA256校验 | 脚本输出解析 | 校验失败立即告警 |
| 磁盘空间 | node_exporter | < 20% 可用空间则告警 |
| 异地同步延迟 | rclone 日志 | > 24h 未同步则告警 |

### 7.2 Grafana Alertmanager 通知路由

利用现有 Alertmanager 配置 (`alertmanager.yml`)，添加备份相关告警:

```yaml
# 建议添加到 alertmanager 路由
- match:
    severity: backup
  receiver: backup-alert
  continue: true
```

---

## 8. 文件清单

| 文件 | 用途 |
|------|------|
| `scripts/backup.sh` | 主备份脚本 (Docker-aware, 7步骤) |
| `scripts/restore.sh` | 恢复脚本 (选择性/全量) |
| `scripts/schedule-backup.ps1` | Windows Task Scheduler 注册脚本 |
| `docs/REMOTE_BACKUP_STRATEGY.md` | 本文档 (你正在阅读) |
| `scripts/s079-backup.ps1` | 已有的 PowerShell 备份脚本 (兼容保留) |

---

## 9. 快速参考

```bash
# 手动执行一次备份
cd C:\Users\Administrator\Documents\trae_projects\GlobalReach-Project
bash scripts/backup.sh

# 注册 Windows 定时任务
powershell -ExecutionPolicy Bypass -File scripts\schedule-backup.ps1

# 查看备份内容
bash scripts/restore.sh --list backups/globalreach_backup_20260608_020000.tar.gz

# 恢复数据库 (交互确认)
bash scripts/restore.sh backups/globalreach_backup_20260608_020000.tar.gz --db

# 全量恢复
bash scripts/restore.sh backups/globalreach_backup_20260608_020000.tar.gz --all

# 加密备份
ENCRYPT=true GPG_RECIPIENT=you@example.com bash scripts/backup.sh

# 清理旧备份 (保留30天)
find ./backups/ -name "globalreach_backup_*" -mtime +30 -delete
```
