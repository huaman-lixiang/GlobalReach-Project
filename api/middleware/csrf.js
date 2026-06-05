/**
 * CSRF Protection Module — D10 Strategy Hardening
 *
 * Implements defense-in-depth CSRF protection for JWT-based API:
 *
 *   - Cryptographically secure token generation (crypto.randomBytes)
 *   - In-memory token store with configurable TTL and auto-cleanup
 *   - Double-submit pattern: token issued at auth, validated on mutations
 *   - Safe methods exemption (GET / HEAD / OPTIONS)
 *   - Per-user token binding (prevents cross-user token reuse)
 *   - SameSite cookie attribute enforcement for any Set-Cookie responses
 *   - Configurable ignored paths (webhooks, health checks, public APIs)
 *   - Dev vs Prod mode (strictness levels)
 *
 * Usage:
 *   const { csrfProtection, csrfTokenMiddleware, issueCsrfToken } = require('./csrf');
 *
 *   // 1. Mount global validation middleware (validates X-CSRF-Token header)
 *   app.use(csrfProtection);
 *
 *   // 2. Mount token issuance endpoint
 *   app.get('/api/auth/csrf-token', csrfTokenMiddleware);
 */

const crypto = require('crypto');
const { createLogger } = require('./logger');

const log = createLogger('CSRF');

// ============================================
// Configuration
// ============================================

const CSRF_CONFIG = {
  // Token length in bytes (hex-encoded = 2x this length)
  tokenLength: 32, // 64-char hex string

  // Token time-to-live (milliseconds)
  tokenTTL: parseInt(process.env.CSRF_TOKEN_TTL || '7200000'), // Default: 2 hours

  // Maximum tokens per user (prevent memory exhaustion)
  maxTokensPerUser: parseInt(process.env.CSRF_MAX_TOKENS_PER_USER || '5'),

  // Cleanup interval (milliseconds) — purge expired tokens
  cleanupInterval: parseInt(process.env.CSRF_CLEANUP_INTERVAL || '300000'), // 5 minutes

  // Header name that client must send
  headerName: process.env.CSRF_HEADER_NAME || 'x-csrf-token',

  // Whether CSRF protection is enabled (can be disabled for testing)
  enabled: process.env.CSRF_DISABLED !== 'true',
};

const isProduction = (process.env.NODE_ENV || 'development') === 'production';

// ============================================
// In-Memory Token Store
// ============================================

/**
 * Structure: Map<userId, Array<{token, createdAt, used}>>
 *
 * Each user can have up to maxTokensPerUser active tokens.
 * Tokens are purged on cleanup if older than tokenTTL.
 */
const tokenStore = new Map();

/**
 * Generate a new CSRF token string.
 * @returns {string} Hex-encoded random token
 */
function generateToken() {
  return crypto.randomBytes(CSRF_CONFIG.tokenLength).toString('hex');
}

/**
 * Store a CSRF token for a specific user.
 * @param {string} userId
 * @returns {string} The generated token
 */
function storeToken(userId) {
  const token = generateToken();
  const now = Date.now();

  if (!tokenStore.has(userId)) {
    tokenStore.set(userId, []);
  }

  const userTokens = tokenStore.get(userId);

  // Enforce max tokens per user — remove oldest if limit reached
  while (userTokens.length >= CSRF_CONFIG.maxTokensPerUser) {
    userTokens.shift(); // Remove oldest
  }

  userTokens.push({
    token,
    createdAt: now,
    used: false,
  });

  log.debug('CSRF token issued', { userId, tokenPreview: `${token.slice(0, 8)}...` });

  return token;
}

/**
 * Validate a CSRF token for a specific user.
 * Removes the token after successful validation (one-time use).
 *
 * @param {string} userId
 * @param {string} token
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateToken(userId, token) {
  if (!userId || !token) {
    return { valid: false, reason: 'MISSING_CREDENTIALS' };
  }

  const userTokens = tokenStore.get(userId);

  if (!userTokens || userTokens.length === 0) {
    return { valid: false, reason: 'NO_TOKENS_FOR_USER' };
  }

  // Find matching token
  const tokenIndex = userTokens.findIndex(
    (entry) => entry.token === token && !entry.used
  );

  if (tokenIndex === -1) {
    // Check if token exists but was already used or expired
    const exists = userTokens.some((entry) => entry.token === token);
    if (exists) {
      return { valid: false, reason: 'TOKEN_ALREADY_USED' };
    }
    return { valid: false, reason: 'TOKEN_NOT_FOUND' };
  }

  const entry = userTokens[tokenIndex];

  // Check expiration
  if (Date.now() - entry.createdAt > CSRF_CONFIG.tokenTTL) {
    userTokens.splice(tokenIndex, 1); // Remove expired
    return { valid: false, reason: 'TOKEN_EXPIRED' };
  }

  // Mark as used (one-time use pattern — prevents replay attacks)
  entry.used = true;

  log.debug('CSRF token validated', { userId });

  return { valid: true };
}

/**
 * Revoke ALL CSRF tokens for a user (called on logout).
 * @param {string} userId
 */
