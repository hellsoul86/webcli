#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root or via sudo." >&2
  exit 1
fi

if [[ -z "${WEBCLI_STAGING_SERVICE_INSTANCE:-}" ]]; then
  echo "Set WEBCLI_STAGING_SERVICE_INSTANCE to the Unix user that already ran codex login." >&2
  exit 1
fi

SERVICE_USER="${WEBCLI_STAGING_SERVICE_INSTANCE}"
SERVICE_GROUP="${WEBCLI_STAGING_SERVICE_GROUP:-${SERVICE_USER}}"
APP_ROOT="${WEBCLI_STAGING_ROOT:-/srv/webcli-staging}"
SERVICE_NAME="${WEBCLI_STAGING_SERVICE_NAME:-webcli-staging@${SERVICE_USER}}"
SOURCE_DIR="$(git rev-parse --show-toplevel)"
RELEASES_DIR="${APP_ROOT}/releases"
SHARED_DIR="${APP_ROOT}/shared"
CURRENT_LINK="${APP_ROOT}/current"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%S)"
GIT_SHA="$(git -C "${SOURCE_DIR}" rev-parse --short HEAD)"
RELEASE_ID="${WEBCLI_STAGING_RELEASE_ID:-${TIMESTAMP}-${GIT_SHA}}"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  echo "Unix user '${SERVICE_USER}' does not exist." >&2
  exit 1
fi

if ! command -v runuser >/dev/null 2>&1; then
  echo "runuser is required on the server to build releases as ${SERVICE_USER}." >&2
  exit 1
fi

mkdir -p "${RELEASES_DIR}" "${SHARED_DIR}"
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" "${SHARED_DIR}/data"
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" "${RELEASE_DIR}"

rsync -a \
  --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "output" \
  --exclude ".codex" \
  --exclude ".DS_Store" \
  "${SOURCE_DIR}/" "${RELEASE_DIR}/"

chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${RELEASE_DIR}"

runuser -u "${SERVICE_USER}" -- npm --prefix "${RELEASE_DIR}" ci
runuser -u "${SERVICE_USER}" -- npm --prefix "${RELEASE_DIR}" run build

ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"

systemctl restart "${SERVICE_NAME}"
systemctl reload nginx

echo "Deployed release ${RELEASE_ID}"
echo "Current release: $(readlink "${CURRENT_LINK}")"
