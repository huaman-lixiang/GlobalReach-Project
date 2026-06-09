const rateLimit = require('express-rate-limit');

// M-C04: API Rate Limiting 细化 - 三层限流架构
// Layer 1: Nginx层 (全局保护) — 已有，不修改
// Layer 2: 应用级全局限流 (本文件)
// Layer 3: 按端点分级限流 (核心新增)

// ============================================
// Layer 2: 应用级全局限流
// ============================================
// S112/PhaseI: Production rate limit tuning
// Default: 120 req / 1 min = ~2 rps (从原来的30000/15min收紧为更细粒度控制)
// Override via env: RATE_LIMIT_MAX (per minute) or RATE_LIMIT_WINDOW_MS
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX || '120');
const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || String(60 * 1000));

const rateLimiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'RATE_LIMIT_EXCEEDED',
    message: '请求过于频繁，请稍后再试',
    code: 'RATE_001',
    retryAfter: Math.ceil(rateLimitWindowMs / 1000)
  },
  handler: (req, res) => {
    // Prometheus metrics: 记录被限流的请求
    if (global.rateLimitedCounter) {
      try {
        global.rateLimitedCounter.inc({ endpoint: req.path, ip: req.ip, layer: 'global' });
      } catch(e) {}
    }

    res.status(429).json({
      success: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: '请求过于频繁，请稍后再试',
      code: 'RATE_001',
      retryAfter: Math.ceil(rateLimitWindowMs / 1000)
    });
  },
  // 内部服务白名单：跳过限流
  skip: (req) => isInternalService(req)
});

// ============================================
// Layer 3: 按端点分级限流 (核心新增)
// ============================================

/**
 * 端点限流配置表
 * 不同端点的不同限流策略，按业务风险分级
 */
const endpointLimits = {
  // ===== 公开端点 — 较宽松（但防暴力破解）=====
  '/api/v1/auth/login':     { windowMs: 60000, max: 10,  description: '登录接口' },
  '/api/v1/auth/register':  { windowMs: 60000, max: 3,   description: '注册接口' },
  '/api/v1/auth/refresh':   { windowMs: 60000, max: 20,  description: 'Token刷新' },

  // ===== 读操作 — 中等限制 =====
  '/api/v1/clients':        { windowMs: 60000, max: 60,  description: '客户列表查询' },
  '/api/v1/campaigns':      { windowMs: 60000, max: 60,  description: '活动列表查询' },
  '/api/v1/health':         { windowMs: 60000, max: 300, description: '健康检查（监控依赖）' },
  '/api/v1/metrics':        { windowMs: 60000, max: 120, description: 'Prometheus指标' },
  '/api/v1/stats':          { windowMs: 60000, max: 60,  description: '统计数据' },
  '/api/v1/analytics':      { windowMs: 60000, max: 30,  description: '高级分析' },
  '/api/v1/search':         { windowMs: 60000, max: 30,  description: '高级搜索' },

  // ===== 写操作 — 较严格 =====
  // 客户CRUD (POST/PUT)
  'clients_write':          { windowMs: 60000, max: 20, methods: ['POST', 'PUT'], description: '客户写入操作' },
  // 活动CRUD (POST/PUT)
  'campaigns_write':        { windowMs: 60000, max: 10, methods: ['POST', 'PUT'], description: '活动写入操作' },
  // 邮件发送
  '/api/v1/emails/send':    { windowMs: 60000, max: 5,  description: '邮件发送' },
  // 批量导入
  '/api/v1/clients/import': { windowMs: 60000, max: 2,  description: '批量导入' },
  // 数据导出
  '/api/v1/export':         { windowMs: 60000, max: 10, description: '数据导出' },

  // ===== Webhook — 中等限制 =====
  '/api/v1/webhooks':       { windowMs: 60000, max: 100, description: 'Webhook接收' },

  // ===== 敏感端点 — 最严格 =====
  '/api/v1/users':          { windowMs: 60000, max: 10, description: '用户管理' },
  '/api/v1/settings':       { windowMs: 60000, max: 10, description: '系统设置' },
  '/api/v1/tenants':        { windowMs: 60000, max: 10, description: '租户管理' },
  '/api/v1/teams':          { windowMs: 60000, max: 20, description: '团队协作' },
};

/**
 * 创建端点级限流器工厂函数
 * @param {string} pathPattern - 端点路径或标识符
 * @param {object} options - 限流配置 {windowMs, max, methods?, description?}
 * @returns {Function} Express中间件
 */
