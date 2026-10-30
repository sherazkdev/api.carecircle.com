# Final Backend Audit — Care Circle (Spec v5)

**Audit date:** 2026-10-30  
**Scope:** Express API, MongoDB models, scheduler worker, FCM adapter, Cloud Functions (source), Firestore rules (source).  
**Out of scope:** Production Flutter app (external developer); real-device FCM; deployed staging.

**Status legend:** IMPLEMENTED · AUTOMATION VERIFIED · LIVE VERIFIED · NOT TESTED · BLOCKED

---

## Executive summary

| Area | Verdict |
|------|---------|
| Spec v5 core APIs | **IMPLEMENTED** / **AUTOMATION VERIFIED** |
| Security (authZ, P2, invites, injection) | **AUTOMATION VERIFIED** (+ rate limits **AUTOMATION VERIFIED**) |
| Scheduler + 11 notification types | **AUTOMATION VERIFIED** (mocked FCM) |
| Cloud Functions trust layer | **IMPLEMENTED** — deploy/E2E **NOT TESTED** |
| Docker staging runtime | **NOT TESTED** (Docker CLI unavailable on audit host) |
| Production open bootstrap | **BLOCKED** (`CIRCLE_BOOTSTRAP_ENABLED=false` default) |

Machine-readable contract: `docs/openapi.yaml`, `docs/postman/care-circle-api.postman_collection.json`.

---

## Endpoint inventory

All success responses use `{ "ok": true, "data": ... }` unless noted. Errors use `{ "ok": false, "error": { "code", "message", "details?" } }`.

| # | Method | Route | Auth | Permission | Automated tests |
|---|--------|-------|------|------------|-----------------|
| H1 | GET | `/health/live` | None | Public | `tests/health.test.ts` |
| H2 | GET | `/health/ready` | None | Mongo + Firebase ready | `tests/health.test.ts` |
| H3 | GET | `/health` | None | Legacy combined | `tests/health.test.ts` |
| I1 | POST | `/v1/internal/circle-create-tokens` | `X-Issuer-Api-Key` | Trusted issuer; rate limit 30/min/IP | `phase10.security.deploy.test.ts`, `release-blocker.security.test.ts`, `tests/unit/rateLimit.test.ts` |
| 1 | POST | `/v1/circles/:circleId/devices` | Firebase Bearer | Member or bootstrap owner proof | `devices.prefs.test.ts`, `auth.authorization.test.ts`, `release-blocker.security.test.ts` |
| 2 | PUT | `/v1/circles/:circleId/members/me/prefs` | Firebase Bearer | Circle member | `devices.prefs.test.ts` |
| 3 | PUT | `/v1/circles/:circleId/reminders/:module/:itemId` | Firebase Bearer | Owner (`circles.ownerUid`) | `reminders.test.ts`, `scheduler.test.ts` |
| 4 | DELETE | `/v1/circles/:circleId/reminders/:module/:itemId` | Firebase Bearer | Owner | `reminders.test.ts`, `scheduler.test.ts` |
| 5 | PUT | `/v1/circles/:circleId/reminders/medication/:itemId/completion` | Firebase Bearer | **Owner only (C1)** | `reminders.test.ts`, `auth.authorization.test.ts` |
| 6 | PUT | `/v1/circles/:circleId/reminders/appointment/:itemId/status` | Firebase Bearer | **Owner only (C1)** | `reminders.test.ts` |
| 7 | PUT | `/v1/circles/:circleId/reminders/task/:itemId/status` | Firebase Bearer | **Owner only (C1)** | `reminders.test.ts` |
| 8 | POST | `/v1/circles/:circleId/updates` | Firebase Bearer | Any member | `phase8.updates.deletion.test.ts`, `fcmDelivery.test.ts` |
| 9 | DELETE | `/v1/members/me` | Firebase Bearer | Self; owner **409** if owns circles (C4) | `phase8.updates.deletion.test.ts`, `auth.authorization.test.ts` |
| 10 | DELETE | `/v1/circles/:circleId` | Firebase Bearer | Owner | `phase8.updates.deletion.test.ts` |
| — | POST | `/v1/circles/:circleId/invites` | Firebase Bearer | Owner | `phase10.security.deploy.test.ts`, `release-blocker.security.test.ts` |
| — | POST | `/v1/circles/:circleId/join` | Firebase Bearer | Authenticated + valid invite; rate limit 20/min/uid | Same + `rateLimit.test.ts` (issuer only; join shares limiter pattern) |
| — | DELETE | `/v1/members/:uid?circleId=` | Firebase Bearer | Owner removes member | `phase8.updates.deletion.test.ts` |

Detailed request/response schemas: `docs/api-contract.md`.

---

## Security audit

