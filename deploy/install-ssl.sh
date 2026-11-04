#!/usr/bin/env bash
# Issue / renew Let's Encrypt cert and switch Nginx to TLS.
set -euo pipefail

DOMAIN="${DOMAIN:-carecircle.smartremindersapp.com}"
SITE_NAME="${SITE_NAME:-care-circle-reminder}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-ops@smartremindersapp.com}"
NGINX_SITE="/etc/nginx/sites-available/${SITE_NAME}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/install-ssl.sh"
  exit 1
fi

if [[ ! -f "${SCRIPT_DIR}/nginx/care-circle-reminder.ssl.conf" ]]; then
  echo "Missing ${SCRIPT_DIR}/nginx/care-circle-reminder.ssl.conf"
  exit 1
fi

mkdir -p /var/www/certbot
certbot certonly --webroot \
  -w /var/www/certbot \
  -d "${DOMAIN}" \
  --email "${CERTBOT_EMAIL}" \
  --agree-tos \
  --non-interactive \
  --keep-until-expiring

if [[ ! -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
  curl -fsSL -o /etc/letsencrypt/options-ssl-nginx.conf \
    https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf
fi
if [[ ! -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
  openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048
fi

cp "${SCRIPT_DIR}/nginx/care-circle-reminder.ssl.conf" "${NGINX_SITE}"
nginx -t
systemctl reload nginx

echo "TLS is live: https://${DOMAIN}/health/ready"
echo "Nginx site: ${SITE_NAME}"
echo "Certbot renew timer: systemctl status certbot.timer"
