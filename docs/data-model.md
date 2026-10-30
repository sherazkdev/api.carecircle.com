# Data Model Design

**Phase:** 8 (Phase 2–7 models + `update_outbox`)  
**Database:** MongoDB via Mongoose  
**Source:** Spec v5 §4 + approved operational extensions (`security-decisions.md`)

---

## Collections overview

| Collection | Model file | Unique keys |
|------------|------------|-------------|
| `circles` | `src/modules/circle/circle.model.ts` | `circleId` |
| `members` | `src/modules/member/member.model.ts` | `(circleId, uid)` |
| `devices` | `src/modules/device/device.model.ts` | `(circleId, fcmToken)` |
| `reminder_items` | `src/modules/reminder/reminderItem.model.ts` | `(circleId, module, itemId)` |
| `completions` | `src/modules/completion/completion.model.ts` | `(circleId, itemId, occurrenceKey)` |
| `jobs` | `src/scheduler/job.model.ts` | `dedupeKey` |
| `delivery_attempts` | `src/modules/notification/deliveryAttempt.model.ts` | `(jobId, tokenHash)` |
| `update_outbox` | `src/modules/update/updateOutbox.model.ts` | `updateId`; `(circleId, idempotencyKey)` |

Shared helpers: `src/shared/db/cascades.ts`, `src/shared/db/ensureIndexes.ts`, `src/shared/db/models.ts`.

Module-specific reminder payload validation: `src/modules/reminder/reminderData.schemas.ts` (Zod).

---

## 1. Circle

| Field | Type | Notes |
|-------|------|-------|
| `circleId` | string | External PK (Firestore/app id) |
| `ownerUid` | string | **Server-authoritative** (C2). Not derived from client `role`. |
| `timezone` | string | IANA; validated via Luxon `IANAZone.isValidZone` |
| `createdAt` / `updatedAt` | Date | timestamps |

**Indexes:** `uniq_circleId`; `idx_ownerUid` (**non-unique** — a user may own multiple circles)

---

## 2. Member

| Field | Type | Notes |
|-------|------|-------|
| `circleId` | string | |
| `uid` | string | Firebase uid |
| `role` | `owner` \| `member` | Stored server-side only; never trust client body for privilege |
| `displayName` | string | Used for update notifications (C3) |
| `prefs.*` | boolean | medication, appointment, task, updates — default `true` |
| timestamps | Date | |

**Indexes:**

- `uniq_circle_uid` — `(circleId, uid)` unique
- `idx_circle_role` — `(circleId, role)` **non-unique** (many ordinary members)
- `uniq_circle_single_owner` — partial unique on `circleId` where `role: 'owner'` (**at most one owner**)
- `idx_uid`

---

## 3. Device

| Field | Type | Notes |
|-------|------|-------|
| `circleId` | string | |
| `uid` | string | |
| `fcmToken` | string | Device identity (R2) |
| `platform` | `android` \| `ios` | Enum |
| `updatedAt` | Date | |

**Indexes:** `uniq_circle_fcmToken`, `idx_circle_uid`, `idx_fcmToken` (global lookup for R4; **not** globally unique)

**Multi-circle behavior:** the same `fcmToken` may exist once per `circleId` for the same uid (app open registers per circle). Global uniqueness would break that Spec R1 behavior.

**R4 helper:** `Device.releaseTokenFromOtherUsers(fcmToken, newUid)` deletes rows where `uid !== newUid` for that token (all circles), then caller upserts.

---

## 4. ReminderItem

| Field | Type | Notes |
|-------|------|-------|
| `circleId` | string | |
| `module` | `medication` \| `appointment` \| `task` | |
| `itemId` | string | Client id |
| `data` | Mixed (Zod-validated) | Module-specific upsert payload |
| `status` | `active` \| `completed` | **Required** for appointment/task; **forbidden** for medication |
| timestamps | Date | |

**Indexes:** `uniq_circle_module_itemId`, `idx_circle_module_status`

**Medication `data`:** title, scheduleMode (`daily`\|`specificDays`), repeatDays, times[], startDate, reminderEnabled, notifyFamilyOnMiss, leadTimeMinutes, snoozeMinutes, reminderTone  

**Appointment `data`:** title, startsAt (ISO with offset), toggles + lead + tone  

**Task `data`:** title, repeatMode (`doesNotRepeat`\|`daily`\|`custom`), repeatDays, date, time, toggles + lead + tone  

Completions stay in the `completions` collection — editing a medication reminder must not wipe them (service rule; model keeps collections separate).

---

## 5. Completion (medication only)

| Field | Type | Notes |
|-------|------|-------|
| `circleId` | string | |
| `itemId` | string | |
| `occurrenceKey` | string | `y-m-d-h-m` unpadded |
| `completed` | boolean | |
| `updatedBy` | string | |
| `updatedAt` | Date | |

