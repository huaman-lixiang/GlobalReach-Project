// S111/PhaseI: GlobalReach V2.0 — Production Load Test Suite
// Multi-phase load testing with concurrency ramp, latency analysis, and resource monitoring
// No external dependencies required (uses built-in http/https modules)

const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');

// ─── Configuration ──────────────────────────────────────────────
const CONFIG = {
  baseUrl: 'http://localhost:3000',  // Direct API port (bypass nginx for accurate measurement)
  endpoints: [
    { path: '/api/health', method: 'GET', label: 'Health Check' },
    { path: '/api/status', method: 'GET', label: 'Status' },
    { path: '/', method: 'GET', label: 'Root' }
  ],
  phases: [
    { name: 'warmup',   durationSec: 10, concurrency: 5,  targetRPS: 10 },
    { name: 'ramp-up',  durationSec: 15, concurrency: 20, targetRPS: 50 },
    { name: 'peak',     durationSec: 20, concurrency: 50, targetRPS: 150 },
    { name: 'sustain',  durationSec: 30, concurrency: 50, targetRPS: 200 },
    { name: 'cooldown', durationSec: 10, concurrency: 10, targetRPS: 20 }
  ],
  timeoutMs: 10000,
  reportIntervalMs: 5000
};

// ─── Result Collectors ───────────────────────────────────────────
const results = {
  totalRequests: 0,
  totalErrors: 0,
  totalBytes: 0,
  latencies: [],           // all individual latencies in ms
  phaseResults: {},        // per-phase stats
  errorBreakdown: {},      // error type counts
  statusCodes: {}          // HTTP status code distribution
};

// ─── HTTP Request Function ──────────────────────────────────────
function makeRequest(endpoint) {
  return new Promise((resolve) => {
    const start = performance.now();
    const url = new URL(endpoint.path, CONFIG.baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: endpoint.method,
      timeout: CONFIG.timeoutMs,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'GlobalReach-LoadTest-S111',
        'Connection': 'keep-alive'
      }
    };

    const req = http.request(options, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const elapsed = performance.now() - start;
        const body = Buffer.concat(data).length;
        resolve({
          success: true,
          statusCode: res.statusCode,
          latencyMs: Math.round(elapsed * 100) / 100,
          bytes: body,
          endpoint: endpoint.label
        });
      });
    });

    req.on('error', (err) => {
      const elapsed = performance.now() - start;
      resolve({
        success: false,
        statusCode: 0,
        latencyMs: Math.round(elapsed * 100) / 100,
        bytes: 0,
        endpoint: endpoint.label,
        error: err.code || err.message
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        statusCode: 0,
        latencyMs: CONFIG.timeoutMs,
        bytes: 0,
        endpoint: endpoint.label,
        error: 'TIMEOUT'
      });
    });

    req.end();
  });
}

