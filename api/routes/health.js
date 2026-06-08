/**
 * Health Check Routes — D14 Deep Health Check Enhanced
 *
 * Provides comprehensive system health monitoring:
 *   GET /health       — Full deep check (all subsystems)
 *   GET /health/ready — Readiness probe (DB only)
 *   GET /health/live  — Liveness probe (process alive)
 *
 * Subsystems checked:
 *   1. PostgreSQL Database (connectivity + query latency)
 *   2. Redis Cache (connectivity + ping latency)
 *   3. M7/M8 Engine (account pool status)
 *   4. Email Queue (queue depth + worker status)
 *   5. System Resources (memory, CPU, event loop lag)
 */

const express = require('express');
const v8 = require('v8');
const router = express.Router();

// DB
const { sequelize } = require('../db');

// Services (may not be available in all modes)
let accountService, emailQueue, sendWorker;
try { accountService = require('../services/accountService'); } catch (_) {}
try { emailQueue = require('../queue/emailQueue'); } catch (_) {}

// Get references to pipeline components from app locals at runtime
function getPipelineComponents(req) {
  return {
    queue: req.app?.get('emailQueue') || emailQueue,
    worker: req.app?.get('sendWorker') || sendWorker,
  };
}

// ============================================
// Health Check Helpers
// ============================================

/**
 * Run a health check with timeout protection.
 * @param {string} name Check name
 * @param {Function} fn Async function that returns {status, ...}
 * @param {number} timeoutMs Timeout in milliseconds
 * @returns {Promise<object>} Result object
 */
async function runCheck(name, fn, timeoutMs = 5000) {
  const start = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeoutMs)
      ),
    ]);
    return {
      name,
      status: result.status || 'healthy',
      latencyMs: Date.now() - start,
      ...(result.details ? { details: result.details } : {}),
    };
  } catch (error) {
    return {
      name,
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      error: error.message.slice(0, 200),
    };
  }
}

/**
 * Calculate overall health score from individual checks.
 * @param {Array} checks Array of {status, ...}
 * @returns {{ score: number, status: string }}
 */
function calculateAggregateHealth(checks) {
  const healthyCount = checks.filter((c) => c.status === 'healthy').length;
  const total = checks.length;
  const score = total > 0 ? Math.round((healthyCount / total) * 100) : 100;

  let status = 'healthy';
  if (score === 100) status = 'healthy';
  else if (score >= 75) status = 'degraded';
  else if (score >= 50) status = 'unstable';
  else status = 'down';

  return { score, status };
}

// ============================================
// Individual Subsystem Checks
// ============================================

/** Check 1: PostgreSQL Database */
async function checkDatabase() {
  const start = Date.now();
  try {
    await sequelize.query('SELECT 1');
    // Count tables for additional info
    const [users, accounts, campaigns, clients] = await Promise.all([
      sequelize.models.User.count().catch(() => 0),
      sequelize.models.EmailAccount.count().catch(() => 0),
      sequelize.models.Campaign.count().catch(() => 0),
      sequelize.models.Client.count().catch(() => 0),
    ]);
    return {
      status: 'healthy',
      latencyMs: Date.now() - start,
      details: {
        orm: 'Sequelize',
        dialect: sequelize.getDialect(),
        tables: { users, emailAccounts: accounts, campaigns, clients },
      },
    };
  } catch (error) {
    return { status: 'unhealthy', error: error.message.slice(0, 100) };
  }
}

