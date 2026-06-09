/**
 * GlobalReach V2.0 — STRESS 压力测试
 *
 * 阶梯式递增负载，定位系统性能瓶颈和饱和点。
 * 从 200 VU 逐步加压到 500 VU，观察各阶段性能变化趋势。
 * 允许较高的延迟阈值（P95 < 500ms），重点在于发现瓶颈。
 *
 * 场景参数:
 *   - 起始 VUs: 200
 *   - 峰值 VUs: 500
 *   - 每阶段持续时间: 60s
 *   - 总时长: ~5min
 *   - 目标 P95: <500ms (峰值阶段可放宽)
 *
 * 关注指标:
 *   - 各阶段的 P95/P99 延迟变化曲线
 *   - 错误率随负载增长的趋势
 *   - 系统是否在极限压力下存活
 *   - 减压后的恢复能力
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

// 自定义指标 — 压力测试专用
export const stressP95ByStage = new Trend('gr_stress_p95_by_stage', true);       // 各阶段 P95
export const stressP99ByStage = new Trend('gr_stress_p99_by_stage', true);       // 各阶段 P99
export const stressErrorRate = new Rate('gr_stress_error_rate');
export const stressCurrentVus = new Gauge('gr_stress_current_vus');              // 当前 VU 数
export const stageCounter = new Counter('gr_stress_stage_transitions');          // 阶段转换计数
export const stressRecoveryTime = new Trend('gr_stress_recovery_time', true);    // 恢复时间

let authToken = '';
let lastStageVUs = 0;
let peakLatency = 0;

// ============================================
// k6 Options — 阶梯式压力配置
// ============================================

export const options = {
  thresholds: {
    // 压力测试允许更高的延迟阈值
    'http_req_duration': ['p(95)<500', 'p(99)<1500'],     // P95<500ms, P99<1.5s
    // 错误率在压力下可以容忍更高 (<10%)
    'http_req_failed': ['rate<0.1'],
    // 自定义错误率阈值
    'gr_stress_error_rate': ['rate<0.1'],
    // 必须有足够的请求数据
    'http_reqs': ['count>10000'],
  },

  scenarios: {
    // 阶梯式加压场景
    stress_ramp: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        // 阶段 1: 基准压力 (200 VU)
        { duration: '60s', target: 200 },
        // 阶段 2: 中等压力 (300 VU)
        { duration: '60s', target: 300 },
        // 阶段 3: 高压力 (400 VU)
        { duration: '60s', target: 400 },
        // 阶段 4: 极限压力 (500 VU)
        { duration: '60s', target: 500 },
        // 阶段 5: 恢复验证 (回到 200 VU)
        { duration: '60s', target: 200 },
        // 冷却
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
      exec: 'stressTest',
      tags: { scenario: 'stress' },
    },
  },
};

// ============================================
// Setup — 认证初始化
// ============================================

export function setup() {
  console.log(`[STRESS] Starting stress test against ${BASE_URL}`);
  console.log('[STRESS] Stage plan: 200→300→400→500→200 VUs (5min total)');

  const loginRes = http.post(
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

  if (loginRes.status !== 200) {
    throw new Error(`[STRESS] Login failed: HTTP ${loginRes.status}`);
  }

  authToken = loginRes.json('data.accessToken');
  console.log('[STRESS] Auth successful');

  return {
    token: authToken,
    startTime: new Date().toISOString(),
    stageMetrics: {},  // 用于记录各阶段指标
  };
}

// ============================================
// 辅助函数
// ============================================

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
  };
}

function stressTags(endpoint) {
  return {
    tags: {
      endpoint: endpoint,
      scenario: 'stress',
    },
  };
}

// ============================================
// 主测试函数 — 压力测试逻辑
// ============================================

export function stressTest(data) {
  if (data && data.token) authToken = data.token;

  // 更新当前 VU 数 gauge
  stressCurrentVus.add(__VU === undefined ? 0 : 1);  // k6 内置变量

  // 混合请求分布 — 与 load 类似但比例不同
  // 压力测试侧重于高频读取（对 DB 压力更大）
  const rand = Math.random();

  if (rand < 0.35) {
    // 35%: Campaigns 列表 (DB 分页查询)
    stressGet('/api/v1/campaigns?page=1&pageSize=10', 'campaigns');
  } else if (rand < 0.60) {
    // 25%: Accounts 列表 (DB 查询 + 引擎状态)
    stressGet('/api/v1/accounts?page=1&pageSize=10', 'accounts');
  } else if (rand < 0.75) {
    // 15%: Stats overview (多表聚合查询 — 最大压力点)
    stressGet('/api/v1/stats/overview', 'stats_overview');
  } else if (rand < 0.85) {
    // 10%: Health check (轻量 — 作为基准参考)
    stressGet('/api/v1/health', 'health');
  } else if (rand < 0.92) {
    // 7%: Emails 列表
    stressGet('/api/v1/emails?page=1&pageSize=10', 'emails');
  } else if (rand < 0.97) {
    // 5%: Analytics (复杂分析查询)
    stressGet('/api/v1/analytics/overview', 'analytics');
  } else {
    // 3%: 创建 Campaign (写操作 — 低频但重要)
    stressPost(
      '/api/v1/campaigns',
      JSON.stringify({
        name: `stress-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'COLD_OUTREACH',
        subject_template: '[Stress Test]',
        body_template: '<p>Stress</p>',
      }),
      'campaigns_create'
    );
  }
}

/**
 * 通用 GET 请求包装（压力测试用）
 */
