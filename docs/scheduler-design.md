# Scheduler Design

**Phase:** 7 — Scheduler + FCM delivery.  
**Queue:** MongoDB `jobs` collection (no Redis/BullMQ).  
**Delivery ledger:** `delivery_attempts` (per jobId + token hash) for partial-retry safety.

---

## Goals

1. Fire notifications at correct local times using circle IANA timezone (Luxon).
2. Support recurring medication/task schedules and one-shot appointments.
3. Deduplicate pending jobs; atomically claim work across workers.
4. Re-check completion/status and prefs **at send time** (R32).
5. Support medication snooze with next-dose / 2-hour cutoff.
6. Survive worker crashes with retry metadata and lease reclaim.
7. Never send historical notifications for past `fireAt` created during upsert.

---

## Architecture (Phase 6)

| Component | Path | Role |
|-----------|------|------|
| Clock | `src/scheduler/clock.ts` | Injectable `SystemClock` / `FakeClock` |
| Local time | `src/scheduler/timeLocal.ts` | occurrenceKey, DST policies, next occurrence |
| Planner | `src/scheduler/planJobs.ts` | Next-horizon before/due/missed (+ snooze helper) |
| Insert | `src/scheduler/jobInsert.ts` | Idempotent insert by unique `dedupeKey` |
| Replan | `src/scheduler/replan.ts` | Invalidate unfinished + plan; occurrence cancel |
| Claim | `src/scheduler/claimJobs.ts` | Atomic claim, lease, retry/fail |
| Eligibility | `src/scheduler/eligibility.ts` | Send-time gates + recipient resolution |
| Process | `src/scheduler/processJob.ts` | Claimed → deliver port → advance horizon |
| Worker | `src/scheduler/worker.ts` | ~1 min poll; graceful stop |
| Delivery port | `src/scheduler/delivery.ts` | Port interface; Noop / Recording (tests) |
| FCM adapter | `src/modules/notification/fcmDelivery.ts` | Production `sendEach`; templates + ledger |
| Configure | `src/modules/notification/configureDelivery.ts` | `DELIVERY_MODE=fcm` default; noop forbidden in prod workers |

`PROCESS_MODE=api|worker|all` controls whether the process listens HTTP and/or runs the worker (`src/server.ts`).

Integration: Phase 5 `reminder.service` calls `invalidateAndReplanReminder` on upsert/status→active, and `cancelJobsForOccurrence` on medication complete.

---

## Job lifecycle

```text
[plan] pending ──poll──► claimed ──deliver ok──► sent ──► plan next occurrence / next snooze
                │              └──temp fail──► pending (attempts++, nextAttemptAt, backoff)
                │              └──permanent──► failed
                └──ineligible at send──► skipped (+ may still advance recurring stream)
```

States: `pending` | `claimed` | `sent` | `skipped` | `failed`. Spec `sent` boolean synced on success.

---

## Planning rules

### On reminder upsert / reactivate

1. Delete unfinished jobs for `(circleId, module, itemId)` (pending/claimed/failed; sent retained).
2. Compute **next** occurrence(s) from injectable “now” in circle TZ:
   - Medication: each `times[]` stream on allowed days ≥ `startDate`.
   - Appointment: single `startsAt` if still future-eligible.
   - Task: from `date`+`time` per `repeatMode`.
3. For each next T (future only relative to now):
   - If `T − leadTime > now` → `*_before` (owner audience).
   - `*_due` at T (owner).
   - `*_missed` at T + `MISS_GRACE_MINUTES` (family; C5 grace default 0 → at T).
4. Do **not** enqueue snooze until after a successful (or flag-skipped) `med_due` path schedules the first snooze.

Only the next relevant occurrence per time slot — never an unbounded future series.

### After `med_due`

If incomplete, `snoozeMinutes > 0`, and `reminderEnabled` → insert first `med_snooze` at T + snoozeMinutes. Each snooze success schedules the next incrementally until cutoffs.

Also plan the **next** medication occurrence for that time stream.

### Snooze cutoffs (owner only)

Stop when any of:

- Occurrence completed
- `reminderEnabled` becomes false (send-time / planning)
- Next scheduled dose for that item
- T + 2 hours

