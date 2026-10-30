# Phase Progress

## PHASE 0 — Specification Audit and Architecture

**Status:** COMPLETE  
**Decisions approved:** 2026-10-29 (C1–C5, O9, response envelope) — see `security-decisions.md`

---

## PHASE 1 — Backend Foundation

**Status:** COMPLETE  
**Date:** 2026-10-29

### Completed functionality

- Express app bootstrap with Helmet, CORS, JSON body parser
- TypeScript strict project (`tsconfig.json` + `tsconfig.build.json`), ESM (`"type": "module"`)
- Zod environment validation (`src/config/env.ts`)
- MongoDB connection helpers + status for health
- Firebase Admin initialization from path or JSON (no secrets logged)
- Pino + pino-http structured logging with redaction paths
- Centralized `AppError` + error/not-found handlers
- Approved `{ ok, data }` / `{ ok: false, error }` envelope
- Zod `validateRequest` middleware stub for later phases
- `GET /health` with mongo + firebase dependency status (`503` when degraded)
- Docker / Compose development infrastructure files
- Vitest + Supertest suites; ESLint flat config + Prettier
- Documented approved Spec overrides and **C2 ownership-proof contract** (Phase 3 still gated)

### Created / modified files (high level)

| Path | Notes |
|------|-------|
| `src/app.ts`, `src/server.ts` | App factory + bootstrap/shutdown |
| `src/config/*` | env, logger, mongo, firebase |
| `src/modules/health/*` | Health route/controller |
| `src/shared/**` | errors, middleware, response helpers |
| `tests/**` | env, firebase init, health |
| `package.json`, lockfile | Scripts + lint/prettier/mms deps |
| `tsconfig*.json`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json` | Tooling |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore` | Dev/prod container stubs |
| `.env.example`, `.gitignore` | Env contract |
| `docs/security-decisions.md` | Decisions recorded + C2 proof options |
| `docs/api-contract.md`, `requirements-coverage.md`, `architecture.md` | Overrides |
| `docs/test-report.md`, `docs/phase-progress.md` | Verification |

### Tests executed

| Command | Result |
|---------|--------|
| `npm install` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS (7/7) |
| Live `GET /health` | PASS |
| Mongo connect on `:27017` | PASS |
| Firebase `initializeApp` via documented env path | PASS |
| `docker` / `docker compose` | **Unavailable on host** |

### Security considerations

- No auth middleware yet (Phase 3) — intentional.
- Service account fixture used for local init only; real production JSON must not be committed (gitignored).
- C2 ownership proof **not implemented**; Phase 3 blocked until P1/P2/P3 (or equivalent) approved.
- Approved C1/C3/C4/C5/O9/envelope recorded as Spec overrides.

### Remaining issues

1. **Docker CLI missing** on this Windows host — Compose not smoke-tested here.
2. **C2 proof mechanism** still needs explicit choice (custom claim / signed token / admin bootstrap) before Phase 3.
3. Local `.env` + `firebase-service-account.json` are gitignored fixtures for verification; replace with real Firebase SA for Auth/FCM work in later phases.
4. `dotenv` v18 logs an “injected env” line at startup — non-sensitive count only; acceptable for Phase 1.

### Deviations from the specification

- Response envelope (approved).
- `GET /health` (engineering requirement).
- Job/domain APIs not started (correct for Phase 1).
- C1/C2/C3/C4 overrides as approved (documented).

### Next phase prerequisites

- Satisfied by Phase 2 start.

---

## PHASE 2 — Database Models and Indexes

**Status:** COMPLETE  
**Date:** 2026-10-29

### Completed functionality

- Six Mongoose models: Circle, Member, Device, ReminderItem, Completion, Job
- Unique/compound indexes with DB-level duplicate prevention
- Enum + Zod module-specific reminder data validation
- IANA timezone validation; occurrenceKey validation
- Job dedupe keys, claim/retry/lease fields, `sent` sync
- Device R4 `releaseTokenFromOtherUsers` helper
- Cascade deletion helpers (no APIs wired)
- Integration tests against MongoMemoryServer (24 total suite tests green)

