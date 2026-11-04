#!/usr/bin/env bash
# Build + PM2 start. App listens on 127.0.0.1:1001 (Nginx upstream).
# Does not install Node, MongoDB, or Docker. Uses MongoDB Atlas via MONGODB_URI.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/care-circle-reminder}"
SECRETS_DIR="${SECRETS_DIR:-/var/www/care-circle-reminder/secrets}"
ENV_FILE="${ENV_FILE:-/var/www/care-circle-reminder/.env}"
ECOSYSTEM="${APP_DIR}/ecosystem.config.cjs"

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
  echo "Fix ${ENV_FILE}: use MongoDB Atlas (mongodb+srv://...), not Docker hostname mongo."
  exit 1
fi

if grep -Eq '^PORT=3000[[:space:]]*$' "${ENV_FILE}"; then
  echo "Fix ${ENV_FILE}: set PORT=1001 so Nginx can reach the API."
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js/npm not found on PATH."
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 not found. Install globally: npm i -g pm2"
  exit 1
fi

cd "${APP_DIR}"
npm ci
npm run build

chmod 750 "${SECRETS_DIR}"
chmod 640 "${SECRETS_DIR}/firebase-service-account.json" "${ENV_FILE}"

pm2 startOrReload "${ECOSYSTEM}" --update-env
pm2 save

sleep 2
curl -fsS --max-time 20 "http://127.0.0.1:1001/health/ready"
echo
echo "API is healthy on 127.0.0.1:1001 (pm2: care-circle-reminder)"
