#!/bin/sh
set -eu

# Restore a backup produced by backup.sh. Run via:
#   docker compose run --rm --entrypoint /bin/sh backup /restore.sh limonariya_20260702_030000.sql.gz
# (filename relative to ./backups, or an absolute path). Defaults to the
# newest file in ./backups if no argument is given.
#
# DESTRUCTIVE: overwrites the current database with the dump's contents.
# There is no confirmation prompt — the caller passing an explicit filename
# (or accepting "restore the newest backup") is the confirmation.

DEST=/backups
file="${1:-}"

if [ -z "$file" ]; then
  file=$(ls -t "$DEST"/limonariya_*.sql.gz 2>/dev/null | head -1)
  [ -n "$file" ] || { echo "restore: no backups found in ${DEST}" >&2; exit 1; }
elif [ "${file#/}" = "$file" ]; then
  file="${DEST}/${file}"
fi

[ -f "$file" ] || { echo "restore: file not found: ${file}" >&2; exit 1; }

echo "restore: applying ${file} to ${POSTGRES_DB} ..."
gunzip -c "$file" | psql -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB"
echo "restore: done"