function createEndpointLimiter(pathPattern, options) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}:${req.path}`,
    handler: (req, res) => {
      // Prometheus metrics: 记录端点级限流
      if (global.rateLimitedCounter) {
        try {
          global.rateLimitedCounter.inc({
            endpoint: req.path,
            ip: req.ip,
            layer: 'endpoint',
            limitType: options.description || pathPattern
          });
        } catch(e) {}
      }

      res.status(429).json({
        success: false,
        error: 'ENDPOINT_RATE_LIMITED',
        endpoint: req.path,
        message: `该接口访问频率超限 (${options.max}次/${options.windowMs/1000}秒)`,
        code: 'RATE_002',
        retryAfter: Math.ceil(options.windowMs / 1000),
        limitType: options.description || pathPattern
      });
    },
    skip: (req) => isInternalService(req),
    // 如果指定了methods，则只对这些HTTP方法生效
    ...(options.methods ? { skip: (req) => isInternalService(req) || !options.methods.includes(req.method) } : {})
  });
}

/**
 * 预生成所有端点限流器实例
 * 避免每次请求都创建新实例
 */
const endpointLimiters = {};

Object.entries(endpointLimits).forEach(([key, config]) => {
  endpointLimiters[key] = createEndpointLimiter(key, config);
});

/**
 * 获取端点限流中间件
 * @param {string} endpointKey - 端点标识符 (来自endpointLimits的key)
 * @returns {Function} Express中间件
 */
function getEndpointLimiter(endpointKey) {
  return endpointLimiters[endpointKey] || null;
}

/**
 * 自动匹配端点的限流中间件
 * 根据请求路径和方法自动选择合适的限流策略
 */
function autoEndpointLimiter(req, res, next) {
  const path = req.path;
  const method = req.method;

  // 精确匹配
  for (const [key, config] of Object.entries(endpointLimits)) {
    // 跳过方法特定的限制器（由路由层单独处理）
    if (config.methods && !config.methods.includes(method)) continue;

    // 精确路径匹配或前缀匹配
    if (path === key || path.startsWith(key + '/') || path.startsWith(key)) {
      const limiter = endpointLimiters[key];
      if (limiter) {
        return limiter(req, res, next);
      }
    }
  }

  // 未匹配到特定规则，放行（已被全局限制器覆盖）
  next();
}

// ============================================
// 特殊用途限流器 (保留原有功能并增强)
// ============================================

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.path}`,
  message: {
    success: false,
    error: 'AUTH_RATE_LIMIT',
    message: '认证尝试过于频繁，请15分钟后再试',
    code: 'AUTH_001'
  },
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    if (global.rateLimitedCounter) {
      try {
        global.rateLimitedCounter.inc({ endpoint: req.path, ip: req.ip, layer: 'auth' });
      } catch(e) {}
    }
    res.status(429).json({
      success: false,
      error: 'AUTH_RATE_LIMIT',
      message: '认证尝试过于频繁，请15分钟后再试',
      code: 'AUTH_001'
    });
  }
});

const emailSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5, // 从20收紧到5，更严格的邮件发送限制
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: {
    success: false,
    error: 'EMAIL_RATE_LIMIT',
    message: '邮件发送频率超限 (5次/分钟)',
    code: 'EMAIL_001'
  },
  handler: (req, res) => {
    if (global.rateLimitedCounter) {
      try {
        global.rateLimitedCounter.inc({ endpoint: req.path, ip: req.ip, layer: 'email' });
      } catch(e) {}
    }
    res.status(429).json({
      success: false,
      error: 'EMAIL_RATE_LIMIT',
      message: '邮件发送频率超限 (5次/分钟)',
      code: 'EMAIL_001'
    });
  }
});

const batchOperationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: {
    success: false,
    error: 'BATCH_RATE_LIMIT',
    message: '批量操作频率超限 (5次/5分钟)',
    code: 'BATCH_001'
  },
  handler: (req, res) => {
    if (global.rateLimitedCounter) {
      try {
        global.rateLimitedCounter.inc({ endpoint: req.path, ip: req.ip, layer: 'batch' });
      } catch(e) {}
    }
    res.status(429).json({
      success: false,
      error: 'BATCH_RATE_LIMIT',
      message: '批量操作频率超限 (5次/5分钟)',
      code: 'BATCH_001'
    });
  }
});

// D05: Per-user action rate limiter (for password reset, etc.)
// Simple in-memory tracker
const actionAttempts = new Map();

