# GlobalReach V2.0 成本优化仪表盘设计文档

> **文档版本**: v1.0
> **创建日期**: 2026-06-09
> **任务编号**: S132/O06 — Cost Optimization Dashboard
> **适用范围**: GlobalReach V2.0 企业级邮件营销平台 — 成本管理与 FinOps 实践
> **作者**: 成本优化工程团队

---

## 目录

- [1. 概述与目标](#1-概述与目标)
- [2. FinOps 方法论对齐](#2-finops-方法论对齐)
- [3. 系统架构](#3-系统架构)
- [4. 成本数据模型](#4-成本数据模型)
- [5. 浪费检测算法详解](#5-浪费检测算法详解)
- [6. 云成本估算模型](#6-云成本估算模型)
- [7. 优化建议优先级排序算法](#7-优化建议优先级排序算法)
- [8. API 接口设计](#8-api-接口设计)
- [9. Grafana 仪表盘设计](#9-grafana-仪表盘设计)
- [10. 与 O04 容量规划的协同关系](#10-与-o04-容量规划的协同关系)
- [11. 安全性考虑](#11-安全性考虑)
- [12. 实施路线图](#12-实施路线图)
- [13. 运维手册](#13-运维手册)
- [14. 附录](#14-附录)

---

## 1. 概述与目标

### 1.1 项目背景

GlobalReach V2.0 作为企业级邮件营销平台，当前采用单节点 Docker Compose 部署模式运行在本地服务器上。随着业务发展，基础设施成本管理逐渐成为运维团队的重要关注点：

- **当前状态**: 13 个 Docker 容器组成的完整技术栈（API、PostgreSQL、Redis、Nginx、Prometheus、Grafana、Loki、Tempo、AlertManager 等）
- **成本痛点**: 资源分配基于初始规划，可能存在过配（over-provisioning）或闲置（idle）情况
- **未来方向**: 云迁移是可选路径之一，需要准确的成本对比数据支撑决策

### 1.2 设计目标

| 目标 | 描述 | 验收标准 |
|------|------|---------|
| **成本可视化** | 清晰展示当前基础设施的月度成本构成 | 支持电力/折旧/存储/网络四维分解 |
| **浪费检测** | 自动识别资源浪费并量化节省潜力 | 支持 6 类浪费检测规则 |
| **云成本估算** | 提供三云厂商（AWS/Azure/GCP）的迁移成本参考 | 含 On-Demand vs Reserved 对比 |
| **优化建议** | 基于数据驱动的 ROI 优先级排序建议 | P0/P1/P2 三级分类 |
| **可操作性** | 所有分析为只读操作，不自动调整资源 | 无副作用（side-effect free） |

### 1.3 核心原则

```
┌─────────────────────────────────────────────────────┐
│              成本优化核心原则                         │
├─────────────────────────────────────────────────────┤
│                                                     │
│  📊 数据驱动    → 所有结论基于实时采集的指标数据     │
│  🔒 只读安全    → 分析操作不修改任何资源配置         │
│  💰 ROI 导向    → 优化建议按投入产出比排序           │
│  🔍 可追溯      → 每个建议都有明确的数据来源和算法   │
│  ☁️ 多模式支持  → 本地部署 + 云端估算双轨并行       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 2. FinOps 方法论对齐

本系统严格遵循 **FinOps Foundation** 的三阶段方法论：**Inform（知情）→ Optimize（优化）→ Operate（运营）**

### 2.1 Inform 阶段 — 成本可见性

**目标**: 让所有利益相关者了解"钱花在哪里"

#### 数据采集层

```yaml
inform_data_sources:
  infrastructure_metrics:
    - source: "Docker Stats API"
      endpoint: "docker stats --no-stream"
      frequency: "每5分钟"
      data_points: ["CPU%", "MEM usage", "NET IO", "Block IO"]
      containers: "globalreach-* (全部13个)"

    - source: "Prometheus Time-Series DB"
      endpoint: "${PROMETHEUS_URL}:9090/api/v1/query"
      data_points:
        - "container_cpu_usage_seconds_total"
        - "container_memory_working_set_bytes"
        - "container_memory_rss"
        - "pg_stat_activity_count"
        - "redis_connected_clients"

  system_metrics:
    - source: "df -h"
      target: "磁盘使用率"
    - source: "docker system df"
      target: "Docker 存储占用"
    - source: "docker images -f dangling=true"
      target: "悬空镜像空间"
```

#### 成本归因模型

将总成本分摊到各个组件：

```
总月成本 = 电力成本 + 硬件折旧 + 存储成本 + 网络成本

组件成本分摊公式:
  component_cost_i = (cpu_share_i × power_base) + (mem_share_i × depreciation_base)

其中:
  cpu_share_i = container_cpu_limit_i / Σ(all_cpu_limits)
  mem_share_i = container_mem_limit_i / Σ(all_mem_limits)
  power_base = server_power(W) × hours/month × electricity_price(CNY/kWh)
  depreciation_base = monthly_depreciation(CNY) × memory_weight_factor
```

### 2.2 Optimize 阶段 — 成本优化

**目标**: 发现浪费机会并执行优化

#### 浪费检测规则引擎

详见第 5 章。核心思路是定义一组可配置的阈值规则，对每个容器/系统指标进行扫描。

#### 优化行动矩阵

| 行动类型 | 触发条件 | 执行方式 | 回滚方案 | 风险等级 |
|---------|---------|---------|---------|---------|
| RIGHT_SIZE_CPU | CPU 使用率 < 10% 且 limit ≥ 0.5核 | 修改 docker-compose CPU limit | git revert | 低 |
| RIGHT_SIZE_MEMORY | RSS/Limit ratio > 3.0 | 修改 docker-compose mem limit | git revert | 低 |
| CLEANUP_IMAGES | 悬空镜像 > 100MB | docker image prune | 重新 pull/build | 极低 |
| COMPRESS_LOGS | 日志目录 > 500MB | 调整 Loki retention | 恢复配置 | 低 |
| MERGE_STACK | ≥3 监控容器空闲 | 合并为 all-in-one | 恢复原始 compose | 中 |

### 2.3 Operate 阶段 — 持续运营

**目标**: 建立成本优化的持续改进机制

#### 运营流程

```
每日自动:
  └── scripts/cost-analyzer.sh --waste → 检测新浪费项

每周审查:
  ├── 审查本周浪费趋势
  ├── 评估优化建议 ROI
  └── 决定是否执行 P0/P1 操作

每月报告:
  ├── ./scripts/cost-analyzer.sh --monthly-report
  ├── 云成本对比更新 (定价变动)
  └── TCO 趋势分析

季度规划:
  ├── 评估云迁移时机
  ├── 更新容量规划基线 (协同 O04)
  └── FinOps KPI 复盘
```

---

## 3. 系统架构

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                    GlobalReach 成本优化系统                       │
│                        (O06 Architecture)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐   ┌──────────────────┐   ┌────────────────┐   │
│  │  数据采集层   │   │   分析引擎层      │   │   展示层        │   │
│  │              │   │                  │   │                │   │
│  │ • Docker     │──▶│ • cost-analyzer  │──▶│ • REST API     │   │
│  │   Stats API  │   │   .sh            │   │   (/api/v1/cost)│   │
│  │              │   │                  │   │                │   │
│  │ • Prometheus │──▶│ • cloud-cost-    │──▶│ • Grafana      │   │
│  │   Query API  │   │   estimator.sh   │   │   Dashboard    │   │
│  │              │   │                  │   │                │   │
│  │ • System Cmds│──▶│ • Waste Detection│──▶│ • CLI Report   │   │
│  │   (df/docker)│   │   Engine         │   │   (--json/txt) │   │
│  └──────────────┘   └──────────────────┘   └────────────────┘   │
│          │                  │                      │            │
│          ▼                  ▼                      ▼            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    数据存储层                             │   │
│  │                                                          │   │
│  │  data/cost/                                             │   │
│  │  ├── raw/           # 原始采集数据 (CSV)                 │   │
│  │  ├── aggregated/    # 聚合后的成本数据                    │   │
│  │  └── logs/          # 优化操作审计日志                   │   │
│  │                                                          │   │
│  │  docs/templates/                                        │   │
│  │  └── cost-monthly-report.md  # 月度报告输出               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 组件清单

| 组件 | 文件路径 | 类型 | 职责 |
|------|---------|------|------|
| 成本分析脚本 | `scripts/cost-analyzer.sh` | Shell | 全量成本分析 + 浪费检测 |
| 云成本估算器 | `scripts/cloud-cost-estimator.sh` | Shell | 三云厂商定价映射 + TCO 对比 |
| REST API | `api/routes/cost.js` | Node.js/Express | 编程接口 + 规则引擎 |
| Grafana 仪表盘 | `grafana/dashboards/cost-optimization.json` | JSON | 15面板可视化 |
| 设计文档 | `docs/COST_OPTIMIZATION_DASHBOARD.md` | Markdown | 本文档 |

### 3.3 数据流图

```
[定时触发/Cron]
      │
      ▼
[Docker Stats] ──┐
                  ├──▶ [cost-analyzer.sh] ──▶ [CSV Raw Data]
[Prometheus] ────┤                          │
                  │                          ▼
[System Commands]─┘                [Waste Detection Engine]
                                           │
                              ┌────────────┼────────────┐
                              ▼            ▼            ▼
                        [Text Report]  [JSON Output]  [Monthly MD]
                              │            │            │
                              ▼            ▼            ▼
                         [CLI 用户]   [REST API]   [文档存档]
                                          │
                                          ▼
                                   [Grafana Dashboard]
                                          │
                                    ┌─────┴─────┐
                                    ▼           ▼
                              [运维人员]   [管理层]
```

---

## 4. 成本数据模型

### 4.1 数据采集流水线

成本数据的生命周期遵循以下阶段：

```
采集(Collection) → 归因(Attribution) → 分摊(Allocation) → 展示(Presentation)
```

#### 阶段一：采集 (Collection)

从多个异构数据源获取原始指标：

| 数据源 | 采集方法 | 采样频率 | 关键字段 |
|--------|---------|---------|---------|
| Docker Stats | `docker stats --no-stream` | 5min | CPUPerc, MemUsage, NetIO, BlockIO |
| Prometheus | HTTP API query | 5min | container_*, node_*, pg_*, redis_* |
| 文件系统 | `df -h`, `du -sh` | 1h | disk usage, directory sizes |
| Docker 系统 | `docker system df`, `docker images` | 1h | image sizes, overlay usage |

#### 阶段二：归因 (Attribution)

将原始指标关联到具体的成本对象（容器/服务）：

```javascript
// 成本归因数据结构
const CostAttribution = {
    timestamp: "ISO8601",
    containerName: "globalreach-api-prod",
    category: "core",             // core | monitoring | tool
    metrics: {
        cpuPercent: 12.5,
        cpuLimitCores: 1.0,
        memoryUsedMB: 128,
        memoryLimitMB: 512,
        networkIOBytes: 52428800,  // 50MB
        blockIOBytes: 1048576,     // 1MB
        uptimeHours: 720.5,
    },
    derived: {
        cpuUtilizationRatio: 0.125,  // actual/limit
        memoryUtilizationRatio: 0.25,
        idleScore: 0.35,              // 0=繁忙, 1=完全空闲
    }
};
```

#### 阶段三：分摊 (Allocation)

将基础设施固定成本按比例分摊到各组件：

```python
# 本地部署成本分摊伪代码
def allocate_local_cost(containers):
    total_cpu = sum(c.cpu_limit for c in containers)
    total_mem = sum(c.mem_limit for c in containers)

    base_power = SERVER_POWER_WATTS * HOURS_PER_MONTH * ELECTRICITY_PRICE
    base_depreciation = MONTHLY_DEPRECIATION

    for container in containers:
        cpu_share = container.cpu_limit / total_cpu
        mem_share = container.mem_limit / total_mem

        container.cost = {
            'power': base_power * cpu_share * 0.7,      # 70%按CPU分摊
            'depreciation': base_depreciation * mem_share * 0.9,  # 90%按内存分摊
            'storage': STORAGE_COST * container.estimated_disk_gb,
            'network': NETWORK_COST * container.network_ratio,
        }

    return containers
```

#### 阶段四：展示 (Presentation)

通过多种格式输出给不同受众：

| 输出格式 | 目标受众 | 使用场景 |
|---------|---------|---------|
| CLI 文本报告 | DevOps 工程师 | 终端快速查看 |
| JSON API | 自动化工具/CI-CD | 集成到其他系统 |
| Grafana Dashboard | 运维团队 | 实时监控大屏 |
| Markdown 月报 | 管理层/财务 | 定期汇报 |

### 4.2 核心数据结构

```typescript
// TypeScript 风格的数据模型定义

interface MonthlyCostReport {
    reportType: 'full_cost_analysis';
    timestamp: string;               // ISO8601
    analysisPeriod: string;          // e.g., "近 7 天"
    costMode: 'local' | 'cloud';

    // 成本估算
    monthlyCostEstimate: {
        totalCNY: number;
        breakdown: {
            powerCNY: number;
            depreciationCNY: number;
            storageCNY: number;
            networkCNY: number;
        };
        resourceAllocation: {
            totalCpuCores: number;
            totalMemoryMB: number;
            estimatedDiskGB: number;
        };
    };

    // 各组件数据
    components: ComponentCostData[];

    // 浪费检测结果
    wasteDetection: {
        totalItems: number;
        items: WasteItem[];
        totalEstimatedSavingCNY: number;
    };

    // 优化摘要
    optimizationSummary: {
        potentialMonthlySavingCNY: number;
        savingPercentage: string;
    };
}

interface ComponentCostData {
    component: string;               // api | postgres | redis | ...
    container: string;               // globalreach-api-prod
    category: 'core' | 'monitoring' | 'tool';
    timestamp: string;

    metrics: {
        cpuPercent: number;
        cpuLimitCores: number;
        memoryUsedMB: number;
        memoryLimitMB: number;
        memoryUtilizationPercent: number;
        netIO: string;
        uptimeHours: number;
    };

    cost: {
        estimatedMonthlyCNY: number;
        costMode: string;
    };

    status: string;                  // ✅ | ⚠️低效 | ⚠️空闲
}

interface WasteItem {
    id: string;                      // W1, W2, W3...
    type: WasteType;
    description: string;
    impact: string;
    estimatedSavingCNY: string;
    recommendation: string;
}

type WasteType =
    | 'CPU_OVERPROVISION'
    | 'MEMORY_OVERPROVISION'
    | 'IDLE_CONTAINER'
    | 'REDUNDANT_LOGS'
    | 'REDUNDANT_BACKUPS'
    | 'UNUSED_IMAGES';

interface CloudEstimate {
    provider: 'aws' | 'azure' | 'gcp';
    currency: 'USD';
    region: string;
    breakdown: {
        computeUSD: number;
        storageUSD: number;
        networkUSD: number;
        monitoringUSD: number;
        totalOnDemandUSD: number;
        reserved1YUSD: number;       // 1年预留价
        reserved3YUSD: number;       // 3年预留价
    };
}
```

---

## 5. 浪费检测算法详解

### 5.1 算法概览

浪费检测引擎采用 **规则匹配 + 阈值判定** 的混合策略：

```
输入: 容器指标数据 (来自 Docker Stats + Prometheus)
  │
  ├─▶ [规则1: CPU 过配]  ──▶ 判定结果
  ├─▶ [规则2: 内存过配]  ──▶ 判定结果
  ├─▶ [规则3: 空闲容器]  ──▶ 判定结果
  ├─▶ [规则4: 日志冗余]  ──▶ 判定结果
  ├─▶ [规则5: 备份冗余]  ──▶ 判定结果
  └─▶ [规则6: 未用镜像]  ──▶ 判定结果
  │
  ▼
输出: 浪费项列表 (按 ROI 排序)
```

### 5.2 各规则详细说明

#### 规则 1: CPU_OVERPROVISION（CPU 过配）

**检测逻辑**:

```bash
# 伪代码实现
function detect_cpu_overprovision(container_name, cpu_pct_actual, cpu_limit) {
    # 条件1: 实际使用率低于阈值
    if (cpu_pct_actual < 10 && cpu_limit >= 0.5) {
        # 计算推荐值: 当前 limit 的 50%
        recommended_limit = cpu_limit * 0.5

        # 估算节省 (简化模型)
        saving = (cpu_limit - recommended_limit) * 24h * 30d * unit_price

        return WasteItem({
            type: CPU_OVERPROVISION,
            description: "${container} CPU 过配 (${limit}→${recommended}核)",
            impact: "${actual}/${limit} 核实际使用",
            saving: "¥${saving}"
        })
    }
}
```

**参数说明**:

| 参数 | 默认值 | 说明 |
|------|-------|------|
| `max_cpu_pct` | 10% | CPU 使用率上限阈值 |
| `min_cpu_limit` | 0.5 核 | 最小检测的 CPU 分配量 |
| `recommendation_ratio` | 0.5 | 推荐值为当前的 50% |

**理论依据**: Docker 容器的 CPU 是 soft-limit（共享式），即使 limit 设置较高也不会真正"浪费"物理 CPU。但过高的 limit 可能导致容器在突发时抢占过多 CPU 时间片，影响其他容器。因此此规则更多是**最佳实践提醒**而非硬性浪费。

#### 规则 2: MEMORY_OVERPROVISION（内存过配）

**检测逻辑**:

```bash
function detect_memory_overprovision(container_name, mem_used_mb, mem_limit_mb) {
    # 计算 over-provisioning ratio
    ratio = mem_limit_mb / max(mem_used_mb, 1)

    # 条件: ratio > 3 且实际使用 < 100MB 且 limit >= 128MB
    if (ratio > 3.0 && mem_used_mb < 100 && mem_limit_mb >= 128) {
        recommended_mem = max(mem_used_mb * 2, 64)  # 至少保留64MB余量
        waste_mb = mem_limit_mb - recommended_mem

        # 存储成本换算 (简化: ¥0.001/GB/小时 ≈ ¥0.72/GB/月)
        saving = waste_mb * 0.001 * 30  # CNY/月

        return WasteItem({
            type: MEMORY_OVERPROVISION,
            description: "${container} 内存过配 (${limit}MB→${rec}MB)",
            impact: "${waste_mb}MB 浪费空间",
            saving: "¥${saving}"
        })
    }
}
```

**参数说明**:

| 参数 | 默认值 | 说明 |
|------|-------|------|
| `ratio_threshold` | 3.0 | Limit/RSS 比值超过此值视为过配 |
| `min_used_mb` | 100MB | 实际使用的最小绝对值 |
| `min_limit_mb` | 128MB | 最小检测的内存分配量 |
| `safety_margin` | 2x | 推荐值 = 实际使用 × 安全系数 |

**重要考量**:

- **OOM 风险**: 降低 memory limit 必须留足安全余量，否则可能导致容器被 OOM Kill
- **RSS vs VSZ**: Linux 进程的 RSS（常驻集）才是真正的物理内存占用，VSZ 包含了 mmap 但未实际分配的部分
- **动态需求**: 某些应用（如 JVM）会在启动时预留大量内存但逐步释放，需要观察完整的生命周期

#### 规则 3: IDLE_CONTAINER（空闲容器）

**检测逻辑**:

```bash
function detect_idle_container(container_name, category, net_io, uptime_hours) {
    # 仅针对监控类和工具类容器
    if (category not in ['monitoring', 'tool']) {
        return null  # 核心业务容器不判定为"可移除的空闲"
    }

    # 解析网络 IO (如 "50MB/20MB")
    io_bytes = parse_net_io(net_io)  # 取入站+出站总和

    # 条件: 运行超过48小时 且 网络IO极低 (<10MB)
    if (uptime_hours > 48 && io_bytes < 10 * 1024 * 1024) {
        # 估算该容器的月成本 (约 ¥5/轻量容器)
        monthly_cost = estimate_container_monthly_cost(container_name)

        return WasteItem({
            type: IDLE_CONTAINER,
            description: "${container} 空闲(${uptime_hours}h无活跃请求)",
            impact: "100% 该容器资源闲置",
            saving: "¥${monthly_cost}",
            recommendation: "考虑按需启动或合并部署"
        })
    }
}
```

**特殊处理**:

- Prometheus/Grafana 等监控组件虽然网络 IO 低，但其价值在于**随时可用**以排查问题
- 此规则的输出应作为**建议**而非强制执行项
- Mailpit 在生产环境中通常可以完全停止（仅开发/测试时需要）

#### 规则 4: REDUNDANT_LOGS（冗余日志）

**检测逻辑**:

```bash
function detect_redundant_logs(log_dir_size_mb) {
    threshold_mb = 500  # 日志目录大小阈值

    if (log_dir_size_mb > threshold_mb) {
        extra_mb = log_dir_size_mb - 200  # 目标压缩至200MB
        saving = extra_mb * STORAGE_COST_PER_GB / 1024 * 12  # 年化

        return WasteItem({
            type: REDUNDANT_LOGS,
            description: "日志目录过大 (${size}MB > ${threshold}MB)",
            impact: "${extra_mb}MB 可清理",
            saving: "¥${saving}",
            recommendation: [
                "减少日志保留时间 (logrotate → daily, rotate 7)",
                "启用 gzip 压缩 (compress)",
                "Docker log driver: max-size=10m, max-file=3"
            ]
        })
    }
}
```

**Loki 特殊处理**:

对于 Grafana Loki（集中式日志存储），还需要检查：
- `retention_period` 配置（默认 744h = 31 天）
- 实际索引和数据卷大小
- 是否启用了压缩（compactor）

#### 规则 5: REDUNDANT_BACKUPS（备份冗余）

**检测逻辑**:

```bash
function detect_redundant_backups(backup_size_gb, old_file_count) {
    # old_file_count = 修改时间 >30天前的文件数量
    if (old_file_count > 0 && backup_size_gb > 5) {
        saving = backup_size_gb * STORAGE_COST_PER_GB * 0.5  # 预计可清理50%

        return WasteItem({
            type: REDUNDANT_BACKUPS,
            description: "备份保留过多 (${count}个文件>30天, 共${size}GB)",
            impact: "${backup_size_gb}GB 备份存储",
            saving: "¥${saving}",
            recommendation: [
                "增量备份: 保留30天",
                "全量备份: 每周一次, 保留4周",
                "归档备份: 每月一次, 保留12个月",
                "考虑冷存储 (S3 IA / Azure Cool / GCP Nearline)"
            ]
        })
    }
}
```

#### 规则 6: UNUSED_IMAGES（未使用镜像）

**检测逻辑**:

```bash
function detect_unused_images(unused_size_mb) {
    # unused_size_mb = docker images -f "dangling=true" 的总大小
    threshold_mb = 100

    if (unused_size_mb > threshold_mb) {
        saving = unused_size_mb * STORAGE_COST_PER_GB / 1024

        return WasteItem({
            type: UNUSED_IMAGES,
            description: "未使用的Docker镜像 (${size}MB悬空镜像)",
            impact: "${unused_size_mb}MB 磁盘占用",
            saving: "¥${saving}",
            recommendation: [
                "立即: docker image prune -a",
                "预防: 设置 cron weekly 自动清理",
                "CI/CD: 构建后自动清理中间层镜像"
            ]
        })
    }
}
```

### 5.3 浪费评分模型

每个浪费项都会被赋予一个综合评分，用于排序和优先级判断：

```python
def calculate_waste_score(item):
    """
    浪费评分 = 节省金额权重 × 0.4 + 影响范围权重 × 0.3 + 实施难度倒数 × 0.3
    """
    saving_score = normalize(item.saving_cny, 0, 100) * 0.4
    impact_score = normalize(item.impact_scope, 0, 10) * 0.3
    ease_score = (1 / item.effort_level) * 0.3  # effort: 1=easy, 5=hard

    return saving_score + impact_score + ease_score
```

---

## 6. 云成本估算模型

### 6.1 设计理念

云成本估算是为**决策支持**设计的，而非精确账单预测：

> **重要声明**: 所有云端价格为基于公开定价页面的估算值（2026Q1），不反映任何实际折扣、spot 价格或企业协议价格。实际费用请以各云厂商控制台账单为准。

### 6.2 资源映射策略

将 Docker Compose 的容器规格映射到云服务商的等效实例：

```
Local Container Specs ──▶ Mapping Algorithm ──▶ Cloud Instance Type
                                                        │
                                              ┌──────────┼──────────┐
                                              ▼          ▼          ▼
                                            AWS EC2   Azure VM   GCP CE
```

**映射原则**:

1. **满足最小需求**: 云实例的 vCPU 和内存必须 ≥ 容器的 limit 值
2. **选择最小实例**: 在满足需求的实例中选择最便宜的
3. **考虑托管服务**: 数据库/缓存优先选择托管服务（RDS/ElastiCache 等）
4. **预留区域差异**: 不同区域的定价差异可达 20-60%

**映射示例**:

| 本地容器 | CPU/MEM | AWS 映射 | Azure 映射 | GCP 映射 |
|---------|---------|----------|-----------|---------|
| API (api-prod) | 1核/512MB | t3.small ($17/月) | B1ms ($15/月) | e2-small ($14/月) |
| PostgreSQL | 2核/2GB | db.t3.medium ($52/月) | SQL Basic ($5/月) | db-g6-small ($70/月) |
| Redis | 0.5核/512MB | cache.t3.micro ($11/月) | Cache C0 ($13/月) | Memorystore 1GB ($21/月) |
| Prometheus | 1核/2GB | t3.small ($17/月) | B2ms ($36/月) | e2-medium ($39/月) |
| Grafana | 0.5核/512MB | t3.nano ($4/月) | B1s ($8/月) | e2-micro ($7/月) |

### 6.3 定价数据来源

#### AWS (us-east-1)

| 服务 | 实例类型 | On-Demand ($/h) | 1Y RI 折扣 | 3Y RI 折扣 |
|------|---------|-----------------|-----------|-----------|
| EC2 Compute | t3.medium | $0.0416 | 30% | 58% |
| RDS PostgreSQL | db.t3.medium | $0.07 | 25% | 55% |
| ElastiCache Redis | cache.t3.micro | $0.015 | 25% | 55% |
| EBS Storage (GP3) | per GB/mo | $0.08 | - | - |
| S3 Standard | per GB/mo | $0.023 | - | - |
| ALB | per LCU/h | $0.009 | - | - |
| Data Transfer | per GB (out) | $0.09* | - | - |

*前 100GB/月出站流量部分免费

#### Azure (eastus)

| 服务 | 实例类型 | On-Demand ($/h) | 1Y RI 折扣 | 3Y RI 折扣 |
|------|---------|-----------------|-----------|-----------|
| VM | B2ms (2vCPU 8GB) | $0.048 | 35% | 55% |
| SQL Database | Basic | $0.0065 | - | - |
| Redis Cache | C0 basic (250MB) | $0.018 | - | - |
| Managed Disk | P10 (128GB) | $4.50/mo | - | - |
| Blob Hot | per GB/mo | $0.018 | - | - |
| App Gateway | ~per vCPU-h | $0.155 | - | - |

#### GCP (us-central1)

| 服务 | 实例类型 | On-Demand ($/h) | 1Y CUD | 3Y CUD |
|------|---------|-----------------|--------|--------|
| CE | e2-medium (2vCPU 4GB) | $0.053 | 27% | 54% |
| Cloud SQL | db-g6-small (1vCPU 3.75GB) | $0.095 | - | - |
| Memorystore | basic 1GB | $0.028 | - | - |
| PD-Balanced | per GB/mo | $0.04 | - | - |
| Cloud Storage Std | per GB/mo | $0.02 | - | - |
| HTTP(S) LB | - | Free*** | - | - |

***满足条件时免费（标准区域、<5个后端实例等）

### 6.4 Reserved Instance / CUD 对比

| 维度 | AWS RI | Azure RI | GCP CUD |
|------|--------|----------|---------|
| **承诺期限** | 1年 / 3年 | 1年 / 3年 | 1年 / 3年 |
| **支付选项** | 无预付 / 部分预付 / 全预付 | 即付即用 | 无预付 / 部分预付 / 全预付 |
| **典型折扣** | 30% (1Y) / 58% (3Y) | 35% (1Y) / 55% (3Y) | 27% (1Y) / 54% (3Y) |
| **灵活性** | 可改实例系列/大小 | 可变更 VM 系列 | 可更改机器类型 |
| **适用范围** | EC2, RDS, ElastiCache... | VM, SQL DB, Redis Cache... | CE, CloudSQL, Memorystore... |
| **最佳场景** | 稳定负载、长期运行 | 同左 | 同左 |

### 6.5 Free Tier 利用度分析

三云厂商都提供了一定程度的免费额度，对新项目尤其有价值：

| 免费项目 | AWS (12个月) | Azure (12个月) | GCP (Always Free*) |
|---------|-------------|---------------|-------------------|
| **计算** | t2.micro/t3.micro 750h/月 | B1s 750h/月 | e2-micro (US regions) |
| **数据库** | db.t2.micro 750h/月 | Basic/S0 250h/月 | db-f1-micro (US) |
| **缓存** | cache.t2.micro 750h/月 | C0 basic 750h/月 | - |
| **存储** | S3 5GB 标准 | Blob 5GB Hot LRS | 5GB Regional Std (US) |
| **监控** | 10 metrics + 5GB logs | App Insights 5GB (永久) | 150 metrics + 10GB logs |
| **网络** | 100GB 出站/月 | 100GB 出站/月 | 1GB/日 (北美) |

*GCP Always Free 为永久免费额度，不受时间限制

**Free Tier 策略建议**:

```
阶段 1 (0-12月): 最大化利用 Free Trial
  → 选择 AWS 或 Azure（免费额度覆盖面更广）
  → 将核心服务放入免费实例规格内
  → 监控用量避免超出免费限额

阶段 2 (13-24月): 切换至 Reserved/CUD
  → 根据实际用量购买 1Y RI（灵活性较好）
  → 关注 Spot/Preemptible 实例（折扣60-90%）
  → 启用 Auto Scaling 降低非峰值成本

阶段 3 (25月+): 评估 TCO 和迁移收益
  → 如果本地成本更低，保持现状
  → 如果云弹性带来业务价值，继续云上运营
  → 考虑多云策略分散风险
```

---

## 7. 优化建议优先级排序算法

### 7.1 ROI 驱动的排序模型

优化建议不是简单按节省金额排序，而是综合考虑多维度因素：

```python
def prioritize_recommendations(waste_items):
    """
    优先级分数 = (节省金额 × 0.35) +
                 (影响范围 × 0.20) +
                 (实施容易度 × 0.20) +
                 (风险倒数 × 0.15) +
                 (时效性 × 0.10)
    """

    scored = []
    for item in waste_items:
        saving_norm = normalize(item.estimated_saving_cny, 0, 100)
        impact_norm = normalize(item.impact_scope, 0, 10)       # 1=单个容器, 10=全局
        effort_norm = normalize(item.effort_level, 1, 5, invert=True)  # 1=最易, 5=最难
        risk_norm = normalize(item.risk_level, 1, 5, invert=True)     # 1=最低风险
        urgency_norm = normalize(item.urgency, 0, 10)                # 0=不急, 10=紧急

        score = (
            saving_norm * 0.35 +
            impact_norm * 0.20 +
            effort_norm * 0.20 +
            risk_norm * 0.15 +
            urgency_norm * 0.10
        )

        scored.append({**item, 'priority_score': score})

    return sorted(scored, key=lambda x: x['priority_score'], reverse=True)
```

### 7.2 优先级分级

| 优先级 | 分数范围 | 定义 | 响应时间 | 示例 |
|--------|---------|------|---------|------|
| **P0 — 立即** | ≥ 7.0 | 高节省 + 低风险 + 易实施 | 24小时内 | 内存过配 > 500MB 浪费 |
| **P1 — 本周** | 5.0 - 6.9 | 中等节省 + 低风险 | 3-7天 | CPU 过配、镜像清理 |
| **P2 — 下周** | 3.0 - 4.9 | 较低节省或中等风险 | 7-14天 | 日志压缩、备份策略调整 |
| **P3 — 观察** | < 3.0 | 需要进一步评估 | 下次规划周期 | 空闲监控容器合并 |

### 7.3 决策矩阵示例

```
                高节省
                  │
    ┌─────────────┼─────────────┐
    │  P0: 立即    │ P1: 本周    │  ← 低风险
    │  内存降配    │ CPU 降配    │
    │  镜像清理    │ 日志压缩    │
低风险─────────────┼───────────────高风险
    │  P2: 规划    │ P3: 观察    │
    │  备份策略    │ 容器合并    │  ← 高风险
    │  监控栈整合  │ 架构重构    │
    └─────────────┴─────────────┘
                  │
                低节省
```

---

## 8. API 接口设计

### 8.1 端点总览

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/v1/cost/summary` | 成本总览（月估算、利用率、浪费率） | Public |
| GET | `/api/v1/cost/components` | 各组件成本明细 | Public |
| GET | `/api/v1/cost/waste` | 浪费项列表（含优化建议） | Public |
| GET | `/api/v1/cost/trends` | 成本趋势（周/月维度） | Public |
| GET | `/api/v1/cloud/estimate` | 云迁移成本估算 | Public |
| POST | `/api/v1/cost/optimize` | 执行推荐的优化动作 | Admin |

### 8.2 关键接口详情

#### GET /api/v1/cost/summary

**响应示例**:

```json
{
    "success": true,
    "data": {
        "timestamp": "2026-06-09T19:00:00.000Z",
        "monthlyCostEstimate": {
            "mode": "local",
            "currency": "CNY",
            "breakdown": {
                "power": 86.40,
                "depreciation": 500.00,
                "storage": 15.00,
                "network": 0.20,
                "total": 847.50
            }
        },
        "utilization": {
            "averageCpuPercent": 22.5,
            "averageMemoryPercent": 18.5,
            "overallEfficiencyScore": 77.5
        },
        "wasteSummary": {
            "totalItems": 6,
            "totalEstimatedSavingCNY": 58.05,
            "savingPercentage": "6.8",
            "criticalCount": 0,
            "mediumCount": 3,
            "lowCount": 3
        },
        "trendDirection": "stable"
    }
}
```

#### GET /api/v1/cost/waste

**查询参数**:

| 参数 | 类型 | 默认值 | 说明 |
|------|------|-------|------|
| `severity` | string | - | 过滤: high / medium / low |
| `category` | string | - | 过滤: core / monitoring / tool / system |

**响应示例**:

```json
{
    "success": true,
    "data": {
        "totalItems": 6,
        "totalEstimatedSavingCNY": 58.05,
        "items": [
            {
                "id": "W1",
                "type": "MEMORY_OVERPROVISION",
                "component": "Redis",
                "description": "Redis 内存过配 (512MB→128MB)",
                "impact": "384MB 浪费空间",
                "estimatedSavingCNY": "12.00",
                "severity": "medium",
                "recommendation": "降低 memory limit 至 128MB"
            }
        ],
        "recommendations": [...],
        "actionPlan": {
            "immediateActions": [...],
            "thisWeekActions": [...],
            "nextWeekActions": [...]
        }
    }
}
```

#### POST /api/v1/cost/optimize

**请求体**:

```json
{
    "actionId": "W1",
    "actionType": "RIGHT_SIZE_MEMORY",
    "confirmed": true
}
```

**安全机制**:

- `confirmed: false` 时返回错误，要求显式确认
- 返回详细的执行计划（只读模式），不直接修改资源
- 所有操作记录到审计日志 `data/cost/logs/optimization-actions.log`
- 提供回滚命令

---

## 9. Grafana 仪表盘设计

### 9.1 仪表盘布局（15个面板，7行）

```
┌──────────────────────────────────────────────────────────────────┐
│ Row 1: 核心KPI (4 panels)                                         │
├──────────┬──────────┬──────────────┬──────────────────────────────┤
│ [Gauge]   │ [Gauge]  │ [Line Chart] │ [Stat]                     │
│ 月度成本  │ 月节省    │ 整体利用率 % │ 成本健康评分                │
│ (Panel 1) │ (Panel 2)│ (Panel 3)    │ (Panel 4)                  │
├──────────────────────────────────────────────────────────────────┤
│ Row 2: 容器资源利用率 Heatmap                                     │
├──────────────────────────────────────────────────────────────────┤
│ [Stacked Bar] CPU利用率 by Container (Panel 5)                    │
│ [Stacked Bar] 内存利用率 by Container (Panel 6)                   │
├──────────────────────────────────────────────────────────────────┤
│ Row 3: 成本趋势线                                                 │
├──────────────────────────────┬───────────────────────────────────┤
│ [Line] 实际vs预算vs优化后     │ [Line] 浪费率趋势 (%)             │
│ (Panel 7)                    │ (Panel 8)                          │
├──────────────────────────────┴───────────────────────────────────┤
│ Row 4: 浪费项 Top 10 Table                                       │
├──────────────────────────────────────────────────────────────────┤
│ [Table] 浪费项明细 (Panel 9)                                      │
│ Columns: ID | 类型 | 描述 | 影响 | 节省 | 建议 | 严重程度        │
├──────────────────────────────────────────────────────────────────┤
│ Row 5: 优化行动追踪                                               │
├──────────────────────────────────────────────────────────────────┤
│ [Table] 优化行动状态 (Panel 10)                                   │
│ Columns: ID | 类型 | 状态 | 节省 | 创建时间 | 更新时间           │
├──────────────────────────────┬───────────────────────────────────┤
│ Row 6: 云迁移成本对比                                           │
│ [Bar] AWS On-Demand vs RI (P11) │ [Bar] Azure vs GCP (P12)      │
├──────────────────────────────┴───────────────────────────────────┤
│ Row 7: TCO 趋势                                                  │
├──────────────────────────────────────────────────────────────────┤
│ [Line] 3年TCO: Local vs AWS vs Azure vs GCP (Panel 13)           │
├──────────────────────────────┬───────────────────────────────────┤
│ [Stat] 本周优化次数 (P14)     │ [Stat] 平均响应时间 (P15)         │
└──────────────────────────────┴───────────────────────────────────┘
```

### 9.2 面板详细规格

#### Panel 1-2: Gauge 面板（月度成本 & 节省潜力）

- **数据源**: Prometheus 或 API Mock
- **阈值设置**:
  - 成本 Gauge: 绿(<500) → 黄(500-800) → 红(>800) CNY
  - 节省 Gauge: 绿(>100) → 黄(50-100) → 红(<50) CNY
- **刷新频率**: 30s（与数据采集同步）

#### Panel 5-6: Heatmap（CPU/内存利用率）

- **图表类型**: Stacked Bar (timeseries)
- **颜色编码**:
  - API: `#73BF69` (绿)
  - PostgreSQL: `#3274D9` (蓝)
  - Redis: `#F5A623` (橙)
  - Nginx: `#56A64B` (深绿)
  - Monitoring Stack: `#890F02` (红褐)
- **阈值线**: 50%(黄), 75%(橙), 90%(红)

#### Panel 9: 浪费项表格

- **列定义**:
  - `ID`: 浪费项编号 (W1-Wn)
  - `Type`: 浪费类型 (枚举值)
  - `Description`: 自然语言描述
  - `Impact`: 量化的影响
  - `Saving CNY`: 预估节省金额
  - `Recommendation`: 优化建议
  - `Severity`: 严重程度 (color-background cell)

#### Panel 13: TCO 趋势线

- **数据系列**:
  - Local (绿色): `depreciation * months`
  - AWS (红色): `on_demand * months`
  - Azure (蓝色): `on_demand * months`
  - GCP (浅蓝): `on_demand * months`
- **X轴**: 月度 (0-36月)
- **阈值线**: ¥30,000 (黄线标记关注点)

---

## 10. 与 O04 容量规划的协同关系

### 10.1 关系定位

```
O04 Capacity Planning (容量规划)          O06 Cost Optimization (成本优化)
┌──────────────────────────┐              ┌──────────────────────────┐
│ 关注点: 资源充足性        │              │ 关注点: 资源效率与成本    │
│                          │              │                          │
│ 问: 够不够用？            │ ◀── 协同 ──▶ │ 问: 有没有浪费？          │
│ 答: 需要/不需要扩容       │              │ 答: 可以节省多少？        │
│                          │              │                          │
│ 输入: 利用率 + 增长率     │              │ 输入: 利用率 + 分配上限   │
│ 输出: 扩容建议 + 时间表   │              │ 输出: 降配建议 + 节省金额 │
│                          │              │                          │
│ 方向: 向上扩展 (Scale Up) │              │ 方向: 向下适配 (Right-size)│
└──────────────────────────┘              └──────────────────────────┘
                    │                                │
                    └──────────┬─────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │   共享数据基础         │
                    │                      │
                    │ • Docker Stats 数据  │
                    │ • Prometheus 指标    │
                    │ • 容器资源配置定义   │
                    │ • 历史趋势 CSV       │
                    └──────────────────────┘
```

### 10.2 数据复用

O06 直接复用了 O04 的数据采集能力：

| O04 数据源 | O06 用途 | 复用方式 |
|-----------|---------|---------|
| `scripts/capacity-analyzer.sh` 的 Docker stats 解析函数 | 容器资源使用率采集 | 函数级调用 |
| `data/capacity/raw/*.csv` | 历史趋势分析 | 直接读取 |
| `docker-compose.prod.yml` 的 deploy.resources | 成本分摊基准 | 配置解析 |
| Prometheus 查询封装 | 应用层数据补充 | 同一套 PromQL |

### 10.3 冲突解决

当 O04 建议"扩容"而 O06 建议"降配"时的决策框架：

```
if O04 says "scale up" AND O06 says "right size down":
    # 优先保障可用性
    follow_O04_recommendation()
    # 同时记录 O06 的发现作为后续优化项
    defer_O06_to_next_cycle()

elif O04 says "no action" AND O06 says "right size down":
    # 可以安全执行降配
    execute_O06_optimization()

else:
    # 无冲突，各自独立执行
    pass
```

---

## 11. 安全性考虑

### 11.1 只读原则

整个成本优化系统的核心安全约束：

```
✅ 允许的操作:
  - 读取 Docker stats (只读 API)
  - 查询 Prometheus (只读查询)
  - 执行 df/du 等只读系统命令
  - 写入 CSV 数据文件 (仅 data/ 目录)
  - 生成报告文件 (仅 docs/templates/ 目录)

❌ 禁止的操作:
  - 修改 docker-compose.yml
  - 执行 docker update (资源限制变更)
  - 执行 docker stop/rm (容器启停)
  - 执行 docker image prune (镜像删除)
  - 修改任何业务代码或配置
```

### 11.2 API 安全

- `/api/v1/cost/*` (GET endpoints): 公开访问（仅读取成本数据）
- `POST /api/v1/cost/optimize`: 需要 Admin 角色（仅生成执行计划）
- 不暴露任何敏感信息（密码、密钥、token）
- 所有输出经过 sanitize（防止 XSS）

### 11.3 数据隐私

- 成本数据中不包含任何用户/客户信息
- 云估算使用公开定价，无需账户凭据
- 日志/报告中不含服务器 IP 等敏感标识符

---

## 12. 实施路线图

### 12.1 Phase 1: 基础能力 (已完成 ✅)

- [x] `scripts/cost-analyzer.sh` — 成本分析脚本
- [x] `scripts/cloud-cost-estimator.sh` — 云成本估算器
- [x] `api/routes/cost.js` — REST API (6个端点)
- [x] `grafana/dashboards/cost-optimization.json` — 15面板仪表盘
- [x] `docs/COST_OPTIMIZATION_DASHBOARD.md` — 设计文档

### 12.2 Phase 2: 数据管道完善 (推荐下一步)

- [ ] 部署 `cost-collector.sh` 定时采集任务 (cron 每 5 分钟)
- [ ] 接入 Prometheus 远程存储用于历史成本趋势
- [ ] 配置 Grafana AlertManager 成本告警规则
- [ ] 集成到 CI/CD 流水线（每次部署后自动跑成本检查）

### 12.3 Phase 3: 智能化增强 (远期)

- [ ] 基于 ML 的异常成本检测（突然飙升预警）
- [ ] 自动化优化建议审批工作流
- [ ] 多租户成本分摊（如果平台支持多团队）
- [ ] 与云厂商 API 集成获取真实账单数据

---

## 13. 运维手册

### 13.1 日常操作

#### 快速健康检查

```bash
# 查看当前成本概况
./scripts/cost-analyzer.sh

# 仅查看浪费项
./scripts/cost-analyzer.sh --waste

# JSON 格式输出（供系统集成）
./scripts/cost-analyzer.sh --json | jq '.monthly_cost_estimate'

# 云成本对比
./scripts/cloud-cost-estimator.sh --reserved --detailed
```

#### 定期报告生成

```bash
# 每月1号自动生成报告 (crontab)
0 8 1 * * cd /opt/globalreach && bash scripts/cost-analyzer.sh --monthly-report
```

### 13.2 故障排除

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| Docker stats 返回空 | 容器未运行 | `docker compose -f docker-compose.prod.yml ps` 检查 |
| Prometheus 连接失败 | Prometheus 未启动 | `docker compose up -d prometheus` |
| JSON 解析错误 | Python3 未安装 | 安装 python3 (`apt install python3`) |
| 成本估算偏差过大 | 定价数据过期 | 更新脚本中的定价常量 |

### 13.3 自定义配置

编辑 `scripts/cost-analyzer.sh` 顶部的配置区：

```bash
# 服务器硬件参数
SERVER_POWER_WATTS=150          # 根据实际服务器型号调整
ELECTRICITY_PRICE=0.8           # 当地电价 (元/千瓦时)
SERVER_MONTHLY_DEPRECIATION=500 # 硬件采购价 / 折旧年限(月)

# 云定价更新 (当云厂商调价时)
AWS_EC2_T3_MEDIUM_HOURLY=0.0416  # 查询 AWS Pricing API 获取最新值
AZURE_B2MS_HOURLY=0.048
GCP_E2_MEDIUM_HOURLY=0.053
```

---

## 14. 附录

### 14.1 文件清单

```
GlobalReach-Project/
├── scripts/
│   ├── cost-analyzer.sh              # O06 主分析脚本 (新增)
│   ├── cloud-cost-estimator.sh       # O06 云成本估算器 (新增)
│   └── capacity-analyzer.sh          # O04 容量分析脚本 (已有, 被引用)
├── api/routes/
│   ├── cost.js                      # O06 成本 API (新增)
│   └── capacity.js                  # O04 容量 API (已有, 被引用)
├── grafana/dashboards/
│   ├── cost-optimization.json       # O06 成本仪表盘 (新增)
│   └── capacity-planning.json       # O04 容量仪表盘 (已有, 风格参考)
├── docs/
│   └── COST_OPTIMIZATION_DASHBOARD.md # O06 设计文档 (本文档, 新增)
├── data/cost/                       # O06 数据目录 (运行时创建)
│   ├── raw/
│   ├── aggregated/
│   └── logs/
└── docker-compose.prod.yml          # 容器资源配置 (已有, 被解析)
```

### 14.2 术语表

| 术语 | 英文 | 定义 |
|------|------|------|
| 过配 | Over-provisioning | 分配的资源远超实际使用量 |
| 右缩 | Right-sizing | 将资源配置调整为接近实际需求 |
| 浪费 | Waste | 已分配但未有效利用的资源 |
| TCO | Total Cost of Ownership | 总拥有成本（含采购、运维、能源等） |
| RI | Reserved Instance | 预留实例（提前承诺换取折扣） |
| CUD | Committed Use Discount | 承诺使用折扣（GCP 术语） |
| FinOps | Financial Operations | 云财务管理实践和方法论 |
| 归因 | Attribution | 将成本关联到具体业务单元或组件 |
| 分摊 | Allocation | 将共享成本按规则分配到各方 |

### 14.3 参考资源

- [FinOps Foundation](https://www.finops.org/) — FinOps 方法论官方指南
- [AWS Pricing Calculator](https://calculator.aws/) — AWS 成本计算器
- [Azure Pricing](https://azure.microsoft.com/pricing/) — Azure 定价页面
- [Cloud Billing](https://cloud.google.com/billing) — GCP 定价文档
- [Docker Stats API](https://docs.docker.com/engine/api/v1.43/#tag/Container/operation/ContainerStats) — Docker 统计接口
- [O04 容量规划文档](./HIGH_AVAILABILITY_ARCHITECTURE.md 第七章) — HA 架构中的容量规划章节

### 14.4 版本历史

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|---------|------|
| v1.0 | 2026-06-09 | 初始版本，完成全部 5 个交付物 | O06 团队 |

---

*本文档由 GlobalReach O06 成本优化工程团队编写*
*遵循 Conventional Commits 规范*
*Task: S132/O06 — Cost Optimization Dashboard*
