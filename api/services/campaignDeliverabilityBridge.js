/**
 * Campaign-Deliverability Bridge Service (S152)
 *
 * 在Campaign发送前集成域名投递性检查（SPF/DKIM/DMARC）。
 * 提供发送前检查、域名评分、改进建议等能力。
 *
 * @openapi
 * @module campaignDeliverabilityBridge
 */

const dns = require('dns').promises;
const { asyncHandler } = require('../middleware/errorHandler');

// ============================================
// 域名提取工具
// ============================================

/**
 * 从邮箱地址中提取域名
 */
function extractDomain(email) {
  if (!email || typeof email !== 'string') return null;
  const match = email.match(/@(.+)$/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * 从发件人地址列表中提取唯一域名集合
 */
function extractDomainsFromSenders(senderList) {
  if (!senderList || !Array.isArray(senderList)) return new Set();
  const domains = new Set();
  senderList.forEach((sender) => {
    const domain = extractDomain(sender);
    if (domain) domains.add(domain);
  });
  return domains;
}

// ============================================
// SPF / DKIM / DMARC 简化检查器
// ============================================

/**
 * 检查域名的SPF记录
 * @param {string} domain
 * @returns {Promise<{found: boolean, record: string|null, result: string, score: number}>}
 */
async function checkSPF(domain) {
  try {
    const records = await dns.resolveTxt(domain);
    const spfRecord = records.find(r =>
      Array.isArray(r) ? r.join('').startsWith('v=spf1') : r.startsWith('v=spf1')
    );
    const recordStr = Array.isArray(spfRecord) ? spfRecord.join('') : (spfRecord || null);

    if (!recordStr) {
      return { found: false, record: null, result: 'none', score: 0 };
    }

    // 解析SPF策略
    const allFound = recordStr.includes('-all');
    const softFail = recordStr.includes('~all');
    const includeCount = (recordStr.match(/include:/g) || []).length;

    let score = 40; // 基础分（有记录）
    if (allFound) score += 35; // -all 最严格
    else if (softFail) score += 20; // ~all 中等
    else score += 5; // +all 或 ?all 较弱

    score = Math.min(score + Math.min(includeCount * 5, 15), 100); // include加分

    return { found: true, record: recordStr, result: allFound ? 'pass' : softFail ? 'softfail' : 'neutral', score };
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
      return { found: false, record: null, result: 'none', score: 0 };
    }
    return { found: false, record: null, result: 'error', score: 0, error: err.message };
  }
}

/**
 * 检查域名的DKIM记录（简化版：检查常见选择器）
 * @param {string} domain
 * @returns {Promise<{found: boolean, selectors: Array, score: number}>}
 */
async function checkDKIM(domain) {
  const commonSelectors = ['default', 'google', 'selector1', 'selector2', 'k1'];
  const results = [];

  for (const selector of commonSelectors) {
    const dkimDomain = `${selector}._domainkey.${domain}`;
    try {
      const records = await dns.resolveTxt(dkimDomain);
      if (records && records.length > 0) {
        results.push({ selector, found: true, record: Array.isArray(records[0]) ? records[0].join('') : records[0] });
      }
    } catch (_) {
      // DKIM selector not found — continue checking others
    }
  }

  const score = results.length > 0 ? Math.min(60 + results.length * 10, 100) : 0;
  return { found: results.length > 0, selectors: results, score };
}

/**
 * 检查域名的DMARC记录
 * @param {string} domain
 * @returns {Promise<{found: boolean, record: string|null, policy: string, score: number}>}
 */
async function checkDMARC(domain) {
  try {
    const records = await dns.resolveTxt(`_dmarc.${domain}`);
    const dmarcRecord = records.find(r =>
      Array.isArray(r) ? r.join('').startsWith('v=DMARC1') : r.startsWith('v=DMARC1')
    );
    const recordStr = Array.isArray(dmarcRecord) ? dmarcRecord.join('') : (dmarcRecord || null);

    if (!recordStr) {
      return { found: false, record: null, policy: 'none', score: 0 };
    }

    // 解析DMARC策略
    const pMatch = recordStr.match(/p=(reject|quarantine|none)/i);
    const policy = pMatch ? pMatch[1].toLowerCase() : 'none';
    const pctMatch = recordStr.match(/pct=(\d+)/i);
    const pct = pctMatch ? parseInt(pctMatch[1]) : 100;
    const hasRuf = recordStr.includes('ruf=');
    const hasRua = recordStr.includes('rua=');

    let score = 40; // 有DMARC记录基础分
    if (policy === 'reject') score += 35;
    else if (policy === 'quarantine') score += 25;
    else score += 10;

    if (pct === 100) score += 10;
    else if (pct >= 50) score += 5;

    if (hasRua) score += 8;
    if (hasRuf) score += 7;

    return { found: true, record: recordStr, policy, score: Math.min(score, 100) };
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
      return { found: false, record: null, policy: 'none', score: 0 };
    }
    return { found: false, record: null, policy: 'error', score: 0, error: err.message };
  }
}

