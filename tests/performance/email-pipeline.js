/**
 * GlobalReach V2.0 — EMAIL-PIPELINE 邮件发送流水线测试
 *
 * 测试邮件发送管道的端到端性能，包括：
 *   1. Campaign 创建 → 2. Campaign 执行(入队) → 3. 进度查询 → 4. 统计查询
 *
 * 特殊考量:
 *   - 受 SMTP 速率限制约束 (SEND_RATE_LIMIT 默认 3 封/秒)
 *   - 受 emailSendLimiter 中间件限制
 *   - 异步队列模式: execute 返回 202 Accepted
 *   - 测试环境应使用 Mailpit 替代真实 SMTP
 *
 * 场景参数:
 *   - VUs: 10 (低并发以避免触发 SMTP 限流)
 *   - Duration: 2min
 *   - 目标 execute P95: <500ms (异步入队操作)
 *   - 目标 stats P95: <100ms
 *
 * 自定义指标:
 *   gr_email_create_campaign_ms  — 创建 Campaign 耗时
 *   gr_email_execute_ms          — 执行 Campaign 入队耗时
 *   gr_email_progress_check_ms   — 进度查询耗时
 *   gr_email_stats_query_ms      — 统计查询耗时
 *   gr_email_pipeline_full_ms    — 完整流水线耗时
 *   gr_email_enqueue_rate         — 入队速率
 *   gr_email_202_accepted_rate    — 异步接受率
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

// 自定义指标 — 邮件流水线专用
export const emailCreateCampaignMs = new Trend('gr_email_create_campaign_ms', true);
export const emailExecuteMs = new Trend('gr_email_execute_ms', true);
export const emailProgressCheckMs = new Trend('gr_email_progress_check_ms', true);
export const emailStatsQueryMs = new Trend('gr_email_stats_query_ms', true);
export const emailPipelineFullMs = new Trend('gr_email_pipeline_full_ms', true);
export const emailEnqueueRate = new Rate('gr_email_enqueue_rate');        // 202 Accepted 比例
export const emailPipelineErrorRate = new Rate('gr_email_pipeline_error_rate');
export const emailPipelineTotal = new Counter('gr_email_pipeline_total');
export const emailQueueDepthProxy = new Trend('gr_email_queue_depth_proxy', true);  // 通过 stats 间接观察

let authToken = '';
let vuLocalCampaignId = '';  // 每个 VU 本地维护自己的 campaign ID

// ============================================
// k6 Options — 邮件流水线测试配置
// ============================================

export const options = {
  thresholds: {
    // 创建 Campaign P95 < 200ms
    'gr_email_create_campaign_ms': ['p(95)<200'],
    // 执行 Campaign (入队) P95 < 500ms
    'gr_email_execute_ms': ['p(95)<500'],
    // 进度查询 P95 < 100ms
    'gr_email_progress_check_ms': ['p(95)<100'],
    // 统计查询 P95 < 100ms
    'gr_email_stats_query_ms': ['p(95)<100'],
    // 完整流水线 P95 < 800ms
    'gr_email_pipeline_full_ms': ['p(95)<800'],
    // 入队成功 (202) 比例 > 90%
    'gr_email_enqueue_rate': ['rate>0.9'],
    // 流水线整体错误率 < 10%
    'gr_email_pipeline_error_rate': ['rate<0.1'],
  },

  scenarios: {
    email_pipeline: {
      executor: 'constant-vus',
      vus: 10,
      duration: '2m',
      gracefulStop: '5s',
      exec: 'emailPipeline',
      tags: { scenario: 'email_pipeline' },
    },
  },
};

// ============================================
// Setup — 认证初始化
// ============================================

export function setup() {
  console.log(`[EMAIL] Starting email pipeline test against ${BASE_URL}`);
  console.log('[EMAIL] Note: Low VU count (10) to respect SMTP rate limits');

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
    throw new Error(`[EMAIL] Login failed: HTTP ${loginRes.status}`);
  }

  authToken = loginRes.json('data.accessToken');
  console.log('[EMAIL] Auth successful');

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

function emailTags(step) {
  return {
    tags: {
      step: step,
      scenario: 'email_pipeline',
    },
  };
}

/**
 * 生成唯一的 Campaign 名称
 */
function generateCampaignName() {
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 8);
  return `perf-email-${ts}-${rnd}`;
}

// ============================================
// 主测试函数 — 邮件发送流水线
// ============================================

