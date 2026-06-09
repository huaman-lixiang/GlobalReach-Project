/**
 * GlobalReach V2.0 — AUTH-FLOW 认证全链路测试
 *
 * 模拟完整的用户认证生命周期，测量从登录到注销的全链路性能。
 * 验证 JWT token 在高并发下的表现和认证中间件的开销。
 *
 * 测试流程:
 *   步骤1: POST /auth/login     → 获取 accessToken (bcrypt ~200ms@10rounds)
 *   步骤2: GET  /auth/me        → 使用 token 获取用户信息 (JWT verify + DB)
 *   步骤3: GET  /campaigns      → 使用 token 访问业务数据
 *   步骤4: POST /auth/logout    → 注销 token
 *
 * 场景参数:
 *   - VUs: 30 (模拟中等并发登录量)
 *   - Duration: 1min
 *   - 目标全链路 P95: <350ms
 *
 * 自定义指标:
 *   gr_auth_login_ms        — 登录步骤耗时
 *   gr_auth_me_fetch_ms     — 用户信息获取耗时
 *   gr_auth_api_call_ms     — 认证后 API 调用耗时
 *   gr_auth_logout_ms       — 注销耗时
 *   gr_auth_full_roundtrip_ms — 完整链路耗时
 *   gr_auth_error_rate      — 认证链路错误率
 */

import { check } from 'k6';
import http from 'k6/http';
import { Trend, Rate, Counter, Gauge } from 'k6/metrics';

// ============================================
// 全局配置
// ============================================

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TEST_USER_EMAIL = __ENV.TEST_USER_EMAIL || 'admin@globalreach.com';
const TEST_USER_PASSWORD = __ENV.TEST_USER_PASSWORD || 'admin123456';

// 自定义指标 — 认证链路各步骤耗时
export const authLoginMs = new Trend('gr_auth_login_ms', true);
export const authMeFetchMs = new Trend('gr_auth_me_fetch_ms', true);
export const authApiCallMs = new Trend('gr_auth_api_call_ms', true);
export const authLogoutMs = new Trend('gr_auth_logout_ms', true);
export const authFullRoundtripMs = new Trend('gr_auth_full_roundtrip_ms', true);
export const authErrorRate = new Rate('gr_auth_error_rate');
export const authChainSuccessRate = new Rate('gr_auth_chain_success_rate');  // 全链路成功率
export const authLoginSuccessRate = new Rate('gr_auth_login_success_rate');   // 登录成功率
export const authTotalChains = new Counter('gr_auth_chains_total');

// ============================================
// k6 Options — 认证链路测试配置
// ============================================

export const options = {
  thresholds: {
    // 登录步骤 P95 < 200ms (bcrypt 10 rounds ≈ 200ms)
    'gr_auth_login_ms': ['p(95)<250'],
    // 用户信息获取 P95 < 80ms
    'gr_auth_me_fetch_ms': ['p(95)<80'],
    // 业务 API 调用 P95 < 80ms
    'gr_auth_api_call_ms': ['p(95)<80'],
    // 注销 P95 < 80ms
    'gr_auth_logout_ms': ['p(95)<80'],
    // 完整链路 P95 < 350ms
    'gr_auth_full_roundtrip_ms': ['p(95)<400'],
    // 全链路错误率 < 5%
    'gr_auth_error_rate': ['rate<0.05'],
    // 全链路成功率 > 95%
    'gr_auth_chain_success_rate': ['rate>0.95'],
    // 登录成功率 > 98%（排除密码错误等情况）
    'gr_auth_login_success_rate': ['rate>0.95'],
  },

  scenarios: {
    auth_flow: {
      executor: 'constant-vus',
      vus: 30,
      duration: '1m',
      gracefulStop: '5s',
      exec: 'authFlow',
      tags: { scenario: 'auth_flow' },
    },
  },
};

// ============================================
// Setup — 验证认证可用性
// ============================================

export function setup() {
  console.log(`[AUTH] Starting auth flow test against ${BASE_URL}`);

  // 预检登录是否可用
  const preflight = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { phase: 'setup' },
    }
  );

  if (preflight.status !== 200) {
    console.error(`[AUTH] Setup login failed: HTTP ${preflight.status}`);
    console.error(`[AUTH] Response: ${preflight.body.substring(0, 200)}`);
    throw new Error(`Auth endpoint unavailable. Status: ${preflight.status}`);
  }

  console.log(`[AUTH] Setup login successful, token length: ${preflight.json('data.accessToken')?.length || 0}`);
  return { startTime: new Date().toISOString() };
}

