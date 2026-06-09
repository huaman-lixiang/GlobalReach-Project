# GlobalReach V2.0 容量规划报告

**报告编号**: CAP-RPT-{{REPORT_ID}}
**生成时间**: {{GENERATED_AT}}
**预测范围**: {{FORECAST_DAYS}} 天
**分析工具**: `scripts/capacity-analyzer.sh` (O04 Capacity Planning Automation)
**数据来源**: Prometheus + Docker Stats + PostgreSQL/Redis INFO

---

## Executive Summary

### 一页纸概要

| 项目 | 内容 |
|------|------|
| **报告周期** | {{PERIOD_START}} ~ {{PERIOD_END}} |
| **整体状态** | {{OVERALL_STATUS_EMOJI}} {{OVERALL_STATUS}} |
| **最紧张组件** | {{BOTTLENECK_COMPONENT}} ({{BOTTLENECK_UTILIZATION}}%) |
| **最宽松组件** | {{MOST_RELAXED_COMPONENT}} ({{RELAXED_UTILIZATION}}%) |
| **扩容建议** | {{RECOMMENDATION_SUMMARY}} |
| **下次评估** | {{NEXT_REVIEW_DATE}} |

### 关键指标速览

```
┌──────────────────────────────────────────────────────────────┐
│                    容量仪表盘总览                              │
├──────────┬──────────┬──────────┬──────────┬──────────┬────────┤
│  API     │  PGSQL   │  Redis   │  Nginx   │  Monitor │  Disk  │
│ {{API_STATUS}}  │ {{PG_STATUS}} │{{REDIS_STATUS}}│{{NGX_STATUS}}│{{MON_STATUS}}│{{DSK_STATUS}}│
│ {{API_CPU}}%   │ {{PG_CPU}}%  │{{REDIS_MEM}}% │{{NGX_CPU}}%  │{{MON_MEM}}% │{{DISK_PCT}}% │
└──────────┴──────────┴──────────┴──────────┴──────────┴────────┘

状态图例: 🟢GREEN(<50%) 🟡YELLOW(50-75%) 🟠ORANGE(75-90%) 🔴RED(>90%)
```

### 决策摘要

- **是否需要扩容**: {{SCALING_REQUIRED}}
- **紧急程度**: {{URGENCY_LEVEL}}
- **建议行动**: {{RECOMMENDED_ACTION}}
- **预估成本影响**: {{COST_IMPACT}}

---

## 各组件容量详情表

### 1. API Node (globalreach-api-prod)

#### 资源维度总览

| 指标 | 当前值 | 阈值 | 利用率 | 状态 | 趋势 |
|------|--------|------|--------|------|------|
| CPU (5min avg) | {{API_CPU_CURRENT}}% | 80% | {{API_CPU_UTIL}}% | {{API_CPU_STATUS}} | {{API_CPU_TREND}} |
| Memory (RSS) | {{API_MEM_CURRENT}}MB | 512MB | {{API_MEM_UTIL}}% | {{API_MEM_STATUS}} | {{API_MEM_TREND}} |
| Active Connections | {{API_CONN_CURRENT}} | 100 | {{API_CONN_UTIL}}% | {{API_CONN_STATUS}} | {{API_CONN_TREND}} |
| Heap Usage | {{API_HEAP_CURRENT}}% | 85% | {{API_HEAP_UTIL}}% | {{API_HEAP_STATUS}} | {{API_HEAP_TREND}} |
| Event Loop Lag | {{API_LAG_CURRENT}}ms | 50ms | {{API_LAG_UTIL}}% | {{API_LAG_STATUS}} | — |

#### 资源限制配置（来自 docker-compose.prod.yml）

```yaml
deploy:
  resources:
    limits:
      memory: 512M
      cpus: '1.0'
    reservations:
      memory: 256M
```

Node.js 堆上限: `--max-old-space-size=384`

#### 趋势分析