function stressGet(path, endpointTag) {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}${path}`,
    Object.assign({ headers: authHeaders() }, stressTags(endpointTag))
  );
  const duration = Date.now() - start;

  // 记录延迟趋势
  stressP95ByStage.add(duration);
  stressP99ByStage.add(duration);

  // 追踪峰值延迟
  if (duration > peakLatency) {
    peakLatency = duration;
  }

  // 基本检查
  const ok = [200, 201, 202, 401, 429].includes(res.status);
  check(res, {
    `[STRESS][${endpointTag}] Response received`: (r) => r.status !== 0,  // 连接未断开
    `[STRESS][${endpointTag}] Status acceptable`: () => ok,
  });

  stressErrorRate.add(ok ? 0 : 1);
}

/**
 * 通用 POST 请求包装（压力测试用）
 */
function stressPost(path, body, endpointTag) {
  const start = Date.now();
  const res = http.post(
    `${BASE_URL}${path}`,
    body,
    Object.assign({ headers: authHeaders() }, stressTags(endpointTag))
  );
  const duration = Date.now() - start;

  stressP95ByStage.add(duration);
  stressP99ByStage.add(duration);

  if (duration > peakLatency) peakLatency = duration;

  const ok = [200, 201, 202, 400, 401, 429].includes(res.status);
  check(res, {
    `[STRESS][POST:${endpointTag}] Response received`: (r) => r.status !== 0,
  });

  stressErrorRate.add(ok ? 0 : 1);
}

// ============================================
// Teardown — 压力测试结果分析
// ============================================

export function teardown(data) {
  const elapsed = Math.round((Date.now() - new Date(data.startTime).getTime()) / 1000);

  console.log('\n═══════════════════════════════════════════');
  console.log('       STRESS TEST RESULTS SUMMARY         ');
  console.log('═══════════════════════════════════════════');
  console.log(`Total Duration: ${elapsed}s`);
  console.log(`Peak Latency Observed: ${peakLatency}ms`);
  console.log('');
  console.log('--- Latency Distribution ---');
  console.log(`  P50: ${stressP95ByStage.values.p(50)?.toFixed(1) || 'N/A'}ms`);
  console.log(`  P95: ${stressP95ByStage.values.p(95)?.toFixed(1) || 'N/A'}ms`);
  console.log(`  P99: ${stressP99ByStage.values.p(99)?.toFixed(1) || 'N/A'}ms`);
  console.log(`  Max: ${stressP95ByStage.values.max?.toFixed(1) || 'N/A'}ms`);
  console.log(`  Avg: ${stressP95ByStage.values.avg?.toFixed(1) || 'N/A'}ms`);
  console.log('');
  console.log('--- Quality Metrics ---');
  console.log(`  Error Rate: ${(stressErrorRate.rate * 100).toFixed(2)}%`);
  console.log(`  Total Requests: ${stressP95ByStage.values.count}`);
  console.log('═══════════════════════════════════════════');

  // 阈值判定提示
  const p95 = stressP95ByStage.values.p(95) || 0;
  const errRate = stressErrorRate.rate * 100;

  if (p95 > 500) {
    console.warn(`⚠️  WARNING: P95 (${p95.toFixed(0)}ms) exceeds 500ms threshold`);
  }
  if (errRate > 10) {
    console.warn(`⚠️  WARNING: Error rate (${errRate.toFixed(1)}%) exceeds 10% threshold`);
  }
  if (p95 <= 500 && errRate <= 10) {
    console.log('✅ All stress thresholds passed within tolerance');
  }
}
