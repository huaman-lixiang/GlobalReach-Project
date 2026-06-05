const db = require('./index');
const sequelize = db.sequelize;

async function createIndexes() {
  try {
    console.log('[D17] Starting database index optimization...');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);
    console.log('[D17] Index created: idx_users_email');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    `);
    console.log('[D17] Index created: idx_users_role');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_email_accounts_user_id ON email_accounts(user_id);
    `);
    console.log('[D17] Index created: idx_email_accounts_user_id');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_email_accounts_platform ON email_accounts(platform);
    `);
    console.log('[D17] Index created: idx_email_accounts_platform');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_email_accounts_status ON email_accounts(status);
    `);
    console.log('[D17] Index created: idx_email_accounts_status');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);
    `);
    console.log('[D17] Index created: idx_clients_user_id');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
    `);
    console.log('[D17] Index created: idx_clients_email');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
    `);
    console.log('[D17] Index created: idx_campaigns_user_id');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
    `);
    console.log('[D17] Index created: idx_campaigns_status');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_emails_campaign_id ON emails(campaign_id);
    `);
    console.log('[D17] Index created: idx_emails_campaign_id');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_emails_account_id ON emails(account_id);
    `);
    console.log('[D17] Index created: idx_emails_account_id');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_emails_client_id ON emails(client_id);
    `);
    console.log('[D17] Index created: idx_emails_client_id');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
    `);
    console.log('[D17] Index created: idx_emails_status');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_emails_created_at ON emails(created_at);
    `);
    console.log('[D17] Index created: idx_emails_created_at');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    `);
    console.log('[D17] Index created: idx_refresh_tokens_user_id');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
    `);
    console.log('[D17] Index created: idx_refresh_tokens_expires_at');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    `);
    console.log('[D17] Index created: idx_audit_logs_user_id');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    `);
    console.log('[D17] Index created: idx_audit_logs_created_at');

    console.log('[D17] Database index optimization completed successfully!');
    return true;
  } catch (error) {
    console.error('[D17] Index creation failed:', error.message);
    return false;
  }
}

module.exports = {
  createIndexes,
};

if (require.main === module) {
  createIndexes().then(() => process.exit(0)).catch(() => process.exit(1));
}