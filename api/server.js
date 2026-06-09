// S102/PhaseH: OpenTelemetry — MUST be first import (auto-instruments all modules)
require('./otel');

// S098/PhaseH: V8 Heap Memory Tuning
// Restored from 256→384 (256 caused false 83% warnings due to V8 pre-allocation)
// Container limit is 512MB, 384MB = 75% of container (safe ceiling)
try {
  require('v8').setFlagsFromString('--max-old-space-size=384');
  require('v8').setFlagsFromString('--expose-gc');
} catch(e) {}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

// D17: Performance Optimization - Compression middleware
const { compressionMiddleware } = require('./middleware/compression');
// D17: Performance Optimization - Redis Cache Service
const { cacheService } = require('./services/cacheService');
// D18: i18n Internationalization
const { middleware: i18nMiddleware } = require('./i18n');

// Sequelize ORM for database operations
const db = require('./db');
const sequelize = db.sequelize;

// D02: Service Layer (M7/M8 Engine Bridge)
let accountService;
try {
  accountService = require('./services/accountService');
} catch (e) {
  console.warn('[Startup] AccountService not available:', e.message);
}

// D03: Email Service (with TemplateEngine + Queue integration)
let emailService;
try {
  emailService = require('./services/emailService');
} catch (e) {
  console.warn('[Startup] EmailService not available:', e.message);
}

// D03: Pipeline components
let emailQueue, sendWorker, templateEngine;
try {
  const EmailQueue = require('./queue/emailQueue');
  const SendWorker = require('./workers/sendWorker');
  const TemplateEngine = require('./templates/templateEngine');

  templateEngine = new TemplateEngine();
  emailQueue = new EmailQueue({
    maxConcurrency: parseInt(process.env.SEND_CONCURRENCY || '5'),
    maxRetries: parseInt(process.env.SEND_MAX_RETRIES || '3'),
    retryDelay: parseInt(process.env.SEND_RETRY_DELAY || '5000'),
    rateLimitPerSecond: parseInt(process.env.SEND_RATE_LIMIT || '3'),
  });
  sendWorker = new SendWorker({
    queue: emailQueue,
    emailService: emailService,
    templateEngine: templateEngine,
    pollInterval: parseInt(process.env.WORKER_POLL_INTERVAL || '500'),
  });

  // Inject queue into emailService for campaign enqueue
  if (emailService && typeof emailService.setQueue === 'function') {
    emailService.setQueue(emailQueue);
  }

  console.log('[Pipeline] EmailQueue initialized');
  console.log('[Pipeline] SendWorker initialized');
  console.log('[Pipeline] TemplateEngine initialized');
} catch (e) {
  console.warn('[Startup] Pipeline components not available:', e.message);
}

// Routes
const campaignRoutes = require('./routes/campaigns');
const accountRoutes = require('./routes/accounts');
const authRoutes = require('./routes/auth');
const emailRoutes = require('./routes/emails');
const platformRoutes = require('./routes/platforms');
const tenantRoutes = require('./routes/tenants');
const statsRoutes = require('./routes/stats');
const healthRoutes = require('./routes/health');
const progressRoutes = require('./routes/progress'); // D03: SSE progress
const analyticsRoutes = require('./routes/analytics');      // D22: Advanced Analytics
const teamsRoutes = require('./routes/teams');              // D23: Team Collaboration
const webhooksRoutes = require('./routes/webhooks');        // D24: Webhook Integration
const templatesRoutes = require('./routes/templates');      // D25: Custom Templates
const searchRoutes = require('./routes/search');            // D26: Advanced Search
const exportsRoutes = require('./routes/exports');          // D27: Data Export
const mobileRoutes = require('./routes/mobile');            // D28: Mobile Integration
const maintenanceRoutes = require('./routes/maintenance');  // D29: Maintenance & Support

