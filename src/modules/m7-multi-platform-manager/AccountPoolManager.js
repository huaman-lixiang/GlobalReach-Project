const PlatformFactory = require('./PlatformFactory');
const EventEmitter = require('events');

class AccountPoolManager extends EventEmitter {
  constructor() {
    super();
    this.accounts = new Map();
    this.platformGroups = new Map();
    this.healthStats = new Map();
  }

  addAccount(accountConfig) {
    const { id, platform, credentials, metadata = {} } = accountConfig;

    if (this.accounts.has(id)) {
      throw new Error(`Account ${id} already exists`);
    }

    const platformInstance = PlatformFactory.create(platform);
    const account = {
      id,
      platform,
      credentials,
      platformInstance,
      metadata,
      status: 'inactive',
      healthStatus: 'unknown',
      lastUsed: null,
      usageStats: {
        sentToday: 0,
        sentThisHour: 0,
        lastReset: new Date()
      },
      createdAt: new Date()
    };

    this.accounts.set(id, account);

    if (!this.platformGroups.has(platform)) {
      this.platformGroups.set(platform, []);
    }
    this.platformGroups.get(platform).push(id);

    this.emit('accountAdded', { accountId: id, platform });
    return account;
  }

  removeAccount(accountId) {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    if (account.status === 'active') {
      account.platformInstance.disconnect();
    }

    this.accounts.delete(accountId);
    const platformList = this.platformGroups.get(account.platform);
    const index = platformList.indexOf(accountId);
    if (index > -1) {
      platformList.splice(index, 1);
    }

    this.emit('accountRemoved', { accountId, platform: account.platform });
  }

  async activateAccount(accountId) {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    try {
      await account.platformInstance.connect(account.credentials);
      account.status = 'active';
      account.healthStatus = await this._performHealthCheck(account);
      this.emit('accountActivated', { accountId, status: 'active' });
      return account;
    } catch (error) {
      account.status = 'error';
      account.lastError = error.message;
      this.emit('accountError', { accountId, error: error.message });
      throw error;
    }
  }

  deactivateAccount(accountId) {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    if (account.status === 'active') {
      account.platformInstance.disconnect();
      account.status = 'inactive';
      this.emit('accountDeactivated', { accountId });
    }
  }

  getAccount(accountId) {
    return this.accounts.get(accountId);
  }

  getAccountsByPlatform(platform) {
    return this.platformGroups.get(platform) || [];
  }

  getAllAccounts() {
    return Array.from(this.accounts.values());
  }

  getHealthyAccounts(platform = null) {
    let accounts = platform ? this.getAccountsByPlatform(platform) : Array.from(this.accounts.keys());
    return accounts
      .map(id => this.accounts.get(id))
      .filter(acc => acc.healthStatus === 'healthy' && acc.status === 'active');
  }

  async selectOptimalAccount(preferences = {}) {
    const { targetRegion, requiredPlatform } = preferences;
    let candidates = this.getHealthyAccounts(requiredPlatform);

    if (candidates.length === 0) {
      throw new Error('No healthy accounts available');
    }

    candidates.sort((a, b) => {
      const scoreA = this._calculateAccountScore(a, targetRegion);
      const scoreB = this._calculateAccountScore(b, targetRegion);
      return scoreB - scoreA;
    });

    return candidates[0];
  }

  _calculateAccountScore(account, targetRegion) {
    let score = 100;

    const regionPreference = this._getRegionPreference(account.platform, targetRegion);
    score += regionPreference * 20;

    const hoursSinceLastUse = account.lastUsed
      ? (Date.now() - account.lastUsed.getTime()) / (1000 * 60 * 60)
      : Infinity;
    score += Math.min(hoursSinceLastUse, 24) * 2;

    const usageRatio = account.usageStats.sentToday / this._getDailyLimit(account.platform);
    score -= usageRatio * 30;

    return Math.max(0, score);
  }

  _getRegionPreference(platform, region) {
    const preferences = {
      gmail: { 'US': 1, 'EU': 0.8, 'ASIA': 0.3 },
      outlook: { 'US': 0.9, 'EU': 1, 'ASIA': 0.5 },
      qq: { 'CN': 1, 'ASIA': 0.8, 'OTHER': 0.2 },
      '163': { 'CN': 1, 'ASIA': 0.8, 'OTHER': 0.2 },
      custom: { 'DEFAULT': 0.5 }
    };

    const platformPrefs = preferences[platform] || { 'DEFAULT': 0.5 };
    return platformPrefs[region] || platformPrefs['DEFAULT'] || 0.5;
  }

  _getDailyLimit(platform) {
    const limits = {
      gmail: 100,
      outlook: 50,
      qq: 200,
      '163': 200,
      custom: 500
    };
    return limits[platform] || 100;
  }

  async _performHealthCheck(account) {
    try {
      const healthResult = await account.platformInstance.healthCheck();
      return healthResult.status === 'ok' ? 'healthy' : 'degraded';
    } catch (error) {
      return 'unhealthy';
    }
  }

  getPlatformStatistics() {
    const stats = {};
    for (const [platform, accountIds] of this.platformGroups) {
      stats[platform] = {
        total: accountIds.length,
        active: accountIds.filter(id => this.accounts.get(id).status === 'active').length,
        healthy: accountIds.filter(id => this.accounts.get(id).healthStatus === 'healthy').length
      };
    }
    return stats;
  }

  async batchImport(accounts) {
    const results = [];
    for (const accountConfig of accounts) {
      try {
        const account = this.addAccount(accountConfig);
        results.push({ success: true, accountId: account.id });
      } catch (error) {
        results.push({ success: false, error: error.message, config: accountConfig });
      }
    }
    return results;
  }

  exportAccounts(options = {}) {
    const { includeCredentials = false, platform = null } = options;
    let accounts = platform ? this.getAccountsByPlatform(platform) : Array.from(this.accounts.keys());

    return accounts.map(id => {
      const account = this.accounts.get(id);
      return {
        id: account.id,
        platform: account.platform,
        status: account.status,
        healthStatus: account.healthStatus,
        metadata: account.metadata,
        ...(includeCredentials ? { credentials: account.credentials } : {})
      };
    });
  }
}

module.exports = AccountPoolManager;
