/**
 * AlertCorrelationService - AIOps 智能告警降噪核心服务
 *
 * S132/O01: AIOps Smart Alert Deduplication System
 *
 * 核心功能:
 * 1. receiveAlert(alert) — 接收来自 AlertManager webhook 的告警
 * 2. correlate(alert) — 关联分析，返回 {clusterId, rootCause, relatedAlerts, action}
 * 3. executeAction(actionId, params) — 执行自愈动作
 * 4. getClusterHistory(clusterId, timeRange) — 查询关联历史
 * 5. getCorrelationStats() — 统计降噪效果
 *
 * 集成点:
 * - 复用 webhookListenerService.js 的 AlertManager webhook 接收能力
 * - 复用 middleware/metrics.js 的 Prometheus 指标注册
 */

const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');

// Prometheus metrics (复用现有模块)
let metrics;
try {
  metrics = require('../middleware/metrics');
} catch (e) {
  console.warn('[AIOps] Metrics module not available, running without Prometheus integration');
  metrics = null;
}

// ============================================
// 配置常量
// ============================================

const CONFIG = {
  // 时间窗口配置（毫秒）
  windows: {
    L1: { size: 60000, label: 'realtime' },    // 60s 实时窗口
    L2: { size: 300000, label: 'short_term' }, // 5min 短期窗口
    L3: { size: 900000, label: 'long_term' },  // 15min 长期窗口
  },

  // 告警风暴阈值
  stormThreshold: 10,  // 条/分钟
  stormCooldownMs: 900000, // 15 分钟冷却期

  // 抖动检测参数
  flappingMinTransitions: 3,
  flappingWindowMs: 300000, // 5 分钟

  // 聚合策略默认值
  defaultAggregationStrategy: 'max_severity',

  // 自愈动作配置
  autoHeal: {
    enabled: process.env.AIOPS_AUTO_HEAL !== 'false',
    dryRun: process.env.AIOPS_DRY_RUN === 'true',
    maxConcurrentActions: 3,
    scriptBasePath: path.join(__dirname, '../../scripts/autoheal'),
  },

  // 容器重启白名单
  restartWhitelist: [
    'globalreach-api',
    'send-worker',
    'nginx',
  ],

  // 重启黑名单（绝对不允许自动重启）
  restartBlacklist: [
    'postgresql',
    'redis',
    'prometheus',
    'alertmanager',
    'grafana',
  ],

  // 冷却期（秒）
  restartCooldownSeconds: 600,

  // 学习期配置
  learningPhaseDays: parseInt(process.env.AIOPS_LEARNING_PHASE_DAYS || '7'),
};

// ============================================
// SlidingWindowManager - 多级滑动窗口管理器
// ============================================

class SlidingWindowManager {
  constructor() {
    this.windows = {
      L1: { ...CONFIG.windows.L1, alerts: new Map() },
      L2: { ...CONFIG.windows.L2, alerts: new Map() },
      L3: { ...CONFIG.windows.L3, alerts: new Map() },
    };

    // 清理定时器（每 30 秒运行一次）
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 30000);
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  /**
   * 添加告警到所有活跃窗口
   */
  addAlert(alert) {
    const now = Date.now();
    const fingerprint = alert.fingerprint;
    const result = {};

    for (const [level, window] of Object.entries(this.windows)) {
      const existing = window.alerts.get(fingerprint);

      window.alerts.set(fingerprint, {
        ...alert,
        windowEntryTime: now,
        lastSeen: now,
        occurrenceCount: (existing?.occurrenceCount || 0) + 1,
        firstSeen: existing?.firstSeen || now,
      });

      result[level] = {
        totalInWindow: this.getActiveCount(level),
        isNew: !existing,
      };
    }

    return result;
  }

  /**
   * 获取指定窗口内的活跃告警列表
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

    return alerts.sort((a, b) => (a.startsAt || a.receivedAt) - (b.startsAt || b.receivedAt));
  }

  /**
   * 清理过期条目
   */
  cleanupExpired() {
    const now = Date.now();

    for (const [, window] of Object.entries(this.windows)) {
      for (const [fingerprint, alert] of window.alerts) {
        if (now - alert.lastSeen > window.size * 2) {
          window.alerts.delete(fingerprint);
        }
      }
    }
  }

