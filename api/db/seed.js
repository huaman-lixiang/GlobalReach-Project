/**
 * Database Seed Script (D04) — Sequelize ORM
 *
 * Populates the database with initial data for development/testing.
 * Uses upsert pattern: safe to run multiple times (idempotent).
 *
 * Data included:
 *   - 2 Users (admin + demo)
 *   - 4 Email Accounts (gmail, outlook, qq, 163)
 *   - 20 Clients (multi-country, multi-industry)
 *   - 1 Draft Campaign (with Handlebars template)
 *
 * Usage:
 *   node api/db/seed.js          (direct execution)
 *   Auto-executed on server startup if DB is empty
 */

const db = require('./index');
const bcrypt = require('bcryptjs');

// ============================================
// Seed Data Definitions
// ============================================

const SEED_USERS = [
  {
    email: 'admin@globalreach.com',
    password: 'Admin123456',
    name: 'System Administrator',
    role: 'ADMIN',
    isEmailVerified: true,
  },
  {
    email: 'demo@globalreach.com',
    password: 'Demo123456',
    name: 'Demo User',
    role: 'USER',
    isEmailVerified: true,
  },
];

const SEED_ACCOUNTS = [
  {
    platform: 'GMAIL',
    email: 'globalreach.gmail@gmail.com',
    passwordEncrypted: 'gmail-app-password-placeholder',
    imapHost: 'imap.gmail.com', imapPort: 993,
    smtpHost: 'smtp.gmail.com', smtpPort: 465,
    encryptionType: 'SSL',
    displayName: 'Gmail Primary Account',
    dailyLimit: 100, hourlyLimit: 20, healthScore: 100,
    status: 'ACTIVE',
  },
  {
    platform: 'OUTLOOK',
    email: 'globalreach.outlook@outlook.com',
    passwordEncrypted: 'outlook-oauth-placeholder',
    imapHost: 'outlook.office365.com', imapPort: 993,
    smtpHost: 'smtp.office365.com', smtpPort: 587,
    encryptionType: 'STARTTLS',
    displayName: 'Outlook Business Account',
    dailyLimit: 50, hourlyLimit: 15, healthScore: 95,
    status: 'ACTIVE',
  },
  {
    platform: 'QQ',
    email: 'globalreach@qq.com',
    passwordEncrypted: 'qq-auth-code-placeholder',
    imapHost: 'imap.qq.com', imapPort: 993,
    smtpHost: 'smtp.qq.com', smtpPort: 465,
    encryptionType: 'SSL',
    displayName: 'QQ Mail Account',
    dailyLimit: 200, hourlyLimit: 50, healthScore: 90,
    status: 'ACTIVE',
  },
  {
    platform: 'NETEASE_163',
    email: 'globalreach@163.com',
    passwordEncrypted: '163-auth-code-placeholder',
    imapHost: 'imap.163.com', imapPort: 993,
    smtpHost: 'smtp.163.com', smtpPort: 465,
    encryptionType: 'SSL',
    displayName: 'NetEase 163 Account',
    dailyLimit: 200, hourlyLimit: 50, healthScore: 85,
    status: 'RESTRICTED',
  },
];

