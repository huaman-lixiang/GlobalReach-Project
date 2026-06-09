/**
 * Audit Logger Middleware (N03) — 自动化合规审计日志系统
 *
 * 功能：
 * 1. 自动记录关键操作的审计轨迹
 * 2. 支持GDPR/SOC2合规要求
 * 3. 提供完整的操作链追踪能力
 *
 * 审计事件分类（必须审计 MUST）：
 * - 用户认证(登录/登出/Token刷新)
 * - 数据增删改(全部业务表的写操作)
 * - 权限变更(角色分配/权限修改)
 * - 系统配置变更
 * - 批量操作(导入/导出/批量删除)
 * - 认证失败(≥3次连续=锁定告警)
 *
 * 建议审计的事件（SHOULD）：
 * - 数据查询(特别是批量/全量查询)
 * - 文件上传/下载
 * - API密钥变更
 */

const db = require('../db');
const { createLogger } = require('./logger');

const auditLog = createLogger('Audit');

// 操作类型枚举
const ACTION_TYPES = {
  // 认证事件
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  TOKEN_REFRESH: 'TOKEN_REFRESH',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PASSWORD_RESET: 'PASSWORD_RESET',
  AUTH_FAILURE: 'AUTH_FAILURE',

  // 数据操作
  CREATE: 'CREATE',
  READ: 'READ',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  BULK_CREATE: 'BULK_CREATE',
  BULK_UPDATE: 'BULK_UPDATE',
  BULK_DELETE: 'BULK_DELETE',

  // 敏感操作
  EXPORT_DATA: 'EXPORT_DATA',
  IMPORT_DATA: 'IMPORT_DATA',
  CONFIG_CHANGE: 'CONFIG_CHANGE',

  // 管理员操作
  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
  USER_DELETE: 'USER_DELETE',
  ROLE_CHANGE: 'ROLE_CHANGE',
  PERMISSION_CHANGE: 'PERMISSION_CHANGE',

  // 安全事件
  RATE_LIMITED: 'RATE_LIMITED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
};

// 资源类型枚举
const RESOURCE_TYPES = {
  USER: 'user',
  CLIENT: 'client',
  CAMPAIGN: 'campaign',
  EMAIL: 'email',
  ACCOUNT: 'account',
  SYSTEM: 'system',
  TENANT: 'tenant',
  TEMPLATE: 'template',
  WEBHOOK: 'webhook',
};

// 严重级别
const SEVERITY = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
};

// 操作状态
const STATUS = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
};

/**
 * 提取客户端IP地址
 */
const getClientIp = (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.ip ||
         req.connection?.remoteAddress ||
         'unknown';
};

/**
 * 提取User-Agent
 */
const getUserAgent = (req) => {
  return req.headers['user-agent'] || 'unknown';
};

/**
 * 提取会话ID（从请求头或Token中）
 */
const getSessionId = (req) => {
  return req.headers['x-session-id'] ||
         req.headers['session-id'] ||
         req.user?.sessionId ||
         null;
};

/**
 * 核心审计日志写入函数
 * @param {Object} auditData - 审计数据
 * @returns {Promise<Object>} 创建的审计日志记录
 */
const writeAuditLog = async (auditData) => {
  try {
    const logEntry = await db.AuditLog.create({
      userId: auditData.userId,
      action: auditData.action,
      resourceType: auditData.resourceType,
      resourceId: auditData.resourceId,
      ipAddress: auditData.ipAddress,
      userAgent: auditData.userAgent,
      details: typeof auditData.details === 'object'
        ? JSON.stringify(auditData.details)
        : auditData.details,
      severity: auditData.severity || SEVERITY.INFO,
      status: auditData.status || STATUS.SUCCESS,
      sessionId: auditData.sessionId,
    });

    auditLog.info('Audit log recorded', {
      auditId: logEntry.id,
      action: auditData.action,
      resource: auditData.resourceType,
      severity: auditData.severity,
      status: auditData.status,
    });

    return logEntry;
  } catch (error) {
    // 审计日志写入失败不应影响主业务流程
    auditLog.error('Failed to write audit log', {
      error: error.message,
      action: auditData.action,
      stack: error.stack,
    });
    return null;
  }
};

/**
 * Express中间件：自动审计API请求
 * 根据请求方法和路径自动判断操作类型和资源类型
 */
