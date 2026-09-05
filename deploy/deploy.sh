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
# CI additionally passes:
#   --image  ghcr.io/owner/repo      which image to pull (authoritative)
#   --digest sha256:…                the artifact it built, verified after pull
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
  for svc in app postgres redis meilisearch; do
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
MODE=deploy
TAG=""
CLI_IMAGE=""
CLI_DIGEST=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --status)   MODE=status;   shift ;;
    --rollback) MODE=rollback; shift ;;
    --image)    CLI_IMAGE="${2:-}";  [ -n "$CLI_IMAGE" ]  || fail "--image needs a value";  shift 2 ;;
    --digest)   CLI_DIGEST="${2:-}"; [ -n "$CLI_DIGEST" ] || fail "--digest needs a value"; shift 2 ;;
    -*)         fail "unknown option: $1" ;;
    *)          [ -z "$TAG" ] || fail "unexpected argument: $1"; TAG="$1"; shift ;;
  esac
done

# Read-only, so it deliberately runs without taking the deploy lock — you want
# `--status` to answer while a deploy is in flight, not block on it.
if [ "$MODE" = status ]; then status; exit 0; fi

# Both values arrive over SSH from CI. Validate rather than trust: whatever
# lands here is interpolated into a docker command running as the deploy user.
if [ -n "$CLI_IMAGE" ]; then
  printf '%s' "$CLI_IMAGE" | grep -Eq '^[a-z0-9][a-z0-9._/-]*$' \
    || fail "--image is not a bare registry reference: $CLI_IMAGE
       Expected the form ghcr.io/owner/repo. The tag is passed separately, so
       a ':' here is a mistake rather than a tag."
fi
if [ -n "$CLI_DIGEST" ]; then
  printf '%s' "$CLI_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}$' \
    || fail "--digest is not a sha256 digest: $CLI_DIGEST"
fi

if [ "$MODE" = rollback ]; then
  PREVIOUS="$(read_state PREVIOUS_TAG)"
  [ -n "$PREVIOUS" ] || fail "no previous tag recorded in $STATE_FILE"
  TAG="$PREVIOUS"
  log "MANUAL ROLLBACK to $TAG"
  # The recorded tag was verified when it first shipped; the digest CI passed
  # belongs to the release we are backing out of, so it must not be reused.
  CLI_DIGEST=""
fi

[ -n "$TAG" ] || fail "usage: $0 <image-tag> [--image REF] [--digest sha256:…] | --rollback | --status"

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

# Read one variable out of .env.
#
# Deliberately NOT `. "$ENV_FILE"`. That file holds generated secrets, and
# sourcing it hands them to the shell to interpret: a '$' expands, a backtick
# executes, a '#' truncates. Worse, Docker Compose parses the same file with
# its own non-shell parser, so a sourced value can silently disagree with what
# the container actually receives — and the check below would then be
# validating a string no process ever sees.
read_env() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -1
}

ENV_IMAGE="$(read_env APP_IMAGE)"
APP_DOMAIN="$(read_env APP_DOMAIN)"
POSTGRES_USER="$(read_env POSTGRES_USER)"; POSTGRES_USER="${POSTGRES_USER:-operis}"
POSTGRES_DB="$(read_env POSTGRES_DB)";     POSTGRES_DB="${POSTGRES_DB:-operis}"

# ------------------------------------------------------------------------------
# The env contract, checked before anything is pulled, backed up or restarted.
#
# The alternative is discovering a missing variable from a container that boots,
# crashes and triggers an automatic rollback — which reads like a bad release
# rather than an unset key. The manifest ships with the release (rsynced next to
# this script), so adding a required variable is a reviewed change rather than
# something to remember to do on the box afterwards.
# ------------------------------------------------------------------------------
REQUIRED_ENV_FILE="$APP_DIR/required-env"

check_required_env() {
  local key minlen value bad=0 line
  if [ ! -f "$REQUIRED_ENV_FILE" ]; then
    log "no $REQUIRED_ENV_FILE on this server — skipping env contract check"
    return 0
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="$(printf '%s' "$line" | tr -d '[:space:]')"
    [ -n "$line" ] || continue
    key="${line%%:*}"
    minlen=""
    if [ "$line" != "$key" ]; then minlen="${line##*:}"; fi
    value="$(read_env "$key")"
    if [ -z "$value" ]; then
      printf '       missing:   %s\n' "$key" >&2
      bad=$((bad + 1))
    elif [ -n "$minlen" ] && [ "${#value}" -lt "$minlen" ]; then
      printf '       too short: %s (%s chars, needs %s)\n' "$key" "${#value}" "$minlen" >&2
      bad=$((bad + 1))
    fi
  done < "$REQUIRED_ENV_FILE"
  [ "$bad" -eq 0 ] || fail "$bad required variable(s) missing or too short in $ENV_FILE.
       The contract is $REQUIRED_ENV_FILE and ships with the release. Generate
       secrets with the snippet at the top of deploy/env.production.example."
}
check_required_env

# Conditional, so it cannot live in the manifest: the fallback key only matters
# when encryption is on — but with encryption on and the key absent, already
# encrypted tenant data is unreadable.
if [ "$(read_env TENANT_DATA_ENCRYPTION)" = "true" ]; then
  [ -n "$(read_env TENANT_DATA_ENCRYPTION_FALLBACK_KEY)" ] \
    || fail "TENANT_DATA_ENCRYPTION=true but TENANT_DATA_ENCRYPTION_FALLBACK_KEY is empty.
       Encrypted tenant data would be unreadable. Set the key, or set
       TENANT_DATA_ENCRYPTION=false if this deployment stores no PII."
