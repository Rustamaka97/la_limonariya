#!/usr/bin/env bash
# Кунлик шифрланган логик бэкап (pg_dump | gzip | AES-256).
# Cron (03:00): 0 3 * * * BACKUP_PASSPHRASE=... /srv/limonariya/docker/backup.sh >> /var/log/limon-backup.log 2>&1
# Талаб: BACKUP_PASSPHRASE (.env'да ёки муҳитда). Ихтиёрий: BACKUP_DIR, RETENTION_DAYS.
set -euo pipefail

cd "$(dirname "$0")/.."           # repo/compose root
[ -f .env ] && set -a && . ./.env && set +a

: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE kerak — shifrlash kaliti, uni .env ga kiriting}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/limonariya}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DB_USER="${POSTGRES_USER:-limon}"
DB_NAME="${POSTGRES_DB:-limonariya}"

mkdir -p "$BACKUP_DIR"
ts="$(date +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/limon-$ts.sql.gz.enc"
tmp="$out.partial"

# pipefail'дан фойда: занжирнинг ҳар бўғини хато берса, mv бажарилмайди → чала
# бэкап сақланмайди (.partial тозаланади).
trap 'rm -f "$tmp"' EXIT
docker compose exec -T postgres \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --clean --if-exists \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE \
  > "$tmp"
mv "$tmp" "$out"
trap - EXIT

# retention — эски бэкапларни ўчириш
find "$BACKUP_DIR" -name 'limon-*.sql.gz.enc' -type f -mtime +"$RETENTION_DAYS" -delete

echo "✓ backup: $out ($(du -h "$out" | cut -f1)) · retention ${RETENTION_DAYS}d"
