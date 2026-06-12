/**
 * AlertCorrelation Routes - AIOps 智能告警降噪 API 路由
 *
 * S132/O01: AIOps Smart Alert Deduplication System
 *
 * 端点:
 * - POST /api/v1/alerts/correlate     — 接收并关联单条告警
 * - GET  /api/v1/alerts/clusters      — 列出活跃的告警集群
 * - GET  /api/v1/alerts/clusters/:id  — 集群详情（含根因分析）
 * - POST /api/v1/alerts/clusters/:id/action — 对集群执行自愈动作
 * - GET  /api/v1/alerts/stats         — AIOps 统计仪表盘数据
 * - GET  /api/v1/alerts/history       — 历史告警关联记录
 */

const express = require('express');
const router = express.Router();
const { verifyToken, optionalAuth } = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimiter');
const { asyncHandler } = require('../middleware/errorHandler');
const { alertCorrelationService } = require('../services/alertCorrelationService');

// S152: 标准安全中间件链
// Note: /correlate endpoint uses optionalAuth to allow webhook-based alerts
// All other endpoints require full authentication
router.use(rateLimiter);

// ============================================
// POST /api/v1/alerts/correlate
// 接收并关联单条告警（来自外部系统或 Webhook）
// S152: 使用 optionalAuth 允许 webhook 调用，但优先使用认证用户信息
// ============================================

router.post('/correlate', optionalAuth, asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { alert, source, metadata } = req.body;

  // 验证必填字段
  if (!alert) {
    return res.status(400).json({
      success: false,
      error: 'MISSING_ALERT',
      message: 'Request body must contain "alert" object',
    });
  }

  // 标准化告警对象
  const normalizedAlert = {
    fingerprint: alert.fingerprint,
    alertName: alert.alertName || alert.labels?.alertname || 'unnamed',
    severity: alert.severity || alert.labels?.severity || 'unknown',
    instance: alert.instance || alert.labels?.instance,
    team: alert.team || alert.labels?.team,
    summary: alert.summary || alert.annotations?.summary,
    description: alert.description || alert.annotations?.description,
    startsAt: alert.startsAt || new Date().toISOString(),
    endsAt: alert.endsAt,
    receivedAt: new Date(),
    labels: alert.labels || {},
    annotations: alert.annotations || {},
    status: alert.status || 'firing',
    source: source || 'api',
  };

  // 执行关联分析
  const result = await alertCorrelationService.receiveAlert(normalizedAlert);
  result.processingTimeMs = Date.now() - startTime;

  res.status(200).json({
    success: true,
    message: 'Alert correlation completed',
    ...result,
  });
}));

// ============================================
// GET /api/v1/alerts/clusters
// 列出活跃的告警集群
// ============================================

router.get('/clusters', verifyToken, asyncHandler(async (req, res) => {
  const { status, limit, severity } = req.query;

  let clusters = alertCorrelationService.getActiveClusters();

  // 过滤状态
  if (status && status !== 'all') {
    clusters = clusters.filter(c => c.status === status);
  }

  // 过滤严重程度
  if (severity) {
    clusters = clusters.filter(c =>
      c.rootCause?.alertName &&
      (c.severity === severity || c.labels?.severity === severity)
    );
  }

  // 限制返回数量
  const limitNum = parseInt(limit) || 50;
  clusters = clusters.slice(0, limitNum);

  res.json({
    success: true,
    total: clusters.length,
    clusters: clusters.map(cluster => ({
      id: cluster.clusterId,
      status: cluster.status,
      createdAt: cluster.createdAt,
      updatedAt: cluster.updatedAt,
      size: cluster.clusterSize,
      rootCause: {
        alertName: cluster.rootCause?.alertName,
        instance: cluster.rootCause?.instance,
        severity: cluster.severity || cluster.labels?.severity,
        confidence: cluster.rootCause?.confidence,
        score: cluster.rootCause?.score,
      },
      topAffectedServices: [
        ...new Set([
          cluster.instance || cluster.labels?.instance,
          ...(cluster.relatedAlerts?.map(r => r.instance) || []),
        ].filter(Boolean)),
      ].slice(0, 5),
      stormDetected: cluster.stormDetected,
      suppressionDecision: cluster.suppressionDecision,
      suggestedAction: cluster.suggestedAction ? {
        level: cluster.suggestedAction.level,
        type: cluster.suggestedAction.type,
        autoExecutable: cluster.suggestedAction.autoExecutable,
      } : null,
    })),
  });
}));