const auditMiddleware = (options = {}) => {
  return async (req, res, next) => {
    // 记录开始时间
    const startTime = Date.now();

    // 拦截响应finish事件以记录审计日志
    res.on('finish', async () => {
      try {
        const duration = Date.now() - startTime;
        const statusCode = res.statusCode;

        // 只审计需要关注的状态码和路径
        if (shouldAuditRequest(req, statusCode)) {
          const { action, resourceType } = parseRequestContext(req);
          const severity = determineSeverity(statusCode, req.method);
          const status = statusCode < 400 ? STATUS.SUCCESS : STATUS.FAILURE;

          await writeAuditLog({
            userId: req.user?.id,
            action,
            resourceType,
            resourceId: extractResourceId(req),
            ipAddress: getClientIp(req),
            userAgent: getUserAgent(req),
            sessionId: getSessionId(req),
            severity,
            status,
            details: {
              method: req.method,
              path: req.path,
              statusCode,
              duration,
              query: req.query,
              params: req.params,
              // 对于写操作，记录部分body信息（排除敏感字段）
              ...(needsBodyCapture(req.method) ? {
                bodyKeys: Object.keys(req.body || {}),
                changes: sanitizeBodyForAudit(req.body),
              } : {}),
            },
          });
        }
      } catch (error) {
        auditLog.error('Audit middleware error', { error: error.message });
      }
    });

    next();
  };
};

/**
 * 判断是否需要审计该请求
 */
const shouldAuditRequest = (req, statusCode) => {
  // 排除健康检查、静态资源等
  const skipPaths = ['/health', '/metrics', '/docs', '/favicon.ico', '/static/'];
  if (skipPaths.some(path => req.path.startsWith(path))) {
    return false;
  }

  // 审计所有写操作
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return true;
  }

  // 审计认证相关请求
  if (req.path.includes('/auth/')) {
    return true;
  }

  // 审计管理接口
  if (req.path.includes('/admin/') && req.user?.role === 'ADMIN') {
    return true;
  }

  // 审计失败的请求（4xx/5xx）
  if (statusCode >= 400) {
    return true;
  }

  return false;
};

/**
 * 从请求上下文解析操作类型和资源类型
 */
const parseRequestContext = (req) => {
  const method = req.method;
  const path = req.path;

  // 认证相关
  if (path.includes('/auth/login') || path.includes('/auth/signin')) {
    return { action: ACTION_TYPES.LOGIN, resourceType: RESOURCE_TYPES.USER };
  }
  if (path.includes('/auth/logout') || path.includes('/auth/signout')) {
    return { action: ACTION_TYPES.LOGOUT, resourceType: RESOURCE_TYPES.USER };
  }
  if (path.includes('/auth/refresh')) {
    return { action: ACTION_TYPES.TOKEN_REFRESH, resourceType: RESOURCE_TYPES.USER };
  }
  if (path.includes('/auth/password')) {
    return { action: ACTION_TYPES.PASSWORD_CHANGE, resourceType: RESOURCE_TYPES.USER };
  }

  // 资源操作映射
  const resourceMap = [
    { pattern: '/clients', type: RESOURCE_TYPES.CLIENT },
    { pattern: '/campaigns', type: RESOURCE_TYPES.CAMPAIGN },
    { pattern: '/emails', type: RESOURCE_TYPES.EMAIL },
    { pattern: '/accounts', type: RESOURCE_TYPES.ACCOUNT },
    { pattern: '/users', type: RESOURCE_TYPES.USER },
    { pattern: '/tenants', type: RESOURCE_TYPES.TENANT },
    { pattern: '/templates', type: RESOURCE_TYPES.TEMPLATE },
    { pattern: '/webhooks', type: RESOURCE_TYPES.WEBHOOK },
  ];

  let resourceType = RESOURCE_TYPES.SYSTEM;
  for (const { pattern, type } of resourceMap) {
    if (path.includes(pattern)) {
      resourceType = type;
      break;
    }
  }

  // 操作类型映射
  let action;
  if (method === 'POST') {
    action = path.includes('/import') ? ACTION_TYPES.IMPORT_DATA :
            path.includes('/bulk') ? ACTION_TYPES.BULK_CREATE :
            ACTION_TYPES.CREATE;
  } else if (method === 'PUT' || method === 'PATCH') {
    action = path.includes('/bulk') ? ACTION_TYPES.BULK_UPDATE : ACTION_TYPES.UPDATE;
  } else if (method === 'DELETE') {
    action = path.includes('/bulk') ? ACTION_TYPES.BULK_DELETE : ACTION_TYPES.DELETE;
  } else if (method === 'GET') {
    action = path.includes('/export') ? ACTION_TYPES.EXPORT_DATA : ACTION_TYPES.READ;
  }

  return { action, resourceType };
};

/**
 * 从请求中提取资源ID
 */
const extractResourceId = (req) => {
  return req.params.id ||
         req.params.clientId ||
         req.params.campaignId ||
         req.params.emailId ||
         req.params.accountId ||
         req.params.userId ||
         null;
};

