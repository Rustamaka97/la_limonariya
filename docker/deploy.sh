#!/usr/bin/env bash
# Хавфсиз деплой: деплойгача бэкап → build → up → healthcheck → 200 бермаса
# эски образларга rollback. Ишлатиш: ./docker/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

HEALTH_URL="${HEALTH_URL:-http://localhost:${WEB_PORT:-8080}/api/health}"
TRIES="${HEALTH_TRIES:-30}"

echo "▶ 1/5 деплойгача бэкап…"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  ./docker/backup.sh || echo "⚠️  бэкап ўтказилди (давом этамиз)"
else
  echo "⚠️  BACKUP_PASSPHRASE йўқ — бэкапсиз давом (тавсия этилмайди)"
fi

echo "▶ 2/5 жорий образларни эслаб қолиш (rollback учун)…"
prev_api="$(docker compose images -q api 2>/dev/null || true)"
prev_web="$(docker compose images -q web 2>/dev/null || true)"

echo "▶ 3/5 build + up…"
docker compose build
docker compose up -d

echo "▶ 4/5 healthcheck: $HEALTH_URL"
ok=""
for _ in $(seq 1 "$TRIES"); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done

if [ -n "$ok" ]; then
  echo "✓ 5/5 healthcheck OK — деплой муваффақиятли"
  exit 0
fi

echo "✗ healthcheck FAIL (${TRIES}×2s) — rollback…"
if [ -n "$prev_api" ] && [ -n "$prev_web" ]; then
  docker tag "$prev_api" limonariya-api:latest
  docker tag "$prev_web" limonariya-web:latest
  docker compose up -d --no-build
  echo "↩ эски образларга қайтарилди. Логлар: docker compose logs -n 100 api"
else
  echo "⚠️  эски образ топилмади (биринчи деплой?) — қўлда текширинг: docker compose logs api"
fi
exit 1
