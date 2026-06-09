/**
 * GlobalReach V2.0 — SMOKE 冒烟测试
 *
 * 最轻量的健康检查测试，用于 CI/CD 快速门控。
 * 验证系统基本可用性：核心端点响应正常、延迟在阈值内。
 *
 * 场景参数:
 *   - VUs: 10 (轻量并发)
 *   - Duration: 30s (快速完成)
 *   - 目标 P95: <50ms
 *   - 错误率阈值: <1%
 *
 * 测试端点:
 *   GET /api/v1/health        — 深度健康检查
 *   GET /                      — 根端点(服务信息)
 *   GET /api/v1/health/live   — 存活探针
 *   GET /api/v1/health/ready  — 就绪探针
 */

import { check } from 'k6';
import http from 'k6/http';
import { Rate, Trend, Gauge, Counter } from 'k6/metrics';

// ============================================
// 全局配置
// ============================================

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// 自定义指标 — 冒烟测试专用
export const smokeHealthDuration = new Trend('gr_smoke_health_duration', true);
export const smokeRootDuration = new Trend('gr_smoke_root_duration', true);
export const smokeLivenessDuration = new Trend('gr_smoke_liveness_duration', true);
export const smokeReadinessDuration = new Trend('gr_smoke_readiness_duration', true);
export const smokeErrorRate = new Rate('gr_smoke_error_rate');
export const smokeRequests = new Counter('gr_smoke_requests_total');

// ============================================
// k6 Options — 测试配置
// ============================================

export const options = {
  // 全局阈值定义（通过/失败标准）
  thresholds: {
    // 健康检查 P95 必须 < 50ms
    'gr_smoke_health_duration': ['p(95)<50'],
    // 根端点 P95 必须 < 50ms
    'gr_smoke_root_duration': ['p(95)<50'],
    // 存活探针 P95 必须 < 30ms
    'gr_smoke_liveness_duration': ['p(95)<30'],
    // 就绪探针 P95 必须 < 40ms
    'gr_smoke_readiness_duration': ['p(95)<40'],
    // 整体错误率必须 < 1%
    'gr_smoke_error_rate': ['rate<0.01'],
    // 总请求数必须 > 100（确保测试有效运行）
    'http_reqs': ['count>100'],
    // HTTP 请求失败率 < 1%
    'http_req_failed': ['rate<0.01'],
  },

  // 场景配置
  scenarios: {
    smoke_test: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30s',
      gracefulStop: '5s',
      exec: 'smokeTest',
      tags: { scenario: 'smoke' },
    },
  },
};

// ============================================
// Setup — 测试前初始化
// ============================================

export function setup() {
  console.log(`[SMOKE] Starting smoke test against ${BASE_URL}`);
  console.log(`[SMOKE] VUs: ${options.scenarios.smoke_test.vus}, Duration: ${options.scenarios.smoke_test.duration}`);

  // 预检：验证 API 可达性
  const preflight = http.get(`${BASE_URL}/api/v1/health/live`, {
    timeout: '10s',
    tags: { phase: 'setup' },
  });

  if (preflight.status !== 200) {
    console.error(`[SMOKE] Preflight check failed: HTTP ${preflight.status}`);
    console.error(`[SMOKE] Response: ${preflight.body}`);
    throw new Error(`API unreachable at ${BASE_URL}. Status: ${preflight.status}`);
  }

  console.log('[SMOKE] Preflight check passed, API is reachable');
  return { startTime: new Date().toISOString() };
}

// ============================================
// 主测试函数 — 冒烟测试逻辑
// ============================================

export function smokeTest(data) {
  // 请求权重分布：
  // health(60%) + root(20%) + live(10%) + ready(10%)

  const rand = Math.random();

  if (rand < 0.60) {
    // ── 60%: 深度健康检查 (最核心) ──
    testHealthEndpoint();
  } else if (rand < 0.80) {
    // ── 20%: 根端点 ──
    testRootEndpoint();
  } else if (rand < 0.90) {
    // ── 10%: 存活探针 ──
    testLivenessEndpoint();
  } else {
    // ── 10%: 就绪探针 ──
    testReadinessEndpoint();
  }
}

