/**
 * Compliance Report Service (N03) — 合规报告生成器
 *
 * 功能：
 * 1. 用户数据报告 - 导出指定用户的全部数据(GDPR DSAR请求支持)
 * 2. 数据处理活动报告 - 统计一定时期内的数据处理活动
 * 3. 访问控制报告 - 谁在什么时间访问了什么数据
 * 4. 安全事件报告 - 安全相关事件的汇总
 * 5. 数据保留报告 - 各类数据的存储时长和保留策略
 *
 * 适用法规：
 * - GDPR (欧盟通用数据保护条例)
 * - PIPL (中国个人信息保护法)
 * - SOC 2 Type II (企业级安全标准)
 */

const db = require('../db');
const { Op } = require('sequelize');

class ComplianceReportService {
  /**
   * 生成用户完整数据报告（GDPR Art.15 数据访问权）
   * @param {string} userId - 用户ID
   * @returns {Promise<Object>} 用户的所有个人数据
   */
  async generateUserDataReport(userId) {
    try {
      // 并行查询用户所有相关数据
      const [
        userProfile,
        accounts,
        clients,
        campaigns,
        emails,
        auditLogs,
      ] = await Promise.all([
        // 用户基本信息
        db.User.findByPk(userId, {
          attributes: { exclude: ['passwordHash'] },
        }),

        // 邮箱账户信息
        db.EmailAccount.findAll({
          where: { userId },
          attributes: { exclude: ['passwordEncrypted'] },
        }),

        // 客户数据
        db.Client.findAll({
          where: { userId },
        }),

        // 营销活动
        db.Campaign.findAll({
          where: { userId },
        }),

        // 邮件记录（最近1000条）
        db.Email.findAll({
          where: { userId },
          limit: 1000,
          order: [['createdAt', 'DESC']],
          attributes: { exclude: ['bodyHtml', 'bodyText'] }, // 排除大字段
        }),

        // 审计日志（最近500条）
        db.AuditLog.findAll({
          where: { userId },
          limit: 500,
          order: [['createdAt', 'DESC']],
        }),
      ]);

      return {
        reportType: 'USER_DATA_EXPORT',
        generatedAt: new Date().toISOString(),
        userId,
        regulation: 'GDPR Art.15 / PIPL 第44条',

        data: {
          profile: userProfile?.toJSON() || null,

          accounts: accounts.map(acc => acc.toJSON()),

          clients: clients.map(client => client.toJSON()),

          campaigns: campaigns.map(campaign => campaign.toJSON()),

          emails: {
            total: await db.Email.count({ where: { userId } }),
            recent: emails.map(email => email.toJSON()),
          },

          auditTrail: {
            total: await db.AuditLog.count({ where: { userId } }),
            recent: auditLogs.map(log => log.toJSON()),
          },
        },

        dataSummary: {
          accountCount: accounts.length,
          clientCount: clients.length,
          campaignCount: campaigns.length,
          totalEmails: await db.Email.count({ where: { userId } }),
          totalAuditLogs: await db.AuditLog.count({ where: { userId } }),
        },
      };
    } catch (error) {
      console.error('[Compliance] User data report failed:', error);
      throw error;
    }
  }

  /**
   * 生成数据处理活动报告（GDPR Art.30）
   * @param {Object} options - 查询选项
   * @returns {Promise<Object>} 数据处理活动统计
   */
  async generateDataProcessingReport(options = {}) {
    const {
      startDate,
      endDate,
      tenantId,
    } = options;

    const dateFilter = {};
    if (startDate) dateFilter[Op.gte] = new Date(startDate);
    if (endDate) dateFilter[Op.lte] = new Date(endDate);

    try {
      const whereClause = {};
      if (dateFilter.createdAt) whereClause.createdAt = dateFilter;
      if (tenantId) whereClause.tenantId = tenantId;

      // 并行查询各类处理活动
      const [
        userStats,
        clientStats,
        campaignStats,
        emailStats,
        auditStats,

        // 数据操作类型分布
        createOperations,
        readOperations,
        updateOperations,
        deleteOperations,
      ] = await Promise.all([
        // 用户数据操作统计
        db.AuditLog.count({
          where: { ...whereClause, resourceType: 'user' },
        }),

        // 客户数据操作统计
        db.AuditLog.count({
          where: { ...whereClause, resourceType: 'client' },
        }),

        // 活动数据操作统计
        db.AuditLog.count({
          where: { ...whereClause, resourceType: 'campaign' },
        }),

        // 邮件数据操作统计
        db.AuditLog.count({
          where: { ...whereClause, resourceType: 'email' },
        }),

        // 总审计日志数
        db.AuditLog.count({ where: whereClause }),

        // CREATE操作统计
        db.AuditLog.count({
          where: { ...whereClause, action: 'CREATE' },
        }),

        // READ操作统计
        db.AuditLog.count({
          where: { ...whereClause, action: 'READ' },
        }),

        // UPDATE操作统计
        db.AuditLog.count({
          where: { ...whereClause, action: 'UPDATE' },
        }),

        // DELETE操作统计
        db.AuditLog.count({
          where: { ...whereClause, action: 'DELETE' },
        }),
      ]);

      return {
        reportType: 'DATA_PROCESSING_ACTIVITY',
        generatedAt: new Date().toISOString(),
        period: { startDate, endDate },
        regulation: 'GDPR Art.30 / PIPL 第52条',

        processingActivities: {
          totalOperations: auditStats,
          byResourceType: {
            userData: userStats,
            clientData: clientStats,
            campaignData: campaignStats,
            emailData: emailStats,
          },

          byOperationType: {
            create: createOperations,
            read: readOperations,
            update: updateOperations,
            delete: deleteOperations,
          },
        },

        dataSubjects: {
          totalUsers: await db.User.count({
            where: dateFilter.createdAt ? { createdAt: dateFilter } : {},
          }),
          totalClients: await db.Client.count({
            where: dateFilter.createdAt ? { createdAt: dateFilter } : {},
          }),
        },
      };
    } catch (error) {
      console.error('[Compliance] Data processing report failed:', error);
      throw error;
    }
  }