```
CPU利用率趋势:
100% ┤                                              ╭─────  阈值(80%)
 75% ┤                                         ╭────╯
 50% ┤                                    ╭────╯
 25% ┤  ●━━━━━━●━━━━━━●━━━━━━●━━━━━━●━━━━●━
  0% └────────────────────────────────────────→ 时间
     T-30d      T-21d       T-14d       T-7d  Now

内存利用率趋势:
100% ┤                                                    ╭─ 阈值
 75% ┤                                               ╭────╯
 50% ┤                                          ╭────╯
 25% ┤  ●━━━━━●━━━━━━●━━━━━━●━━━━━━●━━━━━━●━━━━●
  0% └──────────────────────────────────────────────→ 时间
```

#### 预测

| 维度 | 当前利用率 | 日增长率 | {{FORECAST_DAYS}}天后 | 到达阈值天数 |
|------|-----------|---------|---------------------|-------------|
| Memory | {{API_MEM_UTIL}}% | +{{API_MEM_GROWTH}}%/day | {{API_MEM_FORECAST}}% | {{API_MEM_DAYS_TO_THRESHOLD}}天 |
| Connections | {{API_CONN_UTIL}}% | +{{API_CONN_GROWTH}}%/day | {{API_CONN_FORECAST}}% | {{API_CONN_DAYS_TO_THRESHOLD}}天 |

---

### 2. PostgreSQL (globalreach-postgres)

#### 资源维度总览

| 指标 | 当前值 | 阈值 | 利用率 | 状态 | 趋势 |
|------|--------|------|--------|------|------|
| CPU | {{PG_CPU_CURRENT}}% | 80% | {{PG_CPU_UTIL}}% | {{PG_CPU_STATUS}} | {{PG_CPU_TREND}} |
| Memory | {{PG_MEM_CURRENT}}MB | 1024MB | {{PG_MEM_UTIL}}% | {{PG_MEM_STATUS}} | {{PG_MEM_TREND}} |
| Active Connections | {{PG_CONN_CURRENT}} | 100 | {{PG_CONN_UTIL}}% | {{PG_CONN_STATUS}} | {{PG_CONN_TREND}} |
| Disk Usage | {{PG_DISK_CURRENT}}GB | 50GB | {{PG_DISK_UTIL}}% | {{PG_DISK_STATUS}} | {{PG_DISK_TREND}} |
| Database Size | {{PG_DB_SIZE}} | — | — | — | {{PG_SIZE_TREND}} |

#### 版本与配置

| 配置项 | 值 |
|--------|-----|
| PostgreSQL Version | 15 (alpine) |
| max_connections | 默认 (通常 100) |
| shared_buffers | 默认 (128MB) |
| effective_cache_size | 默认 (4GB) |
| work_mem | 默认 (4MB) |

#### 趋势分析

```
磁盘使用增长曲线:
50GB ┤                                              ═════  阈值
40GB ┤                                         ╭═════
30GB ┤                                    ╭════╯
20GB ┤  ●━━━━━━●━━━━━━●━━━━━━●━━━━━━●━━━━●━
10GB └────────────────────────────────────────→ 时间
     T-30d      T-21d       T-14d       T-7d  Now

连接数分布:
100 ┤
 80 ┤                         ● ← 峰值
 60 ┤              ●━━━━━━●━━●
 40 ┤         ●━━━━●
 20 ┤    ●━━●
  0 └────────────────────────────────────────→ 时间
```

#### 预测

| 维度 | 当前利用率 | 日增长率 | {{FORECAST_DAYS}}天后 | 到达阈值天数 |
|------|-----------|---------|---------------------|-------------|
| Disk | {{PG_DISK_UTIL}}% | +{{PG_DISK_GROWTH}}%/day | {{PG_DISK_FORECAST}}% | {{PG_DISK_DAYS_TO_THRESHOLD}}天 |
| Connections | {{PG_CONN_UTIL}}% | +{{PG_CONN_GROWTH}}%/day | {{PG_CONN_FORECAST}}% | {{PG_CONN_DAYS_TO_THRESHOLD}}天 |

---

### 3. Redis (globalreach-redis)

#### 资源维度总览

