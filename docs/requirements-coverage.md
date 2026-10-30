# Requirements Coverage Matrix

**Phase:** 9 (Integration / security / reliability audit)  
**Source of truth:** `care-circle-reminders-api-spec.md` (Version 5) + approved overrides in `security-decisions.md`  
**Status legend:** `Planned` · `Implemented` · `Partial` · `Blocked`  
**Detailed matrix:** `docs/integration-audit.md` · **Release:** `docs/release-readiness.md`

---

## Functional requirements

| ID | Requirement | Module(s) | Phase | Status | Notes |
|----|-------------|-----------|-------|--------|-------|
| R1 | Register FCM token per circle on app open | device, member | 4 | Implemented | |
| R2 | Multiple devices per user; identity = `fcmToken` | device | 4 | Implemented | |
| R3 | Logout does **not** delete device/token | device | 4 | Implemented | No logout delete API |
| R4 | Reassign `fcmToken` from prior uid to new uid | device | 4 | Implemented | |
| R5 | Delete invalid FCM tokens on send | notification, device | 7 | Implemented | On unregistered/invalid FCM classify |
| R6 | Medication: multiple times; `daily` / `specificDays` | reminder, scheduler | 5–6 | Implemented | Planner + CRUD |
| R7 | `reminderEnabled=false` → no owner notifications | scheduler | 6 | Implemented | Send-time eligibility; FCM Phase 7 |
| R8 | `notifyFamilyOnMiss=false` → no member notifications | scheduler | 6 | Implemented | Independent of R7 |
| R9 | Lead-time reminder: owner only | scheduler | 6 | Implemented | Delivery via port |
| R10 | At dose time, unfinished → family `med_missed` if flag on | scheduler | 6 | Implemented | C5 grace 0 |
| R11 | Snooze: owner only, every `snoozeMinutes` until done | scheduler | 6 | Implemented | Next-dose / 2h cutoffs |
| R12 | Per-dose completion | completion | 5 | Implemented | Schedule-validated occurrenceKey |
| R13 | Appointment fixed `startsAt` | reminder | 5 | Implemented | |
| R14 | Appointment toggles; no snooze | reminder, scheduler | 5–6 | Implemented | |
| R15 | Appointment `active` / `completed` stops pending jobs | reminder, scheduler | 5–6 | Implemented | Replan on reactivate |
| R16 | Task repeat: none / daily / custom | reminder, scheduler | 5–6 | Implemented | |
| R17 | Task toggles; no snooze | reminder, scheduler | 5–6 | Implemented | |
| R18 | Task `active` / `completed` stops pending jobs | reminder, scheduler | 5–6 | Implemented | Global status preserved |
| R19 | Member prefs | member | 4 | Implemented | |
| R20 | Prefs apply to owner too | scheduler | 6 | Implemented | Send-time filter |
| R21–R25 | Updates / deletion flows | update, circle, member | 8 | Implemented | C3/C4 enforced |
| R26–R28 | Notification templates / TZ formatting | notification | 7 | Implemented | English only (Spec §11) |

## Non-functional requirements

| ID | Requirement | Phase | Status | Notes |
|----|-------------|-------|--------|-------|
| R29 | Idempotent write APIs | 3–8 | Partial | Devices, prefs, reminders, completions, job dedupe |
| R30 | Firebase ID token auth; uid from token only | 3 | Implemented | |
| R31 | No duplicate notifications (dedupe key) | 6 | Implemented | Unique index; at-least-once send caveat |
| R32 | Done/status check at send time | 6 | Implemented | |
| R33 | Payload only reminder-related fields | 7 | Implemented | Data-only Spec §10 fields |

## Approved overrides (unchanged)

C1 owner-only completion/status · C2 P2 ownership proof · C3 displayName · C4 owner delete 409 · C5 miss-at-T · O9 Android-first · envelope `{ ok, data }`

## Phase 9 audit notes

| Gate | Status |
|------|--------|
| C2 trusted issuer | **Blocked** for production onboarding (verifier present; issuer missing) |
| Join proof | **Blocked** (open join denied; invite flow not built) |
| Real-device FCM | **Not tested** |
| Mocked integration suite | **Pass** — see test-report |