| Control | Status | Evidence |
|---------|--------|----------|
| Firebase ID token on protected routes | AUTOMATION VERIFIED | `requireAuth`, `auth.authorization.test.ts` |
| UID from token only (no body spoof) | AUTOMATION VERIFIED | Controllers use `req.auth.uid` |
| Client `role` not trusted for ownership | AUTOMATION VERIFIED | `requireCircleOwner`, device bootstrap |
| Cross-circle access denied | AUTOMATION VERIFIED | `release-blocker.security.test.ts` |
| Owner-only reminder writes / delete circle | AUTOMATION VERIFIED | Middleware + tests |
| MongoDB queries parameterized (no raw injection) | IMPLEMENTED | Mongoose / typed filters |
| JSON body limit 1 MB | IMPLEMENTED | `express.json({ limit: '1mb' })` |
| Rate limiting (issuer, join) | IMPLEMENTED / AUTOMATION VERIFIED | `src/shared/middleware/rateLimit.ts` |
| Secret redaction in logs | IMPLEMENTED | `src/config/logger.ts` (Authorization, issuer key, tokens, SA fields) |
| P2 HMAC create token bind + expiry + replay | AUTOMATION VERIFIED | `ownershipProof.ts`, security tests |
| Issuer API key (fail closed when disabled) | AUTOMATION VERIFIED | `issuer.service.ts` |
| Invite one-time / TTL / circle delete invalidation | AUTOMATION VERIFIED | `inviteProof.ts`, phase10 tests |
| Bootstrap fail-closed default | IMPLEMENTED | `CIRCLE_BOOTSTRAP_ENABLED=false` |
| Firestore rules (source review) | IMPLEMENTED | `firebase/firestore.rules`, `docs/firestore-rules-audit.md` |
| Firestore rules emulator | NOT TESTED | No emulator run in CI/agent |
| Production noop delivery rejected | AUTOMATION VERIFIED | `phase9.e2e.reliability.test.ts` |

**Never:** unrestricted bootstrap; issuer secrets in client docs; trusting Flutter for circleId provenance without CF + issuer.

---

## Scheduler & FCM pipeline

Flow: **Reminder API → MongoDB → job generation → worker claim → eligibility → FCM (or mock) → delivery ledger → job state.**

| Requirement | Status | Tests |
|-------------|--------|-------|
| 11 notification types (before/due/missed/snooze × modules + update) | AUTOMATION VERIFIED | `notificationTemplates.test.ts`, `fcmDelivery.test.ts`, `scheduler.test.ts` |
| Server-generated title/body | AUTOMATION VERIFIED | Template unit tests |
| Owner-only before/due/snooze | AUTOMATION VERIFIED | Audience rules in scheduler tests |
| Family missed alerts | AUTOMATION VERIFIED | `scheduler.test.ts` |
| Member prefs toggles | AUTOMATION VERIFIED | `devices.prefs.test.ts`, scheduler |
| Multi-device FCM | AUTOMATION VERIFIED | `fcmDelivery.test.ts` |
| Recurring meds / tasks | AUTOMATION VERIFIED | `scheduler.test.ts` |
| Snooze cutoff (next dose / 2h) | AUTOMATION VERIFIED | Scheduler tests |
| IANA timezone + DST | AUTOMATION VERIFIED | `scheduler.test.ts`, phase9 |
| Atomic job claim + lease recovery | AUTOMATION VERIFIED | `scheduler.test.ts`, `phase9.e2e.reliability.test.ts` |
| Invalid FCM token cleanup | AUTOMATION VERIFIED | `fcmDelivery.test.ts` |
| Schedule edit/delete invalidates future jobs | AUTOMATION VERIFIED | `reminders.test.ts`, `scheduler.test.ts` |
| No historical notification burst on upsert | AUTOMATION VERIFIED | Reminder job generation |
| Real phone notification display | NOT TESTED | Mock FCM only |

---

## Cloud Functions

| Function | Status |
|----------|--------|
| `createCareCircle` | IMPLEMENTED — unit **AUTOMATION VERIFIED** (`firebase/functions/test/ownership.test.ts`) |
| `requestCircleBootstrapToken` | IMPLEMENTED — same |
| Firestore owner check before mint | IMPLEMENTED / unit PASS |
| HTTP call to internal issuer | IMPLEMENTED — **LIVE VERIFIED NOT TESTED** |
| Deploy to staging Firebase | NOT TESTED |
| CF ↔ API E2E bootstrap | NOT TESTED |

---

## Docker / staging infrastructure

| Check | Status |
|-------|--------|
| `Dockerfile` production target | IMPLEMENTED |
| `docker-compose.yml` api + worker + mongo | IMPLEMENTED |
| Image build on audit host | **NOT TESTED** |
| Compose up / health / restart | **NOT TESTED** |

Operator verification (when Docker available):

```powershell
cd e:\care-circle-reminder-app
docker build -t care-circle-api:prod --target production .
docker compose up -d --build
curl http://localhost:3000/health/ready
docker compose restart worker
docker compose logs worker --tail 50
```

---

## Defects fixed in this audit

| Issue | Fix |
|-------|-----|
| No abuse rate limiting on issuer/join | In-process limiter on issuer (30/min/IP) and join (20/min/uid) |
| Issuer body validation ad hoc | Zod schema + `validateRequest` |
| Sensitive headers in logs | Redact issuer key, ownershipProof, inviteToken, create secret env names |

No open **P0/P1** backend defects identified beyond **live** staging deployment gaps.

---

## Acceptance matrix (requirements → status)

| Requirement | IMPLEMENTED | AUTOMATION VERIFIED | LIVE VERIFIED | NOT TESTED | BLOCKED |
|-------------|:-----------:|:---------------------:|:-------------:|:----------:|:-------:|
| Spec v5 APIs | ✓ | ✓ | | | |
| Secure bootstrap (P2) | ✓ | ✓ | | CF E2E | prod enable |
| Invites / join | ✓ | ✓ | | | |
| Scheduler / FCM logic | ✓ | ✓ | | device FCM | |
| Docker runtime | ✓ | | | ✓ | |
| Flutter handover package | ✓ | | | app wire | |
| OpenAPI / Postman | ✓ | | | | |

**Operator:** Complete `docs/staging-e2e-checklist.md` and `docs/device-test-checklist.md` before production cutover.
