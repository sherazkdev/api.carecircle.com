# Care Circle Backend Architecture

**Phase:** 0 (Design)  
**Stack:** Node.js + TypeScript (strict) · Express · MongoDB/Mongoose · Firebase Admin · Zod · Pino · Luxon · Vitest/Supertest · Docker

---

## 1. System context

```text
┌─────────────────┐     Firestore (app data)     ┌──────────────────┐
│  Flutter App    │◄────────────────────────────►│  Firebase        │
│                 │     Auth ID tokens / FCM     │  Auth + FCM      │
└────────┬────────┘                              └────────▲─────────┘
         │ Explicit reminder sync via HTTPS               │
         │ (no Firestore access from backend)             │
         ▼                                                │
┌─────────────────┐     Admin SDK verify + send ──────────┘
│  Care Circle    │
│  Reminders API  │◄──── MongoDB (circles, members, devices,
│  + Worker       │      reminders, completions, jobs)
└─────────────────┘
```

**Hard rule:** Backend never reads/writes Firestore. Flutter pushes reminder-related state through APIs.

---

## 2. Process model

| Process | Responsibility |
|---------|----------------|
| **API server** | HTTP APIs, auth, validation, persistence, upsert-driven job planning |
| **Scheduler worker** | Poll due jobs (~1 min), claim atomically, check status/prefs, send FCM, mark sent, enqueue next occurrence / snooze |

Initial design: **same codebase**, optionally same or separate Node process via env (`PROCESS_MODE=api|worker|all`). Job store = MongoDB. **Redis/BullMQ deferred** unless polling latency or multi-region scale proves insufficient (documented later if introduced).

---

## 3. Folder structure (target)

```text
src/
  config/                 # env (Zod), mongo, firebase, logger
  modules/
    circle/               # delete circle; circle model helpers
    member/               # prefs, leave, remove, account cleanup
    device/               # FCM registration, token reassignment
    reminder/             # medication / appointment / task upsert+delete
    completion/           # dose completion; shared status updates may live here or in reminder
    notification/         # templates, FCM sender, recipient resolution
    update/               # share update → immediate notify
  scheduler/              # job planning, poller, claim, retry, next-occurrence
  shared/
    errors/
    middleware/           # auth, validate, error handler
    utils/                # time, occurrenceKey, lead text
    types/
  app.ts
  server.ts

tests/
  unit/
  integration/
docs/
care-circle-reminders-api-spec.md
```

Controllers = HTTP only. Services = business rules. Models = persistence. Schemas = Zod contracts.

---

## 4. API inventory

| # | Method & path | Auth | AuthZ | Idempotent | Phase |
|---|---------------|------|-------|------------|-------|
| 1 | `POST /v1/circles/{circleId}/devices` | Bearer | Any authenticated; membership established/verified per trust decision | Yes (upsert) | 4 (+3 membership) |
| 2 | `PUT /v1/circles/{circleId}/members/me/prefs` | Bearer | Circle member | Yes | 4 |
| 3 | `PUT /v1/circles/{circleId}/reminders/{module}/{itemId}` | Bearer | Owner | Yes (upsert) | 5 |
| 4 | `DELETE /v1/circles/{circleId}/reminders/{module}/{itemId}` | Bearer | Owner | Yes | 5 |
| 5 | `PUT /v1/circles/{circleId}/reminders/medication/{itemId}/completion` | Bearer | **GATE C1** | Yes | 5 |
| 6 | `PUT /v1/circles/{circleId}/reminders/appointment/{itemId}/status` | Bearer | **GATE C1** | Yes | 5 |
| 7 | `PUT /v1/circles/{circleId}/reminders/task/{itemId}/status` | Bearer | **GATE C1** | Yes | 5 |
| 8 | `POST /v1/circles/{circleId}/updates` | Bearer | Circle member | Soft (may re-notify if retried — document) | 8 |
| 9a | `DELETE /v1/members/me` | Bearer | Self | Yes | 8 |
| 9b | `DELETE /v1/members/me?circleId=` | Bearer | Self leave | Yes | 8 |
| 9c | `DELETE /v1/members/{uid}?circleId=` | Bearer | Owner | Yes | 8 |
| 10 | `DELETE /v1/circles/{circleId}` | Bearer | Owner | Yes | 8 |
| — | `GET /health` | None | Public | Yes | 1 |

**Note:** 9c appears in §6.9 but not the numbered API list; treat as required.

**No** public “create circle” API. Circle creation / first-owner bootstrap requires **trusted ownership proof** (C2). Phase 3 blocked until proof mechanism (P1/P2/P3) is approved — see `security-decisions.md`.

---

## 5. Database relationship design

```text
Circle (circleId PK)
  ├── 1 ownerUid (locked after first trusted establishment)
  ├── timezone (IANA)
  │
  ├── Member* (circleId + uid unique)
  │     role: owner | member
  │     displayName, prefs{...}
  │
  ├── Device* (circleId + fcmToken unique)
  │     uid, platform, updatedAt
  │     (also query by uid; global uniqueness of fcmToken for R4)
  │
  ├── ReminderItem* (circleId + module + itemId unique)
  │     data (validated payload), status (appt/task)
  │
  ├── Completion* (circleId + itemId + occurrenceKey unique)
  │     completed, updatedBy, updatedAt
  │
  └── Job* (dedupeKey unique)
        circleId, itemId, occurrenceKey, type, fireAt,
        audience, state/sent, retries, claim metadata
```

**Referential cleanup**

