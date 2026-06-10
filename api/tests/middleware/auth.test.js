const jwt = require('jsonwebtoken');
const {
  generateAccessToken,
  verifyToken,
  optionalAuth,
  requireRole,
  validateRequest,
  JWT_SECRET,
  ACCESS_TOKEN_EXPIRES,
  REFRESH_TOKEN_EXPIRES,
} = require('../../middleware/auth');

// Use a known secret for testing so tokens are verifiable
const TEST_SECRET = 'test-secret-key-for-jest-testing-32chars!!';
const ORIGINAL_SECRET = process.env.JWT_SECRET;

beforeAll(() => {
  process.env.JWT_SECRET = TEST_SECRET;
  // Re-require to pick up new secret
  jest.resetModules();
});

afterAll(() => {
  process.env.JWT_SECRET = ORIGINAL_SECRET;
});

describe('Auth Middleware — Token Generation', () => {
  test('generateAccessToken should produce a valid JWT', () => {
    // We need fresh module with test secret
    const { generateAccessToken: gen } = require('../../middleware/auth');
    const payload = { id: 1, email: 'test@example.com', role: 'admin' };
    const token = gen(payload);

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts

    const decoded = jwt.verify(token, TEST_SECRET);
    expect(decoded.id).toBe(1);
    expect(decoded.email).toBe('test@example.com');
    expect(decoded.role).toBe('admin');
  });

  test('generateAccessToken should include exp claim', () => {
    const { generateAccessToken: gen } = require('../../middleware/auth');
    const token = gen({ id: 1 });
    const decoded = jwt.decode(token);

    expect(decoded.exp).toBeDefined();
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });
});

describe('Auth Middleware — verifyToken', () => {
  let req, res, next;

  beforeEach(() => {
    // Require fresh each test to use TEST_SECRET
    jest.resetModules();
    process.env.JWT_SECRET = TEST_SECRET;

    req = { headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  test('should reject requests without authorization header', () => {
    const { verifyToken: vt } = require('../../middleware/auth');
    vt(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'ACCESS_DENIED',
        code: 'AUTH_001',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('should accept valid Bearer token and set req.user', () => {
    const { verifyToken: vt, generateAccessToken: gen } = require('../../middleware/auth');
    const token = gen({ id: 42, email: 'a@b.com', role: 'editor' });
    req.headers.authorization = `Bearer ${token}`;

    vt(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe(42);
    expect(req.user.email).toBe('a@b.com');
    expect(req.user.role).toBe('editor');
    expect(req.tokenExp).toBeDefined();
  });

  test('should accept token without Bearer prefix (backward compat)', () => {
    const { verifyToken: vt, generateAccessToken: gen } = require('../../middleware/auth');
    const token = gen({ id: 1 });
    req.headers.authorization = token; // No Bearer prefix

    vt(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
  });

  test('should reject expired tokens with TOKEN_EXPIRED', () => {
    const { verifyToken: vt } = require('../../middleware/auth');
    // Create an already-expired token
    const token = jwt.sign({ id: 1 }, TEST_SECRET, { expiresIn: '-1s' });
    req.headers.authorization = `Bearer ${token}`;

    vt(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'TOKEN_EXPIRED',
        code: 'AUTH_002',
      })
    );
  });

  test('should reject invalid tokens with INVALID_TOKEN', () => {
    const { verifyToken: vt } = require('../../middleware/auth');
    req.headers.authorization = 'Bearer this-is-not-a-valid-token';

    vt(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'INVALID_TOKEN',
        code: 'AUTH_003',
      })
    );
  });
});

describe('Auth Middleware — optionalAuth', () => {
  let req, res, next;

  beforeEach(() => {
    jest.resetModules();
    process.env.JWT_SECRET = TEST_SECRET;

    req = { headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  test('should call next() when no authorization header is present', () => {
    const { optionalAuth: oa } = require('../../middleware/auth');
    oa(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  test('should set req.user when valid token is provided', () => {
    const { optionalAuth: oa, generateAccessToken: gen } = require('../../middleware/auth');
    const token = gen({ id: 99, role: 'viewer' });
    req.headers.authorization = `Bearer ${token}`;

    oa(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe(99);
    expect(req.user.role).toBe('viewer');
  });

  test('should still call next() when token is invalid (graceful degradation)', () => {
    const { optionalAuth: oa } = require('../../middleware/auth');
    req.headers.authorization = 'Bearer bad-token';

    oa(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });
});

describe('Auth Middleware — requireRole', () => {
  let req, res, next;

  beforeEach(() => {
    req = {};
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  test('should reject unauthenticated requests with 401', () => {
    const { requireRole: rr } = require('../../middleware/auth');
    const middleware = rr('admin');

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'AUTHENTICATION_REQUIRED',
        code: 'AUTH_004',
      })
    );
  });

  test('should allow user with matching role', () => {
    const { requireRole: rr } = require('../../middleware/auth');
    req.user = { id: 1, role: 'admin' };
    const middleware = rr('admin');

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('should reject user without matching role with 403', () => {
    const { requireRole: rr } = require('../../middleware/auth');
    req.user = { id: 2, role: 'viewer' };
    const middleware = rr('admin');

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'INSUFFICIENT_PERMISSIONS',
        code: 'AUTH_005',
      })
    );
  });

  test('should accept any of multiple allowed roles', () => {
    const { requireRole: rr } = require('../../middleware/auth');
    req.user = { id: 3, role: 'editor' };
    const middleware = rr('admin', 'editor', 'moderator');

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe('Auth Middleware — validateRequest', () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  test('should call next() when there are no validation errors', () => {
    // Mock validationResult to return empty errors array
    jest.mock('express-validator', () => ({
      validationResult: () => ({
        isEmpty: () => true,
        array: () => [],
      }),
    }));

    // Re-required after mock
    jest.resetModules();
    const { validateRequest: vr } = require('../../middleware/auth');

    vr(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('should return 400 when there are validation errors', () => {
    jest.mock('express-validator', () => ({
      validationResult: () => ({
        isEmpty: () => false,
        array: () => [
          { path: 'email', value: 'bad', msg: 'Invalid email format' },
          { path: 'name', value: '', msg: 'Name is required' },
        ],
      }),
    }));

    jest.resetModules();
    const { validateRequest: vr } = require('../../middleware/auth');

    vr(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'VALIDATION_ERROR',
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'email' }),
          expect.objectContaining({ field: 'name' }),
        ]),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('Auth Module — Exports & Configuration', () => {
  test('should export all expected functions', () => {
    const authModule = require('../../middleware/auth');

    expect(typeof authModule.generateAccessToken).toBe('function');
    expect(typeof authModule.generateRefreshToken).toBe('function');
    expect(typeof authModule.verifyToken).toBe('function');
    expect(typeof authModule.optionalAuth).toBe('function');
    expect(typeof authModule.requireRole).toBe('function');
    expect(typeof authModule.validateRequest).toBe('function');
    expect(typeof authModule.createRefreshToken).toBe('function');
    expect(typeof authModule.revokeAllUserTokens).toBe('function');
  });

  test('generateRefreshToken should produce a hex string of length 80', () => {
    const { generateRefreshToken: grt } = require('../../middleware/auth');
    const token = grt();

    expect(typeof token).toBe('string');
    expect(token).toMatch(/^[a-f0-9]{80}$/);
  });

  test('calling generateRefreshToken twice should produce different tokens', () => {
    const { generateRefreshToken: grt } = require('../../middleware/auth');
    const token1 = grt();
    const token2 = grt();

    expect(token1).not.toBe(token2);
  });
});
