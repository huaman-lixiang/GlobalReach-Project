/**
 * Email Send Queue (D03)
 *
 * In-memory priority queue system for email campaign jobs.
 * Features:
 *   - Priority levels (urgent, high, normal, low)
 *   - Retry with exponential backoff
 *   - Delayed scheduling (send later)
 *   - Concurrency control (max concurrent sends per account)
 *   - Rate limiting per account
 *   - Job lifecycle: queued → processing → completed/failed/retried
 *   - Event emission for progress tracking (SSE)
 */

const EventEmitter = require('events');

class EmailQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxConcurrency = options.maxConcurrency || 5;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 5000; // base delay in ms
    this.rateLimitPerSecond = options.rateLimitPerSecond || 3; // max sends/sec/account

    // Queue storage
    this.jobs = new Map();           // jobId → job object
    this.pending = [];               // jobs waiting to be processed (priority sorted)
    this.processing = new Set();     // jobs currently being processed
    this.completed = new Map();      // completed job results (for progress queries)
    this.campaignJobs = new Map();   // campaignId → [jobIds]

    // Concurrency tracking per account
    this.accountSendingCount = new Map();  // accountId → current send count
    this.accountLastSend = new Map();      // accountId → last send timestamp

    // Statistics
    this.stats = {
      totalEnqueued: 0,
      totalProcessed: 0,
      totalSucceeded: 0,
      totalFailed: 0,
      totalRetried: 0,
    };

    // Active flag for graceful shutdown
    this.active = true;

    console.log(`[EmailQueue] Initialized (concurrency=${this.maxConcurrency}, maxRetries=${this.maxRetries})`);
  }

  // ============================================
  // Job Enqueue
  // ============================================

  /**
   * Add a job to the queue.
   * @param {object} jobData - { type, userId, campaignId, clientId, emailData, priority, delayUntil, ... }
   * @returns {string} jobId
   */
  enqueue(jobData) {
    const jobId = jobData.id || `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const job = {
      id: jobId,
      type: jobData.type || 'send_email',       // send_email | test_connection | etc.
      userId: jobData.userId,
      campaignId: jobData.campaignId || null,
      clientId: jobData.clientId || null,
      emailId: jobData.emailId || null,          // DB email record ID
      emailData: jobData.emailData || {},        // { to, subject, html, text, from, ... }
      priority: this._normalizePriority(jobData.priority),
      retryCount: 0,
      maxRetries: jobData.maxRetries || this.maxRetries,

      // Timestamps
      createdAt: new Date(),
      scheduledAt: jobData.delayUntil ? new Date(jobData.delayUntil) : new Date(),
      startedAt: null,
      completedAt: null,

      // State
      status: jobData.delayUntil ? 'delayed' : 'queued', // queued|delayed|processing|completed|failed|cancelled

      // Result
      result: null,
      error: null,

      // Metadata
      metadata: jobData.metadata || {},
    };

    this.jobs.set(jobId, job);
    this.stats.totalEnqueued++;

    // Track by campaign
    if (job.campaignId) {
      if (!this.campaignJobs.has(job.campaignId)) {
        this.campaignJobs.set(job.campaignId, []);
      }
      this.campaignJobs.get(job.campaignId).push(jobId);
    }

    if (job.status === 'queued') {
      this._insertSorted(job);
    }

    this.emit('enqueued', job);

    console.log(`[EmailQueue] Job ${jobId} enqueued (priority=${job.priority}, campaign=${job.campaignId || 'none'})`);

    return jobId;
  }

  /**
   * Bulk enqueue multiple jobs (for campaigns).
   * @param {Array} jobs - Array of jobData objects
   * @returns {string[]} Array of jobIds
   */
  enqueueBatch(jobs) {
    return jobs.map(j => this.enqueue(j));
  }

  // ============================================
  // Job Dequeue (called by Worker)
  // ============================================

  /**
   * Get next available job for processing.
   * Respects concurrency limits and rate limiting.
   * @returns {object|null} Next job or null if none available
   */
  dequeue() {
    if (!this.active) return null;

    // Check delayed jobs that are now ready
    this._promoteDelayedJobs();

    // Respect concurrency limit
    if (this.processing.size >= this.maxConcurrency) {
      return null; // At capacity
    }

    // Find first job whose account isn't rate-limited
    while (this.pending.length > 0) {
      const job = this.pending.shift();
      
      if (!this.jobs.has(job.id)) continue; // Job was cancelled

      // Account-level rate limiting check
      const accountId = job.emailData.accountId;
      if (accountId && this._isRateLimited(accountId)) {
        // Put back at front of queue (will be retried on next dequeue)
        this.pending.unshift(job);
        return null; // Signal worker to wait
      }

      // Mark as processing
      job.status = 'processing';
      job.startedAt = new Date();
      this.processing.add(job.id);

      if (accountId) {
        this.accountSendingCount.set(accountId, (this.accountSendingCount.get(accountId) || 0) + 1);
        this.accountLastSend.set(accountId, Date.now());
      }

      this.emit('started', job);
      return job;
    }

    return null; // No jobs available
  }

  // ============================================
  // Job Completion
  // ============================================

  /**
   * Mark a job as successfully completed.
   * @param {string} jobId
   * @param {object} result - Send result data
   */
  complete(jobId, result = {}) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'completed';
    job.completedAt = new Date();
    job.result = result;
    this.processing.delete(jobId);
    this.completed.set(jobId, job);

    // Release account concurrency slot
    const accountId = job.emailData?.accountId;
    if (accountId) {
      this.accountSendingCount.set(accountId, Math.max(0, (this.accountSendingCount.get(accountId) || 1) - 1));
    }

    this.stats.totalProcessed++;
    this.stats.totalSucceeded++;

    this.emit('completed', job);
    this._checkCampaignCompletion(job.campaignId);
  }

  /**
   * Mark a job as failed (with optional retry).
   * @param {string} jobId
   * @param {Error|string} error
   */
  fail(jobId, error) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const errMsg = typeof error === 'string' ? error : (error?.message || 'Unknown error');
    job.error = errMsg;
    this.processing.delete(jobId);

    // Release account concurrency slot
    const accountId = job.emailData?.accountId;
    if (accountId) {
      this.accountSendingCount.set(accountId, Math.max(0, (this.accountSendingCount.get(accountId) || 1) - 1));
    }

    // Retry logic
    if (job.retryCount < job.maxRetries) {
      job.retryCount++;
      job.status = 'queued';
      job.scheduledAt = new Date(Date.now() + this.retryDelay * Math.pow(2, job.retryCount)); // Exponential backoff

      // Re-insert into queue with same priority but after delay
      setTimeout(() => {
        if (job.status === 'queued' && this.jobs.has(job.id)) {
          this._insertSorted(job);
          this.emit('retry', job);
        }
      }, this.retryDelay * Math.pow(2, job.retryCount));

      this.stats.totalRetried++;
      console.log(`[EmailQueue] Job ${jobId} failed (attempt ${job.retryCount}/${job.maxRetries}), retrying...`);
    } else {
      // Max retries exhausted
      job.status = 'failed';
      job.completedAt = new Date();
      this.completed.set(jobId, job);
      this.stats.totalProcessed++;
      this.stats.totalFailed++;

      console.error(`[EmailQueue] Job ${jobId} FAILED permanently: ${errMsg}`);
      this.emit('failed', job);
      this._checkCampaignCompletion(job.campaignId);
    }
  }

  // ============================================
  // Query Methods
  // ============================================

  /**
   * Get status of a specific job.
   */
  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Get all jobs for a campaign with summary stats.
   */
  getCampaignProgress(campaignId) {
    const jobIds = this.campaignJobs.get(campaignId) || [];
    const jobs = jobIds.map(id => this.jobs.get(id)).filter(Boolean);

    const total = jobs.length;
    const queued = jobs.filter(j => j.status === 'queued').length;
    const delayed = jobs.filter(j => j.status === 'delayed').length;
    const processing = jobs.filter(j => j.status === 'processing').length;
    const completed = jobs.filter(j => j.status === 'completed').length;
    const failed = jobs.filter(j => j.status === 'failed').length;
    const succeeded = jobs.filter(j => j.status === 'completed' && j.result?.success).length;

    return {
      campaignId,
      total,
      queued,
      delayed,
      processing,
      completed,
      failed,
      succeeded,
      percentage: total > 0 ? Math.round(((completed + failed) / total) * 100) : 0,
      jobs: jobs.map(j => ({
        id: j.id,
        status: j.status,
        retryCount: j.retryCount,
        result: j.result ? { success: j.result.success, messageId: j.result.messageId } : null,
        error: j.error,
      })),
    };
  }

  /**
   * Get overall queue statistics.
   */
  getStats() {
    return {
      ...this.stats,
      pending: this.pending.length,
      processing: this.processing.size,
      activeCampaigns: this.campaignJobs.size,
    };
  }

  /**
   * Cancel a pending/delayed job.
   */
  cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || !['queued', 'delayed'].includes(job.status)) return false;

    job.status = 'cancelled';
    this.pending = this.pending.filter(j => j.id !== jobId);
    this.jobs.delete(jobId);
    
    // Remove from campaign tracking
    if (job.campaignId) {
      const ids = this.campaignJobs.get(job.campaignId) || [];
      const idx = ids.indexOf(jobId);
      if (idx > -1) ids.splice(idx, 1);
    }

    this.emit('cancelled', { id: jobId });
    return true;
  }

  /**
   * Cancel all pending jobs for a campaign.
   */
  cancelCampaign(campaignId) {
    const jobIds = this.campaignJobs.get(campaignId) || [];
    let cancelled = 0;
    for (const jobId of jobIds) {
      if (this.cancelJob(jobId)) cancelled++;
    }
    return cancelled;
  }

  // ============================================
  // Lifecycle
  // ============================================

  /**
   * Graceful shutdown: stop accepting new jobs, wait for processing to finish.
   */
  async shutdown(timeoutMs = 30000) {
    this.active = false;
    console.log('[EmailQueue] Shutdown initiated. Waiting for processing jobs to complete...');

    const start = Date.now();
    while (this.processing.size > 0 && (Date.now() - start) < timeoutMs) {
      await new Promise(r => setTimeout(r, 500));
    }

    const remaining = this.processing.size;
    if (remaining > 0) {
      console.warn(`[EmailQueue] Force shutdown with ${remaining} jobs still processing`);
    }

    console.log(`[EmailQueue] Shutdown complete. Stats:`, this.getStats());
    return remaining;
  }

  // ============================================
  // Internal Helpers
  // ============================================

  _normalizePriority(priority) {
    const map = { urgent: 0, high: 1, normal: 2, low: 3 };
    return map[priority] !== undefined ? map[priority] : 2; // default: normal
  }

  _insertSorted(job) {
    // Insert maintaining priority order (lower number = higher priority)
    let inserted = false;
    for (let i = 0; i < this.pending.length; i++) {
      if (job.priority < this.pending[i].priority) {
        this.pending.splice(i, 0, job);
        inserted = true;
        break;
      }
    }
    if (!inserted) this.pending.push(job);
  }

  _promoteDelayedJobs() {
    const now = new Date();
    const ready = [];
    const stillDelayed = [];

    for (const job of this.pending) {
      if (job.status === 'delayed' && job.scheduledAt <= now) {
        job.status = 'queued';
        ready.push(job);
      } else {
        stillDelayed.push(job);
      }
    }

    if (ready.length > 0) {
      this.pending = stillDelayed;
      ready.forEach(j => this._insertSorted(j));
    }
  }

  _isRateLimited(accountId) {
    const lastSend = this.accountLastSend.get(accountId) || 0;
    const elapsed = Date.now() - lastSend;
    const minInterval = 1000 / this.rateLimitPerSecond; // ms between sends
    return elapsed < minInterval;
  }

  _checkCampaignCompletion(campaignId) {
    if (!campaignId) return;

    const progress = this.getCampaignProgress(campaignId);
    if (progress.total > 0 && (progress.completed + progress.failed) >= progress.total) {
      this.emit('campaignComplete', {
        campaignId,
        ...progress,
        completedAt: new Date(),
      });
    }
  }
}

module.exports = EmailQueue;