/**
 * 测试深度健康检查端点
 * GET /api/v1/health
 * 包含 DB、Redis、Engine、Queue、System 资源检查
 */
function testHealthEndpoint() {
  const start = Date.now();
  const res = http.get(`${BASE_URL}/api/v1/health`, {
    tags: { endpoint: 'health', scenario: 'smoke' },
  });
  const duration = Date.now() - start;

  smokeHealthDuration.add(duration);

  check(res, {
    '[SMOKE] Health status is healthy or degraded': (r) =>
      [200].includes(r.status),
    '[SMOKE] Health has valid JSON body': (r) => r.json() !== null,
    '[SMOKE] Health response time OK': (r) => r.timings.duration < 100,
    '[SMOKE] Health has score field': (r) =>
      r.json('healthScore') !== undefined,
  });

  if (res.status !== 200) {
    smokeErrorRate.add(1);
  } else {
    smokeErrorRate.add(0);
  }
  smokeRequests.add(1);
}

/**
 * 测试根端点
 * GET /
 * 返回服务基本信息和端点列表
 */
function testRootEndpoint() {
  const start = Date.now();
  const res = http.get(`${BASE_URL}/`, {
    tags: { endpoint: 'root', scenario: 'smoke' },
  });
  const duration = Date.now() - start;

  smokeRootDuration.add(duration);

  check(res, {
    '[SMOKE] Root endpoint returns 200': (r) => r.status === 200,
    '[SMOKE] Root has service name': (r) => r.json('service') === 'GlobalReach V2.0 Enterprise API',
    '[SMOKE] Root has version': (r) => r.json('version') !== undefined,
  });

  smokeErrorRate.add(res.status === 200 ? 0 : 1);
  smokeRequests.add(1);
}

/**
 * 测试存活探针
 * GET /api/v1/health/live
 * Kubernetes/Docker liveness probe 端点
 */
function testLivenessEndpoint() {
  const start = Date.now();
  const res = http.get(`${BASE_URL}/api/v1/health/live`, {
    tags: { endpoint: 'health_live', scenario: 'smoke' },
  });
  const duration = Date.now() - start;

  smokeLivenessDuration.add(duration);

  check(res, {
    '[SMOKE] Liveness probe alive': (r) => r.status === 200,
    '[SMOKE] Liveness has pid': (r) => r.json('pid') !== undefined,
    '[SMOKE] Liveness has uptime': (r) => typeof r.json('uptime') === 'number',
  });

  smokeErrorRate.add(res.status === 200 ? 0 : 1);
  smokeRequests.add(1);
}

/**
 * 测试就绪探针
 * GET /api/v1/health/ready
 * Kubernetes/Docker readiness probe 端点
 */
function testReadinessEndpoint() {
  const start = Date.now();
  const res = http.get(`${BASE_URL}/api/v1/health/ready`, {
    tags: { endpoint: 'health_ready', scenario: 'smoke' },
  });
  const duration = Date.now() - start;

  smokeReadinessDuration.add(duration);

  check(res, {
    '[SMOKE] Readiness probe ready': (r) =>
      [200, 503].includes(r.status),  // 503 = not_ready 也是合法状态
    '[SMOKE] Readiness has timestamp': (r) => r.json('timestamp') !== undefined,
  });

  // 503 (not_ready) 不算错误（可能是 DB 还没连上）
  smokeErrorRate.add([200, 503].includes(res.status) ? 0 : 1);
  smokeRequests.add(1);
}

// ============================================
// Teardown — 测试后清理
// ============================================

export function teardown(data) {
  const elapsed = Math.round((Date.now() - new Date(data.startTime).getTime()) / 1000);
  console.log(`\n[SMOKE] Test completed in ${elapsed}s`);
  console.log(`[SMOKE] Total requests: ${smokeRequests.values.count}`);
  console.log(`[SMOKE] Error rate: ${(smokeErrorRate.rate * 100).toFixed(2)}%`);
  console.log(`[SMOK] Health P95: ${smokeHealthDuration.values.p(95)}ms`);
  console.log(`[SMOKE] Root P95: ${smokeRootDuration.values.p(95)}ms`);
}