| Trigger | Action |
|---------|--------|
| Delete reminder item | Delete completions for item; delete unsent jobs for item |
| Upsert reminder | Delete unsent jobs for item; replan future jobs; preserve completions / status |
| Leave / remove member | Delete that member’s devices + member row; do not delete jobs |
| Delete circle | Cascade delete members, devices, reminders, completions, jobs |
| Account delete (`/members/me`) | Remove user from all circles (or one if `circleId`); **owner case = GATE C4** |
| Invalid FCM | Delete device row(s) with that token |

---

## 6. Notification event matrix

| type | Module | When | Audience | Preconditions | Pref key |
|------|--------|------|----------|----------------|----------|
| `med_before` | medication | T − lead | Owner | reminderEnabled; not completed | medication |
| `med_due` | medication | T | Owner | reminderEnabled; not completed | medication |
| `med_missed` | medication | T (+ grace) | Family | notifyFamilyOnMiss; not completed | medication |
| `med_snooze` | medication | T + n×snooze | Owner | snoozeMinutes>0; reminderEnabled; not completed; before cutoff | medication |
| `appt_before` | appointment | T − lead | Owner | reminderEnabled; status=active | appointment |
| `appt_due` | appointment | T | Owner | reminderEnabled; status=active | appointment |
| `appt_missed` | appointment | T (+ grace) | Family | notifyFamilyOnMiss; status=active | appointment |
| `task_before` | task | T − lead | Owner | reminderEnabled; status=active | task |
| `task_due` | task | T | Owner | reminderEnabled; status=active | task |
| `task_missed` | task | T (+ grace) | Family | notifyFamilyOnMiss; status=active | task |
| `update_new` | update | Immediate | All members except sender | — | updates |

**Independence:** `reminderEnabled` and `notifyFamilyOnMiss` are independent (spec §7).

**Snooze cap:** stop at next dose time or T+2h, whichever first.

**Family definition:** all members with `role=member` (everyone except owner).

---

## 7. Authorization matrix

| Capability | Owner | Member | Non-member | Notes |
|------------|-------|--------|------------|-------|
| Register device / join path | Yes* | Yes* | *See GATE C2 | Role not trusted from client after lock |
| Update own prefs | Yes | Yes | 403 | |
| Upsert/delete reminder | Yes | 403 | 403 | |
| Mark medication completion | Yes | 403 | 403 | **C1 approved:** owner-only |
| Set appointment/task status | Yes | 403 | 403 | **C1 approved:** owner-only |
| Share update | Yes | Yes | 403 | |
| Leave circle / delete self | Yes† | Yes | 403 | †Owner leave = GATE C4 |
| Remove other member | Yes | 403 | 403 | |
| Delete circle | Yes | 403 | 403 | |

`uid` always from verified Firebase token. Path `{uid}` on owner-remove must not equal trusting client-supplied roles.

---

## 8. Scheduler architecture (summary)

See `scheduler-design.md` for full design.

- MongoDB `jobs` collection is the queue.
- Planner writes **next** occurrence jobs only (plus lead/snooze variants as separate typed jobs).
- Worker polls `fireAt <= now` and claimable state with **atomic claim** (`findOneAndUpdate`).
- At execution: load item + completion/status + recipients; skip send if ineligible; still advance/mark appropriately to avoid poison loops.
- Dedupe: unique `dedupeKey = {itemId}-{occurrenceKey}-{type}`.
- Retries: temporary FCM errors → backoff, limited attempts; permanent invalid token → delete device.
- **Guarantee:** at-least-once job processing with dedupe of *pending* jobs; **not** exactly-once FCM delivery.

Prefer Mongo-backed jobs over Redis for Phase 1–9 unless load requires it.

---

## 9. Implementation dependency graph

```text
Phase 0  Audit/architecture ───────────────────────────── [YOU ARE HERE]
    │
Phase 1  Foundation (Express, env, Mongo, Firebase, health, logging)
    │
Phase 2  Models + indexes
    │
Phase 3  Auth middleware + membership/owner guards ── requires GATE C2
    │
Phase 4  Devices + prefs (R1–R5 partial until send)
    │
Phase 5  Reminder CRUD + completion/status ── requires GATE C1
    │
Phase 6  Scheduling engine (plan/claim/retry/DST)
    │
Phase 7  FCM engine + 11 templates ── iOS GATE O9
    │
Phase 8  Updates + deletion ── requires GATE C3, C4
    │
Phase 9  Full integration tests + test report
    │
Phase 10 Deployment + Flutter integration contract
```

---

## 10. Existing repo snapshot (Phase 0 inspect)

| Item | State |
|------|-------|
| `package.json` | Partial deps present (express, mongoose, firebase-admin, zod, pino, luxon, vitest, …); scripts incomplete |
| `src/app.ts`, `src/server.ts` | Empty placeholders |
| `tsconfig.json` | Strict-ish defaults; needs Phase 1 alignment (`types: node`, outDir, etc.) |
| `.env` / `.env.example` | Empty |
| Spec file | Copied to repo root from Downloads during Phase 0 |
| Implementation | **None** — Phase 0 only |

---

## 11. Delivery guarantees (documented early)

| Concern | Guarantee |
|---------|-----------|
| Duplicate pending jobs | Prevented via unique `dedupeKey` |
| Concurrent workers | Prevented via atomic claim |
| FCM delivery | **At-least-once attempt** after successful claim; crash between FCM success and DB mark may retry → possible duplicate push |
| Client display | Flutter should treat notifications as best-effort and be idempotent where possible |
