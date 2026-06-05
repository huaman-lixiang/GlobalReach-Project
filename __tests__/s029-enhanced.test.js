const FailoverManager = require('../src/modules/m7-multi-platform-manager/FailoverManager');
const PerformanceAnalyzer = require('../src/modules/m7-multi-platform-manager/PerformanceAnalyzer');
const BatchProcessor = require('../src/modules/m7-multi-platform-manager/BatchProcessor');
const LifecycleManager = require('../src/modules/m7-multi-platform-manager/LifecycleManager');
const TenantManager = require('../src/modules/m7-multi-platform-manager/TenantManager');
const EmailFormatter = require('../src/modules/m8-platform-adapter-engine/EmailFormatter');

describe('S029 Enhanced Features Tests', () => {
  describe('FailoverManager', () => {
    let failoverManager;
    let mockPoolManager;

    beforeEach(() => {
      mockPoolManager = {
        getAccount: jest.fn(),
        getAllAccounts: jest.fn(),
        selectOptimalAccount: jest.fn(),
        getHealthyAccounts: jest.fn()
      };
      
      failoverManager = new FailoverManager(mockPoolManager);
    });

    test('should initialize with default options', () => {
      expect(failoverManager.maxRetries).toBe(3);
      expect(failoverManager.cooldownPeriod).toBe(300000);
    });

    test('should execute operation with failover on success', async () => {
      const mockAccount = { id: 'test-1', platform: 'gmail' };
      mockPoolManager.selectOptimalAccount.mockResolvedValue(mockAccount);
      
      const operation = jest.fn().mockResolvedValue({ success: true });
      
      const result = await failoverManager.executeWithFailover(operation);
      
      expect(result.success).toBe(true);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('should retry on failure and succeed on second attempt', async () => {
      const accounts = [
        { id: 'account-1', platform: 'gmail' },
        { id: 'account-2', platform: 'outlook' }
      ];
      
      mockPoolManager.selectOptimalAccount
        .mockResolvedValueOnce(accounts[0])
        .mockRejectedValueOnce(new Error('AUTH_FAILED'))
        .mockResolvedValueOnce(accounts[1]);
      
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('AUTH_FAILED'))
        .mockResolvedValueOnce({ success: true, fallback: true });

      const result = await failoverManager.executeWithFailover(operation, { targetRegion: 'US' });
      
      expect(result.success).toBe(true);
      expect(result.fallback).toBe(true);
      expect(failoverManager.failedAccounts.size).toBe(1);
    });

    test('should track failover statistics', async () => {
      const stats = failoverManager.getFailoverStats();
      
      expect(stats).toHaveProperty('failedAccounts');
      expect(stats).toHaveProperty('failedPlatforms');
      expect(stats).toHaveProperty('successRate');
    });

    test('should allow forced recovery', () => {
      failoverManager.failedAccounts.set('test-account', { failedAt: new Date() });
      
      failoverManager.forceRecoverAccount('test-account');
      
      expect(failoverManager.failedAccounts.has('test-account')).toBe(false);
    });
  });

  describe('PerformanceAnalyzer', () => {
    let analyzer;
    let mockPoolManager;

    beforeEach(() => {
      mockPoolManager = {};
      analyzer = new PerformanceAnalyzer(mockPoolManager);
    });

    test('should record send metrics', () => {
      analyzer.recordSendMetric('acc-1', 'gmail', {
        delivered: true,
        deliveryTime: 150,
        opened: false
      });

      const perf = analyzer.getAccountPerformance('acc-1', 'gmail');
      
      expect(perf).toBeDefined();
      expect(perf.totalSent).toBe(1);
      expect(perf.totalDelivered).toBe(1);
      expect(perf.avgDeliveryTime).toBe(150);
    });

    test('should generate platform comparison', () => {
      analyzer.recordSendMetric('acc-1', 'gmail', { delivered: true, opened: true, replied: true });
      analyzer.recordSendMetric('acc-2', 'outlook', { delivered: true, opened: false });
      analyzer.recordSendMetric('acc-3', 'gmail', { delivered: false, failed: true });

      const comparison = analyzer.getPlatformComparison(7);
      
      expect(comparison).toHaveProperty('gmail');
      expect(comparison).toHaveProperty('outlook');
      expect(parseFloat(comparison.gmail.deliveryRate)).toBeGreaterThan(0);
    });

    test('should identify top performers', () => {
      for (let i = 0; i < 10; i++) {
        analyzer.recordSendMetric(`g-${i}`, 'gmail', { delivered: true, opened: true, replied: true });
        analyzer.recordSendMetric(`o-${i}`, 'outlook', { delivered: true, opened: false });
      }

      const topPerformers = analyzer.getTopPerformers('replyRate', 5);
      
      expect(topPerformers.length).toBeGreaterThan(0);
      expect(topPerformers[0]).toHaveProperty('platform');
      expect(topPerformers[0]).toHaveProperty('score');
    });

    test('should export data to CSV format', () => {
      analyzer.recordSendMetric('acc-1', 'gmail', { delivered: true });
      
      const csv = analyzer.exportToCSV({ type: 'platform', days: 30 });
      
      expect(csv).toContain('Platform');
      expect(csv).toContain('Sent');
      expect(csv).toContain('Delivered');
    });
  });

  describe('LifecycleManager', () => {
    let lifecycleManager;
    let mockPoolManager;

    beforeEach(() => {
      mockPoolManager = {
        getAccount: jest.fn(),
        getAllAccounts: jest.fn(),
        addAccount: jest.fn(),
        removeAccount: jest.fn(),
        activateAccount: jest.fn(),
        deactivateAccount: jest.fn()
      };
      
      lifecycleManager = new LifecycleManager(mockPoolManager);
    });

    test('should manage account states', () => {
      mockPoolManager.getAccount.mockReturnValue({
        id: 'test-acc',
        status: 'inactive',
        credentials: {},
        platformInstance: { disconnect: jest.fn() }
      });

      expect(lifecycleManager.getState('test-acc')).toBe('unknown');
    });

    test('should activate account successfully', async () => {
      const mockAccount = {
        id: 'acc-1',
        status: 'inactive',
        credentials: {},
        platformInstance: {}
      };

      mockPoolManager.getAccount.mockReturnValue(mockAccount);
      mockPoolManager.activateAccount.mockResolvedValue({});

      const result = await lifecycleManager.activateAccount('acc-1');
      
      expect(result.success).toBe(true);
      expect(result.state).toBe('active');
      expect(lifecycleManager.getState('acc-1')).toBe('active');
    });

    test('should deactivate account with reason', async () => {
      const mockAccount = {
        id: 'acc-2',
        status: 'active'
      };

      mockPoolManager.getAccount.mockReturnValue(mockAccount);

      const result = await lifecycleManager.deactivateAccount('acc-2', 'maintenance');
      
      expect(result.success).toBe(true);
      expect(result.state).toBe('inactive');
    });

    test('should generate lifecycle report', () => {
      mockPoolManager.getAllAccounts.mockReturnValue([
        { id: 'acc-1' },
        { id: 'acc-2' }
      ]);

      const report = lifecycleManager.getLifecycleReport();
      
      expect(report).toHaveProperty('distribution');
      expect(report).toHaveProperty('totalAccounts');
      expect(report.totalAccounts).toBe(2);
    });
  });

  describe('TenantManager', () => {
    let tenantManager;

    beforeEach(() => {
      tenantManager = new TenantManager();
    });

    test('should create and manage tenants', () => {
      const tenant = tenantManager.createTenant({
        id: 'tenant-1',
        name: 'Test Company',
        plan: 'professional'
      });

      expect(tenant.id).toBe('tenant-1');
      expect(tenant.name).toBe('Test Company');
      expect(tenant.plan).toBe('professional');
      expect(tenant.status).toBe('active');
    });

    test('should prevent duplicate tenant creation', () => {
      tenantManager.createTenant({ id: 't1', name: 'T1' });
      
      expect(() => {
        tenantManager.createTenant({ id: 't1', name: 'T1-Dup' });
      }).toThrow('already exists');
    });

    test('should assign resources to tenants', () => {
      tenantManager.createTenant({ id: 't1', name: 'T1' });
      
      const result1 = tenantManager.assignAccountToTenant('acc-1', 't1');
      const result2 = tenantManager.assignClientToTenant('client-1', 't1');
      
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      
      const accounts = tenantManager.getTenantAccounts('t1');
      const clients = tenantManager.getTenantClients('t1');
      
      expect(accounts).toContain('acc-1');
      expect(clients).toContain('client-1');
    });

    test('should enforce data isolation', () => {
      tenantManager.createTenant({ id: 't1', name: 'T1' });
      tenantManager.createTenant({ id: 't2', name: 'T2' });
      
      tenantManager.assignAccountToTenant('acc-1', 't1');
      
      expect(tenantManager.canAccess('t1', 'acc-1', 'account')).toBe(true);
      expect(tenantManager.canAccess('t2', 'acc-1', 'account')).toBe(false);
    });

    test('should validate data isolation integrity', () => {
      tenantManager.createTenant({ id: 't1', name: 'T1' });
      tenantManager.createTenant({ id: 't2', name: 'T2' });
      
      tenantManager.assignAccountToTenant('acc-1', 't1');
      
      const validation = tenantManager.validateDataIsolation();
      
      expect(validation.valid).toBe(true);
      expect(validation.accountConflicts).toHaveLength(0);
    });

    test('should provide tenant statistics', () => {
      tenantManager.createTenant({ 
        id: 'enterprise-1', 
        name: 'Enterprise Corp',
        plan: 'enterprise'
      });

      for (let i = 0; i < 5; i++) {
        tenantManager.assignAccountToTenant(`acc-${i}`, 'enterprise-1');
      }
      for (let i = 0; i < 20; i++) {
        tenantManager.assignClientToTenant(`client-${i}`, 'enterprise-1');
      }

      const stats = tenantManager.getTenantStats('enterprise-1');
      
      expect(stats.accountsCount).toBe(5);
      expect(stats.clientsCount).toBe(20);
      expect(stats.plan).toBe('enterprise');
    });
  });

  describe('EmailFormatter', () => {
    let formatter;

    beforeEach(() => {
      formatter = new EmailFormatter();
    });

    test('should format basic email correctly', () => {
      const rawEmail = {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Email',
        html: '<h1>Hello</h1><p>This is a test.</p>'
      };

      const formatted = formatter.formatEmail(rawEmail, 'gmail');
      
      expect(formatted.from.email).toBe('sender@example.com');
      expect(formatted.to).toHaveLength(1);
      expect(formatted.to[0].email).toBe('recipient@example.com');
      expect(formatted.subject).toBe('Test Email');
      expect(formatted.html).toContain('<h1>Hello</h1>');
    });

    test('should handle multiple recipients', () => {
      const rawEmail = {
        from: 'me@test.com',
        to: ['a@test.com', 'b@test.com', 'c@test.com'],
        cc: 'cc@test.com',
        subject: 'Multi-recipient Test'
      };

      const formatted = formatter.formatEmail(rawEmail);
      
      expect(formatted.to).toHaveLength(3);
      expect(formatted.cc).toHaveLength(1);
    });

    test('should process attachments', () => {
      const rawEmail = {
        from: 'test@test.com',
        to: 'recv@test.com',
        subject: 'Attachment Test',
        attachments: [
          { filename: 'doc.pdf', content: 'base64data', size: 1024 },
          { filename: 'image.png', content: 'imagedata', size: 2048 }
        ]
      };

      const formatted = formatter.formatEmail(rawEmail);
      
      expect(formatted.attachments).toHaveLength(2);
      expect(formatted.attachments[0].contentType).toBe('application/pdf');
      expect(formatted.attachments[1].disposition).toBe('inline');
    });

    test('should sanitize HTML content', () => {
      const maliciousHTML = '<p>Safe<script>alert("xss")</script>content</p>';
      const rawEmail = {
        from: 'test@test.com',
        to: 'recv@test.com',
        html: maliciousHTML
      };

      const formatted = formatter.formatEmail(rawEmail);
      
      expect(formatted.html).not.toContain('<script>');
      expect(formatted.html).toContain('Safe');
      expect(formatted.html).toContain('content');
    });

    test('should validate email structure', () => {
      const validEmail = {
        from: { email: 'sender@test.com' },
        to: [{ email: 'recipient@test.com' }],
        subject: 'Valid'
      };

      const invalidEmail = {
        from: null,
        to: [],
        subject: ''
      };

      const validResult = formatter.validateEmail(validEmail);
      const invalidResult = formatter.validateEmail(invalidEmail);
      
      expect(validResult.valid).toBe(true);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors.length).toBeGreaterThan(0);
    });

    test('should convert HTML to plain text', () => {
      const html = '<div><h1>Title</h1><p>Paragraph <strong>bold</strong></p></div>';
      
      const text = formatter.generatePlainText(html);
      
      expect(text).toContain('Title');
      expect(text).toContain('Paragraph bold');
      expect(text).not.toContain('<div>');
    });

    test('should apply platform-specific formatting', () => {
      const baseEmail = {
        from: 'test@test.com',
        to: 'recv@test.com',
        subject: 'Platform Test',
        html: '<html><body>Content</body></html>'
      };

      const gmailFormatted = formatter.formatEmail(baseEmail, 'gmail');
      const outlookFormatted = formatter.formatEmail(baseEmail, 'outlook');
      
      expect(gmailFormatted.headers['Precedence']).toBe('bulk');
      expect(outlookFormatted.headers['X-MSMail-Priority']).toBe('Normal');
    });
  });

  describe('Integration Scenarios', () => {
    test('complete multi-platform workflow', async () => {
      const poolManager = {
        accounts: new Map(),
        platforms: new Map()
      };

      const failoverMgr = new FailoverManager(poolManager);
      const perfAnalyzer = new PerformanceAnalyzer(poolManager);
      const lifecycleMgr = new LifecycleManager(poolManager);
      const tenantMgr = new TenantManager();

      tenantMgr.createTenant({ id: 'corp-1', name: 'Test Corp' });
      tenantMgr.assignAccountToTenant('gmail-1', 'corp-1');

      perfAnalyzer.recordSendMetric('gmail-1', 'gmail', {
        delivered: true,
        deliveryTime: 120,
        opened: true,
        replied: false
      });

      const comparison = perfAnalyzer.getPlatformComparison(7);
      const tenantStats = tenantMgr.getTenantStats('corp-1');
      const failoverStats = failoverMgr.getFailoverStats();

      expect(tenantStats).toBeDefined();
      expect(failoverStats.successRate).toBe(1.0);
    });
  });
});