| 指标 | 当前值 | 阈值 | 利用率 | 状态 | 趋势 |
|------|--------|------|--------|------|------|
| CPU | {{REDIS_CPU_CURRENT}}% | 80% | {{REDIS_CPU_UTIL}}% | {{REDIS_CPU_STATUS}} | — |
| Memory (RSS) | {{REDIS_MEM_CURRENT}}MB | 64MB | {{REDIS_MEM_UTIL}}% | {{REDIS_MEM_STATUS}} | {{REDIS_MEM_TREND}} |
| Key Count | {{REDIS_KEYS_CURRENT}} | 10000 | {{REDIS_KEYS_UTIL}}% | {{REDIS_KEYS_STATUS}} | {{REDIS_KEYS_TREND}} |
| Connected Clients | {{REDIS_CLIENTS_CURRENT}} | 100 | {{REDIS_CLIENTS_UTIL}}% | {{REDIS_CLIENTS_STATUS}} | {{REDIS_CLIENTS_TREND}} |
| Fragmentation Ratio | {{REDIS_FRAG_CURRENT}} | 3.0 | {{REDIS_FRAG_UTIL}}% | {{REDIS_FRAG_STATUS}} | — |

#### 版本与配置

| 配置项 | 值 |
|--------|-----|
| Redis Version | 7.4.9 (alpine) |
| maxmemory | 不限 (受容器cgroup约束) |
| maxmemory-policy | noeviction (默认) |

#### 趋势分析

```
Key数量增长趋势:
10K ┤                                              ═════  阈值
 8K ┤                                         ╭═════
 6K ┤                                    ╭════╯
 4K ┤  ●━━━━━━●━━━━━━●━━━━━━●━━━━━━●━━━━●━
 2K └────────────────────────────────────────→ 时间
     T-30d      T-21d       T-14d       T-7d  Now

内存使用 vs Key数量相关性:
64MB ┤                        ●
48MB ┤                    ●
32MB ┤                ●
16MB ┤            ●
  0B └────────────────────────────────────→ Keys
     0        2500      5000      7500    10000
```

#### 预测

| 维度 | 当前利用率 | 日增长率 | {{FORECAST_DAYS}}天后 | 到达阈值天数 |
|------|-----------|---------|---------------------|-------------|
| Memory | {{REDIS_MEM_UTIL}}% | +{{REDIS_MEM_GROWTH}}%/day | {{REDIS_MEM_FORECAST}}% | {{REDIS_MEM_DAYS_TO_THRESHOLD}}天 |
| Keys | {{REDIS_KEYS_UTIL}}% | +{{REDIS_KEYS_GROWTH}}%/day | {{REDIS_KEYS_FORECAST}}% | {{REDIS_KEYS_DAYS_TO_THRESHOLD}}天 |

---

### 4. Nginx (globalreach-nginx-prod)

#### 资源维度总览

| 指标 | 当前值 | 阈值 | 利用率 | 状态 | 趋势 |
|------|--------|------|--------|------|------|
| CPU | {{NGX_CPU_CURRENT}}% | 80% | {{NGX_CPU_UTIL}}% | {{NGX_CPU_STATUS}} | — |
| Memory (RSS) | {{NGX_MEM_CURRENT}}MB | 128MB | {{NGX_MEM_UTIL}}% | {{NGX_MEM_STATUS}} | — |
| Active Connections | {{NGX_CONN_CURRENT}} | 10000 | {{NGX_CONN_UTIL}}% | {{NGX_CONN_STATUS}} | {{NGX_CONN_TREND}} |
| QPS (estimate) | {{NGX_QPS_CURRENT}} | 1000 | {{NGX_QPS_UTIL}}% | {{NGX_QPS_STATUS}} | {{NGX_QPS_TREND}} |

#### 版本与配置

| 配置项 | 值 |
|--------|-----|
| Nginx Version | 1.31.1 (alpine) |
| worker_processes | auto |
| worker_connections | 1024 |

---

### 5. Monitoring Stack

#### 组件资源汇总

