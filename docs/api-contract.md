# API Contract (from Spec v5 + approved overrides)

**Phase:** Final backend audit (2026-10-30)  
**Machine-readable:** `docs/openapi.yaml`, `docs/postman/care-circle-api.postman_collection.json`  
**Auth header:** `Authorization: Bearer <Firebase ID token>` (except internal issuer)  
**Base path:** `/v1`  
**Health:** `/health/live` · `/health/ready` · `/health`  
**Common codes:** `200` OK · `400` validation · `401` invalid/missing/expired token · `403` not permitted / not a member / join proof required · `404` circle or item missing · `409` conflict (e.g. replayed create/invite token, owner account delete) · `503` dependency unavailable / bootstrap not activated

### AuthZ middleware (Phase 3)

| Middleware | Behavior |
|------------|----------|
| `requireAuth` | Verifies Firebase ID token; sets `req.auth.uid` from token only |
| `requireCircleMember` | Mongo membership for `:circleId`; 403 if not a member |
| `requireCircleOwner` | Requires `circles.ownerUid === auth.uid` (C1); ignores body `role` |
| `requireTrustedCircleBootstrap` | Verifies P2 create token; **503** while `CIRCLE_BOOTSTRAP_ENABLED=false` |
| Issuer API key | `X-Issuer-Api-Key` on `/v1/internal/*` only — never Flutter |

### P2 create token (when bootstrap is enabled)

- Header `X-Circle-Create-Token` or body `ownershipProof`
- Bound to authenticated uid + path `circleId`
- Short-lived HMAC token issued only by a trusted Cloud Function / `POST /v1/internal/circle-create-tokens` (not Flutter)
- Replay → `409`

### Health

| Path | Meaning |
|------|---------|
| `GET /health/live` | Process up (no dependency checks) |
| `GET /health/ready` | Mongo connected **and** Firebase Admin initialized |
| `GET /health` | Same gates as ready; `status: ok\|degraded` (legacy) |

### Approved response envelope (overrides Spec silence)

Success:

```json
{ "ok": true, "data": { } }
```

Error:

```json
{ "ok": false, "error": { "code": "FORBIDDEN", "message": "..." } }
```

### Spec v5 overrides (approved 2026-10-29)

| Area | Spec v5 | Approved contract |
|------|---------|-------------------|
| APIs 5–7 roles | “Sab” / Member Yes | **Owner only** (C1) |
| Device `role` | Client-supplied | **Never trusted**; ownership needs proof (C2) — Phase 3 gated |
| Update `senderName` | Used in notification | **Ignored**; use stored `displayName` (C3) |
| Owner `DELETE /members/me` | Remove from circles | **409** if still owns active circles (C4) |

Conventions:

- `module`: `medication` | `appointment` | `task`
- Times: 24h `"HH:mm"`; datetimes ISO-8601 with offset
- `repeatDays`: `0=Sunday … 6=Saturday`
- `occurrenceKey`: local `y-m-d-h-m` **without** zero-padding (e.g. `2026-10-28-8-0`)
- `leadTimeMinutes`: `5|10|15|30|60`
- `snoozeMinutes`: `0|5|10|15`
- Circle timezone: IANA string from owner registration

---

## 1. `POST /v1/circles/{circleId}/devices` — **Implemented (Phase 4)**

**Role:** Authenticated  
**Idempotent:** Yes — upsert on `(circleId, fcmToken)`

```json
{
  "fcmToken": "eXyz...",
  "platform": "android",
  "role": "member",
  "displayName": "Sara Miller",
  "timezone": "Asia/Karachi",
  "ownershipProof": "<optional P2 token>"
}
```

Behavior (approved C2 overrides Spec role trust):

- **`role` is ignored** for authorization.
- **R4:** reassign `fcmToken` from any other uid (all circles), then upsert for caller.
- **Existing circle + existing member/owner:** upsert device; update `displayName`; owner may update `timezone`.
- **Existing circle + non-member:** `403` with `details.reason = JOIN_PROOF_REQUIRED` — call **`POST /join`** first.
- **Missing circle:** requires `ownershipProof` + `timezone` and `CIRCLE_BOOTSTRAP_ENABLED=true`; otherwise `503` `C2_P2_ISSUER_MISSING`.
- **R3:** no logout token-delete API.
- **R5:** `removeInvalidFcmToken(fcmToken)` service helper (used by Phase 7; not a public logout route).

