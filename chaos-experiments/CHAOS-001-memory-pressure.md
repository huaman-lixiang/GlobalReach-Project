# CHAOS-001: API Container Memory Pressure Test

**Category**: Resource Exhaustion
**Severity**: 🟡 Medium (controlled impact)
**Last Updated**: 2026-06-12
**Status**: ✅ Ready for Execution

---

## Objective

Validate that the GlobalReach V2.0 API container handles memory pressure gracefully without:
- Uncontrolled OOM (Out of Memory) kills
- Data corruption
- Complete service unavailability
- Security degradation (under memory pressure)

This experiment is **critical** because S152 just added security middleware to all routes, which increases baseline memory usage. We must verify the system remains stable.

---

## Hypothesis

**HYPOTHESIS**: The GlobalReach API container will **degrade gracefully** under memory pressure (80-95% of 512MB limit), maintaining core functionality (health checks, authentication) while non-critical features (analytics, reporting) may fail with proper error messages, and will **automatically recover** when pressure is released within 30 seconds.

### Steady State Baseline (Pre-Experiment)

| Metric | Normal Value | Warning Threshold | Critical Threshold |
|--------|-------------|-------------------|-------------------|
| Memory Usage (RSS) | ~53MB (10%) | >384MB (75%) | >460MB (90%) |
| Heap Usage | ~53MB | >85% of limit | >95% of limit |
| Event Loop Lag | <10ms | <50ms | <100ms |
| Response Time (p95) | <200ms | <1s | <5s |
| Error Rate (5xx) | <0.1% | <1% | >5% |
| Health Check Status | healthy | degraded | unhealthy |

---

## Fault Model

### Memory Pressure Injection Method

```javascript
// Technique: Controlled memory allocation
// Simulates realistic memory leak or burst allocation scenario

class MemoryPressureInjector {
  constructor(options = {}) {
    this.targetMB = options.targetMB || 400; // Target: 400MB (78% of 512MB)
    this.durationMs = options.durationMs || 30000; // 30 seconds
    this.rampUpTime = options.rampUpTime || 10000; // 10s ramp-up
    this.allocationChunkSize = options.chunkSize || 10; // 10MB chunks
    this.intensity = options.intensity || 5; // 1-10 scale
  }

  // Phase 1: Gradual memory allocation (simulates slow leak)
  async rampUp() {
    const chunks = [];
    const chunkCount = Math.ceil(this.targetMB / this.allocationChunkSize);
    
    for (let i = 0; i < chunkCount; i++) {
      // Allocate 10MB chunk
      const chunk = Buffer.alloc(this.allocationChunkSize * 1024 * 1024, 'x');
      chunks.push(chunk);
      
      // Fill with pseudo-random data (prevent optimization)
      for (let j = 0; j < chunk.length; j += 4096) {
        chunk.write(Math.random().toString(36).substring(7), j);
      }
      
      // Small delay between allocations
      await new Promise(r => setTimeout(r, this.rampUpTime / chunkCount));
      
      logMemoryUsage(`Ramp-up: ${i + 1}/${chunkCount} chunks`);
    }
    
    return chunks;
  }

  // Phase 2: Sustain pressure (hold memory)
  async sustain(chunks, duration) {
    logMemoryUsage('Sustaining pressure...');
    await new Promise(r => setTimeout(r, duration));
    return chunks;
  }

  // Phase 3: Gradual release (simulates GC/recovery)
  async release(chunks, releaseTime) {
    const releaseInterval = releaseTime / chunks.length;
    
    for (let i = 0; i < chunks.length; i++) {
      chunks[i] = null; // Release chunk
      
      if (i % 5 === 0) { // Force GC every 5 chunks
        if (global.gc) global.gc();
      }
      
      await new Promise(r => setTimeout(r, releaseInterval));
      logMemoryUsage(`Release: ${i + 1}/${chunks.length} chunks`);
    }
  }
}
```

---

## Experiment Scope

### ✅ In Scope (Affected Components)

1. **API Container Process**
   - Node.js event loop under memory pressure
   - Garbage collector behavior under pressure
   - HTTP request handling with limited memory
   - Database connection pool under stress
   - Redis client operations with memory constraints

2. **Security Middleware Chain (S152 Focus)**
   - JWT verification under memory pressure
   - Rate limiter counter operations
   - RBAC permission checks
   - CSRF token validation

3. **Core API Endpoints**
   - `GET /health` (must remain available)
   - `POST /auth/login` (authentication critical path)
   - `GET /campaigns` (typical read operation)
   - `POST /emails/send` (write operation with validation)

### ❌ Out of Scope (Blast Radius Limitations)

- **Database Server**: Not injecting memory pressure into PostgreSQL
- **Redis Server**: Not affecting cache layer directly
- **Other Containers**: Nginx, Grafana, Prometheus untouched
- **Persistent Storage**: No disk I/O injection
- **Network Layer**: No latency/packet loss (see CHAOS-002)
- **User Data**: No data modification or deletion

---

## Safety Limits & Abort Conditions

### 🔴 Immediate Abort (Emergency Stop)