  /**
   * 检测告警风暴
   */
  isStormActive() {
    return this.getActiveCount('L1') >= CONFIG.stormThreshold;
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

  /**
   * 销毁清理定时器
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// ============================================
// ServiceTopologyGraph - 服务依赖图
// ============================================

class ServiceTopologyGraph {
  constructor() {
    this.graph = new Map();
    this.initializeGlobalReachTopology();
  }

  /**
   * 初始化 GlobalReach V2.0 的服务依赖关系
   * 基于 docker-compose.yml 定义的架构
   */
  initializeGlobalReachTopology() {
    // 定义服务节点
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
        upstream: [],
        downstream: [],
      });
    }

    // 定义依赖边（方向：upstream → downstream）
    const edges = [
      ['postgresql', 'globalreach-api'],
      ['redis', 'globalreach-api'],
      ['redis', 'send-worker'],
      ['globalreach-api', 'nginx'],
      ['globalreach-api', 'prometheus'],
      ['node-exporter', 'prometheus'],
      ['prometheus', 'alertmanager'],
      ['alertmanager', 'globalreach-api'],
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
   */
  getUpstream(serviceId) {
    const node = this.graph.get(serviceId);
    return node ? [...node.upstream] : [];
  }

  /**
   * 获取服务的直接下游依赖
   */
  getDownstream(serviceId) {
    const node = this.graph.get(serviceId);
    return node ? [...node.downstream] : [];
  }

  /**
   * BFS 查找传播路径
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

    return null;
  }

  /**
   * 获取影响范围（所有下游服务）
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

    if (mapping[instance]) return mapping[instance];

    for (const [pattern, service] of Object.entries(mapping)) {
      if (instance.includes(pattern)) return service;
    }

    return null;
  }
}

// ============================================
// RootCauseScorer - 根因候选评分引擎
// ============================================

class RootCauseScorer {
  constructor(topologyGraph) {
    this.topology = topologyGraph;
    this.historyDB = new Map();

    // 权重配置
    this.weights = {
      topology: 0.35,
      freshness: 0.25,
      severity: 0.20,
      frequency: -0.10,
      history: 0.10,
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
   */
  scoreCandidates(alerts) {
    const candidates = alerts.map(alert => ({
      alert,
      scores: {},
      totalScore: 0,
    }));

    for (const candidate of candidates) {
      candidate.scores.topology = this.calcTopologyScore(candidate.alert);
      candidate.scores.freshness = this.calcFreshnessScore(candidate.alert, alerts);
      candidate.scores.severity = this.calcSeverityScore(candidate.alert);
      candidate.scores.frequency = this.calcFrequencyScore(candidate.alert);
      candidate.scores.history = this.calcHistoryScore(candidate.alert);

      candidate.totalScore =
        this.weights.topology * candidate.scores.topology +
        this.weights.freshness * candidate.scores.freshness +
        this.weights.severity * candidate.scores.severity +
        this.weights.frequency * candidate.scores.frequency +
        this.weights.history * candidate.scores.history;
    }

    return candidates.sort((a, b) => b.totalScore - a.totalScore);
  }

  /**
   * 计算拓扑得分
   */
  calcTopologyScore(alert) {
    const instance = alert.instance || alert.labels?.instance;
    if (!instance) return 0.5;

    const serviceName = this.topology.mapInstanceToService(instance);
    if (!serviceName) return 0.5;

    const node = this.topology.graph.get(serviceName);
    if (!node) return 0.5;

    const inDegree = node.upstream.length;
    const outDegree = node.downstream.length;
    const topologyScore = Math.min(1, inDegree / Math.max(1, inDegree + outDegree));
    const layerBonus = (3 - node.layer) * 0.1;

    return Math.min(1, topologyScore + layerBonus);
  }

  /**
   * 计算新鲜度得分
   */
  calcFreshnessScore(targetAlert, allAlerts) {
    const targetTime = new Date(targetAlert.startsAt || targetAlert.receivedAt).getTime();
    const times = allAlerts.map(a => new Date(a.startsAt || a.receivedAt).getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const timeRange = maxTime - minTime || 1;

    return 1 - ((targetTime - minTime) / timeRange);
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
   */
  calcFrequencyScore(alert) {
    const fingerprint = alert.fingerprint;
    if (!fingerprint) return 0;

    // 简化实现：基于内存中的计数
    const recentCount = this.getRecentOccurrenceCount(fingerprint);
    if (recentCount > 5) return -0.5;
    if (recentCount > 2) return -0.2;
    return 0;
  }

  /**
   * 计算历史得分
   */
  calcHistoryScore(alert) {
    const serviceName = this.topology.mapInstanceToService(
      alert.instance || alert.labels?.instance
    );
    if (!serviceName) return 0;

    const history = this.historyDB.get(serviceName);
    if (!history) return 0;

    const rootCauseRatio = history.rootCauseCount / Math.max(1, history.totalIncidents);
    const recencyBonus = Math.exp(-(history.daysSinceLastIncident || 30) / 30);

    return rootCauseRatio * recencyBonus;
  }

  /**
   * 获取最近出现次数（简化版）
   */
  getRecentOccurrenceCount(fingerprint) {
    // 实际实现应查询数据库或缓存
    return 0; // 默认返回 0，避免误判
  }
}

// ============================================
// LabelSimilarityMatcher - 标签相似度匹配器
// ============================================

class LabelSimilarityMatcher {
  constructor() {
    this.thresholds = {
      learning: 0.3,
      stable: 0.5,
      strict: 0.7,
    };

    this.phase = 'learning';
    this.labelWeights = {
      alertname: 2.0,
      instance: 1.5,
      job: 1.2,
      severity: 0.8,
      team: 1.0,
    };
  }

  /**
   * 计算 Jaccard 相似度
   */
  jaccardSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;
    if (setA.size === 0 || setB.size === 0) return 0;

    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    return intersection.size / union.size;
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
   * 查找相似告警
   */
  findSimilarAlerts(targetAlert, candidateAlerts) {
    const targetLabels = this.extractLabelSet(targetAlert);
    const threshold = this.thresholds[this.phase] || this.thresholds.stable;
    const matches = [];

    for (const candidate of candidateAlerts) {
      if (candidate.fingerprint === targetAlert.fingerprint) continue;

      const candidateLabels = this.extractLabelSet(candidate);
      const similarity = this.jaccardSimilarity(targetLabels, candidateLabels);

      if (similarity >= threshold) {
        matches.push({
          candidate,
          similarity,
        });
      }
    }

    return matches.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * 获取当前阈值
   */
  getCurrentThreshold() {
    return this.thresholds[this.phase] || this.thresholds.stable;
  }
}

// ============================================
// AlertAggregator - 告警聚合策略引擎
// ============================================

class AlertAggregator {
  /**
   * 对一组相关告警进行聚合
   */
  aggregate(alerts, strategy = CONFIG.defaultAggregationStrategy) {
    if (!alerts || alerts.length === 0) return null;

    switch (strategy) {
      case 'max_severity':
        return this.aggregateByMaxSeverity(alerts);
      case 'latest':
        return this.aggregateByLatest(alerts);
      case 'count':
        return this.aggregateByCount(alerts);
      default:
        return this.aggregateByMaxSeverity(alerts);
    }
  }

  /**
   * 按 max_severity 聚合
   */
  aggregateByMaxSeverity(alerts) {
    const severityOrder = { critical: 4, warning: 3, info: 2, unknown: 1 };
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
   */
  aggregateByLatest(alerts) {
    const sorted = [...alerts].sort(
      (a, b) => new Date(b.startsAt || b.receivedAt) - new Date(a.startsAt || a.receivedAt)
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
   */
  aggregateByCount(alerts) {
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

// ============================================
// AutoHealingEngine - 自愈动作执行引擎
// ============================================

class AutoHealingEngine {
  constructor() {
    this.activeActions = new Map();
    this.actionHistory = [];
    this.lastRestartTimes = new Map(); // 用于冷却期检查
  }

  /**
   * 执行自愈动作
   */
  async executeAction(actionId, params, context = {}) {
    const level = this.getActionLevel(actionId);

    if (!CONFIG.autoHeal.enabled) {
      return { status: 'skipped', reason: 'Auto-healing disabled' };
    }

    if (this.activeActions.size >= CONFIG.autoHeal.maxConcurrentActions) {
      return { status: 'queued', reason: 'Max concurrent actions reached' };
    }

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
   * 获取动作级别
   */
  getActionLevel(actionId) {
    if (actionId.startsWith('collect_') || actionId.startsWith('diags_')) return 'L1';
    if (actionId === 'restart_container') return 'L2';
    if (actionId.startsWith('traffic_') || actionId.startsWith('failover_')) return 'L3';
    if (actionId === 'scale_up') return 'L4';
    if (actionId === 'emergency_stop') return 'L5';
    return 'L1'; // 默认为最安全级别
  }

  /**
   * L1: 信息收集（自动执行）
   */
  async executeL1(actionId, params, context) {
    const actionKey = `${actionId}_${Date.now()}`;
    this.activeActions.set(actionKey, { status: 'running', startedAt: Date.now() });

    try {
      const scriptPath = path.join(CONFIG.autoHeal.scriptBasePath, 'collect-diags.sh');
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

      // 记录 Prometheus 指标
      this.recordMetrics('L1', actionId, 'success');

      return { status: 'success', artifacts: result, level: 'L1' };
    } catch (error) {
      this.recordMetrics('L1', actionId, 'failure');
      return { status: 'failed', error: error.message, level: 'L1' };
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
        level: 'L2',
      };
    }

    // 干运行模式
    if (CONFIG.autoHeal.dryRun) {
      return {
        status: 'dry_run',
        message: `[DRY RUN] Would restart container: ${containerName}`,
        preCheck,
        level: 'L2',
      };
    }

    const actionKey = `restart_${containerName}_${Date.now()}`;
    this.activeActions.set(actionKey, { status: 'running', startedAt: Date.now() });

    try {
      // 执行重启脚本
      const scriptPath = path.join(CONFIG.autoHeal.scriptBasePath, 'restart-container.sh');
      const restartResult = await this.runScript(scriptPath, { container: containerName });

      // 记录重启时间（用于冷却期）
      this.lastRestartTimes.set(containerName, Date.now());

      this.recordActionHistory({
        actionId: 'restart_container',
        level: 'L2',
        status: 'success',
        params: { containerName },
        context,
        result: restartResult,
        executedAt: new Date(),
      });

      this.recordMetrics('L2', 'restart_container', 'success');

      return {
        status: 'success',
        containerName,
        result: restartResult,
        level: 'L2',
      };
    } catch (error) {
      this.recordMetrics('L2', 'restart_container', 'failure');
      this.recordActionHistory({
        actionId: 'restart_container',
        level: 'L2',
        status: 'failed',
        params: { containerName },
        error: error.message,
        executedAt: new Date(),
      });

      return { status: 'failed', error: error.message, level: 'L2' };
    } finally {
      this.activeActions.delete(actionKey);
    }
  }

  /**
   * L3: 流量切换（需确认）
   */
  async executeL3(actionId, params, context) {
    // L3 动作需要人工确认
    return {
      status: 'pending_approval',
      level: 'L3',
      actionId,
      params,
      message: 'This action requires manual approval. Please confirm via API.',
      approvalEndpoint: `/api/v1/alerts/clusters/${context.clusterId}/action`,
    };
  }

  /**
   * L4: 扩容（需审批）
   */
  async executeL4(actionId, params, context) {
    // L4 动作需要人工审批
    return {
      status: 'pending_approval',
      level: 'L4',
      actionId,
      params,
      message: 'Scale-up requires manual approval from SRE team.',
      recommendation: `Consider scaling ${params.service} by +${params.increment || 1} instance(s)`,
    };
  }

  /**
   * L5: 紧急停止（仅紧急情况）
   */
  async executeL5(actionId, params, context) {
    // L5 仅在极端情况下执行
    return {
      status: 'blocked',
      level: 'L5',
      message: 'Emergency stop requires explicit operator confirmation and multiple safety checks.',
      emergencyContact: true,
    };
  }

  /**
   * 执行前置安全检查
   */
  async performPreRestartCheck(containerName) {
    const checks = {
      whitelist: CONFIG.restartWhitelist.includes(containerName),
      blacklist: !CONFIG.restartBlacklist.includes(containerName),
      cooldown: this.isCooldownExpired(containerName),
    };

    const allPassed = Object.values(checks).every(Boolean);

    return {
      passed: allPassed,
      reason: allPassed ? null : this.getFailureReason(checks, containerName),
      checks,
    };
  }

  /**
   * 检查冷却期是否已过
   */
  isCooldownExpired(containerName) {
    const lastRestart = this.lastRestartTimes.get(containerName);
    if (!lastRestart) return true;

    const elapsed = (Date.now() - lastRestart) / 1000; // 秒
    return elapsed >= CONFIG.restartCooldownSeconds;
  }

  /**
   * 获取失败原因
   */
  getFailureReason(checks, containerName) {
    if (!checks.whitelist) return `Container "${containerName}" not in restart whitelist`;
    if (!checks.blacklist) return `Container "${containerName}" is in restart blacklist (not allowed)`;
    if (!checks.cooldown) return `Container "${containerName}" is in cooldown period (${CONFIG.restartCooldownSeconds}s)`;
    return 'Unknown safety check failure';
  }

  /**
   * 运行外部脚本
   */
  runScript(scriptPath, params = {}) {
    return new Promise((resolve, reject) => {
      const args = Object.entries(params || {}).flatMap(([k, v]) => [`--${k}`, String(v)]);

      console.log(`[AIOps/AutoHeal] Executing: bash ${scriptPath} ${args.join(' ')}`);

      const child = spawn('bash', [scriptPath, ...args], {
        timeout: 120000,
        env: { ...process.env, ...params },
        cwd: CONFIG.autoHeal.scriptBasePath,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', data => { stdout += data.toString(); });
      child.stderr.on('data', data => { stderr += data.toString(); });

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

  /**
   * 记录 Prometheus 指标
   */
  recordMetrics(level, actionType, result) {
    if (!metrics?.metrics) return;

    try {
      metrics.metrics.aiopsAutoHealTotal?.inc({
        level,
        action_type: actionType,
        result,
      });
    } catch (e) {
      // 忽略指标记录错误
    }
  }

  /**
   * 记录动作历史
   */
  recordActionHistory(record) {
    this.actionHistory.push(record);
    if (this.actionHistory.length > 1000) {
      this.actionHistory = this.actionHistory.slice(-1000);
    }
  }

  /**
   * 获取动作历史
   */
  getActionHistory(limit = 50) {
    return this.actionHistory.slice(-limit);
  }

  /**
   * 获取当前活跃动作数
   */
  getActiveActionCount() {
    return this.activeActions.size;
  }
}

// ============================================
// AlertCorrelationService - 主服务类
// ============================================

class AlertCorrelationService {
  constructor() {
    // 初始化子模块
    this.slidingWindow = new SlidingWindowManager();
    this.topologyGraph = new ServiceTopologyGraph();
    this.rootCauseScorer = new RootCauseScorer(this.topologyGraph);
    this.labelMatcher = new LabelSimilarityMatcher();
    this.aggregator = new AlertAggregator();
    this.autoHealEngine = new AutoHealingEngine();

    // 内存存储
    this.clusters = new Map();       // 活跃集群
    this.clusterHistory = [];         // 集群历史记录
    this.correlationLog = [];         // 关联日志
    this.stats = {
      totalReceived: 0,
      totalCorrelated: 0,
      totalSuppressed: 0,
      totalRaw: 0,
      totalAutoHealed: 0,
      stormEvents: 0,
    };

    // 上次风暴检测时间
    this.lastStormTime = null;

    console.log('[AIOps] AlertCorrelationService initialized');
  }

  /**
   * 1. receiveAlert — 接收来自 AlertManager webhook 的告警
   *
   * @param {object} alert - 标准化后的告警对象
   * @returns {Promise<object>} 关联结果
   */
  async receiveAlert(alert) {
    const startTime = Date.now();
    this.stats.totalReceived++;

    // 确保 alert 有 fingerprint
    if (!alert.fingerprint) {
      alert.fingerprint = this.generateFingerprint(alert);
    }

    console.log(`[AIOps] Received alert: ${alert.alertName || alert.labels?.alertname} [${alert.fingerprint}]`);

    try {
      // 执行关联分析
      const correlationResult = await this.correlate(alert);

      // 记录处理时间
      const duration = (Date.now() - startTime) / 1000;
      this.recordCorrelationDuration(duration);

      // 如果建议了自愈动作且可自动执行
      if (correlationResult.suggestedAction?.autoExecutable && CONFIG.autoHeal.enabled) {
        try {
          const healResult = await this.executeAction(
            correlationResult.suggestedAction.type,
            correlationResult.suggestedAction.params || {},
            { clusterId: correlationResult.clusterId }
          );
          correlationResult.autoHealResult = healResult;

          if (healResult.status === 'success') {
            this.stats.totalAutoHealed++;
          }
        } catch (healError) {
          console.error('[AIOps] Auto-heal failed:', healError.message);
          correlationResult.autoHealError = healError.message;
        }
      }

      return correlationResult;
    } catch (error) {
      console.error('[AIOps] Correlation error:', error.message);
      this.stats.totalRaw++; // 作为原始告警处理

      return {
        success: false,
        error: error.message,
        suppressionDecision: 'raw',
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 2. correlate — 关联分析核心方法
   *
   * @param {object} alert - 标准化后的告警对象
   * @returns {object> {clusterId, rootCause, relatedAlerts, action}
   */
  async correlate(alert) {
    // Step 1: 加入时间窗口
    const windowStatus = this.slidingWindow.addAlert(alert);

    // Step 2: 检测告警风暴
    const isStorm = this.detectStorm(windowStatus);
    if (isStorm) {
      this.stats.stormEvents++;
      console.warn(`[AIOps] ⚠️  Alert storm detected! L1 count: ${windowStatus.L1?.totalInWindow}`);
    }

    // Step 3: 获取同窗口内的其他告警用于关联分析
    const l2Alerts = this.slidingWindow.getAlertsInWindow('L2');

    // Step 4: 拓扑关联分析
    const topologyRelated = this.findTopologyRelatedAlerts(alert, l2Alerts);

    // Step 5: 标签相似度匹配
    const similarAlerts = this.labelMatcher.findSimilarAlerts(alert, l2Alerts);

    // Step 6: 合并所有相关告警
    const allRelated = this.deduplicateRelated([
      ...topologyRelated,
      ...similarAlerts.map(s => s.candidate),
    ]);

    // Step 7: 根因分析
    const candidatesForScoring = [alert, ...allRelated];
    const scoredCandidates = this.rootCauseScorer.scoreCandidates(candidatesForScoring);
    const rootCauseCandidate = scoredCandidates[0];

    // Step 8: 聚合或创建集群
    let clusterId;
    let cluster;

    if (allRelated.length > 0) {
      // 有相关告警 → 创建或更新集群
      const aggregated = this.aggregator.aggregate(candidatesForScoring, 'max_severity');
      clusterId = aggregated.clusterId;
      cluster = {
        ...aggregated,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        rootCause: {
          alertName: rootCauseCandidate?.alert?.alertName || alert.alertName,
          instance: rootCauseCandidate?.alert?.instance || alert.instance,
          score: rootCauseCandidate?.totalScore || 0,
          confidence: this.calculateConfidence(rootCauseCandidate?.totalScore || 0),
          reasoning: this.generateReasoning(rootCauseCandidate),
        },
        relatedAlerts: allRelated.map(a => ({
          alertName: a.alertName,
          instance: a.instance,
          relation: this.classifyRelation(a, alert),
        })),
        stormDetected: isStorm,
      };

      // 存储集群
      this.clusters.set(clusterId, cluster);
      this.stats.totalCorrelated++;
    } else {
      // 无相关告警 → 单独处理
      clusterId = alert.fingerprint;
      cluster = {
        clusterId,
        clusterSize: 1,
        status: 'active',
        rootCause: {
          alertName: alert.alertName,
          instance: alert.instance,
          score: 0.5,
          confidence: 'medium',
          reasoning: 'Single alert, no correlations found',
        },
        relatedAlerts: [],
        stormDetected: isStorm,
      };

      this.stats.totalRaw++;
    }

    // Step 9: 决定抑制策略
    const suppressionDecision = this.decideSuppression(cluster, isStorm);
    if (suppressionDecision === 'suppress') {
      this.stats.totalSuppressed++;
    }

    // Step 10: 生成自愈动作建议
    const suggestedAction = this.suggestAutoHealAction(cluster, rootCauseCandidate);

    // Step 11: 记录关联日志
    this.logCorrelation(alert, cluster, suppressionDecision);

    // 更新 Prometheus 指标
    this.updatePrometheusMetrics(suppressionDecision);

    return {
      success: true,
      correlationId: `corr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      clusterId,
      cluster,
      suppressionDecision,
      suggestedAction,
      processingTimeMs: 0, // 由调用方填充
    };
  }

  /**
   * 3. executeAction — 执行自愈动作
   *
   * @param {string} actionId - 动作标识
   * @param {object} params - 动作参数
   * @returns {Promise<object>} 执行结果
   */
  async executeAction(actionId, params, context = {}) {
    return await this.autoHealEngine.executeAction(actionId, params, context);
  }

  /**
   * 4. getClusterHistory — 查询关联历史
   *
   * @param {string} clusterId - 集群 ID
   * @param {object} timeRange - 时间范围 { start, end }
   * @returns {Promise<Array>}
   */
  async getClusterHistory(clusterId, timeRange = {}) {
    const { start, end } = timeRange;
    const now = Date.now();
    const startTime = start ? new Date(start).getTime() : now - 86400000; // 默认 24 小时
    const endTime = end ? new Date(end).getTime() : now;

    // 查找指定集群的历史记录
    const historyRecords = this.clusterHistory.filter(record => {
      const recordTime = new Date(record.timestamp).getTime();
      return record.clusterId === clusterId &&
             recordTime >= startTime &&
             recordTime <= endTime;
    });

    // 如果没有找到，尝试从活跃集群中获取
    if (historyRecords.length === 0 && this.clusters.has(clusterId)) {
      return [this.clusters.get(clusterId)];
    }

    return historyRecords;
  }

  /**
   * 5. getCorrelationStats — 统计降噪效果
   *
   * @returns {object> 统计数据
   */
  async getCorrelationStats() {
    const totalProcessed = this.stats.totalCorrelated + this.stats.totalSuppressed + this.stats.totalRaw;
    const deduplicationRate = totalProcessed > 0
      ? (this.stats.totalSuppressed / totalProcessed) * 100
      : 0;

    return {
      // 基础统计
      totalReceived: this.stats.totalReceived,
      totalProcessed,
      totalCorrelated: this.stats.totalCorrelated,
      totalSuppressed: this.stats.totalSuppressed,
      totalRaw: this.stats.totalRaw,
      totalAutoHealed: this.stats.totalAutoHealed,
      stormEvents: this.stats.stormEvents,

      // 降噪效果
      deduplicationRate: `${deduplicationRate.toFixed(1)}%`,
      deduplicationTarget: '70%',
      targetMet: deduplicationRate >= 70,

      // 集群统计
      activeClusters: this.clusters.size,
      avgClusterSize: this.calculateAverageClusterSize(),

      // 自愈统计
      autoHealEnabled: CONFIG.autoHeal.enabled,
      activeAutoHealActions: this.autoHealEngine.getActiveActionCount(),
      autoHealHistory: this.autoHealEngine.getActionHistory(10),

      // 系统状态
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      phase: this.labelMatcher.phase,

      // 时间窗口状态
      windowStatus: {
        L1: { count: this.slidingWindow.getActiveCount('L1'), size: '60s' },
        L2: { count: this.slidingWindow.getActiveCount('L2'), size: '5m' },
        L3: { count: this.slidingWindow.getActiveCount('L3'), size: '15m' },
      },

      // 最近关联记录
      recentCorrelations: this.correlationLog.slice(-10),
    };
  }

  /**
   * 获取所有活跃集群
   */
  getActiveClusters() {
    return Array.from(this.clusters.values());
  }

  // ============================================
  // 私有辅助方法
  // ============================================

  /**
   * 生成告警指纹
   */
  generateFingerprint(alert) {
    const keyFields = [
      alert.labels?.alertname || alert.alertName,
      alert.labels?.instance || alert.instance,
      alert.labels?.severity || alert.severity,
    ].filter(Boolean).join('|');

    return crypto.createHash('sha256').update(keyFields).digest('hex').substring(0, 16);
  }

  /**
   * 检测告警风暴
   */
  detectStorm(windowStatus) {
    const now = Date.now();

    // 冷却期内不重复检测
    if (this.lastStormTime && (now - this.lastStormTime) < CONFIG.stormCooldownMs) {
      return false;
    }

    if (windowStatus.L1?.totalInWindow >= CONFIG.stormThreshold) {
      this.lastStormTime = now;
      return true;
    }

    return false;
  }

  /**
   * 查找拓扑相关的告警
   */
  findTopologyRelatedAlerts(targetAlert, candidateAlerts) {
    const related = [];
    const targetInstance = targetAlert.instance || targetAlert.labels?.instance;
    const targetService = this.topologyGraph.mapInstanceToService(targetInstance);

    if (!targetService) return related;

    // 获取目标服务的上游和下游
    const upstreamServices = this.topologyGraph.getUpstream(targetService);
    const downstreamServices = this.topologyGraph.getDownstream(targetService);
    const relatedServices = new Set([...upstreamServices, ...downstreamServices]);

    for (const candidate of candidateAlerts) {
      if (candidate.fingerprint === targetAlert.fingerprint) continue;

      const candidateInstance = candidate.instance || candidate.labels?.instance;
      const candidateService = this.topologyGraph.mapInstanceToService(candidateInstance);

      if (candidateService && relatedServices.has(candidateService)) {
        related.push({
          ...candidate,
          relationType: upstreamServices.includes(candidateService) ? 'upstream' : 'downstream',
        });
      }
    }

    return related;
  }

  /**
   * 去重相关告警列表
   */
  deduplicateRelated(alerts) {
    const seen = new Set();
    const unique = [];

    for (const alert of alerts) {
      if (!seen.has(alert.fingerprint)) {
        seen.add(alert.fingerprint);
        unique.push(alert);
      }
    }

    return unique;
  }

  /**
   * 计算置信度
   */
  calculateConfidence(score) {
    if (score >= 0.8) return 'high';
    if (score >= 0.5) return 'medium';
    return 'low';
  }

  /**
   * 生成根因推理说明
   */
  generateReasoning(candidate) {
    if (!candidate) return 'No root cause analysis available';

    const reasons = [];

    if (candidate.scores?.topology > 0.7) {
      reasons.push('Upstream service with high dependency centrality');
    }
    if (candidate.scores?.freshness > 0.8) {
      reasons.push('Earliest triggered alert in the cluster');
    }
    if (candidate.scores?.severity > 0.8) {
      reasons.push('Highest severity level');
    }

    return reasons.join('; ') || 'Based on multi-dimensional scoring';
  }

  /**
   * 分类关系类型
   */
  classifyRelation(relatedAlert, targetAlert) {
    if (relatedAlert.relationType) return relatedAlert.relationType;

    const targetService = this.topologyGraph.mapInstanceToService(
      targetAlert.instance || targetAlert.labels?.instance
    );
    const relatedService = this.topologyGraph.mapInstanceToService(
      relatedAlert.instance || relatedAlert.labels?.instance
    );

    if (!targetService || !relatedService) return 'similar_labels';

    const path = this.topologyGraph.findPropagationPath(relatedService, targetService);
    if (path && path.length > 1) return 'causal_chain';

    return 'co-occurrence';
  }

  /**
   * 决定抑制策略
   */
  decideSuppression(cluster, isStorm) {
    // 风暴期间：激进抑制
    if (isStorm && cluster.clusterSize > 5) {
      return 'suppress';
    }

    // 大集群：聚合通知
    if (cluster.clusterSize >= 3) {
      return 'aggregate';
    }

    // 单个 critical 告警：始终通知
    if (cluster.clusterSize === 1 && cluster.rootCause?.alertName) {
      const alert = Array.from(this.clusters.values())
        .find(c => c.clusterId === cluster.clusterId);
      if (alert?.severity === 'critical' || alert?.labels?.severity === 'critical') {
        return 'notify';
      }
    }

    // 默认：正常通知
    return 'notify';
  }

  /**
   * 建议自愈动作
   */
  suggestAutoHealAction(cluster, rootCauseCandidate) {
    if (!rootCauseCandidate || !cluster) return null;

    const rootCauseName = rootCauseCandidate.alert?.alertName ||
                          cluster.rootCause?.alertName;
    const instance = rootCauseCandidate.alert?.instance ||
                     cluster.rootCause?.instance;

    // 基于告警类型和实例的动作映射
    const actionMap = {
      APIDown: {
        level: 'L2',
        type: 'restart_container',
        params: { containerName: instance || 'globalreach-api' },
        autoExecutable: true,
        reason: 'API is down, attempting container restart to recover',
      },
      ContainerRestartLoop: {
        level: 'L1',
        type: 'collect_diags',
        params: { target: instance },
        autoExecutable: true,
        reason: 'Container restart loop detected, collecting diagnostics first',
      },
      HighErrorRate: {
        level: 'L1',
        type: 'collect_diags',
        params: { target: instance },
        autoExecutable: true,
        reason: 'High error rate detected, collecting diagnostics before any action',
      },
      APIHealthCritical: {
        level: 'L2',
        type: 'restart_container',
        params: { containerName: instance || 'globalreach-api' },
        autoExecutable: true,
        reason: 'Critical health degradation, attempting restart as recovery',
      },
      NodeHighMemory: {
        level: 'L1',
        type: 'collect_diags',
        params: { target: instance },
        autoExecutable: true,
        reason: 'Memory pressure detected, diagnostics collection recommended',
      },
      PostgresConnectionHigh: {
        level: 'L1',
        type: 'collect_diags',
        params: { target: 'postgresql' },
        autoExecutable: false, // 数据库问题不建议自动操作
        reason: 'Database connection pressure, manual investigation required',
      },
    };

    return actionMap[rootCauseName] || {
      level: 'L1',
      type: 'collect_diags',
      params: { target: instance },
      autoExecutable: true,
      reason: 'Default action: collect diagnostic information',
    };
  }

  /**
   * 记录关联日志
   */
  logCorrelation(alert, cluster, decision) {
    this.correlationLog.push({
      timestamp: new Date(),
      alertFingerprint: alert.fingerprint,
      alertName: alert.alertName,
      clusterId: cluster.clusterId,
      clusterSize: cluster.clusterSize,
      decision,
    });

    // 保持最近 1000 条
    if (this.correlationLog.length > 1000) {
      this.correlationLog = this.correlationLog.slice(-1000);
    }

    // 同时记录到集群历史
    this.clusterHistory.push({
      ...cluster,
      timestamp: new Date(),
    });

    if (this.clusterHistory.length > 5000) {
      this.clusterHistory = this.clusterHistory.slice(-5000);
    }
  }

  /**
   * 记录关联耗时
   */
  recordCorrelationDuration(durationSeconds) {
    if (!metrics?.metrics) return;

    try {
      metrics.metrics.aiopsCorrelationDurationSeconds?.observe(
        { algorithm: 'temporal' },
        durationSeconds
      );
    } catch (e) {
      // 忽略
    }
  }

  /**
   * 更新 Prometheus 指标
   */
  updatePrometheusMetrics(decision) {
    if (!metrics?.metrics) return;

    try {
      // 映射决策到指标标签
      const statusMap = {
        notify: 'raw',
        aggregate: 'correlated',
        suppress: 'suppressed',
      };

      metrics.metrics.aiopsAlertsTotal?.inc({
        status: statusMap[decision] || 'raw',
      });

      // 更新活跃集群数
      metrics.metrics.aiopsActiveClusters?.set(this.clusters.size);

      // 计算并更新降噪率
      const total = this.stats.totalCorrelated + this.stats.totalSuppressed + this.stats.totalRaw;
      if (total > 0) {
        const rate = this.stats.totalSuppressed / total;
        metrics.metrics.aiopsDeduplicationRate?.set(rate);
      }
    } catch (e) {
      // 忽略指标更新错误
    }
  }

  /**
   * 计算平均集群大小
   */
  calculateAverageClusterSize() {
    if (this.clusters.size === 0) return 0;

    let total = 0;
    for (const cluster of this.clusters.values()) {
      total += cluster.clusterSize || 1;
    }

    return (total / this.clusters.size).toFixed(1);
  }

  /**
   * 销毁服务（清理资源）
   */
  destroy() {
    this.slidingWindow.destroy();
    this.clusters.clear();
    console.log('[AIOps] AlertCorrelationService destroyed');
  }
}

// ============================================
// 导出单例
// ============================================

const alertCorrelationService = new AlertCorrelationService();

module.exports = {
  AlertCorrelationService,
  alertCorrelationService,
  // 子模块导出（供测试使用)
  SlidingWindowManager,
  ServiceTopologyGraph,
  RootCauseScorer,
  LabelSimilarityMatcher,
  AlertAggregator,
  AutoHealingEngine,
};
