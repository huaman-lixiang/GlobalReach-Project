const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

// Initialize PostgreSQL connection (production)
// S084/G05: DB Pool optimized for 512MB container (was max:20/min:5 = ~150MB)
// Reduced to max:10/min:2 = ~50MB, saving ~100MB for application logic
const sequelize = new Sequelize(process.env.DATABASE_URL || 'postgresql://globalreach_user:changeme@localhost:5432/globalreach_prod', {
  dialect: 'postgres',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: parseInt(process.env.DB_POOL_MAX || '10'),
    min: parseInt(process.env.DB_POOL_MIN || '2'),
    acquire: parseInt(process.env.DB_ACQUIRE_TIMEOUT || '30000'),
    idle: parseInt(process.env.DB_IDLE_TIMEOUT || '10000'),
    evict: parseInt(process.env.DB_EVICT_TIMEOUT || '5000'),
  },
});

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  email: {
    type: DataTypes.STRING(255),
    unique: true,
    allowNull: false,
  },
  passwordHash: {
    type: DataTypes.STRING(255),
    field: 'password_hash',
    allowNull: false,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  role: {
    type: DataTypes.ENUM('ADMIN', 'USER', 'VIEWER'),
    defaultValue: 'USER',
  },
  isEmailVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_email_verified',
  },
  avatar: { type: DataTypes.STRING },
  lastLoginAt: { type: DataTypes.DATE, field: 'last_login_at' },
}, {
  tableName: 'users',
  timestamps: true,
  underscored: true,
});

const EmailAccount = sequelize.define('EmailAccount', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: { type: DataTypes.UUID, field: 'user_id', allowNull: false },
  platform: {
    type: DataTypes.ENUM('GMAIL', 'OUTLOOK', 'QQ', 'NETEASE_163', 'CUSTOM_SMTP'),
    allowNull: false,
  },
  email: { type: DataTypes.STRING(255), allowNull: false },
  passwordEncrypted: { type: DataTypes.TEXT, field: 'password_encrypted' },
  imapHost: { type: DataTypes.STRING(255), field: 'imap_host' },
  imapPort: { type: DataTypes.INTEGER, field: 'imap_port' },
  smtpHost: { type: DataTypes.STRING(255), field: 'smtp_host' },
  smtpPort: { type: DataTypes.INTEGER, field: 'smtp_port' },
  encryptionType: {
    type: DataTypes.ENUM('SSL', 'TLS', 'STARTTLS', 'NONE'),
    defaultValue: 'SSL',
    field: 'encryption_type',
  },
  status: {
    type: DataTypes.ENUM('ACTIVE', 'RESTRICTED', 'BANNED', 'ERROR'),
    defaultValue: 'ACTIVE',
  },
  displayName: { type: DataTypes.STRING(255), field: 'display_name' },
  dailyLimit: { type: DataTypes.INTEGER, defaultValue: 100, field: 'daily_limit' },
  hourlyLimit: { type: DataTypes.INTEGER, defaultValue: 20, field: 'hourly_limit' },
  sentToday: { type: DataTypes.INTEGER, defaultValue: 0, field: 'sent_today' },
  lastUsedAt: { type: DataTypes.DATE, field: 'last_used_at' },
  healthScore: { type: DataTypes.INTEGER, defaultValue: 100, field: 'health_score' },
  metadata: { type: DataTypes.TEXT },
}, {
  tableName: 'email_accounts',
  timestamps: true,
  underscored: true,
});

const Client = sequelize.define('Client', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: { type: DataTypes.UUID, field: 'user_id', allowNull: false },
  email: { type: DataTypes.STRING(255), allowNull: false },
  firstName: { type: DataTypes.STRING(100), field: 'first_name' },
  lastName: { type: DataTypes.STRING(100), field: 'last_name' },
  company: { type: DataTypes.STRING(255) },
  country: { type: DataTypes.STRING(100) },
  industry: { type: DataTypes.STRING(100) },
  status: {
    type: DataTypes.ENUM('PROSPECT', 'LEAD', 'CUSTOMER', 'CHURNED', 'UNSUBSCRIBED'),
    defaultValue: 'PROSPECT',
  },
  tags: { type: DataTypes.TEXT },
  phone: { type: DataTypes.STRING(50) },
  website: { type: DataTypes.STRING(500) },
  customFields: { type: DataTypes.TEXT, field: 'custom_fields' },
  notes: { type: DataTypes.TEXT },
}, {
  tableName: 'clients',
  timestamps: true,
  underscored: true,
});

