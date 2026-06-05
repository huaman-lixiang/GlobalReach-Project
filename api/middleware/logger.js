/**
 * Request Logger Middleware — D07 + D13 Enhanced
 *
 * Features:
 *   - Structured JSON log format
 *   - Automatic log level by HTTP status code
 *   - Sensitive data masking (passwords, tokens, secrets)
 *   - Configurable log level via LOG_LEVEL env var
 *   - Request ID tracking (X-Request-ID header)
 *   - Response time measurement
 *   - D13: Async tracing context propagation
 *   - D13: Span tracking for nested operations
 *   - D13: Full request lifecycle correlation
 */

const { v4: uuidv4 } = require('uuid');

// ============================================
// Configuration
// ============================================

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const LOG_LEVEL_NAMES = {
  0: 'ERROR',
  1: 'WARN',
  2: 'INFO',
  3: 'DEBUG',
};

function statusToLevel(statusCode) {
  if (statusCode >= 500) return LOG_LEVELS.ERROR;
  if (statusCode >= 400) return LOG_LEVELS.WARN;
  if (statusCode >= 300) return LOG_LEVELS.INFO;
  return LOG_LEVELS.INFO;
}

function getEffectiveLevel() {
  const envLevel = (process.env.LOG_LEVEL || 'info').toUpperCase();
  return LOG_LEVELS[envLevel] !== undefined ? LOG_LEVELS[envLevel] : LOG_LEVELS.INFO;
}

// ============================================
// Sensitive Data Masking
// ============================================

const SENSITIVE_FIELDS = [
  'password', 'password_confirmation', 'currentPassword', 'newPassword', 'confirmPassword',
  'token', 'accessToken', 'refreshToken', 'refresh_token', 'access_token',
  'authorization', 'cookie', 'secret', 'apiKey', 'api_key', 'apikey',
  'credit_card', 'cardNumber', 'cvv', 'ssn', 'social_security',
  'csrfToken', 'csrf_token', 'x-csrf-token',
];

const MASK_STRING = '***MASKED***';

function maskSensitiveData(data) {
  if (!data || typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(item => maskSensitiveData(item));
  }

  const masked = {};
  for (const key of Object.keys(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field.toLowerCase()))) {
      masked[key] = MASK_STRING;
    } else if (typeof data[key] === 'object' && data[key] !== null) {
      masked[key] = maskSensitiveData(data[key]);
    } else {
      masked[key] = data[key];
    }
  }
  return masked;
}

// ============================================
// D13: Tracing Context Store (Async Propagation)
// ============================================

/**
 * In-memory tracing context store.
 * Enables async operations (outside of req/res cycle) to access
 * the current request's tracing information.
 *
 * Uses AsyncLocalStorage pattern (simplified for Node.js compatibility).
 */
const tracingContext = {
  _store: new Map(),

  /**
   * Set the active tracing context for the current request scope.
   * @param {string} requestId
   * @param {object} metadata
   */
  setContext(requestId, metadata = {}) {
    this._store.set(requestId, {
      requestId,
      startTime: Date.now(),
      spans: [],
      ...metadata,
    });
  },

  /**
   * Get the active tracing context.
   * @param {string} requestId
   * @returns {object|null}
   */
  getContext(requestId) {
    return this._store.get(requestId) || null;
  },

  /**
   * Add a child span to the current trace.
   * Used for tracking individual async operations within a request.
   *
   * @param {string} requestId
   * @param {string} operationName - e.g., "db.query", "email.send", "cache.get"
   * @param {object} attributes - additional span attributes
   * @returns {{ finish: () => void }} Span handle — call finish() when done
   */
  startSpan(requestId, operationName, attributes = {}) {
    const ctx = this._store.get(requestId);
    if (!ctx) {
      // Fallback: just return a no-op span
      return { finish: () => {} };
    }

    const spanId = `${requestId}-${ctx.spans.length + 1}`;
    const span = {
      spanId,
      operationName,
      startTime: Date.now(),
      attributes,
      status: 'in_progress',
    };

    ctx.spans.push(span);

    return {
      finish: (status = 'ok', error = null) => {
        span.endTime = Date.now();
        span.durationMs = span.endTime - span.startTime;
        span.status = status;
        if (error) span.error = error instanceof Error ? error.message : error;
      },
      getSpan: () => span,
    };
  },

  /**
   * Complete the tracing context (called on response finish).
   * Returns all spans for logging.
   * @param {string} requestId
   * @returns {Array}
   */
  completeContext(requestId) {
    const ctx = this._store.get(requestId);
    if (!ctx) return [];

    // Auto-finish any incomplete spans
    for (const span of ctx.spans) {
      if (span.status === 'in_progress') {
        span.endTime = Date.now();
        span.durationMs = span.endTime - span.startTime;
        span.status = 'incomplete';
      }
    }

    const spans = [...ctx.spans];
    this._store.delete(requestId);
    return spans;
  },

  /**
   * Get summary stats for monitoring.
   */
  getStats() {
    let totalSpans = 0;
    let activeTraces = 0;
    for (const [, ctx] of this._store) {
      activeTraces++;
      totalSpans += ctx.spans.length;
    }
    return { activeTraces, totalSpans, storeSize: this._store.size };
  },
};

// ============================================
// Structured Log Output
// ============================================

