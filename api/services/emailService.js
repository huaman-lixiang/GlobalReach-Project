/**
 * Email Service - M8 Engine Integration Layer (D02+D03)
 *
 * Bridges API routes with M8 platform adapters, email formatting,
 * failover logic, template engine, and DB persistence.
 *
 * Architecture:
 *   Route → EmailService → TemplateEngine (render)
 *                      → AccountService (account selection)
 *                      → EmailFormatter (formatting)
 *                      → PlatformAdapter (sending via IMAP/SMTP)
 *                      → FailoverManager (retry/fallback)
 *                      → DB.Email (persistence)
 *
 * D03 Enhancement: Campaign sends are now ASYNC via EmailQueue + SendWorker.
 */

const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// M7/M8 Engine modules
let AccountPoolManager, FailoverManager, EmailFormatter;
let poolManager, failoverManager, emailFormatter;

try {
  AccountPoolManager = require('../../src/modules/m7-multi-platform-manager/AccountPoolManager');
  FailoverManager = require('../../src/modules/m7-multi-platform-manager/FailoverManager');
  EmailFormatter = require('../../src/modules/m8-platform-adapter-engine/EmailFormatter');

  poolManager = new AccountPoolManager();
  failoverManager = new FailoverManager(poolManager);
  emailFormatter = new EmailFormatter();
  console.log('[EmailService] M8 Engine loaded successfully');
} catch (e) {
  console.warn('[EmailService] M8 Engine not available:', e.message);
}

// D03: Template Engine
let TemplateEngine;
let templateEngine;

try {
  TemplateEngine = require('../templates/templateEngine');
  templateEngine = new TemplateEngine();
  console.log('[EmailService] TemplateEngine loaded successfully');
} catch (e) {
  console.warn('[EmailService] TemplateEngine not available:', e.message);
}

// D03: Email Queue reference (set by server.js on startup)
let emailQueue;

// ============================================
// Single Email Send
// ============================================

/**
 * Send a single email with full engine integration.
 * Flow: validate → format → select account → send → persist
 */
async function sendEmail(userId, emailData) {
  // 1. Validate input via EmailFormatter
  const rawEmail = {
    from: emailData.from || userId, // fallback to user identifier
    to: emailData.to,
    cc: emailData.cc,
    bcc: emailData.bcc,
    subject: emailData.subject,
    html: emailData.html,
    text: emailData.text,
    attachments: emailData.attachments,
    replyTo: emailData.replyTo,
  };

  if (emailFormatter) {
    const validation = emailFormatter.validateEmail(rawEmail);
    if (!validation.valid) {
      throw Object.assign(new Error(validation.errors[0]), { code: 'INVALID_EMAIL', details: validation.errors });
    }
  }

  // 2. Determine target platform
  const targetPlatform = emailData.platform || 'gmail';

  // 3. Format email for target platform
  let formattedEmail = rawEmail;
  if (emailFormatter) {
    formattedEmail = emailFormatter.formatEmail(rawEmail, targetPlatform);
  }

  // 4. Select sending account and send
  let sendResult;
  const accountId = emailData.accountId;

  if (failoverManager && !accountId) {
    // Use failover manager for automatic account selection + retry
    sendResult = await _sendWithFailover(formattedEmail, { requiredPlatform: targetPlatform, ...emailData });
  } else if (accountId) {
    // Use specific account
    sendResult = await _sendWithAccount(accountId, formattedEmail, userId);
  } else {
    // Fallback: direct nodemailer send without engine
    sendResult = await _sendDirect(formattedEmail, targetPlatform);
  }

  // 5. Persist email record to DB
  const emailRecord = await db.Email.create({
    userId,
    clientId: emailData.clientId || null,
    accountId: sendResult.accountId || null,
    campaignId: emailData.campaignId || null,
    toAddress: Array.isArray(formattedEmail.to) ? formattedEmail.to.map(r => r.email).join(',') : formattedEmail.to,
    fromAddress: typeof formattedEmail.from === 'object' ? formattedEmail.from.email : formattedEmail.from,
    subject: formattedEmail.subject,
    bodyHtml: formattedEmail.html || null,
    bodyText: formattedEmail.text || null,
    status: sendResult.success ? 'SENT' : 'FAILED',
    sentAt: sendResult.success ? new Date() : null,
    errorMessage: sendResult.success ? null : sendResult.error,
    providerMessageId: sendResult.messageId || null,
  });

  return {
    success: sendResult.success,
    messageId: sendResult.messageId || emailRecord.id,
    emailId: emailRecord.id,
    accountId: sendResult.accountId || null,
    platform: sendResult.platform || targetPlatform,
    sentAt: emailRecord.sentAt,
    status: emailRecord.status,
  };
}

