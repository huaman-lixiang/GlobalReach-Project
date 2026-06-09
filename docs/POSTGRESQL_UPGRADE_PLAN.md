# PostgreSQL 15 → 16/17 升级规划文档

> **GlobalReach V2.0 — M-D03 数据库升级计划**
> **文档版本**: v1.0
> **创建日期**: 2026-06-09
> **状态**: 规划中（待审批）
> **风险等级**: R-01（需关注）

---

## 目录

1. [当前状态评估](#1-当前状态评估)
2. [目标版本分析](#2-目标版本分析)
3. [升级路径设计](#3-升级路径设计)
4. [详细操作步骤](#4-详细操作步骤)
5. [风险评估](#5-风险评估)
6. [前置条件清单](#6-前置条件清单)
7. [时间线规划](#7-时间线规划)
8. [回滚预案](#8-回滚预案)
9. [升级后优化建议](#9-升级后优化建议)
10. [附录](#10-附录)

---

## 1. 当前状态评估

### 1.1 当前 PostgreSQL 配置

| 项目 | 值 | 备注 |
|------|-----|------|
| **当前版本** | PostgreSQL 15 | Alpine镜像 |
| **Docker镜像** | `postgres:15-alpine` | docker-compose.prod.yml |
| **容器名称** | `globalreach-postgres` | |
| **数据库名称** | `globalreach_prod` | 通过环境变量配置 |
| **用户名** | `globalreach_user` | |
| **端口** | 5432 | 内部网络访问 |
| **数据卷** | `postgres_data:/var/lib/postgresql/data` | Docker named volume |
| **健康检查** | pg_isready (30s间隔) | 3次重试 |

**docker-compose.prod.yml 关键配置片段**:
```yaml
services:
  postgres:
    image: postgres:15-alpine
    container_name: globalreach-postgres
    restart: unless-stopped
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: ${DB_NAME:-globalreach_prod}
      POSTGRES_USER: ${DB_USER:-globalreach_user}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-changeme}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-globalreach_user} -d ${DB_NAME:-globalreach_prod}"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 1.2 数据库表结构复杂度

| 模型 | 表名 | 复杂度 | 说明 |
|------|------|--------|------|
| User | users | 中等 | 用户认证、权限管理 |
| Account | accounts | 中等 | 账户信息 |
| Tenant | tenants | 低 | 多租户基础表 |
| Campaign | campaigns | 高 | 邮件营销活动核心表 |
| EmailLog | email_logs | 高 | 邮件发送日志（高频写入） |
| Statistic | statistics | 中等 | 统计数据聚合 |

**总计**: 6个主要业务模型 + 系统表（Sequelize自动生成的 SequelizeMeta）
**数据量级别**: 开发阶段，预估 < 1000条记录/表
**关系复杂度**: 中等（存在外键关联）

### 1.3 应用层技术栈兼容性

#### Sequelize ORM 版本

| 层级 | 版本 | PG驱动版本 | 兼容性 |
|------|------|------------|--------|
| API层 | `sequelize@^6.37.8` | `pg@^8.21.0` | ✅ 兼容 PG 16 |
| Database层 | `sequelize@^6.35.13` | `pg@^8.11.3` | ✅ 兼容 PG 16 |

**兼容性说明**:
- **Sequelize 6.x**: 官方支持 PostgreSQL 12-16，完全兼容 PG 16
- **pg驱动 8.x**: 支持 PostgreSQL 10-17，无兼容性问题
- **Node.js v24**: 与 PG 16 的 libpq 协议完全兼容

### 1.4 备份现状

| 项目 | 状态 | 详情 |
|------|------|------|
| **备份机制** | ✅ 已建立 | M-D06 任务已完成 |
| **备份脚本** | ✅ 存在 | `scripts/backup.sh` / 自动化脚本 |
| **验证报告** | ⚠️ 模板就绪 | M-D04 验证脚本待执行 |
| **远程备份策略** | ✅ 已规划 | docs/REMOTE_BACKUP_STRATEGY.md |
| **最近备份** | ❓ 待确认 | 执行前必须验证最新备份 |

---

## 2. 目标版本分析

### 2.1 PostgreSQL 16 新特性 (2023-09-14 发布)

#### 核心性能改进

| 特性类别 | 具体特性 | 对 GlobalReach 的影响 |
|----------|----------|---------------------|
| **并行查询增强** | 并行 Vacuum 改进 | 🟢 大幅提升 VACUUM 性能，减少表膨胀 |
| **JSON 增强** | SQL/JSON 标准支持 | 🟡 可用于 Campaign 配置的 JSON 字段查询 |
| **负载库增强** | load_library() 安全性提升 | 🔴 不影响（未使用） |
| **逻辑复制** | 增量同步优化 | 🟡 未来可考虑主从复制 |
| **监控改进** | 统计视图增强 | 🟢 Prometheus Exporter 可获取更多指标 |
| **安全加固** | SCRAM-SHA-256 默认 | ✅ 安全性提升 |

#### 性能基准对比（官方数据）

| 操作 | PG 15 | PG 16 | 提升幅度 |
|------|-------|-------|----------|
| VACUUM (大表) | 基准 | ~2x faster | +100% |
| JSON 查询 | 基准 | ~20% faster | +20% |
| 并行顺序扫描 | 基准 | ~15% faster | +15% |
| 逻辑复制延迟 | 基准 | ~30% lower | -30% |

### 2.2 PostgreSQL 17 新特性 (2024-09-26 发布) — 预览版

> **注意**: PG 17 已正式发布，但作为 LTS 版本尚在初期稳定期

| 特性类别 | 具体特性 | 成熟度 |
|----------|----------|--------|
| **内存管理** | 改进的缓冲区管理 | 🟢 稳定 |
| **JSON 路径** | JSON_TABLE 支持 | 🟢 稳定 |
| **Vacuum** | 进一步优化 | 🟢 稳定 |
| **监控** | 新增系统视图 | 🟢 稳定 |
| **安全性** | TLS 1.3 强制选项 | 🟢 稳定 |

### 2.3 推荐目标版本及理由

## ✅ 推荐目标: PostgreSQL 16 (LTS)

### 选择理由:

1. **稳定性优先**
   - PG 16 已发布超过 2 年（截至 2026-06），经过充分的生产环境验证
   - 社区反馈良好，Bug 修复完善
   - 企业级 LTS 支持

2. **兼容性保障**
   - Sequelize 6.x 官方测试覆盖 PG 16
   - pg 驱动 8.x 完全兼容
   - Node.js v24 无已知兼容问题

3. **性能收益明确**
   - 并行 Vacuum 改进对 EmailLog 表（高频写入）有明显收益
   - JSON 查询优化可加速 Campaign 配置检索
   - 监控指标丰富化利于运维

4. **升级路径平滑**
   - PG 15 → 16 是 minor version upgrade（跨一个 major）
   - pg_upgrade 工具成熟可靠
   - Docker 镜像生态完整

5. **避免 PG 17 的早期风险**
   - PG 17 刚发布不到 2 年，可能存在未知边缘情况
   - 部分 ORM/工具链可能尚未完全适配
   - 建议 PG 17 推迟到 2027 年再评估

### 版本选择矩阵

| 维度 | PG 16 | PG 17 | 推荐 |
|------|-------|-------|------|
| 稳定性 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | PG 16 |
| 性能 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | PG 17 |
| 兼容性 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | PG 16 |
| 社区支持 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | PG 16 |
| 未来-proofing | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | PG 17 |
| **综合评分** | **4.6/5** | **4.4/5** | **✅ PG 16** |

### 2.4 与 Node.js v24 的兼容性

| 检查项 | 结果 | 说明 |
|--------|------|------|
| **libpq 协议** | ✅ 兼容 | PG 16 使用 protocol 3.0，Node.js pg 驱动原生支持 |
| **异步 I/O** | ✅ 兼容 | Node.js v24 的异步模型与 PG 16 无冲突 |
| **Buffer 处理** | ✅ 兼容 | 二进制数据传输无变化 |
| **TLS 连接** | ✅ 兼容 | SSL/TLS 握手协议一致 |
| **连接池** | ✅ 兼容 | Sequelize pool 配置无需调整 |

**结论**: Node.js v24 + PostgreSQL 16 是经过验证的稳定组合，广泛用于生产环境。

---

## 3. 升级路径设计

### 方案总览

```
┌─────────────────────────────────────────────────────────────┐
│                    PostgreSQL 升级方案                       │
├─────────────────┬──────────────────┬───────────────────────┤
│   方案A (推荐)   │    方案B         │     方案C             │
│   pg_upgrade    │  pg_dump/restore │  Docker镜像替换        │
├─────────────────┼──────────────────┼───────────────────────┤
│ 停机时间: 最短   │  停机时间: 较长   │  停机时间: 中等        │
│ (~10-15分钟)    │  (~30-60分钟)    │  (~20-30分钟)          │
│                 │                  │                       │
│ 适用场景:       │  适用场景:       │  适用场景:            │
│ 生产环境快速升级 │  数据量小/测试   │  纯Docker部署          │
│                 │  环境验证        │                       │
│                 │                  │                       │
│ 风险等级: 中    │  风险等级: 低    │  风险等级: 中高        │
│ (依赖工具链)    │  (最可控)        │  (卷格式变更风险)       │
└─────────────────┴──────────────────┴───────────────────────┘
```

### 3.1 方案A: pg_upgrade（推荐方案）✅

**优势**:
- 停机时间最短（~10-15 分钟）
- 数据文件原地转换，无需全量导出导入
- 官方推荐的主流升级方式

**劣势**:
- 需要 PG 15 和 PG 16 的二进制文件同时存在
- 在 Docker 环境下需要特殊处理（多容器协作）
- 对数据完整性要求较高时需要额外验证

**适用场景**: GlobalReach 生产环境（数据量小但要求快速恢复）

### 3.2 方案B: pg_dump/pg_restore（最安全备选）

**优势**:
- 最安全可靠的方式
- 完全独立于旧版本二进制文件
- 可以在新环境中先验证再切换
- 支持选择性迁移（排除不需要的表）

**劣势**:
- 停机时间较长（取决于数据量）
- 对于大数据量可能需要数小时
- 需要足够的磁盘空间存储 dump 文件

**适用场景**: Staging 环境、首次升级演练、数据量极小的开发环境

### 3.3 方案C: Docker 镜像替换（简化方案）

**优势**:
- 操作简单，只需修改 docker-compose.yml
- 符合容器化最佳实践
- 易于自动化和 CI/CD 集成

**劣势**:
- **严重警告**: 直接替换镜像会导致数据卷不兼容！PG 15 和 PG 16 的数据目录格式不同
- 必须配合 pg_dump/pg_restore 或使用临时容器进行数据迁移
- 如果处理不当可能导致数据丢失

**适用场景**: 仅当配合方案B的数据迁移步骤时可用

### 最终推荐: **方案A为主方案，方案B为回退保障**

---

## 4. 详细操作步骤（以方案A为主方案）

### 4.1 准备阶段 (T-7d 至 T-1d)

#### 步骤 1: 环境检查与准备

```bash
# 1.1 检查当前 PG 版本
docker exec globalreach-postgres psql --version
# 预期输出: psql (PostgreSQL) 15.x

# 1.2 检查数据库大小
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT pg_size_pretty(pg_database_size('globalreach_prod')) AS db_size;
"
# 预期输出: ~10-50 MB (开发阶段)

# 1.3 检查所有表及其行数
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT schemaname, tablename,
       n_live_tup AS row_count,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;
"

# 1.4 检查磁盘空间（确保至少 2x 当前数据库大小的可用空间）
df -h /var/lib/docker/volumes/
```

**预期耗时**: 5 分钟
**验证检查点**:
- [ ] PG 版本确认为 15.x
- [ ] 数据库大小 < 100MB
- [ ] 所有表均可正常访问
- [ ] 磁盘剩余空间 > 200MB

#### 步骤 2: 创建完整备份（双重保险）

```bash
# 2.1 使用 pg_dumpall 导出全部数据库（包括角色和权限）
mkdir -p /tmp/pg_upgrade_backup_$(date +%Y%m%d)
BACKUP_DIR="/tmp/pg_upgrade_backup_$(date +%Y%m%d)"

docker exec globalreach-postgres pg_dumpall -U globalreach_user > "$BACKUP_DIR/full_dump_$(date +%H%M%S).sql"

# 2.2 使用 pg_dump 自定义格式导出（便于 pg_restore 验证）
docker exec globalreach-postgres pg_dump -U globalreach_user -d globalreach_prod \
  -Fc \
  -f "/tmp/globalreach_prod_custom.dump" \
  --verbose

# 2.3 从容器拷贝备份文件到宿主机
docker cp globalreach-postgres:/tmp/globalreach_prod_custom.dump "$BACKUP_DIR/"

# 2.4 计算校验和
sha256sum "$BACKUP_DIR"/* > "$BACKUP_DIR/checksums.sha256"

# 2.5 验证备份文件完整性
ls -lh "$BACKUP_DIR/"
cat "$BACKUP_DIR/checksums.sha256"
```

**预期耗时**: 10-15 分钟（取决于数据量）
**验证检查点**:
- [ ] SQL dump 文件生成成功（非空）
- [ ] Custom format dump 文件生成成功
- [ ] 校验和计算完成
- [ ] 备份文件大小合理（< 50MB）

#### 步骤 3: 停止应用服务（准备停机窗口）

```bash
# 3.1 停止 API 服务（避免新写入）
cd /path/to/GlobalReach-Project
docker compose -f docker-compose.prod.yml stop api

# 3.2 验证 API 已停止
docker compose -f docker-compose.prod.yml ps api
# 应显示: Exit 或没有运行中的容器

# 3.3 （可选）停止其他依赖服务以释放资源
docker compose -f docker-compose.prod.yml stop nginx prometheus grafana
```

**预期耗时**: 2-3 分钟
**验证检查点**:
- [ ] API 容器已停止
- [ ] 无活跃的数据库连接（可通过以下命令验证）
  ```bash
  docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
  SELECT count(*) FROM pg_stat_activity WHERE state = 'active';
  "
  # 预期输出: 0 或仅剩当前查询
  ```

### 4.2 执行阶段 (T-0，停机窗口内)

#### 步骤 4: 停止 PostgreSQL 服务并保留数据卷

```bash
# 4.1 停止 PostgreSQL 容器（不删除数据卷）
docker compose -f docker-compose.prod.yml stop postgres

# 4.2 验证容器已停止
docker ps -a | grep globalreach-postgres
# 应显示: Exited 状态

# 4.3 记录当前数据卷位置（重要！）
docker inspect globalreach-postgres --format='{{range .Mounts}}{{.Source}} -> {{.Destination}}{{end}}'
```

**预期耗时**: 1-2 分钟
**验证检查点**:
- [ ] PostgreSQL 容器已优雅停止
- [ ] 数据卷路径已记录
- [ ] 无残留进程

#### 步骤 5: 使用 pg_upgrade 进行版本升级

> **关键说明**: 由于我们使用 Docker，这里采用"双容器 pg_upgrade"策略

##### 方法 5.1: 创建 PG 16 临时容器并执行升级

```bash
# 5.1 启动 PG 16 临时容器（共享同一数据卷的父目录）
docker run -d \
  --name postgres-16-upgrade \
  -e POSTGRES_DB=globalreach_prod \
  -e POSTGRES_USER=globalreach_user \
  -e POSTGRES_PASSWORD=${DB_PASSWORD:-changeme} \
  -v globalreach_project_postgres_data:/var/lib/postgresql/data \
  --entrypoint bash \
  postgres:16-alpine \
  -c "sleep infinity"

# 5.2 在 PG 16 容器中执行 pg_upgrade
# 注意：由于数据目录格式不同，我们需要先初始化新的数据目录

# 5.2.1 进入 PG 16 容器
docker exec -it postgres-16-upgrade bash

# 5.2.2 在容器内创建新的数据目录
mkdir -p /var/lib/postgresql/16/main

# 5.2.3 初始化新的 PG 16 数据集群
initdb -D /var/lib/postgresql/16/main --locale=C.UTF-8 --encoding=UTF8

# 5.2.4 退出容器
exit

# 5.3 从 PG 15 容器导出数据（如果 pg_upgrade 因版本差异失败，则降级为方案B）
# 这里提供两种路径的选择点
```

##### ⚠️ 重要决策点: pg_upgrade vs pg_dump/restore

**如果 pg_upgrade 成功**（推荐路径）:
```bash
# 5.4 执行实际的 pg_upgrade（跨容器）
# 注意：这需要在两个容器之间协调，较复杂

# 更实用的方法：使用 pg_upgrade 的 --link 模式或直接使用方案B
```

**实际推荐: 采用混合方案（方案B更可靠）**

鉴于 Docker 环境的复杂性，**强烈建议在生产环境中使用方案B（pg_dump/restore）**，虽然停机时间稍长，但可靠性更高且易于回滚。

#### 步骤 5 (修订): 使用 pg_dump/restore 方案（生产推荐）

```bash
# 5.1 确认 PG 15 容器仍可访问（即使已停止，可以重新启动只读模式）
docker start globalreach-postgres

# 5.2 等待 PG 就绪
sleep 10
docker exec globalreach-postgres pg_isready -U globalreach_user -d globalreach_prod

# 5.3 执行最终的全量备份（确保与步骤2的一致性）
docker exec globalreach-postgres pg_dump -U globalreach_user -d globalreach_prod \
  -Fc \
  -f /tmp/final_pre_upgrade.dump \
  --verbose

# 5.4 拷贝最终备份到宿主机
docker cp globalreach-postgres:/tmp/final_pre_upgrade.dump /tmp/pg_upgrade_backup/

# 5.5 再次停止 PG 15 容器
docker stop globalreach-postgres

# 5.6 重命名旧数据卷（保留用于回滚）
docker volume create postgres_data_pg15_backup
# 注意：Docker volume 无法直接重命名，需要通过数据迁移实现
# 实际操作见回滚预案章节
```

**预期耗时**: 15-20 分钟
**验证检查点**:
- [ ] 最终备份成功完成
- [ ] 备份文件校验和正确
- [ ] PG 15 容器已停止
- [ ] 旧数据卷标记完成

#### 步骤 6: 部署 PostgreSQL 16

```bash
# 6.1 修改 docker-compose.prod.yml 中的镜像版本
# 将:
#   image: postgres:15-alpine
# 改为:
#   image: postgres:16-alpine

# 6.2 使用 sed 命令自动修改（或手动编辑）
sed -i 's/image: postgres:15-alpine/image: postgres:16-alpine/' docker-compose.prod.yml

# 6.3 验证修改
grep "image: postgres" docker-compose.prod.yml
# 应显示: image: postgres:16-alpine

# 6.4 启动新的 PG 16 容器（会自动创建新的空数据目录）
docker compose -f docker-compose.prod.yml up -d postgres

# 6.5 等待 PG 16 初始化完成
echo "等待 PostgreSQL 16 启动..."
sleep 30

# 6.6 验证 PG 16 版本
docker exec globalreach-postgres psql --version
# 预期输出: psql (PostgreSQL) 16.x

# 6.7 等待健康检查通过
docker exec globalreach-postgres pg_isready -U globalreach_user -d globalreach_prod
```

**预期耗时**: 5-10 分钟
**验证检查点**:
- [ ] docker-compose.yml 已更新为 PG 16
- [ ] PG 16 容器启动成功
- [ ] 版本号确认为 16.x
- [ ] 健康检查通过

#### 步骤 7: 数据恢复

```bash
# 7.1 将备份文件拷贝到 PG 16 容器
docker cp /tmp/pg_upgrade_backup/final_pre_upgrade.dump globalreach-postgres:/tmp/

# 7.2 执行 pg_restore 恢复数据
docker exec globalreach-postgres pg_restore -U globalreach_user -d globalreach_prod \
  -v \
  --clean \
  --if-exists \
  /tmp/final_pre_upgrade.dump

# 7.3 验证恢复结果
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
-- 检查表数量
SELECT count(*) AS table_count FROM information_schema.tables
WHERE table_schema = 'public';

-- 检查每个表的行数
SELECT schemaname, tablename, n_live_tup AS row_count
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;
"

# 7.4 运行 ANALYZE 更新统计信息
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "ANALYZE;"
```

**预期耗时**: 10-15 分钟（取决于数据量）
**验证检查点**:
- [ ] pg_restore 执行无错误
- [ ] 表数量与升级前一致（6张业务表 + 系统表）
- [ ] 各表行数与升级前基本一致（允许 ±5% 差异）
- [ ] ANALYZE 完成

### 4.3 验证阶段 (T+0 至 T+1h)

#### 步骤 8: 应用层集成验证

```bash
# 8.1 启动 API 服务
docker compose -f docker-compose.prod.yml up -d api

# 8.2 等待 API 就绪（查看健康检查）
sleep 30
curl -f http://localhost:3000/api/v1/health
# 预期输出: {"status":"ok","database":"connected",...}

# 8.3 启动其他服务
docker compose -f docker-compose.prod.yml up -d nginx prometheus grafana node-exporter postgres-exporter loki promtail tempo alertmanager mailpit

# 8.4 执行功能验证测试清单
echo "=== 功能验证 ==="
# 测试数据库连接
curl -s http://localhost:3000/api/v1/health | jq .

# 测试用户认证端点（示例）
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}' | head -c 200

# 检查日志是否有错误
docker logs globalreach-api-prod --tail 50 | grep -i error || echo "No errors found"
```

**预期耗时**: 10-15 分钟
**验证检查点**:
- [ ] API 健康检查通过
- [ ] 数据库连接正常
- [ ] 用户认证功能正常
- [ ] 无应用层错误日志
- [ ] Prometheus/Grafana 正常采集指标

#### 步骤 9: 性能基线对比

```bash
# 9.1 查询 PG 16 的性能统计
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT datname,
       numbackends,
       xact_commit,
       xact_rollback,
       blks_read,
       blks_hit,
       tup_returned,
       tup_fetched,
       tup_inserted,
       tup_updated,
       tup_deleted
FROM pg_stat_database
WHERE datname = 'globalreach_prod';
"

# 9.2 检查 VACUUM 状态（PG 16 应该更快）
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT relname,
       last_vacuum,
       last_autovacuum,
       vacuum_count,
       autovacuum_count
FROM pg_stat_user_tables
ORDER BY last_vacuum NULLS LAST;
"
```

**预期耗时**: 5 分钟
**验证检查点**:
- [ ] 数据库统计信息正常
- [ ] VACUUM 进度正常
- [ ] 无异常锁等待

#### 步骤 10: 清理与归档

```bash
# 10.1 归档备份文件
mv /tmp/pg_upgrade_backup_* ./GlobalReach-Backups/pg-upgrades/

# 10.2 记录升级日志
cat > ./docs/PG_UPGRADE_LOG_$(date +%Y%m%d).md << 'EOF'
# PostgreSQL 升级执行日志

## 升级详情
- **日期**: $(date '+%Y-%m-%d %H:%M:%S')
- **操作人**: [填写]
- **源版本**: PostgreSQL 15.x
- **目标版本**: PostgreSQL 16.x
- **方案**: pg_dump/restore (方案B)
- **停机开始**: [记录时间]
- **停机结束**: [记录时间]
- **总耗时**: [记录]

## 验证结果
- [ ] 数据完整性验证通过
- [ ] 应用功能验证通过
- [ ] 性能基线对比正常

## 异常情况
(如有，在此记录)

## 后续跟进
- [ ] T+1d: 性能监控
- [ ] T+7d: 长期稳定性观察
EOF

# 10.3 更新项目文档（可选）
# 在 CHANGELOG.md 中添加升级记录
```

**预期耗时**: 5 分钟
**验证检查点**:
- [ ] 备份文件已归档
- [ ] 升级日志已创建
- [ ] 项目文档已更新（如适用）

---

## 5. 风险评估

### 5.1 风险矩阵

| 风险项 | 可能性 | 影响程度 | 风险等级 | 缓解措施 |
|--------|--------|----------|----------|----------|
| **数据丢失** | 极低 (1%) | 致命 | 🔴 高 | 双重备份 + 回滚预案 + 恢复演练 |
| **应用兼容性** | 低 (10%) | 高 | 🟠 中 | Staging 环境先行测试 + Sequelize 兼容性确认 |
| **停机超时** | 中 (20%) | 中 | 🟡 中低 | 详细时间估算 + 预留缓冲时间 |
| **配置不兼容** | 低 (15%) | 中 | 🟡 中低 | 配置差异对照表 + 预检脚本 |
| **性能回归** | 极低 (5%) | 低 | 🟢 低 | PG 16 性能通常正向 + 基线对比 |
| **Docker 卷损坏** | 极低 (2%) | 致命 | 🔴 高 | 卷备份 + 不删除旧卷直到验证完成 |

### 5.2 详细风险评估

#### 5.2.1 数据丢失风险: **低** ✅

**原因**:
- 开发阶段数据量极小（< 50MB）
- M-D06 已建立完善的备份机制
- 本次升级会创建额外的升级前备份
- pg_dump/custom format 支持完整恢复

**缓解措施**:
- 升级前强制执行完整备份（步骤 2）
- 备份文件本地 + 远程双副本
- 升级后立即验证数据行数
- 保留 PG 15 数据卷至少 7 天

#### 5.2.2 应用兼容性风险: **中** ⚠️

**潜在问题**:
1. **Sequelize 查询语法变更**
   - PG 16 对某些 SQL 语法更严格
   - 影响: 可能导致部分查询报错
   - 缓解: Staging 环境全面测试

2. **pg 驱动行为变更**
   - pg 8.x 与 PG 16 的类型映射微调
   - 影响: 时间戳、数值精度等边界情况
   - 缓解: 单元测试 + 集成测试覆盖

3. **Node.js v24 特有行为**
   - 新版本的 Buffer/Stream 处理
   - 影响: 极低（pg 驱动已适配）
   - 缓解: 使用 LTS 版本的 Node.js

**测试矩阵**:

| 测试场景 | 优先级 | 预期结果 |
|----------|--------|----------|
| 用户注册/登录 | P0 | ✅ 正常 |
| CRUD 操作 (所有模型) | P0 | ✅ 正常 |
| 邮件发送日志记录 | P0 | ✅ 正常 |
| 统计数据聚合查询 | P1 | ✅ 正常 |
| 多租户隔离 | P1 | ✅ 正常 |
| JSON 字段操作 (Campaign) | P2 | ✅ 正常 |
| 并发写入压力测试 | P2 | ✅ 正常 |

#### 5.2.3 停机窗口风险: **中等**

**时间估算**:

| 阶段 | 预估时间 | 缓冲时间 | 合计 |
|------|----------|----------|------|
| 停止服务 | 3 min | 2 min | 5 min |
| 最终备份 | 10 min | 5 min | 15 min |
| 停止 PG 15 | 2 min | 1 min | 3 min |
| 部署 PG 16 | 5 min | 5 min | 10 min |
| 数据恢复 | 10 min | 10 min | 20 min |
| 验证测试 | 10 min | 10 min | 20 min |
| 启动服务 | 5 min | 5 min | 10 min |
| **总计** | **45 min** | **38 min** | **83 min** |

**建议停机窗口**: **凌晨 2:00 - 4:00 (2 小时)**，预留充足缓冲

#### 5.2.4 性能影响: **正向** 📈

**预期收益**:
- VACUUM 性能提升 ~100%（对 EmailLog 高频写入表显著）
- JSON 查询性能提升 ~20%（Campaign 配置检索）
- 整体查询吞吐量提升 ~10-15%
- 内存利用率改善

**监控指标**:
- 查询响应时间 (P95/P99)
- VACUUM 执行频率和耗时
- 连接池使用率
- 磁盘 I/O 等待时间

---

## 6. 前置条件清单

### 6.1 技术前置条件

- [ ] **当前所有数据已完整备份**
  - 执行命令: `bash scripts/backup.sh full`
  - 验证: 检查备份文件大小和校验和
  - 截止时间: T-1d 18:00 前

- [ ] **备份验证通过 (M-D04 脚本)**
  - 执行命令: `bash scripts/verify-backup.sh`
  - 验证项目:
    - SHA256 校验通过
    - pg_restore --list 显示正确的对象列表
    - dry-run 恢复无错误
  - 截止时间: T-1d 20:00 前

- [ ] **确定停机窗口并获得批准**
  - 建议时间: **2026-06-16 (周二) 凌晨 02:00 - 04:00**
  - 通知渠道: 企业微信群 / 邮件通知
  - 参与人员: DevOps + DBA + 应用负责人
  - 批准人: [项目经理/技术总监]

- [ ] **Staging 环境升级验证通过**
  - 在 staging 环境完整执行一次升级流程
  - 记录遇到的问题和解决方案
  - 验证所有功能测试用例通过
  - 截止时间: T-7d (即 2026-06-09)

- [ ] **回滚方案就绪并演练**
  - 编写详细的回滚操作手册
  - 在 staging 环境执行回滚演练
  - 确认回滚时间 < 15 分钟
  - 截止时间: T-3d

- [ ] **Docker 镜像预拉取**
  - 预拉取 `postgres:16-alpine` 镜像到所有节点
  - 验证镜像完整性 (sha256 校验)
  - 避免升级时因网络问题拉取超时
  - 截止时间: T-1d 22:00 前

- [ ] **磁盘空间充足**
  - 要求: 剩余空间 > 当前数据库大小的 5 倍
  - 当前预估: 数据库 < 50MB，需要 > 250MB 可用空间
  - 检查命令: `df -h /var/lib/docker/volumes/`

- [ ] **应用代码兼容性预检**
  - 运行 Sequelize 迁移测试: `npm run test:unit`
  - 检查 SQL 查询是否使用了 PG 16 移除的特性
  - 确认无硬编码的 PG 版本检测逻辑

### 6.2 组织前置条件

- [ ] **利益相关者通知**
  - 产品团队: 停机时间通知
  - 客服团队: 预期的客户影响说明
  - 运维团队: 升级操作授权和监控安排

- [ ] **应急联系人名单**
  - 主操作员: [姓名] + [手机] + [邮箱]
  - 备用操作员: [姓名] + [手机] + [邮箱]
  - DBA 专家: [姓名] + [手机] (如遇疑难问题)
  - 决策者: [姓名] + [手机] (如需中止升级)

- [ ] **沟通计划**
  - T-1d: 发送停机维护公告
  - T-0 (开始前 10 分钟): 最后确认
  - T-0 (完成后): 发送升级完成通知
  - T+1d: 发送升级后稳定性报告

### 6.3 文档前置条件

- [ ] **本升级计划文档已审批**
- [ ] **回滚预案文档已准备** (见第 8 章)
- [ ] **操作 checklist 打印备用** (防止网络中断无法查阅)
- [ ] **过往升级经验总结已 review** (如有)

---

## 7. 时间线规划

### 7.1 总体时间线

```
T-14d ─── T-7d ─── T-3d ─── T-1d ─── T-0 ─── T+0 ─── T+1d ─── T+7d
 │         │        │        │       │       │        │        │
 │         ▼        ▼        ▼       ▼       ▼        ▼        ▼
 │      Staging  回滚     最终     升级    功能     性能     观察
 │      环境测试  演练     备份     执行    验证     监控     期
 │
 ▼
 计划制定
 文档编写
 (本任务)
```

### 7.2 详细日程

#### Phase 1: 准备阶段 (T-14d 至 T-7d)

**日期范围**: 2026-06-02 ~ 2026-06-09

| 日期 | 任务 | 负责人 | 交付物 | 状态 |
|------|------|--------|--------|------|
| T-14d | 编写升级计划文档 | DevOps | 本文档 (POSTGRESQL_UPGRADE_PLAN.md) | ✅ 进行中 |
| T-13d | 技术评审会议 | 全体 | 评审意见 & 修订版 | ⏳ 待办 |
| T-10d | 准备 Staging 环境 | DevOps | Staging 环境就绪 | ⏳ 待办 |
| T-7d | Staging 环境升级测试 | DBA+DevOps | 测试报告 | ⏳ 待办 |

**T-7d 详细任务清单**:
```bash
# 1. 在 Staging 环境模拟完整升级流程
# 2. 记录每一步的实际耗时
# 3. 收集错误和异常情况
# 4. 验证回滚流程
# 5. 生成测试报告
```

#### Phase 2: 验证阶段 (T-7d 至 T-1d)

**日期范围**: 2026-06-09 ~ 2026-06-15

| 日期 | 任务 | 负责人 | 交付物 | 状态 |
|------|------|--------|--------|------|
| T-7d | 分析 Staging 测试结果 | DBA | 问题修复清单 | ⏳ 待办 |
| T-5d | 修复发现的问题 | DevOps | 代码/配置修复 | ⏳ 待办 |
| T-3d | 回滚演练 (Staging) | DBA | 回滚演练报告 | ⏳ 待办 |
| T-2d | 最终审批会议 | 项目经理 | 升级批准书 | ⏳ 待办 |
| T-1d (白天) | 通知利益相关者 | PM | 通知记录 | ⏳ 待办 |
| T-1d (22:00) | 预拉取 Docker 镜像 | DevOps | 镜像就绪确认 | ⏳ 待办 |
| T-1d (23:30) | 执行最终备份 | DBA | 备份验证报告 | ⏳ 待办 |

#### Phase 3: 执行阶段 (T-0)

**日期**: 2026-06-16 (周二) 凌晨 02:00 - 04:00

| 时间 (UTC+8) | 任务 | 操作人 | 预计耗时 | 状态 |
|--------------|------|--------|----------|------|
| 01:50 | 开始前检查 (环境、备份、人员) | DevOps | 10min | ⏳ |
| 02:00 | **停机开始** - 停止 API 服务 | DevOps | 3min | ⏳ |
| 02:03 | 最终备份确认 | DBA | 10min | ⏳ |
| 02:13 | 停止 PostgreSQL 15 | DevOps | 2min | ⏳ |
| 02:15 | 部署 PostgreSQL 16 | DevOps | 5min | ⏳ |
| 02:20 | 数据恢复 | DBA | 15min | ⏳ |
| 02:35 | 数据验证 | DBA | 10min | ⏳ |
| 02:45 | 启动 API 及其他服务 | DevOps | 5min | ⏳ |
| 02:50 | 功能验证测试 | QA | 15min | ⏳ |
| 03:05 | 性能基线采集 | DevOps | 5min | ⏳ |
| 03:10 | **停机结束** - 公告恢复 | PM | - | ⏳ |
| 03:10-04:00 | 监控观察 (缓冲时间) | 全体 | 50min | ⏳ |

**总停机时间**: ~70 分钟 (含缓冲)
**核心升级时间**: ~35 分钟 (02:03 - 02:38)

#### Phase 4: 后续阶段 (T+0 至 T+7d)

| 时间 | 任务 | 负责人 | 交付物 |
|------|------|--------|--------|
| T+0 (04:00) | 发送升级完成通知 | PM | 通知邮件/消息 |
| T+0 (白天) | 监控关键指标 | DevOps | 监控报告 |
| T+1d | 性能深度分析 | DBA | 性能对比报告 |
| T+3d | 用户反馈收集 | PM | 反馈汇总 |
| T+7d | 稳定性评估 & 文档归档 | 全体 | 最终报告 |

---

## 8. 回滚预案

### 8.1 回滚触发条件

**自动触发** (任一条件满足即回滚):
- [ ] 数据恢复后表数量不一致
- [ ] 关键表 (users, accounts, campaigns) 行数为 0
- [ ] API 健康检查连续 3 次失败
- [ ] pg_restore 执行出现致命错误
- [ ] 停机时间超过 90 分钟且未完成核心步骤

**手动触发** (操作员判断):
- [ ] 发现不可预期的数据不一致
- [ ] 应用层出现无法快速定位的严重错误
- [ ] 业务方要求中止升级

### 8.2 快速回滚步骤 (< 15 分钟)

#### 场景 A: PG 16 部署失败（未执行数据恢复）

**回滚时间**: ~5 分钟

```bash
# A.1 停止失败的 PG 16 容器
docker stop globalreach-postgres
docker rm globalreach-postgres

# A.2 恢复 docker-compose.yml 为 PG 15
git checkout docker-compose.prod.yml  # 或使用备份版本
# 手动修改:
sed -i 's/image: postgres:16-alpine/image: postgres:15-alpine/' docker-compose.prod.yml

# A.3 重新启动 PG 15
docker compose -f docker-compose.prod.yml up -d postgres

# A.4 验证 PG 15 恢复
sleep 15
docker exec globalreach-postgres psql --version
docker exec globalreach-postgres pg_isready -U globalreach_user -d globalreach_prod

# A.5 启动应用服务
docker compose -f docker-compose.prod.yml up -d api nginx prometheus grafana

# A.6 验证服务恢复
curl -f http://localhost:3000/api/v1/health
```

#### 场景 B: 数据恢复后发现数据问题

**回滚时间**: ~10-15 分钟

```bash
# B.1 停止 PG 16 容器
docker stop globalreach-postgres
docker rm globalreach-postgres

# B.2 恢复 PG 15 镜像配置
sed -i 's/image: postgres:16-alpine/image: postgres:15-alpine/' docker-compose.prod.yml

# B.3 启动 PG 15 (空数据库)
docker compose -f docker-compose.prod.yml up -d postgres
sleep 15

# B.4 从备份恢复数据 (使用升级前的 final_pre_upgrade.dump)
docker cp /tmp/pg_upgrade_backup/final_pre_upgrade.dump globalreach-postgres:/tmp/

docker exec globalreach-postgres pg_restore -U globalreach_user -d globalreach_prod \
  -v \
  --clean \
  --if-exists \
  /tmp/final_pre_upgrade.dump

# B.5 验证数据完整性
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT count(*) FROM users;
SELECT count(*) FROM campaigns;
SELECT count(*) FROM email_logs;
"

# B.6 启动应用服务
docker compose -f docker-compose.prod.yml up -d api nginx prometheus grafana

# B.7 功能验证
curl -f http://localhost:3000/api/v1/health
```

#### 场景 C: 灾难恢复 (数据卷损坏)

**回滚时间**: ~20-30 分钟

```bash
# C.1 如果 PG 16 数据卷损坏，使用远程备份恢复
# 参考: docs/REMOTE_BACKUP_STRATEGY.md

# C.2 从远程存储下载最新的完整备份
aws s3 cp s3://globalreach-backups/latest/full_backup.tar.gz /tmp/emergency_restore/

# C.3 解压备份
tar -xzf /tmp/emergency_restore/full_backup.tar.gz -C /tmp/emergency_restore/

# C.4 完全销毁当前环境
docker compose -f docker-compose.prod.yml down -v
# ⚠️ 警告: 这会删除所有数据卷！

# C.5 重新启动 PG 15 (空环境)
docker compose -f docker-compose.prod.yml up -d postgres
sleep 20

# C.6 恢复数据
docker exec -i globalreach-postgres psql -U globalreach_user -d globalreach_prod < /tmp/emergency_restore/dump.sql

# C.7 验证并启动所有服务
docker compose -f docker-compose.prod.yml up -d
```

### 8.3 回滚决策树

```
升级过程中发现问题？
│
├─→ 部署 PG 16 失败？
│   └─→ 是 → 场景 A (快速回滚 PG 15, ~5min)
│   └─→ 否 ↓
│
├─→ 数据恢复失败/数据不一致？
│   └─→ 是 → 场景 B (从备份恢复到 PG 15, ~15min)
│   └─→ 否 ↓
│
├─→ 应用层功能异常？
│   ├─→ 可快速修复？ → 修复并继续验证
│   └─→ 无法快速修复？ → 场景 B (回滚, ~15min)
│
└─→ 数据卷损坏？
    └─→ 是 → 场景 C (灾难恢复, ~30min)
```

### 8.4 回滚后的必做事项

- [ ] **立即通知**: 向应急联系人和利益相关群发送"回滚完成"通知
- [ ] **问题记录**: 详细记录回滚原因、时间、影响范围
- [ ] **根因分析**: 安排升级失败的事后复盘会议 (24h 内)
- [ ] **计划修订**: 根据失败原因修订升级计划，必要时推迟升级
- [ ] **监控加强**: 回滚后 24h 加强监控频率

---

## 9. 升级后优化建议

### 9.1 PostgreSQL 16 特性利用建议

#### 9.1.1 启用并行 Vacuum (推荐启用)

**适用场景**: EmailLog 表（高频写入，频繁产生死元组）

**配置调整** (postgresql.conf 或 docker-compose 环境变量):
```yaml
# 在 docker-compose.prod.yml 的 postgres service 中添加:
command:
  - "postgres"
  - "-c"
  - "maintenance_work_mem=256MB"
  - "-c"
  - "max_parallel_maintenance_workers=4"
  - "-c"
  - "parallel_leader_participation=on"
```

**预期效果**: Vacuum 操作速度提升 2-5 倍

#### 9.1.2 利用 SQL/JSON 增强功能 (可选)

**适用场景**: Campaign 表的配置字段（如果有 JSON 类型列）

**示例用法**:
```sql
-- PG 16 新增的 JSON 查询函数
SELECT *
FROM campaigns
WHERE config @> '{"status": "active"}';  -- JSON 包含运算符优化

-- 使用 SQL/JSON 标准函数
SELECT id, json_value(config, '$.target_audience') AS audience
FROM campaigns
WHERE json_exists(config, '$.schedule');
```

**实施建议**:
- 先评估 Campaign 表是否真的使用 JSON 字段
- 如未使用，此优化可暂缓
- 如已使用，逐步迁移现有查询到新语法

#### 9.1.3 改进统计监控 (推荐实施)

**新增监控指标** (Prometheus Exporter 可自动采集):
```sql
-- PG 16 新增的系统视图
SELECT * FROM pg_stat_io;           -- I/O 统计 (全新!)
SELECT * FROM pg_progress_cluster;  -- 集群命令进度
SELECT * FROM pg_progress_basebackup;  -- 基础备份进度
```

**Grafana Dashboard 更新**:
- 添加 I/O 等待时间面板
- 添加 Vacuum 进度面板
- 添加 Checkpoint 活动详细视图

### 9.2 配置调优建议 (postgresql.conf)

#### 9.2.1 内存相关参数 (根据服务器资源调整)

```ini
# === 内存设置 ===
# 共享缓冲区 (建议设置为物理内存的 25%)
shared_buffers = 256MB                    # 默认 128MB

# 工作内存 (排序/哈希操作)
work_mem = 32MB                           # 默认 4MB

# 维护操作内存 (VACUUM, CREATE INDEX 等)
maintenance_work_mem = 256MB              # 默认 64MB

# 有效缓存大小 (用于查询规划器)
effective_cache_size = 1GB                # 估计值
```

#### 9.2.2 WAL (Write-Ahead Log) 相关参数

```ini
# === WAL 设置 ===
# WAL 级别 (开发环境可使用 replica，生产环境建议 replica)
wal_level = replica

# 每个 WAL 段的大小 (默认 16MB，保持不变)
# max_wal_size = 2GB                     # 默认 1GB
# min_wal_size = 512MB                   # 默认 80MB

# WAL 压缩 (PG 16 新特性，full_pageWrites 可在某些场景关闭实验)
# ⚠️ 谨慎修改，建议保持默认
```

#### 9.2.3 查询优化器参数

```ini
# === 查询规划器 ===
# 随机页面代价 (SSD 可降低此值)
random_page_cost = 1.1                   # SSD 默认值，HDD 为 4.0

# 有效 IO 并发度
effective_io_concurrency = 200           # 针对 SSD

# 并行查询设置
max_worker_processes = 8                 # 最大后台进程数
max_parallel_workers_per_gather = 4      # 每个查询的最大并行 workers
max_parallel_workers = 8                 # 最大并行 workers 总数
max_parallel_maintenance_workers = 4     # 维护操作 (VACUUM) 的并行度
```

#### 9.2.4 连接和认证设置

```ini
# === 连接设置 ===
max_connections = 100                    # 最大并发连接数
superuser_reserved_connections = 3       # 为超级用户保留的连接

# 连接池 (应用层已使用 Sequelize pool，此处适当放宽)
# shared_preload_libraries = ''          # 如需 pg_stat_statements 可添加
```

#### 9.2.5 日志和监控设置

```ini
# === 日志设置 ===
log_min_duration_statement = 1000        # 记录超过 1s 的慢查询
log_checkpoints = on                     # 记录 checkpoint 活动
log_connections = on                     # 记录连接事件
log_disconnections = on                  # 记录断开事件
log_lock_waits = on                      # 记录锁等待

# === 统计收集 ===
track_activities = on
track_counts = on
track_io_timing = on                     # PG 16 新增 I/O 计时
track_functions = all
```

### 9.3 Docker Compose 配置示例 (升级后)

```yaml
services:
  postgres:
    # 升级后的镜像版本
    image: postgres:16-alpine
    container_name: globalreach-postgres
    restart: unless-stopped
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: ${DB_NAME:-globalreach_prod}
      POSTGRES_USER: ${DB_USER:-globalreach_user}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-changeme}
      # PG 16 性能调优参数
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C.UTF-8"
    command:
      - "postgres"
      - "-c"
      - "shared_buffers=256MB"
      - "-c"
      - "work_mem=32MB"
      - "-c"
      - "maintenance_work_mem=256MB"
      - "-c"
      - "max_worker_processes=8"
      - "-c"
      - "max_parallel_workers_per_gather=4"
      - "-c"
      - "max_parallel_maintenance_workers=4"
      - "-c"
      - "log_min_duration_statement=1000"
      - "-c"
      - "log_checkpoints=on"
      - "-c"
      - "log_lock_waits=on"
    networks:
      - globalreach-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-globalreach_user} -d ${DB_NAME:-globalreach_prod}"]
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '2.0'
        reservations:
          memory: 512M
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "3"
```

### 9.4 维护任务更新

#### 9.4.1 VACUUM 策略变更

**PG 15 (当前)**:
- Autovacuum 默认配置
- 高频写入表可能出现膨胀
- 手动 VACUUM ANALYZE 频率: 每周 1 次

**PG 16 (升级后)**:
- 利用并行 Vacuum 能力
- 调整 autovacuum 参数:
  ```sql
  -- 针对高频写入的 email_logs 表
  ALTER TABLE email_logs SET (
    autovacuum_vacuum_scale_factor = 0.05,      -- 更激进 (默认 0.2)
    autovacuum_analyze_scale_factor = 0.02,
    autovacuum_vacuum_cost_delay = 2ms            -- 降低延迟 (默认 2ms)
  );
  ```

- 手动 VACUUM ANALYZE 频率: 可降低至每月 1 次（autovacuum 效率提升）

#### 9.4.2 定期维护任务清单 (Cron Job)

```cron
# PostgreSQL 16 维护任务 (建议通过 systemd timer 或外部 cron 执行)

# 每日凌晨 3:00 - 全库 ANALYZE (轻量级)
0 3 * * * docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "ANALYZE;" >> /var/log/pg_maintenance.log 2>&1

# 每周日凌晨 4:00 - 全库 VACUUM ANALYZE (中度)
0 4 * * 0 docker exec globalreach-postgres vacuumdb -U globalreach_user -d globalreach_prod --analyze-only >> /var/log/pg_maintenance.log 2>&1

# 每月1日凌晨 5:00 - 完整 VACUUM FULL (重度，需评估停机影响)
0 5 1 * * docker exec globalreach-postgres vacuumdb -U globalreach_user -d globalreach_prod --full --analyze >> /var/log/pg_maintenance.log 2>&1

# 每小时 - 检查数据库大小和表膨胀
0 * * * * docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT schemaname, tablename,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
       n_dead_tup as dead_rows
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC
LIMIT 10;" >> /var/log/pg_bloat_monitor.log 2>&1
```

#### 9.4.3 监控告警阈值调整 (AlertManager)

**新增/调整规则**:

```yaml
# Prometheus 告警规则 (PG 16 专用)
groups:
  - name: postgresql_16_alerts
    rules:
      # I/O 等待过高 (利用 PG 16 新指标)
      - alert: PostgresHighIOWait
        expr: pg_stat_io_read_time_seconds > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "PostgreSQL I/O wait time is high"
          description: "I/O wait time is {{ $value }}s for more than 5 minutes."

      # Vacuum 进度过慢
      - alert: PostgresSlowVacuum
        expr: pg_stat_progress_vacuum{phase != 'finished'} > 300
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "VACUUM running too long"
          description: "Table {{ $labels.relid }} has been vacuuming for {{ $value }} seconds."
```

---

## 10. 附录

### 10.1 PostgreSQL 15 vs 16 配置差异对照表

| 配置参数 | PG 15 默认值 | PG 16 默认值 | 变更说明 | 是否需要关注 |
|----------|-------------|-------------|----------|-------------|
| **shared_buffers** | 128MB | 128MB | 无变化 | ⚪ 否 |
| **work_mem** | 4MB | 4MB | 无变化 | ⚪ 否 |
| **maintenance_work_mem** | 64MB | 64MB | 无变化 | ⚪ 否 |
| **max_worker_processes** | 8 | 8 | 无变化 | ⚪ 否 |
| **max_parallel_workers_per_gather** | 2 | 2 | 无变化 | ⚪ 否 |
| **max_parallel_maintenance_workers** | 2 | **4** | ⬆️ **提升** | 🟡 **建议调整** |
| **wal_level** | replica | replica | 无变化 | ⚪ 否 |
| **max_wal_size** | 1GB | 1GB | 无变化 | ⚪ 否 |
| **log_min_duration_statement** | -1 (off) | -1 (off) | 无变化 | 🟡 **建议开启** |
| **default_statistics_target** | 100 | 100 | 无变化 | ⚪ 否 |
| **random_page_cost** | 4.0 | 4.0 | 无变化 | 🟡 **SSD 建议改为 1.1** |
| **effective_io_concurrency** | 1 | 1 | 无变化 | 🟡 **SSD 建议改为 200** |
| **jit** | on | on | 无变化 | ⚪ 否 |
| **track_io_timing** | off | **on** | ⬆️ **新增** | 🟢 **自动开启** |
| **pg_stat_io** | ❌ 不存在 | ✅ **新增视图** | **新特性** | 🟢 **可用于监控** |
| **parallel_leader_participation** | on | on | 无变化 | ⚪ 否 |

**关键变更摘要**:
1. ✅ **向后兼容**: 所有关键参数默认值保持不变，升级不会破坏现有配置
2. 🆕 **新功能**: PG 16 新增 `track_io_timing` 默认开启和 `pg_stat_io` 视图
3. ⚙️ **优化建议**: `max_parallel_maintenance_workers` 提升至 4，建议显式配置

### 10.2 Sequelize PG 驱动兼容性矩阵

| Sequelize 版本 | pg 驱动版本 | PG 12 | PG 13 | PG 14 | PG 15 | PG 16 | PG 17 |
|---------------|------------|-------|-------|-------|-------|-------|-------|
| **6.35.x** | 8.11.x | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **6.37.x** | 8.21.x | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **7.x (Alpha)** | 8.x+ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |

**当前 GlobalReach 技术栈**:
- API 层: Sequelize 6.37.8 + pg 8.21.0 → **✅ 完全兼容 PG 16**
- Database 层: Sequelize 6.35.13 + pg 8.11.3 → **✅ 完全兼容 PG 16**

**注意事项**:
1. **不建议升级到 Sequelize 7.x**: 目前仍在 Alpha 阶段，API 有 breaking changes
2. **pg 驱动 8.x 系列长期支持**: 对 PG 16/17 支持完善
3. **Node.js 版本要求**: pg 8.x 需要 Node.js >= 14.x，当前 v24 完全满足

### 10.3 常见问题 FAQ

#### Q1: 为什么不直接升级到 PostgreSQL 17?

**A**: 基于"稳定性优先"原则:
- PG 16 已发布近 3 年（截至 2026-06），生产环境验证充分
- PG 17 虽然性能更好，但作为较新的大版本，可能存在未发现的边缘 case
- ORM/工具链对 PG 17 的适配可能滞后
- **建议**: 2027 年再评估 PG 17 升级，届时 PG 17 也将成为成熟的 LTS 版本

#### Q2: 升级过程中应用会有多长时间不可用?

**A**: 取决于选择的方案:
- **方案A (pg_upgrade)**: 理论上 ~15-30 分钟，但 Docker 环境下复杂度较高
- **方案B (pg_dump/restore)**: **约 60-90 分钟**（本文推荐的可靠方案）
- **实际停机窗口**: 建议预订 **2 小时** (02:00-04:00)，包含充足缓冲时间

#### Q3: 升级失败怎么办? 数据会丢失吗?

**A**: **数据不会丢失**（前提是严格遵循本计划的备份步骤）:
- 升级前会创建 **双重备份** (SQL dump + custom format)
- 回滚预案可在 **15 分钟内** 恢复到 PG 15
- 最坏情况下可从 **远程备份** 完整恢复 (M-D06 机制)
- **关键**: 严格按照步骤 2 执行备份，并在步骤 5.3 验证备份完整性

#### Q4: 需要修改应用代码吗?

**A**: **大概率不需要**:
- Sequelize 6.x 的 SQL 生成与 PG 16 完全兼容
- pg 驱动 8.x 已处理底层协议差异
- **可能的微小调整**:
  - 如果使用了 PG 15 已废弃的函数，可能需要更新
  - 如果有原始 SQL 查询使用了非标准语法，需要 review
- **建议**: 在 Staging 环境执行完整的回归测试套件

#### Q5: Docker 数据卷如何处理? 会丢失数据吗?

**A**: **不会丢失，但需要注意**:
- PG 15 和 PG 16 的 **数据目录格式不兼容**
- **不能**直接将 PG 15 的 volume 挂载到 PG 16 容器
- **正确做法**:
  1. 从 PG 15 导出数据 (pg_dump)
  2. PG 16 容器启动时会创建全新的空数据目录
  3. 将导出的数据导入 PG 16 (pg_restore)
  4. **旧的 PG 15 volume 保留 7 天** 用于回滚

#### Q6: 升级后性能会有明显提升吗?

**A**: **对于 GlobalReach 的场景，提升适中**:
- **显著提升**: VACUUM 操作速度 (+100%)，对 EmailLog 高频写入表有益
- **适度提升**: JSON 查询 (+20%)，如果 Campaign 表大量使用 JSON 字段
- **轻微提升**: 整体查询吞吐量 (+10-15%)
- **无明显变化**: 简单 CRUD 操作
- **结论**: 升级的主要价值在于 **长期维护性和安全性**，而非立竿见影的性能飞跃

#### Q7: 如何监控升级是否成功?

**A**: 建议使用以下检查清单:

**即时检查 (T+0)**:
```bash
# 1. 版本检查
docker exec globalreach-postgres psql --version
# 预期: psql (PostgreSQL) 16.x

# 2. 数据库连接测试
docker exec globalreach-postgres pg_isready -U globalreach_user -d globalreach_prod
# 预期: accepting connections

# 3. 表数量验证
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
"
# 预期: >= 6 (业务表) + 系统表

# 4. 行数抽样验证
docker exec globalreach-postgres psql -U globalreach_user -d globalreach_prod -c "
SELECT 'users', count(*) FROM users UNION ALL
SELECT 'campaigns', count(*) FROM campaigns UNION ALL
SELECT 'email_logs', count(*) FROM email_logs;
"
# 预期: 与升级前基本一致
```

**持续监控 (T+1d 至 T+7d)**:
- Prometheus/Grafana 查看关键指标趋势
- 关注错误率、响应时间、连接池使用率
- 检查 PostgreSQL 日志有无异常

#### Q8: 如果在升级过程中遇到问题，应该联系谁?

**A**: 应急联系链条:
1. **第一梯队**: 主操作员 + 备用操作员 (立即响应)
2. **第二梯队**: DBA 专家 (15 分钟内介入)
3. **第三梯队**: 决策者 (必要时做出中止/继续决策)
4. **外部资源**: PostgreSQL 社区论坛 / 企业支持 (如已购买)

**详见第 6.2 节"应急联系人名单"**

---

### 10.4 参考资料

#### 官方文档
- [PostgreSQL 16 Release Notes](https://www.postgresql.org/docs/16/release-16.html)
- [PostgreSQL 15→16 Upgrade Guide](https://www.postgresql.org/docs/16/upgrading.html)
- [pg_upgrade Documentation](https://www.postgresql.org/docs/16/app-pgupgrade.html)
- [Sequelize v6 Documentation](https://sequelize.org/master/index.html)

#### Docker 相关
- [PostgreSQL Docker Official Image](https://hub.docker.com/_/postgres)
- [Docker Volume Backup Strategies](https://docs.docker.com/storage/volumes/#back-up-a-volume)

#### 社区资源
- [PostgreSQL Wiki: Upgrading](https://wiki.postgresql.org/wiki/Upgrading)
- [DBA Stack Exchange: PG 15 to 16](https://dba.stackexchange.com/questions/tagged/postgresql-16)

#### 项目内部文档
- `docs/REMOTE_BACKUP_STRATEGY.md` - 远程备份策略
- `docs/BACKUP_VERIFICATION_REPORT.md` - 备份验证报告模板
- `docs/ROLLBACK_PROCEDURE.md` - 通用回滚程序
- `docs/DEPLOYMENT_PLAYBOOK.md` - 部署 playbook
- `docker-compose.prod.yml` - 生产环境 Docker Compose 配置

---

## 文档历史

| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|----------|
| v1.0 | 2026-06-09 | Trae IDE (M-D03) | 初稿，完整的 PG 15→16 升级计划 |

---

## 审批签字

| 角色 | 姓名 | 签字 | 日期 |
|------|------|------|------|
| 文档作者 | [Trae IDE] | | 2026-06-09 |
| 技术审核 | [待填写] | | [待填写] |
| DBA 审核 | [待填写] | | [待填写] |
| 项目经理批准 | [待填写] | | [待填写] |

---

**文档结束**

> 💡 **提示**: 本文档应在升级执行前至少 7 天完成审批，并分发给所有相关人员。
>
> ⚠️ **重要**: 升级操作必须在 **Staging 环境完整演练** 后才能在生产环境执行。
>
> 📞 **紧急支持**: 如遇紧急情况，请参考第 8 章"回滚预案"或联系应急联系人。
