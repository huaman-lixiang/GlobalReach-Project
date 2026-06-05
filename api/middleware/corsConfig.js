/**
 * CORS Configuration Module — D09 Strategy Hardening
 *
 * Replaces the insecure `cors({ origin: '*' })` with a production-ready
 * configuration that includes:
 *
 *   - Origin whitelist (env var or hardcoded array)
 *   - Dynamic subdomain matching (regex support)
 *   - Method restriction (only what we actually use)
 *   - Header whitelist (explicit allowlist)
 *   - Preflight cache optimization (maxAge)
 *   - Dev vs Prod mode differentiation
 *   - Credential policy enforcement
 */

const cors = require('cors');
const { createLogger } = require('./logger');

const log = createLogger('CORS');

// ============================================
// Environment Detection
// ============================================

const isProduction = (process.env.NODE_ENV || 'development') === 'production';
const isDevelopment = !isProduction;

// ============================================
// Allowed Origins Configuration
// ============================================

/**
 * Parse CORS_ORIGINS env var into an array of allowed origins.
 * Supports:
 *   - Comma-separated: "https://app.example.com,https://admin.example.com"
 *   - Single string: "https://app.example.com"
 *   - Wildcard domains: "*.example.com" (matched via regex)
 */
function parseAllowedOrigins() {
  const envOrigins = process.env.CORS_ORIGINS;

  if (!envOrigins) {
    // No env var configured — use defaults based on environment
    return isProduction
      ? [] // Production: empty = deny all unless explicitly set
      : [
          'http://localhost:3000',
          'http://localhost:5173',  // Vite default
          'http://localhost:5174',
          'http://127.0.0.1:3000',
          'http://127.0.0.1:5173',
        ];
  }

  // Split comma-separated origins
  return envOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const ALLOWED_ORIGINS = parseAllowedOrigins();

// ============================================
// Dynamic Origin Validation
// ============================================

/**
 * Check if a request origin is allowed.
 * Supports:
 *   - Exact match: "https://app.example.com"
 *   - Wildcard prefix: "*.example.com" matches "sub.example.com" but NOT "evil.com"
 *   - Regex pattern: "/^https:\\/\\/.*\\.company\\.com$/"
 */
function isOriginAllowed(origin) {
  // No origin header (same-origin / mobile apps / Postman)
  if (!origin) {
    // In development, allow requests without Origin header
    // In production, require explicit Origin for browser requests
    return isDevelopment;
  }

  // Empty whitelist in production = deny all
  if (ALLOWED_ORIGINS.length === 0 && isProduction) {
    return false;
  }

  for (const allowed of ALLOWED_ORIGINS) {
    // Exact match
    if (allowed === origin) return true;

    // Wildcard domain pattern: *.example.com
    if (allowed.startsWith('*.')) {
      const baseDomain = allowed.slice(2); // Remove "*."
      // Match: sub.baseDomain OR just baseDomain itself
      if (
        origin === `https://${baseDomain}` ||
        origin === `http://${baseDomain}` ||
        origin.endsWith(`.${baseDomain}`)
      ) {
        return true;
      }
    }

    // Regex pattern (starts and ends with /)
    if (allowed.startsWith('/') && allowed.endsWith('/')) {
      try {
        const regex = new RegExp(allowed.slice(1, -1));
        if (regex.test(origin)) return true;
      } catch (_) {
        // Invalid regex — skip this entry
      }
    }
  }

  return false;
}

/**
 * CORS origin callback function for cors() middleware.
 * This is called on every preflight and actual request.
 */
function originCallback(origin, callback) {
  // No origin header — allow (same-origin, mobile apps, curl, Postman, health checks)
  if (!origin || origin === 'null' || origin === 'undefined') {
    return callback(null, true);
  }

  if (isOriginAllowed(origin)) {
    return callback(null, true); // Allow
  }

  // Deny silently — do NOT throw. Let cors library respond with proper 403/CORS headers.
  log.warn('CORS request denied', { origin });
  return callback(null, false);
}

// ============================================
// Build CORS Options
// ============================================

function buildCorsOptions() {
  return {
    // Origin validation — dynamic callback
    origin: originCallback,

    // Credentials — must be true when using cookies/auth tokens
    credentials: true,

    // Methods — ONLY what our API actually uses
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    // Allowed headers — explicit whitelist (no wildcard)
    allowedHeaders: [
      // Standard headers browsers always send
      'Accept',
      'Content-Type',
      'Authorization',
      'X-Requested-With',

      // Custom headers used by GlobalReach frontend
      'X-Request-ID',
      'X-Forwarded-For',
      'X-Real-IP',
      'X-Client-Version',
      'X-Device-Type',

      // API versioning (future D12)
      'Accept-Version',
      'API-Key',
    ],

    // Exposed headers — what the client can read from response
    exposedHeaders: [
      'X-Request-ID',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-Pagination-Total',
      'X-Pagination-Page',
      'X-Pagination-PageSize',
    ],

    // Preflight cache — reduce OPTIONS round-trips
    maxAge: isProduction ? 86400 : 3600, // 24h prod, 1h dev

    // Don't set Access-Control-Allow-Origin to '*' when credentials=true
    // (cors library handles this automatically with origin callback)

    // Status code for successful preflight
    optionsSuccessStatus: 204, // No Content (preferred over 200)
  };
}

// ============================================
// Create Middleware Instance
// ============================================

const corsOptions = buildCorsOptions();
const corsMiddleware = cors(corsOptions);

// ============================================
// Utility: CORS Health Check Info
// ============================================

function getCorsInfo() {
  return {
    mode: isProduction ? 'STRICT' : 'PERMISSIVE',
    credentialsEnabled: corsOptions.credentials,
    methods: corsOptions.methods,
    allowedHeadersCount: corsOptions.allowedHeaders.length,
    maxAgeSeconds: corsOptions.maxAge,
    allowedOrigins: ALLOWED_ORIGINS,
    allowedOriginsCount: ALLOWED_ORIGINS.length,
    optionsSuccessStatus: corsOptions.optionsSuccessStatus,
  };
}

// ============================================
// Exports
// ============================================

module.exports = {
  corsMiddleware,         // The Express middleware — use as app.use(corsMiddleware)
  corsOptions,            // Raw options object (for inspection/debugging)
  getCorsInfo,            // Returns current configuration summary
  isOriginAllowed,        // Test function (useful for custom routes)
  ALLOWED_ORIGINS,        // Current origin whitelist array
  isProduction,           // Environment flag
  buildCorsOptions,       // Rebuild options (e.g., after runtime config change),
};
