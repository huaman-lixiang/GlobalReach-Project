const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const EmailLog = sequelize.define('EmailLog', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    messageId: {
      type: DataTypes.STRING(255),
      unique: true
    },
    toEmail: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    toName: {
      type: DataTypes.STRING(100)
    },
    fromEmail: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    subject: {
      type: DataTypes.STRING(255)
    },
    status: {
      type: DataTypes.ENUM('queued', 'sent', 'delivered', 'bounced', 'failed'),
      defaultValue: 'queued'
    },
    platform: {
      type: DataTypes.ENUM('gmail', 'outlook', 'qq', '163', 'custom')
    },
    accountId: {
      type: DataTypes.UUID,
      references: {
        model: 'accounts',
        key: 'id'
      }
    },
    campaignId: {
      type: DataTypes.UUID,
      references: {
        model: 'campaigns',
        key: 'id'
      }
    },
    sentBy: {
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
    },
    sentAt: {
      type: DataTypes.DATE
    },
    deliveredAt: {
      type: DataTypes.DATE
    },
    openedAt: {
      type: DataTypes.DATE
    },
    bouncedAt: {
      type: DataTypes.DATE
    },
    bounceReason: {
      type: DataTypes.TEXT
    },
    errorMessage: {
      type: DataTypes.TEXT
    },
    deliveryTime: {
      type: DataTypes.INTEGER
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'email_logs',
    timestamps: true,
    indexes: [
      { fields: ['messageId'] },
      { fields: ['toEmail'] },
      { fields: ['status'] },
      { fields: ['platform'] },
      { fields: ['accountId'] },
      { fields: ['campaignId'] },
      { fields: ['sentBy'] },
      { fields: ['sentAt'] },
      { fields: ['createdAt'] }
    ]
  });

  EmailLog.associate = (models) => {
    EmailLog.belongsTo(models.Account, {
      foreignKey: 'accountId',
      as: 'account'
    });
    EmailLog.belongsTo(models.Campaign, {
      foreignKey: 'campaignId',
      as: 'campaign'
    });
    EmailLog.belongsTo(models.User, {
      foreignKey: 'sentBy',
      as: 'sender'
    });
    EmailLog.belongsTo(models.Tenant, {
      foreignKey: 'tenantId',
      as: 'tenant'
    });
  };

  return EmailLog;
};
