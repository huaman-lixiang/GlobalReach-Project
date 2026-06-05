const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { webhookService } = require('../services/webhookService');

router.post('/', verifyToken, async (req, res) => {
  try {
    const { url, events, secret } = req.body;
    const webhook = await webhookService.createWebhook(req.user.id, url, events, secret);
    res.status(201).json({ success: true, data: webhook });
  } catch (error) {
    console.error('[Webhooks] Create error:', error);
    res.status(500).json({ success: false, error: 'WEBHOOK_CREATE_FAILED', message: error.message });
  }
});

router.get('/', verifyToken, async (req, res) => {
  try {
    const webhooks = await webhookService.getWebhooks(req.user.id);
    res.json({ success: true, data: webhooks });
  } catch (error) {
    console.error('[Webhooks] List error:', error);
    res.status(500).json({ success: false, error: 'WEBHOOK_LIST_FAILED', message: error.message });
  }
});

router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const webhook = await webhookService.getWebhookById(id, req.user.id);
    if (!webhook) {
      return res.status(404).json({ success: false, error: 'WEBHOOK_NOT_FOUND' });
    }
    res.json({ success: true, data: webhook });
  } catch (error) {
    console.error('[Webhooks] Get error:', error);
    res.status(500).json({ success: false, error: 'WEBHOOK_GET_FAILED', message: error.message });
  }
});

router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { url, events, secret } = req.body;
    const updates = {};
    if (url) updates.url = url;
    if (events) updates.events = JSON.stringify(events);
    if (secret !== undefined) updates.secret = secret;
    
    await webhookService.updateWebhook(id, req.user.id, updates);
    res.json({ success: true, message: 'Webhook updated successfully' });
  } catch (error) {
    console.error('[Webhooks] Update error:', error);
    res.status(500).json({ success: false, error: 'WEBHOOK_UPDATE_FAILED', message: error.message });
  }
});

router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    await webhookService.deleteWebhook(id, req.user.id);
    res.json({ success: true, message: 'Webhook deleted successfully' });
  } catch (error) {
    console.error('[Webhooks] Delete error:', error);
    res.status(500).json({ success: false, error: 'WEBHOOK_DELETE_FAILED', message: error.message });
  }
});

router.patch('/:id/toggle', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;
    await webhookService.toggleWebhook(id, req.user.id, enabled);
    res.json({ success: true, message: `Webhook ${enabled ? 'enabled' : 'disabled'} successfully` });
  } catch (error) {
    console.error('[Webhooks] Toggle error:', error);
    res.status(500).json({ success: false, error: 'WEBHOOK_TOGGLE_FAILED', message: error.message });
  }
});

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