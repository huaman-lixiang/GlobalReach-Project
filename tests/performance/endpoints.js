/**
 * GlobalReach V2.0 — ENDPOINT 端点逐一基准测试
 *
 * 对每个 API 端点进行独立基准测试，生成性能排行榜。
 * 使用 k6 scenarios 为每个端点创建独立执行上下文，
 * 每个端点拥有独立的阈值设置。
 *
 * 配置:
 *   - 每个 scenario: 20 VUs, 60s
 *   - 总运行时间: 取决于端点数量 (~3-4 min)
 *   - 每个端点独立报告 P50/P95/P99/max
 *
 * 端点清单 (按路由分组):
 *   Health:    /health, /health/ready, /health/live
 *   Root:      /
 *   Auth:      /auth/login, /auth/me
 *   Campaigns: /campaigns, /campaigns/:id
 *   Accounts:  /accounts
 *   Emails:    /emails
 *   Stats:     /stats/overview
 *   Analytics: /analytics/overview
 *   Metrics:   /metrics
 *   Docs:      /docs
 */

import { check } from 'k6';
import http from 'k6/http';
import { Trend, Rate, Counter } from 'k6/metrics';

// ============================================
// 全局配置
// ============================================

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TEST_USER_EMAIL = __ENV.TEST_USER_EMAIL || 'admin@globalreach.com';
const TEST_USER_PASSWORD = __ENV.TEST_USER_PASSWORD || 'admin123456';

// 端点定义清单 — 每个端点的独立配置
const ENDPOINTS = [
  // ── 无需认证的端点 ──
  {
    id: 'root',
    method: 'GET',
    path: '/',
    needsAuth: false,
    p95Threshold: 20,
    description: 'Root endpoint (service info)',
  },
  {
    id: 'health_full',
    method: 'GET',
    path: '/api/v1/health',
    needsAuth: false,
    p95Threshold: 20,
    description: 'Deep health check (all subsystems)',
  },
  {
    id: 'health_live',
    method: 'GET',
    path: '/api/v1/health/live',
    needsAuth: false,
    p95Threshold: 10,
    description: 'Liveness probe',
  },
  {
    id: 'health_ready',
    method: 'GET',
    path: '/api/v1/health/ready',
    needsAuth: false,
    p95Threshold: 15,
    description: 'Readiness probe',
  },
  {
    id: 'auth_login',
    method: 'POST',
    path: '/api/v1/auth/login',
    needsAuth: false,
    p95Threshold: 200,
    description: 'User login (bcrypt)',
    body: () => JSON.stringify({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
    }),
  },
  {
    id: 'metrics',
    method: 'GET',
    path: '/api/v1/metrics',
    needsAuth: false,
    p95Threshold: 30,
    description: 'Prometheus metrics scrape',
  },
  {
    id: 'docs',
    method: 'GET',
    path: '/api/v1/docs',
    needsAuth: false,
    p95Threshold: 50,
    description: 'Swagger UI docs',
  },

  // ── 需要认证的端点 ──
  {
    id: 'auth_me',
    method: 'GET',
    path: '/api/v1/auth/me',
    needsAuth: true,
    p95Threshold: 50,
    description: 'Current user profile',
  },
  {
    id: 'campaigns_list',
    method: 'GET',
    path: '/api/v1/campaigns?page=1&pageSize=10',
    needsAuth: true,
    p95Threshold: 50,
    description: 'Campaign list (paginated)',
  },
  {
    id: 'campaigns_detail',
    method: 'GET',
    path: '/api/v1/campaigns',  // 动态替换 ID
    needsAuth: true,
    p95Threshold: 50,
    description: 'Single campaign detail',
    dynamicPath: true,  // 标记需要动态 ID
  },
  {
    id: 'accounts_list',
    method: 'GET',
    path: '/api/v1/accounts?page=1&pageSize=10',
    needsAuth: true,
    p95Threshold: 50,
    description: 'Account list (paginated)',
  },
  {
    id: 'emails_list',
    method: 'GET',
    path: '/api/v1/emails?page=1&pageSize=10',
    needsAuth: true,
    p95Threshold: 50,
    description: 'Email records list',
  },
  {
    id: 'stats_overview',
    method: 'GET',
    path: '/api/v1/stats/overview',
    needsAuth: true,
    p95Threshold: 100,
    description: 'Dashboard stats (aggregated queries)',
  },
  {
    id: 'analytics_overview',
    method: 'GET',
    path: '/api/v1/analytics/overview',
    needsAuth: true,
    p95Threshold: 150,
    description: 'Analytics overview (complex queries)',
  },
];

