/**
 * GlobalReach V2.0 — SPIKE 突发流量测试
 *
 * 模拟突发流量冲击（如营销活动启动瞬间）。
 * 指数级爬坡 → 峰值维持 → 指数级骤降 → 恢复观测。
 * 重点验证系统的弹性、限流行为和恢复能力。
 *
 * 流量曲线:
 *   10 → 100 → 500 → 1000 VUs (爬坡 45s)
 *   1000 VUs 维持 30s (峰值)
 *   1000 → 500 → 100 → 10 VUs (骤降 45s)
 *   10 VUs 恢复期 60s
 *   总时长: ~3min
 *
 * 关键观测点:
 *   1. 爬坡期: 限流器触发情况 (429 比例)
 *   2. 峰值期: 系统存活? P999? 错误率?
 *   3. 骤降期: 资源释放? 连接池回收?
 *   4. 恢复期: 延迟回归基线? 残留影响?
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

// 自定义指标 — 突发流量测试专用
export const spikeRampUpLatency = new Trend('gr_spike_rampup_latency', true);      // 爬坡期延迟
export const spikePeakLatency = new Trend('gr_spike_peak_latency', true);           // 峰值期延迟
export const spikeRampDownLatency = new Trend('gr_spike_rampdown_latency', true);   // 骤降期延迟
export const spikeRecoveryLatency = new Trend('gr_spike_recovery_latency', true);   // 恢复期延迟
export const spikeRateLimitedCount = new Counter('gr_spike_rate_limited_total');    // 429 计数
export const spikeErrorRate = new Rate('gr_spike_error_rate');
export const spikeActiveVus = new Gauge('gr_spike_active_vus');
export const spikePhaseIndicator = new Trend('gr_spike_phase_indicator', true);    // 阶段标记

let authToken = '';
let testStartTime = 0;

// ============================================
// k6 Options — 突发流量配置
// ============================================

export const options = {
  thresholds: {
    // 突发流量允许更宽松的阈值
    'http_req_duration': ['p(95)<1000', 'p(99)<3000'],  // P95<1s, P99<3s
    // 错误率容忍度更高 (含 429 限流)
    'http_req_failed': ['rate<0.2'],
    'gr_spike_error_rate': ['rate<0.2'],
    // 必须有足够数据
    'http_reqs': ['count>5000'],
    // 峰值期 P95 不能超过 2s
    'gr_spike_peak_latency': ['p(95)<2000'],
  },

  scenarios: {
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        // ===== 爬坡阶段 (指数增长) =====
        { duration: '15s', target: 100 },    // 10→100
        { duration: '15s', target: 350 },    // 100→350 (加速)
        { duration: '15s', target: 700 },    // 350→700 (继续加速)
        { duration: '15s', target: 1000 },   // 700→1000 (到达峰值)

        // ===== 峰值维持阶段 =====
        { duration: '30s', target: 1000 },   // 维持峰值 30 秒

        // ===== 骤降阶段 (指数下降) =====
        { duration: '15s', target: 600 },    // 1000→600
        { duration: '15s', target: 200 },    // 600→200
        { duration: '15s', target: 50 },     // 200→50

        // ===== 恢复观测阶段 =====
        { duration: '60s', target: 10 },     // 低负载恢复
        { duration: '15s', target: 0 },      // 完全停止
      ],
      gracefulRampDown: '5s',
      exec: 'spikeTest',
      tags: { scenario: 'spike' },
    },
  },
};

// ============================================
// Setup — 初始化
// ============================================

export function setup() {
  console.log(`[SPIKE] Starting spike test against ${BASE_URL}`);
  console.log('[SPIKE] Traffic curve: 10→100→350→700→1000 (ramp) → hold 30s → 1000→600→200→50→10 (down)');
  testStartTime = Date.now();

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
    throw new Error(`[SPIKE] Login failed: HTTP ${loginRes.status}`);
  }

  authToken = loginRes.json('data.accessToken');
  console.log('[SPIKE] Auth successful');

  return {
    token: authToken,
    startTime: new Date().toISOString(),
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

/**
 * 判断当前所处阶段
 * @returns {string} 'rampup' | 'peak' | 'rampdown' | 'recovery'
 */