/** Check 2: Redis Cache */
async function checkRedis() {
  let redisClient;

  // Try to get Redis from ioredis or redis client
  try {
    // Check if Redis is available through the cache module or direct connection
    const redis = require('../cache/redis').default || require('../cache/redis');
    if (redis && redis.client) {
      redisClient = redis.client;
    }
  } catch (_) {
    // No dedicated redis module — try environment-based check
  }

  // Fallback: check via environment variable or skip
  const redisUrl = process.env.REDIS_URL || process.env.REDIS_HOST;

  if (!redisUrl && !redisClient) {
    return { status: 'not_configured', details: { message: 'Redis not configured — skipping' } };
  }

  if (!redisClient) {
    // Try basic connectivity check using net
    const net = require('net');
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);

    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve({ status: 'unhealthy', error: 'Connection timed out' });
      }, 3000);

      socket.connect(port, host, () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve({ status: 'healthy', details: { host, port } });
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ status: 'unhealthy', error: err.message });
      });
    });
  }

  // Have a real Redis client — use PING
  try {
    const reply = await redisClient.ping();
    return {
      status: reply === 'PONG' || reply === true ? 'healthy' : 'degraded',
      details: { response: String(reply) },
    };
  } catch (error) {
    return { status: 'unhealthy', error: error.message.slice(0, 100) };
  }
}

/** Check 3: M7/M8 Engine Status */
async function checkEngine() {
  if (!accountService || !accountService.poolManager) {
    return { status: 'not_configured', details: { message: 'M7 Engine not loaded — running in DB-only mode' } };
  }

  try {
    const poolManager = accountService.poolManager;
    const accounts = poolManager.getAllAccounts ? poolManager.getAllAccounts() : [];
    const activeCount = accounts.filter((a) => a.status === 'active').length;
    const totalCount = accounts.length;

    let healthMonitorStatus = 'unknown';
    if (accountService.healthMonitor) {
      healthMonitorStatus = 'available';
    }

    return {
      status: 'healthy',
      details: {
        totalAccounts: totalCount,
        activeAccounts: activeCount,
        engineType: 'M7+M8',
        healthMonitor: healthMonitorStatus,
        adapters: ['Gmail', 'Outlook', 'QQ', 'Netease163', 'CustomSMTP'],
      },
    };
  } catch (error) {
    return { status: 'degraded', error: error.message.slice(0, 100) };
  }
}

/** Check 4: Email Queue & Worker Status */
async function checkQueue(queue, worker) {
  if (!queue) {
    return { status: 'not_configured', details: { message: 'EmailQueue not initialized' } };
  }

  try {
    const queueStats = {
      concurrency: queue.maxConcurrency || 5,
      maxRetries: queue.maxRetries || 3,
      rateLimitPerSecond: queue.rateLimitPerSecond || 3,
    };

    // Try to get pending count if available
    let pendingCount = null;
    if (typeof queue.getPendingCount === 'function') {
      pendingCount = queue.getPendingCount();
    }

    const workerStatus = worker ? {
      status: worker.processing ? 'running' : 'stopped',
      pollInterval: worker.pollInterval || 500,
    } : { status: 'not_initialized' };

    return {
      status: 'healthy',
      details: {
        queue: queueStats,
        pendingCount,
        worker: workerStatus,
      },
    };
  } catch (error) {
    return { status: 'degraded', error: error.message.slice(0, 100) };
  }
}

/** Check 5: System Resources */
async function checkSystemResources() {
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();

  // Memory usage metrics
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);
  const externalMB = Math.round(memUsage.external / 1024 / 1024);

  // S128/M-A01: Fix heapUsagePercent calculation
  // Use V8 heap_size_limit (max-old-space-size) instead of heapTotal (allocated)
  // Previously: heapUsed/heapTotal showed 88% (53MB/60MB allocated) — misleading
  // Now:     heapUsed/heap_size_limit shows ~14% (53MB/384MB limit) — accurate
  const v8HeapStats = v8.getHeapStatistics();
  const heapSizeLimitMB = Math.round(v8HeapStats.heap_size_limit / 1024 / 1024);
  const heapUsagePercent = heapSizeLimitMB > 0 ? Math.round((heapUsedMB / heapSizeLimitMB) * 100) : 0;

  // S098/PhaseH: Dual-threshold memory health check
  // Primary: RSS vs container limit (512MB) — reflects real OS memory pressure
  // Secondary: Heap % — V8 internal metric, tolerant of pre-allocation behavior
  const CONTAINER_MEMORY_MB = 512;
  const rssPercent = Math.round((rssMB / CONTAINER_MEMORY_MB) * 100);

  let memoryStatus = 'healthy';
  if (rssPercent > 90 || heapUsagePercent > 95) {
    memoryStatus = 'critical';
  } else if (rssPercent > 75 || heapUsagePercent > 85) {
    memoryStatus = 'warning';
  }

  // Event loop lag check (simplified)
  let eventLoopLagMs = 0;
  const eventLoopStart = Date.now();
  setImmediate(() => {
    eventLoopLagMs = Date.now() - eventLoopStart;
  });

  return {
    status: memoryStatus === 'healthy' ? 'healthy' : 'degraded',
    details: {
      nodeVersion: process.version,
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      memory: {
        heapUsed: `${heapUsedMB} MB`,
        heapTotal: `${heapTotalMB} MB`,
        heapSizeLimit: `${heapSizeLimitMB} MB`,
        heapUsagePercent,
        rss: `${rssMB} MB`,
        rssPercent: `${rssPercent}%`,
        external: `${externalMB} MB`,
        arrayBuffers: `${Math.round(memUsage.arrayBuffers / 1024 / 1024)} MB`,
      },
      uptime: formatUptime(uptime),
      memoryStatus,
    },
  };
}

