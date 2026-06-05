/**
 * Accounts Route - D02 Service Layer Integration
 *
 * All endpoints delegate to accountService which bridges
 * Sequelize DB ↔ M7 AccountPoolManager engine.
 *
 * IMPORTANT: Literal paths MUST be defined before /:id parameterized routes.
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const accountService = require('../services/accountService');
const { verifyToken, requireRole, validateRequest } = require('../middleware/auth');
const { paginationRules, PLATFORM_VALUES } = require('../middleware/validator');

router.use(verifyToken);

// ============================================
// Literal path routes (MUST come before /:id)
// ============================================

// GET /api/accounts - List with pagination + engine status
router.get('/', ...paginationRules(), async (req, res) => {
  try {
    const result = await accountService.listAccounts(req.user.id, req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Accounts] List error:', error);
    res.status(500).json({ success: false, error: 'FETCH_ACCOUNTS_FAILED', message: error.message || 'Failed to fetch accounts' });
  }
});

// GET /api/accounts/select-best - M7 Optimal selection algorithm
router.get('/select-best', [
  query('platform').optional().isIn(PLATFORM_VALUES).withMessage(`Invalid platform: ${PLATFORM_VALUES.join(',')}`),
  query('region').optional().trim().isLength({ max: 50 }).escape(),
], validateRequest, async (req, res) => {
  try {
    const result = await accountService.selectBestAccount(req.user.id, {
      targetRegion: req.query.region,
      requiredPlatform: req.query.platform,
    });

    res.json(result.success ? { success: true, data: result } : { success: false, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'SELECTION_FAILED', message: error.message });
  }
});

// GET /api/accounts/stats/distribution - Platform distribution
router.get('/stats/distribution', async (req, res) => {
  try {
    const stats = await accountService.getDistributionStats(req.user.id);
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: 'STATS_FETCH_FAILED', message: error.message });
  }
});

// GET /api/accounts/health - Comprehensive health status
router.get('/health', async (req, res) => {
  try {
    const health = await accountService.getHealthStatus(req.user.id);
    res.json({ success: true, data: health });
  } catch (error) {
    res.status(500).json({ success: false, error: 'HEALTH_CHECK_FAILED', message: error.message });
  }
});

// ============================================
// Parameterized routes (/ :id)
// ============================================

// GET /api/accounts/:id - Single account with engine state
router.get('/:id', [param('id').isUUID()], validateRequest, async (req, res) => {
  try {
    const account = await accountService.getAccount(req.params.id, req.user.id);
    if (!account) return res.status(404).json({ success: false, error: 'ACCOUNT_NOT_FOUND', message: 'Account not found' });

    res.json({ success: true, data: account });
  } catch (error) {
    console.error('[Accounts] Get error:', error);
    res.status(500).json({ success: false, error: 'GET_ACCOUNT_FAILED', message: error.message || 'Failed to fetch account' });
  }
});

// POST /api/accounts - Create (DB + Engine registration)
router.post('/', requireRole('admin'), [
  body('platform').isIn(['GMAIL','OUTLOOK','QQ','NETEASE_163','CUSTOM_SMTP']).withMessage('Invalid platform'),
  body('email').isEmail().withMessage('Invalid email format'),
  body('password').notEmpty().withMessage('Password is required'),
], validateRequest, async (req, res) => {
  try {
    const account = await accountService.createAccount(req.user.id, {
      ...req.body,
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, data: account, message: 'Account created and registered with engine' });
  } catch (error) {
    const status = error.code === 'ACCOUNT_EXISTS' ? 409 : 400;
    res.status(status).json({
      success: false,
      error: error.code || 'CREATE_ACCOUNT_FAILED',
      message: error.message || 'Failed to create account',
    });
  }
});

// PUT /api/accounts/:id - Update (DB + Engine sync)
router.put('/:id', requireRole('admin'), [
  param('id').isUUID(),
  body('status').optional().isIn(['ACTIVE','RESTRICTED','BANNED','ERROR']),
], validateRequest, async (req, res) => {
  try {
    const updated = await accountService.updateAccount(req.params.id, req.user.id, {
      ...req.body,
      ipAddress: req.ip,
    });

    res.json({ success: true, data: updated, message: 'Updated successfully' });
  } catch (error) {
    const status = error.code === 'NOT_FOUND' ? 404 : 500;
    res.status(status).json({
      success: false,
      error: error.code || 'UPDATE_ACCOUNT_FAILED',
      message: error.message || 'Update failed',
    });
  }
});

// DELETE /api/accounts/:id - Delete (DB + Engine removal)
router.delete('/:id', requireRole('admin'), [param('id').isUUID()], validateRequest, async (req, res) => {
  try {
    await accountService.deleteAccount(req.params.id, req.user.id);
    res.json({ success: true, message: 'Deleted successfully' });
  } catch (error) {
    const status = error.code === 'NOT_FOUND' ? 404 : 500;
    res.status(status).json({
      success: false,
      error: error.code || 'DELETE_ACCOUNT_FAILED',
      message: error.message || 'Delete failed',
    });
  }
});

// POST /api/accounts/:id/test-connection - M7 Engine test
router.post('/:id/test-connection', requireRole('admin'), [param('id').isUUID()], validateRequest, async (req, res) => {
  try {
    const result = await accountService.testConnection(req.params.id, req.user.id);

    res.json({
      success: true,
      data: result,
      message: result.connected ? `Connection OK (${result.latencyMs}ms)` : `Failed: ${result.reason}`,
    });
  } catch (error) {
    const status = error.code === 'NOT_FOUND' ? 404 : 500;
    res.status(status).json({
      success: false,
      error: error.code || 'TEST_CONNECTION_FAILED',
      message: error.message || 'Connection test failed',
    });
  }
});

// POST /api/accounts/:id/activate - Activate in M7 Engine
router.post('/:id/activate', requireRole('admin'), [param('id').isUUID()], validateRequest, async (req, res) => {
  try {
    const result = await accountService.activateAccount(req.params.id, req.user.id);

    res.json({
      success: result.success !== false,
      data: result,
      message: result.success !== false ? 'Account activated' : `Activation failed: ${result.error || result.message}`,
    });
  } catch (error) {
    const status = error.code === 'NOT_FOUND' ? 404 : 500;
    res.status(status).json({
      success: false,
      error: error.code || 'ACTIVATION_FAILED',
      message: error.message,
    });
  }
});

// POST /api/accounts/:id/deactivate - Deactivate in M7 Engine
router.post('/:id/deactivate', requireRole('admin'), [param('id').isUUID()], validateRequest, async (req, res) => {
  try {
    const result = await accountService.deactivateAccount(req.params.id, req.user.id);
    res.json({ success: true, data: result, message: 'Account deactivated' });
  } catch (error) {
    const status = error.code === 'NOT_FOUND' ? 404 : 500;
    res.status(status).json({
      success: false,
      error: error.code || 'DEACTIVATION_FAILED',
      message: error.message,
    });
  }
});

// POST /api/accounts/batch-import - Batch import accounts
router.post('/batch-import', requireRole('admin'), [
  body('accounts').isArray({ min: 1 }).withMessage('Accounts array is required'),
  body('accounts.*.platform').isIn(['GMAIL','OUTLOOK','QQ','NETEASE_163','CUSTOM_SMTP']),
  body('accounts.*.email').isEmail(),
  body('accounts.*.password').notEmpty(),
], validateRequest, async (req, res) => {
  try {
    const results = await accountService.batchImport(req.body.accounts, req.user.id);
    const successCount = results.filter(r => r.success).length;

    res.status(207).json({
      success: true,
      data: {
        total: results.length,
        imported: successCount,
        failed: results.length - successCount,
        results,
      },
      message: `Batch import completed: ${successCount}/${results.length} successful`,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: 'BATCH_IMPORT_FAILED', message: error.message });
  }
});

module.exports = router;
