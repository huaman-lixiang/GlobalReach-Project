const EventEmitter = require('events');

class AsyncQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxConcurrency = options.maxConcurrency || 5;
    this.retryAttempts = options.retryAttempts || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.queue = [];
    this.processing = new Set();
    this.completed = new Set();
    this.failed = new Set();
    this.isRunning = false;
    this.processors = new Map();
    this.stats = {
      enqueued: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      retried: 0
    };
  }

  enqueue(task, priority = 0) {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const queueItem = {
      id: taskId,
      task,
      priority,
      status: 'queued',
      attempts: 0,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null
    };

    this.queue.push(queueItem);
    this.queue.sort((a, b) => b.priority - a.priority);
    this.stats.enqueued++;

    this.emit('enqueued', { taskId, priority });

    if (!this.isRunning || this.processing.size < this.maxConcurrency) {
      this._processNext();
    }

    return taskId;
  }

  async _processNext() {
    if (this.queue.length === 0 || this.processing.size >= this.maxConcurrency) {
      if (this.queue.length === 0 && this.processing.size === 0) {
        this.isRunning = false;
        this.emit('drained');
      }
      return;
    }

    this.isRunning = true;
    const queueItem = this.queue.shift();

    if (!queueItem) return;

    queueItem.status = 'processing';
    queueItem.startedAt = new Date();
    this.processing.add(queueItem.id);

    this.emit('started', { taskId: queueItem.id });

    try {
      const result = await this._executeWithRetry(queueItem);

      queueItem.status = 'completed';
      queueItem.completedAt = new Date();
      this.processing.delete(queueItem.id);
      this.completed.add(queueItem.id);
      this.stats.processed++;
      this.stats.succeeded++;

      this.emit('completed', { taskId: queueItem.id, result });
      this._processNext();
    } catch (error) {
      queueItem.status = 'failed';
      queueItem.error = error.message;
      this.processing.delete(queueItem.id);
      this.failed.add(queueItem.id);
      this.stats.processed++;
      this.stats.failed++;

      this.emit('failed', { taskId: queueItem.id, error: error.message });
      this._processNext();
    }
  }

  async _executeWithRetry(queueItem) {
    let lastError;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      queueItem.attempts = attempt;

      try {
        if (attempt > 1) {
          this.stats.retried++;
          this.emit('retry', { taskId: queueItem.id, attempt });
          await this._delay(this.retryDelay * attempt);
        }

        const result = await queueItem.task.execute();
        return result;
      } catch (error) {
        lastError = error;
        
        if (attempt === this.retryAttempts) {
          throw lastError;
        }
      }
    }

    throw lastError;
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getQueueStatus() {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      completed: this.completed.size,
      failed: this.failed.size,
      stats: { ...this.stats },
      isRunning: this.isRunning
    };
  }

  getTaskStatus(taskId) {
    const inQueue = this.queue.find(item => item.id === taskId);
    if (inQueue) return inQueue;

    if (this.processing.has(taskId)) {
      return { id: taskId, status: 'processing' };
    }
    if (this.completed.has(taskId)) {
      return { id: taskId, status: 'completed' };
    }
    if (this.failed.has(taskId)) {
      return { id: taskId, status: 'failed' };
    }

    return null;
  }

  clear() {
    this.queue = [];
    this.emit('cleared');
  }

  pause() {
    this.isRunning = false;
    this.emit('paused');
  }

  resume() {
    if (!this.isRunning) {
      this.isRunning = true;
      this._processNext();
      this.emit('resumed');
    }
  }

  async waitForCompletion(timeout = null) {
    if (this.queue.length === 0 && this.processing.size === 0) {
      return true;
    }

    return new Promise((resolve, reject) => {
      const onDrained = () => {
        cleanup();
        resolve(true);
      };

      const onError = (error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        this.removeListener('drained', onDrained);
        this.removeListener('error', onError);
        if (timer) clearTimeout(timer);
      };

      this.on('drained', onDrained);
      this.on('error', onError);

      let timer = null;
      if (timeout) {
        timer = setTimeout(() => {
          cleanup();
          resolve(false);
        }, timeout);
      }
    });
  }
}

class SendQueue extends AsyncQueue {
  constructor(accountPoolManager, options = {}) {
    super(options);
    this.poolManager = accountPoolManager;
    this.sendHistory = new Map();
  }

  async sendEmail(emailConfig, preferences = {}) {
    const task = {
      type: 'send',
      execute: async () => {
        const account = await this.poolManager.selectOptimalAccount(preferences);
        const result = await account.platformInstance.send(emailConfig);
        
        this._recordSend(account.id, emailConfig.to, result);
        return { ...result, accountId: account.id };
      }
    };

    return this.enqueue(task, preferences.priority || 0);
  }

  _recordSend(accountId, to, result) {
    const key = `${accountId}-${new Date().toISOString().split('T')[0]}`;
    if (!this.sendHistory.has(key)) {
      this.sendHistory.set(key, []);
    }
    this.sendHistory.get(key).push({
      to,
      messageId: result.messageId,
      timestamp: new Date()
    });
  }

  getSendStatistics(dateRange = {}) {
    const stats = {};
    for (const [key, sends] of this.sendHistory) {
      stats[key] = {
        total: sends.length,
        recipients: [...new Set(sends.map(s => s.to))].length
      };
    }
    return stats;
  }
}

class FetchQueue extends AsyncQueue {
  constructor(accountPoolManager, options = {}) {
    super(options);
    this.poolManager = accountPoolManager;
  }

  async fetchUnread(accountId, options = {}) {
    const task = {
      type: 'fetch',
      execute: async () => {
        const account = this.poolManager.getAccount(accountId);
        if (!account) {
          throw new Error(`Account ${accountId} not found`);
        }
        return await account.platformInstance.fetchUnread(options);
      }
    };

    return this.enqueue(task, options.priority || 0);
  }

  async fetchAllUnread(options = {}) {
    const accounts = this.poolManager.getHealthyAccounts();
    const taskIds = [];

    for (const account of accounts) {
      const taskId = await this.fetchUnread(account.id, options);
      taskIds.push(taskId);
    }

    return taskIds;
  }
}

module.exports = {
  AsyncQueue,
  SendQueue,
  FetchQueue
};