Never family snooze.

### On delete / status completed / occurrence complete

Remove or skip unfinished jobs for the scope; undo of medication does **not** replay past fireAt — only future-eligible events are replanned.

---

## Polling & claiming

- Interval: ~60s (`SCHEDULER_POLL_MS`, default 60000).
- Claim filter: pending with `fireAt <= now` and ready `nextAttemptAt`, **or** claimed with `leaseExpiresAt <= now`.
- Atomic `findOneAndUpdate` + sort by `fireAt`.
- Lease default 60s (`SCHEDULER_LEASE_MS`).
- Max attempts default 3 (`SCHEDULER_MAX_ATTEMPTS`); exponential backoff capped at 60s.

---

## Deduplication vs FCM exactly-once

| Mechanism | Prevents |
|-----------|----------|
| Unique `dedupeKey` | Two pending jobs for same item/occurrence/type (+ snooze index suffix) |
| Atomic claim | Two workers processing same job document |
| Send-time eligibility | Notifying after completion / prefs off / missing membership |

| Not prevented |
|---------------|
| Crash after external deliver success before DB `sent` → retry may duplicate push |
| Client double-tap without shared idempotency (updates Phase 8) |

**Guarantee:** at-least-once processing. **Not** exactly-once FCM.

### Eligibility → delivery race

Eligibility resolves recipients and tokens, then the delivery port sends. Between check and FCM (Phase 7), a user may leave the circle, toggle prefs, complete a dose, or invalidate a token. Phase 7 should treat invalid-token cleanup as best-effort; skipped/failed outcomes remain acceptable. Do not claim stronger consistency than this window.

---

## Timezone & DST

- Store `fireAt` as UTC `Date`.
- Wall times via Luxon `DateTime.fromObject(..., { zone: circle.timezone })`.
- **Spring-forward (nonexistent local time):** schedule at the **next valid local minute** after the gap (`resolveLocalDateTime`).
- **Fall-back (ambiguous local time):** use the **earlier offset** (Luxon `fromObject` default).
- **occurrenceKey:** circle-local `YYYY-M-D-H-m` (no zero-padding); never UTC calendar for recurrence keys.
- Weekdays: Spec Sunday = 0 (`luxonWeekdayToSpec`).
- Covered zones in tests: `Asia/Karachi`, `UTC`, `America/New_York`.

---

## Notification eligibility (planning vs send)

Flags are independent:

| Event | Owner (`reminderEnabled`) | Family (`notifyFamilyOnMiss`) |
|-------|---------------------------|-------------------------------|
| before / due / snooze | required | n/a |
| missed | n/a | required |

Send-time checks: circle exists; reminder exists; occurrence still applicable; med not completed; appt/task active; recipient still member; module pref on; device token present; job not superseded.

Recipients are resolved at **execution**, not planning.

---

## Observability

Structured logs on claim / skip / deliver / temporary / permanent failure include `dedupeKey` and `type` only — no titles, names, or tokens.

---

## Why not Redis/BullMQ

Minute-granularity polling + Mongo unique indexes + claim/lease fields match Spec MVP. Revisit if volume or latency demands change.

---

## Phase 7 FCM (implemented)

- **API:** `getMessaging().sendEach(messages)` — data-only; `android.priority = 'high'`; no top-level `notification`.
- **Templates:** Spec §9 via `renderNotificationTemplate` (circle TZ 12-hour times, lead formatting, notes truncate).
- **Success:** `{ ok: true, pushed: true }` only if ≥1 device accepted by FCM (including prior ledger successes).
- **Noop:** `{ ok: true, pushed: false }` → job `skipped`, never `sent`.
- **Partial retry:** skip `delivery_attempts` rows with `status=sent` for the same `jobId`+token hash.
- **Invalid tokens:** classified and deleted via `removeInvalidFcmToken`; config errors are temporary and do not delete tokens.
- **Tone:** string from reminder config (default `gentle_chime`); Flutter owns channels/sounds.
- **Flutter:** expects data payload fields for `flutter_local_notifications` rendering.
- **update_new:** template + payload supported; HTTP trigger is Phase 8.