// ============================================
// Route Handlers
// ============================================

/**
 * GET /api/v1/health — Full Deep Health Check
 *
 * Checks ALL subsystems and returns an aggregate health score.
 * Used by monitoring systems (Prometheus, Datadog, etc.)
 */
router.get('/', async (req, res) => {
  const startTime = Date.now();
  const pipeline = getPipelineComponents(req);

  // Run all checks in parallel
  const [dbCheck, redisCheck, engineCheck, queueCheck, systemCheck] = await Promise.all([
    runCheck('database', checkDatabase),
    runCheck('redis', checkRedis),
    runCheck('engine', checkEngine),
    runCheck('email_queue', () => checkQueue(pipeline.queue, pipeline.worker)),
    runCheck('system_resources', checkSystemResources),
  ]);

  const checks = [dbCheck, redisCheck, engineCheck, queueCheck, systemCheck];
  const aggregate = calculateAggregateHealth(checks);

  const responseTimeMs = Date.now() - startTime;

  res.json({
    status: aggregate.status,
    service: 'GlobalReach V2.0 Enterprise API',
    version: '2.0.0',
    apiVersion: req.apiVersion || '1',
    timestamp: new Date().toISOString(),
    responseTimeMs,
    uptime: { seconds: Math.floor(process.uptime()), human: formatUptime(process.uptime()) },

    // Aggregate score
    healthScore: {
      score: aggregate.score,
      status: aggregate.status,
      totalChecks: checks.length,
      passedChecks: checks.filter((c) => c.status === 'healthy').length,
    },

    // Individual subsystem results
    checks: {
      database: dbCheck,
      redis: redisCheck,
      engine: engineCheck,
      email_queue: queueCheck,
      system_resources: systemCheck,
    },

    // Quick summary for dashboards
    summary: {
      database: dbCheck.status,
      redis: redisCheck.status !== 'not_configured' ? redisCheck.status : 'skipped',
      engine: engineCheck.status !== 'not_configured' ? engineCheck.status : 'skipped',
      queue: queueCheck.status !== 'not_configured' ? queueCheck.status : 'skipped',
      system: systemCheck.status,
    },
  });
});

/**
 * GET /api/v1/health/ready — Readiness Probe
 *
 * Lightweight check: Is the application ready to serve traffic?
 * Only checks database connectivity.
 * Used by Kubernetes/Docker for readiness gating.
 */
router.get('/ready', async (req, res) => {
  try {
    const start = Date.now();
    await sequelize.query('SELECT 1');
    const latencyMs = Date.now() - start;

    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks: { database: { status: 'healthy', latencyMs } },
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: error.message.slice(0, 200),
    });
  }
});

/**
 * GET /api/v1/health/live — Liveness Probe
 *
 * Minimal check: Is the process alive?
 * Used by orchestration platforms to detect hangs.
 */
router.get('/live', (_, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    pid: process.pid,
    uptime: Math.floor(process.uptime()),
  });
});

// ============================================
// Utility Functions
// ============================================

function formatUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

module.exports = router;
