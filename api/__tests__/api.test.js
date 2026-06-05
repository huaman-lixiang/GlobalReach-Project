const request = require('supertest');
const app = require('../server');

describe('GlobalReach V2.0 API Tests', () => {
  let authToken;

  describe('Health Check Endpoints', () => {
    test('GET / - should return API info', async () => {
      const res = await request(app).get('/');
      
      expect(res.status).toBe(200);
      expect(res.body.service).toBe('GlobalReach V2.0 Enterprise API');
      expect(res.body.version).toBe('2.0.0');
      expect(res.body.status).toBe('operational');
    });

    test('GET /api/health - should return health status', async () => {
      const res = await request(app).get('/api/health/');
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.checks).toBeDefined();
    });

    test('GET /api/health/ready - readiness probe', async () => {
      const res = await request(app).get('/api/health/ready');
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
    });
  });

  describe('Authentication', () => {
    test('POST /auth/login - should reject missing credentials', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({});
      
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('POST /auth/login - should reject invalid credentials', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'wrongpassword'
        });
      
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('INVALID_CREDENTIALS');
    });

    test('POST /auth/register - should validate input', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'invalid-email',
          password: '123',
          name: 'A'
        });
      
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.details).toBeDefined();
      expect(res.body.details.length).toBeGreaterThan(0);
    });
  });

  describe('Protected Endpoints (No Auth)', () => {
    test('GET /api/accounts - should require authentication', async () => {
      const res = await request(app)
        .get('/api/accounts');
      
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('ACCESS_DENIED');
    });

    test('POST /api/emails/send - should require authentication', async () => {
      const res = await request(app)
        .post('/api/emails/send')
        .send({
          to: ['test@example.com'],
          subject: 'Test'
        });
      
      expect(res.status).toBe(401);
    });
  });

  describe('Account Management (Mock Auth)', () => {
    beforeAll(() => {
      const jwt = require('jsonwebtoken');
      authToken = jwt.sign(
        { id: 'user-001', email: 'admin@globalreach.com', role: 'admin' },
        process.env.JWT_SECRET || 'globalreach-enterprise-secret-key-2026',
        { expiresIn: '1h' }
      );
    });

    test('GET /api/accounts - should return empty array initially', async () => {
      const res = await request(app)
        .get('/api/accounts')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('POST /api/accounts - should create account with validation', async () => {
      const res = await request(app)
        .post('/api/accounts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          id: 'test-gmail-001',
          platform: 'gmail',
          credentials: {
            email: 'test@gmail.com',
            password: 'app-password'
          },
          metadata: { region: 'US' }
        });
      
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('test-gmail-001');
      expect(res.body.data.platform).toBe('gmail');
    });

    test('POST /api/accounts - should reject invalid platform', async () => {
      const res = await request(app)
        .post('/api/accounts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          id: 'invalid-platform',
          platform: 'invalid',
          credentials: { email: 'test@test.com' }
        });
      
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('GET /api/accounts/:id - should return created account', async () => {
      const res = await request(app)
        .get('/api/accounts/test-gmail-001')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('test-gmail-001');
      expect(res.body.data.credentials).toBeUndefined();
    });

    test('DELETE /api/accounts/:id - should delete account', async () => {
      const res = await request(app)
        .delete('/api/accounts/test-gmail-001')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Email Operations', () => {
    beforeAll(() => {
      if (!authToken) {
        const jwt = require('jsonwebtoken');
        authToken = jwt.sign(
          { id: 'user-001', email: 'admin@globalreach.com', role: 'admin' },
          process.env.JWT_SECRET || 'globalreach-enterprise-secret-key-2026',
          { expiresIn: '1h' }
        );
      }
    });

    test('POST /api/emails/validate - should validate email structure', async () => {
      const res = await request(app)
        .post('/api/emails/validate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          from: 'sender@test.com',
          to: ['recipient@test.com'],
          subject: 'Valid Email Test',
          html: '<h1>Test</h1>'
        });
      
      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(true);
    });

    test('POST /api/emails/validate - should detect missing recipients', async () => {
      const res = await request(app)
        .post('/api/emails/validate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          from: 'sender@test.com',
          to: [],
          subject: 'Test'
        });
      
      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(false);
      expect(res.body.data.errors.length).toBeGreaterThan(0);
    });

    test('GET /api/emails/format/gmail - should return formatted email', async () => {
      const res = await request(app)
        .get('/api/emails/format/gmail')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.from).toBeDefined();
      expect(res.body.data.headers).toBeDefined();
    });
  });

  describe('Platform Management', () => {
    beforeAll(() => {
      if (!authToken) {
        const jwt = require('jsonwebtoken');
        authToken = jwt.sign(
          { id: 'user-001', email: 'admin@globalreach.com', role: 'admin' },
          process.env.JWT_SECRET || 'globalreach-enterprise-secret-key-2026',
          { expiresIn: '1h' }
        );
      }
    });

    test('GET /api/platforms - should return supported platforms', async () => {
      const res = await request(app)
        .get('/api/platforms')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(5);
    });

    test('GET /api/platforms/gmail/config - should return Gmail config', async () => {
      const res = await request(app)
        .get('/api/platforms/gmail/config')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Gmail');
      expect(res.body.data.imap.host).toBe('imap.gmail.com');
    });

    test('GET /api/platforms/invalid/config - should return 404', async () => {
      const res = await request(app)
        .get('/api/platforms/invalid/config')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(res.status).toBe(404);
    });
  });

  describe('Statistics Endpoints', () => {
    beforeAll(() => {
      if (!authToken) {
        const jwt = require('jsonwebtoken');
        authToken = jwt.sign(
          { id: 'user-001', email: 'admin@globalreach.com', role: 'admin' },
          process.env.JWT_SECRET || 'globalreach-enterprise-secret-key-2026',
          { expiresIn: '1h' }
        );
      }
    });

    test('GET /api/stats/overview - should return stats structure', async () => {
      const res = await request(app)
        .get('/api/stats/overview')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.period).toBeDefined();
      expect(res.body.data.platforms).toBeDefined();
      expect(res.body.data.failover).toBeDefined();
    });

    test('GET /api/stats/realtime - should return realtime data', async () => {
      const res = await request(app)
        .get('/api/stats/realtime')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.timestamp).toBeDefined();
      expect(res.body.data.activeConnections).toBeDefined();
      expect(res.body.data.systemLoad).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('GET /nonexistent - should return 404', async () => {
      const res = await request(app).get('/nonexistent');
      
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
      expect(res.body.availableEndpoints).toBeDefined();
    });
  });

  describe('Response Format Consistency', () => {
    test('Success responses should have consistent format', async () => {
      const res = await request(app).get('/');
      
      expect(res.body).toHaveProperty('success');
      expect(res.body).toHaveProperty('timestamp');
    });

    test('Error responses should have error code', async () => {
      const res = await request(app).get('/nonexistent');
      
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('error');
      expect(res.body).toHaveProperty('timestamp');
    });
  });
});
