/**
 * Tenant 模型 — 多租户架构核心实体
 *
 * 存储租户（组织/企业客户）的配置信息，包括：
 *   - 基本信息：名称、标识符、自定义域名
 *   - 套餐计划：basic / professional / enterprise
 *   - 资源配额：用户数、客户数、邮件发送量等上限
 *   - 自定义设置：功能开关、品牌配置等
 *   - 生命周期状态：active / suspended / terminated
 *
 * 默认租户（id=1）在数据库初始化时自动创建，
 * 用于向后兼容现有无租户系统。
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Tenant = sequelize.define('Tenant', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: '租户显示名称',
    },
    slug: {
      type: DataTypes.STRING(100),
      unique: true,
      allowNull: false,
      comment: 'URL安全的唯一标识符 (用于子域名或路径)',
    },
    domain: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: '租户自定义域名 (可选)',
    },
    plan: {
      type: DataTypes.ENUM('basic', 'professional', 'enterprise'),
      defaultValue: 'basic',
      allowNull: false,
      comment: '套餐计划',
    },
    quota: {
      type: DataTypes.JSONB,
      defaultValue: {
        maxUsers: 5,
        maxClients: 1000,
        maxEmailAccounts: 3,
        maxEmailsPerDay: 500,
        maxEmailsPerMonth: 10000,
        maxActiveCampaigns: 5,
        maxStorageMB: 500,
        apiRateLimit: 60,
        features: {
          customDomain: false,
          webhook: false,
          analytics: false,
          export: true,
          sso: false,
        },
      },
      comment: '资源配额配置 (JSONB)',
    },
    settings: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: '租户自定义设置 (JSONB)',
    },
    status: {
      type: DataTypes.ENUM('active', 'suspended', 'terminated'),
      defaultValue: 'active',
      allowNull: false,
      comment: '租户状态',
    },
  }, {
    tableName: 'tenants',
    timestamps: true,
    underscored: true,
    indexes: [
      // 按状态查询索引（管理后台列表过滤常用）
      { fields: ['status'] },
      // 按套餐查询索引（运营分析常用）
      { fields: ['plan'] },
      // 复合索引：状态 + 创建时间（管理后台排序）
      { fields: ['status', 'created_at'] },
    ],
  });

  return Tenant;
};
