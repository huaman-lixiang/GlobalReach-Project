const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Account = sequelize.define('Account', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    platform: {
      type: DataTypes.ENUM('gmail', 'outlook', 'qq', '163', 'custom'),
      allowNull: false
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    encryptedCredentials: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    displayName: {
      type: DataTypes.STRING(100)
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'error', 'archived'),
      defaultValue: 'inactive'
    },
    healthStatus: {
      type: DataTypes.ENUM('healthy', 'degraded', 'unhealthy', 'unknown'),
      defaultValue: 'unknown'
    },
    region: {
      type: DataTypes.STRING(50)
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    lastUsedAt: {
      type: DataTypes.DATE
    },
    lastError: {
      type: DataTypes.TEXT
    },
    sentTodayCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    sentThisHourCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    dailyLimit: {
      type: DataTypes.INTEGER,
      defaultValue: 100
    },
    createdBy: {
      type: DataTypes.UUID,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    tenantId: {
      type: DataTypes.UUID,
      references: {
        model: 'tenants',
        key: 'id'
      }
    }
  }, {
    tableName: 'accounts',
    timestamps: true,
    indexes: [
      { fields: ['platform'] },
      { fields: ['email'] },
      { fields: ['status'] },
      { fields: ['healthStatus'] },
      { fields: ['tenantId'] },
      { fields: ['createdBy'] },
      { fields: ['platform', 'status'] }
    ]
  });

  Account.associate = (models) => {
    Account.belongsTo(models.User, {
      foreignKey: 'createdBy',
      as: 'creator'
    });
    Account.belongsTo(models.Tenant, {
      foreignKey: 'tenantId',
      as: 'tenant'
    });
    Account.hasMany(models.EmailLog, {
      foreignKey: 'accountId',
      as: 'emailLogs'
    });
  };

  return Account;
};
