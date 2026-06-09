/**
 * GlobalReach V2.0 — LOAD 标准负载测试
 *
 * 模拟日常业务流量的混合场景。
 * 包含读操作(70%)、写操作(20%)、元数据请求(10%)的合理比例。
 * 需要 JWT token 进行认证请求。
 *
 * 场景参数:
 *   - VUs: 50 (标准并发)
 *   - Duration: 2min (足够采集统计样本)
 *   - Ramp-up: 10s (渐进式启动)
 *   - 目标 P95: <100ms
 *   - 错误率阈值: <1%
 *
 * 请求分布:
 *   读操作 70%: campaigns, accounts, stats, emails
 *   写操作 20%: create campaign, send email
 *   其他 10%: health, analytics
 */

import { check } from 'k6';
import http from 'k6/http';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// ============================================
// 全局配置
// ============================================

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TEST_USER_EMAIL = __ENV.TEST_USER_EMAIL || 'admin@globalreach.com';
const TEST_USER_PASSWORD = __ENV.TEST_USER_PASSWORD || 'admin123456';

// 自定义指标 — 负载测试专用
export const loadReadTrend = new Trend('gr_load_read_duration', true);
export const loadWriteTrend = new Trend('gr_load_write_duration', true);
export const loadAuthTrend = new Trend('gr_load_auth_duration', true);
export const loadErrorRate = new Rate('gr_load_error_rate');
export const loadThroughput = new Rate('gr_load_throughput');  // 成功率作为吞吐质量指标
export const loadCampaignCreateLatency = new Trend('gr_load_campaign_create_ms', true);
export const loadEmailSendLatency = new Trend('gr_load_email_send_ms', true);

// 共享认证 token (由 setup 填充)
let authToken = '';

// ============================================
// k6 Options — 测试配置
// ============================================

export const options = {
  // 全局阈值
  thresholds: {
    // 读操作 P95 < 100ms
    'gr_load_read_duration': ['p(95)<100'],
    // 写操作 P95 < 300ms (写操作天然更慢)
    'gr_load_write_duration': ['p(95)<300'],
    // 认证相关 P95 < 200ms
    'gr_load_auth_duration': ['p(95)<200'],
    // 整体错误率 < 1%
    'gr_load_error_rate': ['rate<0.01'],
    // HTTP 请求失败率 < 1%
    'http_req_failed': ['rate<0.01'],
    // 总请求数 > 5000 (2min × 50VU 应该远超此值)
    'http_reqs': ['count>5000'],
  },

  scenarios: {
    // 主负载场景：渐进式 ramp-up 到目标并发
    load_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 15 },   // 渐进启动
        { duration: '20s', target: 35 },   // 继续加压
        { duration: '80s', target: 50 },   // 稳定负载期
        { duration: '10s', target: 0 },    // 渐进停止
      ],
      gracefulRampDown: '5s',
      exec: 'loadTest',
      tags: { scenario: 'load' },
    },
  },
};

// ============================================
// Setup — 获取认证 Token
// ============================================

export function setup() {
  console.log(`[LOAD] Starting load test against ${BASE_URL}`);

  // 执行登录获取 JWT token
  const loginPayload = JSON.stringify({
    email: TEST_USER_EMAIL,
    password: TEST_USER_PASSWORD,
  });

  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    loginPayload,
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { phase: 'setup', action: 'login' },
    }
  );

  if (loginRes.status !== 200) {
    console.error(`[LOAD] Login failed: HTTP ${loginRes.status}`);
    console.error(`[LOAD] Response: ${loginRes.body}`);
    throw new Error(`Authentication failed. Check TEST_USER_EMAIL and TEST_USER_PASSWORD.`);
  }

  const token = loginRes.json('data.accessToken');
  authToken = token;
  console.log('[LOAD] Authentication successful, token acquired');

  return {
    token: token,
    startTime: new Date().toISOString(),
  };
}

