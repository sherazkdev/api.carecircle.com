#!/usr/bin/env bash
ss -tlnp | grep -E ':1001|:3112|:3113' || true
ls /var/www/habit-tracker-docker/*.yml 2>/dev/null
head -50 /var/www/habit-tracker-docker/docker-compose.yaml 2>/dev/null || head -50 /var/www/habit-tracker-docker/compose.yaml 2>/dev/null
curl -s -o /dev/null -w 'pm2_live=%{http_code}\n' http://127.0.0.1:1001/health/live
md5sum /var/www/care-circle-reminder/Dockerfile | cut -d' ' -f1
