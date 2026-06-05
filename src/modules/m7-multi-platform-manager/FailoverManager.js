const EventEmitter = require('events');

class FailoverManager extends EventEmitter {
  constructor(accountPoolManager, options = {}) {
    super();
    this.poolManager = accountPoolManager;
    this.maxRetries = options.maxRetries || 3;
    this.failoverDelay = options.failoverDelay || 1000;
    this.cooldownPeriod = options.cooldownPeriod || 300000;
    this.autoRecoveryCheck = options.autoRecoveryCheck || 60000;
    
    this.failedAccounts = new Map();
    this.failedPlatforms = new Map();
    this.failoverHistory = [];
    this.recoveryTimers = new Map();
  }

  async executeWithFailover(operation, preferences = {}) {
    let lastError = null;
    let attempts = 0;

    while (attempts < this.maxRetries) {
      attempts++;
      
      try {
        const account = await this._selectAccount(preferences);
        
        if (!account) {
          throw new Error('No available accounts for failover');
        }

        const result = await operation(account);
        
        this.emit('success', {
          accountId: account.id,
          platform: account.platform,
          attempt: attempts,
          timestamp: new Date()
        });

        return result;

      } catch (error) {
        lastError = error;
        
        this.emit('attemptFailed', {
          attempt: attempts,
          error: error.message,
          timestamp: new Date()
        });

        if (this._isAccountError(error)) {
          const accountId = this._extractAccountId(error);
          if (accountId) {
            await this._handleAccountFailure(accountId, error);
          }
        } else if (this._isPlatformError(error)) {
          const platform = this._extractPlatform(error);
          if (platform) {
            await this._handlePlatformFailure(platform, error);
          }
        }

        if (attempts < this.maxRetries) {
          await this._delay(this.failoverDelay * attempts);
        }
      }
    }

    this.emit('allAttemptsFailed', {
      totalAttempts: attempts,
      finalError: lastError?.message,
      timestamp: new Date()
    });

    throw new Error(`All ${this.maxRetries} attempts failed. Last error: ${lastError?.message}`);
  }