| 容器 | CPU | 内存 | 状态 |
|------|-----|------|------|
| Prometheus | {{MON_PROM_CPU}}% | {{MON_PROM_MEM}}MB | 🟢 |
| Grafana | {{MON_GRAF_CPU}}% | {{MON_GRAF_MEM}}MB | 🟢 |
| Loki | {{MON_LOKI_CPU}}% | {{MON_LOKI_MEM}}MB | 🟢 |
| Promtail | {{MON_PT_CPU}}% | {{MON_PT_MEM}}MB | 🟢 |
| Tempo | {{MON_TEMPO_CPU}}% | {{MON_TEMPO_MEM}}MB | 🟢 |
| AlertManager | {{MON_AM_CPU}}% | {{MON_AM_MEM}}MB | 🟢 |
| **总计** | **{{MON_TOTAL_CPU}}%** | **{{MON_TOTAL_MEM}}MB** | **{{MON_OVERALL_STATUS}}** |

#### TSDB 存储信息

| 指标 | 值 |
|------|-----|
| TSDB 大小 | {{TSDB_SIZE}} |
| 头块数量 | {{HEAD_BLOCKS}} |
| 样本保留期 | 15d (默认) |

---

### 6. 全局磁盘

#### 分区使用情况

| 文件系统 | 总大小 | 已用 | 可用 | 使用率 | 状态 |
|----------|--------|------|------|--------|------|
| / (root) | {{DISK_TOTAL}}GB | {{DISK_USED}}GB | {{DISK_AVAIL}}GB | {{DISK_PCT}}% | {{DISK_STATUS}} |

#### Docker 磁盘使用明细

| 类型 | 大小 | 占比 |
|------|------|------|
| Images | {{DOCKER_IMAGES}} | {{DOCKER_IMAGES_PCT}}% |
| Containers | {{DOCKER_CONTAINERS}} | {{DOCKER_CONTAINERS_PCT}}% |
| Local Volumes | {{DOCKER_VOLUMES}} | {{DOCKER_VOLUMES_PCT}}% |
| Build Cache | {{DOCKER_CACHE}} | {{DOCKER_CACHE_PCT}}% |

#### Inode 使用

| 指标 | 值 | 状态 |
|------|-----|------|
| Inode 使用率 | {{INODE_PCT}}% | {{INODE_STATUS}} |

#### 磁盘增长预测

```
磁盘使用率预测 ({{FORECAST_DAYS}}天视角):

实际值 ······ 预测值 ---- 阈值线 ===

使用率(%)
100 │                                          ====== 90%阈值
 80 │                                     ╭═════ ═════ 80%阈值
 60 │                                ╭────╯
 40 │  ····●━━━━·●━━━━·●━━━━·●━━━━●━━━━●----●----●
 20 │
  0 └────────────────────────────────────────────→ 天数
     Now    +7d        +14d       +21d       +${FORECAST_DAYS}d

预计到达 80% 阈值: 约 {{DAYS_TO_80PCT}} 天后
预计到达 90% 阈值: 约 {{DAYS_TO_90PCT}} 天后
```

---

## 趋势图表描述

### 整体容量趋势（ASCII Art 占位）

```
全局容量利用率热力图:

          API    PGSQL   Redis   Nginx   Mon    Disk
Now       ██     ███     ██      █       ███    ███
+7d       ██     ███     ███     █       ███    ███
+14d      ███    ███     ███     █       ███    ████
+21d      ███    ███     ███     ██      ███    ████
+30d      ███    ███     ████    ██      ███    █████

图例: █ = ~10% 利用率单位
```

### 各组件容量余量排名

```
容量余量 (距离阈值还有多少空间):

100%┤████████████████████████████████████████████  Redis Keys
 90%┤███████████████████████████████████████████    API Heap
 80%┤███████████████████████████████████████        API Memory
 70%┤███████████████████████████████████            Disk
 60%┤███████████████████████████████                PG Disk
 50%┤█████████████████████████                       PG Conns
 40%┤███████████████████                              API CPU
 30%┤███████████████                                  Nginx Mem
 20%┤█████████                                        Monitor
 10%┤████                                             Redis Mem
  0%└────────────────────────────────────────────────→
     Redis  API    Disk   PGSQL  API    PGSQL  API    Nginx  Mon    Redis
            Heap          Disk   CPU           Mem           Mem
```