// ============================================
// 评分计算与等级映射
// ============================================

/**
 * 计算综合投递性评分（100分制）
 * @param {Object} spfResult
 * @param {Object} dkimResult
 * @param {Object} dmarcResult
 * @returns {{score: number, grade: string, breakdown: Object}}
 */
function calculateOverallScore(spfResult, dkimResult, dmarcResult) {
  // 权重: SPF 30%, DKIM 25%, DMARC 45%
  const weightedScore = Math.round(
    (spfResult.score * 0.30) +
    (dkimResult.score * 0.25) +
    (dmarcResult.score * 0.45)
  );

  let grade;
  if (weightedScore >= 90) grade = 'A';
  else if (weightedScore >= 80) grade = 'B';
  else if (weightedScore >= 65) grade = 'C';
  else if (weightedScore >= 50) grade = 'D';
  else grade = 'F';

  return {
    score: weightedScore,
    grade,
    breakdown: {
      spf: { ...spfResult, weight: '30%' },
      dkim: { ...dkimResult, weight: '25%' },
      dmarc: { ...dmarcResult, weight: '45%' },
    },
  };
}

/**
 * 根据等级获取改进建议
 * @param {string} grade
 * @returns {Array<{category: string, priority: string, title: string, description: string}>}
 */
function getRecommendations(grade) {
  const recommendations = {
    A: [
      { category: 'maintenance', priority: 'low', title: '定期检查DNS记录', description: '建议每季度检查一次SPF/DKIM/DMARC配置，确保记录未被篡改' },
      { category: 'monitoring', priority: 'low', title: '启用DMARC报告', description: '配置rua=和ruf=接收聚合报告和取证报告' },
    ],
    B: [
      { category: 'spf', priority: 'medium', title: '优化SPF记录', description: '将~all改为-all以提高安全性，减少lookups数量到10个以内' },
      { category: 'dmarc', priority: 'medium', title: '升级DMARC策略', description: '将policy从none升级为quarantine或reject' },
      { category: 'dkim', priority: 'low', title: '添加DKIM签名', description: '确保所有发件IP都有对应的DKIM选择器和密钥' },
    ],
    C: [
      { category: 'spf', priority: 'high', title: '配置SPF记录', description: '添加v=spf1记录，包含你的邮件服务商IP范围，以-all结尾' },
      { category: 'dmarc', priority: 'high', title: '启用DMARC', description: '在_dmarc子域名下添加v=DMARC1记录，初始设为p=none' },
      { category: 'dkim', priority: 'medium', title: '部署DKIM', description: '为你的域名生成DKIM密钥对并在DNS中发布公钥' },
    ],
    D: [
      { category: 'spf', priority: 'critical', title: '紧急：缺少有效SPF', description: '没有SPF记录会导致邮件被大量拒收。立即添加SPF记录！' },
      { category: 'dmarc', priority: 'critical', title: '紧急：未配置DMARC', description: 'DMARC缺失意味着无法防止域名仿冒。立即配置！' },
      { category: 'dkim', priority: 'high', title: '缺少DKIM签名', description: '无DKIM签名的邮件可能被标记为垃圾邮件' },
    ],
    F: [
      { category: 'spf', priority: 'critical', title: '严重：完全缺乏邮件认证', description: '该域名没有任何邮件安全配置，邮件几乎必定被拒收或进入垃圾箱' },
      { category: 'dmarc', priority: 'critical', title: '严重：DMARC完全缺失', description: '攻击者可以轻易仿冒此域名发送钓鱼邮件' },
      { category: 'general', priority: 'critical', title: '需要全面配置', description: '建议联系邮件安全专家进行完整的域名邮件认证配置' },
    ],
  };

  return recommendations[grade] || recommendations.F;
}

// ============================================
// 公开服务方法
// ============================================

