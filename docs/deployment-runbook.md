# Deployment Runbook — Care Circle Backend (VPS + Docker Compose)

**Audience:** Operator deploying API + worker + MongoDB on a private VPS.  
**This runbook does not deploy automatically.** You execute steps manually.

Related: `docs/production-deployment.md`, `docs/production-checklist.md`, `.env.example`, `docker-compose.yml`.

---

## 1. Prerequisites

- VPS with Docker Engine + Docker Compose plugin
- Domain + TLS termination (Caddy, nginx, or cloud load balancer)
- Firebase project (Auth + FCM + optional Firestore for app)
- Firebase Admin service account JSON (server only)
- Strong random values: `CIRCLE_CREATE_TOKEN_SECRET`, `CIRCLE_TOKEN_ISSUER_API_KEY`

---

## 2. Staging-first rule

1. Deploy Cloud Functions to a **staging** Firebase project.
2. Deploy API/worker to staging VPS with `CIRCLE_BOOTSTRAP_ENABLED=true` only after CF ↔ issuer E2E passes (`docs/staging-e2e-checklist.md`).
3. Keep production `CIRCLE_BOOTSTRAP_ENABLED=false` until staging sign-off.

---

## 3. Prepare secrets (never commit)

On the VPS:

```bash
mkdir -p /opt/care-circle/secrets
chmod 700 /opt/care-circle/secrets
# Copy firebase-service-account.json here
nano /opt/care-circle/.env   # from .env.example
```

Required variables (see `src/config/env.ts`):

| Variable | Notes |
|----------|--------|
| `MONGODB_URI` | `mongodb://mongo:27017/care_circle` inside Compose |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | `/run/secrets/firebase-service-account.json` in container |
| `CIRCLE_CREATE_TOKEN_SECRET` | ≥32 chars |
| `CIRCLE_TOKEN_ISSUER_ENABLED` | `true` when CF calls issuer |
| `CIRCLE_TOKEN_ISSUER_API_KEY` | Match CF secret |
| `CIRCLE_BOOTSTRAP_ENABLED` | `false` until staging E2E |
| `DELIVERY_MODE` | `fcm` in production worker |
| `PROCESS_MODE` | `api` or `worker` per service |

Set `FIREBASE_SERVICE_ACCOUNT_HOST_PATH` in shell or `.env` to the host path of the JSON file.

Cloud Functions (Firebase console / CLI secrets): issuer URL, `CIRCLE_TOKEN_ISSUER_API_KEY` — **not** in Flutter.

---

## 4. Build and start

```bash
cd /opt/care-circle/app   # git clone or rsync repository
docker build -t care-circle-api:prod --target production .
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/health/ready
```

Expected ready JSON includes Mongo and Firebase checks passing.

---

## 5. HTTPS reverse proxy

Expose only **443 → api:3000**. Do not publish MongoDB to the internet.

Example nginx location:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Flutter `baseUrl` = `https://your-api.example.com` (no trailing slash).

---

## 6. Firewall

- Allow: 22 (SSH, restricted IP), 443 (HTTPS)
- Deny: 27017, 3000 from public (API only via proxy on localhost)

---

## 7. Health monitoring

| Probe | URL | Use |
|-------|-----|-----|
| Liveness | `GET /health/live` | Restart if process dead |
| Readiness | `GET /health/ready` | Remove from LB if Mongo/Firebase down |

Compose already healthchecks the API container with `/health/ready`.

Worker has no HTTP — monitor via logs and job lag (pending job count in Mongo).

---

## 8. Backups

Mongo volume: `care_circle_mongo_data`.

```bash
docker compose exec mongo mongodump --archive=/tmp/backup.gz --gzip
docker cp $(docker compose ps -q mongo):/tmp/backup.gz ./backup-$(date +%F).gz
```

Schedule daily; test restore on staging quarterly.

---

## 9. Graceful operations

```bash
docker compose restart api      # brief API blip; in-flight requests drain via SIGTERM
docker compose restart worker   # pending jobs remain; lease expires and reclaims
docker compose down             # stop all; volume persists
```

Do not scale `worker` beyond one replica until ops explicitly design multi-claimer strategy.

---

## 10. Rollback

1. `docker compose pull` or checkout previous git tag
2. `docker build -t care-circle-api:prod --target production .`
3. `docker compose up -d --force-recreate`
4. Verify `/health/ready`
5. If schema/index change failed: restore Mongo from last good backup

---

## 11. Secret rotation

1. Generate new `CIRCLE_CREATE_TOKEN_SECRET` / issuer API key
2. Update API `.env` and Firebase Functions secrets
3. Redeploy Functions then `docker compose up -d --force-recreate`
4. Old create/invite tokens invalidate naturally (short TTL); no client action

---

## 12. Staging → production checklist

- [ ] All rows in `docs/production-checklist.md` marked with evidence
- [ ] `docs/staging-e2e-checklist.md` executed PASS
- [ ] `docs/device-test-checklist.md` Android FCM PASS
- [ ] `CIRCLE_BOOTSTRAP_ENABLED=true` only if CF trust path verified
- [ ] Production `DELIVERY_MODE=fcm`, worker running
- [ ] Logs reviewed — no secrets in stdout

---

## 13. Docker NOT TESTED on audit host

The final audit did **not** run Docker on the CI/agent machine. You must run section 4 locally and record results in your ops journal.