### Created / modified files

| Path | Action |
|------|--------|
| `src/modules/circle/circle.model.ts` | Created |
| `src/modules/member/member.model.ts` | Created |
| `src/modules/device/device.model.ts` | Created |
| `src/modules/reminder/reminderItem.model.ts` | Created |
| `src/modules/reminder/reminderData.schemas.ts` | Created |
| `src/modules/completion/completion.model.ts` | Created |
| `src/scheduler/job.model.ts` | Created |
| `src/shared/types/domain.ts` | Created |
| `src/shared/utils/{timezone,occurrenceKey,dedupeKey}.ts` | Created |
| `src/shared/db/{cascades,ensureIndexes,models}.ts` | Created |
| `tests/helpers/mongoTest.ts` | Created |
| `tests/integration/models.test.ts` | Created |
| `docs/data-model.md` | Updated (implemented) |
| `docs/test-report.md` | Updated |
| `docs/phase-progress.md` | Updated |

### Tests executed

| Command | Result |
|---------|--------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS (24/24) |

### Security considerations

- `Member.role` / `Circle.ownerUid` are persistence fields only; no client role trust in this phase.
- C2 ownership proof still required before Phase 3 bootstrap APIs.
- No Auth/FCM/scheduler execution in Phase 2.

### Schema deviations from Spec v5

See `docs/data-model.md` — mainly job state/lease fields, circleId-prefixed dedupeKey, strict platform enum, medication status forbidden on ReminderItem.

### Remaining risks / blockers

1. **Phase 3 blocked on C2 proof choice** (P1/P2/P3).
2. Cascade helpers are not transactional unless a replica set session is added later.
3. Global FCM token uniqueness is per-circle (spec); cross-account safety depends on calling `releaseTokenFromOtherUsers` before upsert (Phase 4).

### Next phase prerequisites

- Satisfied by Phase 3 start with `C2_PROOF=P2`.

---

## PHASE 3 — Firebase Authentication & Circle Authorization

**Status:** COMPLETE  
**Date:** 2026-10-29

### Flutter / issuer audit

- No Flutter Care Circle app, Firestore create flow, or Cloud Function issuer found in this workspace or common local paths.
- Per instructions: auth/authZ foundation implemented; **circle bootstrap HTTP not activated**.

### Completed functionality

- Index repair: partial unique `uniq_circle_single_owner`; confirmed non-unique `ownerUid`; FCM unique per `(circleId, fcmToken)` only
- `requireAuth` via Firebase Admin `verifyIdToken` (DI mock for tests)
- `requireCircleMember` / `requireCircleOwner` (Mongo; ignores client `role`)
- P2 HMAC create-token sign/verify + jti replay collection
- `requireTrustedCircleBootstrap` (503 when `CIRCLE_BOOTSTRAP_ENABLED=false`)
- Persistence helper `bootstrapCircleOwnership` for race tests / future wiring (not mounted on production routes)

### Created / modified files

| Path | Notes |
|------|-------|
| `src/modules/auth/firebaseAuth.service.ts` | Token verify + bearer extract |
| `src/shared/middleware/requireAuth.ts` | Auth middleware |
| `src/shared/middleware/requireCircleAccess.ts` | Member/owner guards |
| `src/shared/middleware/requireTrustedCircleBootstrap.ts` | P2 gate |
| `src/modules/circle/ownershipProof.ts` | P2 crypto + consume |
| `src/modules/circle/ownershipProof.types.ts` | Types |
| `src/modules/circle/circleCreateTokenNonce.model.ts` | Replay store |
| `src/modules/circle/circleBootstrap.service.ts` | Gated persistence helper |
| `src/modules/member/member.model.ts` | Single-owner partial unique index |
| `src/config/env.ts` | P2 env flags |
| `src/shared/types/express.d.ts` | Request typing |
| `tests/integration/auth.authorization.test.ts` | Auth/authZ/P2 tests |
| `docs/security-decisions.md` etc. | Updated |

