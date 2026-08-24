#!/usr/bin/env bash
# ==============================================================================
# Operis — release script (runs ON the server, invoked over SSH by CI)
# ==============================================================================
#   pull image -> back up the database -> start -> wait for health
#                                              └─ on failure: roll the image back
#
# Usage:
#   ./deploy.sh <image-tag>          e.g. ./deploy.sh sha-1a2b3c4
#   ./deploy.sh --rollback           return to the previously deployed tag
#   ./deploy.sh --status             what is running right now
#
# Safe to re-run: deploying a tag that is already live just restarts cleanly.
# ==============================================================================

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/operis}"
COMPOSE_FILE="$APP_DIR/docker-compose.yml"
ENV_FILE="$APP_DIR/.env"
IMAGE_ENV_FILE="$APP_DIR/.image.env"
STATE_FILE="$APP_DIR/.deploy-state"
LOCK_FILE="$APP_DIR/.deploy.lock"
LOG_FILE="$APP_DIR/logs/deploy.log"
BACKUP_DIR="$APP_DIR/backups"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-600}"   # seconds; first boot runs migrations

cd "$APP_DIR"

log()  { printf '[%s] %s\n' "$(date -u '+%H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }
fail() { printf '[%s] ERROR: %s\n' "$(date -u '+%H:%M:%S')" "$*" | tee -a "$LOG_FILE" >&2; exit 1; }

dc() { docker compose --env-file "$ENV_FILE" --env-file "$IMAGE_ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

mkdir -p "$(dirname "$LOG_FILE")" "$BACKUP_DIR"
# Compose is invoked with both env files; the tag file may not exist yet on a
# freshly bootstrapped server.
[ -f "$IMAGE_ENV_FILE" ] || printf 'APP_IMAGE_TAG=latest\n' > "$IMAGE_ENV_FILE"

# ------------------------------------------------------------------------------
read_state() { [ -f "$STATE_FILE" ] && grep -E "^$1=" "$STATE_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
write_state() {
  local current="$1" previous="$2"
  printf 'CURRENT_TAG=%s\nPREVIOUS_TAG=%s\nDEPLOYED_AT=%s\n' \
    "$current" "$previous" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$STATE_FILE"
}

status() {
  printf '\n=== deploy state ===\n'
  [ -f "$STATE_FILE" ] && cat "$STATE_FILE" || echo "(never deployed)"
  printf '\n=== containers ===\n'
  dc ps
  printf '\n=== health ===\n'
  for svc in app postgres redis meilisearch caddy; do
    cid="$(dc ps -q "$svc" 2>/dev/null || true)"
    if [ -n "$cid" ]; then
      printf '%-12s %s\n' "$svc" "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null)"
    else
      printf '%-12s not running\n' "$svc"
    fi
  done
}

# ------------------------------------------------------------------------------
# Wait until the app container reports healthy. Bails out early if the container
# died, rather than burning the whole timeout on a container that will never
# come back.
# ------------------------------------------------------------------------------
wait_for_health() {
  local deadline=$(( SECONDS + HEALTH_TIMEOUT )) cid state health
  log "waiting for app health (timeout ${HEALTH_TIMEOUT}s)…"
  while [ "$SECONDS" -lt "$deadline" ]; do
    cid="$(dc ps -q app 2>/dev/null || true)"
    if [ -n "$cid" ]; then
      state="$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo missing)"
      health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo none)"
      case "$state:$health" in
        running:healthy) log "app is healthy"; return 0 ;;
        exited:*|dead:*) log "app container exited (status=$state)"; return 1 ;;
      esac
      printf '.'
    fi
    sleep 5
  done
  printf '\n'
  log "health check timed out after ${HEALTH_TIMEOUT}s"
  return 1
}

backup_database() {
  local cid label
  cid="$(dc ps -q postgres 2>/dev/null || true)"
  [ -n "$cid" ] || { log "postgres not running — skipping pre-deploy backup (first deploy?)"; return 0; }
  label="predeploy-$(date -u '+%Y%m%dT%H%M%SZ')"
  log "backing up database -> $BACKUP_DIR/$label.dump"
  # -Fc (custom format) restores selectively with pg_restore and compresses.
  if docker exec "$cid" pg_dump -U "${POSTGRES_USER:-operis}" -d "${POSTGRES_DB:-operis}" -Fc \
       > "$BACKUP_DIR/$label.dump" 2>>"$LOG_FILE"; then
    chmod 600 "$BACKUP_DIR/$label.dump"
    log "backup complete ($(du -h "$BACKUP_DIR/$label.dump" | cut -f1))"
  else
    rm -f "$BACKUP_DIR/$label.dump"
    fail "pre-deploy backup FAILED — refusing to deploy over an un-backed-up database.
       Fix the database first, or set SKIP_BACKUP=1 if you accept the risk."
  fi
}

# ------------------------------------------------------------------------------
# Argument handling
# ------------------------------------------------------------------------------
case "${1:-}" in
  # Read-only, so it deliberately runs without taking the deploy lock — you
  # want `--status` to answer while a deploy is in flight, not block on it.
  --status)   status; exit 0 ;;
  --rollback)
    PREVIOUS="$(read_state PREVIOUS_TAG)"
    [ -n "$PREVIOUS" ] || fail "no previous tag recorded in $STATE_FILE"
    TAG="$PREVIOUS"
    log "MANUAL ROLLBACK to $TAG"
    ;;
  "")         fail "usage: $0 <image-tag> | --rollback | --status" ;;
  -*)         fail "unknown option: $1" ;;
  *)          TAG="$1" ;;
