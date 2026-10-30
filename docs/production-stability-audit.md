# Production Stability Audit — Care Circle Backend

**Audit date:** 2026-10-30  
**Host:** Windows development machine (Node v24.x observed)  
**Scope:** Pre-VPS local verification — **no Docker, no deploy, no production data touched**

**Status legend:** CODE VERIFIED · LOCAL RUNTIME VERIFIED · STAGING VERIFIED · NOT TESTED · BLOCKED

---

## Executive summary

| Area | Classification |
|------|----------------|
| Production build (`dist/server.js`) startup | **LOCAL RUNTIME VERIFIED** |
| Health / readiness | **LOCAL RUNTIME VERIFIED** |
| Env fail-closed + prod noop worker guard | **LOCAL RUNTIME VERIFIED** |
| Graceful shutdown (API child process) | **LOCAL RUNTIME VERIFIED** (Windows uses `child.kill()` — see §Windows) |
| Worker-only compiled process | **LOCAL RUNTIME VERIFIED** |
| API crash resilience | **LOCAL RUNTIME VERIFIED** (`production-stability.crash.test.ts`) |
| Mongo disconnect / readiness | **LOCAL RUNTIME VERIFIED** |
| Load (autocannon → compiled API) | **LOCAL RUNTIME VERIFIED** |
| Scheduler / FCM / concurrency depth | **CODE VERIFIED** (existing 159+ integration suite; not re-audited line-by-line here) |
| Real FCM / staging Firebase | **NOT TESTED** |
| VPS / Docker | **NOT TESTED** (explicitly out of scope) |

**Automated suite after audit additions:** **176/176** backend tests **PASS** (includes **17** production-stability tests).

---

## Architectural review (pre-stress)

| Topic | Finding | Severity |
|-------|---------|----------|
| Startup fail-closed | Invalid env → `process.exit(1)` from `main().catch` | OK |
| No global `unhandledRejection` / `uncaughtException` handlers | Stray async rejections outside Express could still crash Node | **MEDIUM** |
| Express centralized `errorHandler` | Operational errors mapped; generic 500 without stack in response | OK |
| Mongo single mongoose connection | Disconnect drops readiness to 503; reconnect restores | OK |
| Scheduler tick errors | Logged; worker continues (`worker.ts`) | OK |
| In-memory rate limiter | Per-process buckets; not safe for multi-replica without proxy limiter | **MEDIUM** |
| `PROCESS_MODE=all` | Dev convenience; production Compose splits api/worker | **LOW** (ops) |
| Firebase token verify on API | Real Admin SDK; audit load on `/health` only for compiled child without auth mock | OK |
| JSON body limit 1 MB | Enforced | OK |
| Secrets in logs | Pino redaction paths include tokens, issuer key, proofs | OK |

---

## Tests executed (new)

| Suite | Tests | Result |
|-------|-------|--------|
| `production-stability.runtime.test.ts` | 5 | PASS |
| `production-stability.crash.test.ts` | 8 | PASS |
| `production-stability.mongo.test.ts` | 2 | PASS |
| `production-stability.load.test.ts` | 2 | PASS |

Helper: `tests/helpers/productionServer.ts` (spawns `node dist/server.js` + `MongoMemoryServer`).

---

## Process crashes observed

| Run | Crashes |
|-----|---------|
| Full stability + regression suite | **0** unexpected process exits |
| Invalid env spawn | **Expected** exit code **1** |

---

## Windows notes

- Graceful shutdown test uses `child.kill()` on Windows (SIGTERM semantics differ from Linux).
- For VPS (Linux), prefer SIGTERM verification again during staging.

---

## Defects fixed during audit

| Issue | Fix |
|-------|-----|
| No automated compiled-runtime smoke | Added production server helper + runtime tests |
| Mongo failure readiness not regression-tested | Added `production-stability.mongo.test.ts` |
| Typecheck/lint for new harness | ChildProcess typing + `autocannon` module declaration |

No **CRITICAL** production code defects requiring API contract changes were found.

---

## Remaining risks (pre-VPS)

| Risk | Severity | Mitigation |
|------|----------|------------|
| Unhandled promise rejections outside Express | MEDIUM | Staging soak + process supervisor; consider targeted handler after staging evidence |
| Multi-instance rate limits | MEDIUM | Edge proxy rate limiting on issuer/join |
| Real FCM behavior | HIGH for push UX | `docs/device-test-checklist.md` on staging |
| CF bootstrap E2E | HIGH for open circles | Staging checklist before `CIRCLE_BOOTSTRAP_ENABLED=true` |

---

## Security verification (audit §9)

| Control | Result |
|---------|--------|
| Firebase auth / authZ | **CODE VERIFIED** + crash suite |
| Cross-circle isolation | PASS in crash tests |
| Input validation (Zod) | PASS |
| Body size limit 1 MB | PASS (oversized test) |
| Issuer / invite replay | **AUTOMATION VERIFIED** (existing security tests) |
| Rate limiting | **AUTOMATION VERIFIED** + in-memory **LOCAL RUNTIME VERIFIED** |
| Log redaction | **CODE VERIFIED** |
| Prod noop worker rejection | **LOCAL RUNTIME VERIFIED** (runtime test) |
| Error detail exposure | PASS (no stacks in JSON) |

**Rate limiter under concurrency:** In-process map updates are synchronous per key; safe for single replica. **Multi-instance:** **NOT TESTED** — use edge proxy (documented **MEDIUM** risk).

---

- `docs/api-load-test-report.md`
- `docs/crash-recovery-report.md`
- `docs/memory-audit.md`
- `docs/pre-vps-readiness.md`

---

## Verdict

**Backend code and local production-mode runtime behavior are verified for VPS deployment preparation.**  
**NOT production-ready for end users** until staging E2E, device FCM, and operator runbook execution (**BLOCKED** items in `docs/pre-vps-readiness.md`).
