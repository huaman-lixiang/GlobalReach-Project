const db = require('./index');
const sequelize = db.sequelize;

// D17 索引定义清单 (DEBT-023: 集中管理，便于文档同步)
// 完整索引策略见: docs/DATABASE_INDEX_STRATEGY.md
const INDEX_DEFINITIONS = [
  // ===== users 表 =====
  {
    name: 'idx_users_email',
    sql: 'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
    note: '⚠️ 与Sequelize UNIQUE INDEX (users_email_key) 存在重叠',
  },
  {
    name: 'idx_users_role',
    sql: 'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)',
    note: '按角色筛选用户(管理后台)',
  },

  // ===== email_accounts 表 =====
  {
    name: 'idx_email_accounts_user_id',
    sql: 'CREATE INDEX IF NOT EXISTS idx_email_accounts_user_id ON email_accounts(user_id)',
    note: '按用户查找账号池',
  },
  {
    name: 'idx_email_accounts_platform',
    sql: 'CREATE INDEX IF NOT EXISTS idx_email_accounts_platform ON email_accounts(platform)',
    note: '按平台类型筛选(Gmail/Outlook等)',
  },
  {
    name: 'idx_email_accounts_status',
    sql: 'CREATE INDEX IF NOT EXISTS idx_email_accounts_status ON email_accounts(status)',
    note: '账号状态过滤(ACTIVE/BANNED等)',
  },

  // ===== clients 表 =====
  {
    name: 'idx_clients_user_id',
    sql: 'CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id)',
    note: '按用户查找客户列表',
  },
  {
    name: 'idx_clients_email',
    sql: 'CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email)',
    note: '客户邮箱搜索/去重',
  },

  // ===== campaigns 表 =====
  {
    name: 'idx_campaigns_user_id',
    sql: 'CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id)',
    note: '按用户查找活动列表',
  },
  {
    name: 'idx_campaigns_status',
    sql: 'CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status)',
    note: '活动状态过滤(DRAFT/SENDING等)',
  },

  // ===== emails 表 (高频写入表) =====
  {
    name: 'idx_emails_campaign_id',
    sql: 'CREATE INDEX IF NOT EXISTS idx_emails_campaign_id ON emails(campaign_id)',
    note: '按活动查邮件列表(统计面板)',
  },
  {
    name: 'idx_emails_account_id',
    sql: 'CREATE INDEX IF NOT EXISTS idx_emails_account_id ON emails(account_id)',
    note: '按发送账号查邮件(M7引擎)',
  },
  {
    name: 'idx_emails_client_id',
    sql: 'CREATE INDEX IF NOT EXISTS idx_emails_client_id ON emails(client_id)',
    note: '按客户查邮件历史',
  },
  {
    name: 'idx_emails_status',
    sql: 'CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status)',
    note: '邮件状态过滤(PENDING/SENT等)',
  },
  {
    name: 'idx_emails_created_at',
    sql: 'CREATE INDEX IF NOT EXISTS idx_emails_created_at ON emails(created_at)',
    note: '时间范围查询(分析报表)',
  },

  // ===== refresh_tokens 表 =====
  {
    name: 'idx_refresh_tokens_user_id',
    sql: 'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id)',
    note: 'Token清理/撤销时按用户查找',
  },
  {
    name: 'idx_refresh_tokens_expires_at',
    sql: 'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at)',
    note: '过期Token清理任务(Cron)',
  },

  // ===== audit_logs 表 =====
  {
    name: 'idx_audit_logs_user_id',
    sql: 'CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)',
    note: '⚠️ 与Sequelize L2索引(audit_logs_user_id)存在重叠',
  },
  {
    name: 'idx_audit_logs_created_at',
    sql: 'CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)',
    note: '⚠️ 与Sequelize L2索引(audit_logs_created_at)存在重叠',
  },
];