**Indexes:** `uniq_circle_item_occurrence` — enables idempotent upserts

---

## 6. Job

| Field | Type | Notes |
|-------|------|-------|
| `circleId`, `itemId`, `module` | string | module includes `update` for update fan-out jobs |
| `occurrenceKey` | string | occurrence format; non-empty for `update_new` |
| `type` | 11 notification types | Spec §7/§9 |
| `fireAt` | Date | UTC |
| `audience` | `owner` \| `family` \| `members_except_sender` | |
| `dedupeKey` | string | `{circleId}:{itemId}:{occurrenceKey}:{type}` |
| `state` | `pending`\|`claimed`\|`sent`\|`skipped`\|`failed` | Claim/retry machine |
| `sent` | boolean | Spec field; synced to `state === 'sent'` |
| `attempts` | number ≥ 0 | |
| `nextAttemptAt` | Date? | Backoff |
| `claimedBy` / `claimedAt` | string?/Date? | Required when `state=claimed` |
| `leaseExpiresAt` | Date? | Stale-claim recovery (**operational extension**) |
| `lastError` | string? | |
| `payloadHints` | Mixed? | e.g. update notes snapshot |
| timestamps | Date | |

**Indexes:** `uniq_dedupeKey`, `idx_poll_due` (`state, fireAt, nextAttemptAt`), `idx_sent_fireAt`, `idx_circle_item_state`, sparse `idx_claimedAt`, sparse `idx_leaseExpiresAt`

---

## Cascading deletion (helpers implemented)

| Helper | Effect |
|--------|--------|
| `deleteReminderCascade` | Jobs + (med) completions + reminder item |
| `deleteUnfinishedJobsForItem` | pending/claimed/failed jobs only (upsert replan) |
| `removeMemberFromCircle` | Member + that user’s devices in circle |
| `deleteCircleCascade` | All child collections + circle |

Owner account-delete **409** policy (C4) is enforced in Phase 8 services, not at the schema layer.

---

## 7. CircleCreateTokenNonce (P2 replay store)

| Field | Type | Notes |
|-------|------|-------|
| `jti` | string | Unique token id |
| `circleId` / `ownerUid` | string | Audit |
| `expiresAt` | Date | TTL index (`expireAfterSeconds: 0`) |

**Indexes:** `uniq_create_token_jti`, `ttl_create_token_expiresAt`

---

## 8. UpdateOutbox (Phase 8)

| Field | Type | Notes |
|-------|------|-------|
| `updateId` | string | Unique; used as FCM delivery `jobId` |
| `circleId` | string | |
| `idempotencyKey` | string | From `Idempotency-Key` header (or generated UUID) |
| `senderUid` / `senderDisplayName` | string | Display name snapshotted from Member (C3) |
| `updateType` / `notes` | string | |
| `deliveryStatus` | enum | `pending` \| `sent` \| `failed_temp` \| `failed_perm` \| `no_recipients` |
| `recipientDeviceCount` | number | |
| `lastError` | string? | |

**Indexes:** `uniq_circle_update_idempotency` on `(circleId, idempotencyKey)`; unique `updateId`

---

## 9. DeliveryAttempt (Phase 7 partial-retry ledger)

| Field | Type | Notes |
|-------|------|-------|
| `jobId` | string | Job `_id` |
| `circleId` | string | |
| `tokenHash` | string | SHA-256 hex of FCM token (raw token never logged) |
| `uid` | string | |
| `status` | `sent` \| `failed_temp` \| `failed_perm` | |
| `fcmMessageId` | string? | FCM accept id |
| `errorCode` | string? | Firebase error code when failed |
| timestamps | Date | |

**Indexes:** `uniq_job_token_hash` on `(jobId, tokenHash)`

On job retry, tokens with `status=sent` for that `jobId` are skipped so partial successes are not re-pushed.

---

## Spec v5 deviations / extensions (documented)

1. Job `state` + claim/lease fields beyond boolean `sent` (needed for atomic workers).
2. `dedupeKey` prefixed with `circleId`.
3. `leaseExpiresAt` for worker lease expiry.
4. `module: 'update'` allowed on jobs for update notifications.
5. Platform enum restricted to `android` \| `ios` (stricter than free-form string).
6. Medication must not store `status` on `ReminderItem` (completions collection only).
7. Partial unique owner index + P2 nonce collection (security).
8. `delivery_attempts` collection for per-device FCM outcome ledger (Phase 7).

---

## Index sync

Call `ensureAllIndexes()` after connect (tests and production `server.ts` startup both do this).

### `circle_invites` (Phase 10)

Pending invite registry (`jti` unique, TTL on `expiresAt`, index on `circleId`). Rows are removed on accept, expiry, or circle cascade delete so unused HMAC invites cannot survive circle recreation.
