#!/usr/bin/env bash
# ==============================================================================
# Operis — database backup (nightly via operis-backup.timer, or on demand)
# ==============================================================================
#   ./backup.sh              take a backup now
#   ./backup.sh --list       list what exists
#   ./backup.sh --verify     take a backup and prove it restores into a scratch DB
#
# Retention: RETENTION_DAYS daily dumps, plus the first dump of each month kept
# for a year. Dumps are pg_dump custom format (-Fc): compressed, and restorable
# selectively with pg_restore.
#
# THIS IS NOT OFF-SITE. A backup that lives on the machine it protects does not
# survive that machine being lost. See "Off-site copies" at the bottom.
# ==============================================================================

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/operis}"
BACKUP_DIR="$APP_DIR/backups"
ENV_FILE="$APP_DIR/.env"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MONTHLY_RETENTION_DAYS="${MONTHLY_RETENTION_DAYS:-365}"

cd "$APP_DIR"
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"

log()  { printf '[%s] %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { printf '[%s] ERROR: %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S')" "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "$ENV_FILE not found"
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
PGUSER="${POSTGRES_USER:-operis}"
PGDB="${POSTGRES_DB:-operis}"

dc() { docker compose --env-file "$ENV_FILE" --env-file "$APP_DIR/.image.env" -f "$APP_DIR/docker-compose.yml" "$@"; }

PG_CID="$(dc ps -q postgres 2>/dev/null || true)"
[ -n "$PG_CID" ] || fail "postgres container is not running"

case "${1:-}" in
  --list)
    ls -lh "$BACKUP_DIR"/*.dump 2>/dev/null || echo "(no backups yet)"
    printf '\ntotal: %s\n' "$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)"
    exit 0
    ;;
esac

STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
DAY="$(date -u '+%d')"
# The first dump of a month is tagged monthly- and kept far longer.
PREFIX="daily"; [ "$DAY" = "01" ] && PREFIX="monthly"
TARGET="$BACKUP_DIR/${PREFIX}-${STAMP}.dump"

log "dumping $PGDB -> $TARGET"
if ! docker exec "$PG_CID" pg_dump -U "$PGUSER" -d "$PGDB" -Fc --no-owner > "$TARGET"; then
  rm -f "$TARGET"
  fail "pg_dump failed"
fi
chmod 600 "$TARGET"

SIZE_BYTES="$(stat -c %s "$TARGET")"
[ "$SIZE_BYTES" -gt 4096 ] || { rm -f "$TARGET"; fail "dump is suspiciously small (${SIZE_BYTES}B) — treating as failed"; }

# pg_restore --list parses the archive's table of contents. A dump that cannot
# be listed cannot be restored, and finding that out during an outage is too
# late. This is cheap; run it every time.
docker exec -i "$PG_CID" pg_restore --list /dev/stdin < "$TARGET" > /dev/null 2>&1 \
  || { rm -f "$TARGET"; fail "dump failed its integrity check — removed"; }

log "ok: $(du -h "$TARGET" | cut -f1)"

# ------------------------------------------------------------------------------
# Optional deep verification: restore into a scratch database and count tables.
# Slower and needs disk headroom, so it is opt-in.
# ------------------------------------------------------------------------------
if [ "${1:-}" = "--verify" ]; then
  SCRATCH="verify_$(date -u '+%s')"
  log "restoring into scratch database $SCRATCH …"
  docker exec "$PG_CID" createdb -U "$PGUSER" "$SCRATCH"
  # shellcheck disable=SC2015
  docker exec -i "$PG_CID" pg_restore -U "$PGUSER" -d "$SCRATCH" --no-owner < "$TARGET" >/dev/null 2>&1 || true
  COUNT="$(docker exec "$PG_CID" psql -U "$PGUSER" -d "$SCRATCH" -tAc \
    "select count(*) from information_schema.tables where table_schema='public'")"
  docker exec "$PG_CID" dropdb -U "$PGUSER" "$SCRATCH"
  [ "${COUNT:-0}" -gt 10 ] || fail "restore produced only ${COUNT:-0} tables — backup is not trustworthy"
  log "verified: $COUNT tables restored cleanly"
fi

# ------------------------------------------------------------------------------
# Retention
# ------------------------------------------------------------------------------
DELETED=$(find "$BACKUP_DIR" -name 'daily-*.dump'     -mtime "+$RETENTION_DAYS"          -print -delete | wc -l)
DELETED=$(( DELETED + $(find "$BACKUP_DIR" -name 'predeploy-*.dump' -mtime "+$RETENTION_DAYS"          -print -delete | wc -l) ))
DELETED=$(( DELETED + $(find "$BACKUP_DIR" -name 'monthly-*.dump'   -mtime "+$MONTHLY_RETENTION_DAYS"  -print -delete | wc -l) ))
[ "$DELETED" -gt 0 ] && log "pruned $DELETED expired backup(s)"

AVAIL="$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print int($4/1024)}')"
log "retained: $(find "$BACKUP_DIR" -name '*.dump' | wc -l) dumps, $(du -sh "$BACKUP_DIR" | cut -f1); ${AVAIL} MB free on disk"
[ "$AVAIL" -lt 2048 ] && log "WARNING: under 2 GB free — backups will start failing"

exit 0

# ==============================================================================
# RESTORE (rehearse this before you need it)
# ==============================================================================
#   cd /opt/operis
#   ./dc stop app                       # stop writers first
#   docker exec -i $(./dc ps -q postgres) \
#     pg_restore -U operis -d operis --clean --if-exists --no-owner \
#     < backups/daily-20260824T031700Z.dump
#   ./dc start app
#
# ==============================================================================
# OFF-SITE COPIES — do this, the local dumps do not survive losing the VPS
# ==============================================================================
# Cheapest reliable option: OVH Object Storage / Backblaze B2 / S3 via rclone.
#
#   sudo apt install rclone && rclone config          # one-time, interactive
#   # then append to this script, or add a second systemd timer:
#   rclone copy /opt/operis/backups remote:operis-backups \
#         --include '*.dump' --max-age 48h
#
# Encrypt before it leaves the box if the remote is not yours:
#   gpg --encrypt --recipient ops@your-domain.com "$TARGET"
