#!/bin/sh
set -e

DATA_ROOT="${RAILWAY_VOLUME_MOUNT_PATH:-/data}"

mkdir -p "$DATA_ROOT/prisma" "$DATA_ROOT/uploads/themes" "$DATA_ROOT/uploads/design-references"
chmod -R u+rwX "$DATA_ROOT" 2>/dev/null || true

export UPLOAD_THEMES_DIR="${UPLOAD_THEMES_DIR:-$DATA_ROOT/uploads/themes}"
export UPLOAD_DESIGN_REFERENCES_DIR="${UPLOAD_DESIGN_REFERENCES_DIR:-$DATA_ROOT/uploads/design-references}"
export DATABASE_URL="file:${DATA_ROOT}/prisma/prod.db"

echo "=== wordpress-bot startup ==="
echo "RAILWAY_VOLUME_MOUNT_PATH=${RAILWAY_VOLUME_MOUNT_PATH:-<not set>}"
echo "DATA_ROOT=${DATA_ROOT}"
echo "DATABASE_URL=${DATABASE_URL}"
echo "UPLOAD_THEMES_DIR=${UPLOAD_THEMES_DIR}"
ls -la "$DATA_ROOT" 2>/dev/null || echo "Cannot list ${DATA_ROOT}"
ls -la "$DATA_ROOT/prisma" 2>/dev/null || echo "Cannot list ${DATA_ROOT}/prisma"

npx prisma db push
touch "${DATA_ROOT}/prisma/.write-test" && rm -f "${DATA_ROOT}/prisma/.write-test"

exec npm run start:server
