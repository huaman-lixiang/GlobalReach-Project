/**
 * Email Template Engine (D03)
 *
 * Handlebars-based template renderer for email campaigns.
 * Supports:
 *   - {{client.*}} variables (name, firstName, lastName, email, company, country)
 *   - {{campaign.*}} variables (name, type)
 *   - {{user.*}} variables (name, company if set)
 *   - Custom helpers: formatDate, capitalize, default, truncate, eq, unless
 *   - HTML-safe output by default (triple-st {{{ }}} for raw HTML)
 *   - Built-in default templates for common use cases
 */

const Handlebars = require('handlebars');
const path = require('path');
const fs = require('fs');

// ============================================
// Register Custom Helpers
// ============================================

Handlebars.registerHelper('formatDate', function(dateStr, format) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const map = { YYYY: d.getFullYear(), MM: String(d.getMonth()+1).padStart(2,'0'), DD: String(d.getDate()).padStart(2,'0') };
  return (format || 'YYYY-MM-DD').replace(/YYYY|MM|DD/g, k => map[k] || k);
});

Handlebars.registerHelper('capitalize', function(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
});

Handlebars.registerHelper('default', function(value, fallback) {
  return value || fallback || '';
});

Handlebars.registerHelper('truncate', function(str, len) {
  if (!str) return '';
  const max = len || 100;
  return str.length > max ? str.substring(0, max) + '...' : str;
});