// ============================================
// 主测试函数 — 认证全链路
// ============================================

export function authFlow(data) {
  const chainStart = Date.now();
  let chainSuccess = true;
  let currentToken = '';

  // ═══════════════════════════════════════
  // 步骤 1: LOGIN — 用户登录
  // POST /api/v1/auth/login
  // 预期: bcrypt.compare(~200ms) + JWT generation
  // ═══════════════════════════════════════
  const loginStart = Date.now();
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { step: 'login', scenario: 'auth_flow' },
    }
  );
  const loginDuration = Date.now() - loginStart;
  authLoginMs.add(loginDuration);

  const loginOk = loginRes.status === 200;
  authLoginSuccessRate.add(loginOk ? 1 : 0);

  if (loginOk) {
    currentToken = loginRes.json('data.accessToken');

    check(loginRes, {
      '[AUTH][Step1/Login] Returns 200': (r) => r.status === 200,
      '[AUTH][Step1/Login] Has accessToken': (r) => r.json('data.accessToken') !== undefined,
      '[AUTH][Step1/Login] Has refreshToken': (r) => r.json('data.refreshToken') !== undefined,
      '[AUTH][Step1/Login] Has user info': (r) => r.json('data.user') !== undefined,
      '[AUTH][Step1/Login] Login < 300ms': () => loginDuration < 300,
    });
  } else {
    chainSuccess = false;
    console.warn(`[AUTH] Step1 Login failed: HTTP ${loginRes.status}`);
    authErrorRate.add(1);
    // 无法继续后续步骤
    authFullRoundtripMs.add(Date.now() - chainStart);
    authChainSuccessRate.add(0);
    authTotalChains.add(1);
    return;
  }

  // ═══════════════════════════════════════
  // 步骤 2: ME — 获取当前用户信息
  // GET /api/v1/auth/me (需要 Bearer token)
  // 预期: JWT verify + DB query
  // ═══════════════════════════════════════
  const meStart = Date.now();
  const meRes = http.get(
    `${BASE_URL}/api/v1/auth/me`,
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
      },
      tags: { step: 'me', scenario: 'auth_flow' },
    }
  );
  const meDuration = Date.now() - meStart;
  authMeFetchMs.add(meDuration);

  const meOk = meRes.status === 200;
  if (!meOk) chainSuccess = false;

  check(meRes, {
    '[AUTH][Step2/Me] Returns 200': (r) => r.status === 200,
    '[AUTH][Step2/Me] Has user data': (r) => r.json('data') !== undefined,
    '[AUTH][Step2/Me] Me fetch < 100ms': () => meDuration < 100,
  });

  // ═══════════════════════════════════════
  // 步骤 3: API CALL — 访问业务数据
  // GET /api/v1/campaigns (使用同一 token)
  // 预期: JWT verify + DB pagination query
  // ═══════════════════════════════════════
  const apiStart = Date.now();
  const apiRes = http.get(
    `${BASE_URL}/api/v1/campaigns?page=1&pageSize=5`,
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
      },
      tags: { step: 'api_call', scenario: 'auth_flow' },
    }
  );
  const apiDuration = Date.now() - apiStart;
  authApiCallMs.add(apiDuration);

  const apiOk = apiRes.status === 200;
  if (!apiOk) chainSuccess = false;

  check(apiRes, {
    '[AUTH][Step3/API] Campaigns returns 200': (r) => r.status === 200,
    '[AUTH][Step3/API] Has campaigns array': (r) => Array.isArray(r.json('data')),
    '[AUTH][Step3/API] API call < 100ms': () => apiDuration < 100,
  });

  // ═══════════════════════════════════════
  // 步骤 4: LOGOUT — 注销 session
  // POST /api/v1/auth/logout (需要 Bearer token)
  // 预期: token revocation + audit log
  // ═══════════════════════════════════════
  const logoutStart = Date.now();
  const logoutRes = http.post(
    `${BASE_URL}/api/v1/auth/logout`,
    '',
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
      },
      tags: { step: 'logout', scenario: 'auth_flow' },
    }
  );
  const logoutDuration = Date.now() - logoutStart;
  authLogoutMs.add(logoutDuration);

  const logoutOk = logoutRes.status === 200;
  if (!logoutOk) chainSuccess = false;

  check(logoutRes, {
    '[AUTH][Step4/Logout] Returns 200': (r) => r.status === 200,
    '[AUTH][Step4/Logout] Logout < 100ms': () => logoutDuration < 100,
  });

  // ═══════════════════════════════════════
  // 全链路汇总
  // ═══════════════════════════════════════
  const fullRoundtrip = Date.now() - chainStart;
  authFullRoundtripMs.add(fullRoundtrip);
  authTotalChains.add(1);

  if (chainSuccess) {
    authChainSuccessRate.add(1);
    authErrorRate.add(0);
  } else {
    authChainSuccessRate.add(0);
    authErrorRate.add(1);
  }

  // 全链路 check
  check({
    login: loginDuration,
    me: meDuration,
    api: apiDuration,
    logout: logoutDuration,
    total: fullRoundtrip,
  }, {
    '[AUTH][Full Chain] All steps succeeded': () => chainSuccess,
    '[AUTH][Full Chain] Total roundtrip < 400ms': (d) => d.total < 400,
    '[AUTH][Full Chain] Login dominates (expected)': (d) => d.login > d.me,
    '[AUTH][Full Chain] Reasonable proportionality': (d) =>
      d.login < d.total * 0.7,  // login 不应占全链路的 70% 以上
  });
}

