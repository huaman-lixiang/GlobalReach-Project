/**
 * Audit Routes (N03) — 审计日志查询与管理API
 *
 * 端点：
 * GET  /api/v1/audit/logs          — 审计日志列表(分页/筛选/排序)
 * GET  /api/v1/audit/logs/export     — 导出审计日志(CSV格式, 仅admin)
 * GET  /api/v1/audit/stats          — 审计统计仪表盘
 * GET  /api/v1/audit/timeline/:userId — 用户操作时间线(合规审查用)
 *
 * 权限要求：
 * - 所有端点需要认证
 * - 导出功能仅限ADMIN角色
 * - 普通用户只能查看自己的操作时间线
 */

const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { auditLogger, ACTION_TYPES, SEVERITY } = require('../middleware/auditLogger');
const db = require('../db');
const { Op } = require('sequelize');

// ============================================
// 所有路由需要认证
// ============================================
router.use(verifyToken);

// ============================================
// GET /api/v1/audit/logs — 审计日志列表
// ============================================
router.get('/logs', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      userId,
      action,
      resourceType,
      startDate,
      endDate,
      severity,
      status,
      sortBy = 'createdAt',
      sortOrder = 'DESC',
    } = req.query;

    // 构建查询条件
    const where = {};

    // 非管理员只能查看自己的日志
    if (req.user.role !== 'ADMIN') {
      where.userId = req.user.id;
    } else if (userId) {
      where.userId = userId;
    }

    if (action) where.action = action;
    if (resourceType) where.resourceType = resourceType;
    if (severity) where.severity = severity;
    if (status) where.status = status;

    // 时间范围过滤
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    // 验证排序字段（防止SQL注入）
    const allowedSortFields = ['createdAt', 'action', 'resourceType', 'severity', 'status'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const orderDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // 分页参数
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = Math.min(parseInt(limit), 100); // 最大100条

    // 查询审计日志
    const { count, rows: logs } = await db.AuditLog.findAndCountAll({
      where,
      order: [[sortField, orderDirection]],
      offset,
      limit: limitNum,
      include: [
        {
          model: db.User,
          as: 'user',
          attributes: ['id', 'email', 'name', 'role'],
          required: false,
        },
      ],
    });

    // 记录本次查询操作
    await auditLogger.logDataAccess(req, 'audit_log', null, ACTION_TYPES.READ);

    res.json({
      success: true,
      data: {
        logs: logs.map(log => ({
          id: log.id,
          userId: log.userId,
          user: log.user ? {
            id: log.user.id,
            email: log.user.email,
            name: log.user.name,
            role: log.user.role,
          } : null,
          action: log.action,
          resourceType: log.resourceType,
          resourceId: log.resourceId,
          ipAddress: log.ipAddress,
          userAgent: log.userAgent ? log.userAgent.substring(0, 200) : null,
          details: log.details ? JSON.parse(log.details) : null,
          severity: log.severity,
          status: log.status,
          sessionId: log.sessionId,
          createdAt: log.createdAt,
        })),
        pagination: {
          total: count,
          page: parseInt(page),
          limit: limitNum,
          totalPages: Math.ceil(count / limitNum),
        },
      },
    });
  } catch (error) {
    console.error('[Audit] Failed to fetch logs:', error);
    res.status(500).json({
      success: false,
      error: 'AUDIT_LOG_FETCH_FAILED',
      message: 'Failed to fetch audit logs',
    });
  }
});

