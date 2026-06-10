const {
  errorHandler,
  notFoundHandler,
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  classifyError,
  asyncHandler,
  errorRateTracker,
} = require('../../middleware/errorHandler');

describe('errorHandler middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      method: 'GET',
      path: '/api/v1/test',
      originalUrl: '/api/v1/test',
      ip: '127.0.0.1',
      requestId: 'test-req-001',
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  // ─── Reset error rate tracker between tests ───
  afterEach(() => {
    errorRateTracker.reset();
  });

  // ════════════════════════════════════════════
  // AppError (operational errors)
  // ════════════════════════════════════════════
  test('should handle AppError with correct status code and message', () => {
    const err = new AppError('Resource not found', 404, 'NOT_FOUND');

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'NOT_FOUND',
        message: 'Resource not found',
        requestId: 'test-req-001',
      })
    );
  });

  test('should include details when provided on AppError', () => {
    const err = new AppError('Bad input', 400, 'VALIDATION_ERROR', { field: 'email' });

    errorHandler(err, req, res, next);

    const call = res.json.mock.calls[0][0];
    expect(call.details).toEqual({ field: 'email' });
  });

  // ════════════════════════════════════════════
  // Error Subclasses
  // ════════════════════════════════════════════
  test('NotFoundError should produce 404 with resource info', () => {
    const err = new NotFoundError('User', 42);

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'NOT_FOUND',
        message: expect.stringContaining('User not found'),
      })
    );
  });

  test('ValidationError should produce 400', () => {
    const err = new ValidationError('Invalid email', ['email']);

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'VALIDATION_ERROR' })
    );
  });

  test('UnauthorizedError should produce 401', () => {
    const err = new UnauthorizedError();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'UNAUTHORIZED' })
    );
  });

  test('ForbiddenError should produce 403', () => {
    const err = new ForbiddenError();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'FORBIDDEN' })
    );
  });

  test('ConflictError should produce 409', () => {
    const err = new ConflictError();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('RateLimitError should produce 429 with Retry-After header', () => {
    const err = new RateLimitError(60);

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 60);
  });

  // ════════════════════════════════════════════
  // classifyError — known third-party errors
  // ════════════════════════════════════════════
  test('should classify JsonWebTokenError as 401 INVALID_TOKEN', () => {
    const err = new Error('jwt malformed');
    err.name = 'JsonWebTokenError';

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'INVALID_TOKEN' })
    );
  });

  test('should classify TokenExpiredError as 401 TOKEN_EXPIRED', () => {
    const err = new Error('jwt expired');
    err.name = 'TokenExpiredError';

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'TOKEN_EXPIRED' })
    );
  });

  test('should classify NotBeforeError as 401 TOKEN_NOT_ACTIVE', () => {
    const err = new Error('jwt not active');
    err.name = 'NotBeforeError';

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'TOKEN_NOT_ACTIVE' })
    );
  });

  test('should classify SequelizeValidationError as 400 DB_VALIDATION_ERROR', () => {
    const err = new Error('Validation failed');
    err.name = 'SequelizeValidationError';
    err.errors = [{ path: 'email', message: 'Invalid email' }];

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'DB_VALIDATION_ERROR' })
    );
  });

  test('should classify SequelizeUniqueConstraintError as 409 DUPLICATE_ENTRY', () => {
    const err = new Error('Duplicate entry');
    err.name = 'SequelizeUniqueConstraintError';

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'DUPLICATE_ENTRY' })
    );
  });

  test('should classify SequelizeConnectionError as 503 DB_CONNECTION_ERROR', () => {
    const err = new Error('Connection refused');
    err.name = 'SequelizeConnectionError';

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'DB_CONNECTION_ERROR' })
    );
  });

  test('should classify SequelizeForeignKeyConstraintError as 400 FOREIGN_KEY_ERROR', () => {
    const err = new Error('FK violation');
    err.name = 'SequelizeForeignKeyConstraintError';

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'FOREIGN_KEY_ERROR' })
    );
  });

  test('should classify SequelizeDatabaseError as 500 DB_QUERY_ERROR', () => {
    const err = new Error('Query failed');
    err.name = 'SequelizeDatabaseError';

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'DB_QUERY_ERROR' })
    );
  });

  // ════════════════════════════════════════════
  // Network / Infrastructure errors
  // ════════════════════════════════════════════
  test('should classify ETIMEDOUT as 504 TIMEOUT', () => {
    const err = new Error('timeout');
    err.code = 'ETIMEDOUT';

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(504);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'TIMEOUT' })
    );
  });

  test('should classify ECONNREFUSED as 503 SERVICE_UNAVAILABLE', () => {
    const err = new Error('conn refused');
    err.code = 'ECONNREFUSED';

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'SERVICE_UNAVAILABLE' })
    );
  });

  test('should classify ECONNRESET as 502 CONNECTION_RESET', () => {
    const err = new Error('reset');
    err.code = 'ECONNRESET';

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'CONNECTION_RESET' })
    );
  });

  // ════════════════════════════════════════════
  // File upload / HTTP parsing errors
  // ════════════════════════════════════════════
  test('should classify LIMIT_FILE_SIZE as 413 FILE_TOO_LARGE', () => {
    const err = new Error('file too large');
    err.code = 'LIMIT_FILE_SIZE';

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'FILE_TOO_LARGE' })
    );
  });

  test('should classify entity.parse.failed as 400 MALFORMED_JSON', () => {
    const err = new Error('parse failed');
    err.type = 'entity.parse.failed';

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'MALFORMED_JSON' })
    );
  });

  // ════════════════════════════════════════════
  // CSRF errors
  // ════════════════════════════════════════════
  test('should classify CSRF error codes as 403', () => {
    const err = new Error('CSRF validation failed');
    err.code = 'CSRF_001';

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'CSRF_001' })
    );
  });

  // ════════════════════════════════════════════
  // Generic fallback (plain Error)
  // ════════════════════════════════════════════
  test('should return 500 for unknown plain Error', () => {
    const err = new Error('Something broke');

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'INTERNAL_ERROR',
      })
    );
  });

  test('should use err.statusCode if present on plain Error', () => {
    const err = new Error('Custom status');
    err.statusCode = 418;

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(418);
  });

  // ════════════════════════════════════════════
  // Response shape checks
  // ════════════════════════════════════════════
  test('should always set X-Request-ID and X-Error-Code headers', () => {
    const err = new AppError('test', 500);

    errorHandler(err, req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'test-req-001');
    expect(res.setHeader).toHaveBeenCalledWith('X-Error-Code', 'INTERNAL_ERROR');
  });

  test('should include timestamp and path/method in response body', () => {
    const err = new AppError('test', 400);

    errorHandler(err, req, res, next);

    const body = res.json.mock.calls[0][0];
    expect(body.timestamp).toBeDefined();
    expect(body.path).toBe('/api/v1/test');
    expect(body.method).toBe('GET');
    expect(body.correlationId).toBe('test-req-001');
  });

  test('should fall back to "unknown" when requestId is missing', () => {
    delete req.requestId;
    const err = new AppError('test', 500);

    errorHandler(err, req, res, next);

    const body = res.json.mock.calls[0][0];
    expect(body.requestId).toBe('unknown');
    expect(body.correlationId).toBe('unknown');
  });
});

