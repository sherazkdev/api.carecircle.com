#!/usr/bin/env bash
# Build and start API + worker + Mongo. Host API port is 1001 (Nginx upstream).
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/care-circle-reminder}"
SECRETS_DIR="${SECRETS_DIR:-/var/www/care-circle-reminder/secrets}"
ENV_FILE="${ENV_FILE:-/var/www/care-circle-reminder/.env}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/deploy.sh"
  exit 1
fi

if [[ ! -d "${APP_DIR}/.git" && ! -f "${APP_DIR}/docker-compose.yml" ]]; then
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

cd "${APP_DIR}"

export API_HOST_PORT=1001
export FIREBASE_SERVICE_ACCOUNT_HOST_PATH="${SECRETS_DIR}/firebase-service-account.json"

docker compose up -d --build
docker compose ps
curl -fsS --max-time 20 "http://127.0.0.1:1001/health/ready"
echo
echo "API is healthy on 127.0.0.1:1001"
