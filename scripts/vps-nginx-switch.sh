#!/usr/bin/env bash
set -eu
NGINX_SITE=/etc/nginx/sites-enabled/care-circle-reminder
ROLLBACK=/var/www/care-circle-reminder/deploy/care-circle-reminder.bak.pre-docker-upstream
NEW_PORT="${1:-3113}"

echo "before:"
grep 'server 127' "$NGINX_SITE" || true
if [ ! -f "$ROLLBACK" ]; then
  cp "$NGINX_SITE" "$ROLLBACK"
fi
sed -i "s|server 127.0.0.1:1001;|server 127.0.0.1:${NEW_PORT};|" "$NGINX_SITE"
echo "after:"
grep 'server 127' "$NGINX_SITE"
nginx -t
systemctl reload nginx
curl -s -o /dev/null -w 'public_live=%{http_code}\n' https://carecircle.smartremindersapp.com/health/live
curl -s -o /dev/null -w 'public_ready=%{http_code}\n' https://carecircle.smartremindersapp.com/health/ready
curl -s -o /dev/null -w 'docker_live=%{http_code}\n' "http://127.0.0.1:${NEW_PORT}/health/live"
pm2 pid care-circle-reminder 2>/dev/null || true
