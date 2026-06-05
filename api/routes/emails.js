/**
 * Emails Route - D02 Service Layer Integration
 *
 * All endpoints delegate to emailService which bridges:
 *   Route → EmailService → M8 Formatter + M7 Failover + DB Persistence
 *
 * Key improvements over previous version:
 * - Fixed: res.success()/res.error() were not Express methods (caused 500 errors)
 * - Added: DB persistence for all sent emails
 * - Added: Campaign-driven batch send with template rendering
 * - Added: Email record queries with pagination
 *
 * IMPORTANT: Literal paths MUST be defined before /:id parameterized routes.
 */

const express = require('express');
const { body, query, param } = require('express-validator');
const router = express.Router();

const emailService = require('../services/emailService');
const { verifyToken, validateRequest } = require('../middleware/auth');
const { emailSendLimiter, batchOperationLimiter } = require('../middleware/rateLimiter');
const {
  paginationRules,
  emailSendRules,
  emailValidateRules,
} = require('../middleware/validator');

router.use(verifyToken);

// ============================================
// Literal path routes (MUST come before /:id)
// ============================================

// POST /api/emails/send - Send single email (M8 Engine)
router.post('/send', emailSendLimiter, ...emailSendRules(), validateRequest, async (req, res) => {
  try {
    const result = await emailService.sendEmail(req.user.id, {
      ...req.body,
      from: req.user.email,
    });

    res.status(result.success ? 200 : 202).json({
      success: result.success,
      data: result,
      message: result.success ? 'Email sent successfully' : 'Email queued but send failed',
    });
  } catch (error) {
    console.error('[Emails] Send error:', error);

    // Try to persist failed record
    try {
      const db = require('../db');
      await db.Email.create({
        userId: req.user.id,
        toAddress: Array.isArray(req.body.to) ? req.body.to.join(',') : String(req.body.to),
        fromAddress: req.user.email || '',
        subject: req.body.subject || '',
        status: 'FAILED',
        errorMessage: error.message,
      });
    } catch (_) {}

    const statusCode = error.code === 'INVALID_EMAIL' ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.code || 'EMAIL_SEND_FAILED',
      message: error.message || 'Failed to send email',
      details: error.details || null,
    });
  }
});

// POST /api/emails/send/batch - Batch send with rate limiting
router.post('/send/batch', batchOperationLimiter, [
  body('emails').isArray({ min: 1, max: 100 }).withMessage('Emails array required (max 100)'),
  body('emails.*.to').isArray().withMessage('Each email needs recipients array'),
  body('delay').optional().isInt({ min: 0, max: 5000 }),
], validateRequest, async (req, res) => {
  try {
    const result = await emailService.sendBatch(req.user.id, {
      emails: req.body.emails,
      delay: req.body.delay || 500,
      campaignId: req.body.campaignId,
    });

    res.json({
      success: true,
      data: result,
      message: `Batch completed: ${result.success}/${result.total} successful`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'BATCH_SEND_FAILED',
      message: error.message,
    });
  }
});

// POST /api/emails/campaign/:id/execute - Execute a campaign send (D03: ASYNC)
router.post('/campaign/:campaignId/execute', [
  param('campaignId').isUUID(),
  body('clientIds').optional().isArray(),
], validateRequest, async (req, res) => {
  try {
    const result = await emailService.sendCampaign(req.user.id, req.params.campaignId, {
      clientIds: req.body.clientIds,
      priority: req.body.priority || 'normal',
      delayUntil: req.body.delayUntil || null,
    });

    // D03: Async response — returns immediately with queue info
    res.status(202).json({
      success: true,
      data: result,
      message: result.message || `Campaign queued: ${result.totalEnqueued} emails. Track progress at /api/progress/campaign/${result.campaignId}`,
    });
  } catch (error) {
    const statusCode = error.code === 'CAMPAIGN_NOT_FOUND' ? 404 :
                        error.code === 'NO_TARGETS' ? 400 : 500;

    res.status(statusCode).json({
      success: false,
      error: error.code || 'CAMPAIGN_EXECUTE_FAILED',
      message: error.message,
    });
  }
});

// GET /api/emails - List email records with pagination
router.get('/', ...paginationRules(), async (req, res) => {
  try {
    const result = await emailService.listEmails(req.user.id, req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Emails] List error:', error);
    res.status(500).json({ success: false, error: 'FETCH_EMAILS_FAILED', message: error.message });
  }
});

// GET /api/emails/stats - Aggregate email statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await emailService.getEmailStats(req.user.id, {
      from: req.query.from,
      to: req.query.to,
    });
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: 'STATS_FETCH_FAILED', message: error.message });
  }
});

// POST /api/emails/validate - Validate email format (M8 Formatter)
router.post('/validate', ...emailValidateRules(), validateRequest, (req, res) => {
  try {
    const validation = emailService.validateEmail(req.body);

    if (!validation.valid) {
      return res.json({
        success: false,
        data: { valid: false, errors: validation.errors },
        message: 'Email validation failed',
      });
    }

    res.json({
      success: true,
      data: { valid: true, warnings: validation.warnings || [] },
      message: 'Email is valid and ready to send',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'VALIDATION_ERROR', message: error.message });
  }
});

// GET /api/emails/preview - Format preview for platform
router.get('/preview', [
  query('platform').optional().isIn(['gmail','outlook','qq','163','custom']),
], validateRequest, (req, res) => {
  try {
    const rawEmail = req.body || {
      from: 'sender@example.com',
      to: ['recipient@example.com'],
      subject: 'Preview Email',
      html: '<h1>Test</h1><p>This is a preview</p>',
    };

    const formatted = emailService.formatForPreview(rawEmail, req.query.platform || 'gmail');
    res.json({ success: true, data: formatted });
  } catch (error) {
    res.status(500).json({ success: false, error: 'PREVIEW_FAILED', message: error.message });
  }
});

// GET /api/emails/format/:platform - Platform-specific format sample
router.get('/format/:platform', (req, res) => {
  try {
    const supportedPlatforms = ['gmail', 'outlook', 'qq', '163', 'custom'];
    const platform = req.params.platform.toLowerCase();

    if (!supportedPlatforms.includes(platform)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PLATFORM',
        message: `Unsupported platform: ${platform}`,
        data: { supported: supportedPlatforms },
      });
    }

    const sampleFormatted = emailService.formatForPreview({
      from: 'test@example.com',
      to: ['recipient@example.com'],
      subject: 'Sample Subject',
      html: '<h1>Test</h1><p>Content</p>',
    }, platform);

    res.json({ success: true, data: sampleFormatted });
  } catch (error) {
    res.status(500).json({ success: false, error: 'FORMAT_FAILED', message: error.message });
  }
});

// ============================================
// Parameterized route (/ :id)
// ============================================

// GET /api/emails/:id - Get single email record
router.get('/:id', [param('id').isUUID()], validateRequest, async (req, res) => {
  try {
    const email = await emailService.getEmail(req.params.id, req.user.id);
    if (!email) return res.status(404).json({ success: false, error: 'EMAIL_NOT_FOUND', message: 'Email not found' });

    res.json({ success: true, data: email });
  } catch (error) {
    res.status(500).json({ success: false, error: 'GET_EMAIL_FAILED', message: error.message });
  }
});

module.exports = router;