const Campaign = sequelize.define('Campaign', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: { type: DataTypes.UUID, field: 'user_id', allowNull: false },
  name: { type: DataTypes.STRING(255), allowNull: false },
  type: {
    type: DataTypes.ENUM('COLD_WARM', 'FOLLOW_UP', 'NEWSLETTER', 'TRANSACTIONAL'),
    defaultValue: 'COLD_WARM',
  },
  status: {
    type: DataTypes.ENUM('DRAFT', 'SCHEDULED', 'SENDING', 'PAUSED', 'COMPLETED', 'CANCELLED'),
    defaultValue: 'DRAFT',
  },
  subjectTemplate: { type: DataTypes.STRING, field: 'subject_template' },
  bodyTemplate: { type: DataTypes.TEXT, field: 'body_template' },
  targetSegment: { type: DataTypes.TEXT, field: 'target_segment' },
  accountIds: { type: DataTypes.TEXT, field: 'account_ids' },
  scheduleConfig: { type: DataTypes.TEXT, field: 'schedule_config' },
  stats: { type: DataTypes.TEXT },
  startedAt: { type: DataTypes.DATE, field: 'started_at' },
  completedAt: { type: DataTypes.DATE, field: 'completed_at' },
}, {
  tableName: 'campaigns',
  timestamps: true,
  underscored: true,
});

const Email = sequelize.define('Email', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  campaignId: { type: DataTypes.UUID, field: 'campaign_id' },
  userId: { type: DataTypes.UUID, field: 'user_id' },
  clientId: { type: DataTypes.UUID, field: 'client_id', allowNull: false },
  accountId: { type: DataTypes.UUID, field: 'account_id' },
  toAddress: { type: DataTypes.STRING(255), field: 'to_address', allowNull: false },
  fromAddress: { type: DataTypes.STRING(255), field: 'from_address', allowNull: false },
  subject: { type: DataTypes.STRING, allowNull: false },
  bodyHtml: { type: DataTypes.TEXT, field: 'body_html' },
  bodyText: { type: DataTypes.TEXT, field: 'body_text' },
  status: {
    type: DataTypes.ENUM('PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'FAILED'),
    defaultValue: 'PENDING',
  },
  sentAt: { type: DataTypes.DATE, field: 'sent_at' },
  deliveredAt: { type: DataTypes.DATE, field: 'delivered_at' },
  openedAt: { type: DataTypes.DATE, field: 'opened_at' },
  clickedAt: { type: DataTypes.DATE, field: 'clicked_at' },
  bouncedReason: { type: DataTypes.TEXT, field: 'bounced_reason' },
  errorMessage: { type: DataTypes.TEXT, field: 'error_message' },
  providerMessageId: { type: DataTypes.STRING(255), field: 'provider_message_id' },
}, {
  tableName: 'emails',
  timestamps: true,
  underscored: true,
});

const RefreshToken = sequelize.define('RefreshToken', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: { type: DataTypes.UUID, field: 'user_id', allowNull: false },
  tokenHash: { type: DataTypes.STRING(255), field: 'token_hash', allowNull: false },
  expiresAt: { type: DataTypes.DATE, field: 'expires_at', allowNull: false },
  revokedAt: { type: DataTypes.DATE, field: 'revoked_at' },
}, {
  tableName: 'refresh_tokens',
  timestamps: true,
  updatedAt: false,
  underscored: true,
});

const AuditLog = sequelize.define('AuditLog', {
  id: {
    type: DataTypes.BIGINT,
    autoIncrement: true,
    primaryKey: true,
  },
  userId: { type: DataTypes.UUID, field: 'user_id' },
  action: { type: DataTypes.STRING(100), allowNull: false },
  resourceType: { type: DataTypes.STRING(50), field: 'resource_type' },
  resourceId: { type: DataTypes.STRING(100), field: 'resource_id' },
  ipAddress: { type: DataTypes.STRING(50), field: 'ip_address' },
  userAgent: { type: DataTypes.TEXT, field: 'user_agent' },
  details: { type: DataTypes.TEXT },
}, {
  tableName: 'audit_logs',
  timestamps: true,
  updatedAt: false,
  underscored: true,
});

