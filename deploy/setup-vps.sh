#!/usr/bin/env bash
# Ubuntu VPS bootstrap: Docker, Nginx, firewall, HTTP site, Compose on host port 1001.
set -euo pipefail

DOMAIN="${DOMAIN:-carecircle.smartremindersapp.com}"
SITE_NAME="${SITE_NAME:-care-circle-reminder}"
APP_DIR="${APP_DIR:-/opt/care-circle-reminder}"
SECRETS_DIR="${SECRETS_DIR:-/opt/care-circle-reminder/secrets}"
NGINX_SITE="/etc/nginx/sites-available/${SITE_NAME}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/setup-vps.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git ufw nginx certbot python3-certbot-nginx

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

usermod -aG docker "${SUDO_USER:-root}" || true

mkdir -p /var/www/certbot "${SECRETS_DIR}"
chmod 700 "${SECRETS_DIR}"

if [[ ! -f "${SECRETS_DIR}/firebase-service-account.json" ]]; then
  echo "Place Firebase Admin JSON at ${SECRETS_DIR}/firebase-service-account.json then run deploy.sh"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "${SCRIPT_DIR}/nginx/care-circle-reminder.http.conf" "${NGINX_SITE}"
ln -sfn "${NGINX_SITE}" "/etc/nginx/sites-enabled/${SITE_NAME}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "HTTP Nginx site '${SITE_NAME}' is ready for ${DOMAIN}."
echo "App folder: ${APP_DIR}"
echo "Next: clone repo if missing, copy .env + Firebase JSON, then:"
echo "  sudo bash ${APP_DIR}/deploy/deploy.sh"
echo "  sudo bash ${APP_DIR}/deploy/install-ssl.sh"
