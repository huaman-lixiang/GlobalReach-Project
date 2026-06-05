const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Tenant = sequelize.define('Tenant', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    slug: {
      type: DataTypes.STRING(50),
      unique: true,
      allowNull: false
    },
    plan: {
      type: DataTypes.ENUM('basic', 'professional', 'enterprise'),
      defaultValue: 'basic'
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'suspended'),
      defaultValue: 'active'
    },
    config: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    maxAccounts: {
      type: DataTypes.INTEGER,
      defaultValue: 10
    },
    maxDailySends: {
      type: DataTypes.INTEGER,
      defaultValue: 500
    },
    customDomain: {
      type: DataTypes.STRING(255)
    }
  }, {
    tableName: 'tenants',
    timestamps: true,
    indexes: [
      { fields: ['slug'], unique: true },
      { fields: ['plan'] },
      { fields: ['status'] }
    ]
  });

  Tenant.associate = (models) => {
    Tenant.hasMany(models.Account, {
      foreignKey: 'tenantId',
      as: 'accounts'
    });
    Tenant.hasMany(models.User, {
      foreignKey: 'tenantId',
      as: 'members'
    });
  };

  return Tenant;
};
