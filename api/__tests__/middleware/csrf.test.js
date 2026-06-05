/**
 * Unit Tests: csrf.js — D10 CSRF Protection
 *
 * Covers:
 *   - Token generation (crypto.randomBytes)
 *   - Token storage & validation (one-time use)
 *   - Replay attack prevention
 *   - Per-user token binding
 *   - Token expiration (TTL)
 *   - Safe methods exemption
 *   - Ignored paths
 *   - Token revocation on logout
 */

const {
  csrfProtection,
  csrfTokenMiddleware,
  issueCsrfToken,
  revokeUserTokens,
  enforceSameSiteCookie,
  getCsrfInfo,
  CSRF_CONFIG,
  _internal,
} = require('../../middleware/csrf');

const { createMockRequest, createMockResponse, createMockNext } = require('../helpers');

describe('csrf — D10 CSRF Protection', () => {

  beforeEach(() => {
    // Reset internal state before each test
    _internal.tokenStore.clear();
  });

  // ============================================
  // Token Generation
  // ============================================

  describe('Token Generation', () => {
    test('generates 64-character hex tokens', () => {
      const token = _internal.generateToken();
      expect(token).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
    });

    test('generates unique tokens each time', () => {
      const tokens = new Set(Array.from({ length: 100 }, () => _internal.generateToken()));
      expect(tokens.size).toBe(100);
    });
  });

  // ============================================
  // Token Storage & Validation
  // ============================================

  describe('Token Storage', () => {
    test('stores token for a user', () => {
      const userId = 'user-001';
      const token = _internal.storeToken(userId);

      expect(token).toBeDefined();
      expect(token.length).toBe(64);

      const ctx = _internal.tokenStore.get(userId);
      expect(ctx).toBeDefined();
      expect(ctx[0].token).toBe(token);
      expect(ctx[0].used).toBe(false);
    });

    test('enforces max tokens per user (removes oldest)', () => {
      const userId = 'user-max-test';

      // Store more than maxTokensPerUser
      for (let i = 0; i < CSRF_CONFIG.maxTokensPerUser + 3; i++) {
        _internal.storeToken(userId);
      }

      const ctx = _internal.tokenStore.get(userId);
      expect(ctx.length).toBeLessThanOrEqual(CSRF_CONFIG.maxTokensPerUser);
    });

    test('stores multiple tokens for different users independently', () => {
      const token1 = _internal.storeToken('user-A');
      const token2 = _internal.storeToken('user-B');

      expect(token1).not.toBe(token2);

      const storeA = _internal.tokenStore.get('user-A');
      const storeB = _internal.tokenStore.get('user-B');
      expect(storeA[0].token).toBe(token1);
      expect(storeB[0].token).toBe(token2);
    });
  });

  describe('Token Validation', () => {
    test('validates correct token for correct user', () => {
      const userId = 'user-validate-1';
      const token = _internal.storeToken(userId);

      const result = _internal.validateToken(userId, token);
      expect(result.valid).toBe(true);
    });

    test('rejects invalid/fake token', () => {
      const userId = 'user-validate-2';
      _internal.storeToken(userId);

      const result = _internal.validateToken(userId, 'fake-token-not-real');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('TOKEN_NOT_FOUND');
    });

    test('rejects token used by wrong user (cross-user binding)', () => {
      const tokenA = _internal.storeToken('user-A');
      _internal.storeToken('user-B');

      const result = _internal.validateToken('user-B', tokenA);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('TOKEN_NOT_FOUND'); // Not found in user-B's store
    });

    test('REPLAY ATTACK: rejects already-used token (one-time use)', () => {
      const userId = 'user-replay';
      const token = _internal.storeToken(userId);

      // First use succeeds
      const result1 = _internal.validateToken(userId, token);
      expect(result1.valid).toBe(true);

      // Second use (replay) fails
      const result2 = _internal.validateToken(userId, token);
      expect(result2.valid).toBe(false);
      expect(result2.reason).toBe('TOKEN_ALREADY_USED');
    });

    test('rejects missing credentials', () => {
      const result = _internal.validateToken(null, null);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('MISSING_CREDENTIALS');
    });

    test('rejects when no tokens exist for user', () => {
      const result = _internal.validateToken('nonexistent-user', 'some-token');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('NO_TOKENS_FOR_USER');
    });
  });

  // ============================================
  // Token Revocation
  // ============================================

  describe('revokeUserTokens', () => {
    test('removes all tokens for a user', () => {
      const userId = 'user-revoke';
      _internal.storeToken(userId);
      _internal.storeToken(userId);
      _internal.storeToken(userId);

      expect(_internal.tokenStore.get(userId).length).toBe(3);

      revokeUserTokens(userId);

      expect(_internal.tokenStore.has(userId)).toBe(false);
    });

    test('does not affect other users\' tokens', () => {
      _internal.storeToken('user-A');
      _internal.storeToken('user-B');

      revokeUserTokens('user-A');

      expect(_internal.tokenStore.has('user-A')).toBe(false);
      expect(_internal.tokenStore.has('user-B')).toBe(true);
    });
  });

  // ============================================
  // Safe Methods Exemption
  // ============================================

  describe('isSafeMethod / shouldIgnorePath', () => {
    test('GET is safe method', () => {
      expect(_internal.isSafeMethod('GET')).toBe(true);
    });

    test('HEAD is safe method', () => {
      expect(_internal.isSafeMethod('HEAD')).toBe(true);
    });

    test('OPTIONS is safe method', () => {
      expect(_internal.isSafeMethod('OPTIONS')).toBe(true);
    });

    test('POST is NOT safe method', () => {
      expect(_internal.isSafeMethod('POST')).toBe(false);
    });

    test('PUT/PATCH/DELETE are NOT safe methods', () => {
      expect(_internal.isSafeMethod('PUT')).toBe(false);
      expect(_internal.isSafeMethod('PATCH')).toBe(false);
      expect(_internal.isSafeMethod('DELETE')).toBe(false);
    });

    test('ignores login path for POST', () => {
      expect(_internal.shouldIgnorePath('/api/auth/login', 'POST')).toBe(true);
    });

    test('ignores register path for POST', () => {
      expect(_internal.shouldIgnorePath('/api/auth/register', 'POST')).toBe(true);
    });

    test('ignores health path for GET', () => {
      expect(_internal.shouldIgnorePath('/api/health', 'GET')).toBe(true);
    });

    test('does NOT ignore arbitrary POST path', () => {
      expect(_internal.shouldIgnorePath('/api/accounts', 'POST')).toBe(false);
    });
  });

  // ============================================
  // CSRF Protection Middleware
  // ============================================

  describe('csrfProtection middleware', () => {
    test('skips safe methods (GET)', async () => {
      const req = createMockRequest({ method: 'GET' });
      const res = createMockResponse();
      const next = createMockNext();

      await csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('skips HEAD method', async () => {
      const req = createMockRequest({ method: 'HEAD' });
      const res = createMockResponse();
      const next = createMockNext();

      await csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('skips OPTIONS method', async () => {
      const req = createMockRequest({ method: 'OPTIONS' });
      const res = createMockResponse();
      const next = createMockNext();

      await csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('skips requests without authenticated user', async () => {
      const req = createMockRequest({ method: 'POST', user: null });
      const res = createMockResponse();
      const next = createMockNext();

      await csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('returns 403 when CSRF token missing on POST', async () => {
      const req = createMockRequest({
        method: 'POST',
        path: '/api/v1/campaigns',
        user: { id: 'u1' },
        headers: {},
      });
      const res = createMockResponse();
      const next = createMockNext();

      await csrfProtection(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('CSRF_TOKEN_MISSING');
      expect(res.body.code).toBe('CSRF_001');
      expect(next).not.toHaveBeenCalled();
    });

    test('returns 403 when CSRF token is invalid', async () => {
      const req = createMockRequest({
        method: 'POST',
        user: { id: 'u1' },
        headers: { 'x-csrf-token': 'invalid-token-value' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await csrfProtection(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('CSRF_TOKEN_INVALID');
      expect(res.body.code).toBe('CSRF_002');
    });

    test('allows valid CSRF token on POST', async () => {
      const userId = 'csrf-mw-user';
      const validToken = issueCsrfToken(userId);

      const req = createMockRequest({
        method: 'POST',
        user: { id: userId },
        headers: { 'x-csrf-token': validToken },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await csrfProtection(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test('skips ignored paths even with POST', async () => {
      const req = createMockRequest({
        method: 'POST',
        path: '/api/auth/login',
        user: { id: 'u1' },
        headers: {},
      });
      const res = createMockResponse();
      const next = createMockNext();

      await csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  // ============================================
  // getCsrfInfo Utility
  // ============================================

  describe('getCsrfInfo', () => {
    test('returns configuration summary', () => {
      const info = getCsrfInfo();
      expect(info.enabled).toBe(true);
      expect(info.headerName).toBeDefined();
      expect(info.tokenTTLSeconds).toBeGreaterThan(0);
      expect(info.maxTokensPerUser).toBeGreaterThan(0);
      expect(info.safeMethods).toContain('GET');
      expect(info.safeMethods).toContain('HEAD');
      expect(info.safeMethods).toContain('OPTIONS');
    });
  });

  // ============================================
  // issueCsrfToken Helper
  // ============================================

  describe('issueCsrfToken', () => {
    test('issues a valid token that can be validated', () => {
      const userId = 'issue-test-user';
      const token = issueCsrfToken(userId);

      expect(token).toBeDefined();
      expect(token.length).toBe(64);

      const result = _internal.validateToken(userId, token);
      expect(result.valid).toBe(true);
    });
  });
});
