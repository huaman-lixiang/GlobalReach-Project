const express = require('express');
const { param, query } = require('express-validator');
const router = express.Router();

const PlatformFactory = require('../../src/modules/m7-multi-platform-manager/PlatformFactory');
const PlatformConfigManager = require('../../src/modules/m7-multi-platform-manager/PlatformConfigManager');
const HealthMonitor = require('../../src/modules/m7-multi-platform-manager/HealthMonitor');
const AccountPoolManager = require('../../src/modules/m7-multi-platform-manager/AccountPoolManager');

const configManager = new PlatformConfigManager();
const poolManager = new AccountPoolManager();
const healthMonitor = new HealthMonitor();
const { verifyToken, requireRole, validateRequest } = require('../middleware/auth');

router.use(verifyToken);

router.get('/', (req, res) => {
  try {
    const platforms = PlatformFactory.getSupportedPlatforms();
    
    res.success(platforms.map(p => ({
      ...p,
      config: configManager.getPlatformConfig(p.type),
      accounts: poolManager.getAccountsByPlatform(p.type).length
    })));
  } catch (error) {
    res.error(error.message, 500, 'FETCH_PLATFORMS_FAILED');
  }
});

router.get('/:platformType/config', [
  param('platformType').isIn(['gmail', 'outlook', 'qq', '163', 'custom'])
], validateRequest, (req, res) => {
  try {
    const config = configManager.getPlatformConfig(req.params.platformType);
    res.success(config);
  } catch (error) {
    res.error(error.message, 404, 'PLATFORM_NOT_FOUND');
  }
});

router.put('/:platformType/config', requireRole('admin'), [
  param('platformType').isIn(['gmail', 'outlook', 'qq', '163', 'custom'])
], validateRequest, (req, res) => {
  try {
    const updated = configManager.updatePlatformConfig(req.params.platformType, req.body);
    res.success(updated, 'Platform configuration updated');
  } catch (error) {
    res.error(error.message, 400, 'CONFIG_UPDATE_FAILED');
  }
});

router.get('/:platformType/accounts', [
  param('platformType').isIn(['gmail', 'outlook', 'qq', '163', 'custom'])
], validateRequest, (req, res) => {
  try {
    const accountIds = poolManager.getAccountsByPlatform(req.params.platformType);
    const accounts = accountIds.map(id => {
      const acc = poolManager.getAccount(id);
      return {
        id: acc.id,
        status: acc.status,
        healthStatus: healthMonitor.getState ? 'unknown' : 'unknown',
        lastUsed: acc.lastUsed
      };
    });
    
    res.success(accounts);
  } catch (error) {
    res.error(error.message, 500, 'FETCH_PLATFORM_ACCOUNTS_FAILED');
  }
});

router.get('/:platformType/rate-limit', [
  param('platformType').isIn(['gmail', 'outlook', 'qq', '163', 'custom'])
], validateRequest, (req, res) => {
  try {
    const limit = configManager.checkRateLimit(
      req.query.accountId || 'default',
      req.params.platformType
    );
    
    res.success(limit);
  } catch (error) {
    res.error(error.message, 500, 'RATE_LIMIT_CHECK_FAILED');
  }
});

router.get('/:platformType/health', [
  param('platformType').isIn(['gmail', 'outlook', 'qq', '163', 'custom'])
], validateRequest, async (req, res) => {
  try {
    const accounts = poolManager.getHealthyAccounts(req.params.platformType);
    const healthResults = [];

    for (const account of accounts.slice(0, 5)) {
      try {
        const health = await healthMonitor.checkAccountHealth(account.id);
        healthResults.push(health);
      } catch (error) {
        healthResults.push({
          accountId: account.id,
          status: 'error',
          error: error.message
        });
      }
    }

    res.success({
      platform: req.params.platformType,
      healthyAccounts: accounts.length,
      checkedAccounts: healthResults.length,
      details: healthResults
    });
  } catch (error) {
    res.error(error.message, 500, 'HEALTH_CHECK_FAILED');
  }
});

router.post('/:platformType/test-connection', requireRole('admin'), async (req, res) => {
  try {
    const platform = PlatformFactory.create(req.params.platformType);
    
    const testResult = await platform.connect(req.body.credentials || {});
    
    await platform.disconnect();
    
    res.success(testResult, 'Connection test successful');
  } catch (error) {
    res.error(error.message, 400, 'CONNECTION_TEST_FAILED');
  }
});

module.exports = router;