/**
 * Send Worker (D03)
 *
 * Background job processor that consumes the EmailQueue.
 * Each worker instance runs a processing loop:
 *   1. Dequeue next available job from EmailQueue
 *   2. Render email content via TemplateEngine
 *   3. Call emailService.sendEmail() for actual sending
 *   4. Update DB record with result
 *   5. Report back to queue (complete/fail)
 *   6. Emit progress events for SSE subscribers
 *
 * Can run as:
 *   - In-process (default): Started with server, processes jobs in background
 *   - Separate process: For production scaling (via PM2/cluster)
 */

const EmailQueue = require('../queue/emailQueue');
const db = require('../db');

class SendWorker {
  constructor(options = {}) {
    this.queue = options.queue;                    // EmailQueue instance
    this.emailService = options.emailService;      // emailService module
    this.templateEngine = options.templateEngine;  // TemplateEngine instance
    this.pollInterval = options.pollInterval || 500; // ms between dequeue attempts
    this.processing = false;                       // Worker active flag
    this.jobCount = { processed: 0, succeeded: 0, failed: 0 };

    // Bind handlers
    this._processNext = this._processNext.bind(this);
    this._handleJob = this._handleJob.bind(this);

    console.log(`[SendWorker] Initialized (pollInterval=${this.pollInterval}ms)`);
  }

  /**
   * Start the processing loop.
   */
  start() {
    if (this.processing) return;
    this.processing = true;
    this._loop();
    console.log('[SendWorker] Processing loop started');
    return this;
  }

  /**
   * Stop the processing loop gracefully.
   */
  async stop() {
    this.processing = false;
    console.log('[SendWorker] Stopping...');
    // Wait for current job to finish
    await new Promise(r => setTimeout(r, 1000));
    console.log('[SendWorker] Stopped.', this.jobCount);
    return this.jobCount;
  }

  /**
   * Main processing loop.
   */
  async _loop() {
    while (this.processing) {
      try {
        const hasJob = await this._processNext();
        if (!hasJob) {
          // No job available — wait before polling again
          await new Promise(r => setTimeout(r, this.pollInterval));
        }
      } catch (error) {
        console.error('[SendWorker] Loop error:', error.message);
        await new Promise(r => setTimeout(r, 1000)); // Back off on error
      }
    }
  }

  /**
   * Process one job from the queue.
   * @returns {boolean} Whether a job was processed
   */
  async _processNext() {
    const job = this.queue.dequeue();
    if (!job) return false;

    try {
      await this._handleJob(job);
      this.jobCount.processed++;
      return true;
    } catch (error) {
      console.error(`[SendWorker] Job ${job.id} handler error:`, error.message);
      this.queue.fail(job.id, error);
      this.jobCount.failed++;
      return true;
    }
  }

  /**
   * Handle a single send job end-to-end.
   */
  async _handleJob(job) {
    const startTime = Date.now();

    console.log(`[SendWorker] Processing job ${job.id} (${job.type}) for campaign ${job.campaignId || 'direct'}`);

    switch (job.type) {
      case 'send_email':
        await this._sendEmailJob(job);
        break;
      case 'test_connection':
        await this._testConnectionJob(job);
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    const duration = Date.now() - startTime;
    console.log(`[SendWorker] Job ${job.id} completed in ${duration}ms`);
  }

  /**
   * Process a send_email job.
   */
  async _sendEmailJob(job) {
    let sendResult;

    try {
      // Step 1: If we have template context, render via TemplateEngine
      let emailData = { ...job.emailData };

      if (emailData._templateContext && this.templateEngine) {
        const ctx = emailData._templateContext;
        if (emailData.subjectTemplate) {
          emailData.subject = this.templateEngine.render(emailData.subjectTemplate, ctx);
        }
        if (emailData.bodyTemplate) {
          emailData.html = this.templateEngine.render(emailData.bodyTemplate, ctx);
          emailData.text = this.templateEngine.render(emailData.bodyTemplate, ctx); // Will be stripped to plain text by formatter
        }
      }

      // Step 2: Call emailService for actual sending
      sendResult = await this.emailService.sendEmail(job.userId, emailData);

      // Step 3: Update DB email record
      if (job.emailId) {
        await db.Email.update(
          {
            status: sendResult.success ? 'SENT' : 'FAILED',
            accountId: sendResult.accountId || null,
            fromAddress: sendResult.fromAddress || emailData.from || '',
            sentAt: sendResult.success ? new Date() : null,
            errorMessage: sendResult.success ? null : (sendResult.error || null),
            providerMessageId: sendResult.messageId || null,
          },
          { where: { id: job.emailId } }
        );
      }

      // Step 4: Mark job complete
      this.queue.complete(job.id, {
        success: sendResult.success,
        messageId: sendResult.messageId,
        emailId: job.emailId,
        accountId: sendResult.accountId,
        platform: sendResult.platform,
        duration: Date.now() - new Date(job.startedAt).getTime(),
      });

      this.jobCount.succeeded++;

    } catch (error) {
      console.error(`[SendWorker] Send failed for job ${job.id}:`, error.message);

      // Update DB on failure
      if (job.emailId) {
        try {
          await db.Email.update(
            { status: 'FAILED', errorMessage: error.message },
            { where: { id: job.emailId } }
          );
        } catch (_) {}
      }

      this.queue.fail(job.id, error);
      this.jobCount.failed++;
    }
  }

  /**
   * Process a test_connection job.
   */
  async _testConnectionJob(job) {
    try {
      const accountService = require('./accountService');
      const result = await accountService.testConnection(job.emailData.accountId, job.userId);
      this.queue.complete(job.id, { success: result.connected, ...result });
      this.jobCount.succeeded++;
    } catch (error) {
      this.queue.fail(job.id, error);
      this.jobCount.failed++;
    }
  }

  /**
   * Get current worker statistics.
   */
  getStats() {
    return {
      ...this.jobCount,
      running: this.processing,
      queueStats: this.queue.getStats(),
    };
  }
}

module.exports = SendWorker;
