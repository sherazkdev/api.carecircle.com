# Real-device FCM checklist

**Status:** **NOT TESTED** — no physical Android hardware / live FCM run was executed in Phase 10.  
Do not mark PASS until exercised on hardware with production-like `DELIVERY_MODE=fcm`.

Automated tests use a mocked FCM client and **must not** send live pushes.

## Android prerequisites (document for operators)

1. App signed with the Firebase project matching the worker service account.
2. Android 13+: runtime **POST_NOTIFICATIONS** granted.
3. Battery optimization exemptions / unrestricted background where OEM requires it for reliable terminated delivery.
4. Notification channels created in-app for each `tone` (server does not install sounds).
5. Worker: `DELIVERY_MODE=fcm`, valid SA, device row via `POST /v1/circles/:circleId/devices`.

## Android (primary — O9)

| # | Scenario | Expected | Result |
|---|----------|----------|--------|
| 1 | Foreground | Local notification via Flutter (`firebase_messaging` + `flutter_local_notifications`) with server title/body | **NOT TESTED** |
| 2 | Background | Data message received; local notification shown with tone channel | **NOT TESTED** |
| 3 | App terminated | Data delivery + local notification (Android high priority) | **NOT TESTED** |
| 4 | Tone | `tone` string maps to existing Android channel/sound; server does not install sounds | **NOT TESTED** |
| 5 | Title/body | Match Spec §9 templates for type under test | **NOT TESTED** |
| 6 | Owner reminder | `med_before` / `med_due` to owner devices only | **NOT TESTED** |
| 7 | Family missed | `med_missed` to members when `notifyFamilyOnMiss` | **NOT TESTED** |
| 8 | Medication snooze | Owner-only snooze continues until complete / next dose / 2h | **NOT TESTED** |
| 9 | Completion cutoff | Completing dose stops further owner/family/snooze for that occurrence | **NOT TESTED** |
| 10 | Multiple devices | Same uid, two tokens → both receive | **NOT TESTED** |
| 11 | Pref toggles | Disabling module pref stops that module’s pushes | **NOT TESTED** |
| 12 | Notification preferences end-to-end | Pref changes reflected before next send | **NOT TESTED** |

## iOS limitations

Spec §11: **data-only background delivery is not reliable on iOS.** Care Circle is Android-first (O9). Phase 7+ does **not** add a top-level FCM `notification` key.

## Flutter compatibility expectations

- Server sends **data-only** messages (`android.priority = high`).
- App reads `title`, `body`, `tone` from `data` and renders with `flutter_local_notifications`.
- Channel / sound selection is **client-side** from `tone` (e.g. `gentle_chime`).