esac

# ------------------------------------------------------------------------------
# One deploy at a time. The workflow's concurrency group covers CI-driven runs;
# this covers a manual run landing on top of an automated one.
# ------------------------------------------------------------------------------
exec 9>"$LOCK_FILE"
flock -n 9 || fail "another deploy is in progress (lock: $LOCK_FILE)"

[ -f "$COMPOSE_FILE" ] || fail "$COMPOSE_FILE missing — CI syncs it; run the workflow once"
[ -f "$ENV_FILE" ]     || fail "$ENV_FILE missing — create it from deploy/env.production.example"

# Refuse to run with a world-readable secrets file.
perms="$(stat -c '%a' "$ENV_FILE")"
[ "$perms" = "600" ] || fail ".env has permissions $perms — run: chmod 600 $ENV_FILE"

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

: "${APP_IMAGE:?APP_IMAGE is not set in .env}"
: "${APP_DOMAIN:?APP_DOMAIN is not set in .env}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is not set in .env}"
: "${JWT_SECRET:?JWT_SECRET is not set in .env}"
[ "${#JWT_SECRET}" -ge 32 ] || fail "JWT_SECRET must be at least 32 characters (the app refuses to boot otherwise)"

PREVIOUS_TAG="$(read_state CURRENT_TAG)"

log "=============================================================="
log "deploying $APP_IMAGE:$TAG   (previous: ${PREVIOUS_TAG:-none})"
log "=============================================================="

# ------------------------------------------------------------------------------
# 1. Pull first. A registry/auth failure must not take the running app down.
# ------------------------------------------------------------------------------
printf 'APP_IMAGE_TAG=%s\n' "$TAG" > "$IMAGE_ENV_FILE"

log "pulling image…"
docker pull "$APP_IMAGE:$TAG" >>"$LOG_FILE" 2>&1 \
  || fail "cannot pull $APP_IMAGE:$TAG — is the server logged in to the registry?
       Run: docker login ghcr.io -u <github-user>"
log "pulled $(docker image inspect -f '{{index .RepoDigests 0}}' "$APP_IMAGE:$TAG" 2>/dev/null || echo "$APP_IMAGE:$TAG")"

# Sidecars too, so a compose `up` never stalls on a slow registry mid-restart.
dc pull --quiet caddy postgres redis meilisearch >>"$LOG_FILE" 2>&1 || true

# ------------------------------------------------------------------------------
# 2. Back up the database BEFORE the new container gets a chance to migrate it.
# ------------------------------------------------------------------------------
if [ "${SKIP_BACKUP:-0}" = "1" ]; then
  log "SKIP_BACKUP=1 — skipping pre-deploy backup"
else
  backup_database
fi

# ------------------------------------------------------------------------------
# 3. Start. The app container runs migrations itself on boot.
# ------------------------------------------------------------------------------
log "starting stack…"
dc up -d --remove-orphans >>"$LOG_FILE" 2>&1 || {
  log "compose up failed; recent app logs:"
  dc logs --tail 60 app 2>&1 | tee -a "$LOG_FILE"
  fail "compose up failed"
}

# ------------------------------------------------------------------------------
# 4. Verify, and roll the image back if it did not come up.
# ------------------------------------------------------------------------------
if wait_for_health; then
  write_state "$TAG" "${PREVIOUS_TAG:-}"
  log "deploy OK — $APP_IMAGE:$TAG is live at https://$APP_DOMAIN"

  # Keep the previous image so --rollback stays instant; drop everything older.
  docker image prune -af --filter "until=168h" >>"$LOG_FILE" 2>&1 || true
  log "done"
  exit 0
fi

log "--------------------------------------------------------------"
log "DEPLOY FAILED — last 80 lines of app log:"
log "--------------------------------------------------------------"
dc logs --tail 80 app 2>&1 | tee -a "$LOG_FILE"

if [ -z "${PREVIOUS_TAG:-}" ]; then
  fail "no previous tag to roll back to. The stack is left running so you can
       inspect it:  ./dc logs -f app"
fi

log "rolling back to $PREVIOUS_TAG …"
printf 'APP_IMAGE_TAG=%s\n' "$PREVIOUS_TAG" > "$IMAGE_ENV_FILE"
dc up -d --remove-orphans >>"$LOG_FILE" 2>&1 || true

if wait_for_health; then
  write_state "$PREVIOUS_TAG" "$PREVIOUS_TAG"
  log "rolled back to $PREVIOUS_TAG successfully"
else
  log "ROLLBACK ALSO UNHEALTHY — manual intervention required"
fi

# IMPORTANT: rolling the IMAGE back does not roll the DATABASE back. If the
# failed release applied a migration, the old image may be running against a
# newer schema. The pre-deploy dump in $BACKUP_DIR is the way out:
#   ./dc stop app
#   docker exec -i $(./dc ps -q postgres) pg_restore -U $POSTGRES_USER \
#       -d $POSTGRES_DB --clean --if-exists < backups/predeploy-<stamp>.dump
#   ./dc start app
fail "deploy failed; image rolled back. See $LOG_FILE"