export function emailPipeline(data) {
  if (data && data.token) authToken = data.token;

  const pipelineStart = Date.now();
  let pipelineSuccess = true;

  // ══════════════════════════════════════════════
  // 步骤 1: CREATE CAMPAIGN — 创建营销活动
  // POST /api/v1/campaigns
  // ══════════════════════════════════════════════
  const campaignName = generateCampaignName();
  const createPayload = JSON.stringify({
    name: campaignName,
    type: 'COLD_OUTREACH',
    subject_template: `[Perf Test] ${campaignName}`,
    body_template: `
      <html>
      <body style="font-family: Arial, sans-serif;">
        <h2>Performance Test Email</h2>
        <p>This is an automated email pipeline test.</p>
        <p>Campaign: ${campaignName}</p>
        <p>Timestamp: ${new Date().toISOString()}</p>
      </body>
      </html>
    `,
    target_segment: {
      industry: 'technology',
      companySize: '50-200',
    },
  });

  const createStart = Date.now();
  const createRes = http.post(
    `${BASE_URL}/api/v1/campaigns`,
    createPayload,
    Object.assign({ headers: authHeaders() }, emailTags('create_campaign'))
  );
  const createDuration = Date.now() - createStart;
  emailCreateCampaignMs.add(createDuration);

  const createOk = createRes.status === 201;
  if (!createOk) {
    pipelineSuccess = false;
    emailPipelineErrorRate.add(1);
    emailPipelineFullMs.add(Date.now() - pipelineStart);
    emailPipelineTotal.add(1);
    return;  // 无法继续流水线
  }

  const campaignId = createRes.json('data.id');
  vuLocalCampaignId = campaignId;  // 保存供后续步骤使用

  check(createRes, {
    '[EMAIL][Step1/Create] Campaign created (201)': (r) => r.status === 201,
    '[EMAIL][Step1/Create] Has campaign ID': (r) => r.json('data.id') !== undefined,
    '[EMAIL][Step1/Create] Create < 200ms': () => createDuration < 200,
  });

  // ══════════════════════════════════════════════
  // 步骤 2: EXECUTE CAMPAIGN — 执行发送(入队)
  // POST /api/v1/emails/campaign/:campaignId/execute
  // 预期: 202 Accepted (异步入队)
  // ══════════════════════════════════════════════
  const executePayload = JSON.stringify({
    priority: 'normal',
  });

  const executeStart = Date.now();
  const executeRes = http.post(
    `${BASE_URL}/api/v1/emails/campaign/${campaignId}/execute`,
    executePayload,
    Object.assign({ headers: authHeaders() }, emailTags('execute'))
  );
  const executeDuration = Date.now() - executeStart;
  emailExecuteMs.add(executeDuration);

  // 202 = 已接受入队 (异步成功)
  const executeAccepted = executeRes.status === 202;
  emailEnqueueRate.add(executeAccepted ? 1 : 0);

  if (!executeAccepted && executeRes.status !== 200) {
    pipelineSuccess = false;
  }

  check(executeRes, {
    '[EMAIL][Step2/Execute] Accepted (202) or OK (200)': (r) => [202, 200].includes(r.status),
    '[EMAIL][Step2/Execute] Execute < 500ms': () => executeDuration < 500,
    '[EMAIL][Step2/Execute] Has queue info': (r) => r.json('data') !== undefined,
  });

  // ══════════════════════════════════════════════
  // 步骤 3: CHECK PROGRESS — 查询发送进度
  // GET /api/v1/progress/campaign/:campaignId
  // 注意: 此端点可能在某些状态下返回空数据
  // ══════════════════════════════════════════════
  const progressStart = Date.now();
  const progressRes = http.get(
    `${BASE_URL}/api/v1/progress/campaign/${campaignId}`,
    Object.assign({ headers: authHeaders() }, emailTags('progress_check'))
  );
  const progressDuration = Date.now() - progressStart;
  emailProgressCheckMs.add(progressDuration);

  const progressOk = [200, 404, 202].includes(progressRes.status);  // 404 = 还没有进度数据
  if (!progressOk) pipelineSuccess = false;

  check(progressRes, {
    '[EMAIL][Step3/Progress] Progress accessible': (r) => [200, 404, 202].includes(r.status),
    '[EMAIL][Step3/Progress] Progress check < 100ms': () => progressDuration < 100,
  });

  // ══════════════════════════════════════════════
  // 步骤 4: QUERY STATS — 查询邮件统计
  // GET /api/v1/emails/stats
  // ══════════════════════════════════════════════
  const statsStart = Date.now();
  const statsRes = http.get(
    `${BASE_URL}/api/v1/emails/stats`,
    Object.assign({ headers: authHeaders() }, emailTags('stats_query'))
  );
  const statsDuration = Date.now() - statsStart;
  emailStatsQueryMs.add(statsDuration);

  const statsOk = statsRes.status === 200;
  if (!statsOk) pipelineSuccess = false;

  // 尝试从 stats 中提取队列深度信息（间接观察）
  if (statsOk && statsRes.json('data')) {
    const statsData = statsRes.json('data');
    // 如果 stats 数据中包含 pending/queued 信息，记录下来
    if (typeof statsData === 'object') {
      const pending = statsData.pending || statsData.queued || 0;
      emailQueueDepthProxy.add(pending);
    }
  }

  check(statsRes, {
    '[EMAIL][Step4/Stats] Stats retrieved (200)': (r) => r.status === 200,
    '[EMAIL][Step4/Stats] Stats query < 100ms': () => statsDuration < 100,
    '[EMAIL][Step4/Stats] Has data structure': (r) => r.json('data') !== undefined,
  });

  // ══════════════════════════════════════════════
  // 流水线汇总
  // ══════════════════════════════════════════════
  const fullPipelineDuration = Date.now() - pipelineStart;
  emailPipelineFullMs.add(fullPipelineDuration);
  emailPipelineTotal.add(1);
  emailPipelineErrorRate.add(pipelineSuccess ? 0 : 1);

  // 全流水线 check
  check({
    create: createDuration,
    execute: executeDuration,
    progress: progressDuration,
    stats: statsDuration,
    total: fullPipelineDuration,
  }, {
    '[EMAIL][Pipeline] All steps completed': () => pipelineSuccess,
    '[EMAIL][Pipeline] Total < 800ms': (d) => d.total < 800,
    '[EMAIL][Pipeline] Execute is dominant step': (d) => d.execute > d.create,
    '[EMAIL][Pipeline] Async enqueue pattern confirmed': (d) => d.execute < 1000,  // 不应该阻塞太久
  });
}

