# Production Checklist — Care Circle Backend

Mark each gate only when evidence exists. Do not claim production-ready until all **Required** rows pass.

## Required security

| Gate | Status |
|------|--------|
| Firebase ID token verified on protected routes | AUTOMATION VERIFIED |
| Client `role` never authorizes | AUTOMATION VERIFIED |
| P2 create-token verify + single-use + UID/circle bind | AUTOMATION VERIFIED |
| Trusted issuer HTTP (API-key) + rate limit | IMPLEMENTED / AUTOMATION VERIFIED |
| Cloud Function proves Firestore owner before mint | IMPLEMENTED — **LIVE NOT TESTED** |
| `CIRCLE_BOOTSTRAP_ENABLED` false until CF E2E | **BLOCKED** (keep false) |
| Invite create (owner-only) + join proof + join rate limit | AUTOMATION VERIFIED |
| Invite replay / expiry / delete invalidation | AUTOMATION VERIFIED |
| Production `DELIVERY_MODE=noop` rejected for workers | AUTOMATION VERIFIED |
| Secrets never logged / not in image | IMPLEMENTED |
| Log redaction (issuer key, tokens, proofs) | IMPLEMENTED |

## Required deployment

| Gate | Status |
|------|--------|
| Production Dockerfile (no SA baked in) | IMPLEMENTED |
| Compose: api + worker + mongo (mongo not public by default) | IMPLEMENTED |
| Env validation fails closed | AUTOMATION VERIFIED |
| `/health/live` vs `/health/ready` | AUTOMATION VERIFIED |
| Indexes on startup | IMPLEMENTED |
| Worker restart retains pending jobs | AUTOMATION VERIFIED |
| Dual-claim prevented (job lease/claim) | AUTOMATION VERIFIED |
| Docker image build + compose up on VPS | **NOT TESTED** — run `docs/deployment-runbook.md` §4 |
| HTTPS reverse proxy + firewall | Operator |

## Required integration (external Flutter developer)

| Gate | Status |
|------|--------|
| Handover package | IMPLEMENTED — `docs/flutter-developer-handover.md` |
| OpenAPI / Postman | IMPLEMENTED — `docs/openapi.yaml`, `docs/postman/` |
| App wired to CF + invite/join + sync | **NOT TESTED** |
| Real Android FCM checklist | **NOT TESTED** |

## Explicit non-ready rule

**Not production-ready for open circle creation** until Cloud Function trust path is live and bootstrap is intentionally enabled on production API.  
**Not production-ready for push UX** until real-device checklist rows are executed PASS.

## Staging → production sign-off

Use `docs/deployment-runbook.md` §12 together with `docs/staging-e2e-checklist.md` and record dates/evidence in your ops log.