const SEED_CLIENTS = [
  // United States — Technology (5)
  { firstName: 'John', lastName: 'Smith', email: 'john.smith@techcorp.us', company: 'TechCorp Inc.', country: 'United States', industry: 'Technology', status: 'LEAD', tags: ['US', 'Technology', 'VIP'] },
  { firstName: 'Sarah', lastName: 'Johnson', email: 'sarah.j@innovate.io', company: 'Innovate Labs', country: 'United States', industry: 'Technology', status: 'CUSTOMER', tags: ['US', 'Technology', 'SaaS'] },
  { firstName: 'Michael', lastName: 'Chen', email: 'mchen@cloudsys.com', company: 'CloudSys Solutions', country: 'United States', industry: 'Technology', status: 'PROSPECT', tags: ['US', 'Technology', 'Cloud'] },
  { firstName: 'Emma', lastName: 'Wilson', email: 'emma.w@datapro.us', company: 'DataPro Analytics', country: 'United States', industry: 'Technology', status: 'LEAD', tags: ['US', 'Technology', 'AI'] },
  { firstName: 'David', lastName: 'Brown', email: 'dbrown@nexgen.dev', company: 'NexGen Dev', country: 'United States', industry: 'Technology', status: 'PROSPECT', tags: ['US', 'Technology', 'Startup'] },

  // Germany — Manufacturing (3)
  { firstName: 'Hans', lastName: 'Mueller', email: 'h.mueller@autowerk.de', company: 'AutoWerk GmbH', country: 'Germany', industry: 'Manufacturing', status: 'CUSTOMER', tags: ['Germany', 'Manufacturing', 'Automotive'] },
  { firstName: 'Anna', lastName: 'Schmidt', email: 'a.schmidt@industriex.de', company: 'IndustrieX AG', country: 'Germany', industry: 'Manufacturing', status: 'LEAD', tags: ['Germany', 'Manufacturing', 'Industrial'] },
  { firstName: 'Klaus', lastName: 'Weber', email: 'kweber@maschinen.de', company: 'Maschinenbau KG', country: 'Germany', industry: 'Manufacturing', status: 'PROSPECT', tags: ['Germany', 'Manufacturing', 'Machinery'] },

  // United Kingdom — Finance (2)
  { firstName: 'James', lastName: 'Taylor', email: 'j.taylor@finserve.uk', company: 'FinServe Partners', country: 'United Kingdom', industry: 'Finance', status: 'LEAD', tags: ['UK', 'Finance', 'Banking'] },
  { firstName: 'Charlotte', lastName: 'Anderson', email: 'c.anderson@capitaluk.co.uk', company: 'Capital UK Ltd', country: 'United Kingdom', industry: 'Finance', status: 'CUSTOMER', tags: ['UK', 'Finance', 'Investment'] },

  // Japan — Automotive (2)
  { firstName: 'Yuki', lastName: 'Tanaka', email: 'y.tanaka@motojp.co.jp', company: 'MotoJP Corporation', country: 'Japan', industry: 'Automotive', status: 'LEAD', tags: ['Japan', 'Automotive', 'EV'] },
  { firstName: 'Kenji', lastName: 'Yamamoto', email: 'kyama@nipponauto.jp', company: 'NipponAuto Industries', country: 'Japan', industry: 'Automotive', status: 'PROSPECT', tags: ['Japan', 'Automotive', 'Parts'] },

  // France — Luxury (2)
  { firstName: 'Pierre', lastName: 'Dubois', email: 'p.dubois@luxe.fr', company: 'Luxe Maison SA', country: 'France', industry: 'Luxury', status: 'CUSTOMER', tags: ['France', 'Luxury', 'Fashion'] },
  { firstName: 'Camille', lastName: 'Martin', email: 'c.martin@parisbrand.fr', company: 'Paris Brand Group', country: 'France', industry: 'Luxury', status: 'LEAD', tags: ['France', 'Luxury', 'Retail'] },

  // Australia — Mining (2)
  { firstName: 'Liam', lastName: 'O\'Connor', email: 'liam.oconnor@mineral.au', company: 'Mineral Resources Pty', country: 'Australia', industry: 'Mining', status: 'PROSPECT', tags: ['Australia', 'Mining', 'Resources'] },
  { firstName: 'Olivia', lastName: 'Thompson', email: 'o.thompson@austmine.au', company: 'AustMine Ltd', country: 'Australia', industry: 'Mining', status: 'LEAD', tags: ['Australia', 'Mining', 'Gold'] },

  // Canada — Energy (2)
  { firstName: 'Ryan', lastName: 'MacDonald', email: 'r.macdonald@northernergy.ca', company: 'Northern Energy Corp', country: 'Canada', industry: 'Energy', status: 'CUSTOMER', tags: ['Canada', 'Energy', 'Oil'] },
  { firstName: 'Sophie', lastName: 'Tremblay', email: 's.tremblay@quebecpower.ca', company: 'Quebec Power Inc', country: 'Canada', industry: 'Energy', status: 'PROSPECT', tags: ['Canada', 'Energy', 'Renewable'] },

  // Singapore — Logistics (1)
  { firstName: 'Wei', lastName: 'Chen', email: 'wei.chen@asialog.sg', company: 'AsiaLog Pte Ltd', country: 'Singapore', industry: 'Logistics', status: 'LEAD', tags: ['Singapore', 'Logistics', 'Freight'] },

  // UAE — Construction (1)
  { firstName: 'Ahmed', lastName: 'Al-Rashid', email: 'a.alrashid@gulfbuild.ae', company: 'GulfBuild Construction', country: 'UAE', industry: 'Construction', status: 'PROSPECT', tags: ['UAE', 'Construction', 'Real Estate'] },
];

