# Memory & Resource Audit — Care Circle (Local)

**Date:** 2026-10-30  
**Method:** Bounded load + `process.memoryUsage()` snapshots in test harness (not a 24h soak)

---

## Tests executed

| Test | Duration | Load |
|------|----------|------|
| Autocannon health burst (compiled API child) | 8 s | 20 connections |
| 40 parallel prefs PUTs (in-process API) | < 1 s | 40 concurrent |

**Long soak (30+ min):** **NOT TESTED** — prerequisite for leak confirmation.

---

## Observations

### Parent test process (autocannon run)

| Phase | Notes |
|-------|--------|
| Before L1 | Baseline heap/RSS recorded in test (heap > 0) |
| During L1 | Load directed at **child** API process; parent orchestrates |
| After L1 | Parent heap remained within normal test run variance |

### In-process API (L2)

| Metric | Guardrail |
|--------|-----------|
| `heapUsed` delta after 40 writes | Asserted **< 80 MB** increase — **PASS** |

### Event loop / listeners

| Area | Finding | Severity |
|------|---------|----------|
| Scheduler worker timer | `clearInterval` on stop; `unref` on poll timer | OK |
| Mongo connection listeners | Attached once (`listenersAttached` flag) | OK |
| Rate limiter Map | Grows with distinct keys; bounded in test via `resetRateLimitBucketsForTests` | **LOW** — ops should monitor long-lived issuer/join keys |
| Express per-request | No custom long-lived listeners added in handlers | OK |

### Database pool

Mongoose default pool under parallel prefs (40): no exhaustion observed (all 200 responses).

**Event loop delay monitoring:** **NOT TESTED** (no `perf_hooks.monitorEventLoopDelay` run in this audit).

---

## CPU

Not instrumented in this audit. Autocannon achieved multi-k req/s on health — CPU not saturated for that endpoint.

---

## Conclusion on leaks

**No memory leak declared.** Single before/after heap comparison under moderate load showed bounded growth only.

**Recommendation (MEDIUM):** On staging VPS, run 15–30 min autocannon or realistic traffic with `NODE_OPTIONS=--heapsnapshot-near-heap-limit` and monitor RSS via host metrics.

---

## Verdict

**LOCAL RUNTIME VERIFIED** — bounded resource behavior under short load.  
**STAGING VERIFIED** required for production soak and event-loop delay SLOs.