async function createIndexes() {
  const startTime = Date.now();
  const indexStats = [];
  let created = 0, skipped = 0, failed = 0;

  console.log('[D17] ════════════════════════════════════════════════');
  console.log('[D17] Starting database index optimization...');
  console.log(`[D17] Total indexes to process: ${INDEX_DEFINITIONS.length}`);
  console.log('[D17] Strategy doc: docs/DATABASE_INDEX_STRATEGY.md');
  console.log('[D17] ════════════════════════════════════════════════');

  try {
    for (let i = 0; i < INDEX_DEFINITIONS.length; i++) {
      const idx = INDEX_DEFINITIONS[i];
      const idxStart = Date.now();

      try {
        await sequelize.query(idx.sql);
        const duration = Date.now() - idxStart;

        // 检测是否为"已存在"跳过 (IF NOT EXISTS 静默成功)
        // PostgreSQL IF NOT EXISTS 不抛错，我们通过检查 pg_indexes 确认实际状态
        const [result] = await sequelize.query(
          `SELECT 1 FROM pg_indexes WHERE indexname = :name`,
          { replacements: { name: idx.name } }
        );

        const status = result.length > 0 ? 'CREATED (or already exists)' : 'SKIPPED';
        if (status.includes('already')) skipped++;
        else created++;

        indexStats.push({
          index: idx.name,
          status,
          duration: `${duration}ms`,
          note: idx.note || '',
        });

        console.log(
          `[D17]   [${i + 1}/${INDEX_DEFINITIONS.length}] ` +
          `${idx.name}: ✅ ${status} (${duration}ms)` +
          (idx.note ? ` | ${idx.note}` : '')
        );
      } catch (error) {
        failed++;
        const duration = Date.now() - idxStart;

        indexStats.push({
          index: idx.name,
          status: 'FAILED',
          duration: `${duration}ms`,
          error: error.message,
          note: idx.note || '',
        });

        console.error(
          `[D17]   [${i + 1}/${INDEX_DEFINITIONS.length}] ` +
          `${idx.name}: ❌ FAILED (${duration}ms)`
        );
        console.error(`[D17]       Error: ${error.message}`);
      }
    }

    const totalDuration = Date.now() - startTime;

    // 输出汇总报告
    console.log('[D17] ════════════════════════════════════════════════');
    console.log(`[D17] Index optimization completed in ${totalDuration}ms`);
    console.log(`[D17] Summary:`);
    console.log(`[D17]   ✅ Created/Skipped: ${created + skipped}`);
    console.log(`[D17]   ⏭️  Skipped (exists): ${skipped}`);
    console.log(`[D17]   ❌ Failed:            ${failed}`);
    console.log(`[D17]   📊 Total processed:   ${indexStats.length}/${INDEX_DEFINITIONS.length}`);

    if (failed > 0) {
      console.warn(`[D17] ⚠️  ${failed} index(es) failed — check errors above`);
    }

    // 检测已知重复索引警告
    const duplicateWarnings = indexStats.filter(s =>
      s.note && s.note.includes('⚠️')
    );
    if (duplicateWarnings.length > 0) {
      console.log(`[D17] ℹ️  Duplicate index warnings (${duplicateWarnings.length}):`);
      duplicateWarnings.forEach(w => {
        console.log(`[D17]     - ${w.index}: ${w.note.replace('⚠️', '').trim()}`);
      });
      console.log('[D17]     See docs/DATABASE_INDEX_STRATEGY.md §1.6 for details');
    }

    console.log('[D17] ════════════════════════════════════════════════');

    return {
      success: failed === 0,
      total: indexStats.length,
      created,
      skipped,
      failed,
      duration: totalDuration,
      stats: indexStats,
    };
  } catch (error) {
    console.error('[D17] Fatal error during index creation:', error.message);
    return {
      success: false,
      total: INDEX_DEFINITIONS.length,
      created,
      skipped,
      failed: INDEX_DEFINITIONS.length - created - skipped,
      duration: Date.now() - startTime,
      stats: indexStats,
      error: error.message,
    };
  }
}

module.exports = {
  createIndexes,
  // 导出索引清单供审计和测试使用
  INDEX_DEFINITIONS,
};

if (require.main === module) {
  createIndexes()
    .then((result) => {
      console.log('\n[D17] Result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch((e) => {
      console.error('[D17] Unhandled error:', e);
      process.exit(1);
    });
}
