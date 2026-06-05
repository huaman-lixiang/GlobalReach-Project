const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class LifecycleManager extends EventEmitter {
  constructor(accountPoolManager, options = {}) {
    super();
    this.poolManager = accountPoolManager;
    this.archivePath = options.archivePath || './archives/accounts';
    this.lifecycleStates = new Map();
    this.stateHistory = new Map();
    this.transitions = [];
    this.autoArchiveDays = options.autoArchiveDays || 90;
  }

  async activateAccount(accountId, credentials = null) {
    const account = this.poolManager.getAccount(accountId);
    
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const currentState = this.getState(accountId);
    
    if (currentState === 'active') {
      return { success: true, message: 'Account already active', state: 'active' };
    }

    if (credentials && account.status !== 'active') {
      account.credentials = { ...account.credentials, ...credentials };
    }

    try {
      await this.poolManager.activateAccount(accountId);
      
      await this._transitionState(accountId, currentState || 'inactive', 'active', {
        reason: 'manual_activation',
        performedBy: 'system'
      });

      this.emit('activated', { accountId, previousState: currentState });
      
      return { 
        success: true, 
        message: 'Account activated successfully',
        state: 'active'
      };
    } catch (error) {
      this.emit('activationFailed', { accountId, error: error.message });
      throw error;
    }
  }

  async deactivateAccount(accountId, reason = 'manual') {
    const account = this.poolManager.getAccount(accountId);
    
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const currentState = this.getState(accountId);

    if (currentState === 'inactive') {
      return { success: true, message: 'Account already inactive', state: 'inactive' };
    }

    try {
      this.poolManager.deactivateAccount(accountId);
      
      await this._transitionState(accountId, currentState, 'inactive', {
        reason,
        performedBy: 'system'
      });

      this.emit('deactivated', { accountId, previousState: currentState, reason });
      
      return { 
        success: true, 
        message: 'Account deactivated successfully',
        state: 'inactive'
      };
    } catch (error) {
      this.emit('deactivationFailed', { accountId, error: error.message });
      throw error;
    }
  }

  async archiveAccount(accountId, reason = 'no_longer_needed') {
    const account = this.poolManager.getAccount(accountId);
    
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const currentState = this.getState(accountId);

    if (!fs.existsSync(this.archivePath)) {
      fs.mkdirSync(this.archivePath, { recursive: true });
    }

    const archiveData = {
      ...account,
      archivedAt: new Date(),
      archiveReason: reason,
      previousState: currentState,
      lifecycleHistory: this.getHistory(accountId)
    };

    const archiveFile = path.join(
      this.archivePath, 
      `${accountId}_${Date.now()}.json`
    );

    fs.writeFileSync(archiveFile, JSON.stringify(archiveData, null, 2));

    try {
      this.poolManager.removeAccount(accountId);
      
      await this._transitionState(accountId, currentState, 'archived', {
        reason,
        archiveFile,
        performedBy: 'system'
      });

      this.emit('archived', { 
        accountId, 
        previousState: currentState, 
        reason,
        archiveFile 
      });

      return { 
        success: true, 
        message: 'Account archived successfully',
        state: 'archived',
        archiveFile
      };
    } catch (error) {
      this.emit('archiveFailed', { accountId, error: error.message });
      throw error;
    }
  }

  async restoreAccount(archiveFile) {
    if (!fs.existsSync(archiveFile)) {
      throw new Error(`Archive file not found: ${archiveFile}`);
    }

    const archiveData = JSON.parse(fs.readFileSync(archiveFile, 'utf-8'));
    const { id, platform, credentials, metadata } = archiveData;

    try {
      this.poolManager.addAccount({
        id,
        platform,
        credentials,
        metadata
      });

      await this._transitionState(id, 'archived', 'inactive', {
        reason: 'restored_from_archive',
        archiveFile,
        performedBy: 'system'
      });

      this.emit('restored', { accountId: id, archiveFile });
      
      return { 
        success: true, 
        message: 'Account restored successfully',
        accountId: id
      };
    } catch (error) {
      this.emit('restoreFailed', { error: error.message, archiveFile });
      throw error;
    }
  }

  getState(accountId) {
    return this.lifecycleStates.get(accountId) || 'unknown';
  }

  getHistory(accountId, limit = 50) {
    const history = this.stateHistory.get(accountId) || [];
    return history.slice(-limit);
  }

  async _transitionState(accountId, fromState, toState, metadata = {}) {
    const transition = {
      accountId,
      from: fromState,
      to: toState,
      timestamp: new Date(),
      metadata
    };

    this.lifecycleStates.set(accountId, toState);
    
    if (!this.stateHistory.has(accountId)) {
      this.stateHistory.set(accountId, []);
    }
    
    this.stateHistory.get(accountId).push(transition);
    this.transitions.push(transition);

    this.emit('stateChanged', transition);
  }

  getAccountsByState(state) {
    const allAccounts = this.poolManager.getAllAccounts();
    return allAccounts.filter(acc => this.getState(acc.id) === state);
  }

  getStateDistribution() {
    const distribution = {
      active: 0,
      inactive: 0,
      archived: 0,
      unknown: 0
    };

    const allAccounts = this.poolManager.getAllAccounts();
    
    allAccounts.forEach(acc => {
      const state = this.getState(acc.id);
      distribution[state] = (distribution[state] || 0) + 1;
    });

    return distribution;
  }

  async autoCleanup() {
    const inactiveAccounts = this.getAccountsByState('inactive');
    let archivedCount = 0;

    for (const account of inactiveAccounts) {
      const history = this.getHistory(account.id);
      const lastTransition = history[history.length - 1];
      
      if (lastTransition) {
        const daysInactive = Math.floor(
          (Date.now() - new Date(lastTransition.timestamp).getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysInactive > this.autoArchiveDays) {
          try {
            await this.archiveAccount(account.id, `auto_archive_${daysInactive}_days_inactive`);
            archivedCount++;
          } catch (error) {
            console.error(`Auto-archive failed for ${account.id}:`, error.message);
          }
        }
      }
    }

    this.emit('autoCleanupCompleted', { archivedCount });
    return { archivedCount, processed: inactiveAccounts.length };
  }

  getLifecycleReport() {
    const distribution = this.getStateDistribution();
    const recentTransitions = this.transitions.slice(-20);
    
    const avgLifetime = this._calculateAverageLifetime();
    const stateChangesToday = this.transitions.filter(t => {
      const today = new Date().toISOString().split('T')[0];
      return t.timestamp.toISOString().startsWith(today);
    }).length;

    return {
      timestamp: new Date(),
      totalAccounts: this.poolManager.getAllAccounts().length,
      distribution,
      recentTransitions,
      avgLifetimeDays: avgLifetime,
      stateChangesToday,
      archiveStats: {
        archivePath: this.archivePath,
        autoArchiveDays: this.autoArchiveDays,
        archivedFiles: this._countArchivedFiles()
      }
    };
  }

  _calculateAverageLifetime() {
    const archivedTransitions = this.transitions.filter(t => t.to === 'archived');
    
    if (archivedTransitions.length === 0) return null;

    let totalDays = 0;
    let count = 0;

    for (const transition of archivedTransitions) {
      const history = this.getHistory(transition.accountId);
      const firstActivation = history.find(h => h.to === 'active');
      
      if (firstActivation) {
        const days = Math.floor(
          (new Date(transition.timestamp) - new Date(firstActivation.timestamp)) / (1000 * 60 * 60 * 24)
        );
        totalDays += days;
        count++;
      }
    }

    return count > 0 ? Math.round(totalDays / count) : null;
  }

  _countArchivedFiles() {
    try {
      if (!fs.existsSync(this.archivePath)) return 0;
      return fs.readdirSync(this.archivePath).filter(f => f.endsWith('.json')).length;
    } catch (error) {
      return 0;
    }
  }

  exportLifecycleData(outputPath) {
    const data = {
      exportedAt: new Date(),
      states: Object.fromEntries(this.lifecycleStates),
      transitions: this.transitions.slice(-100),
      report: this.getLifecycleReport()
    };

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    
    return {
      success: true,
      filePath: outputPath,
      recordCount: this.transitions.length
    };
  }
}

module.exports = LifecycleManager;
