# GlobalReach V2.0 — 容量规划自动化设计文档

**文档版本**: v1.0.0
**创建日期**: 2026-06-09
**任务编号**: S132/O04 — Capacity Planning Automation
**状态**: 已实现
**维护者**: 容量规划工程团队

---

## 目录

- [第一章：容量管理方法论](#第一章容量管理方法论)
  - [1.1 ITIL 容量管理对齐](#11-itil-容量管理对齐)
  - [1.2 容量管理生命周期](#12-容量管理生命周期)
  - [1.3 GlobalReach 容量管理策略](#13-globalreach-容量管理策略)
- [第二章：数据模型定义](#第二章数据模型定义)
  - [2.1 数据采集 Pipeline](#21-数据采集-pipeline)
  - [2.2 数据存储模型](#22-数据存储模型)
  - [2.3 数据分析 Pipeline](#23-数据分析-pipeline)
  - [2.4 展示层模型](#24-展示层模型)
- [第三章：预测算法详解](#第三章预测算法详解)
  - [3.1 线性回归 (Linear Regression)](#31-线性回归-linear-regression)
  - [3.2 移动平均 (Moving Average)](#32-移动平均-moving-average)
  - [3.3 指数平滑 (Exponential Smoothing)](#33-指数平滑-exponential-smoothing)
  - [3.4 Holt-Winters 三参数平滑](#34-holt-winters-三参数平滑)
  - [3.5 算法选型对比](#35-算法选型对比)
  - [3.6 Shell 脚本实现约束与简化方案](#36-shell-脚本实现约束与简化方案)
- [第四章：阈值设定最佳实践](#第四章阈值设定最佳实践)
  - [4.1 阈值分类体系](#41-阈值分类体系)
  - [4.2 如何避免误报 (False Positive)](#42-如何避免误报-false-positive)
  - [4.3 如何避免漏报 (False Negative)](#43-如何避免漏报-false-negative)
  - [4.4 动态阈值 vs 静态阈值](#44-动态阈值-vs-静态阈值)
  - [4.5 GlobalReach 默认阈值配置](#45-globalreach-默认阈值配置)
- [第五章：扩容决策框架](#第五章扩容决策框架)
  - [5.1 扩容触发条件矩阵](#51-扩容触发条件矩阵)
  - [5.2 扩容方式选择](#52-扩容方式选择)
  - [5.3 扩容评估清单](#53-扩容评估清单)
  - [5.4 回滚策略](#54-回滚策略)
- [第六章：与 HA 架构的关系](#第六章与-ha-架构的关系)
  - [6.1 docker-compose.ha.yml 资源限制参考](#61-docker-composehayml-资源限制参考)
  - [6.2 单节点 vs HA 的容量差异](#62-单节点-vs-ha-的容量差异)
  - [6.3 从单节点到 HA 的容量迁移路径](#63-从单节点到-ha-的容量迁移路径)
- [第七章：成本优化建议](#第七章成本优化建议)
  - [7.1 Right-sizing 指南](#71-right-sizing-指南)
  - [7.2 成本监控指标](#72-成本监控指标)
  - [7.3 成本优化检查清单](#73-成本优化检查清单)
- [第八章：系统集成](#第八章系统集成)
  - [8.1 与现有监控栈集成](#81-与现有监控栈集成)
  - [8.2 REST API 设计说明](#82-rest-api-设计说明)
  - [8.3 Grafana 仪表盘设计说明](#83-grafana-仪表盘设计说明)
  - [8.4 定时任务配置](#84-定时任务配置)
- [附录](#附录)

---

## 第一章：容量管理方法论

### 1.1 ITIL 容量管理对齐

GlobalReach V2.0 的容量规划自动化系统严格遵循 **ITIL 4 (IT Infrastructure Library)** 容量管理实践的核心原则：

#### ITIL 容量管理的三个子实践

```
┌─────────────────────────────────────────────────────────────┐
│                  ITIL 容量管理实践                           │
├──────────────┬──────────────────┬───────────────────────────┤
│  业务容量管理 │ 服务容量管理     │ 组件容量管理              │
│              │                  │                           │
│ • 业务需求分析 │ • SLA 监控       │ • CPU/Memory/Disk 监控   │
│ • 用户增长模式 │ • 性能基线维护   │ • 容器资源限制跟踪        │
│ • 季节性模式   │ • 工作负载建模   │ • 数据库连接池利用       │
│ • 新功能影响   │ • 变更影响评估   │ • 缓存命中率追踪         │
└──────────────┴──────────────────┴───────────────────────────┘
```

#### GlobalReach 对应映射

| ITIL 子实践 | GlobalReach 实现 | 工具/模块 |
|-------------|-----------------|-----------|
| **业务容量管理** | 用户/客户增长趋势、营销活动峰值预判 | `capacity-analyzer.sh --forecast` |
| **服务容量管理** | API P95/P99 SLA 监控、QPS 趋势 | Prometheus + capacity-collector |
| **组件容量管理** | 各容器 CPU/Memory/Disk/Connections | Docker Stats + pg_exporter + redis-cli |

### 1.2 容量管理生命周期

```
                    ┌─────────────────┐
                    │   1. 监控采集    │ ← data collection
                    │  (每5分钟)      │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   2. 数据聚合    │ ← hourly aggregation
                    │  (每小时)       │
                    └────────┬────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
    ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
    │ 3a. 趋势分析  │  │ 3b. 异常检测  │  │ 3c. 预测建模  │
    │ (线性回归等)  │  │ (阈值突破)   │  │ (复合增长模型) │
    └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
           │                 │                 │
           └─────────────────┼─────────────────┘
                             │
                    ┌────────▼────────┐
                    │   4. 决策引擎    │ ← 四级预警系统
                    │ GREEN/YELLOW/   │
                    │ ORANGE/RED      │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
       ┌──────▼──────┐ ┌────▼────┐ ┌──────▼──────┐
       │ 5a. 自动报告  │ │5b. 告警  │ │5c. 扩容建议  │
       │ (--report)   │ │(AlertMgr)│ │(recommend.) │
       └──────────────┘ └─────────┘ └──────────────┘
```

### 1.3 GlobalReach 容量管理策略

#### 核心原则

1. **主动而非被动**: 通过预测提前发现瓶颈，而非在故障后补救
2. **数据驱动决策**: 所有扩容/缩容决策基于量化指标，不凭直觉
3. **分级响应机制**: 不同严重程度对应不同的响应时效和行动级别
4. **成本效益平衡**: 在性能保障和成本控制之间找到最优解
5. **持续迭代优化**: 定期回顾和调整阈值、算法和流程

#### 容量管理成熟度模型

```
Level 0: 无管理 → Level 1: 被动响应 → Level 2: 主动监控
→ Level 3: 预测性管理 → Level 4: 自愈式运营

GlobalReach 当前位置: Level 3 (预测性管理)
目标: Level 4 (自愈式运营 — 结合 N03 AutoHealing)
```

---

## 第二章：数据模型定义

### 2.1 数据采集 Pipeline

#### 采集架构图

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  Prometheus  │   │ Docker      │   │ PostgreSQL  │   │ Redis       │
│  HTTP API    │   │ Stats API   │   │ pg_stat_*   │   │ INFO cmd    │
└──────┬──────┘   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
       │                 │                 │                 │
       ▼                 ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   capacity-collector.sh                             │
│                                                                     │
│  collect_api_metrics()         每5分钟                              │
│  collect_postgresql_metrics()   ↓                                    │
│  collect_redis_metrics()        采样                                │
│  collect_nginx_metrics()        ↓                                    │
│  collect_monitoring_metrics()   存储                                │
│  collect_disk_metrics()         ↓                                    │
│                                  CSV文件                             │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
                    ┌────────────────────────┐
                    │  data/capacity/raw/     │
                    │  ├── api_metrics.csv    │
                    │  ├── postgresql_*.csv   │
                    │  ├── redis_*.csv        │
                    │  ├── nginx_*.csv        │
                    │  ├── monitoring_*.csv   │
                    │  └── disk_*.csv         │
                    └────────────────────────┘
```

#### 数据源详细规格

| 数据源 | 采集方法 | 关键指标 | 采集频率 | 可靠性 |
|--------|----------|----------|----------|--------|
| **Prometheus** | HTTP GET `/api/v1/query` | P95延迟、QPS、错误率、连接数、堆内存 | 5min | 高（内置冗余） |
| **Docker Stats** | `docker stats --no-stream` | CPU%、Memory(RSS)、NetIO | 5min | 高（本地API） |
| **PostgreSQL** | `pg_stat_activity` + `df -h` | 活跃连接数、数据库大小、磁盘使用 | 5min | 中（依赖DB可用） |
| **Redis** | `INFO memory` + `INFO keyspace` | 使用内存、Key数量、客户端数、碎片率 | 5min | 中（依赖Redis可用） |
| **Nginx** | stub_status + Docker Stats | 活跃连接、请求计数 | 5min | 低（需启用stub_status） |

### 2.2 数据存储模型

#### 原始数据格式（CSV）

每个组件一个CSV文件，统一格式：

```csv
timestamp,unix_timestamp,<metric_1>,<metric_2>,...,<metric_N>
2026-06-09T10:00:00,1717920000,12.3,128.5,23,14.2,...
2026-06-09T10:05:00,1717920300,11.8,129.1,25,14.5,...
```

**API Node 字段定义**:

| 字段名 | 类型 | 说明 | 示例 |
|--------|------|------|------|
| timestamp | string | ISO 8601 时间戳 | `2026-06-09T10:00:00` |
| unix_timestamp | integer | Unix 时间戳（秒） | `1717920000` |
| cpu_percent | float | CPU 使用率百分比 | `12.3` |
| memory_mb | float | RSS 内存（MB） | `128.5` |
| active_connections | integer | 活跃HTTP连接数 | `23` |
| heap_usage_percent | float | V8 堆使用率 | `14.2` |
| rss_bytes | integer | 进程RSS字节数 | `134217728` |
| p95_latency_ms | float | API P95延迟(ms) | `17.2` |
| qps | float | 每秒请求数 | `42.5` |
| error_rate | float | 错误率(%) | `0.02` |

**PostgreSQL 字段定义**:

| 字段名 | 类型 | 说明 |
|--------|------|------|
| cpu_percent | float | 容器CPU使用率 |
| memory_mb | float | 容器内存(MB) |
| active_connections | integer | 数据库活跃连接数 |
| database_size_bytes | integer | 数据库大小(字节) |
| dead_tuples | integer | 死元组数量 |
| disk_used_gb | float | 数据目录已用空间(GB) |
| disk_total_gb | float | 数据目录总空间(GB) |
| disk_used_percent | float | 磁盘使用率(%) |

**Redis 字段定义**:

| 字段名 | 类型 | 说明 |
|--------|------|------|
| cpu_percent | float | 容器CPU使用率 |
| memory_mb | float | 容器内存(MB) |
| used_memory_bytes | integer | Redis实际使用内存(字节) |
| used_memory_human | string | 人类可读格式 (`"45.2M"`) |
| key_count | integer | Key总数 |
| connected_clients | integer | 已连接客户端数 |
| ops_per_sec | float | 每秒操作数 |
| evicted_keys | integer | 因内存淘汰的Key数 |
| expired_keys | integer | 过期删除的Key数 |
| fragmentation_ratio | float | 内存碎片率 |

**磁盘字段定义**:

| 字段名 | 类型 | 说明 |
|--------|------|------|
| filesystem | string | 文件系统标识符 |
| size_gb | float | 总大小(GB) |
| used_gb | float | 已用量(GB) |
| avail_gb | float | 可用量(GB) |
| used_percent | float | 使用率(%) |
| inodes_used_percent | float | Inode使用率(%) |
| docker_images | string | Docker镜像占用 |
| docker_containers | string | Docker容器占用 |
| docker_volumes | string | Docker卷占用 |
| docker_cache | string | Docker构建缓存占用 |

#### 聚合数据格式（JSON）

每小时生成一次聚合摘要：

```json
{
  "generated_at": "2026-06-09T11:00:00",
  "hour": "2026-06-09T11:00:00",
  "components": {
    "api": {
      "samples": 12,
      "avg_cpu": 12.35,
      "avg_memory": 128.76,
      "max_connections": 28,
      "avg_heap": 14.18,
      "avg_p95_latency": 0.0172,
      "avg_qps": 43.21
    },
    "postgresql": {
      "samples": 12,
      "avg_cpu": 3.21,
      "avg_memory": 89.45,
      "avg_connections": 8.33,
      "avg_disk_pct": 28.45
    },
    "disk": {
      "samples": 12,
      "avg_used_gb": 145.23,
      "avg_used_pct": 29.87,
      "avg_inode_pct": 12.34
    }
  }
}
```

### 2.3 数据分析 Pipeline

```
原始数据(CSV) ──→ 解析验证 ──→ 缺失值处理 ──→ 统计计算 ──→ 输出
     │                │             │              │            │
     │                │             │              │            ├── 趋势线
     │                │             │              │            ├── 预测值
     │                │             │              │            ├── 状态判定
     │                │             │              │            └── 建议
     │                │             │              │
     ▼                ▼             ▼              ▼
  [CSV Reader]  [Validator]  [Interpolator]  [Statistics Engine]
```

#### 分析引擎核心函数

| 函数名 | 输入 | 输出 | 用途 |
|--------|------|------|------|
| `linear_regression()` | `(x,y)` 点序列 | 斜率 + 截距 | 趋势拟合 |
| `exponential_smoothing()` | 数值序列 + α | 平滑后的最新值 | 噪声过滤 |
| `calc_stddev()` | 数值序列 | 标准差 | 波动性度量 |
| `calc_mean()` | 数值序列 | 平均值 | 中心趋势 |
| `predict_future()` | 当前值 + 日增长率 + 天数 | 预测值 | 外推预测 |
| `days_to_threshold()` | 当前值 + 阈值 + 增长率 | 到达天数 | 规划窗口 |
| `get_status_level()` | 利用率(%) | GREEN/YELLOW/ORANGE/RED | 分级判定 |

### 2.4 展示层模型

#### 文本输出模型

```
=== XXX 组件容量分析 ===
┌──────────────────────────────────────────────┐
│ 指标              │ 当前值   │ 阈值     │ 利用率 │
├──────────────────────────────────────────────┤
│ 维度1             │ value    │ threshold│ XX%   │
│ ...               │ ...      │ ...      │ ...   │
└──────────────────────────────────────────────┘

📈 趋势: 描述文字
🔮 预测: 未来N天的数值
📋 结论: ✅/⚠️/⛔ 状态 + 行动建议
```

#### JSON 输出模型

```json
{
  "component": "api",
  "timestamp": "ISO-8601",
  "metrics": {
    "dimension_name": { "current": val, "threshold": val, "utilization": pct }
  },
  "trend": {
    "daily_growth_rate_pct": float,
    "forecast_days": int,
    "predicted_value": float
  },
  "status": "GREEN|YELLOW|ORANGE|RED",
  "next_review_days": int,
  "bottleneck_utilization": float
}
```

---

## 第三章：预测算法详解

### 3.1 线性回归 (Linear Regression)

#### 数学原理

给定一组观测点 $(x_i, y_i)$，其中 $i = 1, 2, ..., n$：

**斜率 (Slope)**:
$$b = \frac{n\sum{x_i y_i} - \sum{x_i}\sum{y_i}}{n\sum{x_i^2} - (\sum{x_i})^2}$$

**截距 (Intercept)**:
$$a = \frac{\sum{y_i} - b\sum{x_i}}{n}$$

**预测方程**:
$$\hat{y} = a + bx$$

#### Shell 实现

```bash
# 输入: "x1 y1\nx2 y2\n..."
# 输出: "slope intercept"
linear_regression() {
    awk '
    BEGIN { n = 0; sum_x = 0; sum_y = 0; sum_xy = 0; sum_x2 = 0 }
    {
        n++
        x = $1; y = $2
        sum_x += x; sum_y += y
        sum_xy += x * y; sum_x2 += x * x
    }
    END {
        if (n < 2) { print "0.0 0.0"; exit }
        denom = n * sum_x2 - sum_x * sum_x
        if (denom == 0) { print "0.0 0.0"; exit }
        slope = (n * sum_xy - sum_x * sum_y) / denom
        intercept = (sum_y - slope * sum_x) / n
        printf "%.6f %.6f", slope, intercept
    }'
}
```

#### 适用场景

- **适用**: 短期趋势预测（7-30天）、线性增长的数据（如磁盘使用）
- **不适用**: 具有明显周期性的数据（如每日流量波峰波谷）、非线性增长

### 3.2 移动平均 (Moving Average)

#### 简单移动平均 (SMA)

$$SMA_t = \frac{1}{n}\sum_{i=0}^{n-1} y_{t-i}$$

#### 加权移动平均 (WMA)

$$WMA_t = \frac{\sum_{i=0}^{n-1} w_i y_{t-i}}{\sum_{i=0}^{n-1} w_i}$$

其中权重通常为 $w_i = n - i$（越近的数据权重越高）

#### Shell 实现

```bash
# 简化版：取最近N个点的均值作为平滑值
moving_average() {
    local window="$1"  # 窗口大小
    local data="$2"
    
    echo "$data" | awk -v n="$window" '
    NR <= n { sum += $2; count++ }
    END { if(count>0) printf "%.2f", sum/count }'
}
```

### 3.3 指数平滑 (Exponential Smoothing)

#### 单参数指数平滑 (SES)

$$S_t = \alpha \cdot y_t + (1-\alpha) \cdot S_{t-1}$$

其中：
- $\alpha$ (alpha): 平滑因子，$0 < \alpha < 1$
- $S_t$: t时刻的平滑值
- $y_t$: t时刻的实际观测值

**α 参数选择指南**:

| α 值 | 特性 | 适用场景 |
|------|------|----------|
| 0.1 | 强平滑，反应慢 | 稳定数据，去噪优先 |
| 0.3 | 中等平滑（推荐） | 一般业务数据 |
| 0.5 | 弱平滑，反应快 | 快速变化的数据 |
| 0.7-0.9 | 近乎实时跟踪 | 高频交易类场景 |

#### Shell 实现

```bash
# alpha: 平滑因子 (0-1), data: "x1 y1\nx2 y2\n..."
exponential_smoothing() {
    local alpha="${1:-0.3}"
    local data="$2"
    
    echo "$data" | awk -v alpha="$alpha" '
    NR == 1 { smoothed = $2; next }
    { smoothed = alpha * $2 + (1 - alpha) * smoothed }
    END { printf "%.2f", smoothed }
    '}
}
```

### 3.4 Holt-Winters 三参数平滑

#### 数学原理

Holt-Winters 方法在指数平滑的基础上增加了趋势和季节性分量：

**水平分量 (Level)**:
$$L_t = \alpha(y_t - S_{t-s}) + (1-\alpha)(L_{t-1} + T_{t-1})$$

**趋势分量 (Trend)**:
$$T_t = \beta(L_t - L_{t-1}) + (1-\beta)T_{t-1}$$

**季节性分量 (Seasonal)**:
$$S_t = \gamma(y_t - L_t) + (1-\gamma)S_{t-s}$$

**预测方程**:
$$\hat{y}_{t+m} = L_t + mT_t + S_{t-s+(m-1)\mod s}$$

其中：
- $\alpha$: 水平平滑因子
- $\beta$: 趋势平滑因子
- $\gamma$: 季节性平滑因子
- $s$: 季节周期长度
- $m$: 预测步长

#### 为什么在Shell中不实现完整Holt-Winters

完整Holt-Winters需要：
1. **三组状态变量**（L, T, S）需要跨调用持久化
2. **季节性周期检测**需要傅里叶分析或自相关计算
3. **参数优化**（α, β, γ）需要最小二乘法求解
4. 计算复杂度远超Shell脚本的合理范围

**替代方案**: 在Shell中使用简化的复合增长模型作为Holt-Winters的近似。

### 3.5 算法选型对比

| 算法 | 复杂度 | 准确度 | Shell可实施性 | 推荐场景 |
|------|--------|--------|---------------|----------|
| **线性回归** | O(n) | ★★★☆☆ | ✅ 完全可行 | 短期线性趋势 |
| **移动平均(SMA)** | O(n) | ★★☆☆☆ | ✅ 完全可行 | 去噪/平滑 |
| **指数平滑(SES)** | O(n) | ★★★☆☆ | ✅ 完全可行 | **主力算法** |
| **Holt-Winters** | O(n·s) | ★★★★★ | ⚠️ 仅简化版 | 季节性数据 |
| **ARIMA** | O(n²) | ★★★★★ | ❌ 不可行 | 专业统计环境 |
| **Prophet** | O(n²) | ★★★★★ | ❌ 不可行 | Facebook商业级 |
| **LSTM/NN** | O(n³) | ★★★★★ | ❌ 不可行 | ML平台 |

**GlobalReach 选型结论**: 以 **指数平滑(α=0.3)** 为主力算法，辅以 **线性回归** 进行趋势斜率估计。对于有明确周期性的数据（如日流量），在Grafana仪表盘中使用PromQL进行可视化分析。

### 3.6 Shell 脚本实现约束与简化方案

#### 约束列表

| 约束 | 影响 | 应对措施 |
|------|------|----------|
| 无浮点精度库 | 小数运算精度有限 | 使用 `bc` 或 `awk` 进行浮点运算 |
| 无矩阵运算 | 无法实现多元回归 | 降为一元线性回归 |
| 无持久化状态 | Holt-Winters状态难保存 | 改用无状态算法(SES) |
| 性能限制 | 大数据集处理慢 | 限制采样窗口（最近12个点） |
| 无统计分布检验 | 无法判断数据正态性 | 假设近似正态分布 |

#### 复合增长预测模型（Shell中的最终方案）

由于Shell环境的限制，我们采用以下简化但实用的预测模型：

```bash
# 核心公式: FutureValue = Current × (1 + daily_rate)^days
predict_future() {
    local current=$1    # 当前利用率(%)
    local rate=$2       # 日增长率(%/day)
    local days=$3       # 预测天数
    
    # 使用awk执行复合增长计算
    echo "$current $rate $days" | awk '{
        current = $1
        rate = $2 / 100.0
        days = $3
        predicted = current * ((1 + rate) ^ days)
        printf "%.2f", predicted
    }'
}

# 日增长率来源: 最近两个采样点的线性回归斜率
# 如果历史数据不足，使用保守的默认增长率
```

---

## 第四章：阈值设定最佳实践

### 4.1 阈值分类体系

```
阈值层次结构:

┌─────────────────────────────────────────────────────────┐
│ Level 1: 系统级绝对阈值                                   │
│   (不可违反的硬限制)                                      │
│   例: --max-old-space-size=384MB → heap ≤ 384MB          │
├─────────────────────────────────────────────────────────┤
│ Level 2: 服务质量阈值                                     │
│   (SLA相关)                                              │
│   例: API P95 < 100ms, 错误率 < 1%                       │
├─────────────────────────────────────────────────────────┤
│ Level 3: 运维预警阈值                                     │
│   (容量规划专用)                                          │
│   例: CPU > 60% → YELLOW, > 80% → ORANGE, > 90% → RED   │
├─────────────────────────────────────────────────────────┤
│ Level 4: 自适应动态阈值                                   │
│   (基于历史基线的相对变化)                                 │
│   例: 当前值 > 历史均值 + 3σ → 异常                      │
└─────────────────────────────────────────────────────────┘
```

### 4.2 如何避免误报 (False Positive)

误报原因及对策：

| 误报原因 | 示例 | 对策 |
|----------|------|------|
| **突发流量尖峰** | 营销活动瞬间流量激增 | 使用滑动窗口平均，非瞬时值 |
| **定时任务干扰** | 每日凌晨备份导致I/O飙升 | 设置维护窗口排除规则 |
| **容器重启初始化** | 重启后冷启动资源占用高 | 忽略启动前5分钟数据 |
| **采集异常** | Prometheus scrape超时 | 多次采样确认，单次异常忽略 |
| **阈值设置过低** | 50%就告警但实际正常 | 基于历史数据P95设定阈值 |

**具体技术手段**：

```bash
# 1. 使用滑动窗口而非瞬时值
# 取最近12个采样点（1小时）的平均值，而非单个值

# 2. 二次确认机制
# 连续N次超过阈值才触发告警（N=3 for WARNING, N=1 for CRITICAL）

# 3. 趋势方向判断
# 仅当「当前超过阈值」且「趋势仍在上升」时才告警
# 如果「超过但趋势下降」，降低告警级别
```

### 4.3 如何避免漏报 (False Negative)

漏报原因及对策：

| 漏报原因 | 示例 | 对策 |
|----------|------|------|
| **渐进式增长未察觉** | 每天增长0.3%，30天后才到阈值 | 趋势外推预测 |
| **组合效应被忽略** | 单个维度都OK，但总和超标 | 瓶颈检测取最大值 |
| **新组件无基线** | 刚添加的服务没有历史数据 | 使用行业默认值 |
| **采集间隔过长** | 5分钟间隔错过了瞬间的峰值 | 关键指标缩短至1分钟 |
| **阈值设置过高** | 95%才告警但90%时已经慢了 | 分级预警（50%/75%/90%） |

### 4.4 动态阈值 vs 静态阈值

| 特性 | 静态阈值 | 动态阈值 |
|------|----------|----------|
| 设定方式 | 固定数值 | 基于历史数据自动计算 |
| 适应性 | 差（需手动调整） | 好（自适应业务变化） |
| 实现复杂度 | 低 | 中高 |
| 误报率 | 可能较高（固定值不适配） | 较低 |
| 适用场景 | 稳定负载的系统 | 波动较大的业务 |
| **GlobalReach策略** | **当前采用静态阈值** | **未来可引入** |

### 4.5 GlobalReach 默认阈值配置

完整的阈值配置参见 `api/routes/capacity.js` 中的 `thresholds` 对象。以下是关键阈值的设定依据：

#### API Node 阈值依据

| 维度 | Warning | Critical | 设定依据 |
|------|---------|----------|----------|
| CPU | 60% | 80% | Node.js事件循环在CPU>80%时开始出现明显延迟 |
| Memory | 70%(~358MB) | 90%(~460MB) | docker-compose.prod.yml limit=512MB |
| Heap | 60% | 85% | --max-old-space-size=384MB，85%=326MB安全边际 |
| Connections | 50 | 80 | Express.js默认并发处理能力 |
| EventLoop Lag | 30ms | 50ms | 用户感知延迟<100ms的总预算分配 |

#### PostgreSQL 阈值依据

| 维度 | Warning | Critical | 设定依据 |
|------|---------|----------|----------|
| Connections | 50 | 80 | max_connections默认100，留20%余量给超级用户 |
| Disk | 60% | 85% | 数据卷安全水位，预留空间给VACUUM/WAL |

#### Redis 阈值依据

| 维度 | Warning | Critical | 设定依据 |
|------|---------|----------|----------|
| Memory | 60%(~38MB) | 85%(~54MB) | Redis 64MB典型小实例限制 |
| Keys | 5000 | 8000 | 万级Key开始影响性能 |
| Fragmentation | 1.5 | 3.0 | >3.0时建议执行MEMORY PURGE |

---

## 第五章：扩容决策框架

### 5.1 扩容触发条件矩阵

```
                    │  GREEN   │  YELLOW  │  ORANGE  │   RED    │
                    │  (<50%)  │ (50-75%) │ (75-90%) │  (>90%)  │
───────────────────┼──────────┼──────────┼──────────┼──────────┤
立即行动            │          │          │          │  ✅ 必须  │
7天内规划           │          │          │  ✅ 必须  │  (已在做) │
14天内关注          │          │  ✅ 建议  │  (已在做) │  (紧急)  │
30天内例行评估      │  ✅ 正常  │  (观察中) │  (计划中) │  (危机)  │
无需操作            │  ✅ 首选  │          │          │          │
───────────────────┴──────────┴──────────┴──────────┴──────────┘
```

#### 四级预警详细定义

| 等级 | 色标 | 利用率范围 | 含义 | 响应时效 | 行动要求 |
|------|------|-----------|------|----------|----------|
| 🟢 **GREEN** | 绿色 | 所有维度 < 50% | 容量充足 | 30天后再次评估 | 无需操作 |
| 🟡 **YELLOW** | 黄色 | 任一维度 50-75% | 部分偏高 | 14天内评估 | 关注趋势，准备预案 |
| 🟠 **ORANGE** | 橙色 | 任一维度 75-90% | 接近上限 | 7天内规划 | 制定扩容方案 |
| 🔴 **RED** | 红色 | 任一维度 > 90% | 即将饱和 | 立即行动 | 执行扩容或应急措施 |

### 5.2 扩容方式选择

```
扩容决策树:

系统是否达到 ORANGE/RED?
        │
   ┌────┴────┐
   YES       NO
   │          │
   │     保持现状，例行监控
   │
   是单一资源瓶颈还是多资源同时紧张？
   │
   ├─ 单一资源 ──→ 垂直扩容 (Scale Up)
   │                  │
   │              ├─ CPU不足 → 增加cpus限制
   │              ├─ 内存不足 → 增加--max-old-space-size
   │              ├─ 磁盘不足 → 卷扩展或清理
   │              └─ 连接不足 → 调整pool/max_connections
   │
   └─ 多资源/整体 ──→ 选择:
                     │
                     ├─ A: 垂直扩容 (简单快速)
                     │     成本低，但有物理上限
                     │
                     ├─ B: 水平扩展-HA (高可用)
                     │     成本中等，需改架构
                     │     参考: docker-compose.ha.yml
                     │
                     └─ C: 云迁移 (长期最优)
                           弹性伸缩，按需付费
```

#### 扩容方式对比表

| 方式 | 速度 | 成本 | 复杂度 | 上限 | 适用场景 |
|------|------|------|--------|------|----------|
| **垂直扩容** | 分钟级 | \$0-50/月 | 低 | 受物理机限制 | 单一资源瓶颈 |
| **HA水平扩展** | 小时级 | \$50-150/月 | 高 | 理论无限 | 整体容量不足 |
| **云迁移** | 天-周级 | 弹性计费 | 很高 | 云厂商限制 | 长期战略需求 |
| **优化调优** | 小时级 | \$0 | 中 | 取决于代码效率 | 有优化空间的场景 |

### 5.3 扩容评估清单

每次扩容操作前，必须完成以下检查：

```
□ [ ] 确认瓶颈根因（不是临时尖峰）
□ [ ] 评估扩容对其他组件的影响
□ [ ] 确认扩容操作的回滚方案
□ [ ] 选择低峰时段执行
□ [ ] 通知相关人员（运维/开发/业务方）
□ [ ] 准备好监控验证
□ [ ] 更新容量基线记录
□ [ ] 安排扩容后观察期（至少24小时）
```

### 5.4 回滚策略

| 场景 | 回滚方法 | RTO | 数据风险 |
|------|----------|-----|----------|
| API内存调整 | 修改env重启 | <1min | 无（仅重启） |
| PG max_connections修改 | reload配置 | <30s | 无 |
| Redis maxmemory变更 | 重启（可能丢数据） | <1min | 未持久化的Key丢失 |
| 磁盘卷扩展 | 通常不可逆 | N/A | 无 |
| HA切换 | 切回单节点 | ~5min | 可能丢最后几秒写入 |

---

## 第六章：与 HA 架构的关系

### 6.1 docker-compose.ha.yml 资源限制参考

GlobalReach 的高可用架构（详见 `docs/HIGH_AVAILABILITY_ARCHITECTURE.md`）定义了HA模式下的资源分配。容量规划需要考虑两种部署模式的差异：

#### 单节点 vs HA 资源对比

| 组件 | 单节点资源 | HA 模式资源 (每实例) | HA 总资源 | 备注 |
|------|-----------|---------------------|----------|------|
| **API** | 512MB/1CPU | 384MB/0.5CPU × N | 取决于副本数 | HA下每实例可降低（负载分散） |
| **PostgreSQL** | 无限制(宿主机) | 主: 1GB / 从: 512MB | ~1.5GB | HA增加从库开销 |
| **Redis** | 无限制(宿主机) | 主: 64MB / 从: 32MB | ~96MB | Redis Sentinel模式 |
| **Nginx** | 无限制(宿主机) | 128MB × M | 取决于LB实例数 | 作为入口网关保持独立 |
| **Monitoring** | ~300MB总计 | 共享或独立 | ~400MB | HA下监控栈本身也需HA |

#### 容量规划在HA迁移中的作用

```
单节点运行阶段:
  ┌──────────────────────────────┐
  │ capacity-analyzer.sh         │ ← 当前主要工具
  │ → 单实例资源监控              │
  │ → 瓶颈识别                   │
  │ → 扩容时机判断               │
  │ → "何时该迁移到HA?" 的输入   │
  └──────────┬───────────────────┘
             │ 当任一组件持续ORANGE
             ▼
  ┌──────────────────────────────┐
  │ HA 迁移决策                  │
  │ → 基于容量数据的可行性评估    │
  │ → 目标: 每个HA实例 < 50%利用  │
  │ → 确保有足够余量应对故障转移  │
  └──────────┬───────────────────┘
             │ 迁移完成后
             ▼
  ┌──────────────────────────────┐
  │ HA 模式下的容量规划            │
  │ → 多实例聚合分析              │
  │ → 故障转移时的容量冲击预估    │
  │ → 每个实例独立的健康度评分    │
  └──────────────────────────────┘
```

### 6.2 单节点 vs HA 的容量差异

关键差异点：

1. **故障转移余量**: HA模式下，每个实例必须预留至少50%的额外容量以接管故障节点的工作负载
2. **网络开销**: HA模式下节点间同步（PG流复制、Redis复制）消耗额外的CPU和网络带宽
3. **监控复杂度**: 需要聚合多个实例的指标才能获得全局视图
4. **扩容粒度**: HA模式下可以逐个实例扩容，比单节点的大块扩容更灵活

### 6.3 从单节点到 HA 的容量迁移路径

```
阶段1: 单节点稳定运行
  容量状态: 全部 GREEN/YELLOW
  动作: 例行监控，积累历史数据
  
         ↓ 发现某组件持续 ORANGE ≥ 2周
  
阶段2: 扩容评估
  运行: ./scripts/capacity-analyzer.sh --forecast 90d
  输出: 90天预测报告
  决策: 垂直扩容 vs HA迁移?
  
         ↓ 垂直扩容已达上限或成本不合理
  
阶段3: HA 迁移准备
  基于容量数据确定:
  - 需要多少个API实例? (基于QPS和单实例上限)
  - PG主从各需多大资源? (基于连接数和查询负载)
  - Redis集群规模? (基于Key数量和OPS)
  
         ↓ 资源预算确定
  
阶段4: HA 部署
  使用 docker-compose.ha.yml
  部署后立即运行容量验证
  
阶段5: HA 运维
  容量分析范围扩展到多实例
  引入「故障转移容量冲击」模拟
```

---

## 第七章：成本优化建议

### 7.1 Right-sizing 指南

Right-sizing（适度资源配置）是容量规划的核心理念之一：既不过度分配浪费成本，也不因资源不足影响性能。

#### GlobalReach Right-sizing 矩阵

| 组件 | 当前配置 | 实际使用(P95) | 建议配置 | 节省潜力 |
|------|----------|---------------|----------|----------|
| API Memory | 512MB (limit) | ~130MB | 256MB (limit) | ~50% |
| API CPU | 1.0 core | ~12% | 0.5 core | ~50% |
| PG (无cgroup限制) | 宿主机共享 | ~90MB | 512MB reservation | 需加限制 |
| Redis (无cgroup限制) | 宿主机共享 | ~25MB | 64MB limit | 需加限制 |
| Monitoring Stack | ~300MB total | ~300MB | 保持 | — |

#### Right-sizing 操作步骤

1. **收集基线数据**: 至少运行 `capacity-collector.sh` 7天
2. **分析P95/P99值**: 使用P99确定上限，不要用Max（易受异常值影响）
3. **添加安全边际**: 在P99基础上加20-30%作为buffer
4. **逐步调整**: 每次只调整一个维度，观察1-3天
5. **验证性能**: 确认调整后P95延迟无明显退化

### 7.2 成本监控指标

| 指标 | 计算公式 | 目标值 | 告警阈值 |
|------|----------|--------|----------|
| **资源利用率** | avg(actual/allocated) | 50-70% | <20%(过度分配) or >85%(不足) |
| **单位请求成本** | 月成本 / 总请求数 | 递减 | 突增 |
| **容量成本比** | 月成本 / 容量余量(%) | 最优平衡 | — |
| **闲置资源占比** | (allocated - used) / allocated | <30% | >50% |

### 7.3 成本优化检查清单

```
日常检查 (每周):
  □ 检查是否有容器的资源利用率持续 < 20%
  □ 检查 Docker 镜像/卷/缓存占用是否过大
  □ 检查 Prometheus TSDB 大小是否在预期范围内
  □ 审查是否有可以清理的历史数据

月度审查:
  □ 运行完整容量分析报告
  □ 评估是否有组件需要 right-sizing
  □ 检查云账单（如果使用云服务）是否有异常
  □ 对比上月容量趋势，评估成本变化

季度规划:
  □ 回顾阈值配置是否仍然合适
  □ 评估是否应该引入自动伸缩
  □ 考虑 HA 迁移的成本效益
  □ 审视监控栈本身的成本占比
```

---

## 第八章：系统集成

### 8.1 与现有监控栈集成

```
┌──────────────────────────────────────────────────────────────┐
│                    GlobalReach 监控生态                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐                                            │
│  │ Prometheus   │ ◄── scrape ──┐                              │
│  │ (数据存储)   │              │                              │
│  └──────┬──────┘              │                              │
│         │ metrics             │                              │
│         ▼                     │                              │
│  ┌─────────────┐    ┌────────┴────────┐                      │
│  │ Grafana     │    │  O04 容量规划    │                      │
│  │ (可视化)     │    │  (分析+预测)     │                      │
│  └──────┬──────┘    └────────┬────────┘                      │
│         │                     │                               │
│         │ dashboards         │ reports + API                 │
│         ▼                     ▼                               │
│  ┌─────────────────────────────────────┐                    │
│  │  capacity-planning.json (仪表盘)     │                    │
│  │  capacity-report.md (报告)          │                    │
│  │  /api/v1/capacity/* (REST API)      │                    │
│  └─────────────────────────────────────┘                    │
│                                                              │
│  辅助系统:                                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ AlertManager │  │ Loki+Promtail│  │ Tempo       │         │
│  │ (告警路由)   │  │ (日志聚合)   │  │ (链路追踪)   │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 8.2 REST API 设计说明

容量规划API (`api/routes/capacity.js`) 提供6个端点：

| 端点 | 方法 | 功能 | 典型用途 |
|------|------|------|----------|
| `/api/v1/capacity/summary` | GET | 全局总览 | Dashboard首页卡片 |
| `/api/v1/capacity/:component` | GET | 单组件详情 | 详情页/深入分析 |
| `/api/v1/capacity/forecast/:days` | GET | N天预测 | 规划会议材料 |
| `/api/v1/capacity/history` | GET | 历史数据查询 | 趋势图表数据源 |
| `/api/v1/capacity/recommendations` | GET | 扩容建议 | 运维待办事项 |
| `/api/v1/capacity/thresholds` | POST | 更新阈值 | 管理员调优 |

#### API 使用示例

```bash
# 获取全局总览
curl http://localhost:3000/api/v1/capacity/summary

# 获取PostgreSQL详情
curl http://localhost:3000/api/v1/capacity/postgresql

# 90天预测
curl http://localhost:3000/api/v1/capacity/forecast/90

# 获取扩容建议
curl http://localhost:3000/api/v1/capacity/recommendations

# 更新阈值（管理员）
curl -X POST http://localhost:3000/api/v1/capacity/thresholds \
  -H "Content-Type: application/json" \
  -d '{"component":"api","metricUpdates":{"memory_mb":{"warning":65}}}'
```

### 8.3 Grafana 仪表盘设计说明

容量规划仪表盘 (`grafana/dashboards/capacity-planning.json`) 包含以下面板区域：

| 区域 | 面板类型 | 内容 | 用途 |
|------|----------|------|------|
| **Row 1: Gauge总览** | Gauge (×6) | API CPU/Mem, PG Conn, Redis Mem/GKeys, Disk | 一眼掌握全局状态 |
| **Row 2: API趋势** | Time Series (×2) | 堆内存趋势 + 阈值线 | API容量趋势 |
| **Row 3: PG趋势** | Time Series | 连接利用率 + 阈值线 | DB容量趋势 |
| **Row 4: API连接&QPS** | Time Series | 活跃连接数 + 请求量 | 流量趋势 |
| **Row 5: PG详情** | Time Series | 活跃连接 + DB大小 | DB详情 |
| **Row 6: Redis内存** | Time Series | RSS + Usage + 阈值线 | Redis容量 |
| **Row 7: 全局对比** | Stacked Bar | 所有容器内存对比 | 资源分配合理性 |
| **Row 8: 延迟分析** | Time Series | P50/P95/P99 + 阈值线 | 性能SLA |
| **Row 9: 邮件管道** | Time Series | 吞吐 + 队列深度 | 业务容量 |
| **Row 10: 总览表** | Table | 所有组件状态一览 | 报表/导出 |
| **Row 11: 扩容预测** | Time Series | 到达阈值天数估算 | 规划参考 |
| **Row 12: 信息栏** | Text | 仪表盘说明和链接 | 导航 |

### 8.4 定时任务配置

#### Cron 配置示例

```crontab
# GlobalReach 容量数据采集 cron 任务
# 编辑: crontab -e

# 每5分钟采集一次容量数据
*/5 * * * * /path/to/scripts/capacity-collector.sh >> /var/log/capacity-collector.log 2>&1

# 每天凌晨2点生成容量报告
0 2 * * * /path/to/scripts/capacity-analyzer.sh --report >> /var/log/capacity-report.log 2>&1

# 每周一上午9点执行全量分析（含30天预测）
0 9 * * 1 /path/to/scripts/capacity-analyzer.sh --forecast 30d --report >> /var/log/capacity-weekly.log 2>&1

# 每月1号清理过期数据
0 3 1 * * /path/to/scripts/capacity-collector.sh --cleanup >> /var/log/capacity-cleanup.log 2>&1
```

#### Systemd Timer（替代方案）

如果使用systemd而非cron，可创建对应的timer单元文件。

---

## 附录

### A. 文件清单

| 文件路径 | 用途 | 状态 |
|----------|------|------|
| `scripts/capacity-analyzer.sh` | 核心容量分析脚本 | ✅ 已创建 |
| `scripts/capacity-collector.sh` | 定时数据采集脚本 | ✅ 已创建 |
| `docs/templates/capacity-report.md` | Markdown报告模板 | ✅ 已创建 |
| `api/routes/capacity.js` | RESTful API 端点 | ✅ 已创建 |
| `grafana/dashboards/capacity-planning.json` | Grafana 仪表盘 | ✅ 已创建 |
| `docs/CAPACITY_PLANNING_AUTOMATION.md` | 本设计文档 | ✅ 已创建 |
| `data/capacity/raw/*.csv` | 原始数据（运行时生成） | 🔄 自动创建 |
| `data/capacity/aggregated/hourly/*.json` | 聚合数据（运行时生成） | 🔄 自动创建 |

### B. Prometheus 查询参考

```promql
-- API P95 延迟
histogram_quantile(0.95, sum(rate(globalreach_api_request_duration_seconds_bucket[5m])))

-- 活跃连接数
globalreach_active_connections

-- 堆内存使用率
globalreach_heap_usage_percent

-- PostgreSQL 活跃连接
pg_stat_activity_count{datname=~".+"}

-- Redis 内存使用
container_memory_rss{name=~"globalreach-redis.*"}

-- 全局 QPS
sum(rate(globalreach_api_requests_total[5m]))
```

### C. Docker Compose 资源限制参考

来自 `docker-compose.prod.yml` 的关键配置：

```yaml
# API Node — 唯一设置了显式资源限制的服务
deploy:
  resources:
    limits:
      memory: 512M
      cpus: '1.0'
    reservations:
      memory: 256M

# Node.js 堆上限（通过环境变量）
environment:
  NODE_OPTIONS: --max-old-space-size=384
```

### D. 版本历史

| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|----------|
| v1.0.0 | 2026-06-09 | O04 Task | 初始版本，完整实现容量规划自动化系统 |

---

> **文档结束** — GlobalReach V2.0 容量规划自动化 v1.0.0
>
> 相关文档: [HA架构](./HIGH_AVAILABILITY_ARCHITECTURE.md) | [性能基准](./PERFORMANCE_BENCHMARK_SUITE.md) | [Prometheus Rules](../prometheus/rules/)
