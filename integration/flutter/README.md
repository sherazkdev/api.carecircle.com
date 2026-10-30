# Flutter integration (release blocker remediation)

The Care Circle **Flutter app is not in this repository**. This folder provides a **drop-in client** and wiring guide so you can integrate backend APIs **without changing UI layouts** or removing Firestore as the app database.

## Package

Copy or path-depend on:

`integration/flutter/care_circle_backend_client/`

```yaml
dependencies:
  care_circle_backend_client:
    path: ../care-circle-reminder-app/integration/flutter/care_circle_backend_client
```

## Wiring checklist (no UI changes required)

Hook these calls from **existing** repositories / BLoCs / services — same user actions, extra HTTPS side effects.

| Existing app action | Backend call |
|-------------------|--------------|
| Create circle (Firestore) | `CircleBootstrapService.createCareCircle` **or** `requestCircleBootstrapToken` then `bootstrapBackendCircle` |
| FCM token refresh | `CareCircleBackendClient.registerDevice` per active circle |
| Owner shares invite | `createInvite` → share `inviteToken` (deep link / QR) |
| Accept invite | `acceptInvite` → `registerDevice` |
| Save reminder in Firestore | `upsertReminder` (mirror payload) |
| Delete reminder | `deleteReminder` |
| Mark dose done | `setMedicationCompletion` |
| Appt/task status | `setAppointmentStatus` / `setTaskStatus` |
| Notification toggles | `updatePrefs` |
| Post family update | `postUpdate` (+ optional `Idempotency-Key`) |
| Delete circle | `deleteCircle` then Firestore delete (or reverse per product order) |
| Account delete | `deleteAccount` **before** `FirebaseAuth.instance.currentUser!.delete()` |

## Bootstrap sequence (trusted ownership)

1. Deploy Firebase functions + rules (`firebase/README.md`).
2. Enable API issuer + bootstrap **only in staging** after E2E:
   - `CIRCLE_TOKEN_ISSUER_ENABLED=true`
   - `CIRCLE_BOOTSTRAP_ENABLED=true`
3. App calls callable → receives `ownershipProof` only.
4. App calls `POST /v1/circles/{circleId}/devices` with `ownershipProof`.

## Retry queue

Wrap `CareCircleBackendClient` methods in your existing offline queue (same pattern as Firestore writes). Retry `5xx` and network errors; do **not** retry `409` on invite/bootstrap tokens.

## Status

| Item | Status |
|------|--------|
| Client package authored | **IMPLEMENTED** |
| Copied into production Flutter app | **NOT TESTED** (app not in repo) |
| End-to-end on device | **NOT TESTED** |

See also `docs/flutter-integration.md`.
