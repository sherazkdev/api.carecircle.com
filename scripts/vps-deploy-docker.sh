#!/usr/bin/env bash
set -euo pipefail
APP_DIR=/var/www/care-circle-reminder
COMPOSE_FILE=docker-compose.vps-api.yml
DOCKER_PORT="${API_DOCKER_HOST_PORT:-3113}"
NGINX_SITE=/etc/nginx/sites-enabled/care-circle-reminder
ROLLBACK_FILE=/var/www/care-circle-reminder/deploy/care-circle-reminder.bak.pre-docker-upstream

cd "$APP_DIR"

echo "=== GIT REV ==="
git rev-parse --short HEAD
git log -1 --oneline

echo "=== BUILD DOCKER API (port ${DOCKER_PORT}) ==="
export API_DOCKER_HOST_PORT="$DOCKER_PORT"
docker compose -f "$COMPOSE_FILE" build api
docker compose -f "$COMPOSE_FILE" up -d api

echo "=== WAIT HEALTH localhost ==="
for i in $(seq 1 30); do
  live=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${DOCKER_PORT}/health/live" || true)
  ready=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${DOCKER_PORT}/health/ready" || true)
  echo "attempt=$i live=$live ready=$ready"
  if [ "$live" = "200" ] && [ "$ready" = "200" ]; then
    break
  fi
  sleep 5
done

echo "=== CONTAINER RUNTIME (names only) ==="
docker compose -f "$COMPOSE_FILE" exec -T api sh -c 'echo NODE_ENV=$NODE_ENV PROCESS_MODE=$PROCESS_MODE DELIVERY_MODE=$DELIVERY_MODE PORT=$PORT'

echo "=== STARTUP LOG (index / delivery) ==="
docker compose -f "$COMPOSE_FILE" logs api 2>/dev/null | tail -30 | grep -E 'index|delivery|Firebase|Mongo|listening|error' || docker compose -f "$COMPOSE_FILE" logs api --tail 15

echo "=== PM2 STILL RUNNING (scheduler path) ==="
pm2 pid care-circle-reminder 2>/dev/null && pm2 describe care-circle-reminder 2>/dev/null | grep -E 'status|PROCESS' || true

echo "=== NGINX BACKUP + UPSTREAM SWITCH ==="
if [ ! -f "$ROLLBACK_FILE" ]; then
  cp "$NGINX_SITE" "$ROLLBACK_FILE"
fi
# Only change care_circle upstream server line
sed -i "s|server 127.0.0.1:1001;|server 127.0.0.1:${DOCKER_PORT};|" "$NGINX_SITE"
grep -E 'upstream|server 127' "$NGINX_SITE" | head -5
nginx -t
systemctl reload nginx

echo "=== PUBLIC HTTPS HEALTH ==="
curl -s -o /dev/null -w 'public_live=%{http_code}\n' https://carecircle.smartremindersapp.com/health/live
curl -s -o /dev/null -w 'public_ready=%{http_code}\n' https://carecircle.smartremindersapp.com/health/ready

echo "=== DONE old_upstream=127.0.0.1:1001 new_upstream=127.0.0.1:${DOCKER_PORT} ==="
