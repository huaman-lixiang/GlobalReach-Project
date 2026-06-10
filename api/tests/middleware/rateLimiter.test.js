const {
  rateLimiter,
  autoEndpointLimiter,
  authLimiter,
  emailSendLimiter,
  batchOperationLimiter,
  actionRateLimit,
  isInternalService,
  endpointLimits,
  getEndpointLimiter,
  initMetrics,
  _config,
} = require('../../middleware/rateLimiter');

describe('rateLimiter module — exports & structure', () => {
  test('should export rateLimiter as a function (express middleware)', () => {
    expect(typeof rateLimiter).toBe('function');
  });

  test('should export autoEndpointLimiter as a function', () => {
    expect(typeof autoEndpointLimiter).toBe('function');
  });

  test('should export authLimiter as a function', () => {
    expect(typeof authLimiter).toBe('function');
  });

  test('should export emailSendLimiter as a function', () => {
    expect(typeof emailSendLimiter).toBe('function');
  });

  test('should export batchOperationLimiter as a function', () => {
    expect(typeof batchOperationLimiter).toBe('function');
  });

  test('should export actionRateLimit as a factory function', () => {
    expect(typeof actionRateLimit).toBe('function');
  });

  test('should export isInternalService as a function', () => {
    expect(typeof isInternalService).toBe('function');
  });

  test('should export initMetrics as a function', () => {
    expect(typeof initMetrics).toBe('function');
  });

  test('should export getEndpointLimiter as a function', () => {
    expect(typeof getEndpointLimiter).toBe('function');
  });

  test('should export endpointLimits configuration object', () => {
    expect(typeof endpointLimits).toBe('object');
    expect(endpointLimits).toBeDefined();
  });

  test('should export _config with version info', () => {
    expect(_config).toBeDefined();
    expect(_config.version).toContain('M-C04');
    expect(_config.layers).toEqual(['nginx_l1', 'express_global_l2', 'endpoint_granular_l3']);
  });
});

describe('endpointLimits configuration', () => {
  test('should have login endpoint limit configured', () => {
    const loginConfig = endpointLimits['/api/v1/auth/login'];
    expect(loginConfig).toBeDefined();
    expect(loginConfig.max).toBe(10);
    expect(loginConfig.windowMs).toBe(60000);
  });

  test('should have register endpoint limit configured (strict)', () => {
    const regConfig = endpointLimits['/api/v1/auth/register'];
    expect(regConfig).toBeDefined();
    expect(regConfig.max).toBe(3); // Very strict for registration
  });

  test('should have health check endpoint with generous limit', () => {
    const healthConfig = endpointLimits['/api/v1/health'];
    expect(healthConfig).toBeDefined();
    expect(healthConfig.max).toBe(300); // High for monitoring probes
  });

  test('should have email send endpoint with strict limit', () => {
    const sendConfig = endpointLimits['/api/v1/emails/send'];
    expect(sendConfig).toBeDefined();
    expect(sendConfig.max).toBe(5);
  });

  test('method-specific limiters should have methods array', () => {
    const clientsWrite = endpointLimits['clients_write'];
    expect(clientsWrite).toBeDefined();
    expect(clientsWrite.methods).toContain('POST');
    expect(clientsWrite.methods).toContain('PUT');
  });

  test('every endpoint limit should have windowMs, max, and description', () => {
    for (const [key, config] of Object.entries(endpointLimits)) {
      try {
        expect(config.windowMs).toBeDefined();
        expect(config.max).toBeDefined();
        expect(config.description).toBeDefined();
      } catch (e) {
        throw new Error(`Endpoint "${key}" is missing required fields: ${e.message}`);
      }
    }
  });
});

