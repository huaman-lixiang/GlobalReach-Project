# CHAOS-003: Disk Space Exhaustion

**Category**: Resource Exhaustion
**Severity**: 🔴 High (potential data loss risk)
**Last Updated**: 2026-06-12
**Status**: ✅ Ready for Execution (Safe Mode Only)

---

## Objective

Validate system behavior when disk space is critically low (<10% free), testing:
- Log writing failure handling
- Database write errors
- File upload rejection
- Temporary file cleanup

**⚠️ WARNING**: This experiment has high risk of data corruption. **Always run in safe mode first.**

---

## Hypothesis

**HYPOTHESIS**: GlobalReach API will **fail gracefully** when disk is full, rejecting writes with clear error messages while maintaining read operations and authentication, without causing database corruption or log loss.

---

## Fault Model

Fill disk with large temporary files (in safe mode, simulate by checking available space):
```bash
# Create large temp file to consume disk space
dd if=/dev/zero of=/tmp/chaos-disk-fill.tmp bs=1M count=<remaining_space_MB>

# Cleanup
rm /tmp/chaos-disk-fill.tmp
```

---

## Scope

**Affected**: API container's mounted volume (logs, uploads, temporary files)
**Not Affected**: Database volume (separate mount), Redis (in-memory)

---

## Safety Limits

- Minimum free space: 5% (never fill below this)
- Abort if: Database write errors detected or health check fails
- Auto-rollback: Immediate file deletion on any error
- **Live mode requires**: Recent backup + DBA approval

---

## Success Criteria

- [ ] Write operations fail with clear "disk full" error (not cryptic errors)
- [ ] Read operations continue working (authentication, GET requests)
- [ ] No database corruption (PostgreSQL handles disk full gracefully)
- [ ] Log rotation works (doesn't crash logger)
- [ ] Full recovery after disk space restoration
- [ ] No data loss for existing records

---

## Pre-Flight Checklist (Mandatory for Live Mode)

- [ ] Full database backup completed <1 hour ago
- [ ] Backup verified (restore test successful)
- [ ] Disk monitoring alerting enabled
- [ ] DBA on-call notified
- [ ] Rollback procedure tested in safe mode
- [ ] Maintenance window approved (if production)

---

*Risk Level: HIGH - Exercise extreme caution*