// 为每个端点创建独立的自定义指标
const endpointMetrics = {};
for (const ep of ENDPOINTS) {
  endpointMetrics[ep.id] = {
    trend: new Trend(`gr_ep_${ep.id}_duration`, true),
    errorRate: new Rate(`gr_ep_${ep.id}_error_rate`),
    counter: new Counter(`gr_ep_${ep.id}_requests`),
  };
}

// ============================================
// 动态构建 k6 Options
// ============================================

// 构建 scenarios 对象
const scenarios = {};

for (const ep of ENDPOINTS) {
  scenarios[`endpoint_${ep.id}`] = {
    executor: 'constant-vus',
    vus: 20,
    duration: '60s',
    gracefulStop: '3s',
    exec: 'testEndpoint',
    tags: { endpoint_id: ep.id, endpoint_type: ep.needsAuth ? 'authenticated' : 'public' },
  };
}

// 构建 thresholds 对象
const thresholds = {
  // 全局默认阈值
  'http_req_failed': ['rate<0.05'],
};

for (const ep of ENDPOINTS) {
  thresholds[`gr_ep_${ep.id}_duration`] = [`p(95)<${ep.p95Threshold}`];
  thresholds[`gr_ep_${ep.id}_error_rate`] = ['rate<0.05'];
}

export const options = {
  scenarios: scenarios,
  thresholds: thresholds,
};

// ============================================
// Setup — 获取认证 Token + 采样 Campaign ID
// ============================================

let sharedAuthToken = '';
let sampleCampaignId = '';

export function setup() {
  console.log(`[ENDPOINT] Starting endpoint benchmark against ${BASE_URL}`);
  console.log(`[ENDPOINT] Testing ${ENDPOINTS.length} endpoints in parallel`);

  // 登录获取 token
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
    }),
    { headers: { 'Content-Type': 'application/json' }, tags: { phase: 'setup' } }
  );

  if (loginRes.status !== 200) {
    throw new Error(`[ENDPOINT] Login failed: HTTP ${loginRes.status}`);
  }

  sharedAuthToken = loginRes.json('data.accessToken');
  console.log('[ENDPOINT] Auth successful');

  // 获取一个示例 campaign ID（用于详情接口测试）
  try {
    const campaignsRes = http.get(
      `${BASE_URL}/api/v1/campaigns?page=1&pageSize=1`,
      {
        headers: { 'Authorization': `Bearer ${sharedAuthToken}` },
        tags: { phase: 'setup' },
      }
    );

    if (campaignsRes.status === 200 && Array.isArray(campaignsRes.json('data')) && campaignsRes.json('data').length > 0) {
      sampleCampaignId = campaignsRes.json('data')[0].id;
      console.log(`[ENDPOINT] Sample campaign ID: ${sampleCampaignId}`);
    } else {
      console.log('[ENDPOINT] No campaigns found for detail endpoint testing');
    }
  } catch (e) {
    console.warn('[ENDPOINT] Could not fetch sample campaign ID:', e.message);
  }

  return {
    token: sharedAuthToken,
    campaignId: sampleCampaignId,
    startTime: new Date().toISOString(),
  };
}

