const fs = require('fs');
const path = require('path');

class PlatformConfigManager {
  constructor(configPath = null) {
    this.configPath = configPath || path.join(__dirname, '../../config/platforms.yaml');
    this.platformConfigs = new Map();
    this.rateLimits = new Map();
    this.authMethods = new Map();
    this.loadDefaultConfigs();
  }

  loadDefaultConfigs() {
    this.platformConfigs.set('gmail', {
      name: 'Gmail',
      imap: { host: 'imap.gmail.com', port: 993, secure: true },
      smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
      features: ['labels', 'categories', 'threads'],
      authModes: ['oauth2', 'app-password'],
      rateLimit: { daily: 100, hourly: 20 }
    });

    this.platformConfigs.set('outlook', {
      name: 'Outlook',
      imap: { host: 'outlook.office365.com', port: 993, secure: true },
      smtp: { host: 'smtp.office365.com', port: 587, secure: false, tls: true },
      features: ['folders', 'categories', 'rules'],
      authModes: ['oauth2', 'basic'],
      rateLimit: { daily: 50, hourly: 15 }
    });

    this.platformConfigs.set('qq', {
      name: 'QQ邮箱',
      imap: { host: 'imap.qq.com', port: 993, secure: true },
      smtp: { host: 'smtp.qq.com', port: 465, secure: true },
      features: ['folders', 'tags'],
      authModes: ['authorization-code'],
      rateLimit: { daily: 200, hourly: 50 }
    });

    this.platformConfigs.set('163', {
      name: '163邮箱',
      imap: { host: 'imap.163.com', port: 993, secure: true },
      smtp: { host: 'smtp.163.com', port: 465, secure: true },
      features: ['folders', 'tags'],
      authModes: ['authorization-code'],
      rateLimit: { daily: 200, hourly: 50 }
    });

    this.platformConfigs.set('custom', {
      name: '企业自定义SMTP',
      imap: { host: '', port: 993, secure: true },
      smtp: { host: '', port: 587, secure: false, tls: true },
      features: ['custom'],
      authModes: ['basic', 'tls'],
      rateLimit: { daily: 500, hourly: 100 }
    });
  }

  getPlatformConfig(platform) {
    const config = this.platformConfigs.get(platform.toLowerCase());
    if (!config) {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    return { ...config };
  }

  updatePlatformConfig(platform, updates) {
    const existing = this.platformConfigs.get(platform.toLowerCase());
    if (!existing) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    this.platformConfigs.set(platform.toLowerCase(), { ...existing, ...updates });
    return this.getPlatformConfig(platform);
  }

  getRateLimit(platform) {
    const config = this.getPlatformConfig(platform);
    return config.rateLimit;
  }

  checkRateLimit(accountId, platform) {
    const limit = this.getRateLimit(platform);
    const key = `${accountId}-${platform}`;
    const current = this.rateLimits.get(key) || { sentToday: 0, sentThisHour: 0, lastReset: new Date() };

    const now = new Date();
    const dayChanged = now.toDateString() !== current.lastReset.toDateString();
    const hourChanged = Math.floor(now.getTime() / 3600000) !== Math.floor(current.lastReset.getTime() / 3600000);

    if (dayChanged) {
      current.sentToday = 0;
    }
    if (hourChanged) {
      current.sentThisHour = 0;
    }
    current.lastReset = now;

    return {
      canSend: current.sentToday < limit.daily && current.sentThisHour < limit.hourly,
      remainingDaily: limit.daily - current.sentToday,
      remainingHourly: limit.hourly - current.sentThisHour,
      current
    };
  }

  recordSend(accountId, platform) {
    const key = `${accountId}-${platform}`;
    let current = this.rateLimits.get(key) || { sentToday: 0, sentThisHour: 0, lastReset: new Date() };
    current.sentToday++;
    current.sentThisHour++;
    this.rateLimits.set(key, current);
  }

  getAuthMethodConfig(platform, method) {
    const config = this.getPlatformConfig(platform);
    if (!config.authModes.includes(method)) {
      throw new Error(`Auth method ${method} not supported for platform ${platform}`);
    }

    const methodConfigs = {
      'oauth2': {
        type: 'oauth2',
        tokenEndpoint: this._getOAuthEndpoint(platform),
        scopes: ['mail.read', 'mail.send', 'offline_access']
      },
      'app-password': {
        type: 'app-password',
        description: 'Application-specific password for 2FA accounts'
      },
      'basic': {
        type: 'basic',
        security: 'tls-required'
      },
      'authorization-code': {
        type: 'authorization-code',
        description: 'QQ/163 authorization code authentication'
      }
    };

    return methodConfigs[method] || {};
  }

  _getOAuthEndpoint(platform) {
    const endpoints = {
      gmail: 'https://accounts.google.com/o/oauth2/token',
      outlook: 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
    };
    return endpoints[platform];
  }

  validateCredentials(platform, credentials) {
    const config = this.getPlatformConfig(platform);
    const requiredFields = {
      gmail: ['email'],
      outlook: ['email'],
      qq: ['email', 'authCode'],
      '163': ['email', 'authCode'],
      custom: ['host', 'email', 'password']
    };

    const fields = requiredFields[platform] || ['email', 'password'];
    const missing = fields.filter(field => !credentials[field]);

    return {
      valid: missing.length === 0,
      missingFields: missing
    };
  }

  exportConfig() {
    const config = {};
    for (const [platform, settings] of this.platformConfigs) {
      config[platform] = settings;
    }
    return config;
  }
}

module.exports = PlatformConfigManager;
