const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Statistics = sequelize.define('Statistic', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    platform: {
      type: DataTypes.ENUM('gmail', 'outlook', 'qq', '163', 'custom', 'all'),
      defaultValue: 'all'
    },
    metricType: {
      type: DataTypes.ENUM('sent', 'delivered', 'opened', 'replied', 'bounced', 'failed'),
      allowNull: false
    },
    value: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    rate: {
      type: DataTypes.DECIMAL(5, 2),
      defaultValue: 0.00
    },
    tenantId: {
      type: DataTypes.UUID,
      references: {
        model: 'tenants',
        key: 'id'
      }
    }
  }, {
    tableName: 'statistics',
    timestamps: true,
    indexes: [
      { fields: ['date'] },
      { fields: ['platform'] },
      { fields: ['metricType'] },
      { fields: ['date', 'platform', 'metricType'], unique: true },
      { fields: ['tenantId'] }
    ]
  });

  Statistics.associate = (models) => {
    Statistics.belongsTo(models.Tenant, {
      foreignKey: 'tenantId',
      as: 'tenant'
    });
  };

  return Statistics;
};
