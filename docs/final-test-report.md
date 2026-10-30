# Final Test Report — Care Circle Backend

**Run date:** 2026-10-30  
**Environment:** Windows agent host, in-memory Mongo + mocked Firebase auth/FCM in integration tests.

---

## Commands executed

| Command | Result |
|---------|--------|
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** |
| `npm run lint` | **PASS** (after fixing unused import in rate limit test) |
| `npm test` (backend) | **PASS** — **15** files, **159** tests |
| `cd firebase/functions && npm test` | **PASS** — **5** tests |
| `docker build` / `docker compose` | **NOT RUN** — Docker CLI not on PATH |
| Firebase emulator (rules + CF) | **NOT RUN** |
| `flutter test` / `flutter analyze` | **NOT RUN** — Flutter SDK not on PATH |

---

## Backend test inventory

| File | Focus |
|------|--------|
| `tests/health.test.ts` | Health endpoints |
| `tests/env.test.ts` | Env validation |
| `tests/firebase.init.test.ts` | Firebase Admin init |
| `tests/unit/notificationTemplates.test.ts` | FCM title/body templates |
| `tests/unit/rateLimit.test.ts` | Issuer rate limit **503** |
| `tests/integration/auth.authorization.test.ts` | Auth, bootstrap gates, cross-circle |
| `tests/integration/devices.prefs.test.ts` | Devices, prefs, token reassignment |
| `tests/integration/reminders.test.ts` | Upsert/delete/completion |
| `tests/integration/scheduler.test.ts` | Job generation, TZ, snooze, claim |
| `tests/integration/fcmDelivery.test.ts` | Delivery ledger, invalid tokens, noop rejection |
| `tests/integration/models.test.ts` | Index expectations |
| `tests/integration/phase8.updates.deletion.test.ts` | Updates, member/circle delete |
| `tests/integration/phase9.e2e.reliability.test.ts` | Worker recovery, production guards |
| `tests/integration/phase10.security.deploy.test.ts` | Issuer, invites, deploy config |
| `tests/integration/release-blocker.security.test.ts` | Unauthorized matrix |

---

## Cloud Functions tests

| File | Tests |
|------|-------|
| `firebase/functions/test/ownership.test.ts` | Firestore owner validation before token mint (mocked) |

---

## Coverage gaps (honest)

| Gap | Status |
|-----|--------|
| Real FCM to physical device | NOT TESTED |
| Docker container lifecycle | NOT TESTED |
| Deployed CF calling live API issuer | NOT TESTED |
| Firestore rules emulator | NOT TESTED |
| Multi-replica API rate limit consistency | NOT TESTED (in-memory limiter; use reverse proxy at scale) |
| External Flutter app integration | NOT TESTED (contract package only) |

---

## Regression baseline

Prior baseline: **158/158**. Current: **159/159** (+1 rate limit test).

Re-run before any release:

```powershell
cd e:\care-circle-reminder-app
npm run typecheck
npm run build
npm run lint
npm test
cd firebase\functions
npm test
```
