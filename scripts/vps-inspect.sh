#!/usr/bin/env bash
set -u
echo "=== NGINX ==="
grep -E 'server_name|upstream|127.0.0.1' /etc/nginx/sites-enabled/care-circle-reminder 2>/dev/null || ls /etc/nginx/sites-enabled/
echo "=== PORTS ==="
ss -tlnp 2>/dev/null | grep 127.0.0.1 | grep -E ':100[0-9]|:300[0-9]' || true
echo "=== WWW ==="
ls -la /var/www/ 2>/dev/null || true
for d in /var/www/care-circle-reminder /var/www/care-circle-reminder-api; do
  if [ -d "$d" ]; then
    echo "=== DIR $d ==="
    (cd "$d" && git rev-parse --short HEAD 2>/dev/null; git log -1 --oneline 2>/dev/null; ls -la docker-compose.yml Dockerfile .env 2>/dev/null; echo process_mode_hint; grep -E '^PROCESS_MODE=|^DELIVERY_MODE=|^PORT=' .env 2>/dev/null | cut -d= -f1 | tr '\n' ' '; echo)
  fi
done
echo "=== PM2 ==="
pm2 list 2>/dev/null || echo no_pm2
echo "=== DOCKER ==="
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null | head -15 || echo no_docker
echo "=== HEALTH LOCAL ==="
curl -s -o /dev/null -w 'live_1001=%{http_code}\n' http://127.0.0.1:1001/health/live 2>/dev/null || true
curl -s -o /dev/null -w 'ready_1001=%{http_code}\n' http://127.0.0.1:1001/health/ready 2>/dev/null || true