---

## 扩容建议

### 当前评估结论

{{CONCLUSION_BLOCK}}

### 扩容方案矩阵

| 方案 | 触发条件 | 操作内容 | 预估成本 | 复杂度 | 预估停机时间 |
|------|----------|----------|----------|--------|------------|
| **A: API内存扩容** | API堆利用率 > 70% | `--max-old-space-size` 384 → 768 | \$0 (仅配置变更) | 低 | 0s (滚动重启) |
| **B: API CPU扩容** | API CPU > 60% | cpus 1.0 → 2.0 | +\$5-15/月 | 低 | 0s (滚动重启) |
| **C: PG连接池优化** | PG连接 > 50 | 调整 max_connections / pgBouncer | \$0 | 中 | ~30s |
| **D: PG磁盘扩容** | PG磁盘 > 60% | 卷扩展 或 数据清理 | varies | 中 | ~1min |
| **E: Redis内存调整** | Redis内存 > 50% | maxmemory 64MB → 256MB | \$0 | 低 | 0s (重启) |
| **F: 全局磁盘清理** | 全局磁盘 > 65% | docker prune / 日志轮转 | \$0 | 低 | 0s |
| **G: HA水平扩展** | 任一组件 > 85% | docker-compose.ha.yml | +\$50-150/月 | 高 | ~5min |
| **H: 云迁移** | 持续增长 > 2个月 | 迁移至云托管服务 | 按需付费 | 高 | ~30min |

### 推荐行动优先级

```
优先级排序 (基于当前数据):

P1 - 立即执行 (如有):
   {{P1_ACTIONS}}

P2 - 本周规划:
   {{P2_ACTIONS}}

P3 - 月度回顾:
   {{P3_ACTIONS}}

P4 - 季度战略:
   {{P4_ACTIONS}}
```

---

## 成本估算

### 扩容方案成本对比

| 方案 | 月成本变化 | 年成本变化 | ROI周期 | 适用场景 |
|------|-----------|-----------|---------|---------|
| **现状维持** | \$0/年 | \$0/年 | N/A | 当前规模足够 |
| **垂直扩容 (2x)** | +\$20-50/月 | +\$240-600/年 | 3-6个月 | 业务增长50%以上 |
| **HA水平扩展** | +\$50-150/月 | +\$600-1800/年 | 6-12个月 | 高可用需求 |
| **云托管迁移** | 按需付费 | 弹性计费 | 即时 | 弹性需求 |
| **专用服务器升级** | +\$100-300/月 | +\$1200-3600/年 | 12-24个月 | 长期稳定需求 |

### 成本优化建议

1. **Right-sizing**: 根据实际利用率调整容器资源限制，避免过度分配
2. **自动伸缩**: 引入 K8s HPA 或云自动伸缩组
3. **Spot实例**: 监控栈可使用 Spot/Preemptible 实例节省成本
4. **数据生命周期**: 合理设置 Prometheus 数据保留期和降采样策略
5. **缓存优化**: 增加 Redis 缓存命中率以减少数据库负载

---

## 历史对比

### vs 上期报告

| 对比维度 | 上期值 | 本期值 | 变化幅度 | 趋势 |
|----------|--------|--------|----------|------|
| 报告日期 | {{LAST_REPORT_DATE}} | {{CURRENT_REPORT_DATE}} | — | — |
| 整体状态 | {{LAST_OVERALL_STATUS}} | {{CURRENT_OVERALL_STATUS}} | — | {{STATUS_CHANGE}} |
| API CPU | {{LAST_API_CPU}}% | {{CURRENT_API_CPU}}% | {{API_CPU_DELTA}}% | {{API_CPU_DIR}} |
| API Memory | {{LAST_API_MEM}}% | {{CURRENT_API_MEM}}% | {{API_MEM_DELTA}}% | {{API_MEM_DIR}} |
| PG Connections | {{LAST_PG_CONN}} | {{CURRENT_PG_CONN}} | {{PG_CONN_DELTA}} | {{PG_CONN_DIR}} |
| PG Disk | {{LAST_PG_DISK}}% | {{CURRENT_PG_DISK}}% | {{PG_DISK_DELTA}}% | {{PG_DISK_DIR}} |
| Redis Keys | {{LAST_REDIS_KEYS}} | {{CURRENT_REDIS_KEYS}} | {{REDIS_KEYS_DELTA}} | {{REDIS_KEYS_DIR}} |
| Disk Usage | {{LAST_DISK_PCT}}% | {{CURRENT_DISK_PCT}}% | {{DISK_PCT_DELTA}}% | {{DISK_PCT_DIR}} |

