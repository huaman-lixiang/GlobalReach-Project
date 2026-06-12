# CHAOS-002: Network Latency Injection

**Category**: Network Failure
**Severity**: 🟡 Medium (controlled impact)
**Last Updated**: 2026-06-12
**Status**: ✅ Ready for Execution

---

## Objective

Test system resilience under degraded network conditions, simulating:
- Cross-region latency (100-500ms)
- Network congestion (jitter, variable delays)
- Partial connectivity loss (packet reordering)

Validates timeout configurations, retry logic, and user experience degradation.

---

## Hypothesis

**HYPOTHESIS**: GlobalReach API will **handle network latency gracefully**, with proper timeout configuration preventing hanging requests, retry mechanisms functioning for transient failures, and users receiving informative error messages rather than silent timeouts.

---

## Fault Model

Inject latency using `tc` (traffic control) on Docker bridge interface:
```bash
# Add 200ms latency with 50ms jitter
tc qdisc add dev eth0 root netem delay 200ms 50ms

# Remove after experiment
tc qdisc del dev eth0 root netem
```

**Scope**: Affects only egress traffic from API container.

---

## Safety Limits

- Maximum latency: 2000ms (2 seconds)
- Duration: 60 seconds maximum
- Abort if: health check timeout >10s or error rate >20%

---

## Success Criteria

- [ ] No hung requests (all complete within configured timeouts)
- [ ] Retry mechanisms work for database/Redis connections
- [ ] Users receive proper error messages (not gateway timeouts)
- [ ] System recovers immediately after latency removal
- [ ] No data inconsistency from partial writes

---

*See README.md for execution instructions*