// ============================================
// 辅助函数 — 认证请求头
// ============================================

/** 构建带 Bearer token 的请求头 */
function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
  };
}

/** 构建带标签的 params */
function taggedParams(endpointGroup) {
  return {
    tags: {
      endpoint: endpointGroup,
      scenario: 'load',
    },
  };
}

// ============================================
// 主测试函数 — 负载测试逻辑
// ============================================

export function loadTest(data) {
  // 使用 setup 返回的 token
  if (data && data.token) {
    authToken = data.token;
  }

  // 请求权重分布
  const rand = Math.random();

  if (rand < 0.25) {
    // ── 25%: 列表 Campaigns (读) ──
    readCampaigns();
  } else if (rand < 0.45) {
    // ── 20%: 列表 Accounts (读) ──
    readAccounts();
  } else if (rand < 0.60) {
    // ── 15%: 统计概览 (读-聚合查询) ──
    readStatsOverview();
  } else if (rand < 0.70) {
    // ── 10%: 列表 Emails (读) ──
    readEmails();
  } else if (rand < 0.80) {
    // ── 10%: 创建 Campaign (写) ──
    createCampaign();
  } else if (rand < 0.90) {
    // ── 10%: 发送邮件 (写-异步) ──
    sendEmail();
  } else if (rand < 0.95) {
    // ── 5%: 健康检查 (轻量) ──
    healthCheck();
  } else {
    // ── 5%: 分析概览 (读-分析查询) ──
    analyticsOverview();
  }
}

// ============================================
// 读操作函数
// ============================================

/** GET /api/v1/campaigns — 列表活动 */
function readCampaigns() {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v1/campaigns?page=1&pageSize=10`,
    Object.assign({ headers: authHeaders() }, taggedParams('campaigns_list'))
  );
  const duration = Date.now() - start;

  loadReadTrend.add(duration);

  check(res, {
    '[LOAD] Campaigns list status OK': (r) => [200, 401].includes(r.status),
    '[LOAD] Campaigns has data array': (r) => Array.isArray(r.json('data')),
  });

  recordResult(res, duration, 'read');
}

/** GET /api/v1/accounts — 列表账号 */
function readAccounts() {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v1/accounts?page=1&pageSize=10`,
    Object.assign({ headers: authHeaders() }, taggedParams('accounts_list'))
  );
  const duration = Date.now() - start;

  loadReadTrend.add(duration);

  check(res, {
    '[LOAD] Accounts list status OK': (r) => [200, 401].includes(r.status),
    '[LOAD] Accounts has data': (r) => r.json('data') !== undefined,
  });

  recordResult(res, duration, 'read');
}

/** GET /api/v1/stats/overview — 统计概览 (聚合查询) */
function readStatsOverview() {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v1/stats/overview`,
    Object.assign({ headers: authHeaders() }, taggedParams('stats_overview'))
  );
  const duration = Date.now() - start;

  loadReadTrend.add(duration);

  check(res, {
    '[LOAD] Stats overview status OK': (r) => [200, 401].includes(r.status),
    '[LOAD] Stats has totalEmailsSent': (r) => r.json('data.totalEmailsSent') !== undefined,
  });

  recordResult(res, duration, 'read');
}

/** GET /api/v1/emails — 列表邮件记录 */
function readEmails() {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v1/emails?page=1&pageSize=10`,
    Object.assign({ headers: authHeaders() }, taggedParams('emails_list'))
  );
  const duration = Date.now() - start;

  loadReadTrend.add(duration);

  check(res, {
    '[LOAD] Emails list status OK': (r) => [200, 401].includes(r.status),
  });

  recordResult(res, duration, 'read');
}