function revokeUserTokens(userId) {
  if (tokenStore.has(userId)) {
    const count = tokenStore.get(userId).length;
    tokenStore.delete(userId);
    log.info(`All CSRF tokens revoked for user`, { userId, revokedCount: count });
  }
}

/**
 * Cleanup expired tokens from all users.
 * Called periodically by the cleanup timer.
 */
function cleanupExpiredTokens() {
  const now = Date.now();
  let totalRemoved = 0;

  for (const [userId, tokens] of tokenStore.entries()) {
    const beforeLen = tokens.length;

    // Remove expired AND used tokens
    const filtered = tokens.filter((entry) => {
      const isExpired = now - entry.createdAt > CSRF_CONFIG.tokenTTL;
      const isUsed = entry.used;
      return !isExpired && !isUsed;
    });

    if (filtered.length === 0) {
      tokenStore.delete(userId);
    } else {
      tokenStore.set(userId, filtered);
    }

    totalRemoved += beforeLen - filtered.length;
  }

  if (totalRemoved > 0) {
    log.debug(`CSRF token cleanup: ${totalRemoved} expired/used tokens removed`, {
      activeUsers: tokenStore.size,
    });
  }
}

// Start periodic cleanup
let cleanupTimer = null;
function startCleanup() {
  if (cleanupTimer) return; // Already running
  cleanupTimer = setInterval(cleanupExpiredTokens, CSRF_CONFIG.cleanupInterval);
  // Don't prevent Node.js from exiting
  if (cleanupTimer.unref) cleanupTimer.unref();
}
startCleanup();

// ============================================
// Safe Methods Detection
// ============================================

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isSafeMethod(method) {
  return SAFE_METHODS.has(method.toUpperCase());
}

// ============================================
// Paths to Ignore (no CSRF check needed)
// ============================================

/**
 * These paths are exempt from CSRF validation:
 * - Auth endpoints (login/register — user doesn't have a token yet)
 * - Health checks (automated monitoring)
 * - Webhook receivers (external services POST here)
 * - CSRF token endpoint itself (needs to work without existing token)
 */
const IGNORED_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/csrf-token',
  '/api/health',
  '/api/health/',
  '/api/metrics',
  '/api/webhooks/',       // Future webhook endpoints
];

/**
 * Check if a request path should be exempt from CSRF validation.
 * @param {string} path
 * @param {string} method
 * @returns {boolean}
 */
function shouldIgnorePath(path, method) {
  // Always ignore safe methods
  if (isSafeMethod(method)) return true;

  // Check against ignore list
  const normalizedPath = path.split('?')[0]; // Strip query string
  for (const ignored of IGNORED_PATHS) {
    if (normalizedPath === ignored || normalizedPath.startsWith(ignored)) {
      return true;
    }
  }

  return false;
}

// ============================================
// CSRF Protection Middleware
// ============================================

/**
 * Main CSRF protection middleware.
 *
 * Validation flow:
 * 1. If CSRF disabled → skip
 * 2. If safe method (GET/HEAD/OPTIONS) → skip
 * 3. If path in ignore list → skip
 * 4. If no authenticated user → skip (public endpoint)
 * 5. Extract X-CSRF-Token from headers
 * 6. Validate token against stored value for this user
 * 7. On failure → 403 Forbidden
 */
