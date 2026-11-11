#!/usr/bin/env bash
# Move scheduler from PM2 care-circle-reminder to Docker worker. Leaves Nginx + Atlas unchanged.
set -eu
APP_DIR=/var/www/care-circle-reminder
COMPOSE_FILE=docker-compose.vps.prod.yml
API_PORT="${API_DOCKER_HOST_PORT:-3113}"
PM2_NAME=care-circle-reminder

cd "$APP_DIR"

echo "=== PRE: API UP (traffic) ==="
curl -fsS -o /dev/null -w 'api_ready=%{http_code}\n' "http://127.0.0.1:${API_PORT}/health/ready"
curl -fsS -o /dev/null -w 'public_ready=%{http_code}\n' https://carecircle.smartremindersapp.com/health/ready

echo "=== PRE: PM2 ==="
pm2 describe "$PM2_NAME" 2>/dev/null | grep -E 'status|pid|uptime' || true

echo "=== VALIDATE WORKER IMAGE CONFIG (dry run) ==="
docker compose -f "$COMPOSE_FILE" config >/dev/null
docker compose -f "$COMPOSE_FILE" run --rm --no-deps worker sh -c \
  'test -r /run/secrets/firebase-service-account.json && echo firebase_mount=readable && echo PROCESS_MODE=worker'

echo "=== STOP PM2 (SIGTERM — scheduler drain in server.ts) ==="
pm2 stop "$PM2_NAME"
sleep 12
pm2 describe "$PM2_NAME" 2>/dev/null | grep -E 'status|pid' || true
ss -tlnp 2>/dev/null | grep ':1001 ' || echo 'port_1001_free'

echo "=== START DOCKER WORKER (single replica) ==="
docker compose -f "$COMPOSE_FILE" up -d --no-build worker 2>/dev/null || docker compose -f "$COMPOSE_FILE" up -d worker
sleep 8
docker ps --filter name=care-circle-reminder-docker --format 'table {{.Names}}\t{{.Status}}'

echo "=== WORKER LOGS (scheduler / mongo / delivery) ==="
docker logs care-circle-reminder-docker-worker --tail 25 2>&1 | grep -E 'scheduler worker|MongoDB|Firebase|delivery|error|Fatal' || docker logs care-circle-reminder-docker-worker --tail 12

echo "=== POST CHECKS ==="
curl -fsS -o /dev/null -w 'api_ready=%{http_code}\n' "http://127.0.0.1:${API_PORT}/health/ready"
curl -fsS -o /dev/null -w 'public_ready=%{http_code}\n' https://carecircle.smartremindersapp.com/health/ready
pm2 pid "$PM2_NAME" 2>/dev/null && pm2 list | grep "$PM2_NAME" || echo 'pm2_stopped'

echo "=== DONE ==="
