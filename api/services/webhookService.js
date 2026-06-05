const db = require('../db');
const axios = require('axios');

class WebhookService {
  async createWebhook(userId, url, events, secret = null) {
    return db.Webhook.create({
      userId,
      url,
      events: JSON.stringify(events),
      secret,
      enabled: true,
    });
  }

  async getWebhooks(userId) {
    return db.Webhook.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
    });
  }

  async getWebhookById(id, userId) {
    return db.Webhook.findOne({
      where: { id, userId },
    });
  }

  async updateWebhook(id, userId, updates) {
    return db.Webhook.update(updates, {
      where: { id, userId },
    });
  }

  async deleteWebhook(id, userId) {
    return db.Webhook.destroy({
      where: { id, userId },
    });
  }

  async toggleWebhook(id, userId, enabled) {
    return db.Webhook.update(
      { enabled },
      { where: { id, userId } }
    );
  }

  async triggerEvent(eventType, payload) {
    const webhooks = await db.Webhook.findAll({
      where: { enabled: true },
    });

    const tasks = webhooks.map(async (webhook) => {
      const events = JSON.parse(webhook.events || '[]');
      if (!events.includes(eventType)) {
        return;
      }

      try {
        const signature = webhook.secret
          ? this.generateSignature(payload, webhook.secret)
          : null;

        const headers = {
          'Content-Type': 'application/json',
          'X-GlobalReach-Event': eventType,
        };

        if (signature) {
          headers['X-GlobalReach-Signature'] = signature;
        }

        await axios.post(webhook.url, payload, {
          headers,
          timeout: 10000,
        });

        await this.logDelivery(webhook.id, eventType, true);
      } catch (error) {
        console.error(`[Webhook] Delivery failed for ${webhook.url}:`, error.message);
        await this.logDelivery(webhook.id, eventType, false, error.message);
      }
    });

    await Promise.all(tasks);
  }

  generateSignature(payload, secret) {
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return hmac.digest('hex');
  }

  async logDelivery(webhookId, eventType, success, errorMessage = null) {
    return db.WebhookLog.create({
      webhookId,
      eventType,
      success,
      errorMessage,
    });
  }

  async getDeliveryLogs(webhookId, userId) {
    const webhook = await db.Webhook.findOne({ where: { id: webhookId, userId } });
    if (!webhook) {
      throw new Error('WEBHOOK_NOT_FOUND');
    }

    return db.WebhookLog.findAll({
      where: { webhookId },
      order: [['createdAt', 'DESC']],
      limit: 100,
    });
  }
}

const webhookService = new WebhookService();

module.exports = {
  WebhookService,
  webhookService,
};