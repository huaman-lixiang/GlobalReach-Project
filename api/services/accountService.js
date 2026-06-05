/**
 * Account Service - DB/Engine Bridge Layer (D02)
 *
 * Bridges Sequelize ORM (persistent storage) with M7 AccountPoolManager (in-memory engine).
 * All account operations flow through this service to ensure consistency between
 * database state and engine state.
 */

const db = require('../db');

// M7 Engine modules
let AccountPoolManager, LifecycleManager, HealthMonitor;
let poolManager, lifecycleManager, healthMonitor;

try {
  AccountPoolManager = require('../../src/modules/m7-multi-platform-manager/AccountPoolManager');
  LifecycleManager = require('../../src/modules/m7-multi-platform-manager/LifecycleManager');
  HealthMonitor = require('../../src/modules/m7-multi-platform-manager/HealthMonitor');
  poolManager = new AccountPoolManager();
  lifecycleManager = new LifecycleManager(poolManager);
  healthMonitor = new HealthMonitor({ checkInterval: 5 * 60 * 1000 });
  console.log('[AccountService] M7 Engine loaded successfully');
} catch (e) {
  console.warn('[AccountService] M7 Engine not available:', e.message);
}

// ============================================
// Sync: DB → Engine
// ============================================

/**
 * Load all active accounts from DB into the in-memory AccountPoolManager.
 * Called on startup and when accounts are modified.
 */
async function syncAccountsToEngine(userId) {
  if (!poolManager) return { loaded: 0, errors: [] };

  const accounts = await db.EmailAccount.findAll({
    where: { userId, status: 'ACTIVE' },
    attributes: { exclude: ['passwordEncrypted'] },
  });

  const results = { loaded: 0, errors: [] };

  for (const acc of accounts) {
    try {
      // Skip if already in pool (avoid duplicate add)
      if (poolManager.getAccount(acc.id)) {
        results.loaded++;
        continue;
      }

      // Decrypt password would go here in production (currently stored as-is)
      poolManager.addAccount({
        id: acc.id,
        platform: mapPlatformEnum(acc.platform),
        credentials: {
          email: acc.email,
          password: acc.passwordEncrypted, // TODO: decrypt in production
          imapHost: acc.imapHost,
          smtpHost: acc.smtpHost,
          imapPort: acc.imapPort,
          smtpPort: acc.smtpPort,
        },
        metadata: {
          displayName: acc.displayName,
          dailyLimit: acc.dailyLimit,
          hourlyLimit: acc.hourlyLimit,
          healthScore: acc.healthScore,
          ...acc.metadata,
        },
      });
      results.loaded++;
    } catch (e) {
      results.errors.push({ accountId: acc.id, error: e.message });
    }
  }

  if (results.loaded > 0) {
    console.log(`[AccountService] Synced ${results.loaded} accounts to engine for user ${userId}`);
  }

  return results;
}

// ============================================
// CRUD Operations (DB + Engine synced)
// ============================================

/**
 * List accounts with pagination, filtering, and engine status enrichment.
 */
