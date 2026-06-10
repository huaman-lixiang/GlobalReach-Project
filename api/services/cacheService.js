const redis = require('redis');

class CacheService {
  constructor() {
    this.client = null;
    this.connected = false;
    this.defaultTTL = 300;
    this.connectionAttempted = false;
    // DEBT-024: Operation-level metrics for monitoring
    this.metrics = { hits: 0, misses: 0, sets: 0, deletes: 0, errors: 0 };
  }

  _logDebug(operation, key, result, duration) {
    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[CacheService] ${operation} key=${key} result=${result} duration=${duration}ms`);
    }
  }

  async connect() {
    if (this.connectionAttempted) {
      console.warn('[CacheService] Connection already attempted - skipping');
      return this.connected;
    }
    
    this.connectionAttempted = true;
    
    try {
      this.client = redis.createClient({
        url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
        password: process.env.REDIS_PASSWORD || undefined,
        database: parseInt(process.env.REDIS_DB || '0'),
        socket: {
          reconnectStrategy: () => new Error('Disabled')
        }
      });

      let errorLogged = false;
      this.client.on('error', (err) => {
        if (!errorLogged) {
          console.warn('[CacheService] Redis error:', err.message);
          errorLogged = true;
        }
        this.connected = false;
      });

      this.client.on('connect', () => {
        console.log('[CacheService] Redis connected');
        this.connected = true;
      });

      const connectPromise = this.client.connect();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 3000)
      );

      await Promise.race([connectPromise, timeoutPromise]);
      return true;
    } catch (err) {
      console.warn('[CacheService] Failed to connect to Redis:', err.message);
      console.warn('[CacheService] Running without cache - some features may be limited');
      this.connected = false;
      this.client = null;
      return false;
    }
  }

  async get(key) {
    if (!this.connected || !this.client) return null;
    const start = Date.now();
    try {
      const value = await this.client.get(key);
      if (value) {
        try {
          this.metrics.hits++;
          const parsed = JSON.parse(value);
          this._logDebug('GET', key, 'hit', Date.now() - start);
          return parsed;
        } catch {
          this.metrics.hits++;
          this._logDebug('GET', key, 'hit(raw)', Date.now() - start);
          return value;
        }
      }
      this.metrics.misses++;
      this._logDebug('GET', key, 'miss', Date.now() - start);
      return null;
    } catch (err) {
      this.metrics.errors++;
      console.error('[CacheService] Get error:', err.message);
      return null;
    }
  }

  async set(key, value, ttl = this.defaultTTL) {
    if (!this.connected || !this.client) return false;
    const start = Date.now();
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      if (ttl > 0) {
        await this.client.set(key, serialized, { EX: ttl });
      } else {
        await this.client.set(key, serialized);
      }
      this.metrics.sets++;
      this._logDebug('SET', key, `ok(ttl=${ttl}s)`, Date.now() - start);
      return true;
    } catch (err) {
      this.metrics.errors++;
      console.error('[CacheService] Set error:', err.message);
      return false;
    }
  }

  async del(key) {
    if (!this.connected || !this.client) return false;
    const start = Date.now();
    try {
      await this.client.del(key);
      this.metrics.deletes++;
      this._logDebug('DEL', key, 'ok', Date.now() - start);
      return true;
    } catch (err) {
      this.metrics.errors++;
      console.error('[CacheService] Delete error:', err.message);
      return false;
    }
  }

  async exists(key) {
    if (!this.connected || !this.client) return false;
    const start = Date.now();
    try {
      const result = await this.client.exists(key);
      this._logDebug('EXISTS', key, result === 1 ? 'true' : 'false', Date.now() - start);
      return result === 1;
    } catch (err) {
      this.metrics.errors++;
      console.error('[CacheService] Exists error:', err.message);
      return false;
    }
  }

  async flush() {
    if (!this.connected || !this.client) return false;
    try {
      await this.client.flushDb();
      return true;
    } catch (err) {
      console.error('[CacheService] Flush error:', err.message);
      return false;
    }
  }

  getStatsKey(userId, statType) {
    return `stats:${userId}:${statType}`;
  }

  getDashboardKey(userId) {
    return `dashboard:${userId}`;
  }

  getCampaignKey(campaignId) {
    return `campaign:${campaignId}`;
  }

  async getCachedStats(userId, statType) {
    const key = this.getStatsKey(userId, statType);
    return this.get(key);
  }

  async setCachedStats(userId, statType, data, ttl = 60) {
    const key = this.getStatsKey(userId, statType);
    return this.set(key, data, ttl);
  }

  async getCachedDashboard(userId) {
    const key = this.getDashboardKey(userId);
    return this.get(key);
  }

  async setCachedDashboard(userId, data, ttl = 120) {
    const key = this.getDashboardKey(userId);
    return this.set(key, data, ttl);
  }

  invalidateUserCache(userId) {
    const keys = [
      this.getDashboardKey(userId),
      this.getStatsKey(userId, 'today'),
      this.getStatsKey(userId, 'weekly'),
      this.getStatsKey(userId, 'monthly'),
    ];
    return Promise.all(keys.map(key => this.del(key)));
  }

  // DEBT-024: Expose metrics for monitoring and /metrics endpoint
  getMetrics() {
    const total = this.metrics.hits + this.metrics.misses;
    return {
      ...this.metrics,
      hitRatio: total > 0 ? (this.metrics.hits / total).toFixed(4) : 'N/A',
      totalOps: total + this.metrics.sets + this.metrics.deletes,
    };
  }

  async disconnect() {
    if (this.client) {
      try {
        await this.client.quit();
      } catch (e) {
        console.warn('[CacheService] Error during disconnect:', e.message);
      }
      this.connected = false;
    }
  }
}

const cacheService = new CacheService();

module.exports = {
  CacheService,
  cacheService,
};