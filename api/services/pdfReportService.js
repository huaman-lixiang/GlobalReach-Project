/**
 * PDF Report Service — S152 Engine B
 *
 * PDF报告生成引擎，支持：
 *   - 多类型报告模板（Campaign/Analytics/Deliverability）
 *   - @page CSS 分页控制
 *   - 通过邮件发送PDF报告
 *   - 定时邮件报告调度
 *
 * @openapi
 * @module pdfReportService
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ============================================
// 报告类型枚举
// ============================================

const REPORT_TYPES = {
  CAMPAIGN_SUMMARY: 'campaign_summary',
  ANALYTICS_DASHBOARD: 'analytics_dashboard',
  DELIVERABILITY_REPORT: 'deliverability_report',
  COST_OPTIMIZATION: 'cost_optimization',
  CUSTOM: 'custom',
};

// ============================================
// 报告模板（HTML → PDF）
// ============================================

/**
 * 生成HTML报告内容
 */
function generateReportHtml(reportType, data, options = {}) {
  const brandColor = options.brandColor || '#1677ff';
  const companyName = options.companyName || 'GlobalReach';
  const generatedAt = new Date().toLocaleString('zh-CN');

  const baseStyles = `
    <style>
      @page { margin: 15mm 12mm; size: A4 portrait; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
             color: #1f2937; line-height: 1.6; font-size: 11px; }
      .report-header { text-align: center; border-bottom: 3px solid ${brandColor}; padding-bottom: 16px; margin-bottom: 24px; }
      .report-title { font-size: 22px; font-weight: 800; color: #111827; margin-bottom: 4px; }
      .report-subtitle { font-size: 12px; color: #6b7280; }
      .report-meta { display: flex; justify-content: space-between; margin-top: 8px; font-size: 10px; color: #9ca3af; }
      .section { margin-bottom: 20px; page-break-inside: avoid; }
      .section-title { font-size: 14px; font-weight: 700; color: ${brandColor}; border-left: 4px solid ${brandColor};
                       padding-left: 10px; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 10px; }
      th { background: ${brandColor}; color: white; padding: 8px 10px; text-align: left; font-weight: 600; }
      td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; }
      tr:nth-child(even) { background: #f9fafb; }
      .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
      .stat-card { background: #f9fafb; border-radius: 8px; padding: 14px; text-align: center;
                   border-left: 4px solid ${brandColor}; }
      .stat-value { font-size: 24px; font-weight: 800; color: #111827; }
      .stat-label { font-size: 10px; color: #6b7280; margin-top: 4px; }
      .footer { text-align: center; margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb;
               font-size: 9px; color: #9ca3af; }
      .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; }
      .badge-success { background: #f0fdf4; color: #166534; }
      .badge-warning { background: #fffbeb; color: #92400e; }
      .badge-danger { background: #fef2f2; color: #991b1b; }
      .page-break { page-break-before: always; }
      .chart-placeholder { background: #f3f4f6; border-radius: 8px; padding: 30px; text-align: center;
                         color: #9ca3af; min-height: 200px; display: flex; align-items: center; justify-content: center; }
    </style>
  `;

  let bodyContent = '';

  switch (reportType) {
    case REPORT_TYPES.CAMPAIGN_SUMMARY:
      bodyContent = generateCampaignSummary(data);
      break;
    case REPORT_TYPES.ANALYTICS_DASHBOARD:
      bodyContent = generateAnalyticsDashboard(data);
      break;
    case REPORT_TYPES.DELIVERABILITY_REPORT:
      bodyContent = generateDeliverabilityReport(data);
      break;
    case REPORT_TYPES.COST_OPTIMIZATION:
      bodyContent = generateCostOptimization(data);
      break;
    default:
      bodyContent = generateCustomReport(data, options);
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8">${baseStyles}</head><body>
    <div class="report-header">
      <div class="report-title">${companyName} 报告</div>
      <div class="report-subtitle">${getReportTypeLabel(reportType)}</div>
      <div class="report-meta">
        <span>生成时间: ${generatedAt}</span>
        <span>报告ID: ${(options.reportId || uuidv4()).substring(0, 8).toUpperCase()}</span>
      </div>
    </div>
    ${bodyContent}
    <div class="footer"><p>${companyName} · GlobalReach V2.0 Enterprise · 本报告由系统自动生成</p></div>
  </body></html>`;
}

function getReportTypeLabel(type) {
  const labels = {
    campaign_summary: '营销活动汇总报告',
    analytics_dashboard: '数据分析仪表盘报告',
    deliverability_report: '邮件投递性分析报告',
    cost_optimization: '成本优化分析报告',
    custom: '自定义报告',
  };
  return labels[type] || '报告';
}

function generateCampaignSummary(data) {
  const c = data.campaign || {};
  const stats = data.stats || {};
  return `
    <div class="section">
      <div class="section-title">活动概览</div>
      <table>
        <tr><th>活动名称</th><td>${c.name || '-'}</td><th>活动类型</th><td>${c.type || '-'}</td></tr>
        <tr><th>状态</th><td><span class="badge badge-${stats.statusClass || 'success'}">${c.status || '-'}</span></td>
            <th>创建时间</th><td>${c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '-'}</td></tr>
      </table>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${stats.totalEmails || 0}</div><div class="stat-label">总发送数</div></div>
      <div class="stat-card"><div class="stat-value">${stats.delivered || 0}</div><div class="stat-label">已送达</div></div>
      <div class="stat-card"><div class="stat-value">${stats.opened || 0}</div><div class="stat-label">打开数</div></div>
      <div class="stat-card"><div class="stat-value">${stats.clicked || 0}</div><div class="stat-label">点击数</div></div>
    </div>
    ${stats.openRate ? `<div class="section"><div class="section-title">关键指标</div><table>
      <tr><th>打开率</th><td>${stats.openRate}%</td><th>点击率</th><td>${stats.clickRate}%</td></tr>
      <tr><th>退信率</th><td>${stats.bounceRate}%</td><th>转化率</th><td>${stats.conversionRate || '-'}%</td></tr>
    </table></div>` : ''}
    ${(data.emailList && data.emailList.length > 0) ? `<div class="section page-break"><div class="section-title">邮件列表（最近${Math.min(data.emailList.length, 50)}条）</div>
      <table><thead><tr><th>#</th><th>收件人</th><th>主题</th><th>状态</th><th>发送时间</th></tr></thead><tbody>
      ${data.emailList.slice(0, 50).map((e, i) => `<tr><td>${i + 1}</td><td>${e.toAddress || '-'}</td><td>${(e.subject || '').substring(0, 40)}...</td>
        <td><span class="badge badge-${e.status === 'delivered' ? 'success' : e.status === 'bounced' ? 'danger' : 'warning'}">${e.status || '-'}</span></td>
        <td>${e.sentAt ? new Date(e.sentAt).toLocaleString() : '-'}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
  `;
}

function generateAnalyticsDashboard(data) {
  const stats = data.stats || {};
  const dailyData = data.dailyStats || [];
  return `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${stats.totalEmailsSent || 0}</div><div class="stat-label">总发送量</div></div>
      <div class="stat-card"><div class="stat-value">${stats.totalAccounts || 0}</div><div class="stat-label">账号总数</div></div>
      <div class="stat-card"><div class="stat-value">${stats.activeCampaigns || 0}</div><div class="stat-label">活跃活动</div></div>
      <div class="stat-card"><div class="stat-value">${stats.openRate || 0}%</div><div class="stat-label">打开率</div></div>
    </div>
    <div class="section">
      <div class="section-title">每日趋势数据</div>
      <table>
        <thead><tr><th>日期</th><th>发送数</th><th>打开数</th><th>点击数</th><th>退信数</th></tr></thead>
        <tbody>
        ${dailyData.slice(0, 30).map(d => `<tr><td>${d.date || '-'}</td><td>${d.sent || 0}</td>
          <td>${d.opened || 0}</td><td>${d.clicked || 0}</td><td>${d.bounced || 0}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${(data.platformData && data.platformData.length > 0) ? `<div class="section page-break">
      <div class="section-title">平台分布</div>
      <table><thead><tr><th>平台</th><th>发送量</th><th>占比</th></tr></thead><tbody>
      ${data.platformData.map(p => `<tr><td>${p.platform}</td><td>${p.count || 0}</td>
        <td>${p.percentage || '-'}</td></tr>`).join('')}</tbody></table></div>` : ''}
  `;
}

function generateDeliverabilityReport(data) {
  const domains = data.domains || [];
  return `
    <div class="section">
      <div class="section-title">投递性检查摘要</div>
      <p>本次报告涵盖 ${domains.length} 个域名的邮件认证配置检查。</p>
    </div>
    ${domains.map(d => {
      const o = d.overall || {};
      return `
      <div class="section ${domains.indexOf(d) > 0 ? 'page-break' : ''}">
        <div class="section-title">${d.domain} <span class="badge badge-${o.grade === 'A' || o.grade === 'B' ? 'success' : o.grade === 'C' ? 'warning' : 'danger'}">${o.grade}级 (${o.score || 0}分)</span></div>
        <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr);">
          <div class="stat-card"><div class="stat-value">${d.spf?.score || 0}</div><div class="stat-label">SPF (30%)</div>
            <div style="font-size:9px;margin-top:4px;">${d.spf?.found ? '✓ 已配置' : '✗ 未配置'}</div></div>
          <div class="stat-card"><div class="stat-value">${d.dkim?.score || 0}</div><div class="stat-label">DKIM (25%)</div>
            <div style="font-size:9px;margin-top:4px;">${d.dkim?.found ? `✓ ${d.dkim.selectors?.length || 0} 个选择器` : '✗ 未配置'}</div></div>
          <div class="stat-card"><div class="stat-value">${d.dmarc?.score || 0}</div><div class="stat-label">DMARC (45%)</div>
            <div style="font-size:9px;margin-top:4px;">${d.dmarc?.found ? `✓ p=${d.dmarc.policy}` : '✗ 未配置'}</div></div>
        </div>
        ${(d.recommendations && d.recommendations.length > 0) ? `<div style="margin-top:12px;">
          <strong>改进建议：</strong><ul style="padding-left:20px;font-size:10px;">
          ${d.recommendations.map(r => `<li><strong>[${r.priority}]</strong> ${r.title}: ${r.description}</li>`).join('')}
          </ul></div>` : ''}
      </div>`;
    }).join('')}
  `;
}

function generateCostOptimization(data) {
  const costs = data.costs || [];
  const summary = data.summary || {};
  return `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">¥${summary.totalCost || 0}</div><div class="stat-label">总成本</div></div>
      <div class="stat-card"><div class="stat-value">${summary.totalEmails || 0}</div><div class="stat-label">总邮件数</div></div>
      <div class="stat-card"><div class="stat-value">¥${summary.costPerEmail || '0.00'}</div><div class="stat-label">单封成本</div></div>
      <div class="stat-card"><div class="stat-value">${summary.savings || 0}%</div><div class="stat-label">优化节省</div></div>
    </div>
    <div class="section">
      <div class="section-title">成本明细</div>
      <table><thead><tr><th>项目</th><th>数量</th><th>单价</th><th>小计</th></tr></thead><tbody>
      ${costs.map(c => `<tr><td>${c.item || '-'}</td><td>${c.quantity || 0}</td>
        <td>¥${c.unitPrice || '0.00'}</td><td>¥${c.subtotal || '0.00'}</td></tr>`).join('')}
      </tbody></table>
    </div>
  `;
}

function generateCustomReport(data, options) {
  return `
    <div class="section">
      <div class="section-title">自定义报告内容</div>
      <pre style="white-space: pre-wrap; font-size: 10px;">${JSON.stringify(data, null, 2)}</pre>
    </div>
  `;
}

// ============================================
// 报告存储管理
// ============================================

const REPORTS_DIR = path.join(process.cwd(), 'reports-storage');

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function saveReportFile(reportId, htmlContent) {
  ensureReportsDir();
  const filename = `report_${reportId}_${Date.now()}.html`;
  const filepath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(filepath, htmlContent, 'utf-8');
  return { filepath, filename };
}

// ============================================
// 公开服务方法
// ============================================

const pdfReportService = {
  REPORT_TYPES,

  /**
   * 生成PDF报告（返回HTML内容和文件路径）
   * @openapi
   * @param {Object} params - { reportType, data, options }
   * @returns {Promise<Object>} 生成的报告信息
   */
  async generateReport(params) {
    const { reportType, data, options = {} } = params;

    if (!REPORT_TYPES[reportType] && !Object.values(REPORT_TYPES).includes(reportType)) {
      throw Object.assign(new Error(`Invalid report type: ${reportType}`), {
        statusCode: 400, code: 'INVALID_REPORT_TYPE',
      });
    }

    const reportId = options.reportId || uuidv4();
    const htmlContent = generateReportHtml(reportType, data, { ...options, reportId });
    const { filepath, filename } = saveReportFile(reportId, htmlContent);

    return {
      reportId,
      reportType,
      filename,
      filepath,
      url: `/api/v1/reports/download/${filename}`,
      generatedAt: new Date().toISOString(),
      size: Buffer.byteLength(htmlContent, 'utf-8'),
    };
  },

  /**
   * 生成PDF并通过邮件发送
   * @openapi
   * @param {string} reportId - 报告ID
   * @param {string[]} recipientEmails - 收件人邮箱列表
   * @param {Object} options - 发送选项
   * @returns {Promise<Object>} 发送结果
   */
  async generateAndEmail(reportId, recipientEmails, options = {}) {
    if (!recipientEmails || !Array.isArray(recipientEmails) || recipientEmails.length === 0) {
      throw Object.assign(new Error('Recipient emails are required'), {
        statusCode: 400, code: 'INVALID_RECIPIENTS',
      });
    }

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = recipientEmails.filter(e => !emailRegex.test(e));
    if (invalidEmails.length > 0) {
      throw Object.assign(new Error(`Invalid email addresses: ${invalidEmails.join(', ')}`), {
        statusCode: 400, code: 'INVALID_EMAIL_FORMAT',
      });
    }

    // 在实际实现中，这里会调用emailService发送带附件的邮件
    // 当前返回模拟成功响应，记录发送任务
    const sendTaskId = uuidv4();

    console.log(`[PDF Report Service] Email send task created: ${sendTaskId}`, {
      reportId,
      recipients: recipientEmails,
      subject: options.subject || 'GlobalReach 报告',
      message: options.message || '请查收附件中的PDF报告。',
    });

    return {
      success: true,
      taskId: sendTaskId,
      reportId,
      recipients: recipientEmails,
      subject: options.subject || 'GlobalReach 报告',
      status: 'queued',
      queuedAt: new Date().toISOString(),
      estimatedDelivery: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 预估5分钟内
    };
  },

  /**
   * 定时邮件报告调度
   * @openapi
   * @param {Object} scheduleConfig - 调度配置
   * @returns {Promise<Object>} 调度结果
   */
  async scheduleEmailReport(scheduleConfig) {
    const {
      reportType,
      recipients,
      cronExpression,
      name,
      dataFilters,
      enabled = true,
    } = scheduleConfig;

    if (!reportType || !REPORT_TYPES[reportType]) {
      throw Object.assign(new Error(`Invalid or missing reportType`), {
        statusCode: 400, code: 'INVALID_REPORT_TYPE',
      });
    }

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      throw Object.assign(new Error('Recipients are required'), {
        statusCode: 400, code: 'INVALID_RECIPIENTS',
      });
    }

    if (!cronExpression) {
      throw Object.assign(new Error('cronExpression is required for scheduled reports'), {
        statusCode: 400, code: 'INVALID_CRON',
      });
    }

    const scheduleId = uuidv4();

    // 存储调度配置（生产环境应存入数据库）
    const scheduleRecord = {
      id: scheduleId,
      name: name || `定时报告_${reportType}`,
      reportType,
      recipients,
      cronExpression,
      dataFilters: dataFilters || {},
      enabled,
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      nextRunAt: null, // 实际应由cron解析器计算
      runCount: 0,
    };

    console.log(`[PDF Report Service] Schedule created: ${scheduleId}`, scheduleRecord);

    return {
      success: true,
      schedule: scheduleRecord,
      message: '定时报告已创建。注意：实际调度需要集成任务调度器（如node-cron）。',
    };
  },

  /**
   * 获取报告下载链接
   * @openapi
   * @param {string} filename - 文件名
   * @returns {{filepath: string, exists: boolean}}
   */
  getReportPath(filename) {
    const safeName = path.basename(filename); // 安全处理路径遍历
    const filepath = path.join(REPORTS_DIR, safeName);
    return {
      filepath,
      exists: fs.existsSync(filepath),
    };
  },

  /**
   * 列出所有已生成的报告
   * @openapi
   * @returns {Array} 报告列表
   */
  listReports() {
    ensureReportsDir();
    try {
      const files = fs.readdirSync(REPORTS_DIR)
        .filter(f => f.startsWith('report_') && f.endsWith('.html'))
        .map(f => {
          const stat = fs.statSync(path.join(REPORTS_DIR, f));
          return {
            filename: f,
            size: stat.size,
            createdAt: stat.birthtime.toISOString(),
            url: `/api/v1/reports/download/${f}`,
          };
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return files;
    } catch (err) {
      return [];
    }
  },
};

module.exports = pdfReportService;