fi

# ------------------------------------------------------------------------------
# Which image to pull. CI is authoritative.
#
# CI derives the image from the GitHub repository at build time and hands it over
# with --image; the copy in .env is only a fallback for manual runs on the box.
# Stating this one fact in two places is what broke a deploy once already: the
# repository moved organisations, CI followed it automatically, the hand-edited
# copy on the server did not, and the mismatch surfaced as a pull failure that
# reads exactly like a registry login problem.
# ------------------------------------------------------------------------------
APP_IMAGE="${CLI_IMAGE:-$ENV_IMAGE}"
[ -n "$APP_IMAGE" ] || fail "no image to deploy — CI passed no --image and APP_IMAGE is unset in $ENV_FILE"

if [ -n "$CLI_IMAGE" ] && [ -n "$ENV_IMAGE" ] && [ "$CLI_IMAGE" != "$ENV_IMAGE" ]; then
  log "note: deploying $CLI_IMAGE (from CI); $ENV_FILE says APP_IMAGE=$ENV_IMAGE"
  log "      the .env value is unused — correct or delete it at your convenience"
fi

# The gateway network belongs to the pca-erp stack, not to this compose file.
# Without this check a missing/renamed network surfaces as an opaque compose
# error after the pull and the backup have already run.
EDGE_NET="$(read_env EDGE_NETWORK)"; EDGE_NET="${EDGE_NET:-pca-erp-network}"
docker network inspect "$EDGE_NET" >/dev/null 2>&1 || fail "docker network '$EDGE_NET' does not exist.
       Operis joins it so pca-erp-nginx can reach the app container. If the
       pca-erp stack was renamed or torn down, set EDGE_NETWORK in .env to the
       right network. Check with: docker network ls"

PREVIOUS_TAG="$(read_state CURRENT_TAG)"

log "=============================================================="
log "deploying $APP_IMAGE:$TAG   (previous: ${PREVIOUS_TAG:-none})"
log "=============================================================="

# ------------------------------------------------------------------------------
# 1. Pull first. A registry/auth failure must not take the running app down.
# ------------------------------------------------------------------------------
# Compose resolves ${APP_IMAGE} from the env files it is given, and the later
# --env-file wins — so writing the image here is what makes the CI-supplied
# value reach the container rather than the stale copy in .env.
printf 'APP_IMAGE=%s\nAPP_IMAGE_TAG=%s\n' "$APP_IMAGE" "$TAG" > "$IMAGE_ENV_FILE"

log "pulling image…"
# docker's own stderr is the only thing that distinguishes "unauthorized" from
# "manifest unknown" from a timeout mid-layer, and it lands in $LOG_FILE on the
# server — where a CI reader cannot see it. Capture it and echo it with the
# hints, or a failed deploy shows three guesses and no evidence.
PULL_OUTPUT="$(docker pull "$APP_IMAGE:$TAG" 2>&1)" && PULL_OK=1 || PULL_OK=0
printf '%s\n' "$PULL_OUTPUT" >>"$LOG_FILE"
if [ "$PULL_OK" -ne 1 ]; then
  printf '%s\n' "--- docker pull output ---" "$(printf '%s\n' "$PULL_OUTPUT" | tail -20)" "--------------------------" >&2
  fail "cannot pull $APP_IMAGE:$TAG
       1. The server is not authenticated to the registry. CI logs it in for the
          life of the run; a manual deploy needs:
            docker login ghcr.io -u <github-user>
       2. The tag does not exist in that repository. Compare it with the
          'Building ghcr.io/…' line in the build job.
       3. The package is not readable by this account — check that the GHCR
          package is linked to the repository and its visibility matches.
       4. The pull started but did not finish — a timeout or a full disk mid-layer.
          The docker output above says which."
fi

# ------------------------------------------------------------------------------
# Verify we got the artifact CI built.
#
# A tag is a mutable pointer: it can be re-pushed, and an identically tagged
# image already on this host would satisfy the pull without a download. The
# digest is the only stable identity, so when CI tells us which one it built,
# a mismatch stops the deploy here — before the backup and before anything
# restarts.
# ------------------------------------------------------------------------------
PULLED_REF="$(docker image inspect -f '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$APP_IMAGE:$TAG" 2>/dev/null || true)"
PULLED_DIGEST="${PULLED_REF##*@}"
log "pulled ${PULLED_REF:-$APP_IMAGE:$TAG}"

if [ -n "$CLI_DIGEST" ]; then
  [ "$PULLED_DIGEST" = "$CLI_DIGEST" ] || fail "digest mismatch — refusing to deploy.
       CI built:      $CLI_DIGEST
       server pulled: ${PULLED_DIGEST:-<none>}
       The tag $TAG no longer resolves to the image this run produced. Either it
       was re-pushed, or the registry served a stale manifest. Nothing has been
       changed on this server."
  log "digest verified"
else
  log "no digest supplied (manual run or redeploy of an existing tag) — digest not verified"
fi

# Sidecars too, so a compose `up` never stalls on a slow registry mid-restart.
dc pull --quiet postgres redis meilisearch translation >>"$LOG_FILE" 2>&1 || true

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
printf 'APP_IMAGE=%s\nAPP_IMAGE_TAG=%s\n' "$APP_IMAGE" "$PREVIOUS_TAG" > "$IMAGE_ENV_FILE"
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
