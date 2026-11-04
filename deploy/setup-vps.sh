#!/usr/bin/env bash
# Native VPS bootstrap (no Docker): Node 22, MongoDB, Nginx, firewall.
set -euo pipefail

DOMAIN="${DOMAIN:-carecircle.smartremindersapp.com}"
SITE_NAME="${SITE_NAME:-care-circle-reminder}"
APP_DIR="${APP_DIR:-/var/www/care-circle-reminder}"
SECRETS_DIR="${SECRETS_DIR:-/var/www/care-circle-reminder/secrets}"
NGINX_SITE="/etc/nginx/sites-available/${SITE_NAME}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/setup-vps.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git ufw nginx certbot python3-certbot-nginx \
  build-essential

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -Eq '^v(2[0-9]|[3-9][0-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v mongod >/dev/null 2>&1; then
  . /etc/os-release
  CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-jammy}}"
  case "${CODENAME}" in
    noble|oracular|plucky) MONGO_SUITE="jammy" ;;
    *) MONGO_SUITE="${CODENAME}" ;;
  esac
  curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
    | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
  echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu ${MONGO_SUITE}/mongodb-org/7.0 multiverse" \
    > /etc/apt/sources.list.d/mongodb-org-7.0.list
  apt-get update
  apt-get install -y mongodb-org
fi

systemctl enable --now mongod || systemctl enable --now mongodb

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

echo "Native setup ready (no Docker)."
echo "Node: $(node -v)  npm: $(npm -v)"
echo "App folder: ${APP_DIR}"
echo "Next:"
echo "  sudo bash ${APP_DIR}/deploy/deploy.sh"
echo "  sudo bash ${APP_DIR}/deploy/install-ssl.sh"
