#!/usr/bin/env bash
set -u
echo "=== CARE CIRCLE PM2 DETAIL ==="
pm2 describe care-circle-reminder 2>/dev/null | grep -E 'script path|exec cwd|node env|PORT|PROCESS' || true
grep -E '^PROCESS_MODE=|^DELIVERY_MODE=|^NODE_ENV=|^PORT=' /var/www/care-circle-reminder/.env 2>/dev/null | sed 's/=.*/=<set>/'
echo "=== HABIT DOCKER COMPOSE ==="
head -80 /var/www/habit-tracker-docker/docker-compose.yml 2>/dev/null || true
echo "=== HABIT NGINX UPSTREAM ==="
grep -E 'upstream|127.0.0.1' /etc/nginx/sites-enabled/habit* 2>/dev/null | head -10
echo "=== FREE PORT SCAN ==="
for p in 1001 1002 1010 1011 3112 3113 3114 3120; do
  if ss -tln | grep -q "127.0.0.1:${p} "; then echo "port_${p}=in_use"; else echo "port_${p}=free"; fi
done
echo "=== CARE CIRCLE DIST ==="
ls -la /var/www/care-circle-reminder/dist/server.js 2>/dev/null
echo "=== SECRETS PATH ==="
ls -la /var/www/care-circle-reminder/secrets/ 2>/dev/null | head -5
