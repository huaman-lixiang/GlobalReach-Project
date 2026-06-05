/**
 * API Versioning Middleware — D12
 *
 * Implements RESTful API versioning with:
 *   - URL path prefix versioning (/api/v1/, /api/v2/)
 *   - Header-based version negotiation (Accept-Version)
 *   - Version deprecation warnings
 *   - Backward compatibility layer
 *   - Version metadata in all responses
 *
 * Usage:
 *   // In server.js, mount versioned routes:
 *   app.use('/api/v1/accounts', accountRoutes);
 *   // The apiVersion middleware sets req.apiVersion automatically
 */

const { createLogger } = require('./logger');
const log = createLogger('APIVersion');

// ============================================
// Configuration
// ============================================

/**
 * Supported API versions with their status.
 * "current" = actively developed
 * "deprecated" = still works but warns clients
 * "sunsetting" = will be removed soon
 */
const SUPPORTED_VERSIONS = {
  '1': {
    status: 'current',
    released: '2026-01-01',
    sunsetDate: null, // No sunset planned yet
    deprecationNotice: null,
  },
};

// Default version when none specified
const DEFAULT_VERSION = '1';

// Current latest version
const LATEST_VERSION = '1';

// ============================================
// Version Extraction & Validation
// ============================================

/**
 * Extract API version from request.
 * Priority: URL path > Accept-Version header > default
 *
 * @param {import('express').Request} req
 * @returns {string} Version string (e.g., "1")
 */
function extractVersion(req) {
  // 1. Check URL path: /api/v{N}/...
  const pathMatch = req.path.match(/^\/api\/v(\d+)(\/|$)/);
  if (pathMatch) {
    return pathMatch[1];
  }

  // 2. Check Accept-Version header
  const headerVersion = req.headers['accept-version'];
  if (headerVersion) {
    // Support both "1" and "v1" formats
    return headerVersion.replace(/^v/i, '');
  }

  // 3. Default
  return DEFAULT_VERSION;
}

/**
 * Validate that the requested version is supported.
 * @param {string} version
 * @returns {{ valid: boolean, versionInfo?: object, errorResponse?: object }}
 */
function validateVersion(version) {
  const versionInfo = SUPPORTED_VERSIONS[version];

  if (!versionInfo) {
    return {
      valid: false,
      errorResponse: {
        statusCode: 400,
        body: {
          success: false,
          error: 'UNSUPPORTED_VERSION',
          message: `API version ${version} is not supported. Current version: v${LATEST_VERSION}`,
          supportedVersions: Object.keys(SUPPORTED_VERSIONS).map((v) => `v${v}`),
          latestVersion: `v${LATEST_VERSION}`,
        },
      },
    };
  }

  if (versionInfo.status === 'deprecated' || versionInfo.status === 'sunsetting') {
    log.warn(`Client using ${versionInfo.status} API version`, {
      version,
      status: versionInfo.status,
      sunsetDate: versionInfo.sunsetDate,
    });
  }

  return { valid: true, versionInfo };
}

// ============================================
// Middleware
// ============================================

/**
 * API Version middleware.
 * Sets req.apiVersion and res.locals.apiVersion for downstream use.
 * Also sets response headers indicating API version.
 */
function apiVersionMiddleware(req, res, next) {
  const version = extractVersion(req);
  const validation = validateVersion(version);

  if (!validation.valid) {
    const { statusCode, body } = validation.errorResponse;
    return res.status(statusCode).json({
      ...body,
      timestamp: new Date().toISOString(),
      requestId: req.requestId || 'unknown',
    });
  }

  // Attach version to request and response locals
  req.apiVersion = version;
  res.locals.apiVersion = version;
  res.locals.versionInfo = validation.versionInfo;

  // Set standard version headers on ALL responses
  res.setHeader('API-Version', `v${version}`);
  res.setHeader('X-API-Latest-Version', `v${LATEST_VERSION}`);

  // Deprecation warning header for deprecated/sunsetting versions
  if (validation.versionInfo.status === 'deprecated') {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', validation.versionInfo.sunsetDate || '');
    if (validation.versionInfo.deprecationNotice) {
      res.setHeader('Link', `<https://docs.example.com/migration>; rel="deprecation"; type="text/html"`);
    }
  }

  next();
}

// ============================================
// Response Version Metadata Helper
// ============================================

/**
 * Add version metadata to a successful API response.
 * Call this in route handlers before res.json().
 *
 * @param {import('express').Response} res
 * @param {object} data - The response data object
 * @returns {object} Data with version metadata merged in
 */
function addVersionMetadata(res, data) {
  const version = res.locals.apiVersion || DEFAULT_VERSION;
  const versionInfo = SUPPORTED_VERSIONS[version] || {};

  return {
    ...data,
    _meta: {
      apiVersion: `v${version}`,
      versionStatus: versionInfo.status || 'unknown',
      serverTime: new Date().toISOString(),
    },
  };
}

// ============================================
// Utility Functions
// ============================================

function getSupportedVersions() {
  return Object.entries(SUPPORTED_VERSIONS).map(([num, info]) => ({
    version: `v${num}`,
    ...info,
  }));
}

function getLatestVersion() {
  return `v${LATEST_VERSION}`;
}

// ============================================
// Exports
// ============================================

module.exports = {
  // Main middleware
  apiVersionMiddleware,

  // Helpers
  extractVersion,
  validateVersion,
  addVersionMetadata,

  // Info utilities
  getSupportedVersions,
  getLatestVersion,
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  LATEST_VERSION,
};
