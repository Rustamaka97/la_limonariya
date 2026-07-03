#!/usr/bin/env bash
# Backup (03:00) + Telegram кун хулосаси (23:00) cron'ларини ўрнатади (идемпотент).
# Ишлатиш: ./docker/install-cron.sh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

CRON_BACKUP="0 3 * * * cd $ROOT && ./docker/backup.sh >> /var/log/limon-backup.log 2>&1"
CRON_DIGEST="0 23 * * * cd $ROOT && docker compose exec -T api npx tsx src/telegram-digest.ts >> /var/log/limon-digest.log 2>&1"

# Эски limon қаторларини олиб ташлаб, янгиларини қўшамиз (қайта ишга тушса дубль эмас).
(
  crontab -l 2>/dev/null | grep -v 'limon-backup.log' | grep -v 'limon-digest.log' || true
  echo "$CRON_BACKUP"
  echo "$CRON_DIGEST"
) | crontab -

echo "✓ cron ўрнатилди:"
crontab -l | grep 'limon-' || true