// ============================================
// 辅助函数
// ============================================

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token || sharedAuthToken}`,
  };
}

/**
 * 根据 __SCENARIO (k6 内置变量) 获取当前正在测试的端点配置
 * k6 在每个 scenario 执行时会设置 __SCENARIO 为 scenario 名称
 */
function getCurrentEndpointConfig() {
  // 从 scenario 名字提取 endpoint id
  // 格式: "endpoint_health_full" → "health_full"
  const scenarioName = typeof __SCENARIO !== 'undefined' ? __SCENARIO : '';
  const endpointId = scenarioName.replace('endpoint_', '');
  return ENDPOINTS.find(ep => ep.id === endpointId) || ENDPOINTS[0];
}

// ============================================
// 主测试函数 — 端点基准测试
// ============================================

export function testEndpoint(data) {
  if (data) {
    if (data.token) sharedAuthToken = data.token;
    if (data.campaignId) sampleCampaignId = data.campaignId;
  }

  const ep = getCurrentEndpointConfig();
  const metrics = endpointMetrics[ep.id];

  if (!ep || !metrics) {
    console.error(`[ENDPOINT] Unknown endpoint config for scenario: ${__SCENARIO}`);
    return;
  }

  // 构建实际请求路径（处理动态路径如 campaigns/:id）
  let actualPath = ep.path;
  if (ep.dynamicPath && sampleCampaignId) {
    actualPath = `/api/v1/campaigns/${sampleCampaignId}`;
  }

  // 构建请求参数
  const params = {
    headers: ep.needsAuth ? authHeaders() : { 'Content-Type': 'application/json' },
    tags: {
      endpoint: ep.id,
      benchmark: 'endpoints',
    },
  };

  const start = Date.now();
  let res;

  if (ep.method === 'GET') {
    res = http.get(`${BASE_URL}${actualPath}`, params);
  } else if (ep.method === 'POST') {
    const body = typeof ep.body === 'function' ? ep.body() : ep.body;
    res = http.post(`${BASE_URL}${actualPath}`, body, params);
  }

  const duration = Date.now() - start;

  // 记录到端点专属指标
  metrics.trend.add(duration);
  metrics.counter.add(1);

  // 定义可接受的响应状态码
  let acceptable;
  if (ep.id === 'auth_login') {
    acceptable = [200, 401];  // 登录可能返回 401（密码错等）
  } else if (ep.needsAuth) {
    acceptable = [200, 401, 404];  // 认证端点可能 401 或 404
  } else {
    acceptable = [200, 503];  // 公开端点 503 也算合法(如 not_ready)
  }

  const ok = acceptable.includes(res.status);
  metrics.errorRate.add(ok ? 0 : 1);

  // Check 验证
  check(res, {
    `[EP][${ep.id}] Status acceptable`: () => ok,
    `[EP][${ep.id}] Response received`: (r) => r.status !== 0,
    `[EP][${ep.id}] Within P95 threshold`: () => duration <= ep.p95Threshold * 1.5,  // 允许 1.5x 余量用于 check
  });
}

// ============================================
// Teardown — 生成端点排行榜
// ============================================

export function teardown(data) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('     ENDPOINT BENCHMARK RANKING                  ');
  console.log('═══════════════════════════════════════════════════');

  // 收集所有端点数据并排序
  const rankings = [];

  for (const ep of ENDPOINTS) {
    const m = endpointMetrics[ep.id];
    if (!m.trend.values || m.trend.values.count === 0) continue;

    rankings.push({
      id: ep.id,
      description: ep.description,
      method: ep.method,
      auth: ep.needsAuth ? '🔒' : '🌐',
      count: m.trend.values.count,
      p50: m.trend.values.p(50)?.toFixed(1) || 'N/A',
      p95: m.trend.values.p(95)?.toFixed(1) || 'N/A',
      p99: m.trend.values.p(99)?.toFixed(1) || 'N/A',
      max: m.trend.values.max?.toFixed(1) || 'N/A',
      avg: m.trend.values.avg?.toFixed(1) || 'N/A',
      errorRate: (m.errorRate.rate * 100).toFixed(2) + '%',
      threshold: `${ep.p95Threshold}ms`,
      status: (m.trend.values.p(95) || 0) <= ep.p95Threshold ? '✅' : '❌',
    });
  }

  // 按 P95 排序（升序 = 最快在前）
  rankings.sort((a, b) => parseFloat(a.p95) - parseFloat(b.p95));

  // 打印表格
  console.log('');
  console.log(' Rank │ Endpoint                    │ Method │ Auth │  P50  │  P95  │  P99  │  Max  │ Errors │ Thresh │ Status');
  console.log('──────┼─────────────────────────────┼────────┼──────┼───────┼───────┼───────┼───────┼────────┼────────┼--------');

  for (let i = 0; i < rankings.length; i++) {
    const r = rankings[i];
    const rank = String(i + 1).padStart(4);
    const id = r.id.padEnd(27);
    const method = r.method.padEnd(6);
    const auth = r.auth.padEnd(4);
    const p50 = (r.p50 + 'ms').padStart(7);
    const p95 = (r.p95 + 'ms').padStart(7);
    const p99 = (r.p99 + 'ms').padStart(7);
    const max = (r.max + 'ms').padStart(7);
    const errors = r.errorRate.padStart(6);
    const thresh = r.threshold.padStart(6);

    console.log(` ${rank} │ ${id} │ ${method} │ ${auth} │ ${p50} │ ${p95} │ ${p99} │ ${max} │ ${errors} │ ${thresh} │ ${r.status}`);
  }

  // 统计摘要
  const passed = rankings.filter(r => r.status === '✅').length;
  const failed = rankings.filter(r => r.status === '❌').length;

  console.log('');
  console.log(` Summary: ${passed}/${rankings.length} endpoints within threshold ✅  |  ${failed} exceeded ❌`);
  console.log('═══════════════════════════════════════════════════');
}
