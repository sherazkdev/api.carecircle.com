# Firestore Security Rules audit — Care Circle

**Date:** 2026-10-30  
**Rules file:** `firebase/firestore.rules`  
**Execution:** Rules are **IMPLEMENTED** in-repo; **NOT TESTED** against Firebase Emulator in this remediation pass.

---

## Goals

| Threat | Mitigation |
|--------|------------|
| User sets `ownerUid` to someone else’s uid | Create requires `ownerUid == request.auth.uid`; updates cannot change `ownerUid` |
| User joins circle without invite | Member creates restricted; backend join uses HMAC (separate from Firestore) |
| Member escalates to owner | Member `role` cannot change from `owner` → `member` arbitrarily; owner row tied to circle doc |
| Non-member reads another circle | Read requires membership or owner on circle/member paths |
| Non-owner edits reminders | `reminders/*` write = owner only |

---

## Collection layout (preserved)

```
circles/{circleId}
  ownerUid, timezone, displayName?, createdAt?
  members/{uid}
    role, displayName, joinedAt?
  reminders/{itemId}
    (app-defined reminder fields)
  updates/{updateId}
    (app-defined update fields)
```

This matches the existing Flutter + Firestore architecture described in `docs/architecture.md`.

---

## Gaps / follow-ups

1. **Emulator rules unit tests** — add `@firebase/rules-unit-testing` in a follow-up CI job (**NOT TESTED**).
2. **Member invite in Firestore** — if the app stores invite links in Firestore, add explicit rules (backend invite tokens are HMAC, not Firestore).
3. **Backend Mongo** — authorization for reminders/notifications remains on the API; Firestore rules do not replace API authZ.

---

## Verdict

| Item | Status |
|------|--------|
| Rules authored | **IMPLEMENTED** |
| Rules deployed to production Firebase | **NOT TESTED** |
| Emulator verification | **NOT TESTED** |