### Tests executed

| Command | Result |
|---------|--------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS (**42/42**) |

### Remaining blocker

**C2_P2_ISSUER_MISSING** — deploy a trusted Cloud Function (or equivalent) that mints P2 tokens; then set `CIRCLE_BOOTSTRAP_ENABLED=true` and wire device/bootstrap APIs in Phase 4.

### Next phase prerequisites

- Satisfied by Phase 4 start.

---

## PHASE 4 — Devices and Member Preferences

**Status:** COMPLETE  
**Date:** 2026-10-29

### Completed functionality

- `POST /v1/circles/:circleId/devices` — auth, validation, R4 reassignment, multi-device, idempotent upsert
- Client `role` ignored; non-members get `403 JOIN_PROOF_REQUIRED`
- New-circle path via optional `ownershipProof` when `CIRCLE_BOOTSTRAP_ENABLED=true`; default **503** without issuer
- Owner timezone update on register
- `PUT /v1/circles/:circleId/members/me/prefs`
- `removeInvalidFcmToken` (R5 helper; no logout delete API per R3)
- `removeMemberWithCleanup` (devices + member row; owner protected)

### Created / modified files

| Path | Notes |
|------|-------|
| `src/modules/device/device.{schemas,service,controller,routes}.ts` | Device API |
| `src/modules/member/member.{schemas,service,controller,routes}.ts` | Prefs + cleanup |
| `src/routes/v1.ts` | Mounts device/member routes |
| `src/app.ts` | `/v1` router |
| `tests/integration/devices.prefs.test.ts` | Phase 4 tests |
| `docs/api-contract.md`, `security-decisions.md`, `test-report.md`, `phase-progress.md` | Updated |

### Tests executed

| Command | Result |
|---------|--------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS (**54/54**) |

### Security / remaining blockers

1. P2 issuer still missing — new circle registration gated.
2. Member invite/join proof still missing — open join blocked.
3. R3 logout keeps tokens (documented Spec limitation).

### Deviations from Spec v5

- Device `role` never trusted (C2).
- Non-member register does not auto-create membership.
- New circle requires P2 proof when bootstrap enabled.

### Next phase prerequisites

- Satisfied by Phase 5 start.

---

## PHASE 5 — Reminder CRUD & Completion Management

**Status:** COMPLETE  
**Date:** 2026-10-30

### Completed functionality

- `PUT /v1/circles/:circleId/reminders/:module/:itemId` — owner-only upsert (med/appt/task)
- `DELETE /v1/circles/:circleId/reminders/:module/:itemId` — idempotent, module-scoped cleanup
- `PUT .../medication/:itemId/completion` — owner-only; schedule-validated occurrenceKey; undo
- `PUT .../appointment/:itemId/status` and `.../task/:itemId/status` — owner-only
- Preserve medication completions and appt/task status on schedule edit
- Clear unfinished jobs on edit/complete/delete; **no job planning / FCM**

### Created / modified files

| Path | Notes |
|------|-------|
| `src/modules/reminder/reminder.{schemas,service,controller,routes}.ts` | CRUD + status routes |
| `src/modules/reminder/occurrence.utils.ts` | Occurrence ↔ schedule validation |
| `src/shared/db/cascades.ts` | Module-scoped job deletes |
| `src/routes/v1.ts` | Mount reminder router |
| `tests/integration/reminders.test.ts` | Phase 5 tests |
| Docs: api-contract, requirements-coverage, test-report, phase-progress | Updated |

### Tests executed

| Command | Result |
|---------|--------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS (**72/72**) |

### Security checks

- UID from Firebase token only
- `requireCircleOwner` on all Phase 5 writes (C1)
- Path identity authoritative; body spoof fields ignored
- Completions scoped to circle + medication itemId
- Cross-circle access denied

### Known limitations (resolved in Phase 6 where noted)