// D11: Unified Error Handling (enhanced classes, rate tracking, classification)
const { errorHandler, notFoundHandler, getErrorSummary } = require('./middleware/errorHandler');
// Rate limiter
const { rateLimiter } = require('./middleware/rateLimiter');
// D07+D13: Structured Logging + Request Tracing
const { requestLogger, requestIdMiddleware, createLogger, tracingContext } = require('./middleware/logger');
// D08: Input Validation
const { sanitizeBody } = require('./middleware/validator');
// D09: CORS Security
const { corsMiddleware, getCorsInfo } = require('./middleware/corsConfig');
// D10: CSRF Protection
const { csrfProtection, csrfTokenMiddleware, getCsrfInfo, enforceSameSiteCookie } = require('./middleware/csrf');
// D12: API Versioning
const { apiVersionMiddleware, getLatestVersion, getSupportedVersions } = require('./middleware/apiVersion');
// D15: Prometheus Monitoring
const {
  startMetricsCollection,
  startPeriodicCollection,
  getMetrics,
} = require('./middleware/metrics');
const metricsRoutes = require('./routes/metrics');
// D16: API Documentation (Swagger UI)
const docsRoutes = require('./routes/docs');

// Application-level logger for startup/shutdown events
const appLog = createLogger('Server');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Middleware Stack (ordered by execution priority)
// ============================================

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'fonts.googleapis.com'],
      fontSrc: ["'self'", 'cdn.jsdelivr.net', 'fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", 'https://api.*'],
      frameAncestors: ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  crossOriginEmbedderPolicy: false,
}));

// D17: Gzip/Brotli compression (high compression level)
app.use(compressionMiddleware);

// D18: i18n internationalization middleware
app.use(i18nMiddleware);

// D09: Secure CORS configuration
app.use(corsMiddleware);

// D10: SameSite cookie enforcement
app.use(enforceSameSiteCookie);

// D07+D13: Request ID + Trace ID generation (MUST be first — all downstream depends on it)
app.use(requestIdMiddleware);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static file serving for frontend
app.use(express.static('public'));

// D08: XSS prevention — auto-sanitize body strings
app.use(sanitizeBody);

// D12: API Version detection and header injection
app.use(apiVersionMiddleware);

// D15: Prometheus auto-instrumentation (records duration/counter for ALL requests)
app.use(startMetricsCollection());

// D07: Structured request logger
app.use(requestLogger);

// Rate limiting on all /api routes
app.use('/api/', rateLimiter);

// ============================================
// Expose pipeline components to routes via app locals
// ============================================
app.set('emailQueue', emailQueue);
app.set('sendWorker', sendWorker);

// ============================================
// Root endpoint (unversioned — service info only)
// ============================================
app.get('/', (req, res) => {
  const engineStatus = accountService ? {
    poolManager: !!accountService.poolManager,
    lifecycleManager: !!accountService.lifecycleManager,
    healthMonitor: !!accountService.healthMonitor,
  } : null;

  const pipelineStatus = emailQueue ? {
    queue: true,
    worker: !!sendWorker,
    templateEngine: !!templateEngine,
  } : null;

  res.json({
    service: 'GlobalReach V2.0 Enterprise API',
    version: '2.0.0',
    apiVersion: getLatestVersion(),
    status: 'operational',
    database: sequelize ? 'connected' : 'disconnected',
    orm: 'Sequelize',
    engine: engineStatus,
    pipeline: pipelineStatus,
    documentation: '/api/v1/health',
    endpoints: {
      health: '/api/v1/health',
      auth: '/api/v1/auth/*',
      accounts: '/api/v1/accounts',
      campaigns: '/api/v1/campaigns',
      emails: '/api/v1/emails',
      stats: '/api/v1/stats/*',
      metrics: '/api/v1/metrics', // D15
      docs: '/api/v1/docs', // D16: Swagger UI
    },
  });
});