Handlebars.registerHelper('eq', function(a, b, options) {
  return a === b ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('unless', function(condition, options) {
  return condition ? options.inverse(this) : options.fn(this);
});

Handlebars.registerHelper('json', function(context) {
  return new Handlebars.SafeString(JSON.stringify(context || {}));
});

Handlebars.registerHelper('each_with_index', function(context, options) {
  let ret = '';
  if (context && context.length) {
    for (let i = 0; i < context.length; i++) {
      context[i].index = i;
      ret += options.fn(context[i]);
    }
  }
  return ret;
});

// ============================================
// Default Templates Registry
// ============================================

const DEFAULT_TEMPLATES = {
  // Cold outreach template
  cold_outreach: {
    subject: '{{client.firstName}}, 关于{{user.company || "我们的合作"}}的邀请',
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;line-height:1.6}
.header{text-align:center;border-bottom:2px solid #1890ff;padding-bottom:20px;margin-bottom:30px}
.content{padding:20px 0}
.cta-button{display:inline-block;background:#1890ff;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:600;margin:20px 0}
.cta-button:hover{background:#096dd9}
.footer{border-top:1px solid #eee;padding-top:15px;font-size:12px;color:#999;text-align:center}
</style></head><body>
<div class="header"><h1 style="margin:0;color:#1890ff">{{user.company || "GlobalReach"}}</h1></div>
<div class="content">
<p>尊敬的 {{client.firstName}} {{client.lastName}}，</p>

<p>我是来自{{user.company || "GlobalReach"}}的{{user.name}}。我们专注于帮助企业通过智能化的邮件营销方案，提升客户触达效率。</p>

<p>在了解贵公司（{{client.company || client.email}}）的业务后，我相信我们的解决方案能够为您带来显著的价值：</p>

<ul>
<li>多平台邮件池管理（Gmail/Outlook/QQ/163等）</li>
<li>智能账号轮换与负载均衡</li>
<li>实时发送进度追踪与效果分析</li>
<li>A/B测试与客户分群功能</li>
</ul>

<p>如果您感兴趣，我很乐意安排一次15分钟的演示。</p>

<p>期待您的回复！</p>

<p>祝好，<br>{{user.name}}<br>{{user.company || "GlobalReach Team"}}</p>

<p style="text-align:center"><a href="{{ctaUrl || '#'}}" class="cta-button">预约演示</a></p>
</div>
<div class="footer">
<p>此邮件由 GlobalReach V2.0 系统自动发送 | <a href="{{unsubscribeUrl}}">取消订阅</a></p>
</div>
</body></html>`,
  },

  // Follow-up template
  follow_up: {
    subject: 'Re: 上次沟通的后续 — {{client.firstName}}',
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;line-height:1.6}
.highlight{background:#fff7e6;border-left:4px solid #fa8c16;padding:15px;margin:20px 0}
</style></head><body>
<p>Hi {{client.firstName}}，</p>

<div class="highlight">
<p><strong>跟进提醒：</strong> 我们上次讨论了关于{{client.company || "您的业务"}}的合作机会。</p>
</div>

<p>我想确认一下您是否有任何问题或需要补充的信息？</p>

<p>如果您已经准备好推进下一步，请随时告知我。</p>

<p>Best regards,<br>{{user.name}}</p>
</body></html>`,
  },

  // Newsletter template
  newsletter: {
    subject: '{{user.company || "GlobalReach"}} 周报 — {{formatDate now "YYYY年MM月DD日"}}',
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:650px;margin:0 auto;padding:20px;color:#333;line-height:1.7}
.banner{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;padding:40px 20px;text-align:center;border-radius:10px 10px 0 0}
.banner h1{margin:0;font-size:24px}
.section{padding:25px 0;border-bottom:1px solid #f0f0f0}
.section h2{color:#1890ff;font-size:18px;margin-bottom:15px}
.article-card{background:#fafafa;border-radius:8px;padding:20px;margin:15px 0}
.footer{background:#f5f5f5;padding:20px;text-align:center;font-size:13px;color:#888;border-radius:0 0 10px 10px}
</style></head><body>
<div class="banner">
<h1>{{user.company || "GlobalReach"}} 周刊</h1>
<p>{{formatDate now "YYYY年MM月DD日"}} · 第{{issueNumber || "1"}}期</p>
</div>

{{#each articles}}
<div class="section">
<h2>{{this.title}}</h2>
<div class="article-card">{{{this.content}}}</div>
</div>
{{/each}}

<div class="footer">
<p>您收到此邮件是因为您订阅了 {{user.company || "GlobalReach"}} 的通讯 | <a href="{{unsubscribeUrl}}">退订</a></p>
</div>
</body></html>`,
  },

  // Transactional template (password reset, etc.)
  transactional: {
    subject: '{{subjectLine || "操作通知"}}',
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:500px;margin:0 auto;padding:30px;color:#333;line-height:1.6}
.card{background:#f9f9f9;border-radius:10px;padding:30px;text-align:center;margin:20px 0}
.btn{display:inline-block;background:#52c41a;color:#fff;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px}
.code{font-size:32px;font-weight:700;letter-spacing:8px;color:#1890ff;background:#e6f7ff;padding:20px;border-radius:8px;display:inline-block;margin:20px 0}
</style></head><body>
<div class="card">
<h2 style="margin-top:0;color:#333">{{greeting || "您好"}}</h2>

{{{mainContent}}}

{{#if actionUrl}}
<p><a href="{{actionUrl}}" class="btn">{{actionText || "立即操作"}}</a></p>
{{/if}}

{{#if verificationCode}}
<div class="code">{{verificationCode}}</div>
<p style="color:#888;font-size:14px;">验证码有效时间：{{expiryMinutes || 10}}分钟</p>
{{/if}}
</div>

<p style="text-align:center;color:#aaa;font-size:12px;">
如果您没有请求此操作，请忽略此邮件。<br>
此邮件由系统自动发送，请勿直接回复。
</p>
</body></html>`,
  },

  // Simple plain-text friendly template
  simple: {
    subject: '{{subjectLine || "通知"}}',
    html: `<p>{{greeting || "您好"}}，{{client.firstName || ""}}</p>
<p>{{{mainContent}}}</p>
<p>--<br>{{user.name}}<br>{{user.company || ""}}</p>`,
  },
};

// ============================================
// Template Engine Class
// ============================================

class TemplateEngine {
  constructor(options = {}) {
    this.templateDir = options.templateDir || path.join(__dirname, 'defaults');
    this.cache = new Map(); // Compiled template cache
    this._registerDefaults();
  }

  /**
   * Register built-in default templates into cache.
   */
  _registerDefaults() {
    for (const [name, tpl] of Object.entries(DEFAULT_TEMPLATES)) {
      try {
        this.cache.set(`default:${name}:subject`, Handlebars.compile(tpl.subject));
        this.cache.set(`default:${name}:html`, Handlebars.compile(tpl.html));
      } catch (e) {
        console.warn(`[TemplateEngine] Failed to compile default template "${name}":`, e.message);
      }
    }
    console.log(`[TemplateEngine] Loaded ${Object.keys(DEFAULT_TEMPLATES).length} default templates`);
  }

  /**
   * Render a template string with given context.
   * @param {string} templateStr - Handlebars template string
   * @param {object} context - Data context { client, user, campaign, ...custom }
   * @returns {string} Rendered string
   */
  render(templateStr, context = {}) {
    if (!templateStr) return '';

    // Check cache for compiled template
    const cacheKey = `inline:${templateStr.substring(0, 50)}`;
    let compiled = this.cache.get(cacheKey);

    if (!compiled) {
      try {
        compiled = Handlebars.compile(templateStr);
        this.cache.set(cacheKey, compiled);
      } catch (e) {
        console.error('[TemplateEngine] Compile error:', e.message);
        return templateStr; // Return raw on error
      }
    }

    try {
      return compiled(context);
    } catch (e) {
      console.error('[TemplateEngine] Render error:', e.message);
      return templateStr;
    }
  }

  /**
   * Render a named default template.
   * @param {string} templateName - One of: cold_outreach, follow_up, newsletter, transactional, simple
   * @param {object} context - { client, user, campaign, ...customVars }
   * @returns {{ subject: string, html: string, text: string }}
   */
  renderDefault(templateName, context = {}) {
    const subjectKey = `default:${templateName}:subject`;
    const htmlKey = `default:${templateName}:html`;

    const subjectFn = this.cache.get(subjectKey);
    const htmlFn = this.cache.get(htmlKey);

    if (!subjectFn || !htmlFn) {
      throw new Error(`Template "${templateName}" not found. Available: ${Object.keys(DEFAULT_TEMPLATES).join(', ')}`);
    }

    return {
      subject: subjectFn(context),
      html: htmlFn(context),
      text: _htmlToPlainText(htmlFn(context)),
    };
  }

  /**
   * Register a custom template from string.
   * @param {string} name - Template name
   * @param {string} subject - Subject template
   * @param {string} html - Body HTML template
   */
  registerTemplate(name, subject, html) {
    try {
      this.cache.set(`custom:${name}:subject`, Handlebars.compile(subject));
      this.cache.set(`custom:${name}:html`, Handlebars.compile(html));
      console.log(`[TemplateEngine] Custom template registered: ${name}`);
    } catch (e) {
      throw new Error(`Failed to compile custom template "${name}": ${e.message}`);
    }
  }

  /**
   * List all available template names.
   */
  listTemplates() {
    return {
      defaults: Object.keys(DEFAULT_TEMPLATES),
      customs: [...new Set(
        [...this.cache.keys()].filter(k => k.startsWith('custom:')).map(k => k.split(':')[1])
      )],
    };
  }

  /**
   * Validate template syntax without rendering.
   * @param {string} templateStr
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate(templateStr) {
    try {
      Handlebars.compile(templateStr);
      return { valid: true, errors: [] };
    } catch (e) {
      return { valid: false, errors: [e.message] };
    }
  }

  /**
   * Build full render context for a campaign email.
   * Merges client data + user data + campaign data + custom vars.
   */
  buildContext(client, user, campaign, extraVars = {}) {
    return {
      client: {
        name: `${client.firstName || ''} ${client.lastName || ''}`.trim(),
        firstName: client.firstName || '',
        lastName: client.lastName || '',
        email: client.email || '',
        company: client.company || '',
        country: client.country || '',
        industry: client.industry || '',
        status: client.status || '',
        tags: client.tags || [],
        ...client.customFields || {},
      },
      user: {
        name: user?.name || '',
        email: user?.email || '',
        company: user?.company || extraVars.userCompany || '',
      },
      campaign: {
        name: campaign?.name || '',
        type: campaign?.type || '',
        id: campaign?.id || '',
      },
      now: new Date().toISOString(),
      year: new Date().getFullYear(),
      ...extraVars,
    };
  }
}

// ============================================
// Internal Helpers
// ============================================

function _htmlToPlainText(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = TemplateEngine;
module.exports.Handlebars = Handlebars;
module.exports.DEFAULT_TEMPLATES = DEFAULT_TEMPLATES;