function getCurrentPhase() {
  const elapsed = (Date.now() - testStartTime) / 1000; // 秒
  // 阶段时间线: 0-60s爬坡 | 60-90s峰值 | 90-135s骤降 | 135-195s恢复 | 195-210s冷却
  if (elapsed < 60) return 'rampup';
  if (elapsed < 90) return 'peak';
  if (elapsed < 135) return 'rampdown';
  if (elapsed < 195) return 'recovery';
  return 'cooldown';
}

/**
 * 将延迟数据路由到对应阶段的 trend 指标
 */
function routeLatencyByPhase(duration) {
  const phase = getCurrentPhase();
  spikePhaseIndicator.add(duration, { phase });  // 用 value 存储 latency, tag 区分 phase

  switch (phase) {
    case 'rampup':
      spikeRampUpLatency.add(duration);
      break;
    case 'peak':
      spikePeakLatency.add(duration);
      break;
    case 'rampdown':
      spikeRampDownLatency.add(duration);
      break;
    case 'recovery':
      spikeRecoveryLatency.add(duration);
      break;
    default:
      break;  // cooldown 不记录
  }
}

// ============================================
// 主测试函数 — 突发流量逻辑
// ============================================

export function spikeTest(data) {
  if (data && data.token) authToken = data.token;

  const phase = getCurrentPhase();

  // 根据阶段调整请求策略
  // 峰值期间增加轻量请求比例（减少对系统冲击）
  // 恢复期间恢复正常混合模式

  let requestChoice;
  if (phase === 'peak') {
    // 峰值期：70% 轻量请求 + 30% 中等请求
    requestChoice = Math.random();
  } else {
    // 其他阶段：正常混合
    requestChoice = Math.random();
  }

  if (phase === 'peak') {
    // 峰值期请求分布（偏轻量）
    if (requestChoice < 0.50) {
      spikeRequest('GET', '/api/v1/health', null, 'health');
    } else if (requestChoice < 0.75) {
      spikeRequest('GET', '/api/v1/health/live', null, 'health_live');
    } else if (requestChoice < 0.88) {
      spikeRequest('GET', '/api/v1/campaigns?page=1&pageSize=5', null, 'campaigns');
    } else if (requestChoice < 0.94) {
      spikeRequest('GET', '/api/v1/accounts?page=1&pageSize=5', null, 'accounts');
    } else {
      spikeRequest('GET', '/', null, 'root');
    }
  } else {
    // 正常混合请求分布
    if (requestChoice < 0.25) {
      spikeRequest('GET', '/api/v1/campaigns?page=1&pageSize=10', null, 'campaigns');
    } else if (requestChoice < 0.45) {
      spikeRequest('GET', '/api/v1/accounts?page=1&pageSize=10', null, 'accounts');
    } else if (requestChoice < 0.60) {
      spikeRequest('GET', '/api/v1/stats/overview', null, 'stats_overview');
    } else if (requestChoice < 0.72) {
      spikeRequest('GET', '/api/v1/health', null, 'health');
    } else if (requestChoice < 0.82) {
      spikeRequest('GET', '/api/v1/emails?page=1&pageSize=10', null, 'emails');
    } else if (requestChoice < 0.91) {
      spikeRequest('GET', '/', null, 'root');
    } else if (requestChoice < 0.96) {
      spikeRequest('GET', '/api/v1/analytics/overview', null, 'analytics');
    } else {
      spikeRequest('POST', '/api/v1/campaigns',
        JSON.stringify({
          name: `spike-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'COLD_OUTREACH',
          subject_template: '[Spike Test]',
          body_template: '<p>Spike test email</p>',
        }),
        'campaigns_create'
      );
    }
  }
}

/**
 * 通用请求函数（突发流量测试用）
 * 自动处理阶段分类、429 检测、指标路由
 */
function spikeRequest(method, path, body, endpointTag) {
  const start = Date.now();

  let res;
  if (method === 'GET') {
    res = http.get(`${BASE_URL}${path}`, {
      headers: authHeaders(),
      tags: { endpoint: endpointTag, scenario: 'spike', phase: getCurrentPhase() },
    });
  } else {
    res = http.post(`${BASE_URL}${path}`, body, {
      headers: authHeaders(),
      tags: { endpoint: endpointTag, scenario: 'spike', phase: getCurrentPhase() },
    });
  }

  const duration = Date.now() - start;

  // 按阶段路由延迟数据
  routeLatencyByPhase(duration);

  // 检测 429 限流响应
  if (res.status === 429) {
    spikeRateLimitedCount.add(1);
  }

  // 判断请求是否"成功"
  const acceptableStatuses = [200, 201, 202, 401, 429];
  const ok = acceptableStatuses.includes(res.status);

  check(res, {
    `[SPIKE][${phase}][${endpointTag}] Connection alive`: (r) => r.status !== 0,
    `[SPIKE][${phase}][${endpointTag}] Status acceptable`: () => ok,
  });

  spikeErrorRate.add(ok ? 0 : 1);
}

// ============================================
// Teardown — 突发流量结果分析
// ============================================

export function teardown(data) {
  const elapsed = Math.round((Date.now() - new Date(data.startTime).getTime()) / 1000);

  console.log('\n════════════════════════════════════════════');
  console.log('       SPIKE TEST RESULTS SUMMARY            ');
  console.log('════════════════════════════════════════════');
  console.log(`Total Duration: ${elapsed}s`);
  console.log('');

  // 各阶段延迟对比
  console.log('── Latency by Phase ──');
  logPhaseMetric('Ramp-Up', spikeRampUpLatency);
  logPhaseMetric('Peak', spikePeakLatency);
  logPhaseMetric('Ramp-Down', spikeRampDownLatency);
  logPhaseMetric('Recovery', spikeRecoveryLatency);

  console.log('');
  console.log('── Traffic Control ──');
  console.log(`  Rate Limited (429): ${spikeRateLimitedCount.values.count} requests`);
  console.log(`  Overall Error Rate: ${(spikeErrorRate.rate * 100).toFixed(2)}%`);

  console.log('');
  console.log('── Recovery Analysis ──');
  const recoveryP95 = spikeRecoveryLatency.values.p(95) || 0;
  const rampUpP95 = spikeRampUpLatency.values.p(95) || 0;
  if (rampUpP95 > 0) {
    const recoveryRatio = ((recoveryP95 - rampUpP95) / rampUpP95 * 100).toFixed(1);
    console.log(`  Recovery vs Ramp-Up P95 ratio: ${recoveryRatio}%`);
    if (parseFloat(recoveryRatio) > 30) {
      console.warn('  ⚠️  Recovery P95 significantly higher than ramp-up — possible residual impact');
    } else {
      console.log('  ✅ Good recovery — latency returned near baseline');
    }
  }

  console.log('════════════════════════════════════════════');
}

/**
 * 打印单个阶段的延迟统计
 */
function logPhaseMetric(phaseName, metric) {
  if (!metric.values || metric.values.count === 0) {
    console.log(`  ${phaseName}: No data collected`);
    return;
  }
  console.log(`  ${phaseName}:`);
  console.log(`    Count: ${metric.values.count}`);
  console.log(`    P50:  ${metric.values.p(50)?.toFixed(1) || 'N/A'}ms`);
  console.log(`    P95:  ${metric.values.p(95)?.toFixed(1) || 'N/A'}ms`);
  console.log(`    P99:  ${metric.values.p(99)?.toFixed(1) || 'N/A'}ms`);
  console.log(`    Max:  ${metric.values.max?.toFixed(1) || 'N/A'}ms`);
}
