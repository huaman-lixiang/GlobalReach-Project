/**
 * N+1 Query Pattern Auditor
 * DEBT-025: 扫描 route handlers 和 service 层代码，识别潜在 N+1 查询模式
 *
 * 用法: node scripts/audit-n-plus-one.js
 *
 * 检测原理:
 *   - 基于静态代码模式匹配 (pattern-based)
 *   - 不保证 100% 准确率 (可能存在误报/漏报)
 *   - 所有疑似问题需通过 EXPLAIN ANALYZE 或运行时日志确认
 *
 * 输出:
 *   - 控制台结构化报告
 *   - 可选 JSON 输出 (--json 参数)
 *
 * @version 1.0.0
 * @date 2026-06-09
 * @ref DEBT-025
 */

const fs = require('fs');
const path = require('path');

// ============================================
// 检测规则定义
// ============================================

const N_PLUS_ONE_PATTERNS = [
  // ---- HIGH 严重性 ----

  // Pattern 1: 循环内的数据库查询 (最典型的N+1)
  {
    id: 'P001',
    pattern: /for\s*\([^)]*\)\s*\{[\s\S]{0,500}?\.(findAll|findOne|findByPk|count|findAndCountAll|create|update|destroy|increment|decrement)\s*\(/gm,
    description: 'Query inside for-loop (循环内数据库查询)',
    severity: 'HIGH',
    recommendation: '使用 WHERE IN 批量查询替代循环内单条查询，或使用 Sequelize eager loading (include)',
    example: `
// ❌ Bad: N+1 queries
for (const client of clients) {
  const emails = await Email.findAll({ where: { clientId: client.id } });
}

// ✅ Good: Single query with WHERE IN
const emails = await Email.findAll({
  where: { clientId: clients.map(c => c.id) }
});
    `,
  },

  // Pattern 2: forEach 内的异步查询 (无 Promise.all)
  {
    id: 'P002',
    pattern: /\.forEach\(\s*async\s*\(/gm,
    description: 'Async callback in forEach without Promise.all (forEach中异步操作未并行化)',
    severity: 'HIGH',
    recommendation: '使用 Promise.all(array.map(async item => ...)) 替代 forEach + async',
    example: `
// ❌ Bad: Sequential async operations
clients.forEach(async (client) => {
  await sendEmail(client);
});

// ✅ Good: Parallel execution
await Promise.all(clients.map(client => sendEmail(client)));
    `,
  },

  // Pattern 3: await 在 .map() 中但未用 Promise.all 包裹
  {
    id: 'P003',
    pattern: /\.(map)\(\s*async\s*(?:\([^)]*\)|[^=])[\s\S]{0,300}?await/gm,
    description: 'async map without outer Promise.all/await (异步map未并行化)',
    severity: 'HIGH',
    recommendation: '确保 map 外层有 await Promise.all() 包裹',
    example: `
// ❌ Bad: map returns unresolved promises
const results = items.map(async item => {
  return await processItem(item);  // promises not awaited!
});

// ✅ Good: Properly parallelized
const results = await Promise.all(items.map(async item => {
  return await processItem(item);
}));
    `,
  },

  // ---- MEDIUM 严重性 ----

  // Pattern 4: findAll 后紧跟 for/forEach/map (潜在N+1)
  {
    id: 'P004',
    pattern: /(?:const|let|var)\s+(\w+)\s*=\s*await\s+\w+.\b(findAll|findAndCountAll)\b[\s\S]{0,300}(?:for(?:Each)?|\.(?:map|forEach|reduce|filter))\s*[\(]/gm,
    description: 'Potential loop after bulk fetch (批量获取后循环处理)',
    severity: 'MEDIUM',
    recommendation: '检查循环体内是否有数据库查询。如有，考虑使用子查询、window函数或JOIN',
    note: '此模式本身不一定是问题，需确认循环体内无DB调用',
  },

  // Pattern 5: while 循环中的查询 (分页实现不当)
  {
    id: 'P005',
    pattern: /while\s*\([^)]*\)[\s\S]{0,300}\.(findAll|findOne|count)\s*\(/gm,
    description: 'Query inside while-loop (while循环内查询)',
    severity: 'MEDIUM',
    recommendation: '检查是否为分页遍历。如数据量大，考虑使用 cursor-based pagination 或流式处理',
  },

  // Pattern 6: 缺少 include 的关联查询 (Sequelize 特有)
  {
    id: 'P006',
    pattern: /\w+\.(findAll|findOne)\s*\(\s*\{[^}]*(?:where|limit|offset)[^}]*\}\s*\)[\s\S]{0,200}(?:===|!==|=)\s*null[\s\S]{0,100}\.\w+/gm,
    description: 'Potential missing eager loading (可能缺少eager loading)',
    severity: 'MEDIUM',
    recommendation: '如后续访问了关联属性，应在查询时添加 include: [{ model, as: ... }]',
    note: '误报率较高，仅作参考提示',
  },

  // ---- LOW 严重性 ----

  // Pattern 7: 嵌套的 await 调用链 (可能可并行)
  {
    id: 'P007',
    pattern: /await\s+(?:\w+\.)?(?:findAll|findOne|findByPk|count|findAndCountAll)[\s\S]{0,100}await\s+(?:\w+\.)?(?:findAll|findOne|findByPk|count|findAndCountAll)/gm,
    description: 'Sequential awaits that could potentially be parallelized (顺序await可能可并行化)',
    severity: 'LOW',
    recommendation: '如果两个查询无依赖关系，可用 Promise.all 并行执行',
    note: '很多情况是合理的(第二个依赖第一个结果)，需人工判断',
  },
];

// 忽略的文件/目录
const IGNORED_FILES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '__tests__',
  '.test.js',
  '.spec.js',
];

// ============================================
// 核心扫描逻辑
// ============================================

function scanFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return [];
  }

  // 跳过过小的文件 (<100字符)
  if (content.length < 100) return [];

  const results = [];
  const lines = content.split('\n');

  N_PLUS_ONE_PATTERNS.forEach(({ id, pattern, description, severity, recommendation, note, example }) => {
    // 重置正则 lastIndex
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      // 计算行号
      const matchStart = match.index;
      const lineNum = content.substring(0, matchStart).split('\n').length;

      // 提取上下文代码 (前后各3行)
      const startLine = Math.max(1, lineNum - 3);
      const endLine = Math.min(lines.length, lineNum + 3);
      const contextLines = lines.slice(startLine - 1, endLine).map((line, i) =>
        `${startLine + i}${'   '.substring(String(startLine + i).length)}${line}`
      ).join('\n');

      // 提取匹配行的代码片段
      const matchedLine = lines[lineNum - 1] || '';
      const snippet = matchedLine.trim().substring(0, 120);

      results.push({
        id,
        line: lineNum,
        pattern: description,
        severity,
        snippet,
        context: contextLines,
        recommendation: recommendation || '',
        note: note || '',
        example: example || '',
      });
    }
  });

  return results;
}