// ============================================
// Batch Email Send
// ============================================

/**
 * Send multiple emails with rate limiting and individual error handling.
 */
async function sendBatch(userId, batchData) {
  const { emails, delay = 500, campaignId } = batchData;
  const results = [];

  for (let i = 0; i < emails.length; i++) {
    const emailConfig = emails[i];

    try {
      const result = await sendEmail(userId, {
        ...emailConfig,
        campaignId,
      });

      results.push({
        index: i,
        success: true,
        emailId: result.emailId,
        messageId: result.messageId,
        to: emailConfig.to,
      });
    } catch (error) {
      // Persist failed record
      try {
        await db.Email.create({
          userId,
          campaignId,
          toAddress: Array.isArray(emailConfig.to) ? emailConfig.to.join(',') : String(emailConfig.to),
          fromAddress: emailConfig.from || '',
          subject: emailConfig.subject || '',
          status: 'FAILED',
          errorMessage: error.message,
        });
      } catch (persistError) {
        console.error('[EmailService] Failed to persist error record:', persistError.message);
      }

      results.push({
        index: i,
        success: false,
        error: error.message,
        to: emailConfig.to,
      });
    }

    // Rate limiting delay between sends
    if (i < emails.length - 1 && delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  const successCount = results.filter(r => r.success).length;

  return {
    total: emails.length,
    success: successCount,
    failed: emails.length - successCount,
    results,
  };
}

// ============================================
// Campaign-Driven Send (D03: ASYNC via Queue)
// ============================================

/**
 * Execute a campaign send — ASYNC (non-blocking).
 *
 * Flow:
 *   1. Validate campaign + resolve target clients
 *   2. Create email records in DB with QUEUED status
 *   3. Enqueue all jobs into EmailQueue
 *   4. Return immediately — Worker processes in background
 *   5. Frontend polls SSE for real-time progress
 *
 * @param {string} userId
 * @param {string} campaignId
 * @param {object} options - { clientIds, priority, delayUntil }
 * @returns {Promise<object>} { campaignId, totalEnqueued, queuedJobIds }
 */
async function sendCampaign(userId, campaignId, options = {}) {
  const campaign = await db.Campaign.findOne({ where: { id: campaignId, userId } });
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { code: 'CAMPAIGN_NOT_FOUND' });

  // Resolve target clients
  let clientIds = options.clientIds;
  if (!clientIds && campaign.targetSegment) {
    const segmentWhere = { userId };
    if (campaign.targetSegment.statuses) {
      const { Op } = require('sequelize');
      segmentWhere.status = { [Op.in]: campaign.targetSegment.statuses };
    }
    if (campaign.targetSegment.tags) {
      const { Op } = require('sequelize');
      segmentWhere.tags = { [Op.overlap]: campaign.targetSegment.tags };
    }
    const clients = await db.Client.findAll({ where: segmentWhere, attributes: ['id'] });
    clientIds = clients.map(c => c.id);
  }

  if (!clientIds || clientIds.length === 0) {
    throw Object.assign(new Error('No target clients found'), { code: 'NO_TARGETS' });
  }

  // Update campaign status to SENDING
  await campaign.update({ status: 'SENDING', startedAt: new Date() });

  // Get user info for template context
  const user = await db.User.findByPk(userId, { attributes: ['id', 'name', 'email'] });

  // Enqueue all jobs
  const jobIds = [];

  for (const clientId of clientIds) {
    const client = await db.Client.findByPk(clientId);
    if (!client) continue;

    // Build template render context
    let subjectHtml, bodyHtml;

    if (templateEngine && campaign.subjectTemplate) {
      // Use Handlebars template engine for rendering
      const ctx = templateEngine.buildContext(
        { ...client.toJSON(), customFields: client.customFields || {} },
        user?.toJSON ? user.toJSON() : user,
        campaign.toJSON(),
        options.templateVars || {}
      );
      subjectHtml = templateEngine.render(campaign.subjectTemplate, ctx);
      bodyHtml = templateEngine.render(campaign.bodyTemplate || '', ctx);
    } else {
      // Fallback: simple regex replacement (legacy D02 behavior)
      subjectHtml = _renderTemplate(campaign.subjectTemplate, client);
      bodyHtml = _renderTemplate(campaign.bodyTemplate || '', client);
    }

    // Create DB email record in QUEUED status
    const emailRecord = await db.Email.create({
      userId,
      campaignId,
      clientId,
      accountId: null, // Worker will assign when sending
      toAddress: client.email,
      fromAddress: '',
      subject: subjectHtml,
      bodyHtml: bodyHtml || null,
      bodyText: bodyHtml ? _htmlToPlainText(bodyHtml) : '',
      status: 'QUEUED',
    });

    // Enqueue into EmailQueue (or create directly if no queue)
    if (emailQueue) {
      const jobId = emailQueue.enqueue({
        type: 'send_email',
        userId,
        campaignId,
        clientId,
        emailId: emailRecord.id,
        emailData: {
          to: [client.email],
          subject: subjectHtml,
          html: bodyHtml,
          from: user?.email || '',
          campaignId,
          clientId,
          accountId: options.accountId || null,
          // Pass template context for worker-level rendering fallback
          _templateContext: templateEngine ? templateEngine.buildContext(
            { ...client.toJSON(), customFields: client.customFields || {} },
            user?.toJSON ? user.toJSON() : user,
            campaign.toJSON(),
            options.templateVars || {}
          ) : undefined,
          subjectTemplate: campaign.subjectTemplate,
          bodyTemplate: campaign.bodyTemplate,
        },
        priority: options.priority || 'normal',
        delayUntil: options.delayUntil || null,
        metadata: { source: 'campaign' },
      });
      jobIds.push(jobId);
    } else {
      // No queue available — store as pending for sync fallback
      jobIds.push(emailRecord.id);
    }
  }

  console.log(`[EmailService] Campaign ${campaignId}: ${jobIds.length} jobs enqueued`);

  return {
    campaignId,
    status: 'QUEUED',
    totalEnqueued: jobIds.length,
    queuedJobIds: jobIds,
    message: `${jobIds.length} emails queued for sending. Use /api/progress/campaign/${campaignId} for real-time progress.`,
  };
}

/**
 * Synchronous campaign send (fallback when no queue available).
 * Used only for single-email or direct sends without queue.
 */
async function sendCampaignSync(userId, campaignId, options = {}) {
  const campaign = await db.Campaign.findOne({ where: { id: campaignId, userId } });
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { code: 'CAMPAIGN_NOT_FOUND' });

  let clientIds = options.clientIds;
  if (!clientIds && campaign.targetSegment) {
    const segmentWhere = { userId };
    if (campaign.targetSegment.statuses) {
      const { Op } = require('sequelize');
      segmentWhere.status = { [Op.in]: campaign.targetSegment.statuses };
    }
    if (campaign.targetSegment.tags) {
      const { Op } = require('sequelize');
      segmentWhere.tags = { [Op.overlap]: campaign.targetSegment.tags };
    }
    const clients = await db.Client.findAll({ where: segmentWhere, attributes: ['id'] });
    clientIds = clients.map(c => c.id);
  }

  if (!clientIds || clientIds.length === 0) {
    throw Object.assign(new Error('No target clients found'), { code: 'NO_TARGETS' });
  }

  await campaign.update({ status: 'SENDING', startedAt: new Date() });
  const user = await db.User.findByPk(userId, { attributes: ['name', 'email'] });
  const emailJobs = [];
  const processResults = [];

  for (const clientId of clientIds) {
    const client = await db.Client.findByPk(clientId);
    if (!client) continue;

    const ctx = templateEngine
      ? templateEngine.buildContext(client.toJSON(), user?.toJSON() || {}, campaign.toJSON())
      : null;
    const subject = templateEngine
      ? templateEngine.render(campaign.subjectTemplate, ctx)
      : _renderTemplate(campaign.subjectTemplate, client);
    const bodyHtml = templateEngine
      ? templateEngine.render(campaign.bodyTemplate || '', ctx)
      : _renderTemplate(campaign.bodyTemplate || '', client);

    const emailRecord = await db.Email.create({
      userId, campaignId, clientId, toAddress: client.email,
      fromAddress: '', subject, bodyHtml,
      bodyText: _htmlToPlainText(bodyHtml), status: 'QUEUED',
    });
    emailJobs.push({ emailId: emailRecord.id, clientId, to: client.email, subject, html: bodyHtml });
  }

  for (const job of emailJobs) {
    try {
      const result = await sendEmail(userId, {
        to: [job.to], subject: job.subject, html: job.html,
        campaignId, clientId: job.clientId,
      });
      await db.Email.update({
        status: result.success ? 'SENT' : 'FAILED',
        accountId: result.accountId, fromAddress: result.fromAddress || '',
        sentAt: result.success ? new Date() : null,
        errorMessage: result.success ? null : result.error,
        providerMessageId: result.messageId || null,
      }, { where: { id: job.emailId } });
      processResults.push({ emailId: job.emailId, success: !!result.success });
    } catch (e) {
      await db.Email.update({ status: 'FAILED', errorMessage: e.message }, { where: { id: job.emailId } });
      processResults.push({ emailId: job.emailId, success: false, error: e.message });
    }
  }

  const sentCount = processResults.filter(r => r.success).length;
  await campaign.update({
    status: 'COMPLETED', completedAt: new Date(),
    stats: { total: emailJobs.length, sent: sentCount, failed: emailJobs.length - sentCount, completedAt: new Date().toISOString() },
  });

  return { campaignId, total: emailJobs.length, sent: sentCount, failed: emailJobs.length - sentCount, results: processResults };
}

