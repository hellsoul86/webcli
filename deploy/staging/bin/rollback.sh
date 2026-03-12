#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root or via sudo." >&2
  exit 1
fi

if [[ $# -ne 1 ]]; then
  echo "Usage: rollback.sh <release-id>" >&2
  exit 1
fi

if [[ -z "${WEBCLI_STAGING_SERVICE_INSTANCE:-}" ]]; then
  echo "Set WEBCLI_STAGING_SERVICE_INSTANCE to the Unix user that owns the service." >&2
  exit 1
fi

SERVICE_USER="${WEBCLI_STAGING_SERVICE_INSTANCE}"
APP_ROOT="${WEBCLI_STAGING_ROOT:-/srv/webcli-staging}"
SERVICE_NAME="${WEBCLI_STAGING_SERVICE_NAME:-webcli-staging@${SERVICE_USER}}"
CURRENT_LINK="${APP_ROOT}/current"
TARGET_RELEASE="${APP_ROOT}/releases/$1"

if [[ ! -d "${TARGET_RELEASE}" ]]; then
  echo "Release does not exist: ${TARGET_RELEASE}" >&2
  exit 1
fi

ln -sfn "${TARGET_RELEASE}" "${CURRENT_LINK}"

systemctl restart "${SERVICE_NAME}"
systemctl reload nginx

echo "Rolled back to ${TARGET_RELEASE}"

