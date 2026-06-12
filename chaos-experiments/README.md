# Chaos Engineering Experiments - GlobalReach V2.0

**Framework Version**: 1.0.0
**Last Updated**: 2026-06-12
**Engine**: S152 Chaos Experiment Suite

---

## Overview

This directory contains chaos engineering experiments designed to validate the resilience of GlobalReach V2.0's infrastructure and application layers. These experiments follow the **Principles of Chaos Engineering**:

1. **Build a hypothesis around steady-state behavior**
2. **Vary real-world events**
3. **Run experiments in production** (or production-like environment)
4. **Improve system resilience** by learning from failures

---

## Directory Structure

```
chaos-experiments/
├── README.md                    # This file - experiment overview
├── CHAOS-001-memory-pressure.md # Memory stress test
├── CHAOS-002-network-latency.md # Network latency injection
├── CHAOS-003-disk-full.md       # Disk space exhaustion
├── runner.js                    # Unified experiment runner
└── reports/                     # Experiment execution reports (auto-generated)
    └── .gitkeep
```

---

## Experiment Categories

### Category 1: Resource Exhaustion (CHAOS-001, 003)
- Memory pressure
- Disk full
- CPU saturation
- File descriptor exhaustion

### Category 2: Network Failures (CHAOS-002)
- Latency injection
- Packet loss
- DNS resolution failure
- Bandwidth throttling

### Category 3: Process-Level Failures
- Process kill
- Signal injection (SIGSTOP, SIGSEGV)
- OOM killer trigger

### Category 4: Dependency Failures
- Database connection timeout
- Redis unavailability
- External service failure (SMTP, SSO providers)

---

## Safety Mechanisms

### 🛡️ Safe Mode (Default)
All experiments run in **safe mode** by default:
- ✅ Only checks preconditions (does NOT execute destructive actions)
- ✅ Validates experiment configuration
- ✅ Generates dry-run report
- ✅ Tests rollback procedures (without executing)
- ❌ Does NOT inject actual faults

### ⚠️ Live Mode
Explicit `--mode live` flag required:
- Executes real fault injection
- Requires confirmation prompt
- Auto-aborts if health checks fail
- Time-limited execution (max 5 minutes per experiment)

### 🔙 Auto-Rollback
Every experiment includes automatic rollback:
- Monitors system health during execution
- Immediately restores original state on degradation
- Generates rollback report
- Sends alert if rollback fails

---

## Running Experiments

### Quick Start

```bash
# Run CHAOS-001 in safe mode (recommended first step)
node chaos-experiments/runner.js --experiment CHAOS-001 --mode safe

# Run with verbose output
node chaos-experiments/runner.js --experiment CHAOS-001 --mode safe --verbose

# Execute in live mode (CAUTION: affects production!)
node chaos-experiments/runner.js --experiment CHAOS-001 --mode live --confirm

# Run all experiments in safe mode
node chaos-experiments/runner.js --all --mode safe

# Generate combined report
node chaos-experiments/runner.js --report
```

### Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `--experiment` | Experiment ID (e.g., CHAOS-001) | Required |
| `--mode` | Execution mode: `safe` or `live` | `safe` |
| `--duration` | Experiment duration in seconds | 60 |
| `--intensity` | Fault intensity (1-10) | 5 |
| `--verbose` | Enable detailed logging | false |
| `--confirm` | Skip confirmation prompt (live mode) | false |
| `--all` | Run all experiments | false |
| `--report` | Generate summary report only | false |
| `--output` | Report output directory | `./reports` |

---

## Experiment Status Matrix

| ID | Name | Category | Status | Last Run | Result |
|----|------|----------|--------|----------|--------|
| CHAOS-001 | API Container Memory Pressure | Resource Exhaustion | ✅ Ready | - | - |
| CHAOS-002 | Network Latency Injection | Network Failure | ✅ Ready | - | - |
| CHAOS-003 | Disk Space Exhaustion | Resource Exhaustion | ✅ Ready | - | - |

---

## Pre-Flight Checklist

Before running any experiment in **live mode**:

- [ ] Stakesholders notified (on-call, product team)
- [ ] Maintenance window approved
- [ ] Backup completed successfully
- [ ] Rollback procedure tested in safe mode
- [ ] Monitoring dashboards accessible
- [ ] Runbook ready for expected failure modes
- [ ] Communication channel established (Slack/Teams)
- [ ] Database backup verified

---

