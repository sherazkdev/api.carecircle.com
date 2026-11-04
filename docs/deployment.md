# Deployment

**Phase:** 1 — Dev foundation present. Full production runbook in Phase 10.

## Phase 1 environment

Copy `.env.example` → `.env` and set:

| Variable | Purpose |
|----------|---------|
| `MONGODB_URI` | Mongo connection string |
| `FIREBASE_PROJECT_ID` | Firebase project |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Path to service-account JSON **or** |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Raw JSON secret (do not log) |
| `PORT` | HTTP port inside the process (default 3000; VPS host publish is 1001) |
| `MISS_GRACE_MINUTES` | Approved default `0` (C5) |
| `PROCESS_MODE` | `api` \| `worker` \| `all` (worker unused until Phase 6) |

## Local run

```bash
npm install
npm run dev          # tsx watch
# or
npm run build && npm start
```

Health: `GET /health` → `{ ok: true, data: { mongo, firebase, ... } }`

## Docker

`docker-compose.yml` runs Mongo + API. Requires Docker Engine on the host.

**Note (2026-10-29):** Docker CLI was not available on the Phase 1 verification machine; Compose was authored but not smoke-tested there.

## Firebase

Admin initialization is credential parse + `initializeApp` only in Phase 1. Live Auth token verification and FCM come in Phases 3 and 7 — use a **real** service account then.

## iOS (O9)

Android-first. Do not claim guaranteed iOS data-only background delivery.
