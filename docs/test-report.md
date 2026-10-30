# Test Report — Care Circle Backend

**Phase:** 10  
**Date:** 2026-10-30

---

## Automation

| Command | Result |
|---------|--------|
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** |
| `npm run lint` | **PASS** |
| `npm test` | **PASS (158/158)** |

### Phase 10 suite

`tests/integration/phase10.security.deploy.test.ts` covers:

- Signed token issuance (HTTP issuer)
- Signature verification / expired / replayed / cross-circle / wrong UID
- Unauthorized issuer
- Owner bootstrap race
- Invitation create / accept / replay / unauthorized / concurrent
- Invitation invalidation after circle deletion
- Expired invite
- Production noop rejection
- Issuer env fail-closed
- Live vs ready health
- Worker stop retains pending jobs

Prior phase suites remain green (auth, devices, reminders, scheduler, FCM mock, updates/deletion, phase9 E2E).

## Release blocker remediation (2026-10-30)

| Suite | Result |
|-------|--------|
| `tests/integration/release-blocker.security.test.ts` | PASS |
| `firebase/functions/test/ownership.test.ts` | PASS (5) |

---

## Docker

| Check | Result |
|-------|--------|
| `docker` / `docker compose` CLI on this agent host | **NOT AVAILABLE** |
| Production image build | **NOT TESTED** |
| Compose api + worker up | **NOT TESTED** |
| `/health/ready` via Compose | **NOT TESTED** |
| Worker Mongo/Firebase via Compose | **NOT TESTED** |
| Persistent volume across restart | **NOT TESTED** |

Artifacts are **IMPLEMENTED** (`Dockerfile`, `docker-compose.yml`); runtime verification requires Docker on the operator machine.

---

## Real device

| Check | Result |
|-------|--------|
| Android FCM checklist | **NOT TESTED** |

See `docs/device-test-checklist.md`.

---

## Release blockers (ship)

1. Trusted circle ownership CF — **IMPLEMENTED** in-repo; deploy + API E2E **NOT TESTED**
2. Real-device FCM — **NOT TESTED**
3. Flutter app wiring — **NOT TESTED** (client package **IMPLEMENTED**)
4. Docker Compose runtime — **NOT TESTED**
