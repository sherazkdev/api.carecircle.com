# Flutter Developer Handover — Care Circle Backend

**Audience:** External Flutter app developer (production UI is **not** in this repository).  
**Backend status:** Spec v5 + approved overrides; **159** automated backend tests passing.

---

## 1. What you receive

| Artifact | Location |
|----------|----------|
| Human API contract | `docs/api-contract.md` |
| OpenAPI 3 | `docs/openapi.yaml` |
| Postman collection | `docs/postman/care-circle-api.postman_collection.json` |
| Optional Dart client + sync queue | `integration/flutter/care_circle_backend_client/` |
| Wiring guide | `integration/flutter/APP_WIRING.md` |
| Cloud Functions (circle create + bootstrap token) | `firebase/functions`, `firebase/README.md` |
| Staging E2E checklist | `docs/staging-e2e-checklist.md` |
| Device FCM checklist | `docs/device-test-checklist.md` |

You do **not** need access to this repo’s MongoDB or issuer secrets. You **do** need Firebase Auth in the app and deploy/use the provided Cloud Functions in your Firebase project.

---

## 2. Base URL and authentication

- **Base URL:** configure per environment, e.g. `--dart-define=CARE_CIRCLE_API_BASE_URL=https://staging-api.example.com`
- **Header:** `Authorization: Bearer <Firebase ID token>` on every `/v1/*` route except you never call internal routes from the app.
- Refresh the ID token before long sync batches; retry **401** once after refresh.

Success shape:

```json
{ "ok": true, "data": { } }
```

Error shape:

```json
{ "ok": false, "error": { "code": "FORBIDDEN", "message": "...", "details": { } } }
```

Common codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `SERVICE_UNAVAILABLE`.

---

## 3. Circle lifecycle (Firestore + backend)

The app owns Firestore UX/data. The server owns reminders, notifications, and membership in **MongoDB**.

### New circle (recommended)

1. User completes Firebase Auth.
2. Call Cloud Function **`createCareCircle`** (creates Firestore doc with `ownerUid`, returns `circleId`).
3. Call **`requestCircleBootstrapToken`** or use bootstrap payload from create flow (see `firebase/README.md`).
4. `POST /v1/circles/{circleId}/devices` with `ownershipProof`, `timezone`, `fcmToken`, `displayName`.
5. Upsert reminders to backend whenever Firestore schedules change (`PUT .../reminders/...`).

Until ops enable `CIRCLE_BOOTSTRAP_ENABLED=true` on the API, step 4 returns **503** — coordinate with backend operator.

### Existing Firestore circle (migration)

1. `requestCircleBootstrapToken` after verifying user is Firestore owner.
2. Device register with `ownershipProof` as above.

### Members

1. Owner: `POST /v1/circles/{circleId}/invites` → share `inviteToken` (deep link / QR — your UX).
2. Member: `POST /v1/circles/{circleId}/join` with `inviteToken`.
3. Member: `POST .../devices` with FCM token.

**Never** send `X-Issuer-Api-Key` or HMAC secrets from Flutter.

---

## 4. FCM registration and refresh

- Call `POST /v1/circles/{circleId}/devices` on app open (each active circle), on `onTokenRefresh`, and after join.
- Identity is **`fcmToken`**, not deviceId.
- Same token reassigned if another user logs in on the same phone (server R4).
- No logout token-delete API (R3).
- Register all circles the user belongs to.

Body (minimal):

```json
{
  "fcmToken": "...",
  "platform": "android",
  "displayName": "Sara",
  "timezone": "Asia/Karachi"
}
```

Field `role` is **ignored** for authorization.

---

## 5. Reminder sync contract

- **Owner only:** `PUT` / `DELETE` `/v1/circles/{circleId}/reminders/{module}/{itemId}`
- **Owner only (C1):** medication completion, appointment/task status (Spec v5 table says “member” — backend override is owner-only; members must not mark doses done in API).
- Use path `itemId` matching Firestore document id.
- Send only reminder fields from spec (not full Firestore dump).
- **Idempotent:** safe to retry PUT with same payload.
- On network failure, queue PUT/DELETE and replay (see `CareCircleSyncFacade` in integration package).

`occurrenceKey` format: local `y-m-d-h-m` without zero-padding (e.g. `2026-10-28-8-0`).

---

## 6. Notification preferences

`PUT /v1/circles/{circleId}/members/me/prefs`:

```json
{ "medication": true, "appointment": true, "task": true, "updates": true }
```

Toggles apply to **owner and members** (R19–R20).

---

## 7. Updates

`POST /v1/circles/{circleId}/updates`:

```json
{ "updateType": "general", "notes": "Text shown in app history" }
```

Server uses stored **`displayName`** for FCM (C3); do not rely on client-only sender name fields.

---

## 8. Deletion

| Action | API |
|--------|-----|
| Owner deletes circle | `DELETE /v1/circles/{circleId}` then delete Firestore |
| Owner removes member | `DELETE /v1/members/{uid}?circleId=` |
| User leaves / account delete | `DELETE /v1/members/me?confirm=true` — **409** if user still owns circles (C4) |

Prefer **backend first**, then Firestore, so notifications stop immediately.

---

## 9. FCM payload (display)

- Server sends **data-first** Android payloads with server-built `title` and `body` (see spec section 9 templates).
- `type` distinguishes before / due / missed / snooze / update.
- Map `type` to Android notification channels and tones (`reminderTone` on medication is stored for future use; default channel mapping is app responsibility).
- iOS: background delivery may be delayed; do not assume instant heads-up for all types.

Example data keys (illustrative — match live payloads in staging):

```json
{
  "type": "medication_due",
  "circleId": "...",
  "itemId": "...",
  "title": "...",
  "body": "..."
}
```

Validate against staging device checklist before release.

---

## 10. Offline and retries

- Reads are not provided by this API — Firestore remains source for UI lists.
- Writes should be queued with dedupe keys `(method, path, body hash)`; integration package implements a JSON queue store.
- Retry on **5xx** and network errors with exponential backoff.
- **409** on join/create token: do not retry same token; obtain a new invite or bootstrap proof.

---

## 11. Using the optional Dart package

Path dependency:

```yaml
dependencies:
  care_circle_backend_client:
    path: <path-to>/integration/flutter/care_circle_backend_client
```

See `integration/flutter/APP_WIRING.md` for coordinator hooks (`registerDeviceForCircle`, `syncReminderFromFirestore`, `backfillRemindersFromFirestore`, etc.).

You may implement your own HTTP layer; stay aligned with `docs/api-contract.md`.

---

## 12. Environments

| Environment | Bootstrap | Your action |
|-------------|-----------|-------------|
| Local/staging API | Operator sets flags | Use staging Firebase + staging API URL |
| Production | `CIRCLE_BOOTSTRAP_ENABLED=false` until ops enable | Do not ship app versions that require bootstrap until ops confirm |

---

## 13. Support contacts / verification

Before store release, complete jointly:

1. `docs/staging-e2e-checklist.md`
2. `docs/device-test-checklist.md`
3. Operator sign-off on `docs/production-checklist.md`

Backend audit summary: `docs/final-backend-audit.md`.
