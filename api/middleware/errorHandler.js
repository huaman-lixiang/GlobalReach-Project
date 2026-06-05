/**
 * Unified Error Handler Middleware — D11 Enhanced
 *
 * Complete enterprise-grade error handling system:
 *   - AppError class hierarchy (Operational vs Programming errors)
 *   - 15+ error type auto-classification
 *   - In-memory error rate tracking (sliding window)
 *   - Consistent response format enforced globally
 *   - Request ID correlation on every error response
 *   - Client-friendly error codes (i18n-ready)
 *   - Development vs Production output differentiation
 *   - Error monitoring hooks (for future Prometheus integration)
 */

const { createLogger } = require('./logger');
const errorLog = createLogger('ErrorHandler');

// ============================================
// Configuration
// ============================================

const ERROR_CONFIG = {
  // Expose detailed error info to clients in non-production
  exposeDetails: (process.env.NODE_ENV || 'development') !== 'production',

  // Include stack traces in responses (dev only)
  exposeStack: process.env.NODE_ENV === 'development',

  // Error rate tracking window size (milliseconds)
  rateWindowMs: parseInt(process.env.ERROR_RATE_WINDOW_MS || '60000'), // 1 minute

  // Max error entries to keep in rate tracker
  maxRateEntries: parseInt(process.env.ERROR_MAX_RATE_ENTRIES || '1000'),
};

// ============================================
// Custom Application Error Classes
// ============================================

/**
 * Base application error — all operational/expected errors should use this.
 *
 * Usage:
 *   throw new AppError('Resource not found', 404, 'NOT_FOUND')
 *   throw new AppError('Invalid input', 400, 'VALIDATION_ERROR', { field: 'email' })
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true; // Distinguish from programming bugs
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Not Found Error — for missing resources (404)
 */
class NotFoundError extends AppError {
  constructor(resource = 'Resource', id = null) {
    const message = id ? `${resource} not found (id=${id})` : `${resource} not found`;
    super(message, 404, 'NOT_FOUND', { resource, id });
    this.name = 'NotFoundError';
  }
}

/**
 * Validation Error — for input validation failures (400)
 */
class ValidationError extends AppError {
  constructor(message, fields = null) {
    super(message, 400, 'VALIDATION_ERROR', { fields });
    this.name = 'ValidationError';
  }
}

/**
 * Unauthorized Error — for auth failures (401)
 */
class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

/**
 * Forbidden Error — for permission failures (403)
 */
class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

/**
 * Conflict Error — for duplicate/resource conflicts (409)
 */
class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

/**
 * Rate Limit Error — for throttled requests (429)
 */
class RateLimitError extends AppError {
  constructor(retryAfterSeconds = 60) {
    super('Too many requests. Please try again later.', 429, 'RATE_LIMITED', { retryAfterSeconds });
    this.name = 'RateLimitError';
  }
}

// ============================================
// Error Type Classification Engine
// ============================================

/**
 * Classify any thrown error into a standardized format.
 * Handles 15+ known error types from various libraries.
 *
 * @param {Error} err
 * @returns {{ statusCode, code, message, category }}
 */
