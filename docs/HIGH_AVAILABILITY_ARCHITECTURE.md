# GlobalReach V2.0 高可用（HA）架构设计文档

> **文档版本**: v1.0
> **创建日期**: 2026-06-09
> **文档状态**: 设计方案（Design Proposal）
> **适用范围**: GlobalReach V2.0 企业级邮件营销平台
> **作者**: DevOps 架构团队

---

## 目录

- [第一章：HA 目标与 RPO/RTO 定义](#第一章ha-目标与-rporto-定义)
  - [1.1 可用性目标三级定义](#11-可用性目标三级定义)
  - [1.2 恢复点目标（RPO）分级](#12-恢复点目标rpo分级)
  - [1.3 恢复时间目标（RTO）分级](#13-恢复时间目标rto分级)
  - [1.4 成本/复杂度/可用性三维权衡矩阵](#14-成本复杂度可用性三维权衡矩阵)
- [第二章：现状单点故障分析（SPOF Audit）](#第二章现状单点故障分析spof-audit)
  - [2.1 当前架构组件清单](#21-当前架构组件清单)
  - [2.2 SPOF 风险评估矩阵](#22-spof-风险评估矩阵)
  - [2.3 Top 5 关键 SPOF 详细分析](#23-top-5-关键-spof-详细分析)
  - [2.4 SPOF 影响评分表](#24-spof-影响评分表)
- [第三章：HA 架构方案设计](#第三章ha-架构方案设计)
  - [3.1 方案A：Docker Compose HA 轻量级方案](#31-方案adocker-compose-ha-轻量级方案推荐近期实施)
  - [3.2 方案B：Kubernetes 迁移路径](#32-方案bkubernetes-迁移路径远期规划)
  - [3.3 方案对比与选型建议](#33-方案对比与选型建议)
- [第四章：各组件详细 HA 实现](#第四章各组件详细-ha-实现)
  - [4.1 PostgreSQL 高可用实现](#41-postgresql-高可用实现)
  - [4.2 Redis 高可用实现](#42-redis-高可用实现)
  - [4.3 API Gateway 高可用实现](#43-api-gateway-高可用实现)
  - [4.4 Nginx/LB 高可用实现](#44-nginxlb-高可用实现)
  - [4.5 监控系统高可用实现](#45-监控系统高可用实现)
- [第五章：网络与存储](#第五章网络与存储)
  - [5.1 Docker 网络隔离策略](#51-docker-网络隔离策略)
  - [5.2 共享存储选择](#52-共享存储选择)
  - [5.3 数据一致性保障机制](#53-数据一致性保障机制)
- [第六章：故障转移 SOP](#第六章故障转移-sop)
  - [6.1 故障检测方法](#61-故障检测方法)
  - [6.2 自动/手动故障转移步骤](#62-自动手动故障转移步骤)
  - [6.3 回归测试检查清单](#63-回归测试检查清单)
  - [6.4 数据完整性验证流程](#64-数据完整性验证流程)
- [第七章：容量规划](#第七章容量规划)
  - [7.1 各组件最小 HA 部署规格](#71-各组件最小-ha-部署规格)
  - [7.2 成本估算表（自建 vs 云托管）](#72-成本估算表自建-vs-云托管)
  - [7.3 扩展策略（水平/垂直）](#73-扩展策略水平垂直)
- [第八章：实施路线图](#第八章实施路线图)
  - [8.1 Phase 1: Redis Sentinel 实施](#81-phase-1-redis-sentinel-实施)
  - [8.2 Phase 2: PostgreSQL 主从+Patroni](#82-phase-2-postgresql-主从patroni)
  - [8.3 Phase 3: API多实例+Nginx LB](#83-phase-3-apimulti实例nginx-lb)
  - [8.4 Phase 4: Nginx Keepalived](#84-phase-4-nginx-keepalived)
  - [8.5 Phase 5: 监控HA](#85-phase-5-监控ha)
  - [8.6 总体里程碑与验收标准](#86-总体里程碑与验收标准)

---

## 第一章：HA 目标与 RPO/RTO 定义

### 1.1 可用性目标三级定义

#### 1.1.1 可用性等级标准

GlobalReach V2.0 作为企业级邮件营销平台，需要根据业务重要性制定分级的可用性目标：

| 可用性等级 | 年停机时间 | 月停机时间 | 周停机时间 | 适用场景 |
|-----------|----------|----------|----------|---------|
| **Tier 1: 99.9%** (三个九) | 8小时45分钟 | 43分钟 | 10分钟 | 基础业务运营、非关键功能 |
| **Tier 2: 99.99%** (四个九) | 52分钟 | 4.3分钟 | 1分钟 | 核心业务系统、交易型服务 |
| **Tier 3: 99.999%** (五个九) | 5分钟 | 26秒 | 6秒 | 金融级、电信级关键基础设施 |

#### 1.1.2 GlobalReach 组件可用性等级分配

基于业务影响分析（BIA），为各组件分配可用性等级：

**核心业务层 (Tier 2 - 99.99%)**
- **API 服务**: 邮件发送、客户管理、活动创建等核心功能的入口
- **PostgreSQL 数据库**: 存储所有业务数据、客户信息、邮件记录
- **Redis 缓存**: 会话管理、速率限制、实时计数器

**支撑服务层 (Tier 1 - 99.9%)**
- **Nginx 反向代理**: 流量入口、SSL 终端
- **Grafana 监控面板**: 运维可视化
- **Prometheus 指标采集**: 性能监控数据源

**辅助工具层 (Best Effort)**
- **Loki 日志聚合**: 故障排查支持
- **Tempo 分布式追踪**: 性能分析工具
- **Mailpit 测试邮件**: 开发/测试环境专用
- **AlertManager 告警路由**: 依赖 Prometheus

#### 1.1.3 可用性计算公式

```
可用性 % = (总时间 - 停机时间) / 总时间 × 100%

示例计算 (99.99%):
- 年度总时间: 365 × 24 × 60 = 525,600 分钟
- 允许停机时间: 525,600 × 0.0001 = 52.56 分钟
- 平均每月允许: 52.56 / 12 ≈ 4.38 分钟
```

### 1.2 恢复点目标（RPO）分级

RPO 定义了在灾难事件中可接受的最大数据丢失量。

#### 1.2.1 RPO 分级标准

| RPO 等级 | 数据丢失容忍度 | 备份频率 | 实现技术 | 成本 |
|---------|-------------|---------|---------|-----|
| **RPO = 0** | 零丢失 | 同步复制 | 同步流复制、分布式事务 | 高 |
| **RPO ≤ 5分钟** | 近实时 | 连续归档 + WAL 实时传输 | 异步流复制、逻辑复制 | 中 |
| **RPO ≤ 1小时** | 短期可接受 | 定时快照 (每小时) | pg_basebackup、定时备份脚本 | 低 |
| **RPO ≤ 24小时** | 日级可接受 | 每日全量备份 | pg_dump、物理备份 | 最低 |

#### 1.2.2 GlobalReach 组件 RPO 要求

**关键数据 (RPO ≤ 5分钟)**
```yaml
# API 层业务数据
api_business_data:
  rpo_target: "≤5min"
  data_type: "事务性数据"
  examples:
    - "邮件发送记录"
    - "客户资料变更"
    - "活动配置更新"
    - "用户操作日志"
  implementation:
    - "PostgreSQL 异步流复制 (WAL 实时传输)"
    - "应用层双写确认"
    - "Redis AOF 持久化 (everysec)"
```

**重要配置 (RPO ≤ 1小时)**
```yaml
# 系统配置与元数据
system_configuration:
  rpo_target: "≤1h"
  data_type: "配置数据"
  examples:
    - "Nginx 路由规则"
    - "Prometheus 告警规则"
    - "Grafana Dashboard 配置"
    - "环境变量 (.env 文件)"
  implementation:
    - "Git 版本控制 (配置即代码)"
    - "定时卷快照 (每小时)"
    - "配置文件外部化到 ConfigMap/Secret"
```

**静态资源 (RPO = 0)**
```yaml
# 不可变资产
static_assets:
  rpo_target: "0"  # 通过版本控制保证
  data_type: "代码与静态文件"
  examples:
    - "前端构建产物 (dist/)"
    - "Docker 镜像"
    - "SSL 证书 (Let's Encrypt 自动续期)"
  implementation:
    - "CI/CD 管道版本化"
    - "镜像仓库多副本"
    - "CDN 边缘缓存"
```

**监控数据 (RPO ≤ 24小时)**
```yaml
# 运维观测性数据
observability_data:
  rpo_target: "≤24h"
  data_type: "时序指标与日志"
  examples:
    - "Prometheus TSDB 数据"
    - "Loki 日志索引"
    - "Tempo Trace 数据"
  implementation:
    - "远程存储 (Thanos/Cortex)"
    - "S3/GCS 对象存储冷备"
    - "本地卷定期清理策略"
```

### 1.3 恢复时间目标（RTO）分级

RTO 定义了从故障发生到服务完全恢复的最大允许时间。

#### 1.3.1 RTO 分级矩阵

| 组件类型 | RTO 目标 | 恢复方式 | 自动化程度 | 人力介入 |
|---------|---------|---------|-----------|---------|
| 无状态服务 (API/Nginx) | ≤ 30秒 | 实例替换/自动扩容 | 全自动 | 无需 |
| 有状态缓存 (Redis) | ≤ 2分钟 | Sentinel 自动故障转移 | 半自动 | 监控告警 |
| 主数据库 (PostgreSQL Primary) | ≤ 5分钟 | Patroni 自动切换 | 半自动 | 确认通知 |
| 从数据库 (PostgreSQL Replica) | ≤ 10分钟 | 重建或提升 | 手动触发 | 运维操作 |
| 存储系统 | ≤ 30分钟 | 卷恢复/重建 | 手动+脚本 | 运维+存储团队 |
| 整个区域故障 | ≤ 2小时 | 灾难恢复 (DR) 启动 | 手动流程 | 多团队协作 |

#### 1.3.2 GlobalReach 组件 RTO 详细要求

**API 服务层**
```yaml
api_service_rto:
  target: "≤30s"
  recovery_mechanism:
    - "Kubernetes/Docker Swarm 自动重启"
    - "健康检查失败 → Pod 替换"
    - "负载均衡自动摘除不健康节点"
  rollback_strategy:
    - "立即回滚到上一稳定版本 (镜像标签回退)"
    - "数据库迁移回滚脚本预置"
  validation:
    - "/api/v1/health 端点返回 200"
    - "Smoke test 通过 (CRUD 操作正常)"
```

**数据库层**
```yaml
database_rto:
  primary_failure: "≤5min"
  replica_failure: "≤10min"
  recovery_mechanism:
    primary:
      detection: "Patroni health check (每 2 秒)"
      election: "Raft 一致性算法选举新主库"
      promotion: "Replica 提升为 Primary (< 10s)"
      route_update: "PgBouncer/DNS 更新连接串"
      notification: "PagerDuty/钉钉/邮件告警"
    replica:
      detection: "Patroni 流复制延迟监控 (> 1MB)"
      action: "pg_basebackup 从 Primary 重新初始化"
      estimation: "取决于数据量 (100GB ≈ 15min)"
  data_validation:
    - "SELECT count(*) 对比主从数据一致性"
    - "pg_stat_replication 确认复制状态"
    - "应用层集成测试套件运行"
```

**缓存层**
```yaml
redis_rto:
  target: "≤2min"
  recovery_mechanism:
    master_failure:
      detection: "Sentinel SDOWN → ODOWN (30s 内 2 个 Sentinel 确认)"
      failover: "自动选举新 Master (< 3s)"
      client_update: "Sentinel 返回新 Master 地址"
      cache_warmup: "被动加载 (请求时重建)"
    data_loss_acceptance:
      - "异步复制场景下最多丢失最后几秒写入"
      - "会话数据可通过 JWT 重建 (无状态化设计)"
      - "速率限制计数器重置 (可接受短暂限流失效)"
```

### 1.4 成本/复杂度/可用性三维权衡矩阵

#### 1.4.1 权衡决策框架

在 HA 架构设计中，需要在三个维度之间取得平衡：

```
                    高可用性 (Availability)
                          ↑
                          │
          ┌──────────────┼──────────────┐
          │              │              │
     低复杂度      中等复杂度       高复杂度
     低成本        中等成本         高成本
          │              │              │
          └──────────────┼──────────────┘
                          │
                    成本效益最优区域
```

#### 1.4.2 GlobalReach 推荐平衡点

基于企业级 SaaS 平台的定位，推荐采用 **"中等复杂度 + 中等成本 + 99.99% 可用性"** 的平衡策略：

| 维度 | 选择 | 理由 |
|------|------|------|
| **可用性目标** | 99.99% (Tier 2) | 企业客户 SLA 要求；避免过度工程化 (五个九成本指数增长) |
| **架构复杂度** | 中等 (Docker Compose HA) | 团队熟悉 Docker 生态；避免 K8s 学习曲线陡峭 |
| **基础设施成本** | 中等 (2-3 节点集群) | 单节点年成本 ¥15,000 → HA 集群 ¥40,000-60,000 |
| **运维复杂度** | 可控 (自动化为主) | Patroni/Sentinel 自动故障转移减少人工干预 |
| **技术债务风险** | 低 (成熟方案) | PostgreSQL 流复制、Redis Sentinel 均为生产验证方案 |

#### 1.4.3 不同可用性等级的成本对比

| 可用性等级 | 基础设施成本 (年) | 运维人力成本 (年) | 总拥有成本 (TCO) | ROI 评估 |
|-----------|------------------|-----------------|-----------------|---------|
| 99.9% (单节点+备份) | ¥15,000 | ¥50,000 (0.5 FTE) | ¥65,000 | 基线 |
| 99.99% (Docker Compose HA) | ¥55,000 | ¥80,000 (0.8 FTE) | ¥135,000 | +108% |
| 99.999% (K8s + 多 AZ) | ¥200,000 | ¥150,000 (1.5 FTE) | ¥350,000 | +438% |

**结论**: 对于 GlobalReach V2.0 当前阶段（企业客户 < 500），99.99% 可用性是最具性价比的选择。

---

## 第二章：现状单点故障分析（SPOF Audit）

### 2.1 当前架构组件清单

基于 `docker-compose.prod.yml` 分析，当前 GlobalReach V2.0 生产环境包含以下 **13 个容器**：

| 序号 | 服务名 | 容器名 | 镜像版本 | 端口 | 功能描述 | SPOF 风险等级 |
|-----|--------|-------|---------|------|---------|-------------|
| 1 | postgres | globalreach-postgres | postgres:15-alpine | 5432 | 主数据库 | 🔴 **严重** |
| 2 | redis | globalreach-redis | redis:7.4.9-alpine | 6379 | 缓存/会话 | 🔴 **严重** |
| 3 | api | globalreach-api-prod | globalreach-project-api:latest | 3000 | 应用服务 | 🟠 **高** |
| 4 | nginx | globalreach-nginx-prod | nginx:1.31.1-alpine | 80,443 | 反向代理 | 🟠 **高** |
| 5 | prometheus | globalreach-prometheus | prom/prometheus:v3.12.0 | 9090 | 指标采集 | 🟡 **中** |
| 6 | grafana | globalreach-grafana | grafana/grafana:13.0.2 | 3002 | 监控面板 | 🟡 **中** |
| 7 | node-exporter | globalreach-node-exporter | prom/node-exporter:v1.11.1 | 9100 | 主机指标 | 🟢 **低** |
| 8 | postgres-exporter | globalreach-pg-exporter | prometheuscommunity/postgres-exporter:v0.19.1 | 9187 | DB 指标 | 🟢 **低** |
| 9 | loki | globalreach-loki | grafana/loki:3.7.2 | 3100 | 日志聚合 | 🟡 **中** |
| 10 | promtail | globalreach-promtail | grafana/promtail:3.6.8 | - | 日志收集 | 🟢 **低** |
| 11 | tempo | globalreach-tempo | grafana/tempo:2.5.0 | 3200,4317,4318 | 分布式追踪 | 🟡 **中** |
| 12 | alertmanager | globalreach-alertmanager | prom/alertmanager:v0.32.2 | 9093 | 告警路由 | 🟡 **中** |
| 13 | mailpit | globalreach-mailpit | axllent/mailpit:v1.30.1 | 8025,1025 | 测试邮件 | 🟢 **低** |

**额外**: certbot (按需启动, profile=ssl)

### 2.2 SPOF 风险评估矩阵

#### 2.2.1 风险评分模型

采用 **影响概率 × 影响程度** 的定量评估模型：

```
风险评分 = 发生概率(P) × 影响程度(I) × 暴露时长(E)

其中：
- P (Probability): 1-5 分 (1=极罕见, 5=频繁发生)
- I (Impact): 1-5 分 (1=微不足道, 5=灾难性)
- E (Exposure): 1-3 分 (1=快速恢复, 3=长时间不可用)

风险等级划分：
  🔴 严重 (Critical): 评分 ≥ 20  → 必须立即解决
  🟠 高 (High):       评分 15-19 → 本季度内解决
  🟡 中 (Medium):     评分 10-14 → 下季度规划
  🟢 低 (Low):        评分 < 10   → 监控观察即可
```

#### 2.2.2 各组件 SPOF 详细评分

**🔴 PostgreSQL (评分: 25 = 5×5×1)**

```yaml
spof_analysis_postgres:
  component: "PostgreSQL 15 单实例"
  probability: 5  # "磁盘满、内存溢出、进程崩溃均可能导致"
  impact: 5       # "所有业务数据无法读写，平台完全瘫痪"
  exposure: 1     # "但恢复相对较快 (有卷持久化和备份)"
  
  failure_modes:
    - mode: "磁盘空间耗尽 (100%)"
      likelihood: "高 (日志/数据增长)"
      symptom: "ERROR: could not write to file"
      mitigation: "自动化清理脚本 + 卷扩容告警"
      
    - mode: "内存溢出 (OOM Killer)"
      likelihood: "中 (查询优化不当)"
      symptom: "Postmaster terminated by signal 9"
      mitigation: "shared_buffers 调优 + work_mem 限制 + cgroup 内存限制"
      
    - mode: "WAL 文件损坏"
      likelihood: "低 (硬件故障/异常关机)"
      symptom: "PANIC: could not locate a valid checkpoint record"
      mitigation: "流复制 + pg_rewind + 时间点恢复 (PITR)"
      
    - mode: "锁等待风暴"
      likelihood: "中 (长事务未提交)"
      symptom: "大量查询处于 'waiting' 状态"
      mitigation: "lock_timeout 设置 + pg_stat_activity 监控 + 自动 kill 超时事务"

  business_impact:
    immediate:
      - "API 所有接口返回 500 错误 (DB connection refused)"
      - "用户无法登录 (session 查询失败)"
      - "邮件队列停止处理 (任务状态无法更新)"
    downstream:
      - "Redis 缓存穿透 (缓存未命中直接打 DB)"
      - "Prometheus 告警风暴 (所有 DB 相关指标异常)"
    financial:
      - "SLA 违约赔偿 (如承诺 99.9% 可用性)"
      - "客户信任度下降 (品牌声誉受损)"

  current_protections:
    - "✅ Docker volume 持久化 (postgres_data)"
    - "✅ 健康检查 (pg_isready 每 30s)"
    - "✅ restart: unless-stopped (自动重启)"
    - "❌ 无主从复制 (单点故障)"
    - "❌ 无自动故障转移 (需人工干预)"
    - "❌ 无异地灾备 (同机房风险)"
```

**🔴 Redis (评分: 25 = 5×5×1)**

```yaml
spof_analysis_redis:
  component: "Redis 7.4.9 单实例"
  probability: 5  # "内存使用不当、fork 阻塞、AOF 重写失败"
  impact: 5       # "会话丢失、限流失效、队列阻塞"
  exposure: 1     # "重启后可从 AOF/RDB 恢复 (可能有少量丢失)"
  
  failure_modes:
    - mode: "最大内存超限 (maxmemory)"
      likelihood: "高 (缓存数据增长)"
      symptom: "OOM command not allowed when used memory > 'maxmemory'"
      mitigation: "maxmemory-policy=allkeys-lru + 监控 used_memory"
      
    - mode: "持久化失败 (AOF fsync 错误)"
      likelihood: "中 (磁盘 I/O 瓶颈)"
      symptom: "Background saving/AOF rewriting failed"
      mitigation: "no-appendfsync-on-rewrite + SSD 存储"
      
    - mode: "fork 阻塞 (BGSAVE/BGREWRITEAOF)"
      likelihood: "高 (大数据集 > 2GB)"
      symptom: "延迟飙升 (latency > 100ms)"
      mitigation: "thp disable + vm.overcommit_memory=1"

  business_impact:
    immediate:
      - "所有用户会话强制登出 (session store 不可用)"
      - "速率限制失效 (可能遭受 DDoS 攻击)"
      - "邮件发送队列堵塞 (Bull/Redis 队列依赖)"
    cascading:
      - "API 大量报错 (依赖 Redis 的中间件全部失败)"
      - "用户体验急剧下降 (频繁要求重新登录)"

  current_protections:
    - "✅ Redis volume 持久化 (redis_data)"
    - "✅ 健康检查 (redis-cli ping 每 30s)"
    - "✅ restart: unless-stopped"
    - "❌ 无 Sentinel (无自动故障转移)"
    - "❌ 无主从复制 (数据无冗余)"
    - "❌ 无 Cluster 模式 (无分片能力)"
```

**🟠 Nginx (评分: 18 = 4×3×1.5)**

```yaml
spof_analysis_nginx:
  component: "Nginx 1.31.1 单实例反向代理"
  probability: 4  # "配置错误、证书过期、端口冲突"
  impact: 3       # "外部流量完全无法进入 (但内部服务正常)"
  exposure: 1.5   # "修复较快 (通常 < 5分钟)"
  
  failure_modes:
    - mode: "SSL 证书过期/配置错误"
      likelihood: "中 (Let's Encrypt 续期失败)"
      symptom: "SSL_ERROR_SYSCALL / ERR_CERT_AUTHORITY_INVALID"
      mitigation: "certbot auto-renewal cron + 提前 30 天提醒"
      
    - mode: "上游服务器全部不可用"
      likelihood: "低 (API 服务正常情况下)"
      symptom: "502 Bad Gateway"
      mitigation: "upstream backup server + proxy_next_upstream"
      
    - mode: "配置语法错误 (reload 失败)"
      likelihood: "低 (CI/CD 配置校验)"
      symptom: "nginx: configuration file test failed"
      mitigation: "nginx -t 前置检查 + git 版本控制"

  business_impact:
    immediate:
      - "所有外部访问中断 (HTTP/HTTPS 均不可达)"
      - "API 文档页面无法访问 (/docs)"
      - "前端 SPA 无法加载 (由 Nginx 托管 dist/)"
    user_visible:
      - "浏览器显示 '无法访问此网站'"
      - "移动 App 显示网络错误"

  current_protections:
    - "✅ 健康检查 (nginx pid 存活检测)"
    - "✅ SSL 证书目录挂载 (letsencrypt/)"
    - "✅ ACME challenge 目录支持"
    - "❌ 无备用 LB (Keepalived/VRRP 未配置)"
    - "❌ 无 DNS Round Robin (单 IP 解析)"
    - "❌ 无云 LB 后端 (ALB/NLB 未接入)"
```

**🟠 API Node (评分: 16 = 4×4×1)**

```yaml
spof_analysis_api:
  component: "Express.js API 单实例"
  probability: 4  # "内存泄漏、未捕获异常、依赖包 bug"
  impact: 4       # "核心业务逻辑不可执行"
  exposure: 1     # "Node.js 进程重启快 (< 10s)"
  
  failure_modes:
    - mode: "内存泄漏导致 OOM"
      likelihood: "高 (长时间运行的 Node.js 常见问题)"
      symptom: "FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed"
      mitigation: "--max-old-space-size=384 + heap dump 分析 + PM2 重启"
      
    - mode: "未捕获 Promise Rejection"
      likelihood: "中 (异步代码错误处理不当)"
      symptom: "process exit with code 1 (UnhandledPromiseRejection)"
      mitigation: "全局 unhandledRejection handler + Sentry 错误追踪"
      
    - mode: "数据库连接池耗尽"
      likelihood: "中 (慢查询/连接泄露)"
      symptom: "Error: connect ECONNREFUSED / timeout acquiring connection"
      mitigation: "pool size 调优 (默认 10 → 动态调整) + 连接超时设置"

  business_impact:
    immediate:
      - "所有 API 端点返回 503 Service Unavailable"
      - "前端功能完全不可用 (SPA 依赖 API)"
      - "Webhook 回调失败 (第三方集成中断)"
    data_integrity:
      - "正在处理的邮件发送可能中断 (幂等性保护?)"
      - "批量导入任务可能部分完成 (需要补偿机制)"

  current_protections:
    - "✅ 健康检查 (/api/v1/health 每 30s)"
    - "✅ 内存限制 (deploy.resources.limits.memory: 512M)"
    - "✅ CPU 限制 (cpus: '1.0')"
    - "✅ 日志轮转 (json-file driver, max 3×10MB)"
    - "✅ restart: unless-stopped"
    - "❌ 无多实例 (无负载均衡)"
    - "❌ 无滚动更新 (部署期间短暂中断)"
    - "❌ 无优雅关闭 (SIGTERM 可能丢失请求)"
```

**🟡 Docker Host (评分: 20 = 5×4×1)**

```yaml
spof_analysis_docker_host:
  component: "单一 Docker 宿主机"
  probability: 5  # "硬件故障、OS 崩溃、内核 panic"
  impact: 4       # "所有 13 个容器同时不可用"
  exposure: 1     # "但容器可在其他宿主机快速重建"
  
  failure_modes:
    - mode: "物理硬件故障 (磁盘/内存/CPU)"
      likelihood: "低 (现代服务器 MTBF > 100,000 小时)"
      symptom: "Kernel panic / BIOS POST error"
      mitigation: "RAID 磁盘阵列 + ECC 内存 + 冗余电源"
      
    - mode: "操作系统崩溃 (Windows/Linux kernel panic)"
      likelihood: "中 (驱动程序 bug、安全补丁兼容性)"
      symptom: "BSOD / Kernel panic - not syncing"
      mitigation: "定期 OS 更新 + 稳定版内核 + 快照回滚"
      
    - mode: "Docker Daemon 崩溃"
      likelihood: "中 (资源耗尽、存储驱动损坏)"
      symptom: "Cannot connect to the Docker daemon"
      mitigation: "systemd 自动重启 docker.service + 日志监控"

  business_impact:
    scope: "全局性 (所有服务同时中断)"
    recovery_time: "≥ 30分钟 (新宿主机环境准备 + 数据卷恢复)"
    
  mitigation_strategies:
    short_term:
      - "定期完整备份 (包括 Docker volumes)"
      - "Infrastructure as Code (IaC) 自动重建能力"
    long_term:
      - "多宿主机 Docker Swarm/Kubernetes 集群"
      - "云厂商托管服务 (RDS/ElastiCache 替代自建)"
```

### 2.3 Top 5 关键 SPOF 详细分析

基于上述评估，按风险评分排序的 **Top 5 关键 SPOF**:

#### 🥇 #1 PostgreSQL (评分: 25)

**为什么是最高优先级？**

1. **数据资产价值最高**: PostgreSQL 存储了所有客户数据、邮件记录、业务配置 — 这是企业的核心数字资产
2. **恢复复杂度最高**: 相比 Redis（可从缓存重建）或 Nginx（可快速替换），数据库恢复涉及数据一致性验证、WAL 重放、应用层适配等多个环节
3. **业务影响范围最广**: DB 故障会导致 API、Redis 缓存穿透、监控异常等一系列连锁反应
4. **故障概率较高**: 磁盘空间、内存、锁冲突等问题在日常运维中较为常见

**推荐的 HA 解决方案**:
- ✅ **首选**: PostgreSQL 流复制 (Streaming Replication) + Patroni 自动故障转移
- ⚠️ **备选**: pg_auto_failover (更简单但灵活性较低)
- ❌ **不推荐**: 手动主从切换 (RTO > 30分钟，不符合 99.99% 目标)

#### 🥈 #2 Redis (评分: 25)

**为什么并列第一？**

虽然 Redis 通常被视为"缓存"（可丢失），但在 GlobalReach V2.0 架构中承担了**关键角色**：
- Session Store（用户登录态）
- Rate Limiter（防 DDoS 攻击）
- Job Queue（Bull/Redis 邮件队列）

这些功能一旦丢失，将导致**用户体验断崖式下降**和**系统安全性降低**。

**推荐的 HA 解决方案**:
- ✅ **首选**: Redis Sentinel 模式（1 主 2 从 3 哨兵）
- ⚠️ **备选**: Redis Cluster（如果未来需要 > 100GB 内存或更高吞吐）
- ❌ **不推荐**: 仅开启 AOF 持久化（无法解决单点故障）

#### 🥉 #3 Docker Host (评分: 20)

**隐藏的系统性风险**

单个 Docker 宿主机意味着：
- 硬件故障 = 所有 13 个容器同时宕机
- OS 升级/补丁 = 计划内停机（除非有热迁移能力）
- 网络分区 = 完全隔离

**推荐的缓解措施**:
- **短期**: 完善 IaC（Terrafer/Packer）确保 30 分钟内可在新宿主机重建
- **中期**: 迁移至 Docker Swarm（2-3 节点集群）
- **长期**: Kubernetes 多可用区部署

#### #4 Nginx (评分: 18)

**流量入口的单点瓶颈**

Nginx 是系统的"大门"，一旦故障：
- 外部用户完全无法访问（即使内部服务正常）
- SSL 证书终止失败导致 HTTPS 降级攻击面
- 反向代理规则失效导致路由混乱

**推荐的 HA 解决方案**:
- ✅ **首选**: Keepalived VRRP 双机热备（虚拟 IP 漂移）
- ⚠️ **备选**: 云厂商负载均衡器（AWS ALB、阿里云 SLB）
- 💡 **补充**: DNS Round Robin（作为第三层兜底）

#### #5 API Node (评分: 16)

**扩展性与弹性不足**

单实例 API 意味着：
- 无法应对突发流量（黑五/促销活动）
- 零停机部署困难（必须先 stop 再 start）
- 单点性能瓶颈（CPU/内存上限 1核/512MB）

**推荐的 HA 解决方案**:
- ✅ **首选**: 多实例 + Nginx upstream 负载均衡（least_conn 算法）
- ⚠️ **增强**: Kubernetes HPA（水平 Pod 自动伸缩）
- 💡 **前置条件**: 确保 API 无状态化（Session 外部化至 Redis）

### 2.4 SPOF 影响评分汇总表

| 排名 | 组件 | P(概率) | I(影响) | E(暴露) | 总分 | 等级 | 优先级 |
|-----|------|--------|--------|--------|------|------|--------|
| 1 | PostgreSQL | 5 | 5 | 1.0 | **25** | 🔴 严重 | P0 |
| 2 | Redis | 5 | 5 | 1.0 | **25** | 🔴 严重 | P0 |
| 3 | Docker Host | 5 | 4 | 1.0 | **20** | 🔴 严重 | P0 |
| 4 | Nginx | 4 | 3 | 1.5 | **18** | 🟠 高 | P1 |
| 5 | API Node | 4 | 4 | 1.0 | **16** | 🟠 高 | P1 |
| 6 | Prometheus | 3 | 3 | 1.0 | **9** | 🟡 中 | P2 |
| 7 | Grafana | 3 | 2 | 1.0 | **6** | 🟡 中 | P2 |
| 8 | Loki | 3 | 2 | 1.0 | **6** | 🟡 中 | P3 |
| 9 | Tempo | 2 | 2 | 1.0 | **4** | 🟢 低 | P3 |
| 10 | AlertManager | 2 | 2 | 1.0 | **4** | 🟢 低 | P3 |
| 11 | Mailpit | 1 | 1 | 1.0 | **1** | 🟢 低 | P4 |
| 12 | Promtail | 1 | 1 | 1.0 | **1** | 🟢 低 | P4 |
| 13 | PG Exporter | 1 | 1 | 1.0 | **1** | 🟢 低 | P4 |

---

## 第三章：HA 架构方案设计

### 3.1 方案A：Docker Compose HA 轻量级方案（推荐近期实施）

#### 3.1.1 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                     GlobalReach HA Architecture                  │
│                   (Docker Compose Multi-Host)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐                           │
│  │   Internet    │───▶│  DNS / VIP   │                           │
│  └──────────────┘    └──────┬───────┘                           │
│                             │                                   │
│              ┌──────────────┼──────────────┐                    │
│              ▼              ▼              ▼                    │
│     ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│     │  Nginx-LB  │  │  Nginx-LB  │  │  Cloud-LB  │             │
│     │  (Active)  │  │(Standby)   │  │ (Optional) │             │
│     └─────┬──────┘  └─────┬──────┘  └─────┬──────┘             │
│           │               │               │                    │
│           └───────────────┼───────────────┘                    │
│                           ▼                                    │
│                 ┌─────────────────┐                            │
│                 │  Upstream Pool  │                            │
│                 ├─────────────────┤                            │
│                 │ api-prod-01 :3000│                           │
│                 │ api-prod-02 :3000│ ◀── Nginx Least Conn LB  │
│                 └────────┬────────┘                            │
│                          │                                     │
│            ┌─────────────┼─────────────┐                       │
│            ▼             ▼             ▼                       │
│   ┌─────────────┐ ┌───────────┐ ┌───────────┐                │
│   │ PgBouncer   │ │  Redis    │ │  Redis    │                │
│   │ (Conn Pool) │ │ Sentinel  │ │  Master   │                │
│   └──────┬──────┘ └─────┬─────┘ └─────┬─────┘                │
│          │              │              │                      │
│          ▼              ▼              ▼                      │
│   ┌─────────────┐ ┌───────────┐ ┌───────────┐                │
│   │Postgres     │ │ Redis     │ │ Redis     │                │
│   │Primary      │ │ Slave-01  │ │ Slave-02  │                │
│   │(Patroni)    │ │           │ │           │                │
│   └──────┬──────┘ └───────────┘ └───────────┘                │
│          │                                                    │
│          ▼                                                    │
│   ┌─────────────┐                                             │
│   │Postgres     │                                             │
│   │Replica      │ ◀── Streaming Replication (Async)           │
│   │(Patroni)    │                                             │
│   └─────────────┘                                             │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Monitoring & Observability Stack            │   │
│  │  Prometheus-HA │ Grafana-HA │ Loki │ Tempo │ AlertMgr   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.1.2 核心组件 HA 配置详解

##### PostgreSQL HA: 主从复制 + Patroni

**架构选择理由**:
- **流复制 (Streaming Replication)**: 基于 WAL (Write-Ahead Log) 的物理复制，延迟 < 1秒，适合 OLTP 场景
- **Patroni**: 基于 ZooKeeper/etcd/Consul 的分布式共识算法，提供自动故障转移、拓扑管理、配置同步
- **异步模式 (Asynchronous)**: 平衡性能与数据一致性（RPO ≤ 5分钟满足业务需求）

**拓扑结构**:
```
Host-A (Primary)          Host-B (Replica)
┌─────────────────┐      ┌─────────────────┐
│  postgres-primary│      │  postgres-replica│
│  (Port: 5432)   │◀─WAL─│  (Port: 5432)   │
│  Patroni Leader │      │  Patroni Replica │
│  PgBouncer:6432 │      │  PgBouncer:6432 │
└─────────────────┘      └─────────────────┘
         │                        │
         └──────────┬─────────────┘
                    ▼
           ┌─────────────────┐
           │   etcd Cluster  │ ◀── 分布式共识 (DCS)
           │  (3 nodes min)  │
           └─────────────────┘
```

**关键配置参数**:

```yaml
# postgresql.conf (Primary)
postgresql_ha_settings:
  wal_level: "replica"           # 支持流复制和逻辑复制
  max_wal_senders: 3             # 允许 3 个并发流复制连接
  wal_keep_size: "2GB"           # 保留 WAL 文件大小 (防止 Replica 落后太多)
  hot_standby: "on"              # Replica 支持只读查询
  synchronous_commit: "off"       # 异步提交 (性能优先, RPO ≤ 5min)

# postgresql.conf (Replica)
replica_settings:
  hot_standby: "on"
  hot_standby_feedback: "on"     # 向 Primary 反馈查询冲突信息
  max_replication_slots: 3       # 物理复制槽数量
  
# patroni.yml (集群配置模板)
patroni_config:
  scope: "globalreach-postgres"
  rest_api:
    listen: "0.0.0.0:8008"
    connect_address: "${HOST_IP}:8008"
  dcs:
    etcd:
      host: "etcd-1:2379,etcd-2:2379,etcd-3:2379"
  postgresql:
    version: 15
    bin_dir: "/usr/lib/postgresql/15/bin"
    data_dir: "/var/lib/postgresql/data"
    authentication:
      replication:
        username: "replicator"
        password: "${REPLICATOR_PASSWORD}"
      superuser:
        username: "postgres"
        password: "${POSTGRES_PASSWORD}"
    parameters:
      max_connections: 200
      shared_buffers: "256MB"
      effective_cache_size: "768MB"
      maintenance_work_mem: "128MB"
      min_wal_size: "1GB"
      max_wal_size: "4GB"
  tags:
    nofailover: false
    noloadbalance: false
    clonefrom: true
    nosync: false
```

**故障转移流程** (Patroni 自动触发):

```
时间轴:
T+0s    Primary 崩溃 (OOM/Kill/Network Partition)
        │
T+2s    Patroni Leader 检测到健康检查失败 (loop_wait=2s)
        │
T+4s    DCS (etcd) Leader 锁过期 (ttl_loop=10s, 但加速检测)
        │
T+6s    Replica 发起 Leader 选举 (Raft consensus)
        │
T+8s    选举成功, Replica 提升为新 Primary
        │
T+10s   PgBouncer 更新目标地址 (patroni REST API callback)
        │
T+12s   API 应用层重新连接 (连接池刷新)
        │
T+15s   业务恢复正常 (RTO ≈ 15s, 远优于目标的 5min)
        │
T+30s   AlertManager 发送故障转移通知 (邮件/钉钉/Webhook)
```

##### Redis HA: Sentinel 哨兵模式

**架构选择理由**:
- **Sentinel vs Cluster**: GlobalReach 当前数据量 < 10GB，无需分片；Sentinel 提供更简单的自动故障转移
- **1主2从3哨兵**: 满足 quorum (多数派) 要求，防止脑裂 (split-brain)
- **异步复制**: 与 PostgreSQL 保持一致的 RPO 策略

**拓扑结构**:
```
┌────────────────────────────────────────────────────────┐
│                  Redis Sentinel 集群                    │
│                                                        │
│   ┌──────────┐                                        │
│   │ Sentinel-1│──┐                                    │
│   │ :26379   │  │                                    │
│   └──────────┘  │  Quorum = 2                         │
│   ┌──────────┤  (3个Sentinel中至少2个判定Master宕机)   │
│   │ Sentinel-2│──┤                                    │
│   │ :26379   │  │                                    │
│   └──────────┘  │                                    │
│   ┌──────────┤                                    │
│   │ Sentinel-3│──┘                                    │
│   │ :26379   │                                        │
│   └──────────┘                                        │
│         │                                              │
│         ▼                                              │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐     │
│   │  Master  │◀───▶│  Slave-1 │◀───▶│  Slave-2 │     │
│   │  :6379   │ Async│  :6379  │ Async│  :6379  │     │
│   │ (Read/Write)│   │(Read)   │     │(Read)   │     │
│   └──────────┘     └──────────┘     └──────────┘     │
└────────────────────────────────────────────────────────┘
```

**Sentinel 配置模板**:

```conf
# sentinel.conf (通用模板, 每个 Sentinel 实例微调 port/bind)
port 26379
sentinel monitor mymaster ${REDIS_MASTER_IP} 6379 2
sentinel down-after-milliseconds mymaster 30000    # 30s 判定宕机
sentinel failover-timeout mymaster 180000          # 180s 故障转移超时
sentinel parallel-syncs mymaster 1                 # 每次同步 1 个 Replica
sentinel auth-pass mymaster ${REDIS_PASSWORD}

# 防止误判 (网络抖动保护)
sentinel config-epoch mymaster 0
sentinel leader-epoch mymaster 0

# 客户端连接配置变更
# 原: redis://redis:6379
# 新: redis://mymaster:26379 (Sentinel 自动发现 Master 地址)
```

**客户端连接示例 (Node.js ioredis)**:

```javascript
// lib/redis-client.js (HA 模式)
const Redis = require('ioredis');

// Sentinel 模式连接 (替代单点直连)
const redis = new Redis({
  sentinels: [
    { host: 'redis-sentinel-1', port: 26379 },
    { host: 'redis-sentinel-2', port: 26379 },
    { host: 'redis-sentinel-3', port: 26379 },
  ],
  name: 'mymaster',           // Sentinel 监控的主节点名称
  password: process.env.REDIS_PASSWORD,
  enableReadyCheck: true,
  retryStrategy: (times) => {
    const delay = Math.min(times * 100, 3000);
    return delay;              // 指数退避重连
  },
  // 自动重连时更新连接信息
  sentinelRetryStrategy: (times) => Math.min(times * 100, 3000),
});

// 监听故障转移事件 (+switch-master)
redis.on('+switch-master', (type) => {
  logger.info(`[Redis] Master 切换事件: ${type}`);
  // 可在此处触发应用层缓存预热
});
```

##### API Gateway HA: 多实例 + Nginx LB

**无状态化确认清单**:

```yaml
stateless_requirements:
  session_management:
    current: "Express-session (内存存储)"  # ❌ 不符合 HA 要求
    required: "connect-redis (Redis Store)"  # ✅ Session 外部化
    
  file_uploads:
    current: "multer (临时目录)"  # ⚠️ 需要共享存储
    required: "S3/MinIO/OSS 或 NFS 共享卷"
    
  job_queues:
    current: "Bull (Redis-based)"  # ✅ 天然支持分布式
    note: "多个 Worker 可消费同一 Queue"
    
  websocket_connections:
    current: "Socket.io (内存 Adapter)"  # ❌ 单实例限制
    required: "socket.io-redis Adapter"  # ✅ 支持 Sticky Session 或 Pub/Sub"
    
  local_caches:
    current: "node-cache (LRU)"  # ❌ 各实例独立缓存不一致
    required: "仅使用 Redis 集中式缓存"  # ✅ 或接受短暂不一致
```

**Nginx Upstream 配置**:

```nginx
# nginx/conf.d/upstream-ha.conf
upstream api_backend {
    # 最少连接算法 (适合长连接/不同耗时请求场景)
    least_conn;
    
    # API 实例列表 (Docker DNS 自动解析)
    server api-prod-01:3000 weight=1 max_fails=3 fail_timeout=30s;
    server api-prod-02:3000 weight=1 max_fails=3 fail_timeout=30s;
    
    # 长连接保持 (减少 TCP 握手开销)
    keepalive 32;
    
    # 健康检查增强 (主动探测)
    # 注: 需要 ngx_http_healthcheck_module (商业版) 或 Tengine
    # 社区版通过 passive health check (max_fails/fail_timeout) 实现
}

server {
    listen 80;
    server_name api.globalreach.com app.globalreach.com;
    
    location /api/ {
        proxy_pass http://api_backend;
        
        # HA 优化头部
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 支持 WebSocket (如果启用 Socket.io)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # 超时设置 (防止慢请求拖死连接池)
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
        
        # 错误处理 (上游不可用时返回友好提示)
        error_page 502 503 504 /50x.html;
    }
    
    location /50x.html {
        root /usr/share/nginx/html;
        internal;
    }
}
```

**滚动部署策略**:

```bash
#!/bin/bash
# scripts/rolling-deploy.sh (零停机部署示例)

IMAGE_TAG=$1  # 例如: v2.3.1
API_INSTANCES=("api-prod-01" "api-prod-02")

for instance in "${API_INSTANCES[@]}"; do
    echo "[Deploy] 更新实例: $instance"
    
    # 1. 从 Nginx Upstream 摘除该实例 (标记为 down)
    curl -X PATCH "http://nginx-lb/api/upstream/api_backend/server/$instance:3000/down"
    sleep 5  # 等待活跃请求处理完毕
    
    # 2. 停止旧容器
    docker stop $instance || true
    docker rm $instance || true
    
    # 3. 启动新容器 (新镜像)
    docker run -d \
        --name $instance \
        --network globalreach-network \
        -e NODE_ENV=production \
        ...  # 其他环境变量
        globalreach-project-api:$IMAGE_TAG
    
    # 4. 健康检查等待 (最多 60s)
    for i in $(seq 1 12); do
        if curl -sf http://$instance:3000/api/v1/health > /dev/null; then
            echo "[Health] $instance 就绪"
            break
        fi
        sleep 5
    done
    
    # 5. 重新加入 Upstream (标记为 up)
    curl -X PATCH "http://nginx-lb/api/upstream/api_backend/server/$instance:3000/up"
    
    echo "[Done] $instance 已上线"
done

echo "[Success] 所有实例已滚动更新完成"
```

##### Nginx/LB HA: Keepalived VRRP 双机热备

**VRRP (Virtual Router Redundancy Protocol)** 工作原理:

```
┌────────────────────────────────────────────────────────────┐
│                    Keepalived VRRP 拓扑                     │
│                                                            │
│   Client Request                                           │
│        │                                                   │
│        ▼                                                   │
│   Virtual IP (VIP): 192.168.1.100                          │
│        │                                                   │
│   ┌────┴────┐                                              │
│   │         │                                              │
│   ▼         ▼                                              │
│ ┌────────┐ ┌────────┐                                      │
│ │ Host-A │ │ Host-B │                                      │
│ │MASTER  │ │BACKUP  │                                      │
│ │Priority│ │Priority│                                      │
│ │ = 100  │ │ = 90   │                                      │
│ │        │ │        │                                      │
│ │Nginx:80│ │Nginx:80│  ← 互为热备                          │
│ │Nginx:443│ │Nginx:443│                                   │
│ └────────┘ └────────┘                                      │
│                                                            │
│ VRRP Advertisement Interval: 1s                            │
│ Master Down Detection: 3 missed ads (≈3s)                  │
│ Failover Time: < 5s (含 ARP 缓存刷新)                       │
└────────────────────────────────────────────────────────────┘
```

**Keepalived 配置** (Host-A - MASTER):

```conf
# /etc/keepalived/keepalived.conf (Master 节点)
! Configuration File for keepalived

global_defs {
   router_id LVS_DEVEL
   script_user root
   enable_script_security
}

vrrp_instance VI_1 {
    state MASTER                    # 初始角色 (启动后通过优先级竞争)
    interface eth0                   # 绑定网卡 (需替换为实际网卡名)
    virtual_router_id 51            # VRID (同一集群必须一致, 0-255)
    priority 100                    # 优先级 (数值越高越优先)
    advert_int 1                    # VRRP 广播间隔 (秒)

    authentication {
        auth_type PASS              # 简单密码认证
        auth_pass globalreach_vip_2026  # 密码 (最长 8 字符)
    }

    virtual_ipaddress {
        192.168.1.100/24            # 虚拟 IP (VIP)
    }

    # 健康检查脚本 (Nginx 挂了则降低优先级, 触发切换)
    track_script {
        check_nginx
    }
}

# Nginx 进程存活检查
vrrp_script check_nginx {
    script "killall -0 nginx"       # 检查 nginx 进程是否存在
    interval 2                      # 检查间隔 (秒)
    weight -20                      # 失败时优先级 -20 (100→80 < Backup的90)
    fall 3                          # 连续 3 次失败判定为 down
    rise 2                          # 连续 2 次成功判定为 up
}
```

**Keepalived 配置** (Host-B - BACKUP):

```conf
# /etc/keepalived/keepalived.conf (Backup 节点)
vrrp_instance VI_1 {
    state BACKUP                   # 初始角色
    interface eth0
    virtual_router_id 51
    priority 90                    # 比 Master 低 10
    advert_int 1

    authentication {
        auth_type PASS
        auth_pass globalreach_vip_2026
    }

    virtual_ipaddress {
        192.168.1.100/24
    }

    track_script {
        check_nginx
    }
}
```

**DNS Round Robin 备选方案** (当无法使用 VIP 时):

```dns
;; Zone File Example (BIND/DNSPod)
$TTL 60  ; 低 TTL 加速故障切换感知
api.globalreach.com.  IN  A  192.168.1.101  ; Host-A Nginx
api.globalreach.com.  IN  A  192.168.1.102  ; Host-B Nginx

;; 注意事项:
;; 1. 客户端 DNS 缓存可能导致部分流量仍打到故障节点 (TTL 60s 缓解)
;; 2. 适合读多写少场景 (Session Affinity 难以保证)
;; 3. 需配合健康检查 DNS 服务 (Route53 Health Checks/阿里云云解析)
```

**云厂商 LB 适配指南**:

| 云厂商 | 产品名称 | 协议支持 | 健康检查 | 备注 |
|-------|---------|---------|---------|------|
| AWS | ALB (Application Load Balancer) | HTTP/HTTPS/TCP | ✅ 自动 | 支持 Target Group |
| AWS | NLB (Network Load Balancer) | TCP/UDP/TLS | ✅ 自动 | 超低延迟 (< 100ms) |
| 阿里云 | SLB (Server Load Balancer) | Layer 4/7 | ✅ 自定义 | 支持会话保持 |
| 腾讯云 | CLB (Cloud Load Balancer) | Layer 4/7 | ✅ 自动 | 类似阿里云 SLB |
| Google Cloud | Global External LB | HTTP(S)/TCP/SSL | ✅ 自动 | Anycast IP |

**迁移至云 LB 步骤**:
```bash
# 1. 创建 Target Group (后端服务器组)
aws elbv2 create-target-group \
    --name api-backend-tg \
    --protocol HTTP \
    --port 80 \
    --health-check-path /api/v1/health \
    --health-check-interval-seconds 30 \
    --unhealthy-threshold 2 \
    --healthy-threshold 2

# 2. 注册 Nginx 实例 (或直接注册 API 实例)
aws elbv2 register-targets \
    --target-group-arn arn:aws:elasticloadbalancing:... \
    --targets Id=i-xxxxxxx,Id=i-yyyyyyy

# 3. 创建 ALB 并关联 Target Group
aws elbv2 create-load-balancer \
    --name globalreach-alb \
    --subnets subnet-xxx,subnet-yyy \
    --security-groups sg-zzz

# 4. DNS 切换 (CNAME → ALB DNS Name)
# 等待 TTL 过期 + 全球传播 (通常 < 5分钟)
```

### 3.2 方案B：Kubernetes 迁移路径（远期规划）

#### 3.2.1 K8s 资源映射关系

| Docker Compose 组件 | K8s 资源类型 | 工作负载特性 | 说明 |
|-------------------|------------|-----------|------|
| postgres | StatefulSet + PVC | 有状态 | 稳定网络标识 (postgres-0, postgres-1) |
| redis | StatefulSet + PVC | 有状态 | 可考虑 Operator (Redis Operator) |
| api | Deployment + HPA | 无状态 | 水平伸缩 (2-10 replicas) |
| nginx | Deployment + Service | 无状态 | Ingress Controller (NGINX Ingress) |
| prometheus | StatefulSet + PVC | 有状态 | 或使用 Prometheus Operator |
| grafana | Deployment + PVC | 有状态 | Dashboard ConfigMap 挂载 |
| node-exporter | DaemonSet | 守护进程 | 每节点运行一个 |
| loki | StatefulSet + PVC | 有状态 | 日志聚合 |
| promtail | DaemonSet | 守护进程 | 日志收集 |
| tempo | StatefulSet + PVC | 有状态 | Tracing Backend |
| alertmanager | StatefulSet | 有状态 | Gossip Cluster (3 replicas) |
| mailpit | Deployment | 无状态 | 仅测试环境 |
| certbot | CronJob | 定时任务 | 证书自动续期 |

#### 3.2.2 Helm Chart 结构建议

```
globalreach-chart/
├── Chart.yaml                    # Chart 元数据 (version, description)
├── values.yaml                   # 默认值 (覆盖点)
├── values-prod.yaml              # 生产环境覆盖值
├── templates/
│   ├── _helpers.tpl              # 模板辅助函数
│   ├── namespace.yaml            # 命名空间隔离
│   ├── secrets.yaml              # 敏感信息 (K8s Secret)
│   ├── configmaps.yaml           # 配置文件 (ConfigMap)
│   ├── postgres/
│   │   ├── statefulset.yaml      # PostgreSQL StatefulSet
│   │   ├── service.yaml          # Headless Service (稳定 DNS)
│   │   └── pvc.yaml              # 持久化卷声明
│   ├── redis/
│   │   ├── statefulset.yaml      # Redis StatefulSet
│   │   ├── service.yaml          # Headless Service
│   │   └── pvc.yaml
│   ├── api/
│   │   ├── deployment.yaml       # API Deployment
│   │   ├── service.yaml          # ClusterIP Service
│   │   ├── hpa.yaml              # Horizontal Pod Autoscaler
│   │   └── ingress.yaml          # Ingress 路由规则
│   ├── nginx/
│   │   ├── deployment.yaml       # Nginx Ingress Controller
│   │   ├── configmap.yaml        # Nginx 配置
│   │   └── service.yaml          # LoadBalancer Service
│   ├── monitoring/
│   │   ├── prometheus.yaml       # Prometheus Stack (或引用 kube-prometheus-stack)
│   │   ├── grafana.yaml          # Grafana 部署
│   │   └── alertmanager.yaml     # AlertManager
│   └── logging/
│       ├── loki.yaml             # Loki 日志系统
│       └── promtail.yaml         # Promtail DaemonSet
└── charts/                       # 依赖 Charts (可选)
    └── kube-prometheus-stack/    # 引用社区 Helm Chart
```

**values.yaml 关键配置片段**:

```yaml
# globalreach-chart/values.yaml
global:
  environment: production
  imageRegistry: harbor.globalreach.com
  imagePullSecrets:
    - name: registry-credentials

postgresql:
  enabled: true
  replication:
    enabled: true
    numReplicas: 1
    synchronousCommit: "off"      # 异步复制
  resources:
    requests:
      cpu: "500m"
      memory: "512Mi"
    limits:
      cpu: "2000m"
      memory: "2Gi"
  persistence:
    enabled: true
    storageClass: "gp3"           # AWS EBS gp3 (或 local-path)
    size: "100Gi"

redis:
  enabled: true
  architecture: "standalone"      # 初期 standalone, 后续升级为 cluster
  auth:
    password: "${REDIS_PASSWORD}"
  master:
    persistence:
      enabled: true
      size: "10Gi"

api:
  enabled: true
  replicaCount: 2                 # 默认 2 实例 (HA)
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70
  env:
    - name: DATABASE_URL
      valueFrom:
        secretKeyRef:
          name: postgres-secret
          key: url
    - name: REDIS_HOST
      value: "redis-master"
  resources:
    requests:
      cpu: "250m"
      memory: "256Mi"
    limits:
      cpu: "1000m"
      memory: "512Mi"

ingress:
  enabled: true
  className: "nginx"
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
  hosts:
    - host: api.globalreach.com
      paths:
        - path: /api
          pathType: Prefix
    - host: app.globalreach.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: globalreach-tls
      hosts:
        - api.globalreach.com
        - app.globalreach.com
```

#### 3.2.3 迁移分阶段路线图

```
Phase 0: 准备阶段 (2周)
├── K8s 集群搭建 (EKS/GKE/自建 kubeadm)
├── CI/CD 管道改造 (Docker Build → Helm Push)
├── 团队培训 (kubectl/helm 基础)
└── 非生产环境验证 (Staging 环境)

Phase 1: 无状态服务迁移 (2周)
├── API → Deployment + HPA (最简单, 验证流程)
├── Nginx → Ingress Controller
├── Certbot → cert-manager (自动证书管理)
└── Mailpit → Deployment (测试环境保留)

Phase 2: 有状态服务迁移 (3周) ⚠️ 高风险
├── Redis → StatefulSet (先 standalone, 后 cluster)
├── PostgreSQL → StatefulSet + Patroni Operator
│   ├── 数据迁移 (pg_dump → kubectl exec psql)
│   ├── 双写验证 (并行运行 1 周)
│   └── 流量切换 (DNS 或 Service Mesh)
└── 监控组件迁移 (Prometheus/Grafana/Loki)

Phase 3: 优化与加固 (2周)
├── NetworkPolicy (网络隔离)
├── Pod Disruption Budget (PDB)
├── Resource Quotas (资源配额)
└── Chaos Engineering (混沌工程测试)

Phase 4: 清理与归档 (1周)
├── Docker Compose 环境下线
├── 文档更新 (Runbook 改造)
└── 知识沉淀 (复盘总结)
```

### 3.3 方案对比与选型建议

| 维度 | 方案A: Docker Compose HA | 方案B: Kubernetes | 推荐 |
|------|------------------------|-------------------|------|
| **实施周期** | 4-6 周 | 3-6 个月 | ✅ 方案A |
| **学习曲线** | 低 (团队已熟悉 Docker) | 高 (K8s 概念众多) | ✅ 方案A |
| **初期成本** | ¥55,000/年 (2-3台服务器) | ¥150,000+/年 (托管K8s) | ✅ 方案A |
| **运维复杂度** | 中等 (Patroni/Sentinel) | 高 (Operator/CRD) | ✅ 方案A |
| **弹性伸缩** | 手动/脚本 (Scale Up/Down) | 自动 (HPA/VPA) | ✅ 方案B |
| **服务网格** | 不支持 | Istio/Linkerd | ✅ 方案B |
| **多租户隔离** | 网络命名空间 | Namespace + RBAC | ✅ 方案B |
| **故障自愈** | 部分 (Restart Policy) | 全自动 (ReplicaSet) | ✅ 方案B |
| **适用规模** | < 10 个微服务 | 10+ 微服务 | ✅ 方案A |
| **团队规模** | 1-3 人 DevOps | 5+ 人 SRE 团队 | ✅ 方案A |

**最终建议**:

> **短期 (0-6个月)**: 采用 **方案A (Docker Compose HA)** 快速消除 Top 5 SPOF，达到 99.99% 可用性目标。
>
> **中期 (6-18个月)**: 在业务增长、团队扩充后，评估 **方案B (Kubernetes)** 迁移的投入产出比。
>
> **长期 (18个月+)**: 如果 GlobalReach 发展为平台级产品 (多租户、多区域)，Kubernetes 将成为必然选择。

---

## 第四章：各组件详细 HA 实现

### 4.1 PostgreSQL 高可用实现

#### 4.1.1 流复制配置详解

**Streaming Replication vs Logical Replication 选择**:

| 特性 | Streaming Replication (物理复制) | Logical Replication (逻辑复制) |
|------|----------------------------------|-------------------------------|
| 复制粒度 | 整个实例 (所有数据库/表) | 可选择性发布表/数据库 |
| 延迟 | < 1ms (WAL 实时传输) | 1-10ms (解码开销) |
| 数据类型支持 | 所有类型 (二进制) | 受限于输出插件 |
| DDL 支持 | ✅ 自动复制 | ❌ 需手动同步 |
| 跨版本 | ❌ 必须相同大版本 | ✅ 支持跨版本 (如 15→16) |
| 适用场景 | HA 灾备、读写分离 | 数据集成、CDC (Change Data Capture) |

**GlobalReach 选择**: **Streaming Replication** (物理复制)
- 理由: HA 场景需要完整实例复制、最低延迟、DDL 自动同步

**Primary 节点配置** (`docker-compose.ha.yml`):

```yaml
services:
  postgres-primary:
    image: postgres:15-alpine
    container_name: ha-postgres-primary
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${DB_NAME:-globalreach_prod}
      POSTGRES_USER: ${DB_USER:-globalreach_user}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-changeme}
      # 复制用户 (用于流复制连接)
      POSTGRES_REPLICATION_USER: replicator
      POSTGRES_REPLICATION_PASSWORD: ${REPLICATOR_PASSWORD:-replicator_secret}
    command:
      - "postgres"
      - "-c"  # 直接传入 postgresql.conf 参数 (覆盖默认值)
      - "wal_level=replica"
      - "max_wal_senders=3"
      - "wal_keep_size=2GB"
      - "hot_standby=on"
      - "max_replication_slots=3"
      - "hot_standby_feedback=on"
    volumes:
      - postgres_primary_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"              # 主库对外暴露 (供应用连接)
      - "5433:5432"              # 复制端口映射 (内部通信用)
    networks:
      - ha-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-globalreach_user} -d ${DB_NAME:-globalreach_prod}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
```

**Replica 节点配置**:

```yaml
  postgres-replica:
    image: postgres:15-alpine
    container_name: ha-postgres-replica
    restart: unless-stopped
    environment:
      PGUSER: replicator
      PGPASSWORD: ${REPLICATOR_PASSWORD:-replicator_secret}
      # 使用 pg_basebackup 从 Primary 初始化 (首次启动)
      # 后续通过流复制持续同步
    command:
      - "bash"
      - "-c"
      - |
        # 检查是否已有数据 (避免重复初始化)
        if [ ! -f "$PGDATA/PG_VERSION" ]; then
          echo "[Init] 正在从 Primary 执行基础备份..."
          pg_basebackup \
            -h postgres-primary \
            -p 5432 \
            -U replicator \
            -D $PGDATA \
            -Fp \
            -Xs \
            -P \
            -R
          
          # 设置 standby.signal (标识为 Replica)
          touch $PGDATA/standby.signal
          
          # 配置 primary_conninfo (告诉 Replica 去哪里接收 WAL)
          cat >> $PGDATA/postgresql.auto.conf <<EOF
          primary_conninfo='host=postgres-primary port=5432 user=replicator'
          EOF
        fi
        
        # 以 standby 模式启动
        exec postgres
    volumes:
      - postgres_replica_data:/var/lib/postgresql/data
    ports:
      - "5434:5432"              # Replica 只读端口 (可用于报表/备份)
    networks:
      - ha-network
    depends_on:
      postgres-primary:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-globalreach_user} -d ${DB_NAME:-globalreach_prod}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 60s  # Replica 初始化较慢 (需等待 basebackup 完成)
```

**同步 vs 异步复制模式**:

```yaml
# synchronous_commit 参数选项说明
synchronous_commit_modes:
  off: 
    description: "Primary 不等待任何 ACK 即提交 (最快, RPO 最大)"
    latency: "< 1ms"
    rpo: "≤ 5min (WAL 传输延迟 + Replica 落后)"
    use_case: "对数据一致性要求不高的场景 (缓存、日志)"
    
  local:
    description: "Primary 写入本地 WAL 后即提交 (折中)"
    latency: "1-2ms"
    rpo: "≤ 1min"
    use_case: "GlobalReach 推荐设置 (平衡性能与可靠性)"
    
  remote_write:
    description: "Primary 等待 Replica 接收 WAL (但不一定刷盘)"
    latency: "2-5ms"
    rpo: "≤ 1s"
    use_case: "金融交易、库存扣减 (强一致性需求)"
    
  remote_apply:
    description: "Primary 等待 Replica 应用 WAL (最强一致性)"
    latency: "5-20ms"
    rpo: "= 0 (理论上)"
    use_case: "银行转账、医疗记录 (零丢失容忍)"

# GlobalReach 采用 local 模式 (默认值)
# 如需更强一致性, 可改为 remote_write (性能下降约 30-50%)
```

#### 4.1.2 Patroni 集群管理配置

**为什么选择 Patroni?**

| 工具 | 自动故障转移 | 拓扑管理 | 配置同步 | 社区活跃度 | 学习曲线 |
|------|-----------|---------|---------|-----------|---------|
| **Patroni** | ✅ Raft 共识 | ✅ 动态 | ✅ REST API | ⭐⭐⭐⭐⭐ | 中等 |
| repmgr | ✅ 人工触发 | ⚠️ 静态 | ❌ 手动 | ⭐⭐⭐ | 低 |
| pg_auto_failover | ✅ 内置 | ✅ 动态 | ⚠️ 有限 | ⭐⭐ | 低 |
| EDB Failover Manager | ✅ 商业版 | ✅ | ✅ | ⭐⭐ | 高 |

**Patroni 完整配置** (`patroni.yml`):

```yaml
scope: globalreach-Postgres
namespace: /db/
name: postgresql-primary  # 每个节点唯一标识

rest_api:
  listen: 0.0.0.0:8008
  connect_address: "${HOST_IP}:8008"

# 分布式共识存储 (DCS) - 用于 Leader 选举和配置共享
etcd:
  host: etcd-1:2379,etcd-2:2379,etcd-3:2379
  # 备选: consul, zookeeper

bootstrap:
  # 初始化方法 (首次启动集群时使用)
  method: initdb  # 或 existing (加入现有集群)
  dcs:
    ttl: 30                    # Leader 锁 TTL (秒)
    loop_wait: 10              # 主循环间隔 (秒)
    retry_timeout: 10          # DCS 操作超时 (秒)
    maximum_lag_on_failover: 1048576  # 故障转移前允许 Replica 最大滞后 (字节)
    
    # PostgreSQL 初始化参数
    postgresql:
      use_pg_rewind: true      # 允许时间线分歧后 rewind (无需重建 Replica)
      use_slots: true          # 使用复制槽 (防止 WAL 被提前删除)
      parameters:
        wal_level: replica
        max_wal_senders: 3
        wal_keep_size: 2GB
        hot_standby: on
        max_replication_slots: 3
        hot_standby_feedback: on
        max_connections: 200
        shared_buffers: 256MB
        effective_cache_size: 768MB
        maintenance_work_mem: 128MB
        min_wal_size: 1GB
        max_wal_size: 4GB
        
    # 复制用户认证
    authentication:
      replication:
        username: replicator
        password: "${REPLICATOR_PASSWORD}"
      superuser:
        username: postgres
        password: "${POSTGRES_PASSWORD}"

# PostgreSQL 运行时配置
postgresql:
  data_dir: /var/lib/postgresql/data
  bin_dir: /usr/lib/postgresql/15/bin
  config_dir: /var/lib/postgresql/data
  pgpass: /tmp/pgpass
  authentication:
    replication:
      username: replicator
      password: "${REPLICATOR_PASSWORD}"
    superuser:
      username: postgres
      password: "${POSTGRES_PASSWORD}"
      
  # 创建复制用户 (initdb 时)
  create_role_commands:
    - "CREATE USER replicator WITH REPLICATION ENCRYPTED PASSWORD '${REPLICATOR_PASSWORD}' LOGIN;"
    
  # 基准备份参数 (用于初始化 Replica)
  base_backup:
    - '--max-rate'             # 限制备份速度 (避免影响主库性能)
    - '100M'
    - '--checkpoint'           # 备份前执行 checkpoint
    - 'fast'
    
  # 连接池 (PgBouncer) 集成
  connect_address: "${HOST_IP}:5432"
  proxy_address: "${HOST_IP}:6432"
  proxy_port: 6432

# 监控与告警集成
tags:
  nofailover: false            # 允许参与故障转移
  noloadbalance: false         # 允许被负载均衡器选中
  clonefrom: true              # 允许被用作克隆源
  nosync: false                # 允许同步复制

# Watchdog (看门狗) - 防止脑裂 (Split-Brain)
watchdog:
  device: /dev/watchdog        # 硬件看门狗设备 (需内核模块支持)
  mode: automatic              # 自动模式 (Leader 持有, Follower 释放)

# 日志配置
log:
  level: INFO                  # DEBUG, INFO, WARNING, ERROR
  destination: /var/log/patroni.log
  file_max_size: 10485760      # 10MB 轮转
  file_num_backups: 5
```

**Patroni CLI 常用命令**:

```bash
# 查看集群状态
patronictl -c patroni.yml list

# 手动切换 Leader (Switchover, 非故障场景)
patronictl -c patroni.yml switchover --master postgresql-primary --candidate postgresql-replica

# 强制故障转移 (Failover, 故障场景, 最后手段)
patronictl -c patroni.yml failover --candidate postgresql-replica

# 重启特定节点 (Rolling Restart)
patronictl -c patroni.yml restart postgresql-primary

# 查看复制延迟
patronictl -c patroni.yml lag

# 查看集群历史 (故障转移记录)
patronictl -c patroni.yml history
```

#### 4.1.3 pg_auto_failback 备选方案

如果团队希望采用更简单的方案（不需要 etcd/ZooKeeper 依赖），可以考虑 **pg_auto_failback**:

```yaml
# pg_auto_failback 优势
advantages:
  - "内置 Monitor 节点 (无需外部 DCS)"
  - "配置简单 (仅需 postgresql.conf + monitor 配置)"
  - "适合 2 节点场景 (Primary + Single Standby)"

# pg_auto_failback 局限性
limitations:
  - "不支持 > 2 个 Replica (仅 1 个 Standby)"
  - "故障转移速度略慢 (依赖 Monitor 心跳)"
  - "社区活跃度不如 Patroni"
  - "不支持地理分布式 (多数据中心)"

# 适用场景判断
use_pg_auto_failback_if:
  - "团队规模小 (1-2 人运维)"
  - "预算有限 (不想维护 etcd 集群)"
  - "仅需基本 HA (单 Primary + 单 Standby)"
  - "可接受稍长的 RTO (1-2 分钟)"
```

#### 4.1.4 连接池（PgBouncer）部署配置

**为什么需要 PgBouncer?**

PostgreSQL 的连接模型是 **进程-per-connection**（每个连接占用一个后台进程，约 2-5MB 内存）。在高并发场景下：
- 1000 个应用连接 → 1000 个 Postgres 进程 → 2-5GB 内存消耗
- 频繁建立/销毁连接 → CPU 开销大 (认证、权限检查)

**PgBouncer 作用**: 连接池中间件，复用少量长连接给大量短连接应用。

**PgBouncer 配置** (`docker-compose.ha.yml`):

```yaml
  pgbouncer:
    image: edoburu/pgbouncer:latest
    container_name: ha-pgbouncer
    restart: unless-stopped
    environment:
      # 数据库列表 (格式: dbname=host:port dbname,user,password)
      DATABASE_URL: "globalreach_prod=postgres-primary:5432 globalreach_prod,${DB_USER},${DB_PASSWORD}"
      # 默认用户 (用于管理接口)
      DEFAULT_USER: "pgbouncer_admin"
      DEFAULT_PASSWORD: "${PGBOUNCER_ADMIN_PASSWORD}"
      # Admin 用户 (用于在线修改配置)
      ADMIN_USERS: "pgbouncer_admin"
      # 统计用户 (用于监控指标导出)
      STATS_USERS: "pgbouncer_stats"
    volumes:
      - ./pgbouncer/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro
      - ./pgbouncer/userlist.txt:/etc/pgbouncer/userlist.txt:ro
    ports:
      - "6432:6432"            # PgBouncer 监听端口 (应用连接此端口)
      - "6433:6432"            # Admin 管理端口 (可选)
    networks:
      - ha-network
    depends_on:
      postgres-primary:
        condition: service_healthy
      postgres-replica:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "pgbouncer --show-config"]
      interval: 10s
      timeout: 5s
      retries: 3
```

**PgBouncer 配置文件** (`pgbouncer.ini`):

```ini
[databases]
# 生产数据库 (连接到 Primary, 由 Patroni 动态更新目标)
globalreach_prod =
    host = postgres-primary
    port = 5432
    dbname = globalreach_prod
    auth_user = globalreach_user
    auth_query = SELECT password FROM users WHERE username = $1

[pgbouncer]
# 基础配置
pool_mode = transaction          # 事务级连接池 (推荐, 平衡性能与事务完整性)
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt

# 连接池参数
default_pool_size = 25           # 每个用户/数据库组合的最小连接数
min_pool_size = 10               # 保留的最小空闲连接数
reserve_pool_size = 5            # 突发流量时的额外连接数
reserve_pool_timeout = 3         # 等待 reserve pool 的时间 (秒)
max_client_conn = 500            # 允许的最大客户端连接数

# 超时设置
server_idle_timeout = 300        # 服务器端空闲连接回收时间 (秒)
server_connect_timeout = 5       # 连接后端超时 (秒)
server_lifetime = 3600           # 服务器连接最大生命周期 (秒, 防止长连接泄漏)
query_timeout = 30               # 单查询超时 (秒)
client_idle_timeout = 0          # 客户端空闲超时 (0=不限制)
client_login_timeout = 10        # 登录认证超时 (秒)

# 日志与统计
log_connections = 1              # 记录连接/断开事件
log_disconnections = 1
log_pooler_errors = 1
stats_period = 60                # 统计信息聚合周期 (秒)

# 管理接口
admin_users = pgbouncer_admin
stats_users = pgbouncer_stats
```

**应用层连接字符串变更**:

```javascript
// 变更前 (直连 PostgreSQL)
const dbUrl = 'postgresql://user:pass@postgres:5432/globalreach_prod';

// 变更后 (通过 PgBouncer 连接池)
const dbUrl = 'postgresql://user:pass@pgbouncer:6432/globalreach_prod';

// 注意事项:
// 1. pool_mode=transaction 时, 不能使用 session-level features (SET variables, advisory locks, prepared statements)
// 2. 如需使用上述功能, 改为 pool_mode=session (性能略差但兼容性好)
// 3. PgBouncer 与 Patroni 集成: 当 Primary 切换时, PgBouncer 需要更新目标地址
//    可通过 Patroni REST API callback 或 watchdog 机制实现
```

#### 4.1.5 故障转移完整流程

**自动故障转移 (Patroni 触发)**:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PostgreSQL 故障转移时序图                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Primary        Patroni-Leader    etcd    Replica     Application│
│  (宕机)         (DCS协调)         (存储)   (候选)      (API)     │
│     │               │              │         │           │       │
│     │◀─── Crash ───│              │         │           │       │
│     │               │              │         │           │       │
│     │         [T+2s] Health Check FAIL               │           │
│     │               │              │         │           │       │
│     │         [T+4s] Update etcd: primary=unhealthy   │           │
│     │               │───── PUT ───▶│         │           │       │
│     │               │◀──── ACK ────│         │           │       │
│     │               │              │         │           │       │
│     │         [T+6s] Election: Replica 成为 Candidate     │           │
│     │               │              │         │           │       │
│     │         [T+8s] Raft Consensus: NEW LEADER           │           │
│     │               │───── PUT ───▶│         │           │       │
│     │               │              │◀─ LOCK ──│           │       │
│     │               │              │         │           │       │
│     │         [T+10s] Notify Replica: PROMOTE to Primary  │           │
│     │               │─────────────────────────▶│           │       │
│     │               │              │    [Execute]          │       │
│     │               │              │    pg_promote()       │       │
│     │               │              │         │           │       │
│     │         [T+12s] Update PgBouncer target             │           │
│     │               │───── REST ───│───── UPDATE ──▶│           │
│     │               │              │         │           │       │
│     │         [T+15s] Application re-connect (new Primary)│           │
│     │               │              │         │           │       │
│     │         [T+30s] Alert: Failover completed           │           │
│     │               │─────────────────────────────────────▶│       │
│                                                                  │
│  总耗时: ~15s (远优于目标的 5min RTO)                              │
└─────────────────────────────────────────────────────────────────┘
```

**手动故障转移步骤** (计划内维护场景):

```bash
# Step 1: 检查当前集群状态
patronictl -c /etc/patroni/patroni.yml list
# 输出示例:
# + Cluster: globalreach-Postgres (692xxxxx) ---------+
# | Member          | Host           | Role    | State  | TL | Lag in MB |
# +-----------------+----------------+---------+--------+----+-----------+
# | postgres-primary | 192.168.1.10  | Leader  | running|  78 |           |
# | postgres-replica| 192.168.1.11  | Replica| running|  78 |         0 |
# +-----------------+----------------+---------+--------+----+-----------+

# Step 2: 执行 Switchover (优雅切换, 无数据丢失)
patronictl -c /etc/patroni/patroni.yml switchover \
  --master postgres-primary \
  --candidate postgres-replica \
  --scheduled "2026-06-10T02:00:00+08:00"  # 可指定计划时间 (凌晨低峰期)

# Step 3: 监控切换过程 (通常 10-30 秒完成)
patronictl -c /etc/patroni/patroni.yml list
# 观察 Role 字段变化: Leader ↔ Replica

# Step 4: 验证应用连接
curl -f http://localhost:3000/api/v1/health
# 应返回 {"status":"ok","database":"connected"}

# Step 5: 检查复制状态 (新的 Replica 应开始接收 WAL)
psql -h postgres-replica -U globalreach_user -d globalreach_prod -c "
SELECT * FROM pg_stat_replication;
"

# Step 6: 通知相关方 (运维群/邮件)
echo "[Notice] PostgreSQL Switchover Completed at $(date)" | mail -s "DB Maintenance" admin@globalreach.com
```

### 4.2 Redis 高可用实现

#### 4.2.1 Sentinel 配置详解

**Redis Sentinel 核心概念**:

| 术语 | 说明 |类比|
|------|------|------|
| **SDOWN (Subjectively Down)** | 单个 Sentinel 认为 Master 不可达 | "我觉得他挂了" |
| **ODOWN (Objectively Down)** | 足够数量 (quorum) 的 Sentinel 达成共识 | "大家都觉得他挂了" |
| **sdown-after-milliseconds** | 判定 SDOWN 的超时时间 | 心跳阈值 |
| **failover-timeout** | 整个故障转移的超时时间 | 安全边界 |
| **parallel-syncs** | 故障转移后同时同步新 Master 的 Replica 数量 | 并发度 |
| **quorum** | 判定 ODOWN 所需的最少 Sentinel 数量 | 多数派 |

**Sentinel 完整配置** (`sentinel.conf`):

```conf
# ==================== 基础配置 ====================
port 26379
daemonize no
pidfile /var/run/redis/sentinel.pid
logfile /var/log/redis/sentinel.log
dir /tmp

# ==================== 监控配置 ====================
# 格式: sentinel monitor <master-name> <ip> <port> <quorum>
# quorum=2 表示 3 个 Sentinel 中至少 2 个判定 Master 宕机才触发故障转移
sentinel monitor mymaster redis-master 6379 2

# ==================== 故障检测参数 ====================
# Master 无响应多久后判定为 SDOWN (毫秒)
sentinel down-after-milliseconds mymaster 30000

# 故障转移超时时间 (毫秒)
# 包括: 选出新 Master → Replica 同步 → 旧 Master 重新配置
sentinel failover-timeout mymaster 180000

# 并行同步数量 (每次故障转移后, 同时有几个 Replica 开始同步新 Master)
# 设为 1 可降低对新 Master 的压力, 但恢复时间更长
sentinel parallel-syncs mymaster 1

# ==================== 认证配置 ====================
# Master/Replica 的密码 (如果启用了 requirepass)
sentinel auth-pass mymaster ${REDIS_PASSWORD}

# Sentinel 之间通信的密码 (可选, 增强安全性)
sentinel sentinel-auth-pass mymaster ${SENTINEL_PASSWORD}

# ==================== 高级配置 ====================
# 故障转移后通知脚本 (可选, 用于触发自定义逻辑)
# sentinel notification-script mymaster /var/redis/notify.sh

# 故障转移后客户端重新配置脚本 (可选, 用于更新配置中心)
# sentinel client-reconfig-script mymaster /var/redis/reconfig.sh

# 防止 Sentinel 自动清除旧配置 (调试时有用, 生产环境建议注释掉)
# sentinel resolve-hostnames no
# sentinel announce-ip ${SENTINEL_IP}
# sentinel announce-port 26379
```

**Docker Compose 中 Sentinel 部署** (`docker-compose.ha.yml`):

```yaml
  # ==================== Redis Master ====================
  redis-master:
    image: redis:7.4.9-alpine
    container_name: ha-redis-master
    restart: unless-stopped
    command:
      - "redis-server"
      - "--appendonly"           # 开启 AOF 持久化
      - "--appendfsync"          # AOF 同步策略
      - "everysec"               # 每秒同步 (平衡性能与安全)
      - "--maxmemory"            # 内存限制
      - "256mb"
      - "--maxmemory-policy"     # 内存淘汰策略
      - "allkeys-lru"            # LRU 淘汰任意键
      - "--requirepass"          # 密码认证
      - "${REDIS_PASSWORD:-changeme}"
      - "--masterauth"           # Replica 连接密码
      - "${REDIS_PASSWORD:-changeme}"
      - "--replica-announce-ip"  # 声明 IP (Docker 网络中实际可达的 IP)
      - "redis-master"
      - "--replica-announce-port"
      - "6379"
    volumes:
      - redis_master_data:/data
    ports:
      - "6379:6379"
    networks:
      - ha-network
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-changeme}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ==================== Redis Slave-1 ====================
  redis-slave-1:
    image: redis:7.4.9-alpine
    container_name: ha-redis-slave-1
    restart: unless-stopped
    command:
      - "redis-server"
      - "--appendonly"
      - "appendfsync"
      - "everysec"
      - "--maxmemory"
      - "256mb"
      - "--maxmemory-policy"
      - "allkeys-lru"
      - "--requirepass"
      - "${REDIS_PASSWORD:-changeme}"
      - "--masterauth"
      - "${REDIS_PASSWORD:-changeme}"
      - "--replicaof"             # 声明为 Replica
      - "redis-master"
      - "6379"
      - "--replica-announce-ip"
      - "redis-slave-1"
      - "--replica-announce-port"
      - "6379"
    volumes:
      - redis_slave_1_data:/data
    networks:
      - ha-network
    depends_on:
      redis-master:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-changeme}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ==================== Redis Slave-2 ====================
  redis-slave-2:
    image: redis:7.4.9-alpine
    container_name: ha-redis-slave-2
    restart: unless-stopped
    command:
      - "redis-server"
      - "--appendonly"
      - "appendfsync"
      - "everysec"
      - "--maxmemory"
      - "256mb"
      - "--maxmemory-policy"
      - "allkeys-lru"
      - "--requirepass"
      - "${REDIS_PASSWORD:-changeme}"
      - "--masterauth"
      - "${REDIS_PASSWORD:-changeme}"
      - "--replicaof"
      - "redis-master"
      - "6379"
      - "--replica-announce-ip"
      - "redis-slave-2"
      - "--replica-announce-port"
      - "6379"
    volumes:
      - redis_slave_2_data:/data
    networks:
      - ha-network
    depends_on:
      redis-master:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-changeme}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ==================== Sentinel-1 ====================
  redis-sentinel-1:
    image: redis:7.4.9-alpine
    container_name: ha-redis-sentinel-1
    restart: unless-stopped
    command:
      - "redis-sentinel"
      - "/usr/local/etc/redis/sentinel.conf"
    volumes:
      - ./redis/sentinel.conf:/usr/local/etc/redis/sentinel.conf:ro
      - redis_sentinel_1_data:/data
    ports:
      - "26379:26379"
    networks:
      - ha-network
    depends_on:
      redis-master:
        condition: service_healthy

  # ==================== Sentinel-2 ====================
  redis-sentinel-2:
    image: redis:7.4.9-alpine
    container_name: ha-redis-sentinel-2
    restart: unless-stopped
    command:
      - "redis-sentinel"
      - "/usr/local/etc/redis/sentinel.conf"
    volumes:
      - ./redis/sentinel.conf:/usr/local/etc/redis/sentinel.conf:ro
      - redis_sentinel_2_data:/data
    ports:
      - "26380:26379"
    networks:
      - ha-network
    depends_on:
      redis-master:
        condition: service_healthy

  # ==================== Sentinel-3 ====================
  redis-sentinel-3:
    image: redis:7.4.9-alpine
    container_name: ha-redis-sentinel-3
    restart: unless-stopped
    command:
      - "redis-sentinel"
      - "/usr/local/etc/redis/sentinel.conf"
    volumes:
      - ./redis/sentinel.conf:/usr/local/etc/redis/sentinel.conf:ro
      - redis_sentinel_3_data:/data
    ports:
      - "26381:26379"
    networks:
      - ha-network
    depends_on:
      redis-master:
        condition: service_healthy
```

#### 4.2.2 Redis Cluster vs Sentinel 选择理由

| 维度 | Redis Sentinel | Redis Cluster |
|------|---------------|---------------|
| **架构模式** | 主从复制 + 哨兵监控 | 分片 (Sharding) + 哨兵 |
| **数据分布** | 全量复制 (所有数据在 Master 和 Slave) | 数据分片到 16384 个 Slot |
| **最大内存** | 受限于单机内存 (通常 < 100GB) | 理论无限 (线性扩展) |
| **客户端复杂度** | 低 (Sentinel 自动发现 Master) | 高 (需要 MOVED/ASK 重定向处理) |
| **运维复杂度** | 低 (类似单实例) | 高 (Resharding, Rebalancing) |
| **写入性能** | 单 Master 写入 | 多 Master 并行写入 |
| **故障转移** | 自动 (Sentinel 选举) | 自动 (内置 Gossip) |
| **适用场景** | < 100GB 数据, 读写比 > 10:1 | > 100GB 数据, 高并发写入 |

**GlobalReach 选择 Sentinel 的理由**:

1. **当前数据量预估**: Redis 主要存储 Session (~10KB/用户)、Rate Limit 计数器、邮件队列元数据，总量 < 1GB
2. **读写比例**: 读多写少 (Session 读取频率远高于创建)
3. **团队熟悉度**: Sentinel 配置简单，故障排查直观
4. **迁移成本低**: 从单实例迁移到 Sentinel 仅需修改客户端连接方式 (无需数据迁移)
5. **未来可升级**: 如果数据量增长到 > 10GB，可无缝迁移至 Cluster (数据结构兼容)

**何时应考虑迁移到 Cluster?**

```yaml
cluster_migration_triggers:
  triggers:
    - condition: "Redis 内存使用率持续 > 80%"
      threshold: "单实例 > 10GB"
      action: "评估 Cluster 迁移可行性"
      
    - condition: "单实例 QPS > 50,000"
      threshold: "写入成为瓶颈"
      action: "考虑读写分离或 Cluster 分片"
      
    - condition: "需要多 Active-Active 数据中心"
      threshold: "地理分布式部署需求"
      action: "Cluster with Cross-Slot Replication (Redis Enterprise)"
```

#### 4.2.3 客户端连接配置变更

**Node.js (ioredis) 完整示例**:

```javascript
// lib/redis-ha-client.js
const Redis = require('ioredis');
const logger = require('./logger');

/**
 * Redis HA 客户端工厂函数
 * 支持 Sentinel 自动发现 + 连接池 + 断线重连
 */
function createRedisClient(options = {}) {
  const {
    sentinels = [
      { host: process.env.REDIS_SENTINEL_1 || 'redis-sentinel-1', port: 26379 },
      { host: process.env.REDIS_SENTINEL_2 || 'redis-sentinel-2', port: 26379 },
      { host: process.env.REDIS_SENTINEL_3 || 'redis-sentinel-3', port: 26379 },
    ],
    name = process.env.REDIS_MASTER_NAME || 'mymaster',
    password = process.env.REDIS_PASSWORD,
    ...redisOptions
  } = options;

  const client = new Redis({
    // Sentinel 配置
    sentinels,
    name,
    password,
    
    // 连接池配置
    enableReadyCheck: true,        // 连接后发送 PING 验证
    enableOfflineQueue: true,      // 断线时缓存命令 (重连后自动执行)
    lazyConnect: false,            // 立即连接 (而非首次调用时)
    
    // 重连策略 (指数退避)
    retryStrategy: (times) => {
      const delay = Math.min(times * 100, 3000);  // 100ms → 200ms → ... → 3s
      logger.warn(`[Redis] 重连第 ${times} 次, 延迟 ${delay}ms`);
      return delay;
    },
    
    // Sentinel 重连策略
    sentinelRetryStrategy: (times) => Math.min(times * 100, 3000),
    
    // 连接超时
    connectTimeout: 10000,         // 10 秒连接超时
    commandTimeout: 5000,          // 5 秒命令超时
    
    // 断线重连后刷新
    autoResendUnfulfilledCommands: true,
    maxRetriesPerRequest: 3,
    
    ...redisOptions,
  });

  // ===== 事件监听 =====
  
  // 连接成功
  client.on('connect', () => {
    logger.info('[Redis] 连接建立');
  });
  
  // 就绪 (可执行命令)
  client.on('ready', () => {
    logger.info('[Redis] 就绪 (已通过认证)');
  });
  
  // 错误处理 (非致命错误, 如网络抖动)
  client.on('error', (err) => {
    logger.error(`[Redis] 错误: ${err.message}`);
  });
  
  // 关闭 (正常断开)
  client.on('close', () => {
    logger.warn('[Redis] 连接关闭');
  });
  
  // 重连中
  client.on('reconnecting', () => {
    logger.info('[Redis] 正在重连...');
  });
  
  // === Sentinel 特有事件 ===
  
  // Master 切换事件 (+switch-master)
  client.on('+switch-master', () => {
    logger.warn('[Redis] ⚠️  Master 已切换 (Sentinel 自动故障转移)');
    // 可在此处触发:
    // 1. 缓存预热 (重新加载热点数据)
    // 2. 通知监控系统 (记录故障转移事件)
    // 3. 清理可能的脏数据 (如果使用了本地缓存)
  });
  
  // Replica 重新连接 (-replica-attached)
  client.on('-replica-attached', () => {
    logger.info('[Redis] Replica 已重新附加到 Master');
  });

  return client;
}

// 导出单例 (应用级别共享连接)
let redisClient = null;

function getRedisClient() {
  if (!redisClient) {
    redisClient = createRedisClient();
  }
  return redisClient;
}

module.exports = { createRedisClient, getRedisClient };
```

**Express Session 集成 (connect-redis)**:

```javascript
// lib/session-config.js
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const { getRedisClient } = require('./redis-ha-client');

/**
 * HA 模式的 Session 配置
 * 使用 Redis Store 替代内存存储, 支持多实例共享 Session
 */
function createSessionConfig() {
  const redisClient = getRedisClient();
  
  return session({
    store: new RedisStore({
      client: redisClient,
      prefix: 'globalreach:sess:',  // Key 前缀 (便于管理和统计)
      ttl: 86400,                   // Session 有效期 (24小时, 秒)
      disableTouch: false,          // 每次请求刷新 TTL
      disableTTL: false,
    }),
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,                  // 不强制保存未修改的 Session
    saveUninitialized: false,       // 不保存未初始化的 Session (合规 GDPR)
    cookie: {
      secure: process.env.NODE_ENV === 'production',  // HTTPS only in prod
      httpOnly: true,               // 防止 XSS 窃取
      maxAge: 86400000,             // 24 hours
      sameSite: 'lax',              // CSRF 保护
    },
    name: 'gr_sid',                 // 自定义 Cookie 名称 (默认 connect.sid)
  });
}

module.exports = { createSessionConfig };
```

### 4.3 API Gateway 高可用实现

#### 4.3.1 Express.js 多实例无状态化确认

**无状态化检查清单与改造指南**:

```yaml
stateless_migration_checklist:
  session_storage:
    status: "⚠️ 需改造"
    current: "express-session (内存存储, 默认 MemoryStore)"
    problem: "每个 API 实例维护独立的 Session 内存, 无法共享"
    solution: |
      1. 安装: npm install connect-redis redis
      2. 修改 session middleware (见上方 session-config.js)
      3. 测试: 在 Instance A 登录, 在 Instance B 验证 Session 是否有效
      
  file_upload_handling:
    status: "⚠️ 需改造"
    current: "multer (默认磁盘临时目录 /tmp)"
    problem: "上传的文件仅存在于接收请求的那个实例"
    solution: |
      Option A (推荐): 对象存储 (S3/MinIO/Aliyun OSS)
        - 上传 → S3 → 返回 URL/Key
        - 优点: 无限容量, CDN 加速, 多地域冗余
        
      Option B: NFS 共享存储
        - 所有实例挂载同一 NFS 目录
        - 优点: 改动最小, 对应用透明
        - 缺点: 单点故障, 性能较差
        
      Option C: 数据库存储 (Base64/BLOB)
        - 上传 → Base64 编码 → 存入 PostgreSQL
        - 优点: 事务一致性
        - 缺点: DB 膨胀, 查询性能差

  job_queue:
    status: "✅ 已支持"
    current: "Bull (基于 Redis 的队列)"
    note: "天然分布式, 多个 Worker 可安全消费同一队列"
    enhancement: "增加 Worker 数量以匹配 API 实例数 (推荐 1:1 或 1:2)"

  websocket:
    status: "⚠️ 需改造 (如果使用 Socket.io)"
    current: "socket.io (默认内存 Adapter)"
    problem: "WebSocket 连接绑定到特定实例, 无法跨实例广播"
    solution: |
      1. 安装: npm install @socket.io/redis-adapter @redis/client
      2. 配置:
         const io = require('socket.io')(httpServer, {
           adapter: require('socket.io-redis')({
             host: 'redis-sentinel-1',
             port: 26379,
             responses: true,  // Redis >= 6.x
           })
         });
      3. 注意: 需配合 Nginx Sticky Session 或改用 Polling 模式

  scheduled_tasks:
    status: "⚠️ 需注意"
    current: "node-cron / agenda (内存调度)"
    problem: "每个实例都会独立执行定时任务 (重复执行!)"
    solution: |
      Option A: 分布式锁 (Redlock)
        - 任务执行前获取 Redis 分布式锁
        - 仅获取锁的实例执行任务
        
      Option B: 单实例专属 (Label/Annotation)
        - K8s: 给其中一个 Pod 打上 scheduler=singleton 标签
        - Docker: 仅在 api-prod-01 上启动 cron worker
        
      Option C: 外部调度器
        - 迁移至 Bull Queue 的 repeatable jobs
        - 或使用外部 Cron (Linux crontab + HTTP webhook)

  logging:
    status: "✅ 已支持"
    current: "winston / pino (JSON 格式输出 stdout)"
    note: "Docker json-file driver 收集所有实例日志 → Promtail → Loki"
    enhancement: "添加 request-id/correlation-id 追踪跨实例请求链路"
```

**无状态化验证测试脚本**:

```bash
#!/bin/bash
# scripts/test-stateless.sh
# 验证 API 多实例无状态化是否正确实现

set -e

BASE_URL="http://localhost"
INSTANCE_PORTS=(3000 3001)  # 假设两个 API 实例分别监听 3000 和 3001

echo "===== 无状态化验证测试 ====="

# Test 1: Session 共享测试
echo "[Test 1] Session 跨实例共享..."
SESSION_COOKIE=$(curl -sI -c - "$BASE_URL:${INSTANCE_PORTS[0]}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test123"}' | grep -i 'connect.sid' | awk '{print $NF}')

if [ -z "$SESSION_COOKIE" ]; then
  echo "❌ Failed: 无法获取 Session Cookie"
  exit 1
fi

# 用 Instance A 的 Session 访问 Instance B
RESPONSE=$(curl -s -b "connect.sid=$SESSION_COOKIE" "$BASE_URL:${INSTANCE_PORTS[1]}/api/v1/auth/me")
if echo "$RESPONSE" | grep -q '"authenticated":true'; then
  echo "✅ Passed: Session 在实例间共享成功"
else
  echo "❌ Failed: Session 无法跨实例共享"
  echo "Response: $RESPONSE"
  exit 1
fi

# Test 2: 幂等性测试 (重复请求不应产生副作用)
echo "[Test 2] API 幂等性..."
IDEMPOTENCY_KEY="test-$(date +%s)"
curl -s -X POST "$BASE_URL:${INSTANCE_PORTS[0]}/api/v1/campaigns" \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d '{"name":"test-campaign"}' > /dev/null

COUNT_BEFORE=$(curl -s "$BASE_URL:${INSTANCE_PORTS[0]}/api/v1/campaigns" | grep -o '"test-campaign"' | wc -l)

# 重复请求 (应被拒绝或忽略)
curl -s -X POST "$BASE_URL:${INSTANCE_PORTS[1]}/api/v1/campaigns" \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d '{"name":"test-campaign"}' > /dev/null

COUNT_AFTER=$(curl -s "$BASE_URL:${INSTANCE_PORTS[0]}/api/v1/campaigns" | grep -o '"test-campaign"' | wc -l)

if [ "$COUNT_BEFORE" -eq "$COUNT_AFTER" ]; then
  echo "✅ Passed: 幂等性验证通过 ($COUNT_BEFORE 条记录)"
else
  echo "❌ Failed: 产生了重复数据 ($COUNT_BEFORE → $COUNT_AFTER)"
  exit 1
fi

# Test 3: 健康检查独立性
echo "[Test 3] 健康检查独立性..."
for PORT in "${INSTANCE_PORTS[@]}"; do
  if curl -sf "$BASE_URL:$PORT/api/v1/health" > /dev/null; then
    echo "✅ Instance :$PORT 健康"
  else
    echo "❌ Instance :$PORT 不健康"
    exit 1
  fi
done

echo ""
echo "===== 所有测试通过 ✓ ====="
```

#### 4.3.2 Nginx Upstream 高级配置

**完整的 HA 优化 Nginx 配置**:

```nginx
# nginx/conf.d/api-upstream-ha.conf

# ========== Upstream 定义 ==========
upstream api_backend {
    # 负载均衡算法选择
    least_conn;  # 最少连接 (推荐: 适合长连接/不同耗时的请求)
    # 其他选项:
    # round_robin;  # 轮询 (默认, 简单均匀)
    # ip_hash;      # IP 哈希 (会话粘滞, 但不利于负载均衡)
    # random;       # 随机 (two 参数可指定权重)

    # API 实例列表
    server api-prod-01:3000 weight=1 max_fails=3 fail_timeout=30s backup=no;
    server api-prod-02:3000 weight=1 max_fails=3 fail_timeout=30s backup=no;

    # 长连接保持 (Connection Pooling)
    # 减少 TCP 握手开销, 显著提升性能 (尤其 HTTPS)
    keepalive 32;              # 保持 32 个空闲长连接
    keepalive_requests 1000;   # 每个长连接最多处理 1000 个请求
    keepalive_timeout 60s;     # 空闲长连接超时时间
}

# ========== Server Block ==========
server {
    listen 80;
    listen [::]:80;
    server_name api.globalreach.com app.globalreach.com;

    # HTTP → HTTPS 重定向 (SSL 强制跳转)
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.globalreach.com app.globalreach.com;

    # SSL 证书配置
    ssl_certificate /etc/nginx/ssl/le/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/le/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # HSTS (HTTP Strict Transport Security)
    add_header Strict-Transport-Security "max-age=63072000" always;

    # API 路由
    location /api/ {
        proxy_pass http://api_backend;

        # 标准 Proxy Headers (传递客户端真实信息)
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;  # 请求追踪 ID

        # WebSocket 支持 (Socket.io)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 超时设置 (防止慢请求拖死连接池)
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;

        # Buffer 控制 (防止大响应撑爆 Nginx 内存)
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
        proxy_busy_buffers_size 8k;

        # 错误拦截 (上游不可用时返回友好 JSON)
        intercept_errors on;
        error_page 502 503 504 = @error_json;
    }

    # 前端 SPA (React/Vue/Angular)
    location / {
        root /var/www/frontend/dist;
        index index.html;
        try_files $uri $uri/ /index.html;  # SPA 路由回退

        # 静态资源缓存策略
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # 健康检查端点 (供 LB 探测)
    location /health {
        access_log off;
        return 200 '{"status":"ok","timestamp":"$time_iso8601"}';
        add_header Content-Type application/json;
    }

    # 自定义错误页面 (JSON 格式, 适合 API)
    location @error_json {
        default_type application/json;
        return 503 '{"error":{"code":503,"message":"Service temporarily unavailable","retry_after":30}}';
    }
}
```

#### 4.3.3 滚动部署策略详解

**零停机部署流程**:

```
┌────────────────────────────────────────────────────────────┐
│                  滚动部署 (Rolling Update)                  │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  Time    api-prod-01    api-prod-02    Nginx Upstream      │
│  ────    ──────────    ──────────    ───────────────       │
│  T+0s    v2.3.0 (100%)  v2.3.0 (100%)  [01:up, 02:up]     │
│         ████████████    ████████████                        │
│                                                             │
│  T+5s    ⬇️ Draining     v2.3.0 (100%)  [01:drain, 02:up] │
│         ░░░░░░░░░░░░    ████████████                        │
│         (不再接收新请求, 等待活跃请求完成)                     │
│                                                             │
│  T+30s   STOPPED        v2.3.0 (100%)  [01:down, 02:up]   │
│         (容器停止)       ████████████                        │
│                                                             │
│  T+35s   Pulling...     v2.3.0 (100%)  [01:down, 02:up]   │
│         (拉取新镜像)     ████████████                        │
│                                                             │
│  T+60s   Starting...    v2.3.0 (100%)  [01:starting]       │
│         (新容器启动)     ████████████                        │
│                                                             │
│  T+70s   v2.4.0 (warm)  v2.3.0 (100%)  [01:up, 02:up]     │
│         ░░░░░░░░░░░░    ████████████                        │
│         (健康检查通过, 开始接收流量)                           │
│                                                             │
│  T+75s   v2.4.0 (50%)    ⬇️ Draining   [01:up, 02:drain]  │
│         ██████████       ░░░░░░░░░░░░                        │
│         (Instance 02 开始排水)                                │
│                                                             │
│  T+105s  v2.4.0 (50%)    STOPPED     [01:up, 02:down]     │
│         ██████████                                          │
│                                                             │
│  T+140s  v2.4.0 (50%)    Starting... [01:up, 02:starting]  │
│         ██████████                                          │
│                                                             │
│  T+150s  v2.4.0 (100%)   v2.4.0 (100%) [01:up, 02:up]    │
│         ████████████    ████████████                        │
│         (✅ 部署完成, 零停机!)                                 │
│                                                             │
│  总耗时: ~150s (2.5分钟), 期间始终有 ≥1 个实例可用            │
└────────────────────────────────────────────────────────────┘
```

**自动化部署脚本** (`scripts/rolling-deploy-ha.sh`):

```bash
#!/bin/bash
# ============================================================
# GlobalReach HA Rolling Deployment Script
# 用途: 零停机滚动更新 API 实例
# 用法: ./scripts/rolling-deploy-ha.sh <IMAGE_TAG>
# ============================================================

set -euo pipefail

# ===== 配置 =====
IMAGE_TAG="${1:?Usage: $0 <IMAGE_TAG>}"
COMPOSE_FILE="docker-compose.ha NETWORK"
API_INSTANCES=("api-prod-01" "api-prod-02")
HEALTH_CHECK_INTERVAL=5
HEALTH_CHECK_MAX_RETRIES=12  # 12 * 5s = 60s 超时
DRAIN_TIMEOUT=30             # 排水等待时间 (秒)
NGINX_API_ENDPOINT="http://nginx-lb/api/upstream"  # Nginx Plus API (开源版不支持, 需改用 iptables)

# ===== 颜色输出 =====
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC}  $(date '+%Y-%m-%d %H:%M:%S') $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $(date '+%Y-%m-%d %H:%M:%S') $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') $*"; }

# ===== 前置检查 =====
log_info "===== 开始滚动部署: $IMAGE_TAG ====="

# 检查镜像是否存在
if ! docker image inspect "globalreach-project-api:$IMAGE_TAG" >/dev/null 2>&1; then
    log_error "镜像不存在: globalreach-project-api:$IMAGE_TAG"
    log_info "请先执行: docker build -t globalreach-project-api:$IMAGE_TAG ."
    exit 1
fi

# 检查当前运行实例数
RUNNING_COUNT=0
for instance in "${API_INSTANCES[@]}"; do
    if docker ps --format '{{.Names}}' | grep -q "^${instance}$"; then
        RUNNING_COUNT=$((RUNNING_COUNT + 1))
    fi
done

if [ "$RUNNING_COUNT" -lt 1 ]; then
    log_error "没有运行中的 API 实例, 无法执行滚动部署!"
    exit 1
fi

log_info "当前运行实例数: $RUNNING_COUNT/${#API_INSTANCES[@]}"

# ===== 滚动更新循环 =====
DEPLOYED_COUNT=0

for instance in "${API_INSTANCES[@]}"; do
    log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_info "正在更新实例: $instance (($((DEPLOYED_COUNT + 1))/${#API_INSTANCES[@]})"
    
    # Step 1: 排水 (Drain) - 从 LB 摘除
    log_info "[Step 1] 排水中: $instance ..."
    
    # 方法 A: Nginx Plus API (商业版, 推荐)
    # curl -sf "$NGINX_API_ENDPOINT/api_backend/server/$instance:3000/down" && log_info "已标记为 down"
    
    # 方法 B: 修改 upstream 配置并 reload (开源版 workaround)
    # sed -i "s/server $instance:3000.*;/server $instance:3000 down;/" /etc/nginx/conf.d/api-upstream-ha.conf
    # nginx -s reload
    
    # 方法 C: iptables 丢弃入站流量 (最可靠, 无需 Nginx Plus)
    CONTAINER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$instance" 2>/dev/null || echo "")
    if [ -n "$CONTAINER_IP" ]; then
        docker exec "$instance" iptables -A INPUT -p tcp --dport 3000 -j DROP 2>/dev/null || true
        log_info "已通过 iptables 阻止新连接"
    fi
    
    sleep "$DRAIN_TIMEOUT"
    log_info "排水完成, 等待活跃请求处理完毕 (${DRAIN_TIMEOUT}s)"
    
    # Step 2: 停止旧容器
    log_info "[Step 2] 停止旧容器: $instance ..."
    docker stop "$instance" 2>/dev/null || log_warn "容器未运行或已停止"
    docker rm "$instance" 2>/dev/null || true
    
    # Step 3: 启动新容器
    log_info "[Step 3] 启动新容器: $instance (镜像: $IMAGE_TAG) ..."
    docker run -d \
        --name "$instance" \
        --network ha-network \
        --restart unless-stopped \
        -e NODE_ENV=production \
        -e DATABASE_URL="postgresql://${DB_USER:-globalreach_user}:${DB_PASSWORD:-changeme}@pgbouncer:6432/${DB_NAME:-globalreach_prod}" \
        -e DB_HOST=pgbouncer \
        -e DB_PORT=6432 \
        -e REDIS_HOST=redis-sentinel-1 \
        -e REDIS_PORT=26379 \
        -e REDIS_MASTER_NAME=mymaster \
        -e JWT_SECRET="${JWT_SECRET}" \
        -e SESSION_SECRET="${SESSION_SECRET}" \
        -e RATE_LIMIT_MAX=30000 \
        -e RATE_LIMIT_WINDOW_MS=900000 \
        --memory=512m \
        --cpus=1.0 \
        --health-interval=10s \
        --health-timeout=5s \
        --health-retries=3 \
        "globalreach-project-api:${IMAGE_TAG}"
    
    # Step 4: 健康检查等待
    log_info "[Step 4] 等待健康检查通过 ..."
    HEALTHY=false
    for i in $(seq 1 "$HEALTH_CHECK_MAX_RETRIES"); do
        if docker exec "$instance" curl -sf http://localhost:3000/api/v1/health > /dev/null 2>&1; then
            HEALTHY=true
            break
        fi
        log_info "  等待中... ($i/$HEALTH_CHECK_MAX_RETRIES)"
        sleep "$HEALTH_CHECK_INTERVAL"
    done
    
    if [ "$HEALTHY" != true ]; then
        log_error "❌ 健康检查超时! 实例: $instance"
        log_error "请手动排查: docker logs $instance"
        
        # 回滚: 重新启动旧版本的容器 (如果有保存)
        # TODO: 实现自动回滚逻辑
        exit 1
    fi
    
    log_info "✅ 健康检查通过"
    
    # Step 5: 重新加入 LB
    log_info "[Step 5] 重新加入负载均衡 ..."
    
    # 清除 iptables 规则
    if [ -n "$CONTAINER_IP" ]; then
        docker exec "$instance" iptables -D INPUT -p tcp --dport 3000 -j DROP 2>/dev/null || true
    fi
    
    DEPLOYED_COUNT=$((DEPLOYED_COUNT + 1))
    log_info "✅ 实例 $instance 已上线 (进度: $DEPLOYED_COUNT/${#API_INSTANCES[@]})"
done

# ===== 部署后验证 =====
log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "===== 部署完成, 执行最终验证 ====="

# 检查所有实例是否正常运行
ALL_HEALTHY=true
for instance in "${API_INSTANCES[@]}"; do
    if docker exec "$instance" curl -sf http://localhost:3000/api/v1/health > /dev/null 2>&1; then
        log_info "✅ $instance: 健康"
    else
        log_error "❌ $instance: 不健康"
        ALL_HEALTHY=false
    fi
done

if [ "$ALL_HEALTHY" = true ]; then
    log_info "🎉 滚动部署成功完成! 所有实例均已更新至 $IMAGE_TAG"
    log_info "部署耗时: $SECONDS 秒"
    exit 0
else
    log_error "⚠️  部署完成但存在不健康实例, 请检查!"
    exit 1
fi
```

### 4.4 Nginx/LB 高可用实现

#### 4.4.1 Keepalived 完整部署指南

**系统要求**:

```yaml
keepalived_prerequisites:
  os:
    - "Ubuntu 20.04+ / Debian 11+ / CentOS 8+"
    - "内核支持 netfilter (iptables) 和 IPVS"
    
  network:
    - "两台服务器在同一 L2 广播域 (VRRP 广播依赖)"
    - "VIP (虚拟 IP) 在同一网段且未被占用"
    - "防火墙开放 VRRP 组播端口 (协议号 112)"
    
  permissions:
    - "root 权限 (或 CAP_NET_ADMIN + CAP_NET_RAW capabilities)"
    - "non_local_bind 允许绑定非本机 IP"
```

**安装步骤**:

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y keepalived

# CentOS/RHEL
sudo yum install -y keepalived

# 启动并开机自启
sudo systemctl enable --now keepalived

# 验证安装
keepalived --version
# 输出: Keepalived v2.2.x (日期)
```

**防火墙配置** (允许 VRRP 流量):

```bash
# UFW (Ubuntu)
sudo ufw allow to 224.0.0.18 proto vrrp  # VRRP 组播地址
sudo ufw allow to 224.0.0.0/24 proto vrrp  # 备选: 允许整个组播范围

# firewalld (CentOS)
sudo firewall-cmd --add-rich-rule='rule protocol value="vrrp" accept'
sudo firewall-cmd --runtime-to-permanent

# iptables (通用)
sudo iptables -A INPUT -d 224.0.0.18 -p vrrp -j ACCEPT
sudo ip6tables -A INPUT -d ff02::12 -p vrrp -j ACCEPT
```

**双机热备完整配置**:

**Host-A (MASTER 节点)** `/etc/keepalived/keepalived.conf`:

```conf
# ============================================================
# GlobalReach HA - Keepalived Configuration (MASTER)
# 节点: Host-A (192.168.1.10)
# 角色: MASTER (初始优先级 100)
# VIP: 192.168.1.100
# ============================================================

! Configuration File for keepalived

global_defs {
   router_id GLOBALREACH_LB_A           # 唯一路由器标识 (集群内唯一)
   
   # 告警通知邮箱 (可选)
   notification_email {
     ops@globalreach.com
   }
   notification_email_from keepalived@host-a.globalreach.local
   smtp_server 127.0.0.1
   smtp_connect_timeout 30
}

# VRRP 实例定义 (对应一个 VIP)
vrrp_instance VI_GLOBALREACH_API {
    # 初始状态 (启动后会通过优先级竞争确定实际角色)
    state MASTER
    
    # 绑定网卡 (必须替换为实际网卡名, 如 eth0, ens33, enp0s3)
    interface eth0
    
    # 虚拟路由器 ID (同一集群必须一致, 0-255)
    virtual_router_id 51
    
    # 优先级 (数值越高越优先成为 MASTER)
    priority 100
    
    # VRRP 广播间隔 (秒)
    advert_int 1
    
    # 认证 (防止非法 VRRP 报文干扰)
    authentication {
        auth_type PASS              # 简单密码认证 (AH 认证已废弃)
        auth_pass GR_VIP_2026       # 密码 (最长 8 个字符!)
    }

    # 虚拟 IP 地址 (可配置多个)
    virtual_ipaddress {
        192.168.1.100/24           # 主 VIP (API 流量)
        # 192.168.1.101/24        # 备用 VIP (如有多个域名)
    }

    # 健康检查脚本 (Nginx 挂了则降低优先级, 触发切换)
    track_script {
        chk_nginx_process          # Nginx 进程检查
        chk_nginx_health           # Nginx 健康端点检查
    }
    
    # 通知脚本 (状态变化时触发)
    notify_master "/etc/keepalived/scripts/notify.sh MASTER"
    notify_backup "/etc/keepalived/scripts/notify.sh BACKUP"
    notify_fault "/etc/keepalived/scripts/notify.sh FAULT"
    
    # 抢占模式 (nopreempt: 非 MASTER 不抢占, 即使优先级更高)
    nopreempt false                # 允许抢占 (原 MASTER 恢复后夺回 VIP)
    
    # 延迟启动 (等待网络就绪, 单位秒)
    garp_master_delay 1            # gratuitous ARP 延迟 (通知网络 VIP 变更)
    garp_master_refresh 5          # 定期刷新 ARP (防止条目老化)
}

# Nginx 进程存活检查
vrrp_script chk_nginx_process {
    script "killall -0 nginx"      # 检查 nginx 进程是否存在 (signal 0)
    interval 2                     # 每 2 秒检查一次
    weight -20                     # 失败时优先级 -20 (100→80 < Backup的90)
    fall 3                         # 连续 3 次失败判定为 down
    rise 2                         # 连续 2 次成功判定为 up
}

# Nginx 健康端点检查 (更深层次验证)
vrrp_script chk_nginx_health {
    script "curl -sf http://127.0.0.1/health || exit 1"
    interval 5
    weight -10                     # 失败时优先级 -10
    fall 2
    rise 2
}
```

**Host-B (BACKUP 节点)** `/etc/keepalived/keepalived.conf`:

```conf
! Configuration File for keepalived

global_defs {
   router_id GLOBALREACH_LB_B
   notification_email {
     ops@globalreach.com
   }
   notification_email_from keepalived@host-b.globalreach.local
   smtp_server 127.0.0.1
   smtp_connect_timeout 30
}

vrrp_instance VI_GLOBALREACH_API {
    state BACKUP                   # 初始角色: BACKUP
    interface eth0
    virtual_router_id 51           # 必须 HOST-A 一致!
    priority 90                    # 比 MASTER 低 10
    advert_int 1
    
    authentication {
        auth_type PASS
        auth_pass GR_VIP_2026      # 必须与 HOST-A 一致!
    }

    virtual_ipaddress {
        192.168.1.100/24           # 同一 VIP
    }

    track_script {
        chk_nginx_process
        chk_nginx_health
    }
    
    notify_master "/etc/keepalived/scripts/notify.sh MASTER"
    notify_backup "/etc/keepalived/scripts/notify.sh BACKUP"
    notify_fault "/etc/keepalived/scripts/notify.sh FAULT"
    
    nopreempt false
}

# 脚本定义与 HOST-A 完全相同 (省略, 实际需复制)
vrrp_script chk_nginx_process {
    script "killall -0 nginx"
    interval 2
    weight -20
    fall 3
    rise 2
}

vrrp_script chk_nginx_health {
    script "curl -sf http://127.0.0.1/health || exit 1"
    interval 5
    weight -10
    fall 2
    rise 2
}
```

**通知脚本** `/etc/keepalived/scripts/notify.sh`:

```bash
#!/bin/bash
# /etc/keepalived/scripts/notify.sh
# Keepalived 状态变化通知脚本

TYPE="$1"
NAME="$2"
STATE="$3"

LOGFILE="/var/log/keepalived-notify.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [$TYPE] $STATE" >> "$LOGFILE"
    
    # 发送告警 (可根据实际需求对接钉钉/企微/Slack Webhook)
    case "$STATE" in
        "MASTER")
            # VIP 切换到此节点
            curl -sf -X POST "${WEBHOOK_URL:-http://localhost:9093}" \
              -H 'Content-Type: application/json' \
              -d "{\"text\":\"⚠️ Keepalived 状态变更: $NAME 成为 MASTER (VIP 已接管)\"}" \
              || true
            ;;
        "FAULT")
            # 节点故障 (VIP 丢失)
            curl -sf -X POST "${WEBHOOK_URL:-http://localhost:9093}" \
              -H 'Content-Type: application/json' \
              -d "{\"text\":\"🚨 Keepalived 故障: $NAME 进入 FAULT 状态\"}" \
              || true
            ;;
    esac
}

log
```

**验证与测试**:

```bash
# 1. 启动两台节点的 Keepalived
sudo systemctl start keepalived

# 2. 检查 VIP 绑定情况 (应在 MASTER 节点上)
ip addr show eth0 | grep 192.168.1.100
# 输出: inet 192.168.1.100/24 scope global secondary eth0

# 3. 查看 VRRP 状态
sudo keepalivedctl show_state
# 或查看日志
sudo journalctl -u keepalived -f

# 4. 模拟故障 (停止 MASTER 的 Nginx)
sudo systemctl stop nginx
# 等待 ~6 秒 (3次健康检查失败 × 2秒间隔)
# VIP 应漂移到 BACKUP 节点

# 5. 恢复 MASTER (重启 Nginx)
sudo systemctl start nginx
# 等待 ~3 秒 (如果 nopreempt=false, VIP 应漂回 MASTER)

# 6. 模