Triggers: app open per circle, token refresh, after invite join.

---

## 1b. `POST /v1/circles/{circleId}/invites` — **Implemented (Phase 10)**

**Role:** Circle owner (`requireCircleOwner`)

```json
{ "ttlSeconds": 86400 }
```

Response `data`: `{ inviteToken, circleId, expiresInSeconds }`.

- HMAC invite (`typ: circle_invite`) bound to `circleId` + inviter uid
- Registered in `circle_invites` (revoked on circle delete / consume / TTL)
- Does **not** grant owner; join always creates `role: member`
- Requires `CIRCLE_CREATE_TOKEN_SECRET`

---

## 1c. `POST /v1/circles/{circleId}/join` — **Implemented (Phase 10)**

**Role:** Authenticated (any Firebase user)

```json
{ "inviteToken": "<token>", "displayName": "Sara Miller" }
```

- Joining identity = `auth.uid` only
- Validates signature, circle match, expiry; consumes invite (replay → `409`)
- Idempotent if already a member (`created: false`; prefs preserved)
- Never elevates to owner
- After join, client must still `POST .../devices` to register FCM
- Rate limit: **20 requests / minute / authenticated uid** on join

---

## 1d. `POST /v1/internal/circle-create-tokens` — **Implemented (Phase 10)**

**Auth:** `X-Issuer-Api-Key` (trusted server only). **Not for Flutter.**

```json
{ "circleId": "...", "ownerUid": "...", "timezone": "Asia/Karachi", "ttlSeconds": 300 }
```

- Enabled only when `CIRCLE_TOKEN_ISSUER_ENABLED=true` (+ secret + API key)
- Rate limit: **30 requests / minute / client IP** → `503 SERVICE_UNAVAILABLE` with `Retry-After`
- Does **not** prove circleId provenance by itself — caller (Cloud Function) must
- Production circle onboarding remains **BLOCKED** until that CF trust root exists

---

## 2. `PUT /v1/circles/{circleId}/members/me/prefs` — **Implemented (Phase 4)**

**Role:** Circle member (`requireCircleMember`)

```json
{ "medication": true, "appointment": true, "task": true, "updates": true }
```

---

## 3. `PUT /v1/circles/{circleId}/reminders/{module}/{itemId}` — **Implemented (Phase 5)**

**Role:** Owner (`requireCircleOwner`)  
**Idempotent:** Yes — unique `(circleId, module, itemId)`

Preserve existing medication completions and appointment/task `status` on edit.  
Phase 5 clears unfinished jobs for the item/module on edit but **does not** plan new notification jobs (Phase 6).  
Path params are authoritative; body `circleId` / `module` / `itemId` / `status` are ignored.

### Medication body

```json
{
  "id": "",
  "title": "Paracetamol",
  "scheduleMode": "specificDays",
  "repeatDays": [1, 3, 5],
  "times": ["08:00", "20:30"],
  "startDate": "2026-10-28",
  "reminderEnabled": true,
  "notifyFamilyOnMiss": true,
  "leadTimeMinutes": 10,
  "snoozeMinutes": 5,
  "reminderTone": "gentle_chime"
}
```

- `scheduleMode`: `daily` (ignore `repeatDays`) | `specificDays`
- No fires before `startDate`

### Appointment body

```json
{
  "id": "",
  "title": "Cardiology checkup",
  "startsAt": "2026-11-02T10:30:00+05:00",
  "reminderEnabled": true,
  "notifyFamilyOnMiss": true,
  "leadTimeMinutes": 30,
  "reminderTone": "gentle_chime"
}
```

### Task body

```json
{
  "id": "",
  "title": "Refill pillbox",
  "repeatMode": "custom",
  "repeatDays": [0, 6],
  "date": "2026-11-02",
  "time": "09:00",
  "reminderEnabled": true,
  "notifyFamilyOnMiss": true,
  "leadTimeMinutes": 15,
  "reminderTone": "gentle_chime"
}
```

- `repeatMode`: `doesNotRepeat` | `daily` | `custom`

---

## 4. `DELETE /v1/circles/{circleId}/reminders/{module}/{itemId}` — **Implemented (Phase 5)**

