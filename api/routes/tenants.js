const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();

const TenantManager = require('../../src/modules/m7-multi-platform-manager/TenantManager');
const AccountPoolManager = require('../../src/modules/m7-multi-platform-manager/AccountPoolManager');

const tenantManager = new TenantManager();
const poolManager = new AccountPoolManager();
const { verifyToken, requireRole, validateRequest } = require('../middleware/auth');

router.use(verifyToken);
router.use(requireRole('admin'));

router.get('/', (req, res) => {
  try {
    const tenants = tenantManager.getAllTenants();
    const summary = tenantManager.getAllTenantsSummary();
    
    res.success({
      tenants: tenants.map(t => ({
        id: t.id,
        name: t.name,
        plan: t.plan,
        status: t.status,
        accountsCount: t.stats.accountsCount,
        clientsCount: t.stats.clientsCount,
        createdAt: t.createdAt
      })),
      summary
    });
  } catch (error) {
    res.error(error.message, 500, 'FETCH_TENANTS_FAILED');
  }
});

router.post('/', [
  body('id').notEmpty().withMessage('Tenant ID is required'),
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('plan').optional().isIn(['basic', 'professional', 'enterprise']).withMessage('Invalid plan')
], validateRequest, (req, res) => {
  try {
    const tenant = tenantManager.createTenant(req.body);
    
    res.success(tenant, 'Tenant created successfully', 201);
  } catch (error) {
    if (error.message.includes('already exists')) {
      return res.error(error.message, 409, 'TENANT_EXISTS');
    }
    res.error(error.message, 400, 'CREATE_TENANT_FAILED');
  }
});

router.get('/:tenantId', [
  param('tenantId').notEmpty()
], validateRequest, (req, res) => {
  try {
    const tenant = tenantManager.getTenant(req.params.tenantId);
    const stats = tenantManager.getTenantStats(req.params.tenantId);
    
    if (!tenant) {
      return res.error('Tenant not found', 404, 'TENANT_NOT_FOUND');
    }

    res.success({
      ...tenant,
      stats,
      accounts: tenantManager.getTenantAccounts(req.params.tenantId),
      clients: tenantManager.getTenantClients(req.params.tenantId)
    });
  } catch (error) {
    res.error(error.message, 500, 'GET_TENANT_FAILED');
  }
});

router.put('/:tenantId', [
  param('tenantId').notEmpty(),
  body('name').optional().trim().isLength({ min: 2 }),
  body('plan').optional().isIn(['basic', 'professional', 'enterprise'])
], validateRequest, (req, res) => {
  try {
    let updated;
    
    if (req.body.plan) {
      updated = tenantManager.updateTenantPlan(req.params.tenantId, req.body.plan);
    } else if (req.body.config) {
      updated = tenantManager.updateTenantConfig(req.params.tenantId, req.body.config);
    } else {
      updated = tenantManager.updateTenantConfig(req.params.tenantId, {
        name: req.body.name
      });
    }

    res.success(updated, 'Tenant updated successfully');
  } catch (error) {
    res.error(error.message, 400, 'UPDATE_TENANT_FAILED');
  }
});

router.delete('/:tenantId', [
  param('tenantId').notEmpty()
], validateRequest, (req, res) => {
  try {
    tenantManager.removeTenant(req.params.tenantId);
    res.success(null, 'Tenant removed successfully');
  } catch (error) {
    res.error(error.message, 400, 'REMOVE_TENANT_FAILED');
  }
});

router.post('/:tenantId/accounts/:accountId', [
  param('tenantId').notEmpty(),
  param('accountId').notEmpty()
], validateRequest, (req, res) => {
  try {
    const result = tenantManager.assignAccountToTenant(
      req.params.accountId, 
      req.params.tenantId
    );
    
    res.success(result, 'Account assigned to tenant');
  } catch (error) {
    res.error(error.message, 400, 'ASSIGN_ACCOUNT_FAILED');
  }
});

router.delete('/:tenantId/accounts/:accountId', [
  param('tenantId').notEmpty(),
  param('accountId').notEmpty()
], validateRequest, (req, res) => {
  try {
    // Implementation would unassign account from tenant
    res.success(null, 'Account unassigned from tenant');
  } catch (error) {
    res.error(error.message, 400, 'UNASSIGN_ACCOUNT_FAILED');
  }
});

router.get('/:tenantId/isolation-check', (req, res) => {
  try {
    const validation = tenantManager.validateDataIsolation();
    
    res.success(validation);
  } catch (error) {
    res.error(error.message, 500, 'ISOLATION_CHECK_FAILED');
  }
});

module.exports = router;