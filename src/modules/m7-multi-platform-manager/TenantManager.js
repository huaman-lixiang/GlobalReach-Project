class TenantManager {
  constructor(options = {}) {
    this.tenants = new Map();
    this.defaultTenantId = options.defaultTenantId || 'default';
    this.dataIsolationEnabled = options.dataIsolationEnabled !== false;
    this.configOverrides = new Map();
  }

  createTenant(tenantConfig) {
    const { id, name, plan = 'basic', config = {} } = tenantConfig;

    if (this.tenants.has(id)) {
      throw new Error(`Tenant ${id} already exists`);
    }

    const tenant = {
      id,
      name,
      plan,
      config,
      createdAt: new Date(),
      status: 'active',
      accountIds: new Set(),
      clientIds: new Set(),
      stats: {
        accountsCount: 0,
        clientsCount: 0,
        emailsSent: 0,
        lastActivity: null
      }
    };

    this.tenants.set(id, tenant);
    
    if (config.overrides) {
      this.configOverrides.set(id, config.overrides);
    }

    return tenant;
  }

  getTenant(tenantId) {
    return this.tenants.get(tenantId) || null;
  }

  getDefaultTenant() {
    return this.getTenant(this.defaultTenantId);
  }

  getAllTenants() {
    return Array.from(this.tenants.values());
  }

  assignAccountToTenant(accountId, tenantId) {
    const tenant = this.getTenant(tenantId);
    
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    if (this.dataIsolationEnabled) {
      for (const [existingTenantId, existingTenant] of this.tenants) {
        if (existingTenant.accountIds.has(accountId) && existingTenantId !== tenantId) {
          existingTenant.accountIds.delete(accountId);
          existingTenant.stats.accountsCount = existingTenant.accountIds.size;
        }
      }
    }

    tenant.accountIds.add(accountId);
    tenant.stats.accountsCount = tenant.accountIds.size;
    tenant.stats.lastActivity = new Date();

    return { success: true, tenantId, accountId };
  }

  assignClientToTenant(clientId, tenantId) {
    const tenant = this.getTenant(tenantId);
    
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    if (this.dataIsolationEnabled) {
      for (const [existingTenantId, existingTenant] of this.tenants) {
        if (existingTenant.clientIds.has(clientId) && existingTenantId !== tenantId) {
          existingTenant.clientIds.delete(clientId);
          existingTenant.stats.clientsCount = existingTenant.clientIds.size;
        }
      }
    }

    tenant.clientIds.add(clientId);
    tenant.stats.clientsCount = tenant.clientIds.size;
    tenant.stats.lastActivity = new Date();

    return { success: true, tenantId, clientId };
  }

  getTenantAccounts(tenantId) {
    const tenant = this.getTenant(tenantId);
    
    if (!tenant) {
      return [];
    }

    return Array.from(tenant.accountIds);
  }

  getTenantClients(tenantId) {
    const tenant = this.getTenant(tenantId);
    
    if (!tenant) {
      return [];
    }

    return Array.from(tenant.clientIds);
  }

  canAccess(tenantId, resourceId, resourceType = 'account') {
    if (!this.dataIsolationEnabled) {
      return true;
    }

    const tenant = this.getTenant(tenantId);
    
    if (!tenant) {
      return false;
    }

    switch (resourceType) {
      case 'account':
        return tenant.accountIds.has(resourceId);
      case 'client':
        return tenant.clientIds.has(resourceId);
      default:
        return true;
    }
  }

  getConfigForTenant(tenantId, defaultConfig = {}) {
    const tenant = this.getTenant(tenantId) || this.getDefaultTenant();
    const overrides = this.configOverrides.get(tenantId) || {};
    
    return {
      ...defaultConfig,
      ...(tenant?.config || {}),
      ...overrides
    };
  }

  updateTenantConfig(tenantId, configUpdates) {
    const tenant = this.getTenant(tenantId);
    
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    Object.assign(tenant.config, configUpdates);
    tenant.stats.lastActivity = new Date();

    return { success: true, config: tenant.config };
  }

  updateTenantPlan(tenantId, newPlan) {
    const validPlans = ['basic', 'professional', 'enterprise'];
    
    if (!validPlans.includes(newPlan)) {
      throw new Error(`Invalid plan: ${newPlan}. Valid plans: ${validPlans.join(', ')}`);
    }

    const tenant = this.getTenant(tenantId);
    
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    const oldPlan = tenant.plan;
    tenant.plan = newPlan;
    tenant.stats.lastActivity = new Date();

    return { 
      success: true, 
      oldPlan, 
      newPlan,
      upgraded: validPlans.indexOf(newPlan) > validPlans.indexOf(oldPlan)
    };
  }

  deactivateTenant(tenantId, reason = 'admin_action') {
    const tenant = this.getTenant(tenantId);
    
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    tenant.status = 'inactive';
    tenant.deactivatedAt = new Date();
    tenant.deactivationReason = reason;

    return { success: true, status: 'inactive' };
  }

  activateTenant(tenantId) {
    const tenant = this.getTenant(tenantId);
    
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    tenant.status = 'active';
    delete tenant.deactivatedAt;
    delete tenant.deactivationReason;

    return { success: true, status: 'active' };
  }

  removeTenant(tenantId) {
    if (tenantId === this.defaultTenantId) {
      throw new Error('Cannot remove default tenant');
    }

    const tenant = this.getTenant(tenantId);
    
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    if (tenant.accountIds.size > 0 || tenant.clientIds.size > 0) {
      throw new Error(`Cannot remove tenant with assigned resources. Unassign all accounts and clients first.`);
    }

    this.tenants.delete(tenantId);
    this.configOverrides.delete(tenantId);

    return { success: true };
  }

  getTenantStats(tenantId) {
    const tenant = this.getTenant(tenantId);
    
    if (!tenant) {
      return null;
    }

    return {
      ...tenant.stats,
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
      status: tenant.status,
      createdAt: tenant.createdAt
    };
  }

  getAllTenantsSummary() {
    const tenants = this.getAllTenants();
    
    return {
      totalTenants: tenants.length,
      activeTenants: tenants.filter(t => t.status === 'active').length,
      byPlan: {
        basic: tenants.filter(t => t.plan === 'basic').length,
        professional: tenants.filter(t => t.plan === 'professional').length,
        enterprise: tenants.filter(t => t.plan === 'enterprise').length
      },
      totalAccounts: Array.from(this.tenants.values()).reduce((sum, t) => sum + t.accountIds.size, 0),
      totalClients: Array.from(this.tenants.values()).reduce((sum, t) => sum + t.clientIds.size, 0)
    };
  }

  validateDataIsolation() {
    if (!this.dataIsolationEnabled) {
      return { valid: true, message: 'Data isolation disabled' };
    }

    const accountConflicts = [];
    const clientConflicts = [];

    const allAccounts = new Map();
    const allClients = new Map();

    for (const [tenantId, tenant] of this.tenants) {
      for (const accountId of tenant.accountIds) {
        if (allAccounts.has(accountId) && allAccounts.get(accountId) !== tenantId) {
          accountConflicts.push({
            resourceId: accountId,
            tenants: [allAccounts.get(accountId), tenantId]
          });
        }
        allAccounts.set(accountId, tenantId);
      }

      for (const clientId of tenant.clientIds) {
        if (allClients.has(clientId) && allClients.get(clientId) !== tenantId) {
          clientConflicts.push({
            resourceId: clientId,
            tenants: [allClients.get(clientId), tenantId]
          });
        }
        allClients.set(clientId, tenantId);
      }
    }

    return {
      valid: accountConflicts.length === 0 && clientConflicts.length === 0,
      accountConflicts,
      clientConflicts,
      message: accountConflicts.length === 0 && clientConflicts.length === 0 
        ? 'Data isolation validated successfully' 
        : `Found ${accountConflicts.length} account conflicts and ${clientConflicts.length} client conflicts`
    };
  }
}

module.exports = TenantManager;
