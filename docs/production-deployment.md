# Production Deployment — Care Circle Backend

**Phase:** 10

---

## Architecture

| Service | `PROCESS_MODE` | Role |
|---------|----------------|------|
| `api` | `api` | HTTP API only — no scheduler ticks |
| `worker` | `worker` | Scheduler claim/send only — no public HTTP |
| `mongo` | — | Persistent volume; **not** published to host by default |

Do **not** run `PROCESS_MODE=all` on more than one replica (duplicate schedulers). Prefer one worker; claim leases allow careful horizontal scale later.

---

## Build

```bash
docker build -t care-circle-api:prod --target production .
```

Secrets are **not** copied into the image (see `.dockerignore`). Mount Firebase SA at runtime.

---

## Compose

```bash
# Ensure .env + firebase-service-account.json exist
docker compose up -d --build
```

- API host port: `http://127.0.0.1:1001` (override `API_HOST_PORT`; Nginx TLS domain `carecircle.smartremindersapp.com`)
- Mongo: internal DNS `mongo:27017` only
- Dev host Mongo port: `docker compose --profile dev-ports up -d`

Health:

- Liveness: `GET /health/live`
- Readiness: `GET /health/ready` (Compose API healthcheck)

---

## Required environment

See `.env.example`. Critical production gates:

| Variable | Production expectation |
|----------|------------------------|
| `NODE_ENV` | `production` |
| `DELIVERY_MODE` | `fcm` (noop **rejected** for workers) |
| `PROCESS_MODE` | `api` or `worker` per service |
| `MONGODB_URI` | Internal compose URI or private network |
| `FIREBASE_SERVICE_ACCOUNT_PATH` or `_JSON` | Injected secret |
| `CIRCLE_CREATE_TOKEN_SECRET` | Required for invites + create tokens |
| `CIRCLE_BOOTSTRAP_ENABLED` | `true` only after trusted CF proves circleId |
| `CIRCLE_TOKEN_ISSUER_ENABLED` | `true` only for CF/ops callers |

Invalid env → process exits at startup (fail closed).

---

## Indexes

`ensureAllIndexes()` runs on every process start after Mongo connect.

---

## Graceful shutdown

`SIGINT` / `SIGTERM`: stop worker (no new claims), close HTTP, disconnect Mongo (10s force exit).

Pending jobs remain `pending` / recoverable via lease expiry — not deleted on restart.

---

## Verification checklist (ops)

1. `docker compose ps` — api healthy, worker running, mongo healthy  
2. `curl -fsS localhost:3000/health/ready`  
3. Worker logs show scheduler started; no second API-mode worker  
4. Restart mongo volume persists data  
5. Restart worker; due jobs still claimed later  
6. Confirm Firebase init errors surface in logs / ready=503  

If Docker is unavailable in an environment, mark Docker verification **NOT TESTED**.