Experiment will **auto-abort** if ANY of these conditions are detected:

| Condition | Threshold | Action |
|-----------|-----------|--------|
| Memory Usage | >95% (486MB) | EMERGENCY STOP + Force GC |
| Event Loop Lag | >500ms | EMERGENCY STOP |
| Process Unresponsive | No heartbeat for 5s | EMERGENCY STOP + Restart warning |
| Health Check Failure | `/health/ready` returns 503 | EMERGENCY STOP |
| Error Rate Surge | 5xx errors >20% for 10s | EMERGENCY STOP |

### 🟡 Graceful Degradation (Continue with Monitoring)

| Condition | Threshold | Response |
|-----------|-----------|----------|
| Memory Usage | 75-90% | Log warning, continue |
| Response Time Degradation | p95 >1s but <5s | Log slowdown, continue |
| Increased GC Pauses | >100ms pauses | Log GC stats, continue |
| Rate Limiting Increase | More 429 responses | Expected behavior, continue |

### ⏱️ Time Limits

- **Maximum Duration**: 60 seconds (including ramp-up and release)
- **Auto-Rollback Trigger**: If not manually stopped after 60s
- **Cooldown Period**: 5 minutes before next experiment allowed

---

## Rollback Procedure

### Automatic Rollback (Default)

```javascript
async function automaticRollback(injectedChunks) {
  console.log('[CHAOS-001] Initiating automatic rollback...');
  
  // Step 1: Immediately release all allocated memory
  injectedChunks.forEach((chunk, i) => {
    injectedChunks[i] = null;
  });
  
  // Step 2: Force garbage collection
  if (global.gc) {
    global.gc();
    await new Promise(r => setTimeout(r, 1000)); // Wait for GC cycle
  }
  
  // Step 3: Verify recovery
  const memUsage = process.memoryUsage();
  const rssPercent = (memUsage.rss / (512 * 1024 * 1024)) * 100;
  
  if (rssPercent < 70) {
    console.log(`[CHAOS-001] ✅ Rollback successful. Memory: ${rssPercent.toFixed(1)}%`);
    return { success: true, finalMemory: rssPercent };
  } else {
    console.log(`[CHAOS-001] ⚠️ Partial rollback. Memory still at ${rssPercent.toFixed(1)}%`);
    return { success: false, finalMemory: rssPercent, action: 'manual_intervention_required' };
  }
}
```

### Manual Recovery (If Auto-Rollback Fails)

1. **Restart API Container**: `docker restart globalreach-api`
2. **Check Logs**: `docker logs globalreach-api --tail 100`
3. **Verify Health**: `curl http://localhost:3000/api/v1/health`
4. **Monitor**: Watch Grafana dashboard for 5 minutes post-recovery
5. **Post-Mortem**: If data inconsistency suspected, restore from backup

---

## Success Criteria

Experiment is considered **SUCCESSFUL** if ALL of these are true:

### Must Pass (Hard Requirements)

- [ ] **No process crash/OOM kill** during entire experiment
- [ ] **Health endpoint remains responsive** (`GET /health` returns 200 within 5s)
- [ ] **Authentication still works** (`POST /auth/login` succeeds with valid credentials)
- [ ] **No data corruption** (database integrity verified post-experiment)
- [ ] **Automatic recovery** within 30s after pressure release (memory <70%)

### Should Pass (Soft Requirements)

- [ ] **Graceful error messages** for failed requests (not timeouts/gateway errors)
- [ ] **Rate limiting still functions** (429 responses when appropriate)
- [ ] **Security middleware intact** (unauthenticated requests still rejected with 401)
- [ ] **Logging continues** (no lost log entries during pressure)
- [ ] **Metrics collection unaffected** (Prometheus endpoints responding)

### Acceptable Degradation (Expected Behavior)

- [ ] **Response times increase** (p95 may increase 2-5x during peak pressure)
- [ ] **Some requests timeout** (<5% timeout rate acceptable)
- [ ] **Non-critical features fail** (analytics, reporting may return errors)
- [ ] **GC pauses increase** (up to 200ms pauses acceptable)
- [ ] **Connection pool saturation** (some database queueing expected)

---

## Monitoring & Metrics Collection

### Real-Time Metrics to Capture

```javascript
const metricsCollector = {
  // Memory metrics (every 1 second)
  memory: () => ({
    rss: process.memoryUsage().rss,
    heapUsed: process.memoryUsage().heapUsed,
    heapTotal: process.memoryUsage().heapTotal,
    external: process.memoryUsage().external,
    arrayBuffers: process.memoryUsage().arrayBuffers,
  }),
  
  // Event loop lag (every 500ms)
  eventLoopLag: () => measureEventLoopLag(),
  
  // Active connections
  connections: () => ({
    active: server.getConnections ? server.getConnections() : 0,
    total: server.getConnections ? server._connections : 0,
  }),
  
  // Request metrics (continuous)
  requests: {
    total: 0,
    success: 0,
    clientErrors: 0,
    serverErrors: 0,
    timeouts: 0,
  },
  
  // Custom chaos metric
  chaos: {
    phase: 'idle', // idle | ramp-up | sustain | release | rollback
    memoryAllocatedMB: 0,
    startTime: null,
    currentTime: null,
  }
};
```

