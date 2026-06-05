/**
 * Integration Tests: GlobalReach V2.0 API Endpoints
 *
 * Tests real HTTP endpoints through supertest.
 * Covers health, auth, accounts, emails, platforms, stats, error handling, security.
 *
 * Note: Both /api/v1/* (versioned) and /api/* (legacy compat) are tested.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');

describe('GlobalReach V2.0 API Integration Tests', () => {
  let authToken;

  // Helper: generate valid JWT for authenticated requests
  function getAuthToken(overrides = {}) {
    return jwt.sign(
      { id: 'test-user-001', email: 'admin@globalreach.com', role: 'admin', ...overrides },
      process.env.JWT_SECRET || 'globalreach-enterprise-secret-key-2026',
      { expiresIn: '1h' }
    );
  }

  beforeAll(() => {
    authToken = getAuthToken();
  });

  // ============================================
  // Root & Health Check Endpoints
  // ============================================

  describe('Root Endpoint', () => {
    test('GET / returns service info with v2 metadata', async () => {
      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.service).toBe('GlobalReach V2.0 Enterprise API');
      expect(res.body.version).toBe('2.0.0');
      expect(res.body.status).toBe('operational');
      expect(res.body.apiVersion).toBeDefined(); // D12: Version info
      expect(res.body.endpoints).toBeDefined();
    });
  });

  describe('Health Check Endpoints', () => {
    test('GET /api/v1/health — full deep check (D14)', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toMatch(/healthy|degraded|unstable|down/);
      expect(res.body.healthScore).toBeDefined();
      expect(res.body.checks).toBeDefined();
      expect(res.body.checks.database).toBeDefined();
      expect(res.body.summary).toBeDefined();
    });

    test('GET /api/health — backward compatibility (legacy)', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBeDefined();
      expect(res.body.checks).toBeDefined();
    });

    test('GET /api/v1/health/ready — readiness probe', async () => {
      const res = await request(app).get('/api/v1/health/ready');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.checks).toBeDefined();
    });

    test('GET /api/v1/health/live — liveness probe', async () => {
      const res = await request(app).get('/api/v1/health/live');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('alive');
      expect(res.body.pid).toBeDefined();
      expect(res.body.uptime).toBeDefined();
    });
  });

  // ============================================
  // Authentication Endpoints
  // ============================================

  describe('POST /auth/login', () => {
    test('rejects missing credentials with validation errors', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    test('rejects invalid email format', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: 'Password123!' });

      expect(res.status).toBe(400);
    });

    test('rejects short password (D08 password complexity)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: '123' });

      expect(res.status).toBe(400); // Password too short
    });

    test('rejects non-existent user credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'ValidPass123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('POST /auth/register', () => {
    test('validates all required fields', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'invalid-email-format',
          password: '123',
          name: 'A',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      if (res.body.details) {
        expect(res.body.details.length).toBeGreaterThan(0);
      }
    });
  });

  // ============================================
  // Protected Endpoints (Authentication Required)
  // ============================================

  describe('Authentication Gate', () => {
    test('GET /api/v1/accounts requires auth token', async () => {
      const res = await request(app).get('/api/v1/accounts');

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    test('POST /api/v1/campaigns requires auth token', async () => {
      const res = await request(app)
        .post('/api/v1/campaigns')
        .send({ name: 'Test Campaign' });

      expect(res.status).toBe(401);
    });

    test('GET /api/v1/stats/overview requires auth token', async () => {
      const res = await request(app).get('/api/v1/stats/overview');

      expect(res.status).toBe(401);
    });

    test('Accepts valid Bearer token', async () => {
      const res = await request(app)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ============================================
  // Account Management (with Auth)
  // ============================================

  describe('Account CRUD Operations', () => {
    test('GET /api/v1/accounts returns paginated list', async () => {
      const res = await request(app)
        .get('/api/v1/accounts?page=1&limit=10')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data?.items || res.body.data)).toBeTruthy();
    });

    test('POST /api/v1/accounts validates platform enum', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          platform: 'INVALID_PLATFORM',
          credentials: { email: 'test@gmail.com', password: 'app-pwd' },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('Rejects missing required fields on account creation', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ============================================
  // Email Validation
  // ============================================

  describe('Email Validation Endpoint', () => {
    test('POST /api/v1/emails/validate validates email structure', async () => {
      const res = await request(app)
        .post('/api/v1/emails/validate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          from: 'sender@example.com',
          to: ['recipient@example.com'],
          subject: 'Test Subject',
          html: '<h1>Test</h1>',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(true);
    });

    test('Detects missing recipients', async () => {
      const res = await request(app)
        .post('/api/v1/emails/validate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          from: 'sender@test.com',
          to: [],
          subject: 'No Recipients',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(false);
      expect(res.body.data.errors.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Platform Management
  // ============================================

  describe('Platform Endpoints', () => {
    test('GET /api/v1/platforms returns supported platforms', async () => {
      const res = await request(app)
        .get('/api/v1/platforms')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(5);
    });

    test('GET /api/v1/platforms/:name/config returns specific config', async () => {
      const res = await request(app)
        .get('/api/v1/platforms/gmail/config')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Gmail');
      expect(res.body.data.imap.host).toBe('imap.gmail.com');
    });

    test('GET /api/v1/platforms/invalid/config returns 404', async () => {
      const res = await request(app)
        .get('/api/v1/platforms/nonexistent/config')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ============================================
  // Statistics Endpoints
  // ============================================

  describe('Statistics Endpoints', () => {
    test('GET /api/v1/stats/overview returns stats structure', async () => {
      const res = await request(app)
        .get('/api/v1/stats/overview')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.period).toBeDefined();
    });

    test('GET /api/v1/stats/realtime returns realtime data', async () => {
      const res = await request(app)
        .get('/api/v1/stats/realtime')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.timestamp).toBeDefined();
    });
  });

  // ============================================
  // Error Handling (D11 Enhanced)
  // ============================================

  describe('Error Handling', () => {
    test('GET unknown path returns 404 with endpoint hints (D11)', async () => {
      const res = await request(app).get('/api/v1/this-does-not-exist');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
      expect(res.body.requestId).toBeDefined();
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.availableEndpoints).toBeDefined();
    });

    test('Handles malformed JSON body gracefully', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${authToken}`)
        .send('{ this is not valid json }');

      expect([400, 415]).toContain(res.status);
    });
  });

  // ============================================
  // Security Headers
  // ============================================

  describe('Security Headers (Helmet)', () => {
    test('includes standard security headers on responses', async () => {
      const res = await request(app).get('/');

      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['x-content-type-options']).toBeDefined();
      expect(res.headers['strict-transport-security']).toBeDefined();
    });
  });

  // ============================================
  // API Versioning (D12)
  // ============================================

  describe('API Versioning Headers', () => {
    test('sets API-Version header on versioned endpoints', async () => {
      const res = await request(app).get('/api/v1/health/live');

      expect(res.headers['api-version']).toBe('v1');
    });

    test('sets X-API-Latest-Version header', async () => {
      const res = await request(app).get('/api/v1/health/live');

      expect(res.headers['x-api-latest-version']).toMatch(/^v\d+$/);
    });
  });

  // ============================================
  // Response Format Consistency (D11)
  // ============================================

  describe('Response Format Consistency', () => {
    test('Success responses have standard fields', async () => {
      const res = await request(app).get('/');
      expect(res.body).toHaveProperty('service');
      expect(typeof res.body.version === 'string' || typeof res.body.version === 'number').toBe(true);
    });

    test('Error responses include requestId and timestamp', async () => {
      const res = await request(app).get('/api/v1/nonexistent-path');
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.requestId).toBeDefined();
    });
  });
});
