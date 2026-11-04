#!/usr/bin/env bash
# Native build + systemd start. Listens on 127.0.0.1 via PORT=1001 (Nginx upstream).
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/care-circle-reminder}"
SECRETS_DIR="${SECRETS_DIR:-/var/www/care-circle-reminder/secrets}"
ENV_FILE="${ENV_FILE:-/var/www/care-circle-reminder/.env}"
SERVICE_NAME="care-circle-reminder"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/deploy.sh"
  exit 1
fi

if [[ ! -f "${APP_DIR}/package.json" ]]; then
  echo "Missing app at ${APP_DIR}. Clone the repo there first."
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Copy deploy/env.production.example and fill secrets."
  exit 1
fi

if [[ ! -f "${SECRETS_DIR}/firebase-service-account.json" ]]; then
  echo "Missing ${SECRETS_DIR}/firebase-service-account.json"
  exit 1
fi

if grep -Eq '^MONGODB_URI=.*://mongo:' "${ENV_FILE}"; then
  echo "Fix ${ENV_FILE}: MONGODB_URI must be mongodb://127.0.0.1:27017/care_circle (no Docker)."
  exit 1
fi

if grep -Eq '^PORT=3000[[:space:]]*$' "${ENV_FILE}"; then
  echo "Fix ${ENV_FILE}: set PORT=1001 so Nginx can reach the API."
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v mongod >/dev/null 2>&1; then
  echo "Node or MongoDB missing. Run: sudo bash ${APP_DIR}/deploy/setup-vps.sh"
  exit 1
fi

systemctl enable --now mongod 2>/dev/null || systemctl enable --now mongodb

cd "${APP_DIR}"
npm ci
npm run build

id -u www-data >/dev/null
chown -R www-data:www-data "${APP_DIR}"
chmod 750 "${SECRETS_DIR}"
chmod 640 "${SECRETS_DIR}/firebase-service-account.json" "${ENV_FILE}"

NODE_BIN="$(command -v node)"
sed "s#/usr/bin/node#${NODE_BIN}#" "${APP_DIR}/deploy/care-circle-reminder.service" \
  > "/etc/systemd/system/${SERVICE_NAME}.service"

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"
sleep 2
systemctl --no-pager --full status "${SERVICE_NAME}" || true

curl -fsS --max-time 20 "http://127.0.0.1:1001/health/ready"
echo
echo "API is healthy on 127.0.0.1:1001 (systemd: ${SERVICE_NAME})"
