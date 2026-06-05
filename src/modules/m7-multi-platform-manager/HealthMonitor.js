const EventEmitter = require('events');

class HealthMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.checkInterval = options.checkInterval || 5 * 60 * 1000;
    this.healthHistory = new Map();
    this.alertThresholds = {
      errorRate: options.errorRate || 0.1,
      responseTime: options.responseTime || 30000,
      consecutiveFailures: options.consecutiveFailures || 3
    };
    this.timers = new Map();
  }

  startMonitoring(accountPoolManager) {
    this.poolManager = accountPoolManager;
    this._scheduleHealthChecks();
    this.emit('monitoringStarted');
  }

  stopMonitoring() {
    for (const [accountId, timer] of this.timers) {
      clearInterval(timer);
      this.timers.delete(accountId);
    }
    this.emit('monitoringStopped');
  }

  async checkAccountHealth(accountId) {
    const account = this.poolManager.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const startTime = Date.now();
    let healthStatus = 'healthy';
    let details = {};

    try {
      const healthResult = await account.platformInstance.healthCheck();
      const responseTime = Date.now() - startTime;

      details = {
        responseTime,
        isConnected: account.status === 'active',
        ...healthResult
      };

      if (responseTime > this.alertThresholds.responseTime) {
        healthStatus = 'degraded';
        details.warning = `Response time ${responseTime}ms exceeds threshold`;
      } else if (healthResult.status !== 'ok') {
        healthStatus = 'unhealthy';
        details.error = healthResult.error || 'Unknown health issue';
      }

    } catch (error) {
      healthStatus = 'unhealthy';
      details = {
        error: error.message,
        responseTime: Date.now() - startTime,
        isConnected: false
      };
    }

    this._recordHealthHistory(accountId, healthStatus, details);
    this._evaluateAlerts(accountId, healthStatus, details);

    return {
      accountId,
      status: healthStatus,
      timestamp: new Date(),
      details
    };
  }

  async checkAllAccounts() {
    const accounts = this.poolManager.getAllAccounts();
    const results = [];

    for (const account of accounts) {
      try {
        const result = await this.checkAccountHealth(account.id);
        results.push(result);
      } catch (error) {
        results.push({
          accountId: account.id,
          status: 'error',
          timestamp: new Date(),
          details: { error: error.message }
        });
      }
    }

    return results;
  }

  _recordHealthHistory(accountId, status, details) {
    if (!this.healthHistory.has(accountId)) {
      this.healthHistory.set(accountId, []);
    }

    const history = this.healthHistory.get(accountId);
    history.unshift({
      status,
      details,
      timestamp: new Date()
    });

    if (history.length > 100) {
      history.pop();
    }
  }

  _evaluateAlerts(accountId, status, details) {
    const history = this.healthHistory.get(accountId) || [];
    const recentFailures = history
      .slice(0, 10)
      .filter(h => h.status === 'unhealthy' || h.status === 'error')
      .length;

    if (status === 'unhealthy' && recentFailures >= this.alertThresholds.consecutiveFailures) {
      this.emit('alert', {
        type: 'consecutive-failures',
        accountId,
        severity: 'critical',
        message: `Account ${accountId} has ${recentFailures} consecutive failures`,
        details
      });
    }

    if (status === 'degraded') {
      this.emit('alert', {
        type: 'performance-degradation',
        accountId,
        severity: 'warning',
        message: `Account ${accountId} performance degraded`,
        details
      });
    }
  }

  _scheduleHealthChecks() {
    const accounts = this.poolManager.getAllAccounts();

    for (const account of accounts) {
      if (account.status === 'active') {
        const timer = setInterval(async () => {
          await this.checkAccountHealth(account.id);
        }, this.checkInterval);

        this.timers.set(account.id, timer);
      }
    }
  }

  getHealthHistory(accountId, limit = 10) {
    const history = this.healthHistory.get(accountId) || [];
    return history.slice(0, limit);
  }

  getHealthSummary() {
    const summary = {
      total: 0,
      healthy: 0,
      degraded: 0,
      unhealthy: 0,
      unknown: 0,
      byPlatform: {}
    };

    const accounts = this.poolManager.getAllAccounts();
    summary.total = accounts.length;

    for (const account of accounts) {
      const history = this.healthHistory.get(account.id) || [];
      const latestStatus = history.length > 0 ? history[0].status : account.healthStatus || 'unknown';

      summary[latestStatus] = (summary[latestStatus] || 0) + 1;

      if (!summary.byPlatform[account.platform]) {
        summary.byPlatform[account.platform] = { total: 0, healthy: 0, unhealthy: 0 };
      }
      summary.byPlatform[account.platform].total++;
      if (latestStatus === 'healthy') {
        summary.byPlatform[account.platform].healthy++;
      } else if (latestStatus === 'unhealthy') {
        summary.byPlatform[account.platform].unhealthy++;
      }
    }

    return summary;
  }

  getAlertThresholds() {
    return { ...this.alertThresholds };
  }

  setAlertThresholds(thresholds) {
    Object.assign(this.alertThresholds, thresholds);
  }
}

module.exports = HealthMonitor;
