const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { rateLimiter, autoEndpointLimiter } = require('../middleware/rateLimiter');
const { asyncHandler } = require('../middleware/errorHandler');
const { webhookService } = require('../services/webhookService');
const { webhookListenerService } = require('../services/webhookListenerService');

// S152: 标准安全中间件链
// Note: Incoming webhook endpoints (alertmanager, github, generic) are intentionally public
// as they receive callbacks from external services. They use service-level rate limiting.
// Outgoing webhook management endpoints require authentication.
router.use(rateLimiter);

// ============================================
// M-C03: Incoming Webhook Listener Endpoints
// Receives webhooks from AlertManager, GitHub, and generic sources
// ============================================

/**
 * POST /api/v1/webhooks/alertmanager
 * Receive AlertManager notifications (primary integration point)
 */
router.post('/alertmanager', async (req, res) => {
  const startTime = Date.now();
  const clientIp = req.ip || req.connection.remoteAddress;
  const metadata = {
    ip: clientIp,
    userAgent: req.get('User-Agent'),
    timestamp: new Date(),
  };

  try {
    // Rate limiting check
    const rateLimitResult = webhookListenerService.checkRateLimit(clientIp);
    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this source',
        retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000),
      });
    }

    // Signature verification (optional but recommended)
    const signature = req.get('X-GlobalReach-Signature') || req.get('Authorization');
    const rawBody = JSON.stringify(req.body);

    if (signature && process.env.WEBHOOK_SECRET) {
      const isValid = webhookListenerService.verifySignature(
        rawBody,
        signature,
        process.env.WEBHOOK_SECRET
      );
      if (!isValid) {
        console.warn(`[WebhookListener] Invalid signature from IP: ${clientIp}`);
        return res.status(401).json({
          success: false,
          error: 'INVALID_SIGNATURE',
          message: 'Webhook signature verification failed',
        });
      }
    }

    // Validate payload structure
    if (!webhookListenerService.validateAlertManagerPayload(req.body)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PAYLOAD',
        message: 'Invalid AlertManager payload structure',
      });
    }

    // Process alerts
    const result = await webhookListenerService.processAlertManagerAlert(req.body, metadata);

    const processingTime = Date.now() - startTime;
    console.log(`[WebhookListener] AlertManager webhook processed in ${processingTime}ms`);

    res.json({
      success: true,
      message: 'AlertManager notification received',
      ...result,
      processingTimeMs: processingTime,
    });
  } catch (error) {
    console.error('[WebhookListener] AlertManager processing error:', error.message);

    // Log failed event
    await webhookListenerService.logEvent('alertmanager', 'error', {
      error: error.message,
      ip: clientIp,
    }, metadata);

    res.status(500).json({
      success: false,
      error: 'PROCESSING_ERROR',
      message: error.message,
    });
  }
});

/**
 * POST /api/v1/webhooks/github
 * Receive GitHub push/deployment events for CI/CD integration
 */
router.post('/github', async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  const eventType = req.get('X-GitHub-Event') || 'unknown';
  const metadata = {
    ip: clientIp,
    userAgent: req.get('User-Agent'),
    timestamp: new Date(),
  };

  try {
    // Rate limiting
    const rateLimitResult = webhookListenerService.checkRateLimit(clientIp);
    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this source',
      });
    }

    // Process GitHub event
    const result = await webhookListenerService.processGitHubEvent(req.body, eventType, metadata);

    res.json({
      success: true,
      message: `GitHub ${eventType} event received`,
      ...result,
    });
  } catch (error) {
    console.error('[WebhookListener] GitHub processing error:', error.message);

    res.status(error.message.includes('UNSUPPORTED_EVENT') ? 400 : 500).json({
      success: false,
      error: error.message.includes('UNSUPPORTED_EVENT') ? 'UNSUPPORTED_EVENT' : 'PROCESSING_ERROR',
      message: error.message,
    });
  }
});

/**
 * POST /api/v1/webhooks/generic
 * Receive arbitrary JSON payloads with optional forwarding
 */
router.post('/generic', async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  const metadata = {
    ip: clientIp,
    userAgent: req.get('User-Agent'),
    timestamp: new Date(),
  };

  try {
    // Rate limiting (stricter for generic endpoints)
    const rateLimitResult = webhookListenerService.checkRateLimit(clientIp);
    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this source',
      });
    }

    // Process generic webhook
    const result = await webhookListenerService.processGenericWebhook(req.body, metadata);

    res.json({
      success: true,
      message: 'Generic webhook received',
      ...result,
    });
  } catch (error) {
    console.error('[WebhookListener] Generic processing error:', error.message);

    res.status(400).json({
      success: false,
      error: 'INVALID_PAYLOAD',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/webhooks/events
 * View recent webhook events (authenticated)
 */
router.get('/events', verifyToken, asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const events = await webhookListenerService.getRecentEvents(limit);

  res.json({
    success: true,
    count: events.length,
    data: events,
  });
}));

// ============================================
// Existing Outgoing Webhook Management Routes (CRUD)
// ============================================

router.post('/', verifyToken, asyncHandler(async (req, res) => {
  const { url, events, secret } = req.body;
  const webhook = await webhookService.createWebhook(req.user.id, url, events, secret);
  res.status(201).json({ success: true, data: webhook });
}));

router.get('/', verifyToken, asyncHandler(async (req, res) => {
  const webhooks = await webhookService.getWebhooks(req.user.id);
  res.json({ success: true, data: webhooks });
}));

router.get('/:id', verifyToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const webhook = await webhookService.getWebhookById(id, req.user.id);
  if (!webhook) {
    return res.status(404).json({ success: false, error: 'WEBHOOK_NOT_FOUND' });
  }
  res.json({ success: true, data: webhook });
}));

router.put('/:id', verifyToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { url, events, secret } = req.body;
  const updates = {};
  if (url) updates.url = url;
  if (events) updates.events = JSON.stringify(events);
  if (secret !== undefined) updates.secret = secret;

  await webhookService.updateWebhook(id, req.user.id, updates);
  res.json({ success: true, message: 'Webhook updated successfully' });
}));

router.delete('/:id', verifyToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await webhookService.deleteWebhook(id, req.user.id);
  res.json({ success: true, message: 'Webhook deleted successfully' });
}));

router.patch('/:id/toggle', verifyToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body;
  await webhookService.toggleWebhook(id, req.user.id, enabled);
  res.json({ success: true, message: `Webhook ${enabled ? 'enabled' : 'disabled'} successfully` });
}));

router.get('/:id/logs', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await webhookService.getDeliveryLogs(id, req.user.id);
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('[Webhooks] Logs error:', error);
    if (error.message === 'WEBHOOK_NOT_FOUND') {
      res.status(404).json({ success: false, error: 'WEBHOOK_NOT_FOUND' });
    } else {
      res.status(500).json({ success: false, error: 'WEBHOOK_LOGS_FAILED', message: error.message });
    }
  }
});

module.exports = router;