function writeLog(level, data) {
  const levelNum = typeof level === 'string'
    ? (LOG_LEVELS[level.toUpperCase()] || LOG_LEVELS.INFO)
    : level;

  if (levelNum > getEffectiveLevel()) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level: LOG_LEVEL_NAMES[levelNum] || 'INFO',
    ...data,
  };

  if (process.env.NODE_ENV === 'production') {
    const output = JSON.stringify(entry);
    switch (levelNum) {
      case LOG_LEVELS.ERROR: console.error(output); break;
      case LOG_LEVELS.WARN: console.warn(output); break;
      default: console.log(output); break;
    }
  } else {
    const prefix = `[${entry.timestamp}] [${entry.level}]`;
    const msg = entry.component
      ? `[${entry.component}] ${entry.message}`
      : `${entry.method} ${entry.path} → ${entry.status} (${entry.responseTime})`;
    const extras = [];
    if (entry.userId) extras.push(`user=${entry.userId}`);
    if (entry.requestId) extras.push(`rid=${entry.requestId.substring(0, 8)}`);
    if (entry.spanId) extras.push(`span=${entry.spanId.split('-').pop()}`);
    if (entry.ip) extras.push(`ip=${entry.ip}`);

    const fullMsg = `${prefix} ${msg}${extras.length ? ' | ' + extras.join(' ') : ''}`;
    switch (levelNum) {
      case LOG_LEVELS.ERROR: console.error('\x1b[31m%s\x1b[0m', fullMsg); break;
      case LOG_LEVELS.WARN: console.warn('\x1b[33m%s\x1b[0m', fullMsg); break;
      case LOG_LEVELS.DEBUG: console.log('\x1b[36m%s\x1b[0m', fullMsg); break;
      default: console.log('\x1b[32m%s\x1b[0m', fullMsg); break;
    }
  }
}

// ============================================
// Middleware: Request ID Generator (D07 + D13 Enhanced)
// ============================================

const requestIdMiddleware = (req, res, next) => {
  // Generate or accept external request ID
  req.requestId = req.headers['x-request-id'] || uuidv4();

  // Generate trace ID (for distributed tracing — same as requestId in single-server mode)
  req.traceId = req.headers['x-trace-id'] || req.requestId;

  // Set response headers for client correlation
  res.setHeader('X-Request-ID', req.requestId);
  res.setHeader('X-Trace-ID', req.traceId);

  // Initialize tracing context for this request
  tracingContext.setContext(req.requestId, {
    method: req.method,
    path: req.originalUrl || req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: null, // Will be set by auth middleware
  });

  next();
};

/**
 * Update tracing context after authentication.
 * Call from auth middleware after user is identified.
 * @param {import('express').Request} req
 */
function updateTraceAuth(req) {
  const ctx = tracingContext.getContext(req.requestId);
  if (ctx) {
    ctx.userId = req.user?.id || null;
    ctx.userRole = req.user?.role || null;
  }
}

// ============================================
// Middleware: Structured Request Logger (D07 + D13 Enhanced)
// ============================================

const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const responseTime = Date.now() - start;
    const statusCode = res.statusCode;
    const level = statusToLevel(statusCode);

    // Complete tracing context — collect all spans
    const spans = tracingContext.completeContext(req.requestId);

    // Build safe request body (masked)
    let safeBody = null;
    if (req.body && Object.keys(req.body).length > 0) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        safeBody = maskSensitiveData(req.body);
        const bodyStr = JSON.stringify(safeBody);
        if (bodyStr.length > 2048) {
          safeBody = { _truncated: true, _size: bodyStr.length };
        }
      }
    }

    let safeQuery = null;
    if (req.query && Object.keys(req.query).length > 0) {
      safeQuery = maskSensitiveData(req.query);
    }

    // Build log entry with D13 tracing info
    const logData = {
      method: req.method,
      path: req.originalUrl || req.url,
      baseUrl: req.baseUrl,
      status: statusCode,
      responseTime: `${responseTime}ms`,
      responseTimeMs: responseTime,
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id || null,
      userRole: req.user?.role || null,
      requestId: req.requestId || null,
      traceId: req.traceId || null,
      contentType: req.get('Content-Type'),
      contentLength: parseInt(req.get('Content-Length') || '0', 10),
      body: safeBody,
      query: safeQuery,
    };

    // Include span summaries if any async operations were traced
    if (spans.length > 0) {
      logData.spans = spans.map((s) => ({
        operation: s.operationName,
        durationMs: s.durationMs,
        status: s.status,
      }));
      logData.spanCount = spans.length;
      logData.totalSpanDurationMs = spans.reduce((sum, s) => sum + (s.durationMs || 0), 0);
    }

    writeLog(level, logData);
  });

  next();
};

// ============================================
// Helper: Application-level structured logger
// ============================================

function createLogger(component) {
  return {
    info: (message, meta = {}) => writeLog(LOG_LEVELS.INFO, { component, message, ...meta }),
    warn: (message, meta = {}) => writeLog(LOG_LEVELS.WARN, { component, message, ...meta }),
    error: (message, meta = {}) => writeLog(LOG_LEVELS.ERROR, { component, message, ...meta }),
    debug: (message, meta = {}) => writeLog(LOG_LEVELS.DEBUG, { component, message, ...meta }),

    /**
     * D13: Create a traced span within the current context.
     * Usage inside route handlers or services:
     *   const span = logger.startSpan(req.requestId, 'db.query', { table: 'users' });
     *   await User.findAll();
     *   span.finish();
     */
    startSpan: (requestId, operationName, attrs) =>
      tracingContext.startSpan(requestId, operationName, attrs),
  };
}

// ============================================
// Exports
// ============================================

module.exports = {
  requestLogger,
  requestIdMiddleware,
  createLogger,
  maskSensitiveData,

  // D13: Tracing exports
  tracingContext,
  updateTraceAuth,

  // For testing/configuration access
  LOG_LEVELS,
  LOG_LEVEL_NAMES,
  getEffectiveLevel,
};