function classifyError(err) {
  // Already classified (AppError or subclass)
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      category: err.isOperational ? 'operational' : 'programming',
    };
  }

  // JWT / Authentication errors
  if (err.name === 'JsonWebTokenError') {
    return { statusCode: 401, code: 'INVALID_TOKEN', message: 'Invalid authentication token', category: 'auth' };
  }
  if (err.name === 'TokenExpiredError') {
    return { statusCode: 401, code: 'TOKEN_EXPIRED', message: 'Authentication token has expired', category: 'auth' };
  }
  if (err.name === 'NotBeforeError') {
    return { statusCode: 401, code: 'TOKEN_NOT_ACTIVE', message: 'Authentication token is not yet active', category: 'auth' };
  }

  // express-validator errors
  if (err.name === 'ValidationError' && Array.isArray(err.errors)) {
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      category: 'validation',
    };
  }

  // Sequelize database errors
  if (err.name === 'SequelizeValidationError') {
    const details = err.errors?.map((e) => ({ field: e.path, message: e.message }));
    return { statusCode: 400, code: 'DB_VALIDATION_ERROR', message: 'Data validation failed', category: 'database', details };
  }
  if (err.name === 'SequelizeUniqueConstraintError') {
    return { statusCode: 409, code: 'DUPLICATE_ENTRY', message: 'A record with this value already exists', category: 'database' };
  }
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    return { statusCode: 400, code: 'FOREIGN_KEY_ERROR', message: 'Referenced resource does not exist', category: 'database' };
  }
  if (err.name === 'SequelizeConnectionError' || err.name === 'SequelizeConnectionRefusedError') {
    return { statusCode: 503, code: 'DB_CONNECTION_ERROR', message: 'Database connection failed', category: 'infrastructure' };
  }
  if (err.name === 'SequelizeDatabaseError') {
    return { statusCode: 500, code: 'DB_QUERY_ERROR', message: 'Database query execution failed', category: 'database' };
  }

  // Network / External service errors
  if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
    return { statusCode: 504, code: 'TIMEOUT', message: 'Operation timed out', category: 'infrastructure' };
  }
  if (err.code === 'ECONNREFUSED') {
    return { statusCode: 503, code: 'SERVICE_UNAVAILABLE', message: 'External service is unavailable', category: 'infrastructure' };
  }
  if (err.code === 'ECONNRESET') {
    return { statusCode: 502, code: 'CONNECTION_RESET', message: 'Connection was reset', category: 'infrastructure' };
  }

  // File upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return { statusCode: 413, code: 'FILE_TOO_LARGE', message: 'File size exceeds the allowed limit', category: 'client' };
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return { statusCode: 400, code: 'TOO_MANY_FILES', message: 'Too many files uploaded', category: 'client' };
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return { statusCode: 400, code: 'UNEXPECTED_FILE', message: 'Unexpected file field', category: 'client' };
  }

  // HTTP parsing errors
  if (err.type === 'entity.parse.failed') {
    return { statusCode: 400, code: 'MALFORMED_JSON', message: 'Request body contains invalid JSON', category: 'client' };
  }
  if (err.type === 'encoding.unsupported') {
    return { statusCode: 415, code: 'UNSUPPORTED_ENCODING', message: 'Unsupported content encoding', category: 'client' };
  }

  // CSRF errors (from our csrf middleware)
  if (err.code === 'CSRF_001' || err.code === 'CSRF_002' || err.code === 'CSRF_003') {
    return { statusCode: 403, code: err.code, message: err.message || 'CSRF validation failed', category: 'security' };
  }

  // Generic fallback — treat as internal server error
  return {
    statusCode: err.statusCode || err.status || 500,
    code: err.code || 'INTERNAL_ERROR',
    message: err.message || 'An unexpected error occurred',
    category: err.isOperational ? 'operational' : 'programming',
  };
}

// ============================================
// Error Rate Tracking (In-Memory Sliding Window)
// ============================================

/**
 * Tracks error counts by code over a sliding time window.
 * Used for alerting and circuit-breaker patterns.
 */
const errorRateTracker = {
  counts: {},       // { "NOT_FOUND": [{timestamp, count}, ...] }
  totals: {},       // { "NOT_FOUND": totalInWindow }

  /**
   * Record an error occurrence.
   * @param {string} errorCode
   */
  record(errorCode) {
    const now = Date.now();
    const windowStart = now - ERROR_CONFIG.rateWindowMs;

    if (!this.counts[errorCode]) {
      this.counts[errorCode] = [];
      this.totals[errorCode] = 0;
    }

    this.counts[errorCode].push(now);
    this.totals[errorCode]++;

    // Prune old entries periodically
    if (this.counts[errorCode].length % 100 === 0) {
      this.prune(errorCode, windowStart);
    }
  },

  /**
   * Prune expired entries for a specific error code.
   */
  prune(code, windowStart) {
    if (!this.counts[code]) return;
    const before = this.counts[code].length;
    this.counts[code] = this.counts[code].filter((ts) => ts > windowStart);
    this.totals[code] = Math.max(0, this.totals[code] - (before - this.counts[code].length));
  },

  /**
   * Get current error rates within the window.
   * @returns {{ [code]: number }}
   */
  getRates() {
    const windowStart = Date.now() - ERROR_CONFIG.rateWindowMs;
    const rates = {};

    for (const code of Object.keys(this.counts)) {
      this.prune(code, windowStart);
      rates[code] = this.counts[code].length;
    }

    return rates;
  },

  /**
   * Get summary stats for monitoring.
   */
  getSummary() {
    const rates = this.getRates();
    let totalErrors = 0;
    for (const count of Object.values(rates)) {
      totalErrors += count;
    }
    return {
      windowSeconds: Math.round(ERROR_CONFIG.rateWindowMs / 1000),
      totalErrors,
      errorCodes: Object.keys(rates).length,
      topErrors: Object.entries(rates)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([code, count]) => ({ code, count })),
    };
  },

  /**
   * Reset all tracking data.
   */
  reset() {
    this.counts = {};
    this.totals = {};
  },
};