## Hypothesis Template

Each experiment follows this hypothesis format:

```
HYPOTHESIS: [System/component] will [expected behavior] when [fault is injected]

Steady State:
  - Metric A: normal value
  - Metric B: normal value
  - Metric C: normal value

Method:
  - Inject fault X at intensity Y for Z seconds
  - Observe metrics A, B, C
  - Compare to steady state baseline

Expected Outcome:
  - System degrades gracefully (not catastrophically)
  - Automatic recovery within N seconds
  - No data loss
  - User-facing errors are handled gracefully
```

---

## Post-Experiment Analysis

After each experiment, document:

1. **Hypothesis Confirmed/Denied?**
   - What actually happened vs. what we expected

2. **Metrics Collected**
   - Response time percentiles (p50, p95, p99)
   - Error rates (4xx, 5xx)
   - Resource utilization (CPU, memory, disk)
   - User impact (if measurable)

3. **Lessons Learned**
   - System weaknesses discovered
   - Improvements to make
   - Configuration changes needed

4. **Action Items**
   - Bug fixes
   - Architecture improvements
   - Monitoring enhancements
   - Documentation updates

---

## Integration with Observability Stack

Experiments integrate with GlobalReach's monitoring infrastructure:

- **Prometheus**: Real-time metrics during experiment
- **Grafana**: Dashboard visualization of experiment impact
- **Loki**: Log aggregation for error analysis
- **AlertManager**: Automated alerts if degradation exceeds thresholds
- **Custom Metrics**:
  - `globalreach_chaos_experiment_total` - Experiment execution count
  - `globalreach_chaos_experiment_duration_seconds` - Execution time
  - `globalreach_chaos_rollback_total` - Rollback triggers
  - `globalreach_chaos_hypothesis_result` - Confirmation/denial (0/1)

---

## Governance & Approval

### Who Can Run Experiments?

| Mode | Required Role | Approval Needed |
|------|--------------|-----------------|
| Safe | Developer + | None |
| Live (low intensity) | SRE/DevOps | Team lead |
| Live (high intensity) | SRE Lead | Engineering manager |
| Live (production) | Platform Engineer | VP Engineering + 24h notice |

### Experiment Review Board

All new experiments must be reviewed by:
1. Security team (ensure no data exposure)
2. SRE team (validate safety mechanisms)
3. Product team (assess user impact)
4. Legal/compliance (if PII involved)

---

## Troubleshooting

### Experiment Stuck?
```bash
# Force stop (creates emergency rollback)
node chaos-experiments/runner.js --emergency-stop

# Check experiment status
node chaos-experiments/runner.js --status
```

### Rollback Failed?
1. Check `reports/rollback-failure.log`
2. Manual intervention using standard runbooks
3. Contact on-call if automated recovery fails
4. Post-mortem required within 24h

### Unexpected Behavior?
1. Stop experiment immediately (`Ctrl+C` or `--emergency-stop`)
2. Collect logs from `reports/`
3. Open incident with tag `chaos-experiment`
4. Do NOT delete experiment data (needed for analysis)

---

## Contributing New Experiments

To add a new experiment:

1. Create `CHAOS-XXX-description.md` following template
2. Implement experiment logic in `runner.js` (add to `experiments` object)
3. Test in safe mode extensively
4. Submit for review to Experiment Review Board
5. Document results in README.md status matrix

### Experiment Template

```markdown
# CHAOS-XXX: [Experiment Name]

## Objective
[What does this experiment test?]

## Hypothesis
[System] will [behavior] when [fault]

## Fault Model
[Technical details of fault injection]

## Scope
[Affected components]
[Unaffected components (blast radius)]

## Safety Limits
[Maximum duration]
[Intensity caps]
[Abort conditions]
[Rollback procedure]

## Success Criteria
[Metric thresholds that define success/failure]

## Risks
[Potential negative impacts]
[Mitigations]

## References
[Related incidents, post-mortems, docs]
```

---

## License & Disclaimer

⚠️ **WARNING**: Chaos engineering experiments can cause service disruptions. Always run in **safe mode** first. Never run unreviewed experiments in production. Ensure proper backups and rollback procedures are in place before live execution.

**Use at your own risk.** The GlobalReach project contributors are not responsible for any damages caused by chaos experiments.

---

*Part of GlobalReach V2.0 Enterprise Resilience Framework*
*S152 Engine | Security Middleware Integration & Chaos Validation*
