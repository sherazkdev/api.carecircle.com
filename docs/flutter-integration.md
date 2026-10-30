# Flutter Integration Contract — Care Circle Backend

**Phase:** 10  
**Assumption:** Flutter app is **not** assumed integrated. Do not change Flutter UI without product permission.  
**Backend independence:** API does not read/write Firestore.

---

## Status legend (Phase 10)

| Area | Status |
|------|--------|
| Auth, devices, reminders, completions, updates, prefs, deletion APIs | **IMPLEMENTED** + automation verified |
| Invite create / join | **IMPLEMENTED** — Flutter must call new endpoints |
| P2 create-token verifier + internal issuer HTTP | **IMPLEMENTED** |
| Trusted Cloud Function that proves `circleId` ownership before mint | **IMPLEMENTED** (deploy **NOT TESTED**) |
| End-to-end Flutter ↔ backend onboarding | **NOT TESTED** |
| Real-device FCM | **NOT TESTED** (see `docs/device-test-checklist.md`) |

---

## 1. Firebase ID token attachment

Every protected `/v1/**` call:

```http
Authorization: Bearer <Firebase ID token>
Content-Type: application/json
```

- Refresh tokens before expiry; retry once on `401`.
- Never send client `uid` / `role` for authorization (ignored or rejected).

---

## 2. FCM registration and refresh

`POST /v1/circles/{circleId}/devices`

```json
{
  "fcmToken": "<current FCM token>",
  "platform": "android",
  "displayName": "<user display name>",
  "timezone": "Asia/Karachi",
  "ownershipProof": "<P2 token only when creating a new circle>"
}
```

Call on: first open per circle, token refresh (`onTokenRefresh`), after invite join.  
Server reassigns tokens across users (R4). No logout delete API (R3).

---

## 3. Circle creation and owner proof (C2 / P2)

**BLOCKED for production until a trusted issuer proves circleId.**

Required flow:

1. Trusted **Cloud Function** (or equivalent) authenticates the user, creates/attests the circle in your existing system (e.g. Firestore), and obtains a definitive `circleId` + `ownerUid`.
2. CF calls `POST /v1/internal/circle-create-tokens` with `X-Issuer-Api-Key` **or** signs the same HMAC locally with `CIRCLE_CREATE_TOKEN_SECRET`.
3. Flutter receives the short-lived token (never the API key / HMAC secret).
4. With `CIRCLE_BOOTSTRAP_ENABLED=true`, Flutter registers:

```http
POST /v1/circles/{circleId}/devices
Authorization: Bearer <ID token>
{ "fcmToken", "platform", "displayName", "timezone", "ownershipProof": "<token>" }
```

Without step 1, do **not** enable bootstrap or expose unrestricted issuance to the app.

---

## 4. Member invitation acceptance

**Owner** creates invite:

```http
POST /v1/circles/{circleId}/invites
{ "ttlSeconds": 86400 }
→ { inviteToken, circleId, expiresInSeconds }
```

Share `inviteToken` out-of-band (link/QR). Invite never grants owner.

**Invitee** accepts (authenticated as themselves):

```http
POST /v1/circles/{circleId}/join
{ "inviteToken": "...", "displayName": "..." }
```

Then register device on the same circle. Idempotent if already a member.  
Open join by guessing `circleId` alone remains `403 JOIN_PROOF_REQUIRED`.

---

## 5. Reminder create / update / delete

Owner only:

- `PUT /v1/circles/{circleId}/reminders/{module}/{itemId}` — upsert; preserves completions/status on edit
- `DELETE /v1/circles/{circleId}/reminders/{module}/{itemId}`

Queue offline mutations; retry with backoff. Server is source of scheduling truth.

---

## 6. Medication completion and undo

Owner only:

- `PUT .../reminders/medication/{itemId}/completions/{occurrenceKey}`
- Undo per Spec / existing API (same owner guard)

Completing a dose stops further owner/family/snooze for that occurrence.

---

## 7. Appointment / task status

Owner only status transitions via reminder status endpoints (C1). Members cannot complete/status.

---

## 8. Notification preferences

`PUT /v1/circles/{circleId}/members/me/prefs`

```json
{ "medication": true, "appointment": true, "task": true, "updates": true }
```

Join applies server defaults; later pref updates are preserved on idempotent re-join.

---

## 9. Circle updates (family feed)

`POST /v1/circles/{circleId}/updates` with optional `Idempotency-Key`.  
Server uses stored `displayName` (C3); ignore client `senderName` for identity.

---

## 10. Account deletion ordering

1. If owner: `DELETE /v1/circles/{circleId}` for each owned circle (or leave ownership).
2. `DELETE /v1/members/me` — **409** while still owning circles (C4).
3. **Then** delete Firebase Auth user.

Never delete Auth first.

---

## 11. API retry queue (client)

Recommended:

- Persist failed mutating requests (reminders, completions, prefs, devices, join).
- Retry on connectivity with exponential backoff; honor `409` as non-retry for consumed tokens.
- Re-fetch ID token on `401`.

---

## 12. Existing Firestore reminder backfill

Backend does not read Firestore. If the app still has Firestore reminders:

1. After circle exists in Mongo (bootstrap or already member), upsert each item via reminder PUT.
2. Treat Mongo as canonical after cutover; avoid dual-writes once stable.

---

## 13. Data-only FCM + flutter_local_notifications

Server sends **data-only** high-priority Android messages (`title`, `body`, `tone`, type fields).  
Flutter must:

- Handle foreground / background / terminated via `firebase_messaging`
- Render with `flutter_local_notifications` using server `title`/`body`
- Map `tone` → Android notification channel / sound (client-owned assets)
- Request POST_NOTIFICATIONS (Android 13+) and exempt battery restrictions as needed for reliability

See `docs/device-test-checklist.md` — physical scenarios remain **NOT TESTED** until executed.

---

## 14. Required Flutter API changes (Phase 10)

| Change | Detail |
|--------|--------|
| Stop open join | Do not register devices into foreign circles without invite |
| Add invite UX | Owner: `POST .../invites`; share token |
| Add join UX | Invitee: `POST .../join` then `POST .../devices` |
| Owner create | Obtain P2 token from CF only; pass `ownershipProof` |
| Never embed | `CIRCLE_CREATE_TOKEN_SECRET`, `CIRCLE_TOKEN_ISSUER_API_KEY` |