// ============================================
// Centralized Error Handler Middleware
// ============================================

/**
 * Express error handling middleware.
 * Must be registered LAST in the middleware chain (after all routes).
 *
 * Features:
 *   - Auto-classifies 15+ error types
 *   - Logs every error with full context
 *   - Returns consistent JSON response format
 *   - Tracks error rates for monitoring
 *   - Correlates errors with request IDs
 */
const errorHandler = (err, req, res, _next) => {
  const requestId = req.requestId || 'unknown';

  // Classify the error
  const classification = classifyError(err);
  const { statusCode, code, message, category } = classification;

  // Track error rate
  errorRateTracker.record(code);

  // Build structured log entry
  errorLog.error(message, {
    requestId,
    method: req.method,
    path: req.originalUrl || req.path,
    ip: req.ip,
    userId: req.user?.id || null,
    userRole: req.user?.role || null,
    statusCode,
    errorCode: code,
    category,
    isOperational: err.isOperational || false,
    // Include stack only in logs (never in client response in production)
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  // Build the consistent error response
  const response = {
    success: false,
    error: code,
    message: sanitizeMessageForClient(message, category),
    timestamp: new Date().toISOString(),
    requestId,
    correlationId: requestId, // Alias for tracing systems
    path: req.originalUrl || req.path,
    method: req.method,
  };

  // Include details based on environment and error type
  if (ERROR_CONFIG.exposeDetails && err.details) {
    response.details = err.details;
  }
  if (classification.details) {
    response.details = classification.details;
  }

  // Stack traces only in development
  if (ERROR_CONFIG.exposeStack && err.stack) {
    response.stack = err.stack;
  }

  // Set standard error headers
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Error-Code', code);

  // Retry-After header for rate limits
  if (statusCode === 429 && err.details?.retryAfterSeconds) {
    res.setHeader('Retry-After', err.details.retryAfterSeconds);
  }

  res.status(statusCode).json(response);
};

// ============================================
// Async Route Wrapper (catches unhandled rejections)
// ============================================

/**
 * Wrap async route handlers to catch unhandled promise rejections
 * and forward them to the error handler middleware.
 *
 * Usage:
 *   router.get('/users', asyncHandler(async (req, res) => {
 *     const users = await User.findAll();
 *     res.json({ data: users });
 *   }));
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ============================================
// Client Message Sanitizer
// ============================================

/**
 * Sanitize error messages for client consumption.
 * In production, replace internal details with generic messages.
 */
function sanitizeMessageForClient(message, category) {
  if (ERROR_CONFIG.exposeDetails) {
    return message; // Dev/staging: show everything
  }

  // Production: hide internal details for certain categories
  const sensitiveCategories = ['programming', 'infrastructure', 'database'];
  if (sensitiveCategories.includes(category)) {
    // Return a generic message but preserve the error code for client logic
    return 'An internal error occurred. Please try again later.';
  }

  return message;
}

// ============================================
// 404 Not Found Handler
// ============================================

const notFoundHandler = (req, res) => {
  const requestId = req.requestId || 'unknown';

  errorLog.warn('Route not found', {
    requestId,
    method: req.method,
    path: req.originalUrl || req.path,
    ip: req.ip,
    userId: req.user?.id || null,
  });

  res.status(404).json({
    success: false,
    error: 'NOT_FOUND',
    message: `Endpoint ${req.method} ${req.originalUrl || req.path} does not exist`,
    timestamp: new Date().toISOString(),
    requestId,
    availableEndpoints: {
      health: '/api/v1/health',
      auth: '/api/v1/auth/*',
      accounts: '/api/v1/accounts',
      campaigns: '/api/v1/campaigns',
      emails: '/api/v1/emails',
      stats: '/api/v1/stats/*',
      progress: '/api/v1/progress/*',
      platforms: '/api/v1/platforms',
      tenants: '/api/v1/tenants',
    },
  });
};

// ============================================
// Exports
// ============================================

module.exports = {
  // Main middleware
  errorHandler,
  notFoundHandler,

  // Error classes (for route handlers to throw)
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitError,

  // Utilities
  asyncHandler,
  classifyError,

  // Monitoring
  errorRateTracker,
  getErrorRates: () => errorRateTracker.getRates(),
  getErrorSummary: () => errorRateTracker.getSummary(),

  // Config (read-only)
  ERROR_CONFIG,
};