describe('isInternalService()', () => {
  test('should identify localhost IP as internal service', () => {
    const req = { ip: '127.0.0.1', path: '/api/v1/data', headers: {} };
    expect(isInternalService(req)).toBe(true);
  });

  test('should identify ::1 as internal service', () => {
    const req = { ip: '::1', path: '/api/v1/data', headers: {} };
    expect(isInternalService(req)).toBe(true);
  });

  test('should identify localhost hostname as internal', () => {
    const req = { ip: 'localhost', path: '/api/v1/data', headers: {} };
    expect(isInternalService(req)).toBe(true);
  });

  test('should identify health check paths as internal', () => {
    const req = { ip: '10.0.0.5', path: '/api/v1/health', headers: {} };
    expect(isInternalService(req)).toBe(true);
  });

  test('should identify health/ready path as internal', () => {
    const req = { ip: '10.0.0.5', path: '/api/v1/health/ready', headers: {} };
    expect(isInternalService(req)).toBe(true);
  });

  test('should identify health/live path as internal', () => {
    const req = { ip: '10.0.0.5', path: '/api/v1/health/live', headers: {} };
    expect(isInternalService(req)).toBe(true);
  });

  test('should reject external IPs on non-health paths', () => {
    const req = { ip: '203.0.113.50', path: '/api/v1/campaigns', headers: {} };
    expect(isInternalService(req)).toBe(false);
  });

  test('should handle x-forwarded-for with local address', () => {
    const req = {
      ip: '203.0.113.50',
      path: '/api/v1/data',
      headers: { 'x-forwarded-for': '127.0.0.1, 10.0.0.1' },
    };
    expect(isInternalService(req)).toBe(true);
  });
});

describe('getEndpointLimiter()', () => {
  test('should return a middleware function for a valid endpoint key', () => {
    const limiter = getEndpointLimiter('/api/v1/auth/login');
    expect(limiter).toBeDefined();
    expect(typeof limiter).toBe('function');
  });

  test('should return null for unknown endpoint key', () => {
    const limiter = getEndpointLimiter('/api/v1/nonexistent');
    expect(limiter).toBeNull();
  });
});

describe('actionRateLimit() factory', () => {
  let req, res, next;

  beforeEach(() => {
    req = { ip: '192.168.1.100', path: '/api/v1/auth/password-reset' };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  test('should allow requests within the limit', () => {
    const middleware = actionRateLimit('password-reset', 5, 60000);

    // Make 5 requests (the limit)
    for (let i = 0; i < 5; i++) {
      middleware(req, res, next);
    }

    expect(next).toHaveBeenCalledTimes(5);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should block requests exceeding the limit', () => {
    const middleware = actionRateLimit('login-attempt', 2, 60000);

    // First 2 requests pass
    middleware(req, res, next);
    middleware(req, res, next);

    // 3rd request should be blocked
    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'ACTION_RATE_LIMITED',
      })
    );
  });

  test('should include retryAfter in response when rate limited', () => {
    const middleware = actionRateLimit('test-action', 1, 60000);

    middleware(req, res, next); // 1st passes
    middleware(req, res, next); // 2nd blocked

    const body = res.json.mock.calls[0][0];
    expect(body.retryAfter).toBeDefined();
    expect(typeof body.retryAfter).toBe('number');
  });

  test('should track per-IP + per-action independently', () => {
    const middleware = actionRateLimit('shared-action', 2, 60000);
    const req2 = { ...req, ip: '10.0.0.1' };

    // Different IPs should have independent limits
    middleware(req, res, next);   // IP1: 1
    middleware(req2, res, next);  // IP2: 1
    middleware(req, res, next);   // IP1: 2
    middleware(req2, res, next);  // IP2: 2
    middleware(req, res, next);   // IP1: 3 → BLOCKED

    // IP1 was blocked once, IP2 was never blocked
    expect(res.status).toHaveBeenCalledTimes(1);
  });
});

describe('initMetrics()', () => {
  beforeEach(() => {
    // Clean up global counter if it exists
    delete global.rateLimitedCounter;
  });

  test('should create a Prometheus Counter on global scope', () => {
    // Mock prom-client.Counter: constructor receives a single {name, help, labelNames} object
    class MockCounter {
      constructor(opts) {
        Object.assign(this, opts);
        this.inc = jest.fn();
      }
    }

    // Suppress console output during this test
    const originalLog = console.log;
    console.log = jest.fn();

    try {
      initMetrics(MockCounter);

      expect(global.rateLimitedCounter).toBeDefined();
      expect(global.rateLimitedCounter).toBeInstanceOf(MockCounter);
      expect(global.rateLimitedCounter.name).toBe('globalreach_rate_limited_total');
      expect(typeof global.rateLimitedCounter.inc).toBe('function');
    } finally {
      console.log = originalLog;
    }
  });

  test('should not throw if called multiple times', () => {
    const MockCounter = jest.fn(function() { this.inc = jest.fn(); });

    expect(() => {
      initMetrics(MockCounter);
      initMetrics(MockCounter);
    }).not.toThrow();
  });
});