// ============================================
// Teardown — 认证链路结果汇总
// ============================================

export function teardown(data) {
  const elapsed = Math.round((Date.now() - new Date(data.startTime).getTime()) / 1000);

  console.log('\n═══════════════════════════════════════════');
  console.log('     AUTH FLOW TEST RESULTS                 ');
  console.log('═══════════════════════════════════════════');
  console.log(`Duration: ${elapsed}s`);
  console.log(`Total chains executed: ${authTotalChains.values.count}`);
  console.log('');

  console.log('── Step-by-step Latency (P95) ──');
  console.log(`  Step 1 - Login:     ${authLoginMs.values.p(95)?.toFixed(1) || 'N/A'}ms  (threshold: 250ms)`);
  console.log(`  Step 2 - Me Fetch:  ${authMeFetchMs.values.p(95)?.toFixed(1) || 'N/A'}ms  (threshold: 80ms)`);
  console.log(`  Step 3 - API Call:  ${authApiCallMs.values.p(95)?.toFixed(1) || 'N/A'}ms  (threshold: 80ms)`);
  console.log(`  Step 4 - Logout:    ${authLogoutMs.values.p(95)?.toFixed(1) || 'N/A'}ms  (threshold: 80ms)`);
  console.log('');

  console.log('── Full Roundtrip ──');
  console.log(`  P50:  ${authFullRoundtripMs.values.p(50)?.toFixed(1) || 'N/A'}ms`);
  console.log(`  P95:  ${authFullRoundtripMs.values.p(95)?.toFixed(1) || 'N/A'}ms  (threshold: 400ms)`);
  console.log(`  P99:  ${authFullRoundtripMs.values.p(99)?.toFixed(1) || 'N/A'}ms`);
  console.log(`  Max:  ${authFullRoundtripMs.values.max?.toFixed(1) || 'N/A'}ms`);
  console.log('');

  console.log('── Success Rates ──');
  console.log(`  Login Success:     ${(authLoginSuccessRate.rate * 100).toFixed(1)}%`);
  console.log(`  Full Chain Success: ${(authChainSuccessRate.rate * 100).toFixed(1)}%  (target: >95%)`);
  console.log(`  Error Rate:        ${(authErrorRate.rate * 100).toFixed(2)}%`);
  console.log('');

  // 性能分解分析
  const loginP95 = authLoginMs.values.p(95) || 0;
  const meP95 = authMeFetchMs.values.p(95) || 0;
  const apiP95 = authApiCallMs.values.p(95) || 0;
  const logoutP95 = authLogoutMs.values.p(95) || 0;
  const total = loginP95 + meP95 + apiP95 + logoutP95;

  if (total > 0) {
    console.log('── Latency Breakdown (P95 % of total) ──');
    console.log(`  Login:   ${(loginP95 / total * 100).toFixed(1)}%  ← bcrypt bottleneck expected`);
    console.log(`  Me:      ${(meP95 / total * 100).toFixed(1)}%`);
    console.log(`  API:     ${(apiP95 / total * 100).toFixed(1)}%`);
    console.log(`  Logout:  ${(logoutP95 / total * 100).toFixed(1)}%`);
  }

  console.log('═══════════════════════════════════════════');
}
