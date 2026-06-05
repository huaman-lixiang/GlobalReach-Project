/**
 * Unit Tests: errorHandler.js — D11 Unified Error Handling
 *
 * Covers:
 *   - Error class hierarchy (AppError + 6 subclasses)
 *   - 15+ error type classification
 *   - Error rate tracking (sliding window)
 *   - asyncHandler wrapper
 *   - Client message sanitization
 *   - Consistent response format
 */

const {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  classifyError,
  errorHandler,
  notFoundHandler,
  asyncHandler,
  errorRateTracker,
  getErrorSummary,
} = require('../../middleware/errorHandler');

const { createMockRequest, createMockResponse, createMockNext } = require('../helpers');

describe('errorHandler — D11 Unified Error Handling', () => {

  // ============================================
  // Error Class Hierarchy
  // ============================================

  describe('AppError (base class)', () => {
    test('should create with default values', () => {
      const err = new AppError('test error');
      expect(err.message).toBe('test error');
      expect(err.statusCode).toBe(500);
      expect(err.code).toBe('INTERNAL_ERROR');
      expect(err.isOperational).toBe(true);
      expect(err.name).toBe('AppError');
      expect(err.timestamp).toBeDefined();
    });

    test('should accept custom parameters', () => {
      const err = new AppError('not found', 404, 'NOT_FOUND', { id: 'abc' });
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
      expect(err.details).toEqual({ id: 'abc' });
    });

    test('should have stack trace captured', () => {
      const err = new AppError('test');
      expect(err.stack).toBeDefined();
      expect(typeof err.stack).toBe('string');
    });
  });

  describe('NotFoundError', () => {
    test('should create with resource name only', () => {
      const err = new NotFoundError('User');
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toContain('User not found');
      expect(err.details.resource).toBe('User');
      expect(err.details.id).toBeNull();
    });

    test('should include ID in message when provided', () => {
      const err = new NotFoundError('Campaign', 'camp-123');
      expect(err.message).toContain('camp-123');
      expect(err.details.id).toBe('camp-123');
    });
  });

  describe('ValidationError', () => {
    test('should create with field details', () => {
      const err = new ValidationError('Invalid input', ['email', 'password']);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details.fields).toEqual(['email', 'password']);
    });
  });

  describe('UnauthorizedError', () => {
    test('should default to standard message', () => {
      const err = new UnauthorizedError();
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('Authentication required');
    });

    test('should accept custom message', () => {
      const err = new UnauthorizedError('Token expired');
      expect(err.message).toBe('Token expired');
    });
  });

  describe('ForbiddenError', () => {
    test('should default to standard message', () => {
      const err = new ForbiddenError();
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('FORBIDDEN');
    });
  });

  describe('ConflictError', () => {
    test('should be 409 status', () => {
      const err = new ConflictError('Duplicate email');
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('CONFLICT');
    });
  });

  describe('RateLimitError', () => {
    test('should include retryAfterSeconds in details', () => {
      const err = new RateLimitError(30);
      expect(err.statusCode).toBe(429);
      expect(err.details.retryAfterSeconds).toBe(30);
    });
  });

  // ============================================
  // Error Classification Engine (15+ types)
  // ============================================

  describe('classifyError — 15+ error type classification', () => {
    // JWT errors
    test('classifies JsonWebTokenError as auth/401', () => {
      const err = new Error('invalid token');
      err.name = 'JsonWebTokenError';
      const result = classifyError(err);
      expect(result.statusCode).toBe(401);
      expect(result.code).toBe('INVALID_TOKEN');
      expect(result.category).toBe('auth');
    });

    test('classifies TokenExpiredError as auth/401', () => {
      const err = new Error('jwt expired');
      err.name = 'TokenExpiredError';
      const result = classifyError(err);
      expect(result.statusCode).toBe(401);
      expect(result.code).toBe('TOKEN_EXPIRED');
    });

    test('classifies NotBeforeError as auth/401', () => {
      const err = new Error('jwt not active');
      err.name = 'NotBeforeError';
      const result = classifyError(err);
      expect(result.code).toBe('TOKEN_NOT_ACTIVE');
    });

    // Sequelize errors
    test('classifies SequelizeValidationError as database/400', () => {
      const err = new Error('validation failed');
      err.name = 'SequelizeValidationError';
      err.errors = [{ path: 'email', message: 'Invalid email' }];
      const result = classifyError(err);
      expect(result.statusCode).toBe(400);
      expect(result.category).toBe('database');
      expect(result.details).toBeDefined();
    });

    test('classifies SequelizeUniqueConstraintError as database/409', () => {
      const err = new Error('duplicate key');
      err.name = 'SequelizeUniqueConstraintError';
      const result = classifyError(err);
      expect(result.statusCode).toBe(409);
      expect(result.code).toBe('DUPLICATE_ENTRY');
    });

    test('classifies SequelizeForeignKeyConstraintError as database/400', () => {
      const err = new Error('foreign key violation');
      err.name = 'SequelizeForeignKeyConstraintError';
      const result = classifyError(err);
      expect(result.code).toBe('FOREIGN_KEY_ERROR');
    });

    test('classifies SequelizeConnectionError as infrastructure/503', () => {
      const err = new Error('connection refused');
      err.name = 'SequelizeConnectionError';
      const result = classifyError(err);
      expect(result.statusCode).toBe(503);
      expect(result.category).toBe('infrastructure');
    });

    test('classifies SequelizeDatabaseError as database/500', () => {
      const err = new Error('query failed');
      err.name = 'SequelizeDatabaseError';
      const result = classifyError(err);
      expect(result.statusCode).toBe(500);
      expect(result.category).toBe('database');
    });

    // Network errors
    test('classifies ETIMEDOUT as infrastructure/504', () => {
      const err = new Error('timeout');
      err.code = 'ETIMEDOUT';
      const result = classifyError(err);
      expect(result.statusCode).toBe(504);
      expect(result.code).toBe('TIMEOUT');
    });

    test('classifies ECONNREFUSED as infrastructure/503', () => {
      const err = new Error('refused');
      err.code = 'ECONNREFUSED';
      const result = classifyError(err);
      expect(result.statusCode).toBe(503);
      expect(result.code).toBe('SERVICE_UNAVAILABLE');
    });

    test('classifies ECONNRESET as infrastructure/502', () => {
      const err = new Error('reset');
      err.code = 'ECONNRESET';
      const result = classifyError(err);
      expect(result.statusCode).toBe(502);
      expect(result.code).toBe('CONNECTION_RESET');
    });

    // File upload errors
    test('classifies LIMIT_FILE_SIZE as client/413', () => {
      const err = new Error('file too large');
      err.code = 'LIMIT_FILE_SIZE';
      const result = classifyError(err);
      expect(result.statusCode).toBe(413);
      expect(result.code).toBe('FILE_TOO_LARGE');
    });

    test('classifies LIMIT_UNEXPECTED_FILE as client/400', () => {
      const err = new Error('unexpected file');
      err.code = 'LIMIT_UNEXPECTED_FILE';
      const result = classifyError(err);
      expect(result.statusCode).toBe(400);
      expect(result.code).toBe('UNEXPECTED_FILE');
    });

    // HTTP parsing errors
    test('classifies entity.parse.failed as client/400', () => {
      const err = new Error('parse error');
      err.type = 'entity.parse.failed';
      const result = classifyError(err);
      expect(result.statusCode).toBe(400);
      expect(result.code).toBe('MALFORMED_JSON');
    });

    // CSRF errors
    test('classifies CSRF_001 as security/403', () => {
      const err = new Error('CSRF missing');
      err.code = 'CSRF_001';
      const result = classifyError(err);
      expect(result.statusCode).toBe(403);
      expect(result.category).toBe('security');
    });

    // AppError passthrough
    test('preserves AppError properties through classification', () => {
      const err = new NotFoundError('TestResource');
      const result = classifyError(err);
      expect(result.statusCode).toBe(404);
      expect(result.code).toBe('NOT_FOUND');
      expect(result.category).toBe('operational');
    });

    // Generic fallback
    test('handles unknown errors as internal server error', () => {
      const err = new Error('something went wrong');
      const result = classifyError(err);
      expect(result.statusCode).toBe(500);
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.category).toBe('programming');
    });
  });

  // ============================================
  // Error Rate Tracking
  // ============================================

  describe('errorRateTracker — sliding window rate tracking', () => {
    beforeEach(() => {
      errorRateTracker.reset();
    });

    test('records and counts errors by code', () => {
      errorRateTracker.record('NOT_FOUND');
      errorRateTracker.record('NOT_FOUND');
      errorRateTracker.record('VALIDATION_ERROR');

      const rates = errorRateTracker.getRates();
      expect(rates['NOT_FOUND']).toBe(2);
      expect(rates['VALIDATION_ERROR']).toBe(1);
    });

    test('provides summary stats', () => {
      errorRateTracker.record('ERROR_A');
      errorRateTracker.record('ERROR_B');
      errorRateTracker.record('ERROR_C');
      errorRateTracker.record('ERROR_A');

      const summary = getErrorSummary();
      expect(summary.totalErrors).toBe(4);
      expect(summary.errorCodes).toBe(3);
      expect(summary.topErrors[0].code).toBe('ERROR_A');
      expect(summary.topErrors[0].count).toBe(2);
    });

    test('resets all tracking data', () => {
      errorRateTracker.record('SOME_ERROR');
      errorRateTracker.reset();

      const summary = getErrorSummary();
      expect(summary.totalErrors).toBe(0);
    });
  });

  // ============================================
  // asyncHandler Wrapper
  // ============================================

  describe('asyncHandler — catches unhandled rejections', () => {
    test('passes resolved values through', async () => {
      const handler = asyncHandler(async (req, res) => {
        res.json({ success: true });
      });

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await handler(req, res, next);

      expect(res.body.success).toBe(true);
      expect(next).not.toHaveBeenCalled();
    });

    test('forwards errors to next()', async () => {
      const testError = new Error('async failure');
      const handler = asyncHandler(async (_req, _res, _next) => {
        throw testError;
      });

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(testError);
    });
  });

  // ============================================
  // errorHandler Middleware
  // ============================================

  describe('errorHandler middleware', () => {
    test('returns consistent JSON response for AppError', () => {
      const err = new NotFoundError('User', '123');
      const req = createMockRequest({ requestId: 'test-req-001' });
      const res = createMockResponse();
      const next = jest.fn();

      errorHandler(err, req, res, next);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('NOT_FOUND');
      expect(res.body.requestId).toBe('test-req-001');
      expect(res.body.correlationId).toBe('test-req-001');
      expect(res.body.timestamp).toBeDefined();
      expect(res.headers['X-Request-ID']).toBe('test-req-001');
      expect(res.headers['X-Error-Code']).toBe('NOT_FOUND');
    });

    test('includes details in response when available', () => {
      const err = new ValidationError('Bad input', ['email']);
      const req = createMockRequest({ requestId: 'req-002' });
      const res = createMockResponse();

      errorHandler(err, req, res, jest.fn());

      expect(res.body.details).toBeDefined();
      expect(res.body.details.fields).toEqual(['email']);
    });

    test('sets Retry-After header for RateLimitError', () => {
      const err = new RateLimitError(60);
      const req = createMockRequest();
      const res = createMockResponse();

      errorHandler(err, req, res, jest.fn());

      expect(res.headers['Retry-After']).toBe(60);
    });

    test('handles generic unknown errors', () => {
      const err = new Error('unexpected crash');
      const req = createMockRequest({ requestId: 'req-003' });
      const res = createMockResponse();

      errorHandler(err, req, res, jest.fn());

      expect(res.statusCode).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================
  // notFoundHandler Middleware
  // ============================================

  describe('notFoundHandler middleware', () => {
    test('returns 404 with endpoint hints', () => {
      const req = createMockRequest({
        method: 'DELETE',
        path: '/api/v1/unknown',
        originalUrl: '/api/v1/unknown',
        requestId: 'req-nf-001',
        user: { id: 'u1' },
      });
      const res = createMockResponse();

      notFoundHandler(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
      expect(res.body.availableEndpoints).toBeDefined();
      expect(Object.keys(res.body.availableEndpoints).length).toBeGreaterThan(5);
    });
  });
});