### Dashboard Widgets to Watch

1. **Memory Usage Gauge** (real-time line chart)
2. **Response Time Histogram** (compare before/during/after)
3. **Error Rate** (4xx vs 5xx breakdown)
4. **Health Check Status** (traffic light indicator)
5. **Active Requests** (connection count)
6. **GC Pause Times** (if accessible via --expose-gc)

---

## Risks & Mitigations

### Identified Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| OOM Kill by Docker/Kernel | Medium | High (service outage) | Safe mode testing first; set memory limit to 614MB (120% of normal) |
| Data Corruption during writes | Low | Critical | Experiment duration short (30s); DB has WAL/journaling |
| Security bypass under pressure | Low | Critical | Auth middleware tested explicitly; monitor for 200 on protected routes |
| Cascading failure to other services | Low | High | Blast radius limited to API container only |
| Slow recovery (memory fragmentation) | Medium | Medium | Forced GC during rollback; Node.js 24 has better GC |
| Alert fatigue from false positives | Low | Low | Use dedicated chaos experiment alert channel |

### Specific Mitigations for S152 Context

Since we just added security middleware everywhere:

1. **Baseline Shift**: New baseline memory usage may be higher than historical data
   - *Mitigation*: Measure current baseline before experiment
   
2. **Middleware Overhead Under Pressure**: JWT verification may be slower with high memory
   - *Mitigation*: Monitor auth endpoint response times specifically
   
3. **Rate Limiter Counter Bloat**: Many counters under memory pressure
   - *Mitigation*: Rate limiter uses Map with auto-cleanup (already implemented)

---

## Execution Steps (Safe Mode)

When running in `--mode safe`, the runner will:

1. ✅ **Validate Preconditions**
   - Check system has sufficient resources
   - Verify health endpoints responding
   - Record baseline metrics
   - Check no other experiments running

2. ✅ **Simulate Experiment Logic** (without actual allocation)
   - Calculate target memory usage
   - Estimate timeline
   - Validate abort conditions are checkable
   - Generate predicted metrics curve

3. ✅ **Test Rollback Procedure** (dry-run)
   - Verify rollback code executes without error
   - Check cleanup handlers registered
   - Confirm monitoring hooks in place

4. ✅ **Generate Report**
   - Experiment configuration summary
   - Safety checklist status
   - Predicted outcomes
   - Recommendations for live execution

---

## Execution Steps (Live Mode)

⚠️ **DANGER ZONE** - Only run with explicit confirmation!

1. **Pre-Flight Checks** (30s before start)
   - Notify stakeholders via Slack/Teams
   - Create incident ticket (tagged as "chaos-experiment")
   - Verify backup completed recently
   - Confirm rollback procedure tested in safe mode

2. **Phase 1: Ramp-Up** (0-10 seconds)
   - Begin allocating memory in 10MB chunks
   - Monitor all metrics continuously
   - Check abort conditions every 100ms
   - Log progress at each chunk

3. **Phase 2: Sustain Pressure** (10-40 seconds)
   - Hold memory at target level (~400MB)
   - Run synthetic workload against API
   - Test critical paths (auth, health, CRUD)
   - Document any failures or degradations

4. **Phase 3: Release** (40-55 seconds)
   - Gradually release allocated memory
   - Force GC cycles
   - Monitor recovery trajectory
   - Verify automatic healing

5. **Post-Experiment Validation** (55-60 seconds)
   - Full health check suite
   - Database integrity check
   - Authentication test
   - Memory usage verification (<70%)

6. **Report Generation** (after completion)
   - Metrics comparison (before/during/after)
   - Hypothesis confirmed/denied
   - Lessons learned
   - Action items (if any)

---

## Expected Timeline

```
T+0s    Start experiment
T+0-10s  Ramp-up phase (allocate memory gradually)
T+10-40s Sustain pressure (hold at 78% memory)
T+40-55s Release phase (gradual deallocation)
T+55-60s Post-experiment validation
T+60s   Experiment complete, generate report
```

Total duration: **60 seconds** (configurable via `--duration`)

---

## Related Incidents & Post-Mortems

- **S128/M-A01**: Fixed heapUsagePercent calculation (was using heapTotal instead of heap_size_limit)
- **DEBT-003**: Docker image size optimization (smaller image = more headroom)
- **Performance Benchmarks**: k6 load test results show baseline performance characteristics

---

## References

- [Node.js Memory Management](https://nodejs.org/en/docs/guides/simple-profiling/)
- [V8 Garbage Collection](https://v8.dev/blog/compaction-gc)
- [Chaos Engineering Principles](https://principlesofchaos.org/)
- [GlobalReach Architecture](docs/HIGH_AVAILABILITY_ARCHITECTURE.md)
- [S152 Security Integration](docs/SECURITY_MIDDLEWARE_INTEGRATION_S152.md)

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-06-12 | S152 Engine | Initial experiment definition |

---

*Ready for safe-mode execution*
*Live execution requires approval from SRE Lead*