/** GET /api/v1/analytics/overview — 分析概览 */
function analyticsOverview() {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v1/analytics/overview`,
    Object.assign({ headers: authHeaders() }, taggedParams('analytics_overview'))
  );
  const duration = Date.now() - start;

  loadReadTrend.add(duration);

  check(res, {
    '[LOAD] Analytics overview status OK': (r) => [200, 401].includes(r.status),
  });

  recordResult(res, duration, 'read');
}

/** GET /api/v1/health — 健康检查 (无需认证) */
function healthCheck() {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v1/health`,
    taggedParams('health')
  );
  const duration = Date.now() - start;

  loadReadTrend.add(duration);

  check(res, {
    '[LOAD] Health check OK': (r) => r.status === 200,
  });

  recordResult(res, duration, 'read');
}

// ============================================
// 写操作函数
// ============================================

/** POST /api/v1/campaigns — 创建活动 */
function createCampaign() {
  const campaignName = `perf-load-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = JSON.stringify({
    name: campaignName,
    type: 'COLD_OUTREACH',
    subject_template: `[Performance Test] ${campaignName}`,
    body_template: '<h1>Load Test Email</h1><p>This is an automated performance test.</p>',
  });

  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/v1/campaigns`,
    payload,
    Object.assign({
      headers: authHeaders(),
    }, taggedParams('campaigns_create'))
  );
  const duration = Date.now() - start;

  loadWriteTrend.add(duration);
  loadCampaignCreateLatency.add(duration);

  check(res, {
    '[LOAD] Create campaign status OK': (r) => [201, 400, 401].includes(r.status),
    '[LOAD] Create campaign has data': (r) => r.json('data') !== undefined || r.json('error') !== undefined,
  });

  recordResult(res, duration, 'write');
}

/** POST /api/v1/emails/send — 发送单封邮件 (异步入队) */
function sendEmail() {
  const payload = JSON.stringify({
    to: [`perf-${Math.random().toString(36).slice(2, 10)}@example.com`],
    subject: `[Load Test] Performance email ${Date.now()}`,
    html: '<p>Automated load test email.</p>',
  });

  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/v1/emails/send`,
    payload,
    Object.assign({
      headers: authHeaders(),
    }, taggedParams('emails_send'))
  );
  const duration = Date.now() - start;

  loadWriteTrend.add(duration);
  loadEmailSendLatency.add(duration);

  // 发送邮件可能返回 200(成功) 或 202(异步入队) 或 429(限流)
  check(res, {
    '[LOAD] Send email accepted': (r) => [200, 202, 429, 401].includes(r.status),
  });

  recordResult(res, duration, 'write');
}

// ============================================
// 结果记录辅助函数
// ============================================

/**
 * 统一记录请求结果到自定义指标
 * @param {object} res - k6 HTTP 响应对象
 * @param {number} duration - 请求耗时(ms)
 * @param {string} operationType - 操作类型 ('read'|'write')
 */
function recordResult(res, duration, operationType) {
  const isSuccess = [200, 201, 202].includes(res.status);
  loadErrorRate.add(isSuccess ? 0 : 1);
  loadThroughput.add(isSuccess ? 1 : 0);
}

// ============================================
// Teardown — 结果汇总
// ============================================

export function teardown(data) {
  const elapsed = Math.round((Date.now() - new Date(data.startTime).getTime()) / 1000);
  console.log(`\n[LOAD] Test completed in ${elapsed}s`);
  console.log(`[LOAD] Read operations P95: ${loadReadTrend.values.p(95)}ms`);
  console.log(`[LOAD] Write operations P95: ${loadWriteTrend.values.p(95)}ms`);
  console.log(`[LOAD] Overall error rate: ${(loadErrorRate.rate * 100).toFixed(2)}%`);
  console.log(`[LOAD] Campaign create avg: ${loadCampaignCreateLatency.values.avg?.toFixed(1) || 'N/A'}ms`);
  console.log(`[LOAD] Email send avg: ${loadEmailSendLatency.values.avg?.toFixed(1) || 'N/A'}ms`);
}