### 变化原因分析

{{CHANGE_ANALYSIS_BLOCK}}

---

## 附录

### A. 数据来源与采集方式

| 数据源 | 采集方法 | 采集频率 | 保存位置 |
|--------|----------|----------|----------|
| Prometheus | HTTP API (`/api/v1/query`) | 5分钟 | data/capacity/raw/*.csv |
| Docker Stats | `docker stats --no-stream` | 5分钟 | data/capacity/raw/*.csv |
| PostgreSQL | `pg_stat_activity`, `df -h` | 5分钟 | data/capacity/raw/postgresql_metrics.csv |
| Redis | `INFO memory`, `INFO keyspace` | 5分钟 | data/capacity/raw/redis_metrics.csv |
| Nginx | stub_status, docker stats | 5分钟 | data/capacity/raw/nginx_metrics.csv |
| Disk | `df -h`, `docker system df` | 5分钟 | data/capacity/raw/disk_metrics.csv |

### B. 预测算法说明

本报告使用的预测算法：

1. **线性回归**: 基于过去N天的采样点拟合趋势线
2. **复合增长模型**: `FutureValue = Current × (1 + daily_rate)^days`
3. **指数平滑**: α=0.3 的单参数平滑，过滤短期波动
4. **瓶颈检测**: 取所有维度中利用率最高的作为整体瓶颈指标

### C. 阈值设定依据

| 组件 | 维度 | 阈值 | 设定依据 |
|------|------|------|----------|
| API | CPU | 80% | Node.js事件循环响应能力边界 |
| API | Memory | 512MB | docker-compose.prod.yml limits |
| API | Heap | 85% | --max-old-space-size=384 的安全边际 |
| API | Connections | 100 | Express.js默认并发处理能力 |
| API | EventLoop Lag | 50ms | 用户感知延迟阈值 |
| PG | CPU | 80% | 查询响应SLA保障 |
| PG | Memory | 1024MB | PostgreSQL默认工作集 |
| PG | Connections | 100 | postgresql.conf max_connections |
| PG | Disk | 50GB | 数据卷安全水位线 |
| Redis | Memory | 64MB | Redis典型小实例限制 |
| Redis | Keys | 10000 | 性能退化临界点 |
| Redis | Clients | 100 | 连接数管理阈值 |
| Nginx | Memory | 128MB | 反代典型内存占用 |
| Nginx | Connections | 10000 | worker_connections × workers |
| Monitor | Memory | 512MB | 监控栈总体预算 |
| Disk | Usage | 80% | 系统运维安全水位 |

### D. 术语表

| 术语 | 定义 |
|------|------|
| P95 | 第95百分位延迟，95%的请求在此时间内完成 |
| RSS | Resident Set Size，进程常驻物理内存 |
| Heap | V8引擎管理的JavaScript对象堆内存 |
| Event Loop Lag | Node.js事件循环阻塞时间 |
| TSDB | Time Series Database，Prometheus时序数据库 |
| QPS | Queries Per Second，每秒查询数 |
| OPS | Operations Per Second，Redis每秒操作数 |
| Fragmentation | Redis内存碎片率（used_memory_rss / used_memory） |

---

*报告由 GlobalReach O04 容量规划自动化系统自动生成*
*模板版本: v1.0.0 | 最后更新: 2026-06-09*
