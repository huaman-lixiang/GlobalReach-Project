const redis = require('redis');

class CacheService {
  constructor() {
    this.client = null;
    this.connected = false;
    this.defaultTTL = 300;
    this.connectionAttempted = false;
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
    try {
      const value = await this.client.get(key);
      if (value) {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return null;
    } catch (err) {
      console.error('[CacheService] Get error:', err.message);
      return null;
    }
  }

  async set(key, value, ttl = this.defaultTTL) {
    if (!this.connected || !this.client) return false;
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      if (ttl > 0) {
        await this.client.set(key, serialized, { EX: ttl });
      } else {
        await this.client.set(key, serialized);
      }
      return true;
    } catch (err) {
      console.error('[CacheService] Set error:', err.message);
      return false;
    }
  }

  async del(key) {
    if (!this.connected || !this.client) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (err) {
      console.error('[CacheService] Delete error:', err.message);
      return false;
    }
  }

  async exists(key) {
    if (!this.connected || !this.client) return false;
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (err) {
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