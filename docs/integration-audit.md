# Integration Audit — Care Circle Backend

**Phase:** 10 (2026-10-30)

---

## Requirements → status

| Area | Requirement | Evidence | Status |
|------|-------------|----------|--------|
| Auth | Firebase ID token | requireAuth + tests | AUTOMATION VERIFIED |
| AuthZ | Membership / owner | middleware + tests | AUTOMATION VERIFIED |
| C1 | Owner-only completion/status | routes + tests | AUTOMATION VERIFIED |
| C2/P2 | Create-token verify | ownershipProof + tests | AUTOMATION VERIFIED |
| C2 issuer | Trusted mint | `/v1/internal/circle-create-tokens` | IMPLEMENTED / AUTOMATION VERIFIED |
| C2 trust root | Prove circleId before mint | No CF in workspace | **BLOCKED** |
| Join | Invite create/accept | invite routes + tests | IMPLEMENTED / AUTOMATION VERIFIED |
| Devices | Register / R4 / prefs | Phase 4–9 tests | AUTOMATION VERIFIED |
| Reminders | CRUD + plan jobs | Phase 5–9 | AUTOMATION VERIFIED |
| FCM adapter | Data-only send | mocked client | AUTOMATION VERIFIED |
| Real FCM | Device checklist | hardware | **NOT TESTED** |
| Updates / delete | Outbox + cascade | Phase 8–9 | AUTOMATION VERIFIED |
| Deploy | Docker api/worker | Dockerfile/compose | IMPLEMENTED |
| Deploy runtime | compose up / ready | ops | see test-report |
| Flutter contract | Integration guide | `docs/flutter-integration.md` | IMPLEMENTED |
| Flutter live wire | App ↔ API | — | **NOT TESTED** |

---

## Security control matrix

| Control | Status |
|---------|--------|
| Fail-closed bootstrap without flag/secret | AUTOMATION VERIFIED |
| Issuer disabled without API key/secret | AUTOMATION VERIFIED |
| Create-token expiry / replay / cross-circle / wrong uid | AUTOMATION VERIFIED |
| Owner bootstrap race (single owner) | AUTOMATION VERIFIED |
| Invite unauthorized create | AUTOMATION VERIFIED |
| Invite replay / concurrent accept | AUTOMATION VERIFIED |
| Invite invalidate on circle delete | AUTOMATION VERIFIED |
| Production noop rejection | AUTOMATION VERIFIED |
| Worker stop / pending retention | AUTOMATION VERIFIED |
| Secrets not in image | IMPLEMENTED |

---

## Flutter / issuer audit (reconfirmed Phase 10)

No Flutter Care Circle app or Cloud Function issuer proving `circleId` was found in this repository.

**BLOCKED:** production circle onboarding trust prerequisite.

---

## Open onboarding readiness

| Flow | Ready? |
|------|--------|
| Circle create bootstrap | **No** — enable only after CF + `CIRCLE_BOOTSTRAP_ENABLED` |
| Member join via invite | **Yes** (API) — Flutter UX **NOT TESTED** |
| Device register for members | **Yes** after join |
