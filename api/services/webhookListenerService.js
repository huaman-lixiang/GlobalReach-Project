const crypto = require('crypto');
const db = require('../db');

/**
 * WebhookListenerService - Handles incoming webhooks from AlertManager, GitHub, and generic sources
 * M-C03: Webhook Listener Enablement
 */
class WebhookListenerService {
  constructor() {
    this.rateLimitMap = new Map();
    this.RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
    this.RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.WEBHOOK_RATE_LIMIT || '100');
    this.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || this.generateDefaultSecret();
  }

  /**
   * Generate a default webhook secret (should be overridden in production)
   */
  generateDefaultSecret() {
    const secret = crypto.randomBytes(32).toString('hex');
    console.warn('[WebhookListener] ⚠️  Using auto-generated WEBHOOK_SECRET. Set WEBHOOK_SECRET environment variable in production!');
    return secret;
  }

  /**
   * Verify HMAC-SHA256 signature
   * @param {string} payload - Raw request body
   * @param {string} signature - Signature from header (format: sha256=...)
   * @param {string} secret - Shared secret
   * @returns {boolean}
   */
  verifySignature(payload, signature, secret) {
    if (!signature || !secret) {
      return false;
    }

    const expectedPrefix = 'sha256=';
    if (!signature.startsWith(expectedPrefix)) {
      return false;
    }

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const expectedSignature = `${expectedPrefix}${hmac.digest('hex')}`;

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Check rate limit for a source IP
   * @param {string} ip - Source IP address
   * @returns {{allowed: boolean, remaining: number, resetTime: number}}
   */
  checkRateLimit(ip) {
    const now = Date.now();
    const windowStart = now - this.RATE_LIMIT_WINDOW_MS;

    // Clean up old entries
    for (const [key, timestamps] of this.rateLimitMap.entries()) {
      const filtered = timestamps.filter(t => t > windowStart);
      if (filtered.length === 0) {
        this.rateLimitMap.delete(key);
      } else {
        this.rateLimitMap.set(key, filtered);
      }
    }

    // Get or create entry for this IP
    let requests = this.rateLimitMap.get(ip) || [];

    if (requests.length >= this.RATE_LIMIT_MAX_REQUESTS) {
      const oldestRequest = requests[0];
      return {
        allowed: false,
        remaining: 0,
        resetTime: oldestRequest + this.RATE_LIMIT_WINDOW_MS,
      };
    }

    requests.push(now);
    this.rateLimitMap.set(ip, requests);

    return {
      allowed: true,
      remaining: this.RATE_LIMIT_MAX_REQUESTS - requests.length,
      resetTime: now + this.RATE_LIMIT_WINDOW_MS,
    };
  }

  /**
   * Process AlertManager webhook payload
   * @param {object} payload - AlertManager notification payload
   * @param {object} metadata - Request metadata (ip, headers, etc.)
   * @returns {Promise<object>} Processing result
   */
  async processAlertManagerAlert(payload, metadata) {
    const { version, alertKey, status, alerts, groupLabels, commonLabels, commonAnnotations, externalURL } = payload;

    if (!alerts || !Array.isArray(alerts)) {
      throw new Error('INVALID_PAYLOAD: Missing or invalid alerts array');
    }

    const processedAlerts = [];
    const fingerprints = new Set();

    for (const alert of alerts) {
      // Deduplication by fingerprint
      const fingerprint = alert.fingerprint || this.generateFingerprint(alert);
      if (fingerprints.has(fingerprint)) {
        continue; // Skip duplicate alerts
      }
      fingerprints.add(fingerprint);

      // Classify alert by severity
      const severity = alert.labels?.severity || 'unknown';
      const alertName = alert.labels?.alertname || 'unnamed';

      // Process each alert
      const processedAlert = {
        fingerprint,
        status: alert.status || status,
        severity,
        alertName,
        instance: alert.labels?.instance,
        team: alert.labels?.team,
        summary: alert.annotations?.summary || commonAnnotations?.summary,
        description: alert.annotations?.description || commonAnnotations?.description,
        startsAt: alert.startsAt,
        endsAt: alert.endsAt,
        receivedAt: new Date(),
        source: 'alertmanager',
      };

      // Log to database (or fallback to console)
      await this.logEvent('alertmanager', 'alert', processedAlert, metadata);

      processedAlerts.push(processedAlert);
    }

    console.log(`[WebhookListener] Processed ${processedAlerts.length} AlertManager alerts (${status})`);

    return {
      success: true,
      processedCount: processedAlerts.length,
      deduplicatedCount: alerts.length - processedAlerts.length,
      alerts: processedAlerts.map(a => ({
        fingerprint: a.fingerprint,
        alertName: a.alertName,
        severity: a.severity,
        status: a.status,
      })),
    };
  }

  /**
   * Process GitHub webhook payload
   * @param {object} payload - GitHub event payload
   * @param {string} eventType - GitHub event type (push, deployment, etc.)
   * @param {object} metadata - Request metadata
   * @returns {Promise<object>}
   */
  async processGitHubEvent(payload, eventType, metadata) {
    const supportedEvents = ['push', 'deployment', 'deployment_status', 'ping'];

    if (!supportedEvents.includes(eventType)) {
      throw new Error(`UNSUPPORTED_EVENT: ${eventType}`);
    }

    const eventData = {
      eventType,
      ref: payload.ref,
      repository: payload.repository?.full_name,
      sender: payload.sender?.login,
      commit: payload.after?.substring(0, 7), // Short SHA
      action: payload.action,
      receivedAt: new Date(),
      source: 'github',
    };

    await this.logEvent('github', eventType, eventData, metadata);

    console.log(`[WebhookListener] Received GitHub ${eventType} event from ${eventData.sender}`);

    return {
      success: true,
      event: eventType,
      repository: eventData.repository,
      sender: eventData.sender,
    };
  }

  /**
   * Process generic webhook payload
   * @param {object} payload - Arbitrary JSON payload
   * @param {object} metadata - Request metadata
   * @returns {Promise<object>}
   */
  async processGenericWebhook(payload, metadata) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('INVALID_PAYLOAD: Payload must be a JSON object');
    }

    const eventData = {
      payloadType: payload.type || payload.event || 'generic',
      payloadSize: JSON.stringify(payload).length,
      receivedAt: new Date(),
      source: 'generic',
      // Store only metadata, not full payload (security)
      keys: Object.keys(payload).slice(0, 20), // Limit to first 20 keys
    };

    await this.logEvent('generic', eventData.payloadType, eventData, metadata);

    console.log(`[WebhookListener] Received generic webhook (${eventData.payloadType})`);

    return {
      success: true,
      eventId: eventData.receivedAt.getTime(),
      received: true,
    };
  }

  /**
   * Log webhook event to database or console
   * @param {string} source - Webhook source (alertmanager, github, generic)
   * @param {string} type - Event type
   * @param {object} data - Event data (sanitized)
   * @param {object} metadata - Request metadata
   */
  async logEvent(source, type, data, metadata) {
    try {
      // Try to store in database if WebhookEvent model exists
      if (db.WebhookEvent) {
        await db.WebhookEvent.create({
          source,
          type,
          data: JSON.stringify(data),
          ipAddress: metadata?.ip,
          userAgent: metadata?.userAgent,
          statusCode: 200,
        });
      } else {
        // Fallback: log to ErrorLog table with structured data
        await db.ErrorLog.create({
          errorType: `WEBHOOK_${source.toUpperCase()}`,
          errorMessage: `Webhook event: ${type}`,
          requestUrl: `/api/v1/webhooks/${source}`,
          requestMethod: 'POST',
          statusCode: 200,
          metadata: JSON.stringify({
            source,
            type,
            ip: metadata?.ip,
            timestamp: new Date().toISOString(),
            alertCount: data.alerts?.length || 1,
          }),
        });
      }
    } catch (error) {
      // If database logging fails, fall back to console
      console.error('[WebhookListener] Failed to log event:', error.message);
      console.log(`[WebhookListener] Event [${source}/${type}] from IP: ${metadata?.ip}`);
    }
  }

  /**
   * Get recent webhook events
   * @param {number} limit - Maximum events to return
   * @returns {Promise<Array>}
   */
  async getRecentEvents(limit = 50) {
    try {
      if (db.WebhookEvent) {
        return await db.WebhookEvent.findAll({
          order: [['createdAt', 'DESC']],
          limit,
        });
      }

      // Fallback: query ErrorLog for webhook events
      return await db.ErrorLog.findAll({
        where: {
          errorType: {
            [db.Sequelize.Op.like]: 'WEBHOOK_%',
          },
        },
        order: [['createdAt', 'DESC']],
        limit,
      });
    } catch (error) {
      console.error('[WebhookListener] Failed to fetch events:', error.message);
      return [];
    }
  }

  /**
   * Generate deterministic fingerprint for alert deduplication
   * @param {object} alert - Alert object
   * @returns {string}
   */
  generateFingerprint(alert) {
    const key = [
      alert.labels?.alertname,
      alert.labels?.instance,
      alert.labels?.severity,
    ].filter(Boolean).join('|');

    return crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  /**
   * Validate AlertManager payload structure
   * @param {object} payload
   * @returns {boolean}
   */
  validateAlertManagerPayload(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (!payload.status || !['firing', 'resolved'].includes(payload.status)) return false;
    if (!Array.isArray(payload.alerts)) return false;

    // Basic structure validation
    for (const alert of payload.alerts.slice(0, 5)) { // Validate first 5 alerts
      if (!alert.labels || typeof alert.labels !== 'object') return false;
    }

    return true;
  }
}

const webhookListenerService = new WebhookListenerService();

module.exports = {
  WebhookListenerService,
  webhookListenerService,
};
