const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Campaign = sequelize.define('Campaign', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(200),
      allowNull: false
    },
    subject: {
      type: DataTypes.STRING(255)
    },
    htmlContent: {
      type: DataTypes.TEXT
    },
    textContent: {
      type: DataTypes.TEXT
    },
    fromName: {
      type: DataTypes.STRING(100)
    },
    fromEmail: {
      type: DataTypes.STRING(255)
    },
    status: {
      type: DataTypes.ENUM('draft', 'scheduled', 'sending', 'completed', 'paused', 'cancelled'),
      defaultValue: 'draft'
    },
    targetPlatform: {
      type: DataTypes.ENUM('gmail', 'outlook', 'qq', '163', 'custom')
    },
    totalRecipients: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    sentCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    deliveredCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    openedCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    repliedCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    bouncedCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    scheduledAt: {
      type: DataTypes.DATE
    },
    startedAt: {
      type: DataTypes.DATE
    },
    completedAt: {
      type: DataTypes.DATE
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
    tableName: 'campaigns',
    timestamps: true,
    indexes: [
      { fields: ['status'] },
      { fields: ['createdBy'] },
      { fields: ['tenantId'] },
      { fields: ['scheduledAt'] }
    ]
  });

  Campaign.associate = (models) => {
    Campaign.belongsTo(models.User, {
      foreignKey: 'createdBy',
      as: 'creator'
    });
    Campaign.belongsTo(models.Tenant, {
      foreignKey: 'tenantId',
      as: 'tenant'
    });
    Campaign.hasMany(models.EmailLog, {
      foreignKey: 'campaignId',
      as: 'emails'
    });
  };

  return Campaign;
};
