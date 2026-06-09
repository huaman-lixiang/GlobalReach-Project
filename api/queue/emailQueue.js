/**
 * Email Send Queue (D03) - M-A04 Deep Optimization
 *
 * Enhanced in-memory priority queue system for email campaign jobs.
 * Features:
 *   - Priority levels (urgent=0, high=1, normal=2, low=3)
 *   - Retry with exponential backoff
 *   - Delayed scheduling (send later)
 *   - Concurrency control (max concurrent sends per account)
 *   - Rate limiting per account + global ISP protection
 *   - Dead Letter Queue (DLQ) for failed jobs
 *   - Dynamic concurrency adjustment based on queue depth
 *   - Batch DB write buffer for performance
 *   - Prometheus metrics & observability
 *   - Slow job detection (>30s warning)
 *   - Memory pressure protection (>80% heap)
 *   - Stalled job detection & recovery (>5min auto-fail)
 *   - Graceful shutdown with timeout
 *   - Job lifecycle: queued → processing → completed/failed/retried/DLQ
 */

const EventEmitter = require('events');

// M-A04: Prometheus metrics
let promClient;
try {
  promClient = require('prom-client');
  // Create registry for queue metrics
  const queueRegistry = new promClient.Registry();

  // Define metrics
  const queueDepthGauge = new promClient.Gauge({
    name: 'email_queue_depth',
    help: 'Number of jobs in each queue state',
    labelNames: ['status'],
    registers: [queueRegistry],
  });

  const jobsProcessedCounter = new promClient.Counter({
    name: 'email_queue_jobs_processed_total',
    help: 'Total number of jobs processed',
    labelNames: ['status'],
    registers: [queueRegistry],
  });

  const jobDurationHistogram = new promClient.Histogram({
    name: 'email_queue_job_duration_seconds',
    help: 'Job processing duration in seconds',
    labelNames: ['priority', 'type'],
    buckets: [1, 5, 10, 15, 20, 30, 60, 120, 300],
    registers: [queueRegistry],
  });

  const throughputGauge = new promClient.Gauge({
    name: 'email_queue_throughput_per_second',
    help: 'Jobs processed per second (rolling 60s window)',
    registers: [queueRegistry],
  });

  // Export metrics endpoint helper
  async function getMetrics() {
    return queueRegistry.metrics();
  }
} catch (e) {
  console.warn('[EmailQueue/M-A04] Prometheus not available, metrics disabled');
}

class EmailQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxConcurrency = options.maxConcurrency || 5;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 5000; // base delay in ms
    this.rateLimitPerSecond = options.rateLimitPerSecond || 3; // max sends/sec/account

    // M-A04: Global rate limiter (ISP protection)
    this.globalRateLimit = {
      max: parseInt(process.env.GLOBAL_SEND_RATE_MAX || '20'),      // 20 emails/min
      duration: parseInt(process.env.GLOBAL_SEND_RATE_DURATION_MS || '60000'), // 1 minute window
      sends: [],  // timestamps of recent sends
    };

    // M-A04: Dynamic concurrency settings
    this.dynamicConcurrency = {
      enabled: process.env.DYNAMIC_CONCURRENCY !== 'false',
      minConcurrency: parseInt(process.env.MIN_CONCURRENCY || '2'),
      maxConcurrency: parseInt(process.env.MAX_CONCURRENCY || '10'),
      scaleFactor: parseFloat(process.env.CONCURRENCY_SCALE_FACTOR || '1.5'),
      checkInterval: parseInt(process.env.CONCURRENCY_CHECK_INTERVAL_MS || '10000'),
      lastCheck: Date.now(),
    };

    // M-A04: Batch write buffer for DB updates
    this.batchBuffer = {
      maxSize: parseInt(process.env.BATCH_BUFFER_SIZE || '100'),
      flushInterval: parseInt(process.env.BATCH_FLUSH_INTERVAL_MS || '5000'),
      buffer: [],
      flushTimer: null,
      lastFlush: Date.now(),
    };

    // M-A04: Memory pressure protection
    this.memoryProtection = {
      enabled: true,
      heapThreshold: parseFloat(process.env.HEAP_THRESHOLD_PERCENT || '0.8'), // 80%
      checkInterval: parseInt(process.env.MEMORY_CHECK_INTERVAL_MS || '5000'),
      underPressure: false,
    };

    // M-A04: Stalled job detection
    this.stalledDetection = {
      enabled: true,
      stallTimeout: parseInt(process.env.STALL_TIMEOUT_MS || '300000'), // 5 minutes
      checkInterval: parseInt(process.env.STALL_CHECK_INTERVAL_MS || '30000'), // 30 seconds
      lastCheck: Date.now(),
    };

    // M-A04: Slow job detection
    this.slowJobThreshold = parseInt(process.env.SLOW_JOB_THRESHOLD_MS || '30000'); // 30 seconds

    // M-A04: Throughput tracking (rolling 60s window)
    this.throughputTracker = {
      window: 60000, // 60 seconds
      completions: [], // timestamps of recent completions
    };

    // Queue storage
    this.jobs = new Map();           // jobId → job object
    this.pending = [];               // jobs waiting to be processed (priority sorted)
    this.processing = new Set();     // jobs currently being processed
    this.completed = new Map();      // completed job results (for progress queries)
    this.deadLetterQueue = [];       // M-A04: DLQ for permanently failed jobs
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
      totalDLQ: 0,          // M-A04: DLQ count
      totalStalledRecovered: 0, // M-A04: Stalled recovery count
    };

    // Active flag for graceful shutdown
    this.active = true;

    // M-A04: Start background tasks
    this._startBatchFlushTimer();
    this._startMemoryMonitor();
    this._startStalledDetector();
    this._startDynamicConcurrencyAdjuster();

    console.log(`[EmailQueue/M-A04] Initialized (concurrency=${this.maxConcurrency}, maxRetries=${this.maxRetries}, globalRateLimit=${this.globalRateLimit.max}/${this.globalRateLimit.duration}ms)`);
  }

  // ============================================
  // Job Enqueue
  // ============================================

  /**
   * Add a job to the queue.
   * @param {object} jobData - { type, userId, campaignId, clientId, emailData, priority, delayUntil, ... }
   * @returns {string|null} jobId or null if rejected (memory pressure)
   */
  enqueue(jobData) {
    // M-A04: Memory pressure protection - reject new jobs if heap > 80%
    if (this.memoryProtection.enabled && this._isMemoryUnderPressure()) {
      console.warn('[EmailQueue/M-A04] Memory under pressure, rejecting new job');
      this.emit('memoryPressure', { action: 'reject', heapUsage: process.memoryUsage().heapUsed });
      return null;
    }

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

    // M-A04: Update Prometheus metrics
    this._updateMetrics();

    console.log(`[EmailQueue/M-A04] Job ${jobId} enqueued (priority=${job.priority}, campaign=${job.campaignId || 'none'})`);

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
   * Respects concurrency limits, rate limiting, and memory pressure.
   * @returns {object|null} Next job or null if none available
   */
  dequeue() {
    if (!this.active) return null;

    // M-A04: Memory pressure protection - pause processing if under pressure
    if (this.memoryProtection.enabled && this._isMemoryUnderPressure()) {
      return null;
    }

    // Check delayed jobs that are now ready
    this._promoteDelayedJobs();

    // Respect concurrency limit (dynamic)
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

      // M-A04: Global rate limiter (ISP protection)
      if (this._isGloballyRateLimited()) {
        // Put back at front of queue
        this.pending.unshift(job);
        return null;
      }

      // Mark as processing
      job.status = 'processing';
      job.startedAt = new Date();
      this.processing.add(job.id);

      if (accountId) {
        this.accountSendingCount.set(accountId, (this.accountSendingCount.get(accountId) || 0) + 1);
        this.accountLastSend.set(accountId, Date.now());

        // M-A04: Record in global rate limiter
        this.globalRateLimit.sends.push(Date.now());
      }

      this.emit('started', job);

      // M-A04: Start slow job detection timer for this job
      this._startSlowJobMonitor(job);

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

    const duration = Date.now() - new Date(job.startedAt).getTime();

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

    // M-A04: Add to batch buffer for DB write optimization
    this._addToBatchBuffer({
      action: 'update',
      emailId: job.emailId,
      data: {
        status: 'SENT',
        accountId: result.accountId || null,
        fromAddress: result.fromAddress || job.emailData?.from || '',
        sentAt: new Date(),
        errorMessage: null,
        providerMessageId: result.messageId || null,
      },
    });

    // M-A04: Record throughput
    this._recordThroughput();

    // M-A04: Update Prometheus metrics
    if (typeof queueDepthGauge !== 'undefined') {
      jobsProcessedCounter.inc({ status: 'completed' });
      jobDurationHistogram.observe(
        { priority: ['urgent', 'high', 'normal', 'low'][job.priority] || 'normal', type: job.type },
        duration / 1000
      );
    }

    this.emit('completed', job);
    this._checkCampaignCompletion(job.campaignId);

    // M-A04: Update all metrics
    this._updateMetrics();
  }

  /**
   * Mark a job as failed (with optional retry or DLQ).
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
          // M-A04: Update metrics on retry
          if (typeof jobsProcessedCounter !== 'undefined') {
            jobsProcessedCounter.inc({ status: 'retried' });
          }
        }
      }, this.retryDelay * Math.pow(2, job.retryCount));

      this.stats.totalRetried++;

      // M-A04: Add failed attempt to batch buffer
      this._addToBatchBuffer({
        action: 'update',
        emailId: job.emailId,
        data: {
          status: 'FAILED',
          errorMessage: `[Retry ${job.retryCount}/${job.maxRetries}] ${errMsg}`,
        },
      });

      console.log(`[EmailQueue/M-A04] Job ${jobId} failed (attempt ${job.retryCount}/${job.maxRetries}), retrying...`);
    } else {
      // Max retries exhausted → Move to Dead Letter Queue (DLQ)
      job.status = 'dead_letter';
      job.completedAt = new Date();
      job.dlqReason = `Max retries (${job.maxRetries}) exceeded: ${errMsg}`;
      job.dlqTimestamp = new Date();

      // M-A04: Add to DLQ
      this.deadLetterQueue.push({
        id: job.id,
        type: job.type,
        userId: job.userId,
        campaignId: job.campaignId,
        emailId: job.emailId,
        emailData: job.emailData,
        priority: job.priority,
        retryCount: job.retryCount,
        error: errMsg,
        originalJob: job,
        enqueuedAt: job.dlqTimestamp,
        metadata: job.metadata,
      });

      this.completed.set(jobId, job);
      this.stats.totalProcessed++;
      this.stats.totalFailed++;
      this.stats.totalDLQ++;

      // M-A04: Add final failure to batch buffer
      this._addToBatchBuffer({
        action: 'update',
        emailId: job.emailId,
        data: {
          status: 'FAILED',
          errorMessage: `[DLQ] Max retries exceeded: ${errMsg}`,
        },
      });

      console.error(`[EmailQueue/M-A04] Job ${jobId} moved to DLQ: ${errMsg}`);
      this.emit('failed', job);
      this.emit('dlq', { jobId, reason: job.dlqReason, job }); // M-A04: DLQ event

      // M-A04: Update Prometheus metrics
      if (typeof jobsProcessedCounter !== 'undefined') {
        jobsProcessedCounter.inc({ status: 'failed' });
        jobsProcessedCounter.inc({ status: 'dlq' });
      }

      this._checkCampaignCompletion(job.campaignId);
    }

    // M-A04: Update all metrics
    this._updateMetrics();
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
   * Get overall queue statistics with M-A04 enhancements.
   */
  getStats() {
    return {
      ...this.stats,
      pending: this.pending.length,
      processing: this.processing.size,
      delayed: Array.from(this.jobs.values()).filter(j => j.status === 'delayed').length,
      activeCampaigns: this.campaignJobs.size,
      dlqSize: this.deadLetterQueue.length, // M-A04: DLQ size
      currentConcurrency: this.maxConcurrency, // M-A04: Current dynamic concurrency
      memoryUnderPressure: this.memoryProtection.underPressure, // M-A04: Memory status
      throughput: this._calculateThroughput(), // M-A04: Current throughput
      globalRateLimitUsage: `${this.globalRateLimit.sends.length}/${this.globalRateLimit.max}`, // M-A04: Global rate limit usage
    };
  }

  /**
   * M-A04: Get Dead Letter Queue contents for admin review.
   * @param {{ limit?: number, since?: Date }} options
   * @returns {Array} DLQ entries
   */
  getDeadLetterQueue(options = {}) {
    const { limit = 50, since } = options;
    let dlq = [...this.deadLetterQueue];

    if (since) {
      const sinceTime = new Date(since).getTime();
      dlq = dlq.filter(entry => new Date(entry.enqueuedAt).getTime() >= sinceTime);
    }

    return dlq.slice(-limit); // Return most recent entries first
  }

  /**
   * M-A04: Retry a job from DLQ (manual intervention).
   * @param {string} jobId - Original job ID from DLQ
   * @returns {boolean} Success
   */
  retryFromDLQ(jobId) {
    const dlqIndex = this.deadLetterQueue.findIndex(entry => entry.id === jobId);
    if (dlqIndex === -1) return false;

    const dlqEntry = this.deadLetterQueue[dlqIndex];
    this.deadLetterQueue.splice(dlqIndex, 1);

    // Reset job state and re-enqueue
    const job = dlqEntry.originalJob;
    job.status = 'queued';
    job.retryCount = 0;
    job.error = null;
    job.startedAt = null;
    job.completedAt = null;
    job.result = null;

    this.jobs.set(jobId, job);
    this._insertSorted(job);
    this.stats.totalDLQ--;
    this.stats.totalRetried++;

    console.log(`[EmailQueue/M-A04] Job ${jobId} retried from DLQ`);
    this.emit('dlqRetry', { jobId, job });

    return true;
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
   * M-A04 Enhanced: Flush batch buffer before shutdown
   */
  async shutdown(timeoutMs = 30000) {
    this.active = false;
    console.log('[EmailQueue/M-A04] Shutdown initiated. Flushing batch buffer...');

    // M-A04: Flush remaining batch writes
    await this._flushBatchBuffer();

    console.log('[EmailQueue/M-A04] Waiting for processing jobs to complete...');

    const start = Date.now();
    while (this.processing.size > 0 && (Date.now() - start) < timeoutMs) {
      await new Promise(r => setTimeout(r, 500));
    }

    const remaining = this.processing.size;
    if (remaining > 0) {
      console.warn(`[EmailQueue/M-A04] Force shutdown with ${remaining} jobs still processing`);
      // M-A04: Mark remaining jobs as stalled for recovery on restart
      for (const jobId of this.processing) {
        const job = this.jobs.get(jobId);
        if (job) {
          this.deadLetterQueue.push({
            id: job.id,
            type: job.type,
            userId: job.userId,
            campaignId: job.campaignId,
            emailId: job.emailId,
            emailData: job.emailData,
            priority: job.priority,
            retryCount: job.retryCount,
            error: 'Shutdown during processing',
            originalJob: job,
            enqueuedAt: new Date(),
            metadata: { ...job.metadata, shutdownStalled: true },
          });
        }
      }
    }

    // M-A04: Stop background timers
    if (this.batchBuffer.flushTimer) {
      clearTimeout(this.batchBuffer.flushTimer);
      this.batchBuffer.flushTimer = null;
    }

    console.log(`[EmailQueue/M-A04] Shutdown complete. Stats:`, this.getStats());
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

  // ============================================
  // M-A04: New Internal Helpers
  // ============================================

  /**
   * M-A04: Check if globally rate limited (ISP protection).
   * Uses sliding window to track sends in the last duration.
   */
  _isGloballyRateLimited() {
    const now = Date.now();
    // Clean old entries outside the window
    this.globalRateLimit.sends = this.globalRateLimit.sends.filter(
      timestamp => now - timestamp < this.globalRateLimit.duration
    );

    return this.globalRateLimit.sends.length >= this.globalRateLimit.max;
  }

  /**
   * M-A04: Check if memory is under pressure (>80% heap usage).
   */
  _isMemoryUnderPressure() {
    try {
      const memUsage = process.memoryUsage();
      const heapUsedPercent = memUsage.heapUsed / memUsage.heapTotal;
      this.memoryProtection.underPressure = heapUsedPercent > this.memoryProtection.heapThreshold;

      if (this.memoryProtection.underPressure) {
        console.warn(`[EmailQueue/M-A04] Memory pressure detected: ${(heapUsedPercent * 100).toFixed(1)}% heap used`);
      }

      return this.memoryProtection.underPressure;
    } catch (e) {
      console.error('[EmailQueue/M-A04] Memory check failed:', e.message);
      return false;
    }
  }

  /**
   * M-A04: Add DB update to batch buffer.
   */
  _addToBatchBuffer(entry) {
    if (!entry.emailId) return; // Skip if no emailId to update

    this.batchBuffer.buffer.push(entry);

    // Auto-flush if buffer is full
    if (this.batchBuffer.buffer.length >= this.batchBuffer.maxSize) {
      this._flushBatchBuffer();
    }
  }

  /**
   * M-A04: Flush batch buffer - perform bulk DB updates.
   * This should be called by the worker or timer.
   */
  async _flushBatchBuffer() {
    if (this.batchBuffer.buffer.length === 0) return;

    const batch = [...this.batchBuffer.buffer];
    this.batchBuffer.buffer = [];
    this.batchBuffer.lastFlush = Date.now();

    try {
      const db = require('../db');

      // Group updates by action type for efficiency
      const updates = batch.filter(e => e.action === 'update' && e.emailId);

      if (updates.length > 0) {
        // Use Promise.allSettled for parallel updates with error isolation
        const results = await Promise.allSettled(
          updates.map(update =>
            db.Email.update(update.data, { where: { id: update.emailId } })
              .catch(err => {
                console.error('[EmailQueue/M-A04] Batch update failed:', err.message);
                throw err;
              })
          )
        );

        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.length - succeeded;

        if (failed > 0) {
          console.warn(`[EmailQueue/M-A04] Batch flush: ${succeeded} succeeded, ${failed} failed`);
        } else {
          console.log(`[EmailQueue/M-A04] Batch flushed: ${updates.length} DB updates`);
        }

        this.emit('batchFlushed', { count: updates.length, succeeded, failed });
      }
    } catch (error) {
      console.error('[EmailQueue/M-A04] Batch flush error:', error.message);
      // Re-add failed items to buffer for retry (with backoff)
      this.batchBuffer.buffer.unshift(...batch);
    }
  }

  /**
   * M-A04: Start periodic batch flush timer.
   */
  _startBatchFlushTimer() {
    const flush = async () => {
      if (!this.active) return;

      await this._flushBatchBuffer();
      this.batchBuffer.flushTimer = setTimeout(flush, this.batchBuffer.flushInterval);
    };

    this.batchBuffer.flushTimer = setTimeout(flush, this.batchBuffer.flushInterval);
  }

  /**
   * M-A04: Start memory pressure monitor.
   */
  _startMemoryMonitor() {
    if (!this.memoryProtection.enabled) return;

    setInterval(() => {
      if (!this.active) return;

      this._isMemoryUnderPressure();

      // Emit event if state changed
      if (this.memoryProtection.underPressure) {
        this.emit('memoryPressure', {
          action: 'warning',
          heapUsage: process.memoryUsage().heapUsed,
          heapTotal: process.memoryUsage().heapTotal,
        });

        // Suggest GC if available
        if (global.gc) {
          global.gc();
          console.log('[EmailQueue/M-A04] Forced GC due to memory pressure');
        }
      }
    }, this.memoryProtection.checkInterval);
  }

  /**
   * M-A04: Start stalled job detector.
   * Jobs in 'processing' status for >5min are considered stalled.
   */
  _startStalledDetector() {
    if (!this.stalledDetection.enabled) return;

    setInterval(() => {
      if (!this.active || this.processing.size === 0) return;

      const now = Date.now();
      const stalledJobs = [];

      for (const jobId of this.processing) {
        const job = this.jobs.get(jobId);
        if (job && job.startedAt) {
          const processingTime = now - new Date(job.startedAt).getTime();
          if (processingTime > this.stalledDetection.stallTimeout) {
            stalledJobs.push({ jobId, job, processingTime });
          }
        }
      }

      // Auto-recover stalled jobs
      for (const { jobId, job, processingTime } of stalledJobs) {
        console.warn(`[EmailQueue/M-A04] Stalled job detected: ${jobId} (${(processingTime / 1000).toFixed(1)}s)`);

        // Remove from processing set
        this.processing.delete(jobId);

        // Move to DLQ as stalled
        this.deadLetterQueue.push({
          id: job.id,
          type: job.type,
          userId: job.userId,
          campaignId: job.campaignId,
          emailId: job.emailId,
          emailData: job.emailData,
          priority: job.priority,
          retryCount: job.retryCount,
          error: `Stalled after ${(processingTime / 1000).toFixed(1)}s (timeout: ${this.stalledDetection.stallTimeout / 1000}s)`,
          originalJob: job,
          enqueuedAt: new Date(),
          metadata: { ...job.metadata, stallReason: 'timeout', processingTime },
        });

        this.stats.totalStalledRecovered++;
        this.stats.totalDLQ++;

        this.emit('stalled', { jobId, processingTime, job });
      }

      if (stalledJobs.length > 0) {
        console.warn(`[EmailQueue/M-A04] Recovered ${stalledJobs.length} stalled jobs to DLQ`);
        this._updateMetrics();
      }
    }, this.stalledDetection.checkInterval);
  }

  /**
   * M-A04: Start dynamic concurrency adjuster.
   * Scales concurrency based on queue depth.
   */
  _startDynamicConcurrencyAdjuster() {
    if (!this.dynamicConcurrency.enabled) return;

    setInterval(() => {
      if (!this.active) return;

      const now = Date.now();
      if (now - this.dynamicConcurrency.lastCheck < this.dynamicConcurrency.checkInterval) return;

      this.dynamicConcurrency.lastCheck = now;

      const queueDepth = this.pending.length;
      const currentConcurrency = this.maxConcurrency;

      let targetConcurrency = currentConcurrency;

      // Scale up if queue is building up
      if (queueDepth > currentConcurrency * 2) {
        targetConcurrency = Math.min(
          Math.floor(currentConcurrency * this.dynamicConcurrency.scaleFactor),
          this.dynamicConcurrency.maxConcurrency
        );
      }
      // Scale down if queue is empty or nearly empty
      else if (queueDepth < currentConcurrency * 0.5 && currentConcurrency > this.dynamicConcurrency.minConcurrency) {
        targetConcurrency = Math.max(
          Math.floor(currentConcurrency / this.dynamicConcurrency.scaleFactor),
          this.dynamicConcurrency.minConcurrency
        );
      }

      if (targetConcurrency !== currentConcurrency) {
        this.maxConcurrency = targetConcurrency;
        console.log(`[EmailQueue/M-A04] Dynamic concurrency adjusted: ${currentConcurrency} → ${targetConcurrency} (queueDepth=${queueDepth})`);
        this.emit('concurrencyChanged', { from: currentConcurrency, to: targetConcurrency, queueDepth });
        this._updateMetrics();
      }
    }, this.dynamicConcurrency.checkInterval);
  }

  /**
   * M-A04: Start slow job monitor for a specific job.
   * Logs warning if job exceeds threshold (30s).
   */
  _startSlowJobMonitor(job) {
    setTimeout(() => {
      if (!this.jobs.has(job.id)) return;
      const currentJob = this.jobs.get(job.id);

      // Only warn if still processing after threshold
      if (currentJob.status === 'processing') {
        const elapsed = Date.now() - new Date(currentJob.startedAt).getTime();
        console.warn(`[EmailQueue/M-A04] SLOW JOB DETECTED: ${job.id} (${(elapsed / 1000).toFixed(1)}s, type=${job.type}, priority=${job.priority})`);

        this.emit('slowJob', {
          jobId: job.id,
          elapsed,
          type: job.type,
          priority: job.priority,
          threshold: this.slowJobThreshold,
        });
      }
    }, this.slowJobThreshold);
  }

  /**
   * M-A04: Record throughput data point.
   */
  _recordThroughput() {
    const now = Date.now();
    this.throughputTracker.completions.push(now);

    // Clean old entries outside window
    this.throughputTracker.completions = this.throughputTracker.completions.filter(
      timestamp => now - timestamp <= this.throughputTracker.window
    );
  }

  /**
   * M-A04: Calculate current throughput (jobs/second).
   */
  _calculateThroughput() {
    const windowSeconds = this.throughputTracker.window / 1000;
    const count = this.throughputTracker.completions.length;
    return count > 0 ? parseFloat((count / windowSeconds).toFixed(2)) : 0;
  }

  /**
   * M-A04: Update all Prometheus metrics.
   */
  _updateMetrics() {
    if (typeof queueDepthGauge === 'undefined') return; // Prometheus not available

    try {
      // Update queue depth gauges
      queueDepthGauge.set({ status: 'pending' }, this.pending.length);
      queueDepthGauge.set({ status: 'processing' }, this.processing.size);
      queueDepthGauge.set({ status: 'completed' }, this.completed.size);
      queueDepthGauge.set({ status: 'dlq' }, this.deadLetterQueue.length);

      // Update delayed jobs count
      const delayedCount = Array.from(this.jobs.values()).filter(j => j.status === 'delayed').length;
      queueDepthGauge.set({ status: 'delayed' }, delayedCount);

      // Update throughput gauge
      throughputGauge.set(this._calculateThroughput());
    } catch (e) {
      console.error('[EmailQueue/M-A04] Metrics update failed:', e.message);
    }
  }
}

module.exports = EmailQueue;