**Role:** Owner  
Idempotent. Deletes reminder item; medication completions only when `module=medication`; jobs scoped by `(circleId, itemId, module)` so shared itemIds across modules are safe.

---

## 5. `PUT /v1/circles/{circleId}/reminders/medication/{itemId}/completion` — **Implemented (Phase 5)**

**Role:** **Owner only** (C1)  
Body:

```json
{ "occurrenceKey": "2026-10-28-8-0", "completed": true }
```

`completed: false` = undo. Upsert into `completions`.  
Occurrence must match the medication schedule (valid calendar date, `startDate`, `times[]`, `repeatDays` when `specificDays`). No notifications in this phase.

---

## 6–7. Status APIs — **Implemented (Phase 5)**

`PUT .../appointment/{itemId}/status`  
`PUT .../task/{itemId}/status`

**Role:** **Owner only** (C1)

```json
{ "status": "completed" }
```

`active` | `completed`.  
Task `completed` is **global** (all future occurrences) per Spec v5 — not per-occurrence.  
Completed clears unfinished jobs for that module/item; Active does not replan until Phase 6.

---

## 8. `POST /v1/circles/{circleId}/updates` — **Implemented (Phase 8)**

**Role:** Circle member including owner (`requireCircleMember`)

```json
{
  "updateType": "health",
  "senderName": "Sara Miller",
  "notes": "Mom is feeling better today and took her evening medicine."
}
```

- Sender `uid` from Firebase token; **C3:** `senderDisplayName` from stored `Member.displayName` (client `senderName` ignored for identity).
- Recipients: all other members (owner included) with `prefs.updates`, multi-device, token-deduped.
- Template `update_new` + FCM delivery port.
- Header `Idempotency-Key` (recommended): durable `update_outbox` row; retries reuse the same `updateId` / delivery ledger.
- Response `delivery.pushed` is **true only** when FCM accepted ≥1 device — never merely because send was attempted.
- Temporary FCM failure → `delivery.status=failed_temp`, `pushed=false`; retry with same key resumes without a new outbox event.

---

## 9. Member deletion — **Implemented (Phase 8)**

| Endpoint | Who | Effect |
|----------|-----|--------|
| `DELETE /v1/members/me` | Self | Remove from **all** circles; **409** if owns any circle (C4) |
| `DELETE /v1/members/me?circleId=` | Self | Leave one circle; **409** if owner of that circle (C4) |
| `DELETE /v1/members/{uid}?circleId=` | Owner of that circle | Remove that member; cannot remove owner; idempotent |

Deletes that user’s membership + devices in scope only. Jobs untouched; eligibility skips removed members at send time.  
**Auth order:** call this API **before** Firebase Auth account deletion.

---

## 10. `DELETE /v1/circles/{circleId}` — **Implemented (Phase 8)**

**Role:** Owner (`circles.ownerUid === auth.uid`). Idempotent (`deleted: false` if already gone).

Cascade (scoped by `circleId`): circle, members, devices, reminders, completions, jobs (including claimed), `delivery_attempts`, `update_outbox`.

Response includes `transactional: boolean` — `true` when a MongoDB multi-doc transaction committed; `false` when the deployment fell back to ordered non-atomic deletes (never silently claimed atomic).

---

## FCM delivery (Phase 7 — not an HTTP API)

Worker uses Firebase Admin `messaging().sendEach` with **data-only** payloads.

Reminder `data` keys (all strings): `type`, `module`, `circleId`, `itemId`, `occurrenceKey`, `scheduledAt`, `title`, `body`, `tone`.

Update `data` keys: `type`, `module`, `circleId`, `updateType`, `title`, `body`, `tone`.

- `android.priority = "high"`
- No top-level FCM `notification` object (Flutter local-notification contract)
- Titles/bodies from Spec §9 templates only — never client-supplied copy
- Env: `DELIVERY_MODE=fcm` (default). `noop` forbidden for production workers.

`update_new` is triggered by `POST /v1/circles/:circleId/updates` (Phase 8).

---

## Health (Phase 1)

`GET /health` → process liveness + Mongo connectivity + Firebase init status.

Example:

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "mongo": "up",
    "firebase": "up",
    "uptimeSeconds": 12
  }
}
```

If Mongo is down, HTTP `503` with `ok: false`.
