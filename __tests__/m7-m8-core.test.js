const IEmailPlatform = require('../src/modules/m7-multi-platform-manager/IEmailPlatform');
const PlatformFactory = require('../src/modules/m7-multi-platform-manager/PlatformFactory');
const AccountPoolManager = require('../src/modules/m7-multi-platform-manager/AccountPoolManager');
const PlatformConfigManager = require('../src/modules/m7-multi-platform-manager/PlatformConfigManager');
const HealthMonitor = require('../src/modules/m7-multi-platform-manager/HealthMonitor');

describe('M7-M8 Core Architecture Tests', () => {
  describe('IEmailPlatform Interface', () => {
    test('should not allow direct instantiation', () => {
      expect(() => new IEmailPlatform()).toThrow(
        'IEmailPlatform is an abstract class and cannot be instantiated directly'
      );
    });

    test('should have all required methods defined', () => {
      class TestPlatform extends IEmailPlatform {}
      const instance = new TestPlatform('test');
      
      expect(typeof instance.connect).toBe('function');
      expect(typeof instance.send).toBe('function');
      expect(typeof instance.fetchUnread).toBe('function');
      expect(typeof instance.getQuota).toBe('function');
      expect(typeof instance.healthCheck).toBe('function');
      expect(typeof instance.disconnect).toBe('function');
      expect(typeof instance.getPlatformInfo).toBe('function');
    });

    test('methods should throw by default', async () => {
      class TestPlatform extends IEmailPlatform {}
      const instance = new TestPlatform('test');
      
      await expect(instance.connect({})).rejects.toThrow('must be implemented');
      await expect(instance.send({})).rejects.toThrow('must be implemented');
      await expect(instance.fetchUnread()).rejects.toThrow('must be implemented');
      await expect(instance.getQuota()).rejects.toThrow('must be implemented');
      await expect(instance.healthCheck()).rejects.toThrow('must be implemented');
      await expect(instance.disconnect()).rejects.toThrow('must be implemented');
    });
  });

  describe('PlatformFactory', () => {
    test('should create correct platform instances', () => {
      const gmail = PlatformFactory.create('gmail');
      const outlook = PlatformFactory.create('outlook');
      const qq = PlatformFactory.create('qq');
      const mail163 = PlatformFactory.create('163');
      const custom = PlatformFactory.create('custom');

      expect(gmail.platformType).toBe('gmail');
      expect(outlook.platformType).toBe('outlook');
      expect(qq.platformType).toBe('qq');
      expect(mail163.platformType).toBe('163');
      expect(custom.platformType).toBe('custom');
    });

    test('should throw for unsupported platform', () => {
      expect(() => PlatformFactory.create('invalid')).toThrow('Unsupported platform type');
    });

    test('should return supported platforms list', () => {
      const platforms = PlatformFactory.getSupportedPlatforms();
      
      expect(platforms).toHaveLength(5);
      expect(platforms.map(p => p.type)).toContain('gmail');
      expect(platforms.map(p => p.type)).toContain('outlook');
      expect(platforms.map(p => p.type)).toContain('qq');
      expect(platforms.map(p => p.type)).toContain('163');
      expect(platforms.map(p => p.type)).toContain('custom');
    });

    test('should be case insensitive', () => {
      const gmail1 = PlatformFactory.create('GMAIL');
      const gmail2 = PlatformFactory.create('Gmail');
      
      expect(gmail1.platformType).toBe('gmail');
      expect(gmail2.platformType).toBe('gmail');
    });
  });

  describe('AccountPoolManager', () => {
    let poolManager;

    beforeEach(() => {
      poolManager = new AccountPoolManager();
    });

    test('should add account successfully', () => {
      const account = poolManager.addAccount({
        id: 'test-001',
        platform: 'gmail',
        credentials: { email: 'test@gmail.com' }
      });

      expect(account.id).toBe('test-001');
      expect(account.platform).toBe('gmail');
      expect(account.status).toBe('inactive');
    });

    test('should prevent duplicate accounts', () => {
      poolManager.addAccount({
        id: 'test-001',
        platform: 'gmail',
        credentials: { email: 'test@gmail.com' }
      });

      expect(() => {
        poolManager.addAccount({
          id: 'test-001',
          platform: 'gmail',
          credentials: { email: 'test2@gmail.com' }
        });
      }).toThrow('already exists');
    });

    test('should group accounts by platform', () => {
      poolManager.addAccount({
        id: 'gmail-1',
        platform: 'gmail',
        credentials: { email: 'g1@gmail.com' }
      });
      poolManager.addAccount({
        id: 'gmail-2',
        platform: 'gmail',
        credentials: { email: 'g2@gmail.com' }
      });
      poolManager.addAccount({
        id: 'outlook-1',
        platform: 'outlook',
        credentials: { email: 'o1@outlook.com' }
      });

      const gmailAccounts = poolManager.getAccountsByPlatform('gmail');
      const outlookAccounts = poolManager.getAccountsByPlatform('outlook');

      expect(gmailAccounts).toHaveLength(2);
      expect(outlookAccounts).toHaveLength(1);
    });

    test('should remove account and cleanup', () => {
      poolManager.addAccount({
        id: 'test-remove',
        platform: 'gmail',
        credentials: { email: 'test@gmail.com' }
      });

      poolManager.removeAccount('test-remove');
      
      expect(poolManager.getAccount('test-remove')).toBeUndefined();
    });

    test('should export accounts without credentials by default', () => {
      poolManager.addAccount({
        id: 'export-test',
        platform: 'gmail',
        credentials: { email: 'secret@gmail.com', password: 'secret123' }
      });

      const exported = poolManager.exportAccounts();
      const account = exported.find(a => a.id === 'export-test');

      expect(account.credentials).toBeUndefined();
      expect(account.email).toBeUndefined();
    });

    test('should handle batch import', async () => {
      const results = await poolManager.batchImport([
        { id: 'batch-1', platform: 'gmail', credentials: { email: 'b1@gmail.com' } },
        { id: 'batch-2', platform: 'outlook', credentials: { email: 'b2@outlook.com' } },
        { id: 'batch-1', platform: 'qq', credentials: { email: 'b3@qq.com' } }
      ]);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(results[2].success).toBe(false);
    });
  });

  describe('PlatformConfigManager', () => {
    let configManager;

    beforeEach(() => {
      configManager = new PlatformConfigManager();
    });

    test('should load default configs for all platforms', () => {
      const platforms = ['gmail', 'outlook', 'qq', '163', 'custom'];
      
      platforms.forEach(platform => {
        const config = configManager.getPlatformConfig(platform);
        expect(config).toBeDefined();
        expect(config.imap).toBeDefined();
        expect(config.smtp).toBeDefined();
        expect(config.rateLimit).toBeDefined();
      });
    });

    test('should validate credentials', () => {
      const gmailValid = configManager.validateCredentials('gmail', { email: 'test@gmail.com' });
      const qqInvalid = configManager.validateCredentials('qq', { email: 'test@qq.com' });

      expect(gmailValid.valid).toBe(true);
      expect(qqInvalid.valid).toBe(false);
      expect(qqInvalid.missingFields).toContain('authCode');
    });

    test('should check rate limits', () => {
      const limit = configManager.checkRateLimit('account-1', 'gmail');
      
      expect(limit.canSend).toBe(true);
      expect(limit.remainingDaily).toBe(100);
      expect(limit.remainingHourly).toBe(20);
    });

    test('should update platform config', () => {
      const updated = configManager.updatePlatformConfig('gmail', {
        rateLimit: { daily: 200, hourly: 50 }
      });

      expect(updated.rateLimit.daily).toBe(200);
    });

    test('should export full configuration', () => {
      const config = configManager.exportConfig();
      
      expect(Object.keys(config)).toContain('gmail');
      expect(Object.keys(config)).toContain('outlook');
      expect(Object.keys(config)).toHaveLength(5);
    });
  });

  describe('HealthMonitor', () => {
    let healthMonitor;
    let mockPoolManager;

    beforeEach(() => {
      mockPoolManager = {
        getAccount: jest.fn(),
        getAllAccounts: jest.fn()
      };
      healthMonitor = new HealthMonitor();
    });

    test('should initialize with default thresholds', () => {
      const thresholds = healthMonitor.getAlertThresholds();

      expect(thresholds.errorRate).toBe(0.1);
      expect(thresholds.responseTime).toBe(30000);
      expect(thresholds.consecutiveFailures).toBe(3);
    });

    test('should allow custom thresholds', () => {
      const customMonitor = new HealthMonitor({
        errorRate: 0.2,
        responseTime: 60000,
        consecutiveFailures: 5
      });

      const thresholds = customMonitor.getAlertThresholds();

      expect(thresholds.errorRate).toBe(0.2);
      expect(thresholds.responseTime).toBe(60000);
      expect(thresholds.consecutiveFailures).toBe(5);
    });

    test('should handle missing account in health check', async () => {
      mockPoolManager.getAccount.mockReturnValue(null);

      await expect(healthMonitor.checkAccountHealth('nonexistent'))
        .rejects.toThrow('not found');
    });
  });
});

