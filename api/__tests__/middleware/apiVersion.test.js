/**
 * Unit Tests: apiVersion.js — D12 API Versioning
 *
 * Covers:
 *   - Version extraction (URL path + header)
 *   - Version validation (accept/reject)
 *   - Deprecation warnings
 *   - Supported versions list
 */

const {
  apiVersionMiddleware,
  extractVersion,
  validateVersion,
  getLatestVersion,
  getSupportedVersions,
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  LATEST_VERSION,
} = require('../../middleware/apiVersion');

const { createMockRequest, createMockResponse, createMockNext } = require('../helpers');

describe('apiVersion — D12 API Versioning', () => {

  // ============================================
  // Version Extraction
  // ============================================

  describe('extractVersion', () => {
    test('extracts v1 from URL path /api/v1/users', () => {
      const req = { path: '/api/v1/users', headers: {} };
      expect(extractVersion(req)).toBe('1');
    });

    test('extracts v1 from URL path /api/v1/', () => {
      const req = { path: '/api/v1/', headers: {} };
      expect(extractVersion(req)).toBe('1');
    });

    test('extracts from Accept-Version header', () => {
      const req = { path: '/api/something', headers: { 'accept-version': '1' } };
      expect(extractVersion(req)).toBe('1');
    });

    test('handles Accept-Version with "v" prefix', () => {
      const req = { path: '/api/test', headers: { 'accept-version': 'v1' } };
      expect(extractVersion(req)).toBe('1');
    });

    test('returns default version when no version info present', () => {
      const req = { path: '/api/health', headers: {} };
      expect(extractVersion(req)).toBe(DEFAULT_VERSION);
    });

    test('URL path takes precedence over header', () => {
      const req = { path: '/api/v2/users', headers: { 'accept-version': '1' } };
      expect(extractVersion(req)).toBe('2'); // Path wins over header
    });
  });

  // ============================================
  // Version Validation
  // ============================================

  describe('validateVersion', () => {
    test('validates current supported version', () => {
      const result = validateVersion(LATEST_VERSION);
      expect(result.valid).toBe(true);
      expect(result.versionInfo.status).toBe('current');
    });

    test('rejects unsupported version with error response', () => {
      const result = validateVersion('99');

      expect(result.valid).toBe(false);
      expect(result.errorResponse).toBeDefined();
      expect(result.errorResponse.statusCode).toBe(400);
      expect(result.errorResponse.body.error).toBe('UNSUPPORTED_VERSION');
      expect(result.errorResponse.body.latestVersion).toContain(LATEST_VERSION);
    });

    test('error response includes supported versions list', () => {
      const result = validateVersion('invalid');
      expect(Array.isArray(result.errorResponse.body.supportedVersions)).toBe(true);
    });
  });

  // ============================================
  // API Version Middleware
  // ============================================

  describe('apiVersionMiddleware', () => {
    test('sets req.apiVersion for valid versioned requests', async () => {
      const req = createMockRequest({
        path: '/api/v1/accounts',
        headers: {},
        apiVersion: null,
        locals: {},
      });
      const res = createMockResponse();
      res.locals = {};
      res.setHeader = jest.fn();
      const next = createMockNext();

      await apiVersionMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.apiVersion).toBe('1');
      expect(res.locals.apiVersion).toBe('1');
    });

    test('sets API-Version response header', async () => {
      const req = createMockRequest({ path: '/api/v1/test', headers: {}, locals: {} });
      const res = createMockResponse();
      res.setHeader = jest.fn();

      await apiVersionMiddleware(req, res, jest.fn());

      expect(res.setHeader).toHaveBeenCalledWith('API-Version', 'v1');
      expect(res.setHeader).toHaveBeenCalledWith('X-API-Latest-Version', expect.any(String));
    });

    test('returns 400 for unsupported version in URL', async () => {
      const req = createMockRequest({ path: '/api/v99/test', headers: {}, locals: {} });
      const res = createMockResponse();
      res.json = jest.fn(() => res);
      res.status = jest.fn(() => res);
      res.setHeader = jest.fn();

      await apiVersionMiddleware(req, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'UNSUPPORTED_VERSION',
        })
      );
    });

    test('uses default version for unversioned paths', async () => {
      const req = createMockRequest({ path: '/api/health', headers: {}, locals: {} });
      const res = createMockResponse();
      res.setHeader = jest.fn();

      await apiVersionMiddleware(req, res, jest.fn());

      expect(req.apiVersion).toBe(DEFAULT_VERSION);
    });
  });

  // ============================================
  // Utility Functions
  // ============================================

  describe('getLatestVersion / getSupportedVersions', () => {
    test('getLatestVersion returns current version string', () => {
      const latest = getLatestVersion();
      expect(latest).toMatch(/^v\d+$/);
    });

    test('getSupportedVersions returns array of version objects', () => {
      const versions = getSupportedVersions();
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThanOrEqual(1);

      versions.forEach(v => {
        expect(v).toHaveProperty('version');
        expect(v).toHaveProperty('status');
        expect(v).toHaveProperty('released');
      });
    });
  });

  describe('Constants', () => {
    test('DEFAULT_VERSION is a string number', () => {
      expect(DEFAULT_VERSION).toMatch(/^\d+$/);
    });

    test('LATEST_VERSION equals DEFAULT_VERSION (single version)', () => {
      expect(LATEST_VERSION).toBe(DEFAULT_VERSION);
    });

    test('SUPPORTED_VERSIONS has at least one entry', () => {
      expect(Object.keys(SUPPORTED_VERSIONS).length).toBeGreaterThanOrEqual(1);
    });
  });
});