1. ~~No next-occurrence job planning on upsert~~ → Phase 6.
2. No historical-notification bursts (planner only schedules future `fireAt`).
3. ~~Status → `active` does not replan~~ → Phase 6.
4. Task completion remains global (Spec v5), not per-occurrence.

---

## PHASE 6 — Production Reminder Scheduler Engine

**Status:** COMPLETE  
**Date:** 2026-10-30

### Completed functionality

- MongoDB-backed scheduler (no Redis/BullMQ): poll, atomic claim, leases, retries, backoff
- Injectable clock + Luxon local recurrence (`occurrenceKey` `YYYY-M-D-H-m`)
- Planner: medication (daily/weekdays/multi-time/startDate), appointment, task modes
- Before / due / missed jobs; incremental medication snooze with next-dose and 2h cutoffs
- Send-time eligibility + recipient resolution; `NotificationDeliveryPort` (Noop/Recording)
- Wired into Phase 5 upsert / delete / completion / status reactivation
- `PROCESS_MODE` api|worker|all; graceful worker shutdown
- Deterministic MongoMemoryServer integration suite (`tests/integration/scheduler.test.ts`)

### Phase 5 integration changes

- `reminder.service` calls `invalidateAndReplanReminder` / `cancelJobsForOccurrence`
- Delete cleanup job counts can exceed 1 because the planner creates a horizon of jobs (tests updated)
- Existing reminder HTTP APIs unchanged

### Created / modified files

| Path | Notes |
|------|-------|
| `src/scheduler/*` | clock, timeLocal, planJobs, jobInsert, replan, claimJobs, eligibility, processJob, worker, delivery, index |
| `src/modules/reminder/reminder.service.ts` | Replan / cancel integration |
| `src/server.ts`, `src/config/env.ts` | PROCESS_MODE + worker lifecycle |
| `tests/integration/scheduler.test.ts` | Phase 6 matrix |
| `tests/integration/reminders.test.ts` | Job-count assertions for planner |
| Docs: scheduler-design, requirements-coverage, test-report, phase-progress | Updated |

### Tests executed

| Command | Result |
|---------|--------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS (**93/93** after acceptance audit) |

### Security / reliability notes

- Recipients and prefs resolved at send time; path identity still from Firebase token on APIs
- At-least-once delivery semantics documented; no exactly-once FCM claim
- Logs omit PII/tokens (dedupeKey + type)

### Known limitations (partially resolved in Phase 7)

1. ~~No FCM send / templates~~ → Phase 7.
2. Eligibility→delivery race remains (at-least-once); invalid tokens cleaned on FCM classify.
3. Circle timezone change does not auto-replan all items (replan on next upsert/status).

---

## PHASE 7 — Firebase Push Notification Engine

**Status:** COMPLETE  
**Date:** 2026-10-30

### Completed functionality

- Spec §9 templates for all 11 notification types (server-owned title/body)
- Data-only FCM payloads (`android.priority=high`); no top-level `notification` key
- `FcmDeliveryPort` via Firebase Admin `messaging().sendEach`
- `delivery_attempts` ledger for partial-retry without re-sending successful tokens
- Invalid/unregistered token cleanup; config errors not treated as bad tokens
- `DELIVERY_MODE=fcm|noop` — production workers refuse noop
- `update_new` template/payload ready; trigger deferred to Phase 8
- Device checklist doc for physical Android verification

### Created / modified files

| Path | Notes |
|------|-------|
| `src/modules/notification/*` | templates, fcmClient, fcmDelivery, fcmErrors, fcmPayload, deliveryAttempt, configureDelivery |
| `src/scheduler/delivery.ts` | Extended request; production FCM flag |
| `src/scheduler/eligibility.ts` | timezone + leadTimeMinutes on request |
| `src/server.ts`, `src/config/env.ts` | Wire FCM; `DELIVERY_MODE` |
| `tests/unit/notificationTemplates.test.ts` | Template matrix |
| `tests/integration/fcmDelivery.test.ts` | Mocked FCM adapter suite |
| Docs: scheduler-design, api-contract, test-report, phase-progress, device-test-checklist, data-model | Updated |