// ════════════════════════════════════════════════════════
// notFoundHandler
// ════════════════════════════════════════════════════════
describe('notFoundHandler middleware', () => {
  let req, res;

  beforeEach(() => {
    req = {
      method: 'DELETE',
      originalUrl: '/api/v1/nonexistent',
      path: '/api/v1/nonexistent',
      ip: '10.0.0.1',
      requestId: 'nf-001',
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  test('should return 404 with NOT_FOUND error code', () => {
    notFoundHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'NOT_FOUND',
      })
    );
  });

  test('should include the unmatched endpoint in message', () => {
    notFoundHandler(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.message).toContain('DELETE');
    expect(body.message).toContain('/api/v1/nonexistent');
  });

  test('should list available endpoints', () => {
    notFoundHandler(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.availableEndpoints).toBeDefined();
    expect(body.availableEndpoints.health).toBe('/api/v1/health');
    expect(body.availableEndpoints.auth).toBe('/api/v1/auth/*');
  });
});

// ════════════════════════════════════════════════════════
// classifyError (standalone unit tests)
// ════════════════════════════════════════════════════════
describe('classifyError()', () => {
  test('should return operational category for AppError', () => {
    const err = new AppError('ops', 400);
    const result = classifyError(err);
    expect(result.category).toBe('operational');
    expect(result.statusCode).toBe(400);
  });

  test('should return programming category for plain Error without isOperational', () => {
    const err = new Error('bug');
    const result = classifyError(err);
    expect(result.category).toBe('programming');
    expect(result.statusCode).toBe(500);
  });

  test('should extract statusCode from err.status fallback', () => {
    const err = new Error('status');
    err.status = 422;
    const result = classifyError(err);
    expect(result.statusCode).toBe(422);
  });
});

// ════════════════════════════════════════════════════════
// asyncHandler
// ════════════════════════════════════════════════════════
describe('asyncHandler()', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
  });

  test('should call next with error when promise rejects', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('async fail'));
    const wrapper = asyncHandler(fn);

    await wrapper({}, {}, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toBe('async fail');
  });

  test('should not call next when promise resolves', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const wrapper = asyncHandler(fn);

    await wrapper({}, {}, next);

    expect(next).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════
// errorRateTracker
// ════════════════════════════════════════════════════════
describe('errorRateTracker', () => {
  beforeEach(() => errorRateTracker.reset());

  test('record() should increment count for an error code', () => {
    errorRateTracker.record('NOT_FOUND');
    errorRateTracker.record('NOT_FOUND');
    errorRateTracker.record('INTERNAL_ERROR');

    const rates = errorRateTracker.getRates();
    expect(rates['NOT_FOUND']).toBe(2);
    expect(rates['INTERNAL_ERROR']).toBe(1);
  });

  test('getSummary() should return aggregated stats', () => {
    errorRateTracker.record('NOT_FOUND');
    errorRateTracker.record('NOT_FOUND');
    errorRateTracker.record('RATE_LIMITED');

    const summary = errorRateTracker.getSummary();
    expect(summary.totalErrors).toBe(3);
    expect(summary.errorCodes).toBe(2);
    expect(summary.topErrors).toHaveLength(2);
    expect(summary.topErrors[0].code).toBe('NOT_FOUND');
    expect(summary.topErrors[0].count).toBe(2);
  });

  test('reset() should clear all tracking data', () => {
    errorRateTracker.record('NOT_FOUND');
    errorRateTracker.reset();

    const rates = errorRateTracker.getRates();
    expect(Object.keys(rates)).toHaveLength(0);
  });
});