describe('Integration Tests', () => {
  test('full workflow: factory -> pool -> config', () => {
    const factory = PlatformFactory;
    const pool = new AccountPoolManager();
    const config = new PlatformConfigManager();

    const gmailInstance = factory.create('gmail');
    
    pool.addAccount({
      id: 'integrated-account',
      platform: 'gmail',
      credentials: { email: 'integrated@gmail.com' },
      metadata: { region: 'US' }
    });

    const platformConfig = config.getPlatformConfig('gmail');
    const rateLimit = config.checkRateLimit('integrated-account', 'gmail');

    expect(gmailInstance.platformType).toBe('gmail');
    expect(pool.getAccount('integrated-account')).toBeDefined();
    expect(platformConfig.name).toBe('Gmail');
    expect(rateLimit.canSend).toBe(true);
  });

  test('multi-platform scenario', () => {
    const pool = new AccountPoolManager();

    const accounts = [
      { id: 'us-gmail-1', platform: 'gmail', credentials: { email: 'us1@gmail.com' }, metadata: { region: 'US' } },
      { id: 'eu-outlook-1', platform: 'outlook', credentials: { email: 'eu1@outlook.com' }, metadata: { region: 'EU' } },
      { id: 'cn-qq-1', platform: 'qq', credentials: { email: 'cn1@qq.com', authCode: 'xxx' }, metadata: { region: 'CN' } },
      { id: 'cn-163-1', platform: '163', credentials: { email: 'cn2@163.com', authCode: 'yyy' }, metadata: { region: 'CN' } }
    ];

    accounts.forEach(acc => pool.addAccount(acc));

    const stats = pool.getPlatformStatistics();

    expect(stats.gmail.total).toBe(1);
    expect(stats.outlook.total).toBe(1);
    expect(stats.qq.total).toBe(1);
    expect(stats['163'].total).toBe(1);

    const allAccounts = pool.getAllAccounts();
    expect(allAccounts).toHaveLength(4);
  });
});