const ErrorLog = sequelize.define('ErrorLog', {
  id: {
    type: DataTypes.BIGINT,
    autoIncrement: true,
    primaryKey: true,
  },
  userId: { type: DataTypes.UUID, field: 'user_id' },
  errorType: { type: DataTypes.STRING(100), field: 'error_type' },
  errorMessage: { type: DataTypes.TEXT, field: 'error_message' },
  stackTrace: { type: DataTypes.TEXT, field: 'stack_trace' },
  requestUrl: { type: DataTypes.STRING(500), field: 'request_url' },
  requestMethod: { type: DataTypes.STRING(10), field: 'request_method' },
  userAgent: { type: DataTypes.TEXT, field: 'user_agent' },
  statusCode: { type: DataTypes.INTEGER, field: 'status_code' },
  metadata: { type: DataTypes.TEXT },
}, {
  tableName: 'error_logs',
  timestamps: true,
  underscored: true,
});

const Feedback = sequelize.define('Feedback', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: { type: DataTypes.UUID, field: 'user_id', allowNull: false },
  type: {
    type: DataTypes.ENUM('bug', 'feature', 'improvement', 'question', 'other'),
    defaultValue: 'other',
  },
  title: { type: DataTypes.STRING(255) },
  message: { type: DataTypes.TEXT },
  rating: { type: DataTypes.INTEGER },
  metadata: { type: DataTypes.TEXT },
}, {
  tableName: 'feedbacks',
  timestamps: true,
  underscored: true,
});

const MaintenanceLog = sequelize.define('MaintenanceLog', {
  id: {
    type: DataTypes.BIGINT,
    autoIncrement: true,
    primaryKey: true,
  },
  eventType: { type: DataTypes.STRING(100), field: 'event_type' },
  message: { type: DataTypes.TEXT },
  details: { type: DataTypes.TEXT },
}, {
  tableName: 'maintenance_logs',
  timestamps: true,
  underscored: true,
});

const Device = sequelize.define('Device', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: { type: DataTypes.UUID, field: 'user_id', allowNull: false },
  deviceToken: { type: DataTypes.STRING(255), field: 'device_token', allowNull: false },
  platform: { type: DataTypes.ENUM('ios', 'android'), allowNull: false },
  deviceId: { type: DataTypes.STRING(255), field: 'device_id', allowNull: false },
  enabled: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  tableName: 'devices',
  timestamps: true,
  underscored: true,
});

User.hasMany(EmailAccount, { foreignKey: 'userId', as: 'accounts', onDelete: 'CASCADE' });
User.hasMany(Client, { foreignKey: 'userId', as: 'clients', onDelete: 'CASCADE' });
User.hasMany(Campaign, { foreignKey: 'userId', as: 'campaigns', onDelete: 'CASCADE' });
User.hasMany(Email, { foreignKey: 'userId', as: 'emails', onDelete: 'SET NULL' });
User.hasMany(RefreshToken, { foreignKey: 'userId', as: 'refreshTokens', onDelete: 'CASCADE' });
User.hasMany(AuditLog, { foreignKey: 'userId', as: 'auditLogs', onDelete: 'SET NULL' });
User.hasMany(ErrorLog, { foreignKey: 'userId', as: 'errorLogs', onDelete: 'SET NULL' });
User.hasMany(Feedback, { foreignKey: 'userId', as: 'feedbacks', onDelete: 'CASCADE' });
User.hasMany(Device, { foreignKey: 'userId', as: 'devices', onDelete: 'CASCADE' });

EmailAccount.belongsTo(User, { foreignKey: 'userId', as: 'user' });
EmailAccount.hasMany(Email, { foreignKey: 'accountId', as: 'emails', onDelete: 'SET NULL' });

Client.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Client.hasMany(Email, { foreignKey: 'clientId', as: 'emails', onDelete: 'CASCADE' });

Campaign.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Campaign.hasMany(Email, { foreignKey: 'campaignId', as: 'emails', onDelete: 'SET NULL' });

Email.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Email.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign' });
Email.belongsTo(Client, { foreignKey: 'clientId', as: 'client' });
Email.belongsTo(EmailAccount, { foreignKey: 'accountId', as: 'account' });

RefreshToken.belongsTo(User, { foreignKey: 'userId', as: 'user' });
AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });
ErrorLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Feedback.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Device.belongsTo(User, { foreignKey: 'userId', as: 'user' });

module.exports = {
  sequelize,
  User,
  EmailAccount,
  Client,
  Campaign,
  Email,
  RefreshToken,
  AuditLog,
  ErrorLog,
  Feedback,
  MaintenanceLog,
  Device,
};