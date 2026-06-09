# AIOps 智能告警降噪系统 - 设计文档

> **文档版本**: v1.0.0
> **创建日期**: 2026-06-09
> **项目**: GlobalReach V2.0 企业级邮件营销平台
> **模块**: S132/O01 AIOps 智能告警降噪
> **状态**: 设计完成

---

## 目录

1. [问题定义与量化](#1-问题定义与量化)
   - 1.1 告警风暴场景分类
   - 1.2 当前告警量估算
   - 1.3 SLA目标定义
2. [告警关联算法设计](#2-告警关联算法设计)
   - 2.1 时间窗口聚类
   - 2.2 拓扑关联分析
   - 2.3 标签相似度匹配
3. [自愈动作框架](#3-自愈动作框架)
   - 3.1 动作级别定义
   - 3.2 动作执行流程
   - 3.3 安全控制机制
4. [实现方案](#4-实现方案)
   - 4.1 系统架构
   - 4.2 核心组件说明
   - 4.3 数据流图
5. [集成点与接口规范](#5-集成点与接口规范)
6. [监控指标体系](#6-监控指标体系)
7. [部署指南](#7-部署指南)
8. [附录](#8-附录)

---

## 1. 问题定义与量化

### 1.1 告警风暴场景分类

#### 场景一：级联故障（Cascade Failure）

**描述**：单一根因故障触发多个下游组件的连锁告警反应。

**典型模式**：
```
PostgreSQL 主库宕机
  → APIDown (critical)           # API 无法连接数据库
  → HighErrorRate (critical)      # 所有请求返回 500
  → PostgresConnectionHigh (warning) # 连接池耗尽
  → APIHealthCritical (critical)  # 健康检查失败
  → EmailQueueBacklog (warning)   # 邮件队列积压
```

**特征**：
- 时间窗口内（60s）爆发式增长 >10 条告警
- 存在明确的依赖关系链（上游→下游）
- 根因告警通常最先触发，且 severity 最高
- 下游告警的 instance/labels 与根因相关联

**影响**：
- 单次级联故障可能产生 15-30 条重复/冗余告警
- 运维人员需手动过滤，MTTA 平均 12-18 分钟
- 误操作风险：在处理下游告警时忽略根因

**检测方法**：
```javascript
// 级联故障检测伪代码
function detectCascadeFailure(alertsInWindow) {
  if (alertsInWindow.length < CASCADE_THRESHOLD) return null;

  // 构建依赖图
  const dependencyGraph = buildDependencyGraph(alertsInWindow);

  // 寻找根因候选（入度为0或最小的节点）
  const rootCandidates = findRootCauses(dependencyGraph);

  // 验证时间顺序：根因应先于下游触发
  for (const candidate of rootCandidates) {
    if (isUpstreamOf(candidate, alertsInWindow)) {
      return {
        type: 'cascade_failure',
        rootCause: candidate,
        affectedCount: countDownstream(candidate, dependencyGraph),
        propagationPath: tracePropagationPath(candidate, dependencyGraph),
      };
    }
  }

  return null;
}
 ```

#### 场景二：周期性抖动（Flapping Alerts）

**描述**：同一告警在短时间内反复触发和恢复，形成"抖动"现象。

**典型场景**：
- CPU 使用率在阈值边缘波动（89% → 91% → 88% → 92%）
- 内存压力因 GC 导致短暂释放后再次上升
- 网络延迟因瞬时拥塞产生脉冲式超时

**特征**：
- 同一 fingerprint 的告警在 5 分钟内状态切换 ≥3 次
- 触发间隔不规则（非周期性）
- 通常伴随资源使用率接近阈值的情况

**影响**：
- 运维人员收到大量"已恢复"+"新触发"通知
- 造成"狼来了"效应，降低对真实告警的关注度
- AlertManager 的 group_interval 机制无法有效抑制

**检测方法**：
```javascript
// 抖动检测算法
function detectFlapping(alertHistory, windowMs = 300000) {
  const recentAlerts = alertHistory.filter(
    a => Date.now() - a.timestamp < windowMs
  );

  if (recentAlerts.length < FLAPPING_MIN_TRANSITIONS) return false;

  let transitions = 0;
  let lastStatus = recentAlerts[0].status;

  for (let i = 1; i < recentAlerts.length; i++) {
    if (recentAlerts[i].status !== lastStatus) {
      transitions++;
      lastStatus = recentAlerts[i].status;
    }
  }

  return transitions >= FLAPPING_THRESHOLD; // 默认 3 次
}
```

**处理策略**：
1. **静默期强制**：检测到抖动后，进入 15 分钟静默期
2. **聚合通知**：将多次抖动合并为一条摘要："APIHealthDegraded 在过去 5 分钟内抖动 5 次"
3. **自动降级**：将 critical 降级为 warning，避免频繁打扰

#### 场景三：维护窗口误报（Maintenance Window False Positives）

**描述**：计划内维护操作期间触发的预期性告警。

**典型场景**：
- 数据库升级期间连接数飙升
- 容器重启导致的短暂服务不可用
- 配置热更新引起的 metrics 采集中断

**特征**：
- 告警时间与维护窗口重叠
- 告警类型属于已知维护影响的范围
- 维护结束后告警自动消失

**影响**：
- 夜间维护触发凌晨告警电话/短信
- 占用运维人员注意力，干扰真实问题处理
- 生成无用的工单和事件记录

**解决方案**：
```yaml
# 维护窗口配置示例
maintenance_windows:
  - name: "weekly-db-backup"
    schedule: "0 2 * * 0"  # 每周日凌晨 2 点
    duration: "2h"
    affected_services:
      - postgresql
      - globalreach-api
    expected_alerts:
      - PostgresConnectionHigh
      - APIDown
      - APIHealthCritical
    action: suppress_and_log

  - name: "container-rolling-update"
    schedule: "manual"  # 手动触发
    duration: "30m"
    affected_services:
      - globalreach-api
    action: auto_acknowledge
```

#### 场景四：容量阈值临界振荡（Threshold Oscillation）

**描述**：系统负载接近容量上限时，metrics 在阈值附近小幅波动。

**典型场景**：
- Redis 内存使用率在 84%-86% 之间振荡（阈值 85%）
- 磁盘空间在 14%-16% 之间徘徊（阈值 15%）
- 数据库连接池在 78-82 个连接间波动（阈值 80）

**特征**：
- 告警值始终在阈值 ±5% 范围内振荡
- 无明显的上升趋势或下降趋势
- 可能持续数小时甚至数天

**影响**：
- 持续不断的 warning 级别告警
- 告警疲劳（alert fatigue）
- 掩盖真实的容量规划需求

**处理策略**：
1. **迟滞带（Hysteresis Band）**：
   ```
   正常 → 告警: threshold = 85%
   告警 → 恢复: threshold = 75%  （降低 10%）
   ```
2. **趋势分析**：仅当连续 N 次采样均超过阈值才触发
3. **容量预警**：当振荡持续时间 >1h 时，自动生成容量扩容建议

#### 场景五：批量部署变更引发（Deployment-Induced Storms）

**描述**：CI/CD 流水线发布新版本时，多服务同时变更引发的告警潮。

**典型场景**：
- Kubernetes rolling update 同时重启多个 Pod
- Docker Compose up --build 重建所有容器
- 配置中心推送更新导致全集群重载

**特征**：
- 告警集中在部署时间窗口内（通常 5-15 分钟）
- 涉及多个服务/组件
- 大部分告警在部署完成后自动恢复
- 可通过 GitHub webhook / CI 事件关联

**影响**：
- 每次发布产生 20-50 条告警
- 发布验证阶段难以区分真实问题和预期行为
- 回滚决策受噪音干扰

**集成方案**：
```javascript
// 与 GitHub Webhook 集成
async function onDeploymentEvent(event) {
  if (event.type === 'deployment') {
    // 创建维护窗口
    await createMaintenanceWindow({
      source: 'deployment',
      deploymentId: event.deployment.id,
      environment: event.environment,
      startTime: new Date(),
      duration: DEPLOYMENT_WINDOW_MS, // 15 分钟
      expectedServices: event.services,
    });

    // 记录基线指标
    await captureBaselineMetrics(event.services);
  }
}
```

### 1.2 当前告警量估算

#### 现有告警规则清单

| 文件 | 规则组 | 规则数量 | Severity 分布 |
|------|--------|----------|---------------|
| `prometheus/rules/alerts.yml` | globalreach-critical | 4 | 4× critical |
| `prometheus/rules/alerts.yml` | globalreach-warning | 6 | 6× warning |
| `prometheus/rules/alerts.yml` | globalreach-api-specific | 4 | 4× warning |
| `prometheus/rules/business-alerts.yml` | business-alerts | 8 | 混合 |
| `prometheus/rules/loki-metrics-alerts.yml` | loki-metrics | 8 | 混合 |
| `prometheus/rules/performance-alerts.yml` | performance-alerts | S132新增 | 混合 |
| `loki/rules/alert-rules.yml` | loki-ruler | 10 | 混合 |
| **合计** | - | **~40+** | - |

#### 潜在触发频率估算（正常运营状态）

| 告警规则 | 评估频率 | 日均触发次数（估计） | 备注 |
|---------|---------|---------------------|------|
| APIDown | 30s | 0-0.5 | 极少发生 |
| HighErrorRate | 30s | 0-2 | 偶发 |
| ContainerRestartLoop | 30s | 0-0.2 | 罕见 |
| APIHealthCritical | 30s | 0-1 | 偶发 |
| HighLatencyP95 | 60s | 1-5 | 高峰期常见 |
| PostgresConnectionHigh | 60s | 0-3 | 业务高峰期 |
| RedisMemoryHigh | 60s | 0-2 | 缓存密集型业务 |
| NodeFileSystemFull | 60s | 0-0.5 | 日志轮转时 |
| NodeHighMemory | 60s | 2-6 | 长时间运行后 |
| NodeHighCPU | 60s | 1-4 | 发送任务高峰 |
| APIHealthDegraded | 30s | 3-8 | 轻微性能下降 |
| APILatencyP50Elevated | 30s | 2-5 | 用户感知延迟 |
| APIMemoryPressure | 30s | 1-4 | V8 heap 压力 |
| APIThroughputAnomaly | 30s | 0-2 | 流量突降 |
| **日均总计** | - | **10-45 条** | 正常状态 |

#### 故障场景下的告警爆炸

| 故障类型 | 级联深度 | 5分钟内告警数 | 降噪前 MTTA | 降噪后目标 MTTA |
|---------|---------|--------------|------------|--------------|
| PostgreSQL 宕机 | 3 层 | 15-25 条 | 15-20 min | <5 min |
| Redis 故障 | 2 层 | 8-12 条 | 10-15 min | <5 min |
| 磁盘满 | 2 层 | 6-10 条 | 8-12 min | <5 min |
| 网络分区 | 4 层 | 20-35 条 | 20-30 min | <8 min |
| DDoS 攻击 | 2 层 | 25-40 条 | 10-15 min | <5 min |

### 1.3 SLA 目标定义

#### 核心指标

| 指标名称 | 定义 | 当前值 | 目标值 | 测量方式 |
|---------|------|--------|--------|---------|
| **告警降噪率** | (原始告警数 - 通知给运维的告警数) / 原始告警数 | ~0% | **>70%** | Prometheus counter |
| **MTTA** | Mean Time To Acknowledge（平均确认时间） | 12-18 min | **<5 min** | 从告警创建到人工确认的时间差 |
| **MTTR** | Mean Time To Resolution（平均解决时间） | 30-60 min | **<20 min** | 从告警创建到问题解决的时间差 |
| **误报率** | 错误标记为告警的事件 / 总告警事件 | ~15% | **<5%** | 人工审核抽样 |
| **漏报率** | 未被检测到的真实故障 / 总真实故障 | ~5% | **<2%** | 故障复盘统计 |
| **自愈成功率** | 自动修复成功次数 / 自愈动作总次数 | 0% | **>80%** (L1/L2) | 动作执行日志 |

#### 分级 SLA

| 告警级别 | 响应时间要求 | 解决时间要求 | 通知渠道 | 自愈策略 |
|---------|-------------|-------------|---------|---------|
| P0-Critical | <2 分钟 | <15 分钟 | 电话+短信+IM | L1 信息收集 + L2 尝试重启 |
| P1-High | <5 分钟 | <30 分钟 | IM+邮件 | L1 信息收集 |
| P2-Medium | <15 分钟 | <2 小时 | 邮件 | 仅记录，不自动处理 |
| P3-Low | <1 小时 | <24 小时 | 邮件汇总 | 不处理 |

#### 降噪效果验证方案

```javascript
// A/B 测试框架
class DeduplicationABTest {
  constructor() {
    this.controlGroup = [];   // 对照组：原始告警流
    this.treatmentGroup = []; // 实验组：经过降噪处理的告警流
    this.metrics = {
      totalAlerts: { control: 0, treatment: 0 },
      notificationsSent: { control: 0, treatment: 0 },
      mttas: { control: [], treatment: [] },
      mttrs: { control: [], treatment: [] },
    };
  }

  // 随机分流（50/50）
  routeAlert(alert) {
    if (Math.random() < 0.5) {
      this.metrics.totalAlerts.control++;
      this.controlGroup.push(alert);
      return { group: 'control', action: 'notify' };
    } else {
      this.metrics.totalAlerts.treatment++;
      const result = this.correlateAndDeduplicate(alert);
      this.treatmentGroup.push(result);
      return result.action === 'suppress'
        ? { group: 'treatment', action: 'suppress' }
        : { group: 'treatment', action: 'notify' };
    }
  }

  // 计算统计显著性
  getResults() {
    const reductionRate =
      1 - (this.metrics.notificationsSent.treatment /
           this.metrics.notificationsSent.control);

    return {
      sampleSize: this.metrics.totalAlerts,
      reductionRate: `${(reductionRate * 100).toFixed(1)}%`,
      mttImprovement: calculateMTTAIMprovement(this.metrics.mttas),
      isStatisticallySignificant: performTTest(this.metrics),
    };
  }
}
```

---

## 2. 告警关联算法设计

### 2.1 时间窗口聚类（Temporal Clustering）

#### 2.1.1 三级滑动窗口架构

```
┌─────────────────────────────────────────────────────────────┐
│                    时间窗口层级                              │
├──────────┬──────────┬──────────────────────────────────────┤
│  Level 1 │  Level 2 │              Level 3                 │
│   60s    │   300s   │             900s                     │
│ ─────── │ ──────── │ ─────────────────────────            │
│ ◄─────► │ ◄──────► │ ◄─────────────────────────────────► │
│         │          │                                      │
│ 用途:    │ 用途:     │ 用途:                                │
│ • 实时   │ • 短期   │ • 长期                               │
│   检测   │   关联   │   趋势                                │
│ • 告警   │ • 聚类   │ • 容量                                │
│   风暴   │   合并   │   规划                                │
│         │          │                                      │
│ 输出:    │ 输出:     │ 输出:                                │
│ • storm  │ • cluster│ • trend                              │
│   flag   │   _id    │   _analysis                          │
│         │          │                                      │
└──────────┴──────────┴──────────────────────────────────────┘
```

#### 2.1.2 滑动窗口数据结构

```javascript
/**
 * SlidingWindowManager - 多级滑动窗口管理器
 *
 * 核心思想：
 * - 使用 Map 存储 active alerts，key 为 fingerprint
 * - 定期清理过期条目（基于 TTL）
 * - 支持三级窗口粒度：60s / 300s / 900s
 */
class SlidingWindowManager {
  constructor(config = {}) {
    // 三级窗口配置
    this.windows = {
      L1: { size: 60000,   alerts: new Map(), label: 'realtime' },  // 60s
      L2: { size: 300000,  alerts: new Map(), label: 'short_term' }, // 5min
      L3: { size: 900000,  alerts: new Map(), label: 'long_term' },  // 15min
    };

    // 清理定时器（每 30 秒运行一次）
    this.cleanupInterval = setInterval(
      () => this.cleanupExpired(),
      30000
    );
  }

  /**
   * 添加告警到所有活跃窗口
   * @param {object} alert - 标准化后的告警对象
   * @returns {object} 窗口状态快照
   */
  addAlert(alert) {
    const now = Date.now();
    const fingerprint = alert.fingerprint;
    const result = {};

    for (const [level, window] of Object.entries(this.windows)) {
      // 更新或插入
      window.alerts.set(fingerprint, {
        ...alert,
        windowEntryTime: now,
        lastSeen: now,
        occurrenceCount: (window.alerts.get(fingerprint)?.occurrenceCount || 0) + 1,
      });

      // 统计当前窗口内的告警数
      result[level] = {
        totalInWindow: this.getActiveCount(level),
        isNew: !window.alerts.has(fingerprint), // 是否是新告警
      };
    }

    return result;
  }

  /**
   * 获取指定窗口内的活跃告警列表
   * @param {string} level - 'L1' | 'L2' | 'L3'
   * @returns {Array} 告警数组（按时间排序）
   */
  getAlertsInWindow(level) {
    const window = this.windows[level];
    if (!window) return [];

    const now = Date.now();
    const alerts = [];

    for (const [, alert] of window.alerts) {
      if (now - alert.windowEntryTime <= window.size) {
        alerts.push(alert);
      }
    }

    // 按时间升序排列
    return alerts.sort((a, b) => a.startsAt - b.startsAt);
  }

  /**
   * 清理过期条目
   */
  cleanupExpired() {
    const now = Date.now();

    for (const [level, window] of Object.entries(this.windows)) {
      for (const [fingerprint, alert] of window.alerts) {
        if (now - alert.lastSeen > window.size * 2) { // 2倍窗口大小作为过期阈值
          window.alerts.delete(fingerprint);
        }
      }
    }
  }

  /**
   * 检测告警风暴
   * @returns {boolean} 是否处于风暴状态
   */
  isStormActive() {
    const l1Count = this.getActiveCount('L1');
    return l1Count >= STORM_THRESHOLD; // 默认 10 条/分钟
  }

  /**
   * 获取窗口内活跃告警数
   */
  getActiveCount(level) {
    const window = this.windows[level];
    if (!window) return 0;

    const now = Date.now();
    let count = 0;

    for (const [, alert] of window.alerts) {
      if (now - alert.windowEntryTime <= window.size) {
        count++;
      }
    }

    return count;
  }
}
```

#### 2.1.3 告警指纹生成算法

```javascript
/**
 * AlertFingerprintGenerator - 告警指纹生成器
 *
 * 设计原则：
 * - 相同的问题应该产生相同的指纹
 * - 不同实例的同类型告警应有不同指纹
 * - 指纹应具有确定性和可重现性
 */
class AlertFingerprintGenerator {
  /**
   * 生成标准化的告警指纹
   * @param {object} alert - AlertManager 格式的告警对象
   * @returns {string} 16 字符的十六进制指纹
   */
  generate(alert) {
    // 提取关键标识字段（按重要性排序）
    const keyFields = [
      alert.labels?.alertname,           // 告警名称（最重要）
      alert.labels?.instance,             // 实例标识
      alert.labels?.job,                  // 任务名称
      alert.labels?.severity,             // 严重程度
      this.normalizeValue(alert.labels?.team), // 团队标签
    ].filter(Boolean).join('|');

    // 使用 SHA-256 截断为 16 字符
    return crypto.createHash('sha256')
      .update(keyFields)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * 生成用于聚类的粗粒度指纹（忽略 instance 差异）
   * 用于识别跨实例的同源告警
   */
  generateClusterFingerprint(alert) {
    const keyFields = [
      alert.labels?.alertname,
      alert.labels?.job,
      alert.labels?.team,
      this.extractPattern(alert.annotations?.description),
    ].filter(Boolean).join('|');

    return crypto.createHash('sha256')
      .update(keyFields)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * 标准化值（去除空格、转小写）
   */
  normalizeValue(value) {
    if (!value) return '';
    return String(value).toLowerCase().trim();
  }

  /**
   * 从描述中提取模式特征（如错误码、异常类型等）
   */
  extractPattern(description) {
    if (!description) return '';

    // 提取常见的错误模式
    const patterns = [
      /ECONNREFUSED/gi,
      /ETIMEDOUT/gi,
      /connection refused/gi,
      /out of memory/gi,
      /heap out of memory/gi,
    ];

    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match) return match[0].toLowerCase();
    }

    return '';
  }
}
```

#### 2.1.4 聚合策略

```javascript
/**
 * AlertAggregator - 告警聚合策略引擎
 *
 * 支持三种聚合模式：
 * 1. max_severity - 取最高严重程度
 * 2. latest - 取最新的一条告警信息
 * 3. count - 仅保留计数信息
 */
class AlertAggregator {
  /**
   * 对一组相关告警进行聚合
   * @param {Array} alerts - 待聚合的告警数组
   * @param {string} strategy - 聚合策略
   * @returns {object} 聚合结果
   */
  aggregate(alerts, strategy = 'max_severity') {
    if (!alerts || alerts.length === 0) {
      return null;
    }

    switch (strategy) {
      case 'max_severity':
        return this.aggregateByMaxSeverity(alerts);
      case 'latest':
        return this.aggregateByLatest(alerts);
      case 'count':
        return this.aggregateByCount(alerts);
      default:
        throw new Error(`Unknown aggregation strategy: ${strategy}`);
    }
  }

  /**
   * 按 max_severity 聚合
   * 选择 severity 最高的告警作为代表，附加其他告警的摘要
   */
  aggregateByMaxSeverity(alerts) {
    const severityOrder = { critical: 4, warning: 3, info: 2, unknown: 1 };

    // 找到最高级别的告警
    const representative = alerts.reduce((prev, current) => {
      const prevScore = severityOrder[prev.severity] || 0;
      const currScore = severityOrder[current.severity] || 0;
      return currScore > prevScore ? current : prev;
    });

    return {
      ...representative,
      clusterId: this.generateClusterId(alerts),
      clusterSize: alerts.length,
      clusterMembers: alerts.map(a => ({
        fingerprint: a.fingerprint,
        alertName: a.alertName,
        severity: a.severity,
        timestamp: a.startsAt,
      })),
      aggregationStrategy: 'max_severity',
      aggregatedAt: new Date(),
    };
  }

  /**
   * 按 latest 聚合
   * 选择最新触发的告警作为代表
   */
  aggregateByLatest(alerts) {
    const sorted = [...alerts].sort(
      (a, b) => new Date(b.startsAt) - new Date(a.startsAt)
    );
    const representative = sorted[0];

    return {
      ...representative,
      clusterId: this.generateClusterId(alerts),
      clusterSize: alerts.length,
      aggregationStrategy: 'latest',
      aggregatedAt: new Date(),
    };
  }

  /**
   * 按 count 聚合
   * 仅保留计数信息，用于高基数场景
   */
  aggregateByCount(alerts) {
    // 按 alertName 分组计数
    const counts = {};
    for (const alert of alerts) {
      const name = alert.alertName || 'unnamed';
      counts[name] = (counts[name] || 0) + 1;
    }

    return {
      clusterId: this.generateClusterId(alerts),
      clusterSize: alerts.length,
      breakdown: counts,
      firstSeen: alerts[0]?.startsAt,
      lastSeen: alerts[alerts.length - 1]?.startsAt,
      aggregationStrategy: 'count',
      aggregatedAt: new Date(),
    };
  }

  /**
   * 生成集群唯一 ID
   */
  generateClusterId(alerts) {
    const fingerprints = alerts.map(a => a.fingerprint).sort();
    const combined = fingerprints.join(',');
    return crypto.createHash('md5').update(combined).digest('hex').substring(0, 12);
  }
}
```

### 2.2 拓扑关联分析（Topological Correlation）

#### 2.2.1 服务依赖图构建

基于 GlobalReach V2.0 的 Docker Compose 服务定义，构建静态拓扑：

```javascript
/**
 * ServiceTopologyGraph - 服务依赖图
 *
 * 基于 docker-compose.yml 定义的依赖关系：
 *
 *   nginx (反向代理)
 *     ↓ depends_on
 *   api (GlobalReach API)
 *     ↓ connects to
 *   ├── postgresql (主数据库)
 *   ├── redis (缓存 + 队列)
 *   └── prometheus (监控采集)
 *
 * 拓扑层级：
 *   Layer 0: Infrastructure (PostgreSQL, Redis, Node Exporter)
 *   Layer 1: Platform Services (API, Worker)
 *   Layer 2: Gateway (Nginx, Load Balancer)
 *   Layer 3: External (SMTP providers, CDN)
 */
class ServiceTopologyGraph {
  constructor() {
    // 邻接表表示的有向图
    this.graph = new Map();

    // 初始化 GlobalReach 拓扑
    this.initializeGlobalReachTopology();
  }

  /**
   * 初始化 GlobalReach V2.0 的服务依赖关系
   */
  initializeGlobalReachTopology() {
    // 定义节点（服务）
    const services = [
      { id: 'postgresql', layer: 0, type: 'database', team: 'database' },
      { id: 'redis', layer: 0, type: 'cache', team: 'database' },
      { id: 'node-exporter', layer: 0, type: 'monitoring', team: 'infra' },
      { id: 'globalreach-api', layer: 1, type: 'application', team: 'platform' },
      { id: 'send-worker', layer: 1, type: 'worker', team: 'platform' },
      { id: 'nginx', layer: 2, type: 'gateway', team: 'infra' },
      { id: 'prometheus', layer: 0, type: 'monitoring', team: 'infra' },
      { id: 'alertmanager', layer: 0, type: 'monitoring', team: 'infra' },
      { id: 'grafana', layer: 0, type: 'visualization', team: 'infra' },
      { id: 'loki', layer: 0, type: 'logging', team: 'infra' },
    ];

    // 注册节点
    for (const service of services) {
      this.graph.set(service.id, {
        ...service,
        upstream: [],   // 上游依赖（被谁依赖）
        downstream: [], // 下游依赖（依赖谁）
      });
    }

    // 定义边（依赖关系）— 方向：upstream → downstream
    const edges = [
      // API 依赖底层服务
      ['postgresql', 'globalreach-api'],
      ['redis', 'globalreach-api'],
      ['redis', 'send-worker'],

      // Nginx 依赖 API
      ['globalreach-api', 'nginx'],

      // 监控栈
      ['globalreach-api', 'prometheus'],  // Prometheus 采集 API 指标
      ['node-exporter', 'prometheus'],
      ['prometheus', 'alertmanager'],
      ['alertmanager', 'globalreach-api'],  // Webhook 回调
    ];

    // 构建邻接表
    for (const [upstream, downstream] of edges) {
      if (this.graph.has(upstream) && this.graph.has(downstream)) {
        this.graph.get(upstream).downstream.push(downstream);
        this.graph.get(downstream).upstream.push(upstream);
      }
    }
  }

  /**
   * 获取服务的直接上游依赖
   * @param {string} serviceId - 服务标识
   * @returns {Array} 上游服务列表
   */
  getUpstream(serviceId) {
    const node = this.graph.get(serviceId);
    return node ? node.upstream : [];
  }

  /**
   * 获取服务的直接下游依赖
   * @param {string} serviceId - 服务标识
   * @returns {Array} 下游服务列表
   */
  getDownstream(serviceId) {
    const node = this.graph.get(serviceId);
    return node ? node.downstream : [];
  }

  /**
   * BFS 查找从 source 到 target 的传播路径
   * @param {string} source - 起始服务
   * @param {string} target - 目标服务
   * @returns {Array|null} 路径数组，null 表示不可达
   */
  findPropagationPath(source, target) {
    if (source === target) return [source];

    const visited = new Set();
    const queue = [[source]];

    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];

      if (current === target) return path;

      if (!visited.has(current)) {
        visited.add(current);

        const neighbors = this.getDownstream(current) || [];
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push([...path, neighbor]);
          }
        }
      }
    }

    return null; // 不可达
  }

  /**
   * 获取完整的影响范围（所有下游服务）
   * @param {string} serviceId - 故障起始服务
   * @param {number} maxDepth - 最大搜索深度
   * @returns {Set} 受影响的服务集合
   */
  getBlastRadius(serviceId, maxDepth = 5) {
    const affected = new Set();
    const queue = [{ service: serviceId, depth: 0 }];

    while (queue.length > 0) {
      const { service, depth } = queue.shift();

      if (depth > maxDepth) continue;

      const downstream = this.getDownstream(service) || [];
      for (const dep of downstream) {
        if (!affected.has(dep)) {
          affected.add(dep);
          queue.push({ service: dep, depth: depth + 1 });
        }
      }
    }

    return affected;
  }
}
```

#### 2.2.2 根因评分算法

```javascript
/**
 * RootCauseScorer - 根因候选评分引擎
 *
 * 评分维度：
 * 1. Topology Score (拓扑位置分): 上游服务得分更高
 * 2. Freshness Score (新鲜度分): 先触发的告警得分更高
 * 3. Severity Score (严重度分): critical > warning > info
 * 4. Frequency Score (频率分): 高频告警可能是症状而非根因
 * 5. Historical Score (历史分): 历史上经常是根因的服务加分
 */
class RootCauseScorer {
  constructor(topologyGraph) {
    this.topology = topologyGraph;
    this.historyDB = new Map(); // 历史根因记录

    // 权重配置
    this.weights = {
      topology: 0.35,    // 拓扑权重（最重要）
      freshness: 0.25,   // 新鲜度权重
      severity: 0.20,    // 严重度权重
      frequency: -0.10,  // 频率负权重（高频=可能是症状）
      history: 0.10,     // 历史权重
    };

    // 严重度映射
    this.severityMap = {
      critical: 1.0,
      warning: 0.6,
      info: 0.3,
      unknown: 0.1,
    };
  }

  /**
   * 对一组告警进行根因评分
   * @param {Array} alerts - 同一时间窗口内的告警集合
   * @returns {Array} 按分数排序的候选列表
   */
  scoreCandidates(alerts) {
    const candidates = alerts.map(alert => ({
      alert,
      scores: {},
      totalScore: 0,
    }));

    // 计算各维度得分
    for (const candidate of candidate ) {
      candidate.scores.topology = this.calcTopologyScore(candidate.alert);
      candidate.scores.freshness = this.calcFreshnessScore(candidate.alert, alerts);
      candidate.scores.severity = this.calcSeverityScore(candidate.alert);
      candidate.scores.frequency = this.calcFrequencyScore(candidate.alert);
      candidate.scores.history = this.calcHistoryScore(candidate.alert);

      // 加权求和
      candidate.totalScore =
        this.weights.topology * candidate.scores.topology +
        this.weights.freshness * candidate.scores.freshness +
        this.weights.severity * candidate.scores.severity +
        this.weights.frequency * candidate.scores.frequency +
        this.weights.history * candidate.scores.history;
    }

    // 按总分降序排列
    return candidates.sort((a, b) => b.totalScore - a.totalScore);
  }

  /**
   * 计算拓扑得分
   * 上游服务（入度高、出度低）得分更高
   */
  calcTopologyScore(alert) {
    const instance = alert.instance || alert.labels?.instance;
    if (!instance) return 0.5; // 无法判断时给中间分

    // 将 instance 映射到服务名
    const serviceName = this.mapInstanceToService(instance);
    if (!serviceName) return 0.5;

    const node = this.topology.graph.get(serviceName);
    if (!node) return 0.5;

    // 入度（被多少服务依赖）越高，越可能是根因
    const inDegree = node.upstream.length;
    const outDegree = node.downstream.length;

    // 归一化到 [0, 1]
    // 理想根因：高入度（很多服务依赖它）、低出度（它不依赖别人）
    const topologyScore = Math.min(1, inDegree / Math.max(1, inDegree + outDegree));

    // 层级加成：Layer 0 (基础设施) 比 Layer 2 (网关) 更可能是根因
    const layerBonus = (3 - node.layer) * 0.1;

    return Math.min(1, topologyScore + layerBonus);
  }

  /**
   * 计算新鲜度得分
   * 先触发的告警更可能是根因
   */
  calcFreshnessScore(targetAlert, allAlerts) {
    const targetTime = new Date(targetAlert.startsAt || targetAlert.receivedAt).getTime();

    // 找到最早和最晚的告警时间
    const times = allAlerts.map(a =>
      new Date(a.startsAt || a.receivedAt).getTime()
    );
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const timeRange = maxTime - minTime || 1;

    // 归一化：越早触发得分越高
    const normalizedTime = (targetTime - minTime) / timeRange;
    return 1 - normalizedTime; // 反转：早=高分
  }

  /**
   * 计算严重度得分
   */
  calcSeverityScore(alert) {
    const severity = alert.severity || alert.labels?.severity || 'unknown';
    return this.severityMap[severity] || 0.1;
  }

  /**
   * 计算频率得分（负向）
   * 高频告警可能是症状而非根因
   */
  calcFrequencyScore(alert) {
    const fingerprint = alert.fingerprint;
    if (!fingerprint) return 0;

    // 查询该指纹在过去 1 小时的出现次数
    const recentCount = this.getRecentOccurrenceCount(fingerprint, 3600000);

    // 出现超过 5 次则认为是高频（可能是症状）
    if (recentCount > 5) return -0.5;
    if (recentCount > 2) return -0.2;
    return 0;
  }

  /**
   * 计算历史得分
   * 如果历史上该服务经常是根因，加分
   */
  calcHistoryScore(alert) {
    const serviceName = this.mapInstanceToService(
      alert.instance || alert.labels?.instance
    );
    if (!serviceName) return 0;

    // 查询历史记录
    const history = this.historyDB.get(serviceName);
    if (!history) return 0;

    // 历史根因占比
    const rootCauseRatio = history.rootCauseCount / Math.max(1, history.totalIncidents);

    // 衰减因子：最近的历史更重要
    const recencyBonus = Math.exp(-history.daysSinceLastIncident / 30);

    return rootCauseRatio * recencyBonus;
  }

  /**
   * 将 instance 名称映射到服务名
   */
  mapInstanceToService(instance) {
    if (!instance) return null;

    const mapping = {
      'globalreach-api': 'globalreach-api',
      'api': 'globalreach-api',
      'postgres': 'postgresql',
      'postgresql': 'postgresql',
      'db': 'postgresql',
      'redis': 'redis',
      'nginx': 'nginx',
      'node-exporter': 'node-exporter',
    };

    // 精确匹配
    if (mapping[instance]) return mapping[instance];

    // 模糊匹配
    for (const [pattern, service] of Object.entries(mapping)) {
      if (instance.includes(pattern)) return service;
    }

    return null;
  }
}
```

### 2.3 标签相似度匹配（Label Similarity Matching）

#### 2.3.1 Jaccard 相似度计算

```javascript
/**
 * LabelSimilarityMatcher - 基于标签相似度的告警匹配器
 *
 * 使用 Jaccard 相似系数衡量两组标签的重叠程度：
 *
 * J(A, B) = |A ∩ B| / |A ∪ B|
 *
 * 应用场景：
 * - 识别来自同一根源但不同表现形式的告警
 * - 发现隐含的关联关系（非显式依赖）
 * - 处理标签命名不一致的情况
 */
class LabelSimilarityMatcher {
  constructor(config = {}) {
    // 相似度阈值（学习期 vs 稳定期）
    this.thresholds = {
      learning: 0.3,   // 学习期：宽松匹配
      stable: 0.5,     // 稳定期：严格匹配
      strict: 0.7,     // 严格模式：高度确信
    };

    // 当前阶段
    this.phase = config.phase || 'learning'; // learning | stable | strict

    // 学习期样本收集
    this.learningSamples = [];
    this.learningStartTime = Date.now();
    this.LEARNING_DURATION_MS = 7 * 24 * 3600 * 1000; // 7 天学习期

    // 标签权重（某些标签更重要）
    this.labelWeights = {
      alertname: 2.0,    // 告警名称最重要
      instance: 1.5,     // 实例次之
      job: 1.2,          // 任务名
      severity: 0.8,     // 严重度
      team: 1.0,         // 团队
    };
  }

  /**
   * 计算 Jaccard 相似度
   * @param {Set} setA - 第一组标签
   * @param {Set} setB - 第二组标签
   * @returns {number} 相似度 [0, 1]
   */
  jaccardSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;
    if (setA.size === 0 || setB.size === 0) return 0;

    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    return intersection.size / union.size;
  }

  /**
   * 加权 Jaccard 相似度（考虑标签重要性差异）
   * @param {object} labelsA - 告警 A 的标签对象
   * @param {object} labelsB - 告警 B 的标签对象
   * @returns {number} 加权相似度 [0, 1]
   */
  weightedJaccardSimilarity(labelsA, labelsB) {
    const keysA = new Set(Object.keys(labelsA));
    const keysB = new Set(Object.keys(labelsB));

    let weightedIntersection = 0;
    let weightedUnion = 0;

    // 计算加权交集
    for (const key of keysA) {
      if (keysB.has(key) && labelsA[key] === labelsB[key]) {
        weightedIntersection += this.labelWeights[key] || 1.0;
      }
    }

    // 计算加权并集
    const allKeys = new Set([...keysA, ...keysB]);
    for (const key of allKeys) {
      weightedUnion += this.labelWeights[key] || 1.0;
    }

    return weightedUnion > 0 ? weightedIntersection / weightedUnion : 0;
  }

  /**
   * 查找相似告警
   * @param {object} targetAlert - 目标告警
   * @param {Array} candidateAlerts - 候选告警池
   * @returns {Array} 匹配结果列表（按相似度降序）
   */
  findSimilarAlerts(targetAlert, candidateAlerts) {
    const targetLabels = this.extractLabelSet(targetAlert);
    const threshold = this.getCurrentThreshold();

    const matches = [];

    for (const candidate of candidateAlerts) {
      if (candidate.fingerprint === targetAlert.fingerprint) {
        continue; // 跳过自身
      }

      const candidateLabels = this.extractLabelSet(candidate);
      const similarity = this.jaccardSimilarity(targetLabels, candidateLabels);

      if (similarity >= threshold) {
        matches.push({
          candidate,
          similarity,
          matchedLabels: this.findMatchedLabels(targetLabels, candidateLabels),
        });
      }
    }

    // 按相似度降序排列
    return matches.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * 从告警对象提取标签集合
   */
  extractLabelSet(alert) {
    const labels = alert.labels || {};
    return new Set(
      Object.entries(labels)
        .map(([k, v]) => `${k}=${v}`)
        .filter(Boolean)
    );
  }

  /**
   * 获取当前阶段的阈值
   */
  getCurrentThreshold() {
    // 检查是否还在学习期
    if (this.phase === 'learning') {
      const elapsed = Date.now() - this.learningStartTime;
      if (elapsed >= this.LEARNING_DURATION_MS) {
        this.phase = 'stable';
        console.log('[LabelMatcher] Learning phase complete, switching to stable mode');
      }
    }

    return this.thresholds[this.phase] || this.thresholds.stable;
  }

  /**
   * 动态调整阈值（基于反馈信号）
   * @param {object} feedback - 反馈数据 {truePositives, falsePositives, falseNegatives}
   */
  adjustThreshold(feedback) {
    const precision = feedback.truePositives /
      (feedback.truePositives + feedback.falsePositives || 1);
    const recall = feedback.truePositives /
      (feedback.truePositives + feedback.falseNegatives || 1);

    const f1 = 2 * (precision * recall) / (precision + recall || 1);

    // F1 过低则放宽阈值，过高则收紧
    if (f1 < 0.6) {
      this.thresholds.stable = Math.max(0.3, this.thresholds.stable - 0.05);
    } else if (f1 > 0.9) {
      this.thresholds.stable = Math.min(0.8, this.thresholds.stable + 0.02);
    }

    console.log(`[LabelMatcher] Threshold adjusted to ${this.thresholds.stable.toFixed(2)} (F1=${f1.toFixed(2)})`);
  }
}
```

#### 2.3.2 阈值动态调整策略

```javascript
/**
 * AdaptiveThresholdManager - 自适应阈值管理器
 *
 * 核心思想：
 * - 系统启动初期（learning phase）使用宽松阈值以收集更多关联
 * - 随着样本积累，逐步收紧阈值减少误报
 * - 引入反馈回路，根据运维人员的确认/否定动态优化
 */
class AdaptiveThresholdManager {
  constructor() {
    this.state = {
      phase: 'learning',       // learning → stable → optimized
      samplesCollected: 0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      lastAdjustment: Date.now(),
    };

    // 各阶段的参数配置
    this.phaseConfig = {
      learning: {
        duration: 7 * 24 * 3600 * 1000,  // 7 天
        jaccardThreshold: 0.3,
        stormThreshold: 15,               // 告警风暴阈值
        correlationConfidence: 0.4,       // 关联置信度门槛
      },
      stable: {
        duration: 30 * 24 * 3600 * 1000, // 30 天
        jaccardThreshold: 0.5,
        stormThreshold: 10,
        correlationConfidence: 0.65,
      },
      optimized: {
        duration: Infinity,
        jaccardThreshold: 0.55,
        stormThreshold: 8,
        correlationConfidence: 0.75,
      },
    };
  }

  /**
   * 记录一次关联结果的反馈
   * @param {boolean} isCorrect - 关联是否正确
   * @param {string} feedbackType - 'confirm' | 'deny' | 'correct_root_cause'
   */
  recordFeedback(isCorrect, feedbackType = 'confirm') {
    this.state.samplesCollected++;

    if (isCorrect) {
      if (feedbackType === 'correct_root_cause') {
        this.state.truePositives += 2; // 根因正确双倍奖励
      } else {
        this.state.truePositives++;
      }
    } else {
      if (feedbackType === 'false_positive') {
        this.state.falsePositives++;
      } else {
        this.state.falseNegatives++;
      }
    }

    // 每 100 个样本尝试调整一次
    if (this.state.samplesCollected % 100 === 0) {
      this.adjustParameters();
    }

    // 检查是否需要切换阶段
    this.checkPhaseTransition();
  }

  /**
   * 调整模型参数
   */
  adjustParameters() {
    const config = this.getCurrentConfig();
    const precision = this.state.truePositives /
      (this.state.truePositives + this.state.falsePositives || 1);
    const recall = this.state.truePositives /
      (this.state.truePositives + this.state.falseNegatives || 1);

    console.log(`[AdaptiveThreshold] Precision=${precision.toFixed(2)}, Recall=${recall.toFixed(2)}`);

    // 精度过低（太多误报）：提高阈值
    if (precision < 0.7) {
      config.jaccardThreshold = Math.min(0.8, config.jaccardThreshold + 0.03);
      config.stormThreshold = Math.max(5, config.stormThreshold - 1);
    }

    // 召回率过低（太多漏报）：降低阈值
    if (recall < 0.7) {
      config.jaccardThreshold = Math.max(0.2, config.jaccardThreshold - 0.03);
      config.stormThreshold = Math.min(20, config.stormThreshold + 1);
    }

    this.state.lastAdjustment = Date.now();
  }

  /**
   * 检查阶段转换条件
   */
  checkPhaseTransition() {
    const config = this.getCurrentConfig();
    const elapsed = Date.now() - this.startTime;

    if (this.state.phase === 'learning' && elapsed >= config.duration) {
      // 学习期结束条件：样本充足且精度达标
      const precision = this.state.truePositives /
        (this.state.truePositives + this.state.falsePositives || 1);

      if (this.state.samplesCollected >= 500 && precision >= 0.6) {
        this.transitionTo('stable');
      }
    }

    if (this.state.phase === 'stable' && elapsed >= config.duration) {
      const precision = this.state.truePositives /
        (this.state.truePositives + this.state.falsePositives || 1);

      if (precision >= 0.75) {
        this.transitionTo('optimized');
      }
    }
  }

  /**
   * 获取当前配置
   */
  getCurrentConfig() {
    return this.phaseConfig[this.state.phase];
  }

  /**
   * 阶段转换
   */
  transitionTo(newPhase) {
    const oldPhase = this.state.phase;
    this.state.phase = newPhase;

    console.log(`[AdaptiveThreshold] Phase transition: ${oldPhase} → ${newPhase}`);
    console.log(`  Samples: ${this.state.samplesCollected}`);
    console.log(`  TP: ${this.state.truePositives}, FP: ${this.state.falsePositives}, FN: ${this.state.falseNegatives}`);
  }
}
```

---

## 3. 自愈动作框架

### 3.1 动作级别定义

| 级别 | 动作类型 | 示例 | 审批要求 | 风险等级 | 适用场景 |
|------|---------|------|---------|---------|---------|
| **L1** | 信息收集 | 自动采集 logs/metrics/dump | 无需审批 | ✅ 安全 | 所有告警的默认响应 |
| **L2** | 重启服务 | docker restart <container> | 自动执行 | ⚠️ 低风险 | 已知可恢复的状态错误 |
| **L3** | 流量切换 | 切换到 replica / 降级模式 | 需确认 | 🔶 中风险 | 服务部分可用但质量下降 |
| **L4** | 扩容 | 动态增加实例数 | 需人工审批 | 🔴 高风险 | 持续性的容量不足 |
| **L5** | 紧急停机 | stop service to prevent cascade | 仅紧急情况 | 🚨 极高风险 | 检测到灾难性故障征兆 |

### 3.2 各级别详细规格

#### L1: 信息收集（Information Collection）

**目的**：在不干预系统的情况下，收集诊断信息辅助人工决策。

**包含动作**：
1. **collect-diags.sh** — 收集诊断信息包
   - 最近 100 行应用日志
   - 当前容器状态（docker ps -a）
   - 系统 resource 使用情况（top, free, df）
   - 网络连通性测试
   - 数据库连接池状态
   - Redis INFO 输出

2. **capture-metrics-snapshot** — 捕获指标快照
   - 导出当前 Prometheus 快照
   - 记录关键指标的当前值
   - 生成前后对比基准

**触发条件**：
```yaml
# PromQL 表达式示例
- name: "L1_CollectDiags_OnCritical"
  trigger: 'ALERTS{severity="critical"} > 0'
  action: collect_diags
  auto_execute: true
  timeout: 60s

- name: "L1_CollectDiags_OnWarning_Persisted"
  trigger: 'ALERTS{severity="warning"} > 0 and ALERTS_FOR_DURATION > 30m'
  action: collect_diags
  auto_execute: true
  timeout: 120s
```

**输出格式**：
```json
{
  "action_id": "L1_20260609_143052_abc123",
  "level": "L1",
  "type": "collect_diags",
  "status": "completed",
  "triggered_at": "2026-06-09T14:30:52Z",
  "completed_at": "2026-06-09T14:31:15Z",
  "duration_seconds": 23,
  "artifacts": {
    "logs": "/var/tmp/aiops-diagnostics/globalreach-api_20260609_143052/logs/app.log",
    "docker_state": "/var/tmp/aiops-diagnostics/globalreach-api_20260609_143052/docker-state.json",
    "system_resources": "/var/tmp/aiops-diagnostics/globalreach-api_20260609_143052/system-resources.txt",
    "metrics_snapshot": "/var/tmp/aiops-diagnostics/globalreach-api_20260609_143052/metrics-snapshot.json",
  },
  "summary": {
    "log_errors_last_100": 3,
    "container_status": "running",
    "cpu_usage_percent": 78,
    "memory_usage_percent": 85,
    "disk_usage_percent": 62,
    "db_connections_active": 45,
    "redis_memory_percent": 72,
  }
}
```

#### L2: 服务重启（Service Restart）

**目的**：针对已知可恢复的瞬态错误，通过重启清除异常状态。

**前置条件检查**：
- [x] 容器存在且可访问
- [x] 容器当前状态为 running（非 already stopped）
- [x] 该容器在白名单中（防止误操作关键服务）
- [x] 最近 10 分钟内未对该容器执行过重启
- [x] 不是级联故障中的上游服务（避免加重故障）

**安全约束**：
```javascript
// 容器重启白名单
const RESTART_WHITELIST = [
  'globalreach-api',      // API 服务（最常重启）
  'send-worker',          // 发送工作进程
  'nginx',                // Nginx（偶发卡死）
];

// 黑名单（绝对不允许自动重启）
const RESTART_BLACKLIST = [
  'postgresql',           // 数据库 — 重启可能导致数据损坏
  'redis',                // Redis — 重启会丢失未持久化数据
  'prometheus',           // 监控系统 — 重启会丢失时间序列
  'alertmanager',         // 告警管理 — 重启会丢失待发送通知
  'grafana',              // 可视化 — 低优先级，不应自动重启
];

// 冷却期配置（秒）
const RESTART_COOLDOWN_SECONDS = 600; // 10 分钟冷却期
```

**执行流程**：
```
开始
  ↓
前置条件检查
  ↓ (全部通过)
记录重启前状态（健康检查、指标快照）
  ↓
执行 docker restart <container>
  ↓
等待容器就绪（health check 通过 or 超时）
  ↓
执行重启后验证（健康检查 + 关键指标对比）
  ↓
判定结果：成功 / 失败 / 部分成功
  ↓
记录执行日志 & 更新指标
  ↓
结束
```

**成功/失败判定标准**：
```javascript
function evaluateRestartResult(preState, postState, containerName) {
  const result = {
    success: false,
    healthRestored: false,
    metricsImproved: false,
    details: {},
  };

  // 1. 容器状态检查
  if (postState.containerStatus !== 'running') {
    result.details.error = 'Container not running after restart';
    return result; // 明确失败
  }

  // 2. 健康检查
  result.healthRestored = postState.healthCheck === 'healthy';

  // 3. 关键指标改善
  const improvements = {
    errorRate: preState.errorRate - postState.errorRate,
    latencyP95: preState.latencyP95 - postState.latencyP95,
    memoryUsage: preState.memoryUsage - postState.memoryUsage,
  };

  result.metricsImproved =
    improvements.errorRate > 0.05 ||  // 错误率下降 5%+
    improvements.latencyP95 > 0.5 ||  // P95 延迟降低 0.5s+
    improvements.memoryUsage > 10;    // 内存释放 10%+

  result.details.improvements = improvements;

  // 综合判定：健康恢复 或 指标明显改善 = 成功
  result.success = result.healthRestored || result.metricsImproved;

  return result;
}
```

#### L3: 流量切换（Traffic Switching）

**目的**：在主实例出现问题时，将流量切换到备用实例或降级模式。

**适用场景**：
- API 实例响应缓慢但未完全宕机
- 特定功能模块异常（如邮件发送失败）
- 需要临时降低服务质量以保证核心功能可用

**动作模板**：
```bash
#!/bin/bash
# scripts/autoheal/traffic-switch.sh
#
# L3: 流量切换脚本
# 用法: ./traffic-switch.sh <service> <strategy>
# 策略:
#   - failover      : 切换到备用实例
#   - degrade       : 启用降级模式（禁用非核心功能）
#   - rate-limit    : 限制入口流量（限流保护）
#   - circuit-breaker: 开启熔断器

SERVICE=$1
STRATEGY=$2

case "$STRATEGY" in
  failover)
    echo "[L3] Executing failover for $SERVICE..."
    # 调用 Kubernetes/Docker Swarm 的切换逻辑
    # 或修改 Nginx upstream 配置
    ;;
  degrade)
    echo "[L3] Enabling degraded mode for $SERVICE..."
    # 设置环境变量或调用管理 API
    ;;
  rate-limit)
    echo "[L3] Applying rate limiting to $SERVICE..."
    # 动态调整 Nginx/Gateway 的限流参数
    ;;
  circuit-breaker)
    echo "[L3] Opening circuit breaker for $SERVICE..."
    # 调用熔断器 API
    ;;
  *)
    echo "Error: Unknown strategy: $STRATEGY"
    exit 1
    ;;
esac
```

**审批流程**：
```
系统检测到需要 L3 动作
  ↓
生成动作提案（包含原因、风险评估、预期效果）
  ↓
发送通知到值班人员（IM + 邮件）
  ↓
等待确认（超时 5 分钟）
  ↓
  ├─ 确认 → 执行动作
  └─ 超时/拒绝 → 降级为 L1（仅收集信息）
```

#### L4: 扩容（Scale Up）

**目的**：动态增加实例数量以应对持续性容量压力。

**触发条件**：
```yaml
- name: "L4_ScaleUp_API_HighMemory"
  trigger: >
    container_memory_rss{container="globalreach-api"}
    / container_spec_memory_limit{container="globalreach-api"} > 0.85
    and ALERT_DURATION > 30m
  action: scale_up
  params:
    service: globalreach-api
    increment: 1
    max_replicas: 3
  approval_required: true
  rollback_condition: "memory_usage < 70% for 10m"
```

**审批要求**：
- 需要至少一名 SRE/运维人员在线确认
- 或者在非工作时间（夜间），需要两名人员确认
- 紧急情况下（P0 告警），可由 on-call 值班人员单独批准

**预留接口**（`scripts/autoheal/scale-up.sh`）：
```bash
#!/bin/bash
# L4: 扩容脚本（预留接口）
# 当前版本仅记录扩容建议，实际扩容需人工执行

SERVICE=$1
INCREMENT=${2:-1}

echo "[L4] Scale-up recommendation for $SERVICE:"
echo "  Current replicas: $(docker ps -q -f name=$SERVICE | wc -l)"
echo "  Recommended: +$INCREMENT instances"
echo "  Action required: MANUAL APPROVAL NEEDED"

# 写入待办事项
echo "$(date -Iseconds) SCALE_UP_REQUESTED service=$service increment=$increment" \
  >> /var/log/aiops/scale-requests.log
```

#### L5: 紧急停止（Emergency Stop）

**目的**：在检测到灾难性故障征兆时，主动停止服务以防止故障扩散。

**⚠️ 极高风险操作 — 仅在以下条件下允许**：
1. 检测到级联故障且影响范围 >50% 服务
2. 系统检测到数据损坏风险（如磁盘 I/O 错误率 >90%）
3. 收到人工紧急指令（emergency stop command）
4. 自动触发需要同时满足以下条件：
   - 至少 3 个独立指标同时异常
   - 根因分析指向单点故障
   - 预计不停止将导致更大范围影响

**执行流程**：
```javascript
async function executeEmergencyStop(serviceName, reason, operatorId) {
  // 1. 最终安全检查
  const safetyCheck = await performFinalSafetyCheck(serviceName);
  if (!safetyCheck.passed) {
    throw new Error(`Emergency stop blocked: ${safetyCheck.reason}`);
  }

  // 2. 记录审计日志（不可篡改）
  await auditLog.create({
    action: 'EMERGENCY_STOP',
    service: serviceName,
    reason,
    operatorId,
    timestamp: new Date(),
    preStopSnapshot: safetyCheck.snapshot,
    approvedBy: 'system_auto', // 或 operatorId
  });

  // 3. 通知所有相关人员
  await sendEmergencyNotification({
    type: 'EMERGENCY_STOP_EXECUTED',
    service: serviceName,
    reason,
    operator: operatorId,
  });

  // 4. 执行停止
  try {
    await exec(`docker stop ${serviceName} --timeout 30`);

    // 5. 后置验证
    const postStopState = await verifyServiceStopped(serviceName);

    return {
      success: true,
      stoppedAt: new Date(),
      postStopState,
      nextSteps: [
        '等待根因分析报告',
        '准备恢复计划',
        '通知利益相关者',
      ],
    };
  } catch (error) {
    // 停止失败 — 记录并报警
    await sendEmergencyNotification({
      type: 'EMERGENCY_STOP_FAILED',
      service: serviceName,
      error: error.message,
    });

    throw error;
  }
}
```

### 3.3 动作执行框架

```javascript
/**
 * AutoHealingEngine - 自愈动作执行引擎
 *
 * 核心职责：
 * 1. 接收关联分析的结果（clusterId, rootCause, suggestedAction）
 * 2. 根据动作级别决定执行策略
 * 3. 协调前置检查、执行、后置验证
 * 4. 记录完整的执行审计链
 */
class AutoHealingEngine {
  constructor(config = {}) {
    this.config = {
      enabled: process.env.AIOPS_AUTO_HEAL_ENABLED !== 'false', // 默认启用
      maxConcurrentActions: 3,                                  // 并行动作上限
      actionTimeout: {
        L1: 120000,   // 2 分钟
        L2: 180000,   // 3 分钟
        L3: 300000,   // 5 分钟
        L4: 600000,   // 10 分钟
        L5: 60000,    // 1 分钟（快速执行）
      },
      dryRun: process.env.AIOPS_DRY_RUN === 'true',           // 试运行模式
      ...config,
    };

    this.activeActions = new Map(); // 正在执行的动作
    this.actionHistory = [];        // 历史记录
    this.scriptBasePath = path.join(__dirname, '../../scripts/autoheal');
  }

  /**
   * 执行自愈动作
   * @param {string} actionId - 动作标识
   * @param {object} params - 动作参数
   * @param {object} context - 执行上下文（clusterId, alertInfo 等）
   * @returns {Promise<object>} 执行结果
   */
  async executeAction(actionId, params, context = {}) {
    const level = this.getActionLevel(actionId);

    // 检查是否启用自愈
    if (!this.config.enabled) {
      return { status: 'skipped', reason: 'Auto-healing disabled' };
    }

    // 检查并发限制
    if (this.activeActions.size >= this.config.maxConcurrentActions) {
      return { status: 'queued', reason: 'Max concurrent actions reached' };
    }

    // 根据级别决定执行路径
    switch (level) {
      case 'L1':
        return await this.executeL1(actionId, params, context);
      case 'L2':
        return await this.executeL2(actionId, params, context);
      case 'L3':
        return await this.executeL3(actionId, params, context);
      case 'L4':
        return await this.executeL4(actionId, params, context);
      case 'L5':
        return await this.executeL5(actionId, params, context);
      default:
        throw new Error(`Unknown action level: ${level}`);
    }
  }

  /**
   * L1: 信息收集（自动执行）
   */
  async executeL1(actionId, params, context) {
    const actionKey = `${actionId}_${Date.now()}`;
    this.activeActions.set(actionKey, { status: 'running', startedAt: Date.now() });

    try {
      const scriptPath = path.join(this.scriptBasePath, 'collect-diags.sh');
      const result = await this.runScript(scriptPath, params);

      this.recordActionHistory({
        actionId,
        level: 'L1',
        status: 'success',
        params,
        context,
        result,
        executedAt: new Date(),
      });

      return { status: 'success', artifacts: result };
    } catch (error) {
      return { status: 'failed', error: error.message };
    } finally {
      this.activeActions.delete(actionKey);
    }
  }

  /**
   * L2: 服务重启（自动执行 + 安全检查）
   */
  async executeL2(actionId, params, context) {
    const { containerName } = params;

    // 前置安全检查
    const preCheck = await this.performPreRestartCheck(containerName);
    if (!preCheck.passed) {
      return {
        status: 'blocked',
        reason: preCheck.reason,
        checks: preCheck.checks,
      };
    }

    // 干运行模式检查
    if (this.config.dryRun) {
      return {
        status: 'dry_run',
        message: `[DRY RUN] Would restart container: ${containerName}`,
        preCheck,
      };
    }

    const actionKey = `restart_${containerName}_${Date.now()}`;
    this.activeActions.set(actionKey, { status: 'running', startedAt: Date.now() });

    try {
      // 记录重启前状态
      const preState = await this.capturePreRestartState(containerName);

      // 执行重启
      const scriptPath = path.join(this.scriptBasePath, 'restart-container.sh');
      const restartResult = await this.runScript(scriptPath, { container: containerName });

      // 等待并验证
      await this.waitForHealthy(containerName, 120000); // 2 分钟超时
      const postState = await this.capturePostRestartState(containerName);

      // 评估结果
      const evaluation = this.evaluateRestartResult(preState, postState, containerName);

      this.recordActionHistory({
        actionId: 'restart_container',
        level: 'L2',
        status: evaluation.success ? 'success' : 'partial_success',
        params: { containerName },
        context,
        preState,
        postState,
        evaluation,
        executedAt: new Date(),
      });

      return {
        status: evaluation.success ? 'success' : 'partial_success',
        evaluation,
        preState,
        postState,
      };
    } catch (error) {
      this.recordActionHistory({
        actionId: 'restart_container',
        level: 'L2',
        status: 'failed',
        params: { containerName },
        error: error.message,
        executedAt: new Date(),
      });

      return { status: 'failed', error: error.message };
    } finally {
      this.activeActions.delete(actionKey);
    }
  }

  /**
   * L3-L5: 需要审批的动作
   */
  async executeL3(actionId, params, context) { /* ... */ }
  async executeL4(actionId, params, context) { /* ... */ }
  async executeL5(actionId, params, context) { /* ... */ }

  // --- Helper Methods ---

  async runScript(scriptPath, params) {
    return new Promise((resolve, reject) => {
      const args = Object.entries(params || {}).flatMap(([k, v]) => [`--${k}`, v]);
      const child = spawn('bash', [scriptPath, ...args], {
        timeout: 120000,
        env: { ...process.env, ...params },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', data => stdout += data.toString());
      child.stderr.on('data', data => stderr += data.toString());

      child.on('close', code => {
        if (code === 0) {
          resolve({ stdout, stderr, exitCode: code });
        } else {
          reject(new Error(`Script exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', reject);
    });
  }

  recordActionHistory(record) {
    this.actionHistory.push(record);
    // 保持最近 1000 条记录
    if (this.actionHistory.length > 1000) {
      this.actionHistory = this.actionHistory.slice(-1000);
    }
  }
}
```

---

## 4. 实现方案

### 4.1 系统架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        GlobalReach AIOps 架构                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │  Prometheus   │───▶│ AlertManager │───▶│  Webhook     │              │
│  │  (Rules)     │    │  (Route)     │    │  Receiver    │              │
│  └──────────────┘    └──────────────┘    └──────┬───────┘              │
│                                                   │                      │
│                                                   ▼                      │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    AlertCorrelationService                        │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │   │
│  │  │ Temporal    │  │ Topological │  │ Label       │              │   │
│  │  │ Clustering  │  │ Correlation │  │ Similarity  │              │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │   │
│  │         └────────────────┼────────────────┘                      │   │
│  │                          ▼                                       │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │           Root Cause Analysis Engine                     │    │   │
│  │  │  (评分 → 排序 → 候选推荐 → 置信度计算)                    │    │   │
│  │  └────────────────────────┬────────────────────────────────┘    │   │
│  │                           ▼                                     │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │           AutoHealing Decision Engine                   │    │   │
│  │  │  (规则匹配 → 风险评估 → 动作选择 → 执行/审批)            │    │   │
│  │  └────────────────────────┬────────────────────────────────┘    │   │
│  └───────────────────────────┼──────────────────────────────────────┘   │
│                              │                                          │
│              ┌───────────────┼───────────────┐                          │
│              ▼               ▼               ▼                          │
│  ┌───────────────┐ ┌──────────────┐ ┌──────────────┐                   │
│  │  AutoHeal     │ │  Notification│ │  Metrics     │                   │
│  │  Scripts      │ │  (Email/IM)  │ │  (Prometheus)│                   │
│  └───────────────┘ └──────────────┘ └──────────────┘                   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    REST API Layer (/api/v1/alerts/*)              │   │
│  │  • POST /correlate     • GET  /clusters                          │   │
│  │  • GET  /clusters/:id  • POST /clusters/:id/action               │   │
│  │  • GET  /stats         • GET  /history                           │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Grafana Dashboard (AIOps Overview)             │   │
│  │  • 告警速率趋势    • 降噪率 Gauge                                 │   │
│  │  • 活跃集群列表    • 根因分布 Pie Chart                           │   │
│  │  • 自愈历史        • MTTR 趋势                                    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 核心组件说明

#### 4.2.1 AlertCorrelationService（告警关联服务）

**文件位置**: `api/services/alertCorrelationService.js`

**主要职责**：
1. **接收层**：接收来自 AlertManager Webhook 的标准化告警
2. **关联层**：执行多维度的关联分析（时间+拓扑+标签）
3. **决策层**：生成根因假设和自愈动作建议
4. **执行层**：协调自愈脚本的执行
5. **存储层**：持久化关联结果和历史记录

**对外接口**：
```typescript
interface AlertCorrelationService {
  // 接收告警
  receiveAlert(alert: AlertPayload): Promise<CorrelationResult>;

  // 关联分析
  correlate(alert: NormalizedAlert): Promise<CorrelationResult>;

  // 执行自愈动作
  executeAction(actionId: string, params: ActionParams): Promise<ActionResult>;

  // 查询接口
  getClusterHistory(clusterId: string, timeRange: TimeRange): Promise<ClusterHistory>;
  getCorrelationStats(): Promise<CorrelationStats>;
  getActiveClusters(): Promise<AlertCluster[]>;
}
```

#### 4.2.2 AlertCorrelationRoute（告警关联 API）

**文件位置**: `api/routes/alertCorrelation.js`

**端点清单**：

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/v1/alerts/correlate` | 接收并关联单条告警 | Bearer Token |
| GET | `/api/v1/alerts/clusters` | 列出活跃的告警集群 | Bearer Token |
| GET | `/api/v1/alerts/clusters/:id` | 集群详情（含根因分析） | Bearer Token |
| POST | `/api/v1/alerts/clusters/:id/action` | 对集群执行自愈动作 | Bearer Token + Confirm |
| GET | `/api/v1/alerts/stats` | AIOps 统计仪表盘数据 | Bearer Token |
| GET | `/api/v1/alerts/history` | 历史告警关联记录 | Bearer Token |

#### 4.2.3 AIOPS 告警规则

**文件位置**: `prometheus/rules/aiops-alerts.yml`

**新增规则**：

| 规则名 | 类型 | 触发条件 | 用途 |
|--------|------|---------|------|
| AlertStormDetected | critical | >10 条/分钟 | 告警风暴检测 |
| CascadeFailureSuspected | warning | 多组件同时异常 | 级联故障检测 |
| RootCauseCandidate | info | 基于拓扑上游优先 | 根因候选标记 |
| FlappingAlert | warning | 5分钟内状态切换>3次 | 抖动告警检测 |
| MaintenanceWindowViolation | info | 维护窗口外告警 | 维护窗口违规 |
| AutoHealingTriggered | info | 自愈动作执行 | 自愈通知 |

#### 4.2.4 自愈脚本目录

**目录结构**：
```
scripts/autoheal/
├── restart-container.sh    # L2: 安全重启指定容器
├── collect-diags.sh        # L1: 收集诊断信息
├── check-health.sh         # 健康检查（通用工具）
├── scale-up.sh             # L4: 扩容（预留接口）
└── emergency-stop.sh       # L5: 紧急停止（预留接口）
```

### 4.3 数据流图

```
用户/系统事件
     │
     ▼
Prometheus (每 30s 评估规则)
     │
     │  firing/resolved events
     ▼
AlertManager (路由分组 + 抑制)
     │
     │  webhook notification
     ▼
POST /api/v1/webhooks/alertmanager
     │
     ▼
WebhookListenerService.processAlertManagerAlert()
     │  (基础处理：验签、去重、入库)
     │
     │  转发至 AIOps 引擎
     ▼
AlertCorrelationService.receiveAlert()
     │
     ├─▶ SlidingWindowManager.addAlert()        # 加入时间窗口
     │
     ├─▶ ServiceTopologyGraph.analyze()          # 拓扑分析
     │
     ├─▶ LabelSimilarityMatcher.match()          # 标签匹配
     │
     ├─▶ RootCauseScorer.score()                 # 根因评分
     │
     ├─▶ AlertAggregator.aggregate()             # 聚合
     │
     ▼
CorrelationResult {
  clusterId: "abc123...",
  rootCause: { alert, score, confidence },
  relatedAlerts: [...],
  action: { level, type, params, autoExecutable },
  suppressionDecision: "notify" | "suppress" | "aggregate",
}
     │
     ├─▶ notify → 发送精简通知（含根因分析）
     │
     ├─▶ suppress → 静默（记录但不通知）
     │
     └─▶ auto_heal → AutoHealingEngine.executeAction()
                        │
                        ├─▶ L1/L2 → 直接执行
                        └─▶ L3+ → 等待人工确认
```

---

## 5. 集成点与接口规范

### 5.1 与现有系统的集成

#### 5.1.1 WebhookListenerService 集成

**现有代码位置**: `api/services/webhookListenerService.js`

**集成方式**：在 `processAlertManagerAlert()` 方法中增加 AIOps 转发逻辑。

```javascript
// 在 webhookListenerService.js 中添加
async processAlertManagerAlert(payload, metadata) {
  // ... 现有的处理逻辑 ...

  // ★ 新增：转发到 AIOps 关联引擎
  try {
    const { alertCorrelationService } = require('./alertCorrelationService');

    for (const processedAlert of processedAlerts) {
      // 异步转发（不阻塞原有流程）
      setImmediate(() => {
        alertCorrelationService.receiveAlert(processedAlert).catch(err => {
          console.error('[AIOps] Correlation failed:', err.message);
        });
      });
    }
  } catch (e) {
    // AIOps 不可用时降级（不影响原有功能）
    console.warn('[AIOps] Service not available, skipping correlation');
  }

  return { /* ...原有返回值... */ };
}
```

#### 5.1.2 Prometheus Metrics 集成

**现有代码位置**: `api/middleware/metrics.js`

**新增指标**：

```javascript
// 在 metrics.js 中添加 AIOps 专用指标

/** AIOps 告警处理计数器 */
const aiopsAlertsTotal = new client.Counter({
  name: `${METRICS_PREFIX}aiops_alerts_total`,
  help: 'Total alerts processed by AIOps engine, labeled by final status',
  labelNames: ['status'], // correlated | raw | suppressed | auto_healed
});

/** AIOps 关联耗时直方图 */
const aiopsCorrelationDurationSeconds = new client.Histogram({
  name: `${METRICS_PREFIX}aiops_correlation_duration_seconds`,
  help: 'Duration of alert correlation analysis in seconds',
  labelNames: ['algorithm'], // temporal | topological | label_similarity
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
});

/** AIOps 自愈动作计数器 */
const aiopsAutoHealTotal = new client.Counter({
  name: `${METRICS_PREFIX}aiops_auto_heal_total`,
  help: 'Total auto-healing actions executed',
  labelNames: ['level', 'action_type', 'result'], // L1-L5, action type, success/failure
});

/** AIOps 活跃集群 Gauge */
const aiopsActiveClusters = new client.Gauge({
  name: `${METRICS_PREFIX}aiops_active_clusters`,
  help: 'Number of currently active alert clusters',
});

/** AIOps 降噪率 Gauge */
const aiopsDeduplicationRate = new client.Gauge({
  name: `${METRICS_PREFIX}aiops_deduplication_rate`,
  help: 'Current alert deduplication rate (0-1)',
});
```

#### 5.1.3 Server.js 路由注册

**现有代码位置**: `api/server.js`

**新增路由注册**：

```javascript
// 在 server.js 中添加
const alertCorrelationRoutes = require('./routes/alertCorrelation');

// 在路由注册区域添加
app.use('/api/v1/alerts', alertCorrelationRoutes);
```

### 5.2 API 接口规范

#### 5.2.1 POST /api/v1/alerts/correlate

**请求体**：
```json
{
  "alert": {
    "fingerprint": "a1b2c3d4e5f6g7h8",
    "alertName": "APIDown",
    "severity": "critical",
    "instance": "globalreach-api",
    "team": "platform",
    "summary": "GlobalReach API is DOWN",
    "startsAt": "2026-06-09T14:30:00Z",
    "labels": {
      "alertname": "APIDown",
      "severity": "critical",
      "instance": "globalreach-api",
      "job": "globalreach-api",
      "team": "platform"
    },
    "annotations": {
      "summary": "...",
      "description": "..."
    }
  },
  "source": "alertmanager_webhook",
  "metadata": {
    "ip": "172.28.0.5",
    "timestamp": "2026-06-09T14:30:05Z"
  }
}
```

**响应**：
```json
{
  "success": true,
  "correlationId": "corr_20260609_143005_abc123",
  "result": {
    "clusterId": "cls_xxx888",
    "clusterSize": 5,
    "rootCause": {
      "alertName": "APIDown",
      "instance": "globalreach-api",
      "score": 0.87,
      "confidence": "high",
      "reasoning": "Top-level service failure with highest severity and earliest timestamp"
    },
    "relatedAlerts": [
      { "alertName": "HighErrorRate", "relation": "symptom" },
      { "alertName": "APIHealthCritical", "relation": "symptom" },
      { "alertName": "APILatencyP50Elevated", "relation": "downstream" }
    ],
    "suppressionDecision": "aggregate",
    "suggestedAction": {
      "level": "L2",
      "type": "restart_container",
      "params": { "containerName": "globalreach-api" },
      "autoExecutable": true,
      "reason": "Container restart may clear transient failure state"
    }
  },
  "processingTimeMs": 45
}
```

#### 5.2.2 GET /api/v1/alerts/clusters

**查询参数**：
- `status`: active | resolved | all (默认: active)
- `limit`: 返回数量限制 (默认: 50)
- `severity`: critical | warning | info (可选过滤)

**响应**：
```json
{
  "success": true,
  "total": 3,
  "clusters": [
    {
      "id": "cls_xxx888",
      "status": "active",
      "createdAt": "2026-06-09T14:30:00Z",
      "size": 5,
      "rootCause": {
        "alertName": "APIDown",
        "severity": "critical"
      },
      "topAffectedServices": ["globalreach-api", "nginx"],
      "autoHealStatus": "pending"
    }
  ]
}
```

---

## 6. 监控指标体系

### 6.1 AIOps 专用 Prometheus 指标

| 指标名 | 类型 | Labels | 说明 |
|--------|------|--------|------|
| `globalreach_aiops_alerts_total` | Counter | status | 告警处理总量（correlated/raw/suppressed） |
| `globalreach_aiops_correlation_duration_seconds` | Histogram | algorithm | 关联分析耗时 |
| `globalreach_aiops_auto_heal_total` | Counter | level, action_type, result | 自愈动作执行统计 |
| `globalreach_aiops_active_clusters` | Gauge | - | 当前活跃集群数 |
| `globalreach_aiops_deduplication_rate` | Gauge | - | 当前降噪率 |
| `globalreach_aiops_cluster_lifetime_seconds` | Histogram | resolution_type | 集群生命周期时长 |
| `globalreach_aiops_rootcause_accuracy` | Gauge | - | 根因准确率（基于反馈） |

### 6.2 Grafana 仪表盘面板定义

详见 `grafana/dashboards/aiops-overview.json`

### 6.3 告警规则（AIOps 自身监控）

为确保 AIOps 系统自身的可靠性，定义以下自检规则：

```yaml
# AIOps 系统自检告警
groups:
  - name: aiops-self-monitoring
    interval: 60s
    rules:
      # AIOps 引擎宕机检测
      - alert: AIOpsEngineDown
        expr: up{job="globalreach-api"} == 0
        for: 1m
        labels:
          severity: critical
          team: platform
        annotations:
          summary: "AIOps Correlation Engine is DOWN"
          description: "Alert correlation service is unavailable."

      # 关联耗时异常
      - alert: AIOpsCorrelationLatencyHigh
        expr: |
          histogram_quantile(0.95,
            rate(globalreach_aiops_correlation_duration_seconds_bucket[5m])
          ) > 2
        for: 10m
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "AIOps Correlation Latency High (>2s P95)"

      # 降噪率下降
      - alert: AIOpsDedupRateDropped
        expr: globalreach_aiops_deduplication_rate < 0.5
        for: 30m
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "AIOps Deduplication Rate Below 50%"
```

---

## 7. 部署指南

### 7.1 前置条件

- Node.js >= 16.x
- Docker & Docker Compose
- Prometheus + AlertManager 已部署
- PostgreSQL 15 (不要更改版本号)

### 7.2 部署步骤

```bash
# 1. 创建必要的目录
mkdir -p scripts/autoheal
mkdir -p grafana/dashboards
mkdir -p docs

# 2. 设置脚本权限
chmod +x scripts/autoheal/*.sh

# 3. 重启 Prometheus 以加载新规则
docker restart prometheus

# 4. 重启 AlertManager 以加载新路由
docker restart alertmanager

# 5. 导入 Grafana 仪表盘
# 通过 Grafana UI: Import → Upload aiops-overview.json

# 6. 验证部署
curl http://localhost:3000/api/v1/alerts/stats
```

### 7.3 环境变量配置

```bash
# .env 中添加 AIOps 相关配置
AIOPS_AUTO_HEAL=true           # 启用自愈功能
AIOPS_DRY_RUN=false            # 关闭试运行模式（生产环境）
AIOPS_STORM_THRESHOLD=10       # 告警风暴阈值（条/分钟）
AIOPS_LEARNING_PHASE_DAYS=7    # 学习期天数
WEBHOOK_SECRET=your-secret-key # Webhook 密钥
```

### 7.4 回滚方案

如果 AIOps 系统导致问题：

1. **立即禁用自愈**：设置 `AIOPS_AUTO_HEAL=false`
2. **移除 AIOps 路由**：注释掉 server.js 中的路由注册
3. **删除 AIOps 告警规则**：移除 `prometheus/rules/aiops-alerts.yml`
4. **重启 Prometheus 和 AlertManager**

---

## 8. 附录

### 附录 A: 术语表

| 术语 | 英文 | 定义 |
|------|------|------|
| 告警风暴 | Alert Storm | 短时间内大量告警同时触发 |
| 级联故障 | Cascade Failure | 单一故障引发的多层连锁反应 |
| 告警指纹 | Alert Fingerprint | 用于唯一标识告警的哈希值 |
| 时间窗口 | Time Window | 用于聚类分析的固定时间段 |
| 拓扑图 | Topology Graph | 服务间依赖关系的图形化表示 |
| 根因分析 | Root Cause Analysis (RCA) | 识别故障根本原因的过程 |
| 降噪率 | Deduplication Rate | 被抑制的冗余告警比例 |
| MTTA | Mean Time To Acknowledge | 平均确认时间 |
| MTTR | Mean Time To Resolution | 平均解决时间 |
| 自愈 | Auto-Healing | 系统自动执行的修复动作 |
| 抖动 | Flapping | 告警状态在短时间内反复切换 |

### 附录 B: 配置参考

#### 完整配置项

```javascript
// config/aiops.default.js
module.exports = {
  // 时间窗口配置
  windows: {
    L1: { size_ms: 60000, label: 'realtime' },
    L2: { size_ms: 300000, label: 'short_term' },
    L3: { size_ms: 900000, label: 'long_term' },
  },

  // 告警风暴阈值
  storm: {
    threshold_per_minute: 10,
    cooldown_minutes: 15,
    auto_suppress: true,
  },

  // 关联算法配置
  correlation: {
    jaccard_threshold_learning: 0.3,
    jaccard_threshold_stable: 0.5,
    topology_weight: 0.35,
    freshness_weight: 0.25,
    severity_weight: 0.20,
  },

  // 自愈配置
  autoHeal: {
    enabled: true,
    dry_run: false,
    max_concurrent: 3,
    levels: {
      L1: { timeout_ms: 120000, approval: 'none' },
      L2: { timeout_ms: 180000, approval: 'auto' },
      L3: { timeout_ms: 300000, approval: 'confirm' },
      L4: { timeout_ms: 600000, approval: 'manual' },
      L5: { timeout_ms: 60000, approval: 'emergency_only' },
    },
  },

  // 容器重启白名单
  restartWhitelist: [
    'globalreach-api',
    'send-worker',
    'nginx',
  ],

  // 学习期配置
  learning: {
    duration_days: 7,
    min_samples: 500,
    auto_transition: true,
  },
};
```

### 附录 C: 故障排查指南

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| 告警未被关联 | AIOps 服务未启动 | 检查日志，确认服务运行正常 |
| 降噪率为 0 | 学习期未结束或阈值过严 | 检查 `AIOPS_PHASE` 状态 |
| 自愈动作未执行 | 白名单未配置或冷却期 | 检查 `restartWhitelist` 和冷却时间 |
| 根因分析不准确 | 拓扑图不完整 | 更新 `ServiceTopologyGraph` 定义 |
| 性能下降 | 关联算法复杂度高 | 调整窗口大小或启用异步处理 |

### 附录 D: 版本历史

| 版本 | 日期 | 作者 | 变更内容 |
|------|------|------|---------|
| v1.0.0 | 2026-06-09 | AIOps Team | 初始版本，完整设计文档 |

---

> **文档结束**
>
> 本文档是 GlobalReach V2.0 AIOps 智能告警降噪系统的完整设计规范。
> 实现代码请参见同目录下的实现文件。