### Tests executed

| Command | Result |
|---------|--------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS (**112/112**) |

### Real-device tests

All physical Android scenarios: **Pending** — see `docs/device-test-checklist.md`.

### Next phase prerequisites

- Satisfied by Phase 8 start.

---

## PHASE 8 — Circle Updates, Membership Removal & Cascade Deletion

**Status:** COMPLETE  
**Date:** 2026-10-30

### Completed functionality

- `POST /v1/circles/:circleId/updates` — member/owner share; C3 displayName; Idempotency-Key outbox; FCM via delivery port
- `DELETE /v1/members/me` (+ optional `?circleId=`) — leave / account cleanup; C4 409 for owners
- `DELETE /v1/members/:uid?circleId=` — owner removes member (not owner); idempotent
- `DELETE /v1/circles/:circleId` — owner cascade (jobs, delivery_attempts, update_outbox, reminders, completions, devices, members, circle)
- Optional Mongo transactions with explicit non-atomic fallback (`transactional` / `atomic` flags)

### Created / modified files

| Path | Notes |
|------|-------|
| `src/modules/update/*` | Outbox model, share service, routes |
| `src/modules/member/account.*` | Leave / account delete / owner remove |
| `src/modules/circle/circle.service.ts` | Cascade delete |
| `src/shared/db/{cascades,transactions}.ts` | Cascade + optional txn helper |
| `tests/integration/phase8.updates.deletion.test.ts` | Phase 8 suite |
| Docs: api-contract, security-decisions, data-model, test-report, phase-progress | Updated |

### Tests executed

| Command | Result |
|---------|--------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS (**124/124**) |

### Next phase prerequisites

- Satisfied by Phase 9 start.

---

## PHASE 9 — Full Integration, Security & Reliability Testing

**Status:** COMPLETE  
**Date:** 2026-10-30

### Completed work

- Requirements→test coverage matrix (`docs/integration-audit.md`)
- Release readiness with blockers (`docs/release-readiness.md`)
- Phase 9 E2E/reliability suite (`tests/integration/phase9.e2e.reliability.test.ts`)
- Worker stop lifecycle fix (no ticks after `stop()`)
- C2/P2 and join-proof classified as **release blockers** (no insecure fallback)

### Verification

| Command | Result |
|---------|--------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS (**133/133**) |

### Explicit non-claims

- Real-device FCM: NOT TESTED
- Trusted create-token issuer / invite join: BLOCKED for production onboarding (remediated in Phase 10 where access allowed)

### Next phase prerequisites

- Satisfied by Phase 10 start.

---

## PHASE 10 — Security Completion, Deployment & Flutter Integration

**Status:** COMPLETE  
**Date:** 2026-10-30

### Completed work

- Trusted issuer HTTP: `POST /v1/internal/circle-create-tokens` (API-key; fail-closed)
- Documented **BLOCKED** circleId trust prerequisite (no CF / Flutter proof source in repo)
- Secure invites: `POST .../invites`, `POST .../join`, registry + cascade invalidation
- Production Dockerfile + Compose (api / worker / mongo; mongo not public by default)
- `/health/live` + `/health/ready`; startup `ensureAllIndexes`
- Docs: `flutter-integration.md`, `production-deployment.md`, `production-checklist.md`, audits updated
- Phase 10 security/deploy tests

### Verification

| Command | Result |
|---------|--------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS (**152/152**) |
| Docker image / Compose runtime | **NOT TESTED** (Docker CLI unavailable on agent host) |
| Real-device FCM | **NOT TESTED** |

### Explicit non-claims / blockers

- Production circle onboarding without CF circleId proof: **BLOCKED**
- Real-device FCM: **NOT TESTED**
- Flutter live wiring: **NOT TESTED**
- **Not production-ready** until blockers cleared (see `docs/release-readiness.md`)

### Stop

Phase 10 complete. Do not start Phase 11 / unrelated work without explicit instruction.