// ============================================
// GET /api/v1/audit/logs/export — 导出审计日志(CSV)
// ============================================
router.get('/logs/export', requireRole('ADMIN'), async (req, res) => {
  try {
    const {
      userId,
      action,
      resourceType,
      startDate,
      endDate,
      severity,
      status,
    } = req.query;

    const where = {};

    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (resourceType) where.resourceType = resourceType;
    if (severity) where.severity = severity;
    if (status) where.status = status;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    // 查询所有匹配的日志（导出不分页，但限制最大数量）
    const logs = await db.AuditLog.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 50000, // 最大导出5万条
      include: [
        {
          model: db.User,
          as: 'user',
          attributes: ['email', 'name'],
          required: false,
        },
      ],
    });

    // 生成CSV内容
    const csvHeader = 'ID,用户ID,用户邮箱,用户名,操作类型,资源类型,资源ID,IP地址,严重级别,状态,详情,时间戳\n';
    const csvRows = logs.map(log => [
      log.id,
      log.userId,
      log.user?.email || '',
      log.user?.name || '',
      log.action,
      log.resourceType || '',
      log.resourceId || '',
      log.ipAddress || '',
      log.severity,
      log.status,
      `"${(log.details || '').replace(/"/g, '""')}"`, // CSV转义双引号
      log.createdAt.toISOString(),
    ].join(','));

    const csvContent = csvHeader + csvRows.join('\n');

    // 记录导出操作
    await auditLogger.log(req, {
      action: ACTION_TYPES.EXPORT_DATA,
      resourceType: 'audit_log',
      details: {
        format: 'csv',
        recordCount: logs.length,
        filters: { userId, action, resourceType, startDate, endDate },
      },
      severity: SEVERITY.INFO,
    });

    // 设置响应头
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=audit-logs-${new Date().toISOString().split('T')[0]}.csv`);

    // 添加UTF-8 BOM以支持Excel正确显示中文
    res.send('\uFEFF' + csvContent);
  } catch (error) {
    console.error('[Audit] Export failed:', error);
    res.status(500).json({
      success: false,
      error: 'AUDIT_EXPORT_FAILED',
      message: 'Failed to export audit logs',
    });
  }
});

// ============================================
// GET /api/v1/audit/stats — 审计统计仪表盘
// ============================================
router.get('/stats', requireRole('ADMIN'), async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 并行执行所有统计查询
    const [
      todayTotal,
      yesterdayTotal,
      weekTotal,
      monthTotal,

      // 操作类型分布
      actionDistribution,

      // 严重级别分布
      severityDistribution,

      // 状态分布
      statusDistribution,

      // 活跃用户Top10
      activeUsersTop10,

      // 异常事件趋势（最近7天）
      anomalyTrend,

      // 资源访问分布
      resourceDistribution,
    ] = await Promise.all([
      // 今日操作总数
      db.AuditLog.count({ where: { createdAt: { [Op.gte]: today } } }),

      // 昨日操作总数
      db.AuditLog.count({ where: { createdAt: { [Op.between]: [yesterday, today] } } }),

      // 近7天操作数
      db.AuditLog.count({ where: { createdAt: { [Op.gte]: sevenDaysAgo } } }),

      // 近30天操作数
      db.AuditLog.count({ where: { createdAt: { [Op.gte]: thirtyDaysAgo } } }),

      // 操作类型分布（近30天）
      db.AuditLog.findAll({
        attributes: [
          'action',
          [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
        ],
        where: { createdAt: { [Op.gte]: thirtyDaysAgo } },
        group: ['action'],
        order: [[db.sequelize.fn('COUNT', db.sequelize.col('id')), 'DESC']],
        limit: 15,
        raw: true,
      }),

      // 严重级别分布（近30天）
      db.AuditLog.findAll({
        attributes: [
          'severity',
          [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
        ],
        where: { createdAt: { [Op.gte]: thirtyDaysAgo } },
        group: ['severity'],
        raw: true,
      }),

      // 成功/失败分布（近30天）
      db.AuditLog.findAll({
        attributes: [
          'status',
          [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
        ],
        where: { createdAt: { [Op.gte]: thirtyDaysAgo } },
        group: ['status'],
        raw: true,
      }),

      // 活跃用户Top10（近30天）
      db.AuditLog.findAll({
        attributes: [
          'userId',
          [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
        ],
        where: {
          createdAt: { [Op.gte]: thirtyDaysAgo },
          userId: { [Op.ne]: null },
        },
        group: ['userId'],
        order: [[db.sequelize.fn('COUNT', db.sequelize.col('id')), 'DESC']],
        limit: 10,
        include: [{
          model: db.User,
          as: 'user',
          attributes: ['email', 'name'],
          required: true,
        }],
        raw: false,
      }),

      // 异常事件趋势（近7天，按天统计WARN/ERROR/CRITICAL）
      Promise.all(Array.from({ length: 7 }, async (_, i) => {
        const date = new Date(today);
        date.setDate(date.getDate() - (6 - i));
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);

        const count = await db.AuditLog.count({
          where: {
            createdAt: { [Op.between]: [date, nextDate] },
            severity: { [Op.in]: ['WARN', 'ERROR', 'CRITICAL'] },
          },
        });

        return {
          date: date.toISOString().split('T')[0],
          anomalyCount: count,
        };
      })),

      // 资源类型分布（近30天）
      db.AuditLog.findAll({
        attributes: [
          'resourceType',
          [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
        ],
        where: { createdAt: { [Op.gte]: thirtyDaysAgo } },
        group: ['resourceType'],
        order: [[db.sequelize.fn('COUNT', db.sequelize.col('id')), 'DESC']],
        raw: true,
      }),
    ]);

    res.json({
      success: true,
      data: {
        summary: {
          todayTotal,
          yesterdayTotal,
          weekTotal,
          monthTotal,
          growthRate: yesterdayTotal > 0
            ? ((todayTotal - yesterdayTotal) / yesterdayTotal * 100).toFixed(1)
            : 0,
        },

        distributions: {
          byAction: actionDistribution.map(item => ({
            action: item.action,
            count: parseInt(item.count),
          })),
          bySeverity: severityDistribution.map(item => ({
            severity: item.severity,
            count: parseInt(item.count),
          })),
          byStatus: statusDistribution.map(item => ({
            status: item.status,
            count: parseInt(item.count),
          })),
          byResource: resourceDistribution.map(item => ({
            resourceType: item.resourceType,
            count: parseInt(item.count),
          })),
        },

        topActiveUsers: activeUsersTop10.map((item, index) => ({
          rank: index + 1,
          userId: item.userId,
          email: item.user?.email,
          name: item.user?.name,
          actionCount: parseInt(item.dataValues?.count || item.count),
        })),

        anomalyTrend,
      },
    });
  } catch (error) {
    console.error('[Audit] Stats failed:', error);
    res.status(500).json({
      success: false,
      error: 'AUDIT_STATS_FAILED',
      message: 'Failed to generate audit statistics',
    });
  }
});

// ============================================
// GET /api/v1/audit/timeline/:userId — 用户操作时间线
// ============================================
router.get('/timeline/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate, limit = 50 } = req.query;

    // 权限检查：非管理员只能查看自己的时间线
    if (req.user.role !== 'ADMIN' && req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'ACCESS_DENIED',
        message: 'You can only view your own timeline',
      });
    }

    const where = { userId };

    // 时间范围
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    // 查询用户的操作时间线
    const logs = await db.AuditLog.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: Math.min(parseInt(limit), 200),
    });

    // 统计该用户的操作摘要
    const summary = await db.AuditLog.findAll({
      attributes: [
        'action',
        [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
      ],
      where: { userId },
      group: ['action'],
      order: [[db.sequelize.fn('COUNT', db.sequelize.col('id')), 'DESC']],
      raw: true,
    });

    // 记录查看时间线的操作
    await auditLogger.logDataAccess(req, 'user_timeline', userId, ACTION_TYPES.READ);

    res.json({
      success: true,
      data: {
        userId,
        timeline: logs.map(log => ({
          id: log.id,
          action: log.action,
          resourceType: log.resourceType,
          resourceId: log.resourceId,
          ipAddress: log.ipAddress,
          severity: log.severity,
          status: log.status,
          details: log.details ? JSON.parse(log.details) : null,
          createdAt: log.createdAt,
        })),

        summary: summary.map(item => ({
          action: item.action,
          count: parseInt(item.count),
        })),

        totalActions: logs.length,
      },
    });
  } catch (error) {
    console.error('[Audit] Timeline failed:', error);
    res.status(500).json({
      success: false,
      error: 'TIMELINE_FETCH_FAILED',
      message: 'Failed to fetch user timeline',
    });
  }
});

module.exports = router;
