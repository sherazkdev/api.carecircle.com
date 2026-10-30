# Staging end-to-end checklist

**Purpose:** Gate `CIRCLE_BOOTSTRAP_ENABLED=true` on the API (staging only first).  
**Device FCM:** mark PASS only on physical Android hardware.

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| 1 | Circle creation | CF `createCareCircle` or Firestore create + `requestCircleBootstrapToken` | Firestore `ownerUid == auth.uid` | **NOT TESTED** |
| 2 | Secure owner bootstrap | `registerDevice` with `ownershipProof` | Mongo circle + owner member | **NOT TESTED** |
| 3 | Member invitation | Owner `POST .../invites` | `inviteToken` returned | **NOT TESTED** |
| 4 | Member joining | Invitee `POST .../join` + device register | Member role only | **NOT TESTED** |
| 5 | FCM registration | Token refresh → device upsert | Row in Mongo `devices` | **NOT TESTED** |
| 6 | Medication reminder | Upsert med + worker tick | Owner FCM (data-only) | **NOT TESTED** |
| 7 | Family missed | Miss dose with `notifyFamilyOnMiss` | Member FCM | **NOT TESTED** |
| 8 | Snooze | Snooze enabled med | Owner repeat until complete | **NOT TESTED** |
| 9 | Completion stops notify | Complete dose | No further jobs for occurrence | **NOT TESTED** |
| 10 | Circle deletion | `DELETE /v1/circles/:id` | Cascade + invites cleared | **NOT TESTED** |

## Prerequisites

- Firebase Functions + rules deployed (`firebase/README.md`)
- Staging API: `CIRCLE_TOKEN_ISSUER_ENABLED=true`, issuer secret, Mongo, FCM SA
- Flutter app wired per `integration/flutter/APP_WIRING.md`
- `CIRCLE_BOOTSTRAP_ENABLED=true` **only on staging** after rows 1–2 pass

## Production

Do **not** enable production bootstrap until this entire checklist is PASS on staging and reviewed.
