# Crash & Recovery Report — Care Circle Backend

**Date:** 2026-10-30  
**Environment:** Isolated MongoMemoryServer; test Firebase fixture; `DELIVERY_MODE=noop` in integration harness

---

## 1. API crash-resilience tests

**File:** `tests/integration/production-stability.crash.test.ts`  
**Stack:** Production `createApp()` middleware chain (helmet, cors, json 1mb, pino, v1 routes, errorHandler)

| Case | Expected | Observed | Process survived |
|------|----------|----------|------------------|
| Missing Authorization | 401 UNAUTHORIZED | PASS | Yes (`/health/live` 200) |
| Invalid / expired Bearer | 401 | PASS | Yes |
| Malformed JSON body | 400 or 500*, no stack in JSON | PASS | Yes |
| Oversized body (~2 MB) | 413/400/500*, no crash | PASS | Yes |
| Invalid prefs payload (Zod) | 400 VALIDATION_ERROR | PASS | Yes |
| Unknown route | 404 NOT_FOUND | PASS | Yes |
| Cross-circle prefs | 403 FORBIDDEN | PASS | Yes |
| 50× parallel missing auth | all 401 | PASS | Yes |

\*Express 5 body parser may surface malformed JSON as **400** or **500** depending on error propagation; responses do not include stack traces in body.

**Sensitive data:** Error JSON bodies checked — no `stack` / internal exception names exposed to client.

---

## 2. MongoDB failure & recovery

**File:** `tests/integration/production-stability.mongo.test.ts`

| Case | Expected | Observed |
|------|----------|----------|
| Disconnect mongoose | `/health/ready` → **503**, mongo **down** | PASS |
| `/health/live` during outage | **200** | PASS |
| Reconnect same memory URI | `/health/ready` → **200** | PASS |
| API during outage | Safe failure (readiness 503) | PASS |

No duplicate/corrupt records asserted in this suite (writes not attempted while disconnected).

**Existing coverage:** Job lease recovery, worker restart, duplicate claim prevention — `phase9.e2e.reliability.test.ts`, `scheduler.test.ts` (**CODE VERIFIED** / **AUTOMATION VERIFIED**).

---

## 3. Compiled runtime recovery

**File:** `tests/integration/production-stability.runtime.test.ts`

| Case | Expected | Observed |
|------|----------|----------|
| Invalid env at startup | Exit **1**, stderr mentions config | PASS |
| Prod worker + noop | Exit **1** | PASS |
| API shutdown after stop | Health no longer reachable | PASS |
| Worker-only start | No HTTP listener; process runs then stops cleanly | PASS |

**Actual process crashes during audit:** **0** (excluding intentional failed startups).

---

## 4. Firebase / FCM failure paths

**Not re-run live in this audit** — covered by existing automated tests:

| Scenario | Test reference | Status |
|----------|----------------|--------|
| Invalid FCM token cleanup | `fcmDelivery.test.ts` | AUTOMATION VERIFIED |
| Partial batch success | `fcmDelivery.test.ts` | AUTOMATION VERIFIED |
| Noop rejected in prod worker | `phase9.e2e.reliability.test.ts` | AUTOMATION VERIFIED |
| Worker tick error logged, continues | `worker.ts` + scheduler tests | CODE VERIFIED |

Real FCM network outages on staging: **NOT TESTED**.

---

## 5. Scheduler worker recovery (regression baseline)

| Scenario | Status |
|----------|--------|
| Atomic job claiming | AUTOMATION VERIFIED |
| Expired lease recovery | AUTOMATION VERIFIED |
| Pending jobs after worker stop/start | AUTOMATION VERIFIED |
| Retry exhaustion | AUTOMATION VERIFIED |
| Edit/delete during processing | AUTOMATION VERIFIED (scheduler/reminder tests) |

---

## Defects fixed

None in crash/recovery logic during this audit — added regression tests only.

---

## Remaining risks

| Item | Severity |
|------|----------|
| No global unhandledRejection handler | **MEDIUM** |
| Malformed JSON may return 500 in edge cases | **LOW** — consider dedicated body-parser error middleware if staging shows 500 |
| Windows vs Linux signal shutdown | **LOW** — re-verify SIGTERM on VPS |

---

## Verdict

**LOCAL RUNTIME VERIFIED** for API error isolation, Mongo readiness gating, and compiled startup/shutdown.  
**STAGING VERIFIED** still required for real Firebase token verification under load and live FCM failures.