// ─── Phase Runner ───────────────────────────────────────────────
async function runPhase(phase, globalStart) {
  const phaseStart = performance.now();
  const phaseData = {
    requests: 0,
    errors: 0,
    latencies: [],
    minLatency: Infinity,
    maxLatency: 0,
    totalLatency: 0,
    bytes: 0,
    startTime: Date.now()
  };

  const endTime = phaseStart + (phase.durationSec * 1000);
  const intervalMs = Math.max(1, Math.round(1000 / (phase.targetRPS / phase.concurrency)));
  let activeWorkers = 0;
  let completedInPhase = 0;

  // Worker function: continuously sends requests until phase ends
  async function worker() {
    activeWorkers++;
    while (performance.now() < endTime) {
      const endpoint = CONFIG.endpoints[Math.floor(Math.random() * CONFIG.endpoints.length)];
      const result = await makeRequest(endpoint);

      completedInPhase++;
      phaseData.requests++;
      phaseData.totalLatency += result.latencyMs;
      phaseData.latencies.push(result.latencyMs);
      phaseData.bytes += result.bytes;

      if (result.latencyMs < phaseData.minLatency) phaseData.minLatency = result.latencyMs;
      if (result.latencyMs > phaseData.maxLatency) phaseData.maxLatency = result.latencyMs;

      if (!result.success || result.statusCode >= 400) {
        phaseData.errors++;
        results.errorBreakdown[result.error || `HTTP_${result.statusCode}`] =
          (results.errorBreakdown[result.error || `HTTP_${result.statusCode}`] || 0) + 1;
      }

      results.statusCodes[result.statusCode] = (results.statusCodes[result.statusCode] || 0) + 1;

      // Throttle to target RPS
      if (intervalMs > 1) await sleep(intervalMs);
    }
    activeWorkers--;
  }

  // Launch workers
  const workers = [];
  for (let i = 0; i < phase.concurrency; i++) {
    workers.push(worker());
  }

  // Progress reporter during phase
  const progressInterval = setInterval(() => {
    const elapsed = ((performance.now() - phaseStart) / 1000).toFixed(1);
    const rps = (completedInPhase / elapsed).toFixed(1);
    process.stdout.write(`\r  [${phase.name}] ${elapsed}s/${phase.durationSec}s | ${completedInPhase} req | ${rps} rps | errors: ${phaseData.errors} | workers: ${activeWorkers}`);
  }, CONFIG.reportIntervalMs);

  // Wait for all workers + phase duration
  await Promise.all(workers);
  clearInterval(progressInterval);

  // Calculate final phase stats
  phaseData.avgLatency = phaseData.requests > 0 ? phaseData.totalLatency / phaseData.requests : 0;
  phaseData.rps = phaseData.requests / phase.durationSec;
  phaseData.errorRate = phaseData.requests > 0 ? (phaseData.errors / phaseData.requests * 100) : 0;

  // Percentiles (sorted)
  const sorted = [...phaseData.latencies].sort((a, b) => a - b);
  phaseData.p50 = percentile(sorted, 50);
  phaseData.p75 = percentile(sorted, 75);
  phaseData.p90 = percentile(sorted, 90);
  phaseData.p95 = percentile(sorted, 95);
  phaseData.p99 = percentile(sorted, 99);

  results.phaseResults[phase.name] = phaseData;
  results.totalRequests += phaseData.requests;
  results.totalErrors += phaseData.errors;
  results.totalBytes += phaseData.bytes;
  results.latencies.push(...phaseData.latencies);

  console.log(`\n  [${phase.name}] COMPLETE`);
  return phaseData;
}

// ─── Utility Functions ──────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, idx)];
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

