'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('users', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true
      },
      passwordHash: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      role: {
        type: Sequelize.ENUM('admin', 'user', 'viewer'),
        defaultValue: 'user'
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'suspended'),
        defaultValue: 'active'
      },
      lastLoginAt: {
        type: Sequelize.DATE
      },
      loginCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.createTable('tenants', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      slug: {
        type: Sequelize.STRING(50),
        unique: true,
        allowNull: false
      },
      plan: {
        type: Sequelize.ENUM('basic', 'professional', 'enterprise'),
        defaultValue: 'basic'
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'suspended'),
        defaultValue: 'active'
      },
      config: {
        type: Sequelize.JSONB,
        defaultValue: {}
      },
      maxAccounts: {
        type: Sequelize.INTEGER,
        defaultValue: 10
      },
      maxDailySends: {
        type: Sequelize.INTEGER,
        defaultValue: 500
      },
      customDomain: {
        type: Sequelize.STRING(255)
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.createTable('accounts', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      platform: {
        type: Sequelize.ENUM('gmail', 'outlook', 'qq', '163', 'custom'),
        allowNull: false
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      encryptedCredentials: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      displayName: {
        type: Sequelize.STRING(100)
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'error', 'archived'),
        defaultValue: 'inactive'
      },
      healthStatus: {
        type: Sequelize.ENUM('healthy', 'degraded', 'unhealthy', 'unknown'),
        defaultValue: 'unknown'
      },
      region: {
        type: Sequelize.STRING(50)
      },
      metadata: {
        type: Sequelize.JSONB,
        defaultValue: {}
      },
      lastUsedAt: {
        type: Sequelize.DATE
      },
      lastError: {
        type: Sequelize.TEXT
      },
      sentTodayCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      sentThisHourCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      dailyLimit: {
        type: Sequelize.INTEGER,
        defaultValue: 100
      },
      createdBy: {
        type: Sequelize.UUID,
        references: { model: 'users', key: 'id' }
      },
      tenantId: {
        type: Sequelize.UUID,
        references: { model: 'tenants', key: 'id' }
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('accounts', ['platform']);
    await queryInterface.addIndex('accounts', ['email']);
    await queryInterface.addIndex('accounts', ['status']);
    await queryInterface.addIndex('accounts', ['tenantId']);

    await queryInterface.createTable('campaigns', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      name: {
        type: Sequelize.STRING(200),
        allowNull: false
      },
      subject: {
        type: Sequelize.STRING(255)
      },
      htmlContent: { type: Sequelize.TEXT },
      textContent: { type: Sequelize.TEXT },
      fromName: { type: Sequelize.STRING(100) },
      fromEmail: { type: Sequelize.STRING(255) },
      status: {
        type: Sequelize.ENUM('draft', 'scheduled', 'sending', 'completed', 'paused', 'cancelled'),
        defaultValue: 'draft'
      },
      targetPlatform: {
        type: Sequelize.ENUM('gmail', 'outlook', 'qq', '163', 'custom')
      },
      totalRecipients: { type: Sequelize.INTEGER, defaultValue: 0 },
      sentCount: { type: Sequelize.INTEGER, defaultValue: 0 },
      deliveredCount: { type: Sequelize.INTEGER, defaultValue: 0 },
      openedCount: { type: Sequelize.INTEGER, defaultValue: 0 },
      repliedCount: { type: Sequelize.INTEGER, defaultValue: 0 },
      bouncedCount: { type: Sequelize.INTEGER, defaultValue: 0 },
      scheduledAt: { type: Sequelize.DATE },
      startedAt: { type: Sequelize.DATE },
      completedAt: { type: Sequelize.DATE },
      createdBy: {
        type: Sequelize.UUID,
        references: { model: 'users', key: 'id' }
      },
      tenantId: {
        type: Sequelize.UUID,
        references: { model: 'tenants', key: 'id' }
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.createTable('email_logs', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      messageId: { type: Sequelize.STRING(255), unique: true },
      toEmail: { type: Sequelize.STRING(255), allowNull: false },
      toName: { type: Sequelize.STRING(100) },
      fromEmail: { type: Sequelize.STRING(255), allowNull: false },
      subject: { type: Sequelize.STRING(255) },
      status: {
        type: Sequelize.ENUM('queued', 'sent', 'delivered', 'bounced', 'failed'),
        defaultValue: 'queued'
      },
      platform: {
        type: Sequelize.ENUM('gmail', 'outlook', 'qq', '163', 'custom')
      },
      accountId: {
        type: Sequelize.UUID,
        references: { model: 'accounts', key: 'id' }
      },
      campaignId: {
        type: Sequelize.UUID,
        references: { model: 'campaigns', key: 'id' }
      },
      sentBy: {
        type: Sequelize.UUID,
        references: { model: 'users', key: 'id' }
      },
      tenantId: {
        type: Sequelize.UUID,
        references: { model: 'tenants', key: 'id' }
      },
      sentAt: { type: Sequelize.DATE },
      deliveredAt: { type: Sequelize.DATE },
      openedAt: { type: Sequelize.DATE },
      bouncedAt: { type: Sequelize.DATE },
      bounceReason: { type: Sequelize.TEXT },
      errorMessage: { type: Sequelize.TEXT },
      deliveryTime: { type: Sequelize.INTEGER },
      metadata: { type: Sequelize.JSONB, defaultValue: {} },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('email_logs', ['status']);
    await queryInterface.addIndex('email_logs', ['platform']);
    await queryInterface.addIndex('email_logs', ['accountId']);
    await queryInterface.addIndex('email_logs', ['createdAt']);

    await queryInterface.createTable('statistics', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      platform: {
        type: Sequelize.ENUM('gmail', 'outlook', 'qq', '163', 'custom', 'all'),
        defaultValue: 'all'
      },
      metricType: {
        type: Sequelize.ENUM('sent', 'delivered', 'opened', 'replied', 'bounced', 'failed'),
        allowNull: false
      },
      value: { type: Sequelize.INTEGER, defaultValue: 0 },
      rate: { type: Sequelize.DECIMAL(5, 2), defaultValue: 0.00 },
      tenantId: {
        type: Sequelize.UUID,
        references: { model: 'tenants', key: 'id' }
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('statistics', ['date']);
    await queryInterface.addIndex('statistics', ['platform']);
    await queryInterface.addIndex('statistics', ['metricType']);
    await queryInterface.addIndex('statistics', ['date', 'platform', 'metricType'], { unique: true });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('statistics');
    await queryInterface.dropTable('email_logs');
    await queryInterface.dropTable('campaigns');
    await queryInterface.dropTable('accounts');
    await queryInterface.dropTable('tenants');
    await queryInterface.dropTable('users');
  }
};