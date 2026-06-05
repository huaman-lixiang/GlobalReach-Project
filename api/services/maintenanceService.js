const db = require('../db');
const { Op } = require('sequelize');

class MaintenanceService {
  async logError(errorData) {
    return db.ErrorLog.create({
      userId: errorData.userId,
      errorType: errorData.errorType,
      errorMessage: errorData.errorMessage,
      stackTrace: errorData.stackTrace,
      requestUrl: errorData.requestUrl,
      requestMethod: errorData.requestMethod,
      userAgent: errorData.userAgent,
      statusCode: errorData.statusCode,
      metadata: JSON.stringify(errorData.metadata || {}),
    });
  }

  async getErrorLogs(userId, filters = {}) {
    const whereClause = {};

    if (userId) {
      whereClause.userId = userId;
    }

    if (filters.errorType) {
      whereClause.errorType = filters.errorType;
    }

    if (filters.statusCode) {
      whereClause.statusCode = filters.statusCode;
    }

    if (filters.startDate) {
      whereClause.createdAt = { [Op.gte]: new Date(filters.startDate) };
    }

    if (filters.endDate) {
      whereClause.createdAt = {
        ...whereClause.createdAt,
        [Op.lte]: new Date(filters.endDate),
      };
    }

    const errors = await db.ErrorLog.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: filters.limit || 50,
      offset: filters.offset || 0,
    });

    const total = await db.ErrorLog.count({ where: whereClause });

    return {
      results: errors,
      total,
      page: Math.floor((filters.offset || 0) / (filters.limit || 50)) + 1,
      pageSize: filters.limit || 50,
    };
  }

  async getErrorStats(userId) {
    const whereClause = userId ? { userId } : {};

    const [totalErrors, errorTypeStats, statusCodeStats, recentErrors] = await Promise.all([
      db.ErrorLog.count({ where: whereClause }),
      db.ErrorLog.findAll({
        attributes: [
          'errorType',
          [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
        ],
        where: whereClause,
        group: ['errorType'],
        raw: true,
      }),
      db.ErrorLog.findAll({
        attributes: [
          'statusCode',
          [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
        ],
        where: whereClause,
        group: ['statusCode'],
        raw: true,
      }),
      db.ErrorLog.findAll({
        where: whereClause,
        order: [['createdAt', 'DESC']],
        limit: 10,
      }),
    ]);

    const last24Hours = await db.ErrorLog.count({
      where: {
        ...whereClause,
        createdAt: {
          [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    });

    const last7Days = await db.ErrorLog.count({
      where: {
        ...whereClause,
        createdAt: {
          [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    });

    return {
      totalErrors,
      last24Hours,
      last7Days,
      errorTypeStats,
      statusCodeStats,
      recentErrors,
    };
  }

  async createFeedback(userId, feedbackData) {
    return db.Feedback.create({
      userId,
      type: feedbackData.type,
      title: feedbackData.title,
      message: feedbackData.message,
      rating: feedbackData.rating,
      metadata: JSON.stringify(feedbackData.metadata || {}),
    });
  }

  async getFeedback(userId, filters = {}) {
    const whereClause = userId ? { userId } : {};

    if (filters.type) {
      whereClause.type = filters.type;
    }

    if (filters.rating) {
      whereClause.rating = filters.rating;
    }

    const feedbacks = await db.Feedback.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: filters.limit || 50,
      offset: filters.offset || 0,
    });

    const total = await db.Feedback.count({ where: whereClause });

    return {
      results: feedbacks,
      total,
      page: Math.floor((filters.offset || 0) / (filters.limit || 50)) + 1,
      pageSize: filters.limit || 50,
    };
  }

  async getFeedbackStats() {
    const [totalFeedback, typeStats, ratingStats] = await Promise.all([
      db.Feedback.count(),
      db.Feedback.findAll({
        attributes: [
          'type',
          [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
        ],
        group: ['type'],
        raw: true,
      }),
      db.Feedback.findAll({
        attributes: [
          'rating',
          [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
        ],
        group: ['rating'],
        raw: true,
      }),
    ]);

    const avgRating = await db.Feedback.findOne({
      attributes: [
        [db.sequelize.fn('AVG', db.sequelize.col('rating')), 'avgRating'],
      ],
      raw: true,
    });

    return {
      totalFeedback,
      avgRating: parseFloat(avgRating?.avgRating) || 0,
      typeStats,
      ratingStats,
    };
  }

  async getSystemHealth() {
    const healthChecks = [];
    
    try {
      await db.sequelize.authenticate();
      healthChecks.push({
        name: 'database',
        status: 'healthy',
        message: 'Database connection is healthy',
      });
    } catch (error) {
      healthChecks.push({
        name: 'database',
        status: 'unhealthy',
        message: `Database connection failed: ${error.message}`,
      });
    }

    try {
      const redis = require('../redis');
      await redis.ping();
      healthChecks.push({
        name: 'redis',
        status: 'healthy',
        message: 'Redis connection is healthy',
      });
    } catch (error) {
      healthChecks.push({
        name: 'redis',
        status: 'warning',
        message: `Redis connection warning: ${error.message}`,
      });
    }

    try {
      const emailService = require('./emailService');
      const providerStatus = await emailService.emailService.checkProviderStatus();
      healthChecks.push({
        name: 'email_service',
        status: providerStatus.connected ? 'healthy' : 'warning',
        message: providerStatus.message,
      });
    } catch (error) {
      healthChecks.push({
        name: 'email_service',
        status: 'warning',
        message: `Email service check failed: ${error.message}`,
      });
    }

    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();

    return {
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: Math.floor(uptime),
        minutes: Math.floor(uptime / 60),
        hours: Math.floor(uptime / 3600),
        days: Math.floor(uptime / 86400),
      },
      memory: {
        rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`,
        heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      },
      checks: healthChecks,
      overallStatus: healthChecks.every(c => c.status === 'healthy') ? 'healthy' : 
        healthChecks.some(c => c.status === 'unhealthy') ? 'unhealthy' : 'degraded',
    };
  }

  async getMaintenanceLog() {
    return db.MaintenanceLog.findAll({
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
  }

  async logMaintenanceEvent(eventType, message, details = {}) {
    return db.MaintenanceLog.create({
      eventType,
      message,
      details: JSON.stringify(details),
    });
  }
}

const maintenanceService = new MaintenanceService();

module.exports = {
  MaintenanceService,
  maintenanceService,
};