  async _selectAccount(preferences) {
    const availablePlatforms = this._getAvailablePlatforms();
    
    if (availablePlatforms.length === 0) {
      return null;
    }

    const platformPreference = [...availablePlatforms];
    if (preferences.requiredPlatform && availablePlatforms.includes(preferences.requiredPlatform)) {
      platformPreference.unshift(preferences.requiredPlatform);
    }

    for (const platform of platformPreference) {
      try {
        const account = await this.poolManager.selectOptimalAccount({
          ...preferences,
          requiredPlatform: platform,
          excludeAccounts: Array.from(this.failedAccounts.keys())
        });
        
        if (account) {
          return account;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  _getAvailablePlatforms() {
    const allPlatforms = ['gmail', 'outlook', 'qq', '163', 'custom'];
    return allPlatforms.filter(p => !this.failedPlatforms.has(p));
  }

  async _handleAccountFailure(accountId, error) {
    console.warn(`Account failure detected: ${accountId}`, error.message);

    this.failedAccounts.set(accountId, {
      failedAt: new Date(),
      error: error.message,
      reason: 'account_error'
    });

    this.failoverHistory.push({
      type: 'account_failure',
      target: accountId,
      error: error.message,
      timestamp: new Date(),
      action: 'excluded_from_pool'
    });

    this.emit('accountFailed', { accountId, error: error.message });

    this._scheduleAccountRecovery(accountId);
  }

  async _handlePlatformFailure(platform, error) {
    console.error(`Platform failure detected: ${platform}`, error.message);

    this.failedPlatforms.set(platform, {
      failedAt: new Date(),
      error: error.message,
      reason: 'platform_error'
    });

    this.failoverHistory.push({
      type: 'platform_failure',
      target: platform,
      error: error.message,
      timestamp: new Date(),
      action: 'platform_excluded'
    });

    this.emit('platformFailed', { platform, error: error.message });

    this._schedulePlatformRecovery(platform);
  }

  _scheduleAccountRecovery(accountId) {
    if (this.recoveryTimers.has(accountId)) {
      clearTimeout(this.recoveryTimers.get(accountId));
    }

    const timer = setTimeout(async () => {
      await this._attemptAccountRecovery(accountId);
    }, this.cooldownPeriod);

    this.recoveryTimers.set(accountId, timer);
  }

  _schedulePlatformRecovery(platform) {
    if (this.recoveryTimers.has(`platform-${platform}`)) {
      clearTimeout(this.recoveryTimers.get(`platform-${platform}`));
    }

    const timer = setTimeout(async () => {
      await this._attemptPlatformRecovery(platform);
    }, this.cooldownPeriod * 2);

    this.recoveryTimers.set(`platform-${platform}`, timer);
  }

  async _attemptAccountRecovery(accountId) {
    try {
      const account = this.poolManager.getAccount(accountId);
      if (!account) {
        this.failedAccounts.delete(accountId);
        return;
      }

      const healthResult = await account.platformInstance.healthCheck();
      
      if (healthResult.status === 'ok') {
        this.failedAccounts.delete(accountId);
        
        this.failoverHistory.push({
          type: 'account_recovery',
          target: accountId,
          timestamp: new Date(),
          action: 'restored_to_pool'
        });

        this.emit('accountRecovered', { accountId });
        console.log(`Account recovered: ${accountId}`);
      } else {
        this._scheduleAccountRecovery(accountId);
      }
    } catch (error) {
      console.error(`Account recovery failed for ${accountId}:`, error.message);
      this._scheduleAccountRecovery(accountId);
    }
  }

  async _attemptPlatformRecovery(platform) {
    try {
      const accounts = this.poolManager.getHealthyAccounts(platform);
      
      if (accounts.length > 0) {
        const testAccount = accounts[0];
        const healthResult = await testAccount.platformInstance.healthCheck();
        
        if (healthResult.status === 'ok') {
          this.failedPlatforms.delete(platform);
          
          this.failoverHistory.push({
            type: 'platform_recovery',
            target: platform,
            timestamp: new Date(),
            action: 'platform_restored'
          });

          this.emit('platformRecovered', { platform });
          console.log(`Platform recovered: ${platform}`);
          return;
        }
      }

      this._schedulePlatformRecovery(platform);
    } catch (error) {
      console.error(`Platform recovery failed for ${platform}:`, error.message);
      this._schedulePlatformRecovery(platform);
    }
  }

  _isAccountError(error) {
    const accountErrors = [
      'AUTH_FAILED',
      'INVALID_CREDENTIALS',
      'ACCOUNT_DISABLED',
      'RATE_LIMIT_EXCEEDED',
      'QUOTA_EXCEEDED'
    ];
    return accountErrors.some(e => error.message.includes(e)) ||
           error.code === 'EAUTH';
  }

  _isPlatformError(error) {
    const platformErrors = [
      'CONNECTION_REFUSED',
      'HOST_NOT_FOUND',
      'SERVICE_UNAVAILABLE',
      'TIMEOUT',
      'NETWORK_ERROR'
    ];
    return platformErrors.some(e => error.message.includes(e)) ||
           error.code === 'ECONNREFUSED' ||
           error.code === 'ETIMEDOUT';
  }

  _extractAccountId(error) {
    const match = error.message.match(/account[^\s]*/i);
    return match ? match[0] : null;
  }

  _extractPlatform(error) {
    const platforms = ['gmail', 'outlook', 'qq', '163', 'custom'];
    return platforms.find(p => error.message.toLowerCase().includes(p));
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getFailoverStats() {
    const recentFailures = this.failoverHistory.filter(
      f => (Date.now() - f.timestamp.getTime()) < 3600000
    );

    return {
      failedAccounts: this.failedAccounts.size,
      failedPlatforms: this.failedPlatforms.size,
      recentFailures: recentFailures.length,
      failureHistory: this.failoverHistory.slice(-50),
      successRate: this._calculateSuccessRate(recentFailures)
    };
  }

  _calculateSuccessRate(recentFailures) {
    if (recentFailures.length === 0) return 1.0;
    
    const failures = recentFailures.filter(f => f.type.endsWith('_failure')).length;
    const recoveries = recentFailures.filter(f => f.type.endsWith('_recovery')).length;
    const total = failures + recoveries;
    
    return total > 0 ? recoveries / total : 0.85;
  }

  forceRecoverAccount(accountId) {
    this.failedAccounts.delete(accountId);
    if (this.recoveryTimers.has(accountId)) {
      clearTimeout(this.recoveryTimers.get(accountId));
      this.recoveryTimers.delete(accountId);
    }
    this.emit('forceRecovery', { accountId });
  }

  forceRecoverPlatform(platform) {
    this.failedPlatforms.delete(platform);
    const key = `platform-${platform}`;
    if (this.recoveryTimers.has(key)) {
      clearTimeout(this.recoveryTimers.get(key));
      this.recoveryTimers.delete(key);
    }
    this.emit('forceRecovery', { platform });
  }

  shutdown() {
    for (const [key, timer] of this.recoveryTimers) {
      clearTimeout(timer);
    }
    this.recoveryTimers.clear();
    this.failedAccounts.clear();
    this.failedPlatforms.clear();
  }
}

module.exports = FailoverManager;