async function listAccounts(userId, filters = {}) {
  const { page = 1, limit = 20, platform, status, search, sortBy = 'createdAt', sortOrder = 'DESC' } = filters;
  const offset = (Number(page) - 1) * Number(limit);
  const { Op } = require('sequelize');
  const where = { userId };

  if (platform) where.platform = platform.toUpperCase();
  if (status) where.status = status.toUpperCase();
  if (search) {
    where[Op.or] = [
      { email: { [Op.iLike]: `%${search}%` } },
      { displayName: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const { count, rows } = await db.EmailAccount.findAndCountAll({
    where,
    offset,
    limit: Number(limit),
    order: [[sortBy, sortOrder]],
    attributes: { exclude: ['passwordEncrypted'] },
  });

  // Enrich with engine status (if available)
  const enriched = rows.map(acc => {
    const json = acc.toJSON();
    if (poolManager) {
      const engineAccount = poolManager.getAccount(acc.id);
      json.engineStatus = engineAccount ? {
        status: engineAccount.status,
        healthStatus: engineAccount.healthStatus,
        lastUsed: engineAccount.lastUsed,
        usageStats: engineAccount.usageStats,
      } : null;
    }
    return json;
  });

  return {
    data: enriched,
    pagination: { page: Number(page), limit: Number(limit), total: count, pages: Math.ceil(count / Number(limit)) },
  };
}

/**
 * Get a single account by ID with full details.
 */
async function getAccount(accountId, userId) {
  const account = await db.EmailAccount.findOne({
    where: { id: accountId, userId },
    attributes: { exclude: ['passwordEncrypted'] },
  });
  if (!account) return null;

  const json = account.toJSON();

  // Enrich with engine state
  if (poolManager) {
    const engineAcc = poolManager.getAccount(accountId);
    if (engineAcc) {
      json.engineStatus = {
        status: engineAcc.status,
        healthStatus: engineAcc.healthStatus,
        lastUsed: engineAcc.lastUsed,
        usageStats: engineAcc.usageStats,
        lastError: engineAcc.lastError,
      };
    }
  }

  return json;
}

/**
 * Create a new account in DB and register with the engine.
 */
async function createAccount(userId, accountData) {
  const existing = await db.EmailAccount.findOne({ where: { email: accountData.email } });
  if (existing) {
    throw Object.assign(new Error('Email already registered'), { code: 'ACCOUNT_EXISTS' });
  }

  const platform = accountData.platform.toUpperCase();
  const account = await db.EmailAccount.create({
    userId,
    platform,
    email: accountData.email,
    passwordEncrypted: accountData.password,
    imapHost: accountData.imapHost || getDefaultImapHost(platform),
    imapPort: accountData.imapPort || getDefaultImapPort(platform),
    smtpHost: accountData.smtpHost || getDefaultSmtpHost(platform),
    smtpPort: accountData.smtpPort || getDefaultSmtpPort(platform),
    encryptionType: accountData.encryptionType || 'SSL',
    displayName: accountData.displayName || accountData.email,
    dailyLimit: accountData.dailyLimit || 100,
    hourlyLimit: accountData.hourlyLimit || 20,
    metadata: accountData.metadata || {},
  });

  // Register with M7 engine (inactive until explicitly activated)
  if (poolManager) {
    try {
      poolManager.addAccount({
        id: account.id,
        platform: mapPlatformEnum(platform),
        credentials: {
          email: account.email,
          password: account.passwordEncrypted,
          imapHost: account.imapHost,
          smtpHost: account.smtpHost,
          imapPort: account.imapPort,
          smtpPort: account.smtpPort,
        },
        metadata: {
          displayName: account.displayName,
          dailyLimit: account.dailyLimit,
          hourlyLimit: account.hourlyLimit,
        },
      });
      console.log(`[AccountService] Account ${account.id} registered with engine`);
    } catch (e) {
      console.warn(`[AccountService] Engine registration failed for ${account.id}:`, e.message);
    }
  }

  await db.AuditLog.create({
    userId,
    action: 'CREATE_ACCOUNT',
    resourceType: 'EmailAccount',
    resourceId: account.id,
    ipAddress: accountData.ipAddress,
  });

  const { passwordEncrypted, ...safeAccount } = account.toJSON();
  return safeAccount;
}

/**
 * Update an account in DB and sync engine state.
 */
async function updateAccount(accountId, userId, updateData) {
  const account = await db.EmailAccount.findOne({ where: { id: accountId, userId } });
  if (!account) throw Object.assign(new Error('Account not found'), { code: 'NOT_FOUND' });

  const allowedFields = ['displayName', 'dailyLimit', 'hourlyLimit', 'status', 'metadata'];
  const cleanData = {};
  for (const f of allowedFields) {
    if (updateData[f] !== undefined) cleanData[f] = updateData[f];
  }

  const updated = await account.update(cleanData);

  // If status changed to ACTIVE, ensure it's in the engine
  if (cleanData.status === 'ACTIVE' && poolManager && !poolManager.getAccount(accountId)) {
    try {
      poolManager.addAccount({
        id: updated.id,
        platform: mapPlatformEnum(updated.platform),
        credentials: { email: updated.email, password: updated.passwordEncrypted },
        metadata: { displayName: updated.displayName },
      });
    } catch (e) {
      console.warn(`[AccountService] Re-add to engine failed:`, e.message);
    }
  }

  await db.AuditLog.create({
    userId,
    action: 'UPDATE_ACCOUNT',
    resourceType: 'EmailAccount',
    resourceId: accountId,
    details: cleanData,
    ipAddress: updateData.ipAddress,
  });

  const { passwordEncrypted, ...safeUpdated } = updated.toJSON();
  return safeUpdated;
}

/**
 * Delete an account from DB and remove from engine.
 */
async function deleteAccount(accountId, userId) {
  const deleted = await db.EmailAccount.destroy({ where: { id: accountId, userId } });
  if (!deleted) throw Object.assign(new Error('Account not found'), { code: 'NOT_FOUND' });

  // Remove from engine
  if (poolManager && poolManager.getAccount(accountId)) {
    try {
      poolManager.removeAccount(accountId);
    } catch (e) {
      console.warn(`[AccountService] Engine removal failed for ${accountId}:`, e.message);
    }
  }

  await db.AuditLog.create({
    userId,
    action: 'DELETE_ACCOUNT',
    resourceType: 'EmailAccount',
    resourceId: accountId,
  });

  return true;
}

// ============================================
// Engine Operations (M7 Integration)
// ============================================

/**
 * Test IMAP/SMTP connection for an account using M7 engine or raw TCP fallback.
 */
async function testConnection(accountId, userId) {
  const account = await db.EmailAccount.findOne({ where: { id: accountId, userId } });
  if (!account) throw Object.assign(new Error('Account not found'), { code: 'NOT_FOUND' });

  let connected = false;
  let reason = '';
  let latencyMs = 0;

  const startTime = Date.now();

  if (lifecycleManager && poolManager) {
    // Ensure account is in the engine
    if (!poolManager.getAccount(accountId)) {
      try {
        poolManager.addAccount({
          id: account.id,
          platform: mapPlatformEnum(account.platform),
          credentials: {
            email: account.email,
            password: account.passwordEncrypted,
            host: account.imapHost,
            port: account.imapPort,
          },
        });
      } catch (e) {
        // May already exist, that's fine
      }
    }

    try {
      const result = await lifecycleManager.activateAccount(accountId, {
        email: account.email,
        password: account.passwordEncrypted,
        host: account.imapHost,
        port: account.imapPort,
      });
      connected = result.success || result.state === 'active';
      reason = result.message || '';
    } catch (e) {
      reason = e.message;
    }
  } else {
    // Fallback: raw TCP connectivity test
    const net = require('net');
    connected = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(5000);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); reason = 'connection_timeout'; });
      socket.on('error', (e) => { resolve(false); reason = e.code || e.message; });
      socket.connect(
        account.imapPort || getDefaultImapPort(account.platform),
        account.imapHost || getEmailDomain(account.email)
      );
    });
  }

  latencyMs = Date.now() - startTime;

  // Update health score in DB
  await account.update({
    healthScore: connected ? Math.min(100, (account.healthScore || 50) + 10) : Math.max(0, (account.healthScore || 50) - 20),
    lastUsedAt: new Date(),
  });

  return {
    accountId: account.id,
    testedAt: new Date().toISOString(),
    connected,
    reason,
    latencyMs,
    method: lifecycleManager ? 'engine' : 'tcp_fallback',
  };
}