const campaignDeliverabilityBridge = {
  /**
   * 发送前检查Campaign的域名投递性
   * @openapi
   * @param {string} campaignId - Campaign ID
   * @param {Object} context - 包含db, accounts等上下文
   * @returns {Promise<Object>} 检查结果
   */
  async checkBeforeSend(campaignId, context = {}) {
    const db = context.db || require('../db');
    const campaign = await db.Campaign.findByPk(campaignId, {
      include: [{ model: db.Account, as: 'accounts' }],
    });

    if (!campaign) {
      throw Object.assign(new Error('Campaign not found'), { statusCode: 404, code: 'CAMPAIGN_NOT_FOUND' });
    }

    // 获取关联的发件账号
    let senderEmails = [];
    if (campaign.accounts && campaign.accounts.length > 0) {
      senderEmails = campaign.accounts.map(a => a.email).filter(Boolean);
    }

    // 如果没有关联账号，尝试从campaign数据中提取
    if (senderEmails.length === 0 && campaign.account_ids && Array.isArray(campaign.account_ids)) {
      const accounts = await db.Account.findAll({
        where: { id: campaign.account_ids },
        attributes: ['email'],
      });
      senderEmails = accounts.map(a => a.email).filter(Boolean);
    }

    if (senderEmails.length === 0) {
      return {
        canProceed: true,
        warning: 'no_senders',
        message: '无法确定发件域名，跳过投递性检查',
        domains: [],
        overallScore: null,
      };
    }

    const domains = [...extractDomainsFromSenders(senderEmails)];
    const results = [];

    for (const domain of domains) {
      const [spf, dkim, dmarc] = await Promise.all([
        checkSPF(domain),
        checkDKIM(domain),
        checkDMARC(domain),
      ]);

      const overall = calculateOverallScore(spf, dkim, dmarc);
      results.push({
        domain,
        spf,
        dkim,
        dmarc,
        overall,
        recommendations: getRecommendations(overall.grade),
      });
    }

    // 判断是否允许发送（至少一个域名 >= C级）
    const worstGrade = results.reduce((worst, r) => {
      const order = { F: 0, D: 1, C: 2, B: 3, A: 4 };
      return order[r.overall.grade] < order[worst] ? r.overall.grade : worst;
    }, 'A');

    return {
      canProceed: ['A', 'B', 'C'].includes(worstGrade),
      warning: worstGrade === 'D' ? 'low_score' : worstGrade === 'F' ? 'critical' : null,
      message: worstGrade === 'F'
        ? '域名投递性评分过低(F)，建议修复后再发送'
        : worstGrade === 'D'
          ? '域名投递性评分较低(D)，可能导致部分邮件被拒收'
          : '域名投递性检查通过',
      domains: results,
      overallScore: results.length === 1 ? results[0].overall : null,
      worstGrade,
    };
  },

  /**
   * 获取单个域名的投递性评分
   * @openapi
   * @param {string} domain - 要检查的域名
   * @returns {Promise<Object>} 域名评分结果
   */
  async getDomainScore(domain) {
    if (!domain || typeof domain !== 'string') {
      throw Object.assign(new Error('Domain is required'), { statusCode: 400, code: 'INVALID_DOMAIN' });
    }

    const normalizedDomain = domain.toLowerCase().trim();
    const [spf, dkim, dmarc] = await Promise.all([
      checkSPF(normalizedDomain),
      checkDKIM(normalizedDomain),
      checkDMARC(normalizedDomain),
    ]);

    const overall = calculateOverallScore(spf, dkim, dmarc);

    return {
      domain: normalizedDomain,
      checkedAt: new Date().toISOString(),
      spf,
      dkim,
      dmarc,
      overall,
      recommendations: getRecommendations(overall.grade),
    };
  },

  /**
   * 根据等级获取改进建议
   * @openapi
   * @param {string} grade - A/B/C/D/F
   * @returns {Array} 改进建议列表
   */
  getRecommendations(grade) {
    const validGrades = ['A', 'B', 'C', 'D', 'F'];
    if (!validGrades.includes(grade)) {
      throw Object.assign(new Error(`Invalid grade: ${grade}. Must be one of: ${validGrades.join(', ')}`), {
        statusCode: 400,
        code: 'INVALID_GRADE',
      });
    }
    return getRecommendations(grade);
  },

  /**
   * 批量检查多个域名
   * @openapi
   * @param {string[]} domains - 域名列表
   * @returns {Promise<Object[]>} 批量检查结果
   */
  async batchCheck(domains) {
    if (!Array.isArray(domains) || domains.length === 0) {
      throw Object.assign(new Error('Domains array is required'), { statusCode: 400, code: 'INVALID_DOMAINS' });
    }

    const results = await Promise.all(
      domains.map(d => this.getDomainScore(d).catch(err => ({
        domain: d,
        error: err.message,
        overall: { score: 0, grade: 'F', breakdown: {} },
      })))
    );

    return results;
  },
};

module.exports = campaignDeliverabilityBridge;