// ============================================
// Teardown — 邮件流水线结果汇总
// ============================================

export function teardown(data) {
  const elapsed = Math.round((Date.now() - new Date(data.startTime).getTime()) / 1000);

  console.log('\n════════════════════════════════════════════');
  console.log('   EMAIL PIPELINE TEST RESULTS               ');
  console.log('════════════════════════════════════════════');
  console.log(`Duration: ${elapsed}s`);
  console.log(`Total pipelines executed: ${emailPipelineTotal.values.count}`);
  console.log('');

  console.log('── Step Latency (P95) ──');
  console.log(`  Step 1 - Create Campaign: ${emailCreateCampaignMs.values.p(95)?.toFixed(1) || 'N/A'}ms  (threshold: 200ms)`);
  console.log(`  Step 2 - Execute (Enqueue): ${emailExecuteMs.values.p(95)?.toFixed(1) || 'N/A'}ms  (threshold: 500ms)`);
  console.log(`  Step 3 - Progress Check:   ${emailProgressCheckMs.values.p(95)?.toFixed(1) || 'N/A'}ms  (threshold: 100ms)`);
  console.log(`  Step 4 - Stats Query:     ${emailStatsQueryMs.values.p(95)?.toFixed(1) || 'N/A'}ms  (threshold: 100ms)`);
  console.log('');

  console.log('── Pipeline Summary ──');
  console.log(`  Full Pipeline P50: ${emailPipelineFullMs.values.p(50)?.toFixed(1) || 'N/A'}ms`);
  console.log(`  Full Pipeline P95: ${emailPipelineFullMs.values.p(95)?.toFixed(1) || 'N/A'}ms  (threshold: 800ms)`);
  console.log(`  Full Pipeline P99: ${emailPipelineFullMs.values.p(99)?.toFixed(1) || 'N/A'}ms`);
  console.log('');

  console.log('── Queue & Throughput ──');
  console.log(`  Enqueue Accept Rate (202): ${(emailEnqueueRate.rate * 100).toFixed(1)}%  (target: >90%)`);
  console.log(`  Pipeline Error Rate:      ${(emailPipelineErrorRate.rate * 100).toFixed(2)}%  (threshold: <10%)`);
  console.log(`  Pipeline Success Rate:     ${((1 - emailPipelineErrorRate.rate) * 100).toFixed(1)}%`);

  // 队列深度信息（如有）
  if (emailQueueDepthProxy.values && emailQueueDepthProxy.values.count > 0) {
    console.log(`  Queue Depth (observed):    avg=${emailQueueDepthProxy.values.avg?.toFixed(1)}, max=${emailQueueDepthProxy.values.max}`);
  }

  console.log('════════════════════════════════════════════');
}
