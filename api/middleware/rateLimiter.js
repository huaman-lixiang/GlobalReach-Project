const rateLimit = require('express-rate-limit');

// S112/PhaseI: Production rate limit tuning
// Default: 30000 req / 15 min = ~33 rps (was 1000 = 1.11 rps, too strict for load testing)
// Override via env: RATE_LIMIT_MAX (per 15-min window) or RATE_LIMIT_WINDOW_MS
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX || '30000');
const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000));

const rateLimiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests from this IP, please try again later',
    code: 'RATE_001',
    retryAfter: Math.ceil(rateLimitWindowMs / 1000)
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again later',
      code: 'RATE_001',
      retryAfter: Math.ceil(rateLimitWindowMs / 1000)
    });
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'AUTH_RATE_LIMIT',
    message: 'Too many authentication attempts, please try again after 15 minutes',
    code: 'AUTH_001'
  },
  skipSuccessfulRequests: true
});

const emailSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: {
    success: false,
    error: 'EMAIL_RATE_LIMIT',
    message: 'Email send rate limit exceeded (20 per minute)',
    code: 'EMAIL_001'
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
    message: 'Batch operation rate limit exceeded (5 per 5 minutes)',
    code: 'BATCH_001'
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
          return res.status(429).json({
            success: false,
            error: 'ACTION_RATE_LIMITED',
            message: `Too many ${actionName} attempts. Try again in ${resetSeconds}s.`,
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

module.exports = {
  rateLimiter,
  authLimiter,
  emailSendLimiter,
  batchOperationLimiter,
  actionRateLimit,
};