/**
 * 根据状态码确定严重级别
 */
const determineSeverity = (statusCode, method) => {
  if (statusCode >= 500) return SEVERITY.ERROR;
  if (statusCode === 401 || statusCode === 403) return SEVERITY.WARN;
  if (statusCode === 429) return SEVERITY.WARN;
  if (statusCode >= 400) return SEVERITY.INFO;

  // 对敏感操作提升级别
  const sensitiveMethods = ['DELETE'];
  if (sensitiveMethods.includes(method)) return SEVERITY.INFO;

  return SEVERITY.INFO;
};

/**
 * 判断是否需要捕获请求体
 */
const needsBodyCapture = (method) => {
  return ['POST', 'PUT', 'PATCH'].includes(method);
};

/**
 * 清理请求体用于审计记录（移除敏感字段）
 */
const sanitizeBodyForAudit = (body) => {
  if (!body) return null;

  const sensitiveFields = ['password', 'passwordHash', 'token', 'secret', 'creditCard', 'ssn'];
  const sanitized = {};

  for (const [key, value] of Object.entries(body)) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 500) {
      // 截断过长的值
      sanitized[key] = value.substring(0, 500) + '...[TRUNCATED]';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

/**
 * 手动记录审计日志的便捷方法
 * 用于在路由处理器或服务中显式记录特定事件
 *
 * @example
 * // 在路由中使用
 * router.post('/login', async (req, res) => {
 *   await auditLogger.log({
 *     req,
 *     action: ACTION_TYPES.LOGIN,
 *     resourceType: RESOURCE_TYPES.USER,
 *     details: { email: req.body.email },
 *     status: STATUS.SUCCESS,
 *   });
 * });
 */
const log = async (auditData) => {
  const req = auditData.req;

  return writeAuditLog({
    userId: req?.user?.id || auditData.userId,
    action: auditData.action,
    resourceType: auditData.resourceType,
    resourceId: auditData.resourceId,
    ipAddress: req ? getClientIp(req) : auditData.ipAddress,
    userAgent: req ? getUserAgent(req) : auditData.userAgent,
    sessionId: req ? getSessionId(req) : auditData.sessionId,
    details: auditData.details,
    severity: auditData.severity,
    status: auditData.status,
  });
};

/**
 * 快捷方法：记录认证成功
 */
const logAuthSuccess = (req, details = {}) => {
  return log({
    req,
    action: ACTION_TYPES.LOGIN,
    resourceType: RESOURCE_TYPES.USER,
    details: { ...details, email: req.user?.email },
    severity: SEVERITY.INFO,
    status: STATUS.SUCCESS,
  });
};

/**
 * 快捷方法：记录认证失败
 */
const logAuthFailure = (req, reason, details = {}) => {
  return log({
    req,
    action: ACTION_TYPES.AUTH_FAILURE,
    resourceType: RESOURCE_TYPES.USER,
    details: { ...details, reason, ip: getClientIp(req) },
    severity: SEVERITY.WARN,
    status: STATUS.FAILURE,
  });
};

/**
 * 快捷方法：记录数据访问
 */
const logDataAccess = (req, resourceType, resourceId, action = ACTION_TYPES.READ) => {
  return log({
    req,
    action,
    resourceType,
    resourceId,
    severity: SEVERITY.INFO,
    status: STATUS.SUCCESS,
  });
};

/**
 * 快捷方法：记录数据变更
 */
const logDataChange = (req, resourceType, resourceId, action, changes = {}) => {
  return log({
    req,
    action,
    resourceType,
    resourceId,
    details: changes,
    severity: SEVERITY.INFO,
    status: STATUS.SUCCESS,
  });
};

/**
 * 快捷方法：记录安全事件
 */
const logSecurityEvent = (req, eventType, details = {}, severity = SEVERITY.WARN) => {
  return log({
    req,
    action: eventType,
    resourceType: RESOURCE_TYPES.SYSTEM,
    details: { ...details, ip: getClientIp(req), userAgent: getUserAgent(req) },
    severity,
    status: STATUS.FAILURE,
  });
};

module.exports = {
  // 中间件
  auditMiddleware,

  // 核心方法
  log,
  writeAuditLog,

  // 快捷方法
  logAuthSuccess,
  logAuthFailure,
  logDataAccess,
  logDataChange,
  logSecurityEvent,

  // 枚举常量（供其他模块使用）
  ACTION_TYPES,
  RESOURCE_TYPES,
  SEVERITY,
  STATUS,

  // 工具函数
  getClientIp,
  getUserAgent,
  getSessionId,
};
