#!/usr/bin/env bash
# Шифрланган бэкапни тиклаш. ⚠️ ХАВФЛИ — базани ТЎЛИҚ алмаштиради.
# Ишлатиш: ./docker/restore.sh /var/backups/limonariya/limon-YYYYmmdd-HHMMSS.sql.gz.enc
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE керак — бэкап калити}"
file="${1:?Ишлатиш: restore.sh <backup.sql.gz.enc>}"
[ -f "$file" ] || { echo "Файл топилмади: $file" >&2; exit 1; }
DB_USER="${POSTGRES_USER:-limon}"
DB_NAME="${POSTGRES_DB:-limonariya}"

if [ "${FORCE:-}" != "1" ]; then
  read -r -p "⚠️  '$DB_NAME' базаси '$(basename "$file")' билан ТЎЛИҚ алмаштирилади. Давом этамизми? (yes) " ans
  [ "$ans" = "yes" ] || { echo "бекор қилинди"; exit 1; }
fi

# --clean --if-exists дамп → объектларни дроп қилиб қайта яратади; ON_ERROR_STOP
# → биринчи хатода тўхтайди (ярим тикланиш йўқ).
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$file" \
  | gunzip \
  | docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q

echo "✓ тикланди: $file"
