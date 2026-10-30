# Security Decisions & Approval Gates

**Phase:** 10 (issuer HTTP + invites implemented; circleId trust root still BLOCKED)  
**Rule:** Approved decisions below **override** contradictory Spec v5 text.

---

## Hard security principles (non-negotiable)

1. Verify Firebase ID token on all protected routes; derive `uid` only from token.
2. Never trust client-supplied `uid`, `role`, or authorization claims for access control.
3. Enforce circle membership (and owner role where required) on every relevant API using **server-side** `members` / `circles` records.
4. Do not log FCM tokens, ID tokens, invite/create tokens, or service-account material.
5. Backend must not access Firestore.

---

## Approved decisions (2026-10-29)

| Gate | Decision | Spec v5 override |
|------|----------|------------------|
| **C1** | **Owner-only** completion and appointment/task status. Members may share updates only. | Overrides §3 / API “Sab” for endpoints 5–7 |
| **C2** | **P2** trusted signed circle-create token. Never trust client `role`. | Overrides naïve §6.1 role upsert / bare first-registrant lock |
| **C3** | Stored `displayName` only for sender identity | Overrides body `senderName` as display source |
| **C4** | HTTP **409** if owner deletes account while owning circles | Extends §6.9 / §11.5 |
| **C5** | Miss-at-T; `MISS_GRACE_MINUTES=0`; independent toggles | Confirms §7 |
| **O9** | Android-first; document iOS data-only limits | Confirms §11.9 |
| **Envelope** | `{ ok, data }` / structured errors | Spec had no envelope |

---

## C2 = P2 — Phase 10 status

### Implemented (backend)

| Piece | Status |
|-------|--------|
| Firebase `requireAuth` (`verifyIdToken`) | **Active** |
| `requireCircleMember` / `requireCircleOwner` (Mongo-backed) | **Active** |
| P2 HMAC create-token **verify + jti replay store** | **Implemented** |
| `signCircleCreateToken` + `POST /v1/internal/circle-create-tokens` | **Implemented** (API-key gated; fail-closed) |
| `requireTrustedCircleBootstrap` middleware | **Implemented** (fails closed unless enabled) |
| HTTP ownership bootstrap via device register | **Gated** (`CIRCLE_BOOTSTRAP_ENABLED`, default false) |
| Member invite HMAC + registry + `POST .../invites` + `POST .../join` | **Implemented** |
| Open member join by `circleId` alone | **Blocked** (`JOIN_PROOF_REQUIRED`) |

### Trust prerequisite — deploy pending

Callable functions in `firebase/functions` verify Firestore `circles/{circleId}.ownerUid == auth.uid` before calling the API issuer. **Deploy and staging E2E are NOT TESTED** in this remediation pass.

Keep `CIRCLE_BOOTSTRAP_ENABLED=false` until:

1. Functions + rules are deployed to the Firebase project
2. Staging E2E: callable → `ownershipProof` → `POST .../devices` succeeds
3. Ops intentionally enable bootstrap on the API

See `firebase/README.md`.

### P2 token contract (issuer ↔ API)

```text
token = base64url(json(payload)) + "." + base64url(HMAC-SHA256(payloadB64, CIRCLE_CREATE_TOKEN_SECRET))

payload = {
  jti: string,          // unique; consumed once (replay → 409)
  circleId: string,
  ownerUid: string,     // must equal authenticated Firebase uid
  iat: number,          // unix seconds
  exp: number,          // unix seconds; TTL ≤ CIRCLE_CREATE_TOKEN_MAX_TTL_SECONDS (default 600)
  timezone?: string     // IANA
}
```

Client transport (when bootstrap enabled):

- Header `X-Circle-Create-Token: <token>` or body `{ "ownershipProof": "<token>" }`
- Plus `Authorization: Bearer <Firebase ID token>`

Shared secret: `CIRCLE_CREATE_TOKEN_SECRET` (min 32 chars) in API env **and** issuer env.

### Invite token contract

```text
payload = {
  typ: "circle_invite",
  jti, circleId, inviterUid, iat, exp
}
```

- Signed with same HMAC secret; typed separately from create tokens
- Pending row in `circle_invites` (consume / TTL / circle cascade delete)
- Join identity = authenticated uid; role forced to `member`

---

## GATE C1 — APPROVED (enforced via `requireCircleOwner`)

Owner-only completion/status routes must use `requireCircleOwner`.

---

## GATE C3 / C4 / C5 / O9 — enforced

| Gate | Enforcement |
|------|-------------|
| **C3** | `POST /updates` uses `Member.displayName`; client `senderName` ignored for identity |
| **C4** | `DELETE /v1/members/me` returns **409** if the user still owns any circle |
| **C5** | Miss-at-T (grace 0) — Phase 6 |
| **O9** | Android-first FCM data-only — Phase 7 |

### Firebase Auth account deletion order

1. Call Care Circle `DELETE /v1/members/me` (and delete owned circles first if C4 blocks).
2. Only then delete the Firebase Authentication user.

If Auth is deleted first, the client can no longer authorize cleanup; orphaned Mongo memberships/devices may remain until manual ops cleanup.

---

## Production delivery safety

- `DELIVERY_MODE=noop` is forbidden when `NODE_ENV=production` and `PROCESS_MODE` includes `worker` or `all` (startup throw).
- Firebase init failures surface via logs and `/health/ready` → 503.