const actionRateLimit = (actionName, maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
  return (req, res, next) => {
    const key = `${req.ip || 'unknown'}:${actionName}`;
    const now = Date.now();
    const record = actionAttempts.get(key);

    if (record) {
      if (now - record.startTime < windowMs) {
        if (record.count >= maxAttempts) {
          const resetSeconds = Math.ceil((windowMs - (now - record.startTime)) / 1000);

          if (global.rateLimitedCounter) {
            try {
              global.rateLimitedCounter.inc({ endpoint: req.path, ip: req.ip, layer: 'action', action: actionName });
            } catch(e) {}
          }

          return res.status(429).json({
            success: false,
            error: 'ACTION_RATE_LIMITED',
            message: `${actionName}操作过于频繁，请在${resetSeconds}秒后重试`,
            retryAfter: resetSeconds,
          });
        }
        record.count++;
      } else {
        actionAttempts.delete(key);
      }
    } else {
      actionAttempts.set(key, { count: 1, startTime: now });
    }

    // Cleanup expired entries periodically
    if (actionAttempts.size > 500) {
      for (const [k, v] of actionAttempts.entries()) {
        if (now - v.startTime > windowMs) actionAttempts.delete(k);
      }
    }

    next();
  };
};

// ============================================
// 工具函数
// ============================================

/**
 * 判断是否为内部服务调用（跳过限流）
 * 包括本地回环、Health Check探针、服务间调用
 */
function isInternalService(req) {
  const internalIPs = ['127.0.0.1', '::ffff:127.0.0.1', '::1', 'localhost'];
  const isLocalIP = internalIPs.includes(req.ip);

  const forwardedFor = req.headers['x-forwarded-for'];
  const isForwardedLocal = forwardedFor && internalIPs.some(ip =>
    forwardedFor.includes(ip)
  );

  // Health Check探针路径
  const healthCheckPaths = ['/api/v1/health', '/api/v1/health/ready', '/api/v1/health/live'];
  const isHealthProbe = healthCheckPaths.some(p => req.path.startsWith(p));

  return isLocalIP || isForwardedLocal || isHealthProbe;
}

/**
 * 初始化Prometheus指标（在server.js启动时调用）
 * 需要传入prom-client的Counter构造函数
 */
function initMetrics(Counter) {
  try {
    global.rateLimitedCounter = new Counter({
      name: 'globalreach_rate_limited_total',
      help: 'Total number of rate-limited requests by layer and endpoint',
      labelNames: ['endpoint', 'ip', 'layer', 'limitType'],
    });
    console.log('[RateLimiter] Prometheus metrics initialized');
  } catch(e) {
    console.warn('[RateLimiter] Failed to initialize Prometheus metrics:', e.message);
  }
}

/**
 * 创建Redis存储支持的分布式限流器（可选增强）
 * 当项目部署多实例时使用，单实例部署使用默认内存存储即可
 * @param {object} redisClient - ioredis或node-redis客户端实例
 * @returns {object} 包含redis支持的全局限流器
 */
function createRedisLimiter(redisClient) {
  let RedisStore;

  try {
    RedisStore = require('rate-limit-redis');
  } catch(e) {
    console.warn('[RateLimiter] rate-limit-redis not installed, falling back to in-memory store');
    return rateLimiter;
  }

  return rateLimit({
    store: new RedisStore({
      client: redisClient,
      prefix: 'rl:',
    }),
    windowMs: rateLimitWindowMs,
    max: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: '请求过于频繁，请稍后再试',
      code: 'RATE_001',
      retryAfter: Math.ceil(rateLimitWindowMs / 1000)
    },
    handler: (req, res) => {
      if (global.rateLimitedCounter) {
        try {
          global.rateLimitedCounter.inc({ endpoint: req.path, ip: req.ip, layer: 'global_redis' });
        } catch(e) {}
      }
      res.status(429).json({
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message: '请求过于频繁，请稍后再试',
        code: 'RATE_001',
        retryAfter: Math.ceil(rateLimitWindowMs / 1000)
      });
    }
  });
}

module.exports = {
  // Layer 2: 全局限流
  rateLimiter,

  // Layer 3: 端点级限流
  endpointLimits,
  getEndpointLimiter,
  autoEndpointLimiter,

  // 特殊用途限流器（向后兼容）
  authLimiter,
  emailSendLimiter,
  batchOperationLimiter,
  actionRateLimit,

  // 工具和增强功能
  isInternalService,
  initMetrics,
  createRedisLimiter,

  // 配置信息（供调试和文档使用）
  _config: {
    version: 'M-C04-v2.0',
    layers: ['nginx_l1', 'express_global_l2', 'endpoint_granular_l3'],
    defaultLimits: {
      global: { max: rateLimitMax, windowMs: rateLimitWindowMs },
      endpoints: Object.fromEntries(
        Object.entries(endpointLimits).map(([k, v]) => [k, { max: v.max, windowMs: v.windowMs }])
      )
    }
  }
};