// ============================================
// D12: Versioned API Routes (/api/v1/)
// ============================================
app.use('/api/v1/accounts', accountRoutes);
app.use('/api/v1/campaigns', campaignRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/emails', emailRoutes);
app.use('/api/v1/platforms', platformRoutes);
app.use('/api/v1/tenants', tenantRoutes);
app.use('/api/v1/stats', statsRoutes);
app.use('/api/v1/health', healthRoutes);       // D14: Deep health check
app.use('/api/v1/progress', progressRoutes);     // D03: SSE progress
app.use('/api/v1/metrics', metricsRoutes);          // D15: Prometheus metrics

// M-A04: Inject emailQueue instance into metrics route for queue-specific endpoints
if (emailQueue && typeof metricsRoutes.setQueue === 'function') {
  metricsRoutes.setQueue(emailQueue);
  console.log('[Server/M-A04] EmailQueue injected into metrics routes');
}
app.use('/api/v1/docs', docsRoutes);                // D16: Swagger UI documentation
app.use('/api/v1/analytics', analyticsRoutes);      // D22: Advanced Analytics
app.use('/api/v1/teams', teamsRoutes);              // D23: Team Collaboration
app.use('/api/v1/webhooks', webhooksRoutes);        // D24: Webhook Integration
app.use('/api/v1/templates', templatesRoutes);      // D25: Custom Templates
app.use('/api/v1/search', searchRoutes);            // D26: Advanced Search
app.use('/api/v1/export', exportsRoutes);           // D27: Data Export
app.use('/api/v1/mobile', mobileRoutes);            // D28: Mobile Integration
app.use('/api/v1/maintenance', maintenanceRoutes);   // D29: Maintenance & Support

// Backward compatibility: redirect /api/ to /api/v1/ for legacy clients
app.use('/api/accounts', accountRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/platforms', platformRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/metrics', metricsRoutes);             // D15: Legacy compat
app.use('/api/docs', docsRoutes);                     // D16: Legacy compat

// D10: CSRF token issuance endpoint (authenticated)
app.get('/api/v1/auth/csrf-token', require('./middleware/auth').verifyToken, csrfTokenMiddleware);
app.get('/api/auth/csrf-token', require('./middleware/auth').verifyToken, csrfTokenMiddleware);

// D10: CSRF protection (after routes — needs req.user from route-level auth)
app.use(csrfProtection);

// Error handlers (MUST be last)
app.use(notFoundHandler);
app.use(errorHandler);

// ============================================
// Graceful Shutdown
// ============================================
let server;
async function gracefulShutdown(signal) {
  appLog.info(`Received ${signal}. Starting graceful shutdown...`);

  if (sendWorker) {
    await sendWorker.stop();
    appLog.info('SendWorker stopped');
  }

  if (emailQueue) {
    const remaining = await emailQueue.shutdown(15000);
    if (remaining > 0) appLog.warn(`${remaining} jobs were still processing`, { remaining });
    else appLog.info('EmailQueue shutdown complete');
  }

  if (server) server.close(() => appLog.info('HTTP server closed'));

  if (accountService && accountService.poolManager) {
    const accounts = accountService.poolManager.getAllAccounts();
    for (const acc of accounts) {
      try { if (acc.status === 'active') acc.platformInstance.disconnect(); }
      catch (e) { appLog.warn(`Failed to disconnect account ${acc.id}`, { error: e.message }); }
    }
    appLog.info(`Disconnected ${accounts.length} engine accounts`);
  }

  if (cacheService) {
      await cacheService.disconnect();
      appLog.info('CacheService disconnected');
    }

    try { await sequelize.close(); appLog.info('DB connection closed'); }
    catch (e) { appLog.error('DB close error', { error: e.message }); }
    process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

if (require.main === module) {
  (async () => {
    try {
      appLog.info('Starting application...');
      
      // Step 1: Sync database schema
      appLog.info('Step 1: Synchronizing database...');
      // S085/L04: Changed alter:false → alter:true to auto-add new columns (e.g., isActive)
      // In production, use proper migrations instead of sync({alter:true})
      await sequelize.sync({ alter: true });
      appLog.info('Database synchronized (Sequelize). Tables ready');

      // Step 1.5: Auto-seed if database is empty (D04)
      const userCount = await db.User.count();
      if (userCount === 0) {
        appLog.info('Empty database detected — running seed...');
        try {
          const { seed } = require('./db/seed');
          await seed({ silent: true });
          appLog.info('Seed data loaded successfully');
        } catch (e) {
          appLog.error('Auto-seed failed', { error: e.message });
        }
      } else {
        appLog.info(`Found ${userCount} existing user(s) — skipping seed`);
      }

      // Step 2: Initialize M7/M8 Engine (D02)
      if (accountService && accountService.poolManager) {
        appLog.info('M7 AccountPoolManager initialized');
        appLog.info('M7 LifecycleManager initialized');
        appLog.info('M8 EmailFormatter + FailoverManager ready');
        appLog.info('Platform adapters: Gmail, Outlook, QQ, 163, Custom SMTP');
      } else {
        appLog.warn('M7/M8 Engine not available - running in DB-only mode');
      }

      // Step 3: Start D03 Pipeline Worker
      if (sendWorker && emailQueue) {
        sendWorker.start();
        appLog.info(`SendWorker started — consuming from EmailQueue (concurrency=${emailQueue.maxConcurrency}, retries=${emailQueue.maxRetries})`);
      } else {
        appLog.warn('Pipeline not started — queue or worker unavailable');
      }

      // Step 3.5: Start D15 Prometheus metrics collection
      const metricsCollector = startPeriodicCollection({
        getErrorSummary,
        getCsrfInfo,
      });
      appLog.info(`D15 Metrics collection started (interval=10s, prefix=globalreach_)`);

      // Step 3.6: D17 - Initialize Redis Cache Service
      const cacheConnected = await cacheService.connect();
      if (cacheConnected) {
        appLog.info('D17 Redis Cache Service connected');
      } else {
        appLog.warn('D17 Redis Cache Service not available - running without caching');
      }
      app.set('cacheService', cacheService);

      // Step 3.7: D17 - Database index optimization
      try {
        const { createIndexes } = require('./db/optimize');
        await createIndexes();
        appLog.info('D17 Database indexes optimized');
      } catch (e) {
        appLog.warn('D17 Index optimization skipped:', e.message);
      }

      // Step 3.8: S084/G05 — Periodic GC to keep heap under control
      if (global.gc) {
        const gcInterval = setInterval(() => {
          try { global.gc(); } catch(e) {}
        }, 60000); // Force GC every 60s
        appLog.info('S084/G05: Periodic V8 GC enabled (interval=60s)');
      }

      appLog.info('Starting HTTP server...');
      
      // Step 4: Start HTTP server
      server = app.listen(PORT, () => {
        appLog.info(`Server running on port ${PORT}`, {
          environment: process.env.NODE_ENV || 'development',
          orm: 'Sequelize',
          db: 'PostgreSQL',
          engine: accountService ? 'CONNECTED' : 'OFFLINE',
          pipeline: emailQueue ? 'Queue+Worker' : 'OFFLINE',
          templateEngine: templateEngine ? 'ON' : 'OFF',

          // D09: CORS security
          cors: getCorsInfo(),

          // D10: CSRF protection
          csrf: getCsrfInfo(),

          // D11: Error handling
          errorHandling: {
            rateTrackingEnabled: true,
            errorClasses: ['AppError', 'NotFoundError', 'ValidationError', 'UnauthorizedError', 'ForbiddenError', 'ConflictError', 'RateLimitError'],
          },

          // D12: API versioning
          apiVersioning: {
            currentVersion: getLatestVersion(),
            supportedVersions: getSupportedVersions().map((v) => v.version),
          },

          // D13: Request tracing
          tracing: {
            enabled: true,
            headers: ['X-Request-ID', 'X-Trace-ID'],
          },

          // D14: Deep health check
          healthCheck: {
            subsystems: ['database', 'redis', 'engine', 'email_queue', 'system_resources'],
            endpoints: ['/api/v1/health', '/api/v1/health/ready', '/api/v1/health/live'],
          },

          // D15: Prometheus monitoring
          monitoring: {
            enabled: true,
            prefix: 'globalreach_',
            endpoint: '/api/v1/metrics',
            customMetricsCount: 18,
            defaultNodeMetrics: true,
            collectionIntervalMs: 10000,
          },

          // D16: API Documentation
          documentation: {
            enabled: true,
            swaggerUi: '/api/v1/docs',
            openApiSpec: '/api/v1/docs/openapi.json',
            endpointsDocumented: 68,
            tagGroups: 10,
          },
        });
      });
    } catch (error) {
      appLog.error('Startup failed', { error: error.message, stack: error.stack });
      console.error('Startup error:', error.message);
      console.error('Stack:', error.stack);
      process.exit(1);
    }
  })();
}

module.exports = app;