const SEED_CAMPAIGNS = [
  {
    name: 'Q2 Product Launch — International Outreach',
    type: 'COLD_WARM',
    status: 'DRAFT',
    subjectTemplate: '{{client.firstName}}，关于{{user.company || "GlobalReach"}}的新产品合作邀请',
    bodyTemplate: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333}
.header{background:#1890ff;color:#fff;padding:20px;text-align:center;border-radius:8px 8px 0 0}
.content{padding:25px 20px;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 8px 8px}
.cta{display:inline-block;background:#1890ff;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600}
.footer{margin-top:15px;font-size:12px;color:#999;text-align:center}
</style></head><body>
<div class="header"><h1 style="margin:0">{{user.company || "GlobalReach"}}</h1></div>
<div class="content">
<p>尊敬的 {{client.firstName}} {{client.lastName}}，</p>
<p>我们很高兴地向{{client.company || "贵公司"}}介绍我们的最新产品线。作为{{client.industry || "您所在行业"}}的领先企业，我们认为这次合作将为双方带来显著价值。</p>
<p><strong>核心优势：</strong></p>
<ul>
<li>多平台智能邮件池管理（支持 Gmail/Outlook/QQ/163）</li>
<li>AI 驱动的最优账号选择算法</li>
<li>实时发送进度追踪与效果分析</li>
<li>A/B 测试与客户分群功能</li>
</ul>
<p>如果您感兴趣，我很乐意安排一次演示。</p>
<p style="text-align:center"><a href="{{ctaUrl || "#"}}" class="cta">预约产品演示</a></p>
<p>祝好，<br>{{user.name || "GlobalReach Team"}}</p>
</div>
<div class="footer">此邮件由 GlobalReach V2.0 系统自动发送 | <a href="{{unsubscribeUrl}}">取消订阅</a></div>
</body></html>`,
    targetSegment: {
      statuses: ['PROSPECT', 'LEAD'],
      countries: ['United States', 'Germany', 'United Kingdom'],
    },
  },
];

// ============================================
// Main Seed Function
// ============================================

async function seed(options = {}) {
  const { force = false, silent = false } = options;
  const log = silent ? () => {} : console.log;

  log('\n╔════════════════════════════════════════╗');
  log('║  GlobalReach V2.0 — Database Seeder       ║');
  log('╚════════════════════════════════════════╝\n');

  const startTime = Date.now();
  let stats = { users: 0, accounts: 0, clients: 0, campaigns: 0 };

  try {
    // Check existing data
    const userCount = await db.User.count();
    if (userCount > 0 && !force) {
      log(`[Seed] Database already has ${userCount} user(s). Skipping seed (use force:true to override).`);
      return stats;
    }

    if (force && userCount > 0) {
      log(`[Seed] Force mode: clearing existing data...`);
      await db.Email.destroy({ where: {}, truncate: true, cascade: true });
      await db.Campaign.destroy({ where: {}, truncate: true, cascade: true });
      await db.Client.destroy({ where: {}, truncate: true, cascade: true });
      await db.EmailAccount.destroy({ where: {}, truncate: true, cascade: true });
      await db.RefreshToken.destroy({ where: {}, truncate: true, cascade: true });
      await db.AuditLog.destroy({ where: {}, truncate: true, cascade: true });
      await db.User.destroy({ where: {}, truncate: true, cascade: true });
      log('[Seed] All tables cleared.');
    }

    // ============================================
    // 1. Seed Users
    // ============================================
    log('[Seed] Creating users...');
    for (const userData of SEED_USERS) {
      const hashedPassword = await bcrypt.hash(userData.password, 12);
      // Extract password before spreading (model uses passwordHash, not password)
      const { password: rawPassword, ...safeData } = userData;
      const [user] = await db.User.findOrCreate({
        where: { email: userData.email },
        defaults: {
          ...safeData,
          passwordHash: hashedPassword,
        },
      });
      log(`  ✅ ${user.email} (${user.role})`);
      stats.users++;
    }

    // Get admin user ID for FK references
    const adminUser = await db.User.findOne({ where: { email: 'admin@globalreach.com' } });

    // ============================================
    // 2. Seed Email Accounts
    // ============================================
    log('\n[Seed] Creating email accounts...');
    for (const accData of SEED_ACCOUNTS) {
      const [account] = await db.EmailAccount.findOrCreate({
        where: { email: accData.email },
        defaults: {
          ...accData,
          userId: adminUser.id,
        },
      });
      log(`  ✅ ${account.email} (${account.platform}) [${account.status}]`);
      stats.accounts++;
    }

    // ============================================
    // 3. Seed Clients
    // ============================================
    log('\n[Seed] Creating clients...');
    for (const clientData of SEED_CLIENTS) {
      const [client] = await db.Client.findOrCreate({
        where: { email: clientData.email },
        defaults: {
          ...clientData,
          userId: adminUser.id,
          tags: JSON.stringify(clientData.tags || []),
        },
      });
      stats.clients++;
    }
    log(`  ✅ ${stats.clients} clients created across multiple countries`);

    // ============================================
    // 4. Seed Campaigns
    // ============================================
    log('\n[Seed] Creating campaigns...');
    for (const campData of SEED_CAMPAIGNS) {
      const [campaign] = await db.Campaign.findOrCreate({
        where: { name: campData.name },
        defaults: {
          ...campData,
          userId: adminUser.id,
          targetSegment: JSON.stringify(campData.targetSegment || {}),
        },
      });
      log(`  ✅ "${campaign.name}" (${campaign.type})`);
      stats.campaigns++;
    }

    // ============================================
    // Summary
    // ============================================
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`\n${'═'.repeat(42)}`);
    log(`  Seeding completed in ${elapsed}s`);
    log(`${'─'.repeat(42)}`);
    log(`  Users:    ${stats.users}`);
    log(`  Accounts: ${stats.accounts}`);
    log(`  Clients:  ${stats.clients}`);
    log(`  Campaigns:${stats.campaigns}`);
    log(`${'═'.repeat(42)}`);
    log(`\n  🔑 Test Credentials:`);
    log(`     Admin: admin@globalreach.com / Admin123456`);
    log(`     Demo:  demo@globalreach.com / Demo123456\n`);

    return stats;

  } catch (error) {
    console.error('[Seed] Fatal error:', error.message);
    throw error;
  }
}

// ============================================
// Export & CLI entry point
// ============================================

module.exports = { seed };

if (require.main === module) {
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');
  seed({ force })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