// ============================================
// Query Operations
// ============================================

/**
 * Get paginated list of email records.
 */
async function listEmails(userId, filters = {}) {
  const { page = 1, limit = 20, status, campaignId, accountId, sortBy = 'createdAt', sortOrder = 'DESC' } = filters;
  const offset = (Number(page) - 1) * Number(limit);
  const { Op } = require('sequelize');
  const where = { userId };

  if (status) where.status = status.toUpperCase();
  if (campaignId) where.campaignId = campaignId;
  if (accountId) where.accountId = accountId;

  const { count, rows } = await db.Email.findAndCountAll({
    where,
    offset,
    limit: Number(limit),
    order: [[sortBy, sortOrder]],
    include: [
      { model: db.Client, as: 'client', attributes: ['id', 'email', 'firstName', 'lastName', 'company'] },
      { model: db.EmailAccount, as: 'account', attributes: ['id', 'email', 'platform'] },
      { model: db.Campaign, as: 'campaign', attributes: ['id', 'name', 'type'] },
    ],
  });

  return {
    data: rows,
    pagination: { page: Number(page), limit: Number(limit), total: count, pages: Math.ceil(count / Number(limit)) },
  };
}

/**
 * Get a single email record with full details.
 */
async function getEmail(emailId, userId) {
  const email = await db.Email.findOne({
    where: { id: emailId, userId },
    include: [
      { model: db.Client, as: 'client' },
      { model: db.EmailAccount, as: 'account', attributes: { exclude: ['passwordEncrypted'] } },
      { model: db.Campaign, as: 'campaign' },
    ],
  });
  return email;
}

