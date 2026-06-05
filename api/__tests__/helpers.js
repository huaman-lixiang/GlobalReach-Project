/**
 * Jest Test Setup — Shared utilities for all test files
 *
 * Provides:
 *   - Mock request/response objects
 *   - Next function spy
 *   - Auth token generation helper
 *   - Environment variable helpers
 */

// Suppress console output during tests unless explicitly needed
if (process.env.SHOW_TEST_LOGS !== 'true') {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
}

/**
 * Create a mock Express request object.
 */
function createMockRequest(overrides = {}) {
  return {
    method: overrides.method || 'GET',
    path: overrides.path || '/api/test',
    originalUrl: overrides.originalUrl || '/api/test',
    headers: overrides.headers || {},
    body: overrides.body || {},
    query: overrides.query || {},
    params: overrides.params || {},
    ip: overrides.ip || '127.0.0.1',
    get: (name) => overrides.headers?.[name.toLowerCase()] || undefined,
    user: overrides.user || null,
    requestId: overrides.requestId || null,
    traceId: overrides.traceId || null,
    apiVersion: overrides.apiVersion || null,
    app: overrides.app || { set: jest.fn(), get: jest.fn() },
    ...overrides,
  };
}

/**
 * Create a mock Express response object with full tracking.
 */
function createMockResponse(overrides = {}) {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    _locals: {},

    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    getHeader(name) {
      return this.headers[name];
    },
    end(data) {
      if (data) this.body = data;
      return this;
    },
    locals: {},

    _listeners: {},
    on(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
      return this;
    },
    _emitFinish() {
      const listeners = this._listeners['finish'] || [];
      listeners.forEach(fn => fn());
    },
  };

  Object.assign(res, overrides);
  return res;
}

function createMockNext() {
  return jest.fn();
}

function generateTestToken(payloadOverrides = {}) {
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { id: 'test-user-001', email: 'admin@globalreach.com', role: 'admin', ...payloadOverrides },
    process.env.JWT_SECRET || 'globalreach-enterprise-secret-key-2026',
    { expiresIn: '1h' }
  );
}

function generateExpiredToken() {
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { id: 'test-user-001', email: 'admin@globalreach.com', role: 'admin' },
    process.env.JWT_SECRET || 'globalreach-enterprise-secret-key-2026',
    { expiresIn: '-1s' }
  );
}

function wait(ms = 10) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Export for use in test files
module.exports = {
  createMockRequest,
  createMockResponse,
  createMockNext,
  generateTestToken,
  generateExpiredToken,
  wait,
};
