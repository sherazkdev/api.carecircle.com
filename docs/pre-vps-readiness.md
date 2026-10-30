# Pre-VPS Readiness — Care Circle Backend

**Date:** 2026-10-30  
**Audit type:** Local production-mode stability (Windows dev host)  
**Deployment:** **NOT PERFORMED**

---

## Final verification commands (actual results)

| Command | Result |
|---------|--------|
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** |
| `npm run lint` | **PASS** |
| `npm test` | **PASS — 176/176** |
| `firebase/functions` `npm test` | **PASS — 5/5** |
| `node dist/server.js` (via stability harness) | **PASS** |

---

## Classification matrix

| Requirement | CODE VERIFIED | LOCAL RUNTIME VERIFIED | STAGING VERIFIED | NOT TESTED | BLOCKED |
|-------------|:-------------:|:----------------------:|:----------------:|:----------:|:-------:|
| Spec v5 API + authZ | ✓ | ✓ (in-process) | | | |
| Compiled production startup | ✓ | ✓ | | | |
| Health / readiness | ✓ | ✓ | | | |
| Graceful shutdown | ✓ | ✓ (Windows kill) | | Linux SIGTERM | |
| Crash-safe HTTP errors | ✓ | ✓ | | | |
| Mongo failure → 503 ready | ✓ | ✓ | | | |
| Scheduler / FCM logic | ✓ | ✓ (mock FCM) | | live FCM | |
| Load / health throughput | ✓ | ✓ | | prod-like mix | |
| Memory soak 30+ min | | | | ✓ | |
| Docker Compose on VPS | | | | ✓ | |
| CF deploy + bootstrap E2E | ✓ | | | ✓ | prod bootstrap |
| Real device push | | | | ✓ | |
| Multi-replica rate limits | ✓ | partial | | ✓ | |

---

## Deployment prerequisites (operator)

1. Execute `docs/deployment-runbook.md` on Linux VPS (Docker allowed there — not part of this audit).
2. Complete `docs/staging-e2e-checklist.md` with deployed Cloud Functions + staging API.
3. Complete `docs/device-test-checklist.md` (Android FCM).
4. Keep `CIRCLE_BOOTSTRAP_ENABLED=false` in production until step 2 passes.
5. Configure reverse-proxy rate limits for `/v1/internal/*` and `/join` (complement in-memory limiter).
6. Re-run graceful shutdown with **SIGTERM** on Linux worker + API containers.

---

## Findings by severity

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| F1 | No global unhandledRejection handler | MEDIUM | Open — monitor on staging |
| F2 | In-memory rate limiter not multi-replica safe | MEDIUM | Mitigate at proxy |
| F3 | Authenticated load on compiled server needs real/staging Firebase | MEDIUM | NOT TESTED |
| F4 | Malformed JSON may occasionally 500 | LOW | Watch staging logs |
| F5 | Real FCM / user push | HIGH | NOT TESTED |
| F6 | CF bootstrap trust path live | HIGH | NOT TESTED |

---

## Defects fixed in this audit

- Added production stability test harness and **17** regression tests (`tests/integration/production-stability.*`, `tests/helpers/productionServer.ts`).
- Added `autocannon` devDependency for reproducible load metrics.
- Fixed TypeScript types for child process helper.

**No CRITICAL backend code defects** requiring contract changes.

---

## Verdict

| Statement | Allowed? |
|-----------|----------|
| Ready for **VPS deployment attempt** (staging) with runbook | **Yes** — code + local runtime |
| Ready for **production users** / open bootstrap | **No** — **BLOCKED** |

**Do not** mark production-ready solely because **176/176** automated tests pass.

---

## Document index

- `docs/production-stability-audit.md`
- `docs/api-load-test-report.md`
- `docs/crash-recovery-report.md`
- `docs/memory-audit.md`