// ─── Report Generator ───────────────────────────────────────────
function generateReport(testDurationSec) {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║       GlobalReach V2.0 — S111 Load Test Report                    ║');
  console.log('╠════════════════════════════════════════════════════════════════════╣');

  // Summary
  const totalDuration = testDurationSec.toFixed(0);
  const avgRps = (results.totalRequests / testDurationSec).toFixed(1);
  const overallErrorRate = results.totalRequests > 0 ? (results.totalErrors / results.totalRequests * 100).toFixed(2) : 0;
  const allSorted = [...results.latencies].sort((a, b) => a - b);

  console.log(`║  SUMMARY                                                          ║`);
  console.log(`║  ┌────────────────────┬──────────────────────────────────────────┐ ║`);
  console.log(`║  │ Total Duration     │ ${totalDuration.padStart(8)}s                                  │ ║`);
  console.log(`║  │ Total Requests     │ ${String(results.totalRequests).padStart(8)}                                   │ ║`);
  console.log(`║  │ Avg Throughput     │ ${avgRps.padStart(8)} req/s                              │ ║`);
  console.log(`║  │ Error Rate         │ ${overallErrorRate.padStart(8)}%                                 │ ║`);
  console.log(`║  │ Data Transferred   │ ${formatBytes(results.totalBytes).padStart(8)}                            │ ║`);
  console.log(`║  └────────────────────┴──────────────────────────────────────────┘ ║`);

  // Latency percentiles (overall)
  console.log(`║  LATENCY (Overall)                                                ║`);
  console.log(`║  ┌────────────────┬────────┬────────┬────────┬────────┬────────┐ ║`);
  console.log(`║  │ Metric         │   P50  │   P75  │   P90  │   P95  │   P99  │ ║`);
  console.log(`║  ├────────────────┼────────┼────────┼────────┼────────┼────────┤ ║`);
  console.log(`║  │ Response (ms)   │${percentile(allSorted, 50).toFixed(1).padStart(7)}│${percentile(allSorted, 75).toFixed(1).padStart(7)}│${percentile(allSorted, 90).toFixed(1).padStart(7)}│${percentile(allSorted, 95).toFixed(1).padStart(7)}│${percentile(allSorted, 99).toFixed(1).padStart(7)}│ ║`);
  console.log(`║  └────────────────┴────────┴────────┴────────┴────────┴────────┘ ║`);

  // Per-Phase Results
  console.log(`║  PHASE BREAKDOWN                                                  ║`);
  console.log(`║  ┌────────────┬──────┬─────────┬────────┬────────┬───────┬───────┐ ║`);
  console.log(`║  │ Phase      │ Req/s│ Avg(ms) │ P95(ms)│ P99(ms)│Err(%) │ Bytes │ ║`);
  console.log(`║  ├────────────┼──────┼─────────┼────────┼────────┼───────┼───────┤ ║`);

  for (const [name, data] of Object.entries(results.phaseResults)) {
    const row = `│ ${name.padEnd(10)}│${data.rps.toFixed(1).padStart(5)} │${data.avgLatency.toFixed(1).padStart(8)} │${data.p95.toFixed(1).padStart(7)} │${data.p99.toFixed(1).padStart(7)} │${data.errorRate.toFixed(1).padStart(6)} │${formatBytes(data.bytes).padStart(6)} │`;
    console.log(`${row} ║`);
  }
  console.log(`║  └────────────┴──────┴─────────┴────────┴────────┴───────┴───────┘ ║`);

  // Status Code Distribution
  console.log(`║  STATUS CODES                                                     ║`);
  console.log(`║  ┌──────────────┬────────┐                                       ║`);
  for (const [code, count] of Object.entries(results.statusCodes).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / results.totalRequests) * 100).toFixed(1);
    console.log(`║  │ HTTP ${String(code).padEnd(4)}     │${String(count).padStart(7)} (${pct}%)│                                       ║`);
  }
  console.log(`║  └──────────────┴────────┘                                       ║`);

  // Errors
  if (Object.keys(results.errorBreakdown).length > 0) {
    console.log(`║  ERRORS                                                           ║`);
    console.log(`║  ┌────────────────────────┬────────┐                           ║`);
    for (const [err, count] of Object.entries(results.errorBreakdown)) {
      console.log(`║  │ ${err.padEnd(23)}│${String(count).padStart(7)}│                           ║`);
    }
    console.log(`║  └────────────────────────┴────────┘                           ║`);
  }

  console.log(`╚════════════════════════════════════════════════════════════════════╝`);

  // Return structured data for programmatic use
  return {
    summary: { totalRequests: results.totalRequests, avgRps, errorRate: overallErrorRate, durationSec: testDurationSec },
    latency: { p50: percentile(allSorted, 50), p95: percentile(allSorted, 95), p99: percentile(allSorted, 99) },
    phases: results.phaseResults
  };
}

// ─── Main Entry Point ───────────────────────────────────────────
async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  GlobalReach V2.0 — S111 Performance Load Test                 ║');
  console.log('║  Target: ' + CONFIG.baseUrl + '                               ║');
  console.log('║  Phases: ' + CONFIG.phases.map(p => `${p.name}(${p.concurrency}c/${p.targetRPS}rps)`).join(' → ') + '');
  console.log('║  Endpoints: ' + CONFIG.endpoints.map(e => e.label).join(', ') + '');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const globalStart = performance.now();

  for (const phase of CONFIG.phases) {
    console.log(`\n▶ Starting phase: ${phase.name.toUpperCase()} (${phase.durationSec}s, ${phase.concurrency} concurrency, ~${phase.targetRPS} target rps)`);
    await runPhase(phase, globalStart);
  }

  const totalDuration = (performance.now() - globalStart) / 1000;
  const report = generateReport(totalDuration);

  // Write JSON report for machine parsing
  const fs = require('fs');
  const reportPath = __dirname + '/load-test-report.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n  JSON report saved: ${reportPath}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
