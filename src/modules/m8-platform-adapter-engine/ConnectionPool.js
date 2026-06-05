class ConnectionPool {
  constructor(options = {}) {
    this.maxConnections = options.maxConnections || 10;
    this.idleTimeout = options.idleTimeout || 5 * 60 * 1000;
    this.pools = new Map();
    this.activeConnections = new Map();
    this.stats = {
      created: 0,
      destroyed: 0,
      reused: 0,
      errors: 0
    };
  }

  async getConnection(platformType, accountId) {
    const poolKey = `${platformType}-${accountId}`;

    if (!this.pools.has(poolKey)) {
      this.pools.set(poolKey, []);
    }

    const pool = this.pools.get(poolKey);

    while (pool.length > 0) {
      const connection = pool.pop();
      if (connection.lastUsed && (Date.now() - connection.lastUsed.getTime()) < this.idleTimeout) {
        this.stats.reused++;
        connection.inUse = true;
        return connection;
      } else {
        try {
          await connection.instance.disconnect();
          this.stats.destroyed++;
        } catch (error) {
          console.error('Error destroying idle connection:', error.message);
        }
      }
    }

    if (this.activeConnections.size >= this.maxConnections) {
      throw new Error('Connection pool exhausted');
    }

    return null;
  }

  releaseConnection(platformType, accountId, connection) {
    if (!connection) return;

    const poolKey = `${platformType}-${accountId}`;
    
    if (!this.pools.has(poolKey)) {
      this.pools.set(poolKey, []);
    }

    connection.inUse = false;
    connection.lastUsed = new Date();
    this.pools.get(poolKey).push(connection);
  }

  trackConnection(platformType, accountId, instance) {
    const connectionId = `${platformType}-${accountId}-${Date.now()}`;
    const connection = {
      id: connectionId,
      platformType,
      accountId,
      instance,
      createdAt: new Date(),
      lastUsed: new Date(),
      inUse: true
    };

    this.activeConnections.set(connectionId, connection);
    this.stats.created++;
    return connectionId;
  }

  removeConnection(connectionId) {
    const connection = this.activeConnections.get(connectionId);
    if (connection) {
      this.activeConnections.delete(connectionId);
      this.stats.destroyed++;
      return true;
    }
    return false;
  }

  async cleanupIdleConnections() {
    let cleanedCount = 0;

    for (const [poolKey, pool] of this.pools) {
      const activePool = [];
      
      for (const connection of pool) {
        if ((Date.now() - connection.lastUsed.getTime()) > this.idleTimeout) {
          try {
            await connection.instance.disconnect();
            cleanedCount++;
            this.stats.destroyed++;
          } catch (error) {
            console.error(`Error cleaning up connection ${connection.id}:`, error.message);
            this.stats.errors++;
          }
        } else {
          activePool.push(connection);
        }
      }

      this.pools.set(poolKey, activePool);
    }

    return cleanedCount;
  }

  getStats() {
    let totalPooled = 0;
    for (const [, pool] of this.pools) {
      totalPooled += pool.length;
    }

    return {
      ...this.stats,
      activeConnections: this.activeConnections.size,
      pooledConnections: totalPooled,
      pools: this.pools.size
    };
  }

  async shutdown() {
    for (const [poolKey, pool] of this.pools) {
      for (const connection of pool) {
        try {
          await connection.instance.disconnect();
          this.stats.destroyed++;
        } catch (error) {
          console.error('Error during shutdown:', error.message);
        }
      }
      this.pools.delete(poolKey);
    }

    for (const [connectionId, connection] of this.activeConnections) {
      try {
        await connection.instance.disconnect();
        this.stats.destroyed++;
      } catch (error) {
        console.error('Error shutting down active connection:', error.message);
      }
      this.activeConnections.delete(connectionId);
    }
  }
}

module.exports = ConnectionPool;