/**
 * Get aggregate statistics for emails.
 */
async function getEmailStats(userId, dateRange = {}) {
  const { Op } = require('sequelize');
  const where = { userId };

  if (dateRange.from || dateRange.to) {
    where.createdAt = {};
    if (dateRange.from) where.createdAt[Op.gte] = new Date(dateRange.from);
    if (dateRange.to) where.createdAt[Op.lte] = new Date(dateRange.to);
  }

  const [total, byStatus, sentToday] = await Promise.all([
    db.Email.count({ where }),
    db.Email.findAll({
      where,
      attributes: ['status', [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']],
      group: ['status'],
      raw: true,
    }),
    db.Email.count({
      where: {
        userId,
        status: 'SENT',
        createdAt: { [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
  ]);

  return {
    total,
    byStatus: byStatus.reduce((acc, row) => ({ ...acc, [row.status.toLowerCase()]: parseInt(row.count) }), {}),
    sentToday,
  };
}

// ============================================
// Validation & Formatting Utilities
// ============================================

/**
 * Validate an email object using M8 EmailFormatter.
 */
function validateEmail(rawEmail) {
  if (!emailFormatter) {
    return { valid: true, errors: [], warnings: ['Engine validator not available, basic validation only'] };
  }

  return emailFormatter.validateEmail(rawEmail);
}

/**
 * Format/preview an email for a specific platform.
 */
function formatForPreview(rawEmail, platform = 'gmail') {
  if (!emailFormatter) {
    return { ...rawEmail, warning: 'Formatter not available' };
  }

  return emailFormatter.formatEmail(rawEmail, platform);
}

/**
 * Generate plain text from HTML.
 */
function generatePlainText(html) {
  if (!emailFormatter) {
    return html ? html.replace(/<[^>]+>/g, '') : '';
  }

  return emailFormatter.generatePlainText(html);
}

// ============================================
// Internal: Send Implementations
// ============================================

/**
 * Send using M7 FailoverManager (automatic retry + account selection).
 */
async function _sendWithFailover(formattedEmail, preferences) {
  try {
    const result = await failoverManager.executeWithFailover(async (account) => {
      return await account.platformInstance.send(formattedEmail);
    }, preferences);

    return {
      success: true,
      messageId: result.messageId,
      accountId: result.accountId || null,
      platform: result.platform || preferences.requiredPlatform,
      response: result.response,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      accountId: null,
      platform: preferences.requiredPlatform,
    };
  }
}

/**
 * Send using a specific account ID via M7 engine.
 */
async function _sendWithAccount(accountId, formattedEmail, userId) {
  if (!poolManager) {
    throw new Error('AccountPoolManager not available');
  }

  const account = poolManager.getAccount(accountId);
  if (!account) {
    throw Object.assign(new Error(`Account ${accountId} not found in engine`), { code: 'ACCOUNT_NOT_IN_ENGINE' });
  }

  if (account.status !== 'active') {
    throw Object.assign(new Error(`Account ${accountId} is not active (current: ${account.status})`), { code: 'ACCOUNT_INACTIVE' });
  }

  try {
    const result = await account.platformInstance.send(formattedEmail);

    // Update usage stats
    account.usageStats.sentToday++;
    account.lastUsed = new Date();

    return {
      success: true,
      messageId: result.messageId,
      accountId: account.id,
      platform: account.platform,
      response: result.response,
    };
  } catch (error) {
    account.lastError = error.message;
    throw error;
  }
}

/**
 * Direct send fallback when M8 engine is unavailable.
 */
async function _sendDirect(formattedEmail, platform) {
  const nodemailer = require('nodemailer');

  // For direct send, we need SMTP credentials from somewhere
  // This path is only used as last resort fallback
  console.warn('[EmailService] Using direct send fallback (no engine)');

  // Return a simulated result - in production this would use configured SMTP
  return {
    success: false,
    error: 'No active accounts available for sending. Please add and activate an email account.',
    accountId: null,
    platform,
  };
}

// ============================================
// Internal: Template Rendering
// ============================================

function _renderTemplate(template, client) {
  if (!template) return '';

  return template
    .replace(/\{\{client\.name\}\}/g, `${client.firstName || ''} ${client.lastName || ''}`.trim())
    .replace(/\{\{client\.firstName\}\}/g, client.firstName || '')
    .replace(/\{\{client\.lastName\}\}/g, client.lastName || '')
    .replace(/\{\{client\.email\}\}/g, client.email || '')
    .replace(/\{\{client\.company\}\}/g, client.company || '')
    .replace(/\{\{client\.country\}\}/g, client.country || '');
}

function _htmlToPlainText(html) {
  if (!html) return '';
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

module.exports = {
  sendEmail,
  sendBatch,
  sendCampaign,        // D03: Async (queues jobs, returns immediately)
  sendCampaignSync,    // D03: Sync fallback (blocks until all sent)
  listEmails,
  getEmail,
  getEmailStats,
  validateEmail,
  formatForPreview,
  generatePlainText,

  // D03: Queue injection (called by server.js on startup)
  setQueue(queueInstance) { emailQueue = queueInstance; },

  // Expose engine instances
  get failoverManager() { return failoverManager; },
  get emailFormatter() { return emailFormatter; },
  get templateEngine() { return templateEngine; },
};