  /**
   * 生成访问控制报告（谁在什么时间访问了什么数据）
   * @param {Object} options - 查询选项
   * @returns {Promise<Object>} 访问控制详情
   */
  async generateAccessControlReport(options = {}) {
    const {
      startDate,
      endDate,
      userId,
      resourceType,
    } = options;

    const where = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }
    if (userId) where.userId = userId;
    if (resourceType) where.resourceType = resourceType;

    try {
      // 查询访问日志
      const accessLogs = await db.AuditLog.findAll({
        where,
        order: [['createdAt', 'DESC']],
        limit: 1000,
        include: [{
          model: db.User,
          as: 'user',
          attributes: ['id', 'email', 'name', 'role'],
          required: false,
        }],
      });

      // 统计每个用户的访问次数
      const userAccessCounts = await db.AuditLog.findAll({
        attributes: [
          'userId',
          [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'accessCount'],
        ],
        where,
        group: ['userId'],
        order: [[db.sequelize.fn('COUNT', db.sequelize.col('id')), 'DESC']],
        limit: 20,
        raw: true,
      });

      // 获取这些用户的详细信息
      const userIds = userAccessCounts.map(u => u.userId);
      const usersInfo = await db.User.findAll({
        where: { id: { [Op.in]: userIds } },
        attributes: ['id', 'email', 'name', 'role'],
      });

      const userMap = {};
      usersInfo.forEach(u => { userMap[u.id] = u; });

      return {
        reportType: 'ACCESS_CONTROL',
        generatedAt: new Date().toISOString(),
        period: { startDate, endDate },
        filters: { userId, resourceType },

        summary: {
          totalAccessEvents: accessLogs.length,
          uniqueUsers: userAccessCounts.length,
        },

        topUsersByAccess: userAccessCounts.map(item => ({
          userId: item.userId,
          user: userMap[item.userId]?.toJSON() || null,
          accessCount: parseInt(item.accessCount),
        })),

        recentAccessLogs: accessLogs.slice(0, 100).map(log => ({
          id: log.id,
          userId: log.userId,
          userEmail: log.user?.email,
          userName: log.user?.name,
          userRole: log.user?.role,
          action: log.action,
          resourceType: log.resourceType,
          resourceId: log.resourceId,
          ipAddress: log.ipAddress,
          severity: log.severity,
          status: log.status,
          timestamp: log.createdAt,
        })),
      };
    } catch (error) {
      console.error('[Compliance] Access control report failed:', error);
      throw error;
    }
  }

  /**
   * 生成安全事件报告
   * @param {Object} options - 查询选项
   * @returns {Promise<Object>} 安全事件汇总
   */
  async generateSecurityEventReport(options = {}) {
    const {
      startDate,
      endDate,
      severity,
    } = options;

    const where = {
      severity: { [Op.in]: ['WARN', 'ERROR', 'CRITICAL'] },
    };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }
    if (severity) where.severity = severity;

    try {
      // 按严重级别分类统计
      const [
        warningEvents,
        errorEvents,
        criticalEvents,

        // 按事件类型分类
        authFailures,
        accessDenied,
        rateLimited,

        // 最近的安全事件
        recentEvents,
      ] = await Promise.all([
        db.AuditLog.count({ where: { ...where, severity: 'WARN' } }),
        db.AuditLog.count({ where: { ...where, severity: 'ERROR' } }),
        db.AuditLog.count({ where: { ...where, severity: 'CRITICAL' } }),

        db.AuditLog.count({ where: { ...where, action: 'AUTH_FAILURE' } }),
        db.AuditLog.count({ where: { ...where, action: 'ACCESS_DENIED' } }),
        db.AuditLog.count({ where: { ...where, action: 'RATE_LIMITED' } }),

        db.AuditLog.findAll({
          where,
          order: [['createdAt', 'DESC']],
          limit: 50,
          include: [{
            model: db.User,
            as: 'user',
            attributes: ['email', 'name'],
            required: false,
          }],
        }),
      ]);

      return {
        reportType: 'SECURITY_EVENTS',
        generatedAt: new Date().toISOString(),
        period: { startDate, endDate },

        summary: {
          totalSecurityEvents: warningEvents + errorEvents + criticalEvents,
          bySeverity: {
            warning: warningEvents,
            error: errorEvents,
            critical: criticalEvents,
          },

          byEventType: {
            authFailures,
            accessDenied,
            rateLimited,
          },
        },

        recentCriticalEvents: recentEvents.filter(e => e.severity === 'CRITICAL').slice(0, 10).map(event => ({
          id: event.id,
          userId: event.userId,
          userEmail: event.user?.email,
          action: event.action,
          severity: event.severity,
          ipAddress: event.ipAddress,
          details: event.details ? JSON.parse(event.details) : null,
          timestamp: event.createdAt,
        })),
      };
    } catch (error) {
      console.error('[Compliance] Security event report failed:', error);
      throw error;
    }
  }

  /**
   * 生成数据保留报告
   * @returns {Promise<Object>} 各类数据的保留策略和实际存储情况
   */
  async generateDataRetentionReport() {
    try {
      const now = new Date();

      // 定义各类数据的保留期限（天）
      const retentionPolicies = {
        userAccountData: {
          label: '用户账户数据',
          retentionDays: null, // 账户期内永久保存
          description: '活跃用户的基本信息和设置',
        },
        auditLogs: {
          label: '审计日志',
          retentionDays: 365,
          description: '系统操作和安全相关日志，保留1年用于合规审查',
        },
        securityLogs: {
          label: '安全日志',
          retentionDays: 730,
          description: '认证失败、异常检测等安全事件，保留2年用于取证分析',
        },
        marketingData: {
          label: '营销活动数据',
          retentionDays: 180,
          description: '已完成的营销活动和邮件发送记录，保留6个月',
        },
        clientData: {
          label: '客户联系数据',
          retentionDays: null, // 根据客户状态决定
          description: '客户联系信息，根据业务需要和法律要求保留',
        },
        errorLogs: {
          label: '错误日志',
          retentionDays: 90,
          description: '系统错误和异常日志，保留3个月用于问题排查',
        },
      };

      // 统计各类数据的实际数量和最早/最晚时间戳
      const stats = {};

      for (const [key, policy] of Object.entries(retentionPolicies)) {
        let model;
        switch (key) {
          case 'userAccountData':
            model = db.User;
            break;
          case 'auditLogs':
            model = db.AuditLog;
            break;
          case 'securityLogs':
            model = db.AuditLog; // 使用审计日志的子集
            break;
          case 'marketingData':
            model = db.Campaign;
            break;
          case 'clientData':
            model = db.Client;
            break;
          case 'errorLogs':
            model = db.ErrorLog;
            break;
        }

        if (model) {
          const count = await model.count();
          const oldest = await model.findOne({
            order: [['createdAt', 'ASC']],
            attributes: ['createdAt'],
          });
          const newest = await model.findOne({
            order: [['createdAt', 'DESC']],
            attributes: ['createdAt'],
          });

          stats[key] = {
            ...policy,
            actualRecords: count,
            oldestRecord: oldest?.createdAt,
            newestRecord: newest?.createdAt,
            estimatedStorageDays: oldest?.createdAt
              ? Math.ceil((now - new Date(oldest.createdAt)) / (1000 * 60 * 60 * 24))
              : 0,
          };
        }
      }

      return {
        reportType: 'DATA_RETENTION',
        generatedAt: now.toISOString(),

        policies: retentionPolicies,

        currentStatus: stats,

        recommendations: this.generateRetentionRecommendations(stats),
      };
    } catch (error) {
      console.error('[Compliance] Data retention report failed:', error);
      throw error;
    }
  }

  /**
   * 根据当前数据状况生成保留策略建议
   * @private
   */
  generateRetentionRecommendations(stats) {
    const recommendations = [];

    Object.entries(stats).forEach(([key, data]) => {
      if (data.retentionDays && data.estimatedStorageDays > data.retentionDays * 1.2) {
        recommendations.push({
          type: 'WARNING',
          category: key,
          message: `${data.label}已超过建议保留期${Math.round(data.estimatedStorageDays - data.retentionDays)}天`,
          suggestedAction: `考虑清理${data.retentionDays}天前的旧记录`,
        });
      }
    });

    if (recommendations.length === 0) {
      recommendations.push({
        type: 'INFO',
        message: '所有数据类型均在正常保留范围内',
      });
    }

    return recommendations;
  }
}

// 导出单例实例
const complianceReportService = new ComplianceReportService();

module.exports = complianceReportService;
module.exports.ComplianceReportService = ComplianceReportService;