/**
 * Select the optimal account for sending based on M7 scoring algorithm.
 */
async function selectBestAccount(userId, preferences = {}) {
  if (!poolManager) {
    throw new Error('AccountPoolManager not available');
  }

  // Ensure accounts are synced
  await syncAccountsToEngine(userId);

  try {
    const account = await poolManager.selectOptimalAccount(preferences);
    return {
      success: true,
      account: {
        id: account.id,
        platform: account.platform,
        status: account.status,
        healthStatus: account.healthStatus,
        score: poolManager._calculateAccountScore(account, preferences.targetRegion),
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e.message,
      suggestion: 'No healthy accounts available. Please check account configuration.',
    };
  }
}

/**
 * Activate an account in the M7 engine (establishes IMAP/SMTP connections).
 */
async function activateAccount(accountId, userId) {
  const account = await db.EmailAccount.findOne({ where: { id: accountId, userId } });
  if (!account) throw Object.assign(new Error('Account not found'), { code: 'NOT_FOUND' });

  if (!lifecycleManager) {
    throw new Error('LifecycleManager not available');
  }

  // Ensure in pool
  if (!poolManager.getAccount(accountId)) {
    poolManager.addAccount({
      id: account.id,
      platform: mapPlatformEnum(account.platform),
      credentials: {
        email: account.email,
        password: account.passwordEncrypted,
        imapHost: account.imapHost,
        smtpHost: account.smtpHost,
        imapPort: account.imapPort,
        smtpPort: account.smtpPort,
      },
    });
  }

  const result = await lifecycleManager.activateAccount(accountId, {
    email: account.email,
    password: account.passwordEncrypted,
    imapHost: account.imapHost,
    smtpHost: account.smtpHost,
  });

  // Update DB status
  if (result.success || result.state === 'active') {
    await account.update({ status: 'ACTIVE', lastUsedAt: new Date() });
  }

  return result;
}

/**
 * Deactivate an account in the M7 engine.
 */
async function deactivateAccount(accountId, userId) {
  const account = await db.EmailAccount.findOne({ where: { id: accountId, userId } });
  if (!account) throw Object.assign(new Error('Account not found'), { code: 'NOT_FOUND' });

  if (lifecycleManager) {
    await lifecycleManager.deactivateAccount(accountId);
  } else if (poolManager && poolManager.getAccount(accountId)) {
    poolManager.deactivateAccount(accountId);
  }

  await account.update({ status: 'INACTIVE' });
  return { success: true, message: 'Account deactivated' };
}

// ============================================
// Statistics & Monitoring
// ============================================

/**
 * Get platform distribution statistics from DB.
 */
async function getDistributionStats(userId) {
  const [byPlatform, byStatus, total] = await Promise.all([
    db.EmailAccount.findAll({
      where: { userId },
      attributes: ['platform', [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']],
      group: ['platform'],
      raw: true,
    }),
    db.EmailAccount.findAll({
      where: { userId },
      attributes: ['status', [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']],
      group: ['status'],
      raw: true,
    }),
    db.EmailAccount.count({ where: { userId } }),
  ]);

  // Enrich with engine statistics if available
  let engineStats = null;
  if (poolManager) {
    engineStats = poolManager.getPlatformStatistics();
  }

  return { byPlatform, byStatus, total, engineStats };
}

/**
 * Get comprehensive health status across all accounts.
 */
async function getHealthStatus(userId) {
  const dbAccounts = await db.EmailAccount.findAll({
    where: { userId },
    attributes: ['id', 'platform', 'status', 'healthScore', 'lastUsedAt', 'sentToday'],
  });

  const summary = {
    total: dbAccounts.length,
    byStatus: {},
    byPlatform: {},
    avgHealthScore: 0,
    engineAvailable: !!poolManager,
  };

  let healthSum = 0;
  for (const acc of dbAccounts) {
    summary.byStatus[acc.status] = (summary.byStatus[acc.status] || 0) + 1;
    summary.byPlatform[acc.platform] = (summary.byPlatform[acc.platform] || 0) + 1;
    healthSum += acc.healthScore || 0;
  }

  summary.avgHealthScore = dbAccounts.length > 0 ? Math.round(healthSum / dbAccounts.length) : 0;

  // Add engine-level health if available
  if (healthMonitor && poolManager) {
    try {
      summary.engineHealth = healthMonitor.getHealthSummary();
    } catch (e) {
      summary.engineHealth = null;
    }
  }

  return summary;
}

/**
 * Batch import accounts from array.
 */
async function batchImport(accounts, userId) {
  const results = [];

  for (const acc of accounts) {
    try {
      const created = await createAccount(userId, acc);
      results.push({ success: true, accountId: created.id, email: acc.email });
    } catch (e) {
      results.push({ success: false, error: e.message, email: acc.email });
    }
  }

  return results;
}

// ============================================
// Helpers
// ============================================

function mapPlatformEnum(dbEnum) {
  const map = {
    'GMAIL': 'gmail',
    'OUTLOOK': 'outlook',
    'QQ': 'qq',
    'NETEASE_163': '163',
    'CUSTOM_SMTP': 'custom',
  };
  return map[dbEnum] || dbEnum.toLowerCase();
}

function getDefaultImapHost(platform) {
  return {
    GMAIL: 'imap.gmail.com',
    OUTLOOK: 'outlook.office365.com',
    QQ: 'imap.qq.com',
    NETEASE_163: 'imap.163.com',
  }[platform];
}

function getDefaultSmtpHost(platform) {
  return {
    GMAIL: 'smtp.gmail.com',
    OUTLOOK: 'smtp.office365.com',
    QQ: 'smtp.qq.com',
    NETEASE_163: 'smtp.163.com',
  }[platform];
}

function getDefaultImapPort(platform) {
  return platform === 'OUTLOOK' ? 587 : 993;
}

function getDefaultSmtpPort(platform) {
  return platform === 'OUTLOOK' ? 587 : 465;
}

function getEmailDomain(email) {
  return email ? email.split('@')[1] : '';
}

module.exports = {
  syncAccountsToEngine,
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  testConnection,
  selectBestAccount,
  activateAccount,
  deactivateAccount,
  getDistributionStats,
  getHealthStatus,
  batchImport,

  // Expose engine instances for advanced use
  get poolManager() { return poolManager; },
  get lifecycleManager() { return lifecycleManager; },
  get healthMonitor() { return healthMonitor; },
};
