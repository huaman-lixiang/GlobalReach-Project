const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: { isEmail: true }
    },
    passwordHash: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    role: {
      type: DataTypes.ENUM('admin', 'user', 'viewer'),
      defaultValue: 'user'
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'suspended'),
      defaultValue: 'active'
    },
    lastLoginAt: {
      type: DataTypes.DATE
    },
    loginCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    }
  }, {
    tableName: 'users',
    timestamps: true,
    indexes: [
      { fields: ['email'], unique: true },
      { fields: ['role'] },
      { fields: ['status'] }
    ]
  });

  User.associate = (models) => {
    User.hasMany(models.Account, {
      foreignKey: 'createdBy',
      as: 'accounts'
    });
    User.hasMany(models.EmailLog, {
      foreignKey: 'sentBy',
      as: 'sentEmails'
    });
  };

  return User;
};