function csrfProtection(req, res, next) {
  // Feature flag check
  if (!CSRF_CONFIG.enabled) {
    return next();
  }

  // Skip safe methods
  if (isSafeMethod(req.method)) {
    return next();
  }

  // Skip ignored paths
  if (shouldIgnorePath(req.path, req.method)) {
    return next();
  }

  // Skip if no authenticated user (public endpoints don't need CSRF)
  // Note: This means routes WITHOUT verifyToken middleware won't be checked.
  // That's intentional — only authenticated mutating requests need CSRF protection.
  if (!req.user) {
    return next();
  }

  // Extract CSRF token from header
  const csrfToken = req.headers[CSRF_CONFIG.headerName.toLowerCase()];

  if (!csrfToken) {
    log.warn('CSRF token missing', {
      method: req.method,
      path: req.path,
      userId: req.user.id,
      requestId: req.requestId,
    });

    return res.status(403).json({
      success: false,
      error: 'CSRF_TOKEN_MISSING',
      message: `CSRF token required. Include it in the '${CSRF_CONFIG.headerName}' header.`,
      code: 'CSRF_001',
    });
  }

  // Validate token
  const result = validateToken(req.user.id, csrfToken);

  if (!result.valid) {
    log.warn('CSRF validation failed', {
      method: req.method,
      path: req.path,
      userId: req.user.id,
      reason: result.reason,
      requestId: req.requestId,
    });

    return res.status(403).json({
      success: false,
      error: 'CSRF_TOKEN_INVALID',
      message: `CSRF token validation failed: ${result.reason}. Get a new token from /api/auth/csrf-token.`,
      code: 'CSRF_002',
      details: { reason: result.reason },
    });
  }

  next();
}

// ============================================
// CSRF Token Issuance Endpoint Handler
// ============================================

/**
 * Middleware/handler for issuing CSRF tokens.
 * Must be mounted AFTER authentication middleware (verifyToken).
 *
 * GET /api/auth/csrf-token → { csrfToken: "..." }
 */
function csrfTokenMiddleware(req, res) {
  // Must be authenticated
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'AUTHENTICATION_REQUIRED',
      message: 'You must be logged in to get a CSRF token.',
      code: 'CSRF_003',
    });
  }

  const csrfToken = storeToken(req.user.id);

  res.json({
    success: true,
    data: {
      csrfToken,
      expiresIn: CSRF_CONFIG.tokenTTL,
      headerName: CSRF_CONFIG.headerName,
    },
    message: 'CSRF token issued successfully.',
  });
}

// ============================================
// Helper: Issue CSRF Token (for login/register)
// ============================================

/**
 * Call this inside login/register route handlers to include
 * a CSRF token in the response alongside access/refresh tokens.
 *
 * @param {string} userId
 * @returns {string} The newly issued CSRF token
 */
function issueCsrfToken(userId) {
  return storeToken(userId);
}

// ============================================
// SameSite Cookie Enforcement Middleware
// ============================================

/**
 * Ensures any Set-Cookie response includes SameSite attribute.
 * This is a safety net — our API doesn't use cookies for auth,
 * but if any middleware or future feature sets cookies, they'll
 * be protected by default.
 */
function enforceSameSiteCookie(req, res, next) {
  const originalSetCookie = res.setHeader.bind(res);

  res.setHeader = function (name, value) {
    if (name.toLowerCase() === 'set-cookie') {
      // Ensure SameSite=Strict and Secure flags
      if (typeof value === 'string' && !value.includes('SameSite')) {
        const separator = isProduction ? '; Secure; SameSite=Strict' : '; SameSite=Lax';
        value = value + separator;
        originalSetCookie(name, value);
        return;
      }
    }
    originalSetCookie(name, value);
  };

  next();
}

// ============================================
// Utility: Get CSRF Status Info
// ============================================

function getCsrfInfo() {
  let totalTokens = 0;
  for (const tokens of tokenStore.values()) {
    totalTokens += tokens.length;
  }

  return {
    enabled: CSRF_CONFIG.enabled,
    mode: isProduction ? 'STRICT' : 'STANDARD',
    headerName: CSRF_CONFIG.headerName,
    tokenTTLSeconds: Math.round(CSRF_CONFIG.tokenTTL / 1000),
    maxTokensPerUser: CSRF_CONFIG.maxTokensPerUser,
    activeUsers: tokenStore.size,
    totalActiveTokens: totalTokens,
    ignoredPathsCount: IGNORED_PATHS.length,
    safeMethods: [...SAFE_METHODS],
  };
}

// ============================================
// Exports
// ============================================

module.exports = {
  // Main middleware — mount globally after auth
  csrfProtection,

  // Token issuance handler — mount at GET /api/auth/csrf-token
  csrfTokenMiddleware,

  // Helper — call inside login/register to issue token with auth response
  issueCsrfToken,

  // Cleanup — call on logout
  revokeUserTokens,

  // Safety net — ensures all cookies have SameSite attribute
  enforceSameSiteCookie,

  // Utility — returns current status (for health/admin endpoints)
  getCsrfInfo,

  // Configuration (read-only)
  CSRF_CONFIG,

  // For testing
  _internal: {
    tokenStore,
    generateToken,
    validateToken,
    storeToken,
    cleanupExpiredTokens,
    shouldIgnorePath,
    isSafeMethod,
  },
};