function scanDirectory(dirPath, prefix = '') {
  const results = [];

  if (!fs.existsSync(dirPath)) {
    console.log(`  ⚠️  Directory not found: ${dirPath}`);
    return results;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    // 跳过忽略项
    if (IGNORED_FILES.some(ignored => entry.name.includes(ignored))) continue;

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      results.push(...scanDirectory(fullPath, relativePath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const issues = scanFile(fullPath);
      issues.forEach(issue => {
        issue.file = relativePath;
      });
      results.push(...issues);
    }
  }

  return results;
}

function generateReport(issues) {
  const report = { high: [], medium: [], low: [] };

  issues.forEach(issue => {
    const key = issue.severity.toLowerCase();
    if (report[key]) {
      report[key].push(issue);
    }
  });

  return report;
}

function printReport(report, options = {}) {
  const totalIssues = report.high.length + report.medium.length + report.low.length;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║          GlobalReach N+1 Query Audit Report                  ║');
  console.log('║          DEBT-025 | Static Code Analysis                     ║');
  console.log('║                                                              ║');
  console.log(`║  Total Issues Found: ${totalIssues.toString().padStart(3)}                                       ║`);
  console.log(`║  HIGH: ${report.high.length.toString().padStart(2)} | MEDIUM: ${report.medium.length.toString().padStart(2)} | LOW: ${report.low.length.toString().padStart(2)}                              ║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  ⚠️  Based on pattern matching only — false positives possible ║');
  console.log('║  🔍  Confirm all findings with EXPLAIN ANALYZE               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // 输出 HIGH 级别
  ['HIGH', 'MEDIUM'].forEach(severity => {
    const items = report[severity.toLowerCase()];
    if (items.length === 0) return;

    console.log(`${'═'.repeat(60)}`);
    console.log(`🔴 ${severity} SEVERITY (${items.length} issue${items.length > 1 ? 's' : ''})`);
    console.log(`${'═'.repeat(60)}`);

    items.forEach((issue, i) => {
      console.log('');
      console.log(`  ┌─ [${i + 1}] ${issue.file}:${issue.line}`);
      console.log(`  │`);
      console.log(`  │  Pattern: [${issue.id}] ${issue.pattern}`);
      console.log(`  │  Code:    ${issue.snippet}...`);

      if (issue.note) {
        console.log(`  │  Note:    ${issue.note}`);
      }

      console.log(`  │  Fix:     ${issue.recommendation}`);

      // 显示上下文代码
      if (!options.compact) {
        console.log(`  │`);
        console.log(`  ├─ Context:`);
        issue.context.split('\n').forEach(line => {
          console.log(`  │  ${line}`);
        });
      }

      // 显示示例代码 (仅HIGH级别)
      if (severity === 'HIGH' && issue.example && !options.compact) {
        console.log(`  │`);
        console.log(`  ├─ Example:`);
        issue.example.trim().split('\n').forEach(line => {
          console.log(`  │  ${line}`);
        });
      }

      console.log(`  └─`);
    });
    console.log('');
  });

  // 输出 LOW 级别 (摘要)
  if (report.low.length > 0) {
    console.log(`${'─'.repeat(60)}`);
    console.log(`🟡 LOW SEVERITY (${report.low.length} issue${report.low.length > 1 ? 's' : ''}) — Summary only`);
    console.log(`${'─'.repeat(60)}`);

    report.low.forEach((issue, i) => {
      console.log(`  ${i + 1}. ${issue.file}:${issue.line} — [${issue.id}] ${issue.pattern}`);
    });
    console.log('');
  }

  // 总结
  if (totalIssues === 0) {
    console.log('');
    console.log('  ✅ No obvious N+1 patterns detected!');
    console.log('  💡 Tip: Still recommend runtime query logging for production monitoring.');
    console.log('');
  } else {
    console.log(`${'═'.repeat(60)}`);
    console.log('SUMMARY & NEXT STEPS');
    console.log(`${'═'.repeat(60)}`);
    console.log('');
    console.log(`  📊 Scan Results:`);
    console.log(`     • Files scanned: routes/ + services/ directories`);
    console.log(`     • Total issues:  ${totalIssues}`);
    console.log(`     • High priority: ${report.high.length} (should fix first)`);
    console.log(`     • Medium priority: ${report.medium.length} (review recommended)`);
    console.log(`     • Low priority: ${report.low.length} (informational)`);
    console.log('');
    console.log(`  📋 Recommended Actions:`);

    if (report.high.length > 0) {
      console.log(`     1. Review each HIGH issue above and confirm if it's a real N+1 problem`);
      console.log(`     2. For confirmed issues, apply the suggested fix patterns`);
      console.log(`     3. Test with EXPLAIN ANALYZE before and after optimization`);
    }
    if (report.medium.length > 0) {
      console.log(`     4. Review MEDIUM issues — may indicate suboptimal query patterns`);
    }
    console.log(`     5. Enable Sequelize logging in dev to capture actual query counts`);
    console.log(`     6. Consider adding integration tests for query performance`);
    console.log('');
    console.log(`  🔗 Reference:`);
    console.log(`     • DEBT-025: Potential N+1 Query Issues`);
    console.log(`     • docs/DATABASE_INDEX_STRATEGY.md §5 (Performance Baseline)`);
    console.log('');
  }

  return report;
}

// ============================================
// 主入口
// ============================================

function main() {
  const args = process.argv.slice(2);
  const options = {
    json: args.includes('--json'),
    compact: args.includes('--compact'),
  };

  // 项目根目录 (scripts/ 的上级)
  const projectRoot = path.join(__dirname, '..');
  const routesDir = path.join(projectRoot, 'api', 'routes');
  const servicesDir = path.join(projectRoot, 'api', 'services');

  console.log('GlobalReach N+1 Query Pattern Auditor v1.0.0');
  console.log('DEBT-025: Static Analysis for Potential N+1 Problems');
  console.log('');

  // 扫描 routes 和 services 目录
  const allIssues = [
    ...scanDirectory(routesDir, 'api/routes'),
    ...scanDirectory(servicesDir, 'api/services'),
  ];

  // 去重 (同一位置多个模式匹配)
  const uniqueIssues = [];
  const seen = new Set();
  allIssues.forEach(issue => {
    const key = `${issue.file}:${issue.line}:${issue.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueIssues.push(issue);
    }
  });

  // 生成报告
  const report = generateReport(uniqueIssues);

  // 输出报告
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, options);
  }

  // 返回退出码 (有HIGH问题返回非零)
  if (report.high.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