// ============================================
// GET /api/v1/alerts/clusters/:id
// 集群详情（含完整的根因分析）
// ============================================

router.get('/clusters/:id', verifyToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const clusters = alertCorrelationService.getActiveClusters();

  // 查找指定集群
  const cluster = clusters.find(c => c.clusterId === id);

  if (!cluster) {
    // 尝试从历史记录中查找
    const history = await alertCorrelationService.getClusterHistory(id);
    if (history.length > 0) {
      return res.json({
        success: true,
        cluster: history[0],
        source: 'history',
      });
    }

    return res.status(404).json({
      success: false,
      error: 'CLUSTER_NOT_FOUND',
      message: `Cluster "${id}" not found in active or historical records`,
    });
  }

  res.json({
    success: true,
    cluster: {
      ...cluster,

      // 增强的根因分析详情
      rootCauseAnalysis: {
        candidate: cluster.rootCause,
        scoringBreakdown: {
          topology: cluster.rootCause?._scores?.topology,
          freshness: cluster.rootCause?._scores?.freshness,
          severity: cluster.rootCause?._scores?.severity,
          frequency: cluster.rootCause?._scores?.frequency,
          history: cluster.rootCause?._scores?.history,
        },
        alternativeCandidates: [],
      },

      // 关联的告警详情
      relatedAlertsDetails: (cluster.relatedAlerts || []).map(rel => ({
        alertName: rel.alertName,
        instance: rel.instance,
        relationType: rel.relationType || rel.relation,
        severity: rel.severity,
        timestamp: rel.startsAt || rel.timestamp,
      })),

      // 自愈动作历史
      autoHealHistory: alertCorrelationService.autoHealEngine
        ?.getActionHistory()
        ?.filter(a => a.context?.clusterId === id)
        ?.slice(-10) || [],
    },
  });
}));

// ============================================
// POST /api/v1/alerts/clusters/:id/action
// 对集群执行自愈动作
// ============================================

router.post('/clusters/:id/action', verifyToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { actionId, params, confirmed, operatorId } = req.body;

  // 验证必填字段
  if (!actionId) {
    return res.status(400).json({
      success: false,
      error: 'MISSING_ACTION_ID',
      message: 'Request body must contain "actionId"',
    });
  }

  // 验证集群存在
  const clusters = alertCorrelationService.getActiveClusters();
  const cluster = clusters.find(c => c.clusterId === id);

  if (!cluster) {
    return res.status(404).json({
      success: false,
      error: 'CLUSTER_NOT_FOUND',
      message: `Cluster "${id}" not found`,
    });
  }

  // L3+ 动作需要确认
  const actionLevel = actionId.includes('restart') ? 'L2' :
                     actionId.includes('collect') || actionId.includes('diags') ? 'L1' :
                     actionId.includes('traffic') || actionId.includes('failover') ? 'L3' :
                     actionId.includes('scale') ? 'L4' :
                     actionId.includes('emergency') || actionId.includes('stop') ? 'L5' : 'L1';

  if ((actionLevel === 'L3' || actionLevel === 'L4' || actionLevel === 'L5') && !confirmed) {
    return res.json({
      success: true,
      status: 'pending_confirmation',
      message: `Action ${actionId} (Level ${actionLevel}) requires explicit confirmation`,
      action: {
        id: actionId,
        level: actionLevel,
        params,
        riskAssessment: assessActionRisk(actionLevel, cluster),
      },
      confirmEndpoint: `/api/v1/alerts/clusters/${id}/action`,
      instructions: 'Re-send request with "confirmed": true to execute',
    });
  }

  // 记录操作者信息
  const context = {
    clusterId: id,
    operatorId: operatorId || req.user?.id || 'system',
    confirmedAt: confirmed ? new Date() : null,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
  };

  // 执行动作
  const result = await alertCorrelationService.executeAction(actionId, params || {}, context);

  res.json({
    success: true,
    actionResult: result,
    executedAt: new Date(),
    clusterId: id,
  });
}));

/**
 * 评估动作风险等级
 */
