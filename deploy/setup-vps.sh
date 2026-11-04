#!/usr/bin/env bash
# Install Nginx site + start Nginx only. Does not install Node, MongoDB, or Docker.
set -euo pipefail

SITE_NAME="${SITE_NAME:-care-circle-reminder}"
NGINX_SITE="/etc/nginx/sites-available/${SITE_NAME}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/setup-vps.sh"
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "nginx is not installed. Install nginx, then re-run this script."
  exit 1
fi

mkdir -p /var/www/certbot

cp "${SCRIPT_DIR}/nginx/care-circle-reminder.http.conf" "${NGINX_SITE}"
ln -sfn "${NGINX_SITE}" "/etc/nginx/sites-enabled/${SITE_NAME}"
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "Nginx site enabled: ${SITE_NAME}"
echo "HTTP proxy: 80 -> 127.0.0.1:1001"
echo "Next (TLS): sudo bash ${SCRIPT_DIR}/install-ssl.sh"