function assessActionRisk(actionLevel, cluster) {
  const riskLevels = {
    L1: { level: 'minimal', description: 'Information collection only, no system modification' },
    L2: { level: 'low', description: 'Service restart may cause brief interruption (~10-30s)' },
    L3: { level: 'medium', description: 'Traffic switching may affect user experience temporarily' },
    L4: { level: 'high', description: 'Scaling changes infrastructure and incurs additional cost' },
    L5: { level: 'critical', description: 'Emergency stop will cause service outage for all users' },
  };

  const baseRisk = riskLevels[actionLevel] || riskLevels.L1;

  return {
    ...baseRisk,
    affectedServices: [
      cluster.instance || cluster.labels?.instance,
      ...(cluster.relatedAlerts || []).map(r => r.instance),
    ].filter(Boolean),
    estimatedImpact: estimateImpact(actionLevel, cluster),
    rollbackAvailable: actionLevel !== 'L5',
  };
}

/**
 * 估算影响范围
 */
function estimateImpact(actionLevel, cluster) {
  const size = cluster.clusterSize || 1;

  switch (actionLevel) {
    case 'L2':
      return `${size} container(s) will be restarted`;
    case 'L3':
      return `Traffic for ~${size * 100} concurrent users may be affected`;
    case 'L4':
      return `Infrastructure cost increase of ~$${size * 10}/hour estimated`;
    case 'L5':
      return `Complete outage for ${size} service(s), affecting all users`;
    default:
      return 'Minimal impact expected';
  }
}

// ============================================
// GET /api/v1/alerts/stats
// AIOps 统计仪表盘数据
// ============================================

router.get('/stats', verifyToken, asyncHandler(async (req, res) => {
  const stats = await alertCorrelationService.getCorrelationStats();

  res.json({
    success: true,
    timestamp: new Date(),
    ...stats,
  });
}));

// ============================================
// GET /api/v1/alerts/history
// 历史告警关联记录
// ============================================

router.get('/history', verifyToken, asyncHandler(async (req, res) => {
  const { limit, start, end, decision, clusterId } = req.query;
  const limitNum = parseInt(limit) || 100;

  // 从服务获取基础统计（包含 recentCorrelations）
  const stats = await alertCorrelationService.getCorrelationStats();
  let history = stats.recentCorrelations || [];

  // 按 clusterId 过滤
  if (clusterId) {
    history = history.filter(h => h.clusterId === clusterId);
  }

  // 按决策类型过滤
  if (decision && decision !== 'all') {
    history = history.filter(h => h.decision === decision);
  }

  // 按时间过滤
  if (start || end) {
    const startTime = start ? new Date(start).getTime() : 0;
    const endTime = end ? new Date(end).getTime() : Date.now();
    history = history.filter(h => {
      const t = new Date(h.timestamp).getTime();
      return t >= startTime && t <= endTime;
    });
  }

  // 限制数量
  history = history.slice(0, limitNum);

  res.json({
    success: true,
    total: history.length,
    history,
  });
}));

// ============================================
// GET /api/v1/alerts/health
// AIOps 服务健康检查端点
// ============================================

router.get('/health', async (req, res) => {
  try {
    const stats = await alertCorrelationService.getCorrelationStats();

    const healthStatus = {
      status: 'operational',
      uptime: stats.uptime,
      memoryUsage: stats.memoryUsage,
      components: {
        slidingWindow: { status: 'healthy', activeAlerts: stats.windowStatus?.L1?.count },
        topologyGraph: { status: 'healthy', nodesLoaded: true },
        rootCauseScorer: { status: 'healthy' },
        labelMatcher: { status: 'healthy', phase: stats.phase },
        autoHealEngine: {
          status: stats.autoHealEnabled ? 'active' : 'disabled',
          activeActions: stats.activeAutoHealActions,
        },
      },
      metrics: {
        totalProcessed: stats.totalProcessed,
        deduplicationRate: stats.deduplicationRate,
        targetMet: stats.targetMet,
        activeClusters: stats.activeClusters,
      },
    };

    // 判断整体状态
    const issues = [];
    if (stats.memoryUsage?.heapUsed > 300 * 1024 * 1024) {
      issues.push('High memory usage');
      healthStatus.components.memory = { status: 'warning' };
    }
    if (stats.activeClusters > 50) {
      issues.push('High number of active clusters');
    }

    if (issues.length > 0) {
      healthStatus.status = 'degraded';
      healthStatus.issues = issues;
    }

    res.json({
      success: true,
      ...healthStatus,
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'unavailable',
      error: error.message,
    });
  }
});

module.exports = router;
