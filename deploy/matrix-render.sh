#!/usr/bin/env bash
# ==============================================================================
# Operis — render the Synapse homeserver for this stack (runs ON the server)
# ==============================================================================
#   ./matrix-render.sh                 render matrix/ from .env + matrix-template/
#   ./matrix-render.sh --init-secrets  write the Matrix values .env is missing
#   ./matrix-render.sh --check         validate .env and exit; write nothing
#
# deploy.sh runs the plain form on every deploy whose .env enables the `matrix`
# compose profile, so an edit to the committed template reaches the homeserver
# with the release that changed it. Run it by hand after editing a MATRIX_* or
# OM_MATRIX_* value, then `./dc restart synapse`.
#
# Every input is read from .env — the ONE place a stack's secrets live — and the
# appservice registration is written from the SAME tokens the app reads, so the
# two sides cannot disagree:
#   OM_MATRIX_SERVER_NAME        the domain half of every Matrix id   (one-way door)
#   OM_MATRIX_USER_PREFIX        the exclusive appservice namespace    (one-way door)
#   OM_MATRIX_SENDER_LOCALPART   OM_MATRIX_BOT_LOCALPART
#   OM_MATRIX_AS_TOKEN           OM_MATRIX_HS_TOKEN
#   OM_MATRIX_HOMESERVER_URL     how the app reaches Synapse; also public_baseurl
#   OM_MATRIX_APPSERVICE_URL     optional — set, the registration turns on push mode
#   MATRIX_PG_USER  MATRIX_PG_PASSWORD  MATRIX_PG_DATABASE
#   MATRIX_MACAROON_SECRET  MATRIX_FORM_SECRET  MATRIX_REGISTRATION_SHARED_SECRET
#
# Outputs land in matrix/ (mode 700), which docker-compose.yml bind-mounts as
# Synapse's /data:
#   homeserver.yaml            rendered from matrix-template/homeserver.yaml.template
#   log.config                 copied from matrix-template/
#   registration.operis.yaml   the appservice registration
#   signing.key                generated ONCE by Synapse's own tool, then never
#                              touched — it is the homeserver's identity
#   media_store/               uploaded files
#
# The template is docker/matrix/synapse/homeserver.yaml.template, the same file
# `yarn matrix:up` renders for development; CI syncs it here as matrix-template/.
# ==============================================================================

set -Eeuo pipefail

# Defaults to the directory this script LIVES IN, never a hardcoded path: a copy
# in /opt/operis-staging must render staging's homeserver, not production's.
APP_DIR="${APP_DIR:-$(cd -- "$(dirname -- "$0")" && pwd)}"
ENV_FILE="$APP_DIR/.env"
COMPOSE_FILE="$APP_DIR/docker-compose.yml"
TEMPLATE_DIR="$APP_DIR/matrix-template"
DATA_DIR="$APP_DIR/matrix"
REGISTRATION="$DATA_DIR/registration.operis.yaml"
HOMESERVER_YAML="$DATA_DIR/homeserver.yaml"

cd "$APP_DIR"

log()  { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# bash 5.2 makes `&` in a ${var//pat/rep} replacement stand for the matched text.
# Every value substituted below is a secret, a name or a URL: none may be
# reinterpreted, so the option is off whether or not this bash has it.
shopt -u patsub_replacement 2>/dev/null || true

[ -f "$ENV_FILE" ] || fail "$ENV_FILE missing"

# The same reader deploy.sh uses, for the same reason: never source a file of
# generated secrets — a '$' would expand, a backtick would execute.
read_env() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
env_or()   { local value; value="$(read_env "$1")"; printf '%s' "${value:-$2}"; }

MODE=render
case "${1:-}" in
  "")             ;;
  --check)        MODE=check ;;
  --init-secrets) MODE=init ;;
  -h|--help)      sed -n '2,35p' "$0"; exit 0 ;;
  *)              fail "unknown option: $1" ;;
esac

# ------------------------------------------------------------------------------
# --init-secrets: fill in what is missing, never touch what is set.
#
# Values go straight into .env, never to stdout — the same rule as init-env.sh —
# and an existing non-empty value is left alone, because rotating OM_MATRIX_AS_TOKEN
# invalidates the appservice's credential and changing OM_MATRIX_SERVER_NAME
# strands every id the homeserver has minted. Re-running is therefore safe.
# ------------------------------------------------------------------------------
ADDED=()
set_missing() {
  local key="$1" value="$2" tmp
  [ -z "$(read_env "$key")" ] || return 0
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # '|' as the sed delimiter: none of the generated alphabets contain it.
    # Rewritten through a temp file and `cat >` so the inode, owner and 600
    # mode of .env are preserved on every platform.
    tmp="$(mktemp "$APP_DIR/.env.tmp.XXXXXX")"
    sed "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" > "$tmp"
    cat "$tmp" > "$ENV_FILE"
    rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
  ADDED+=("$key")
}

if [ "$MODE" = init ]; then
  SERVER_NAME="$(read_env OM_MATRIX_SERVER_NAME)"
  [ -n "$SERVER_NAME" ] || fail "set OM_MATRIX_SERVER_NAME in $ENV_FILE first.
       It is embedded in every Matrix user id and room id this homeserver will
       ever mint and cannot be changed afterwards, so it is the one value this
       script will not choose for you. Staging must use a different name from
       production. See deploy/MATRIX.md \"Phase 0\"."
  command -v openssl >/dev/null || fail "openssl not found"
  umask 077

  # A file that does not end in a newline would glue the first appended key
  # onto its last line.
  [ -z "$(tail -c1 "$ENV_FILE")" ] || printf '\n' >> "$ENV_FILE"

  set_missing COMPOSE_PROFILES matrix
  set_missing MATRIX_PG_USER synapse
  set_missing MATRIX_PG_DATABASE synapse
  # Alphanumeric, like POSTGRES_PASSWORD: it is interpolated into a psycopg2
  # config and a compose file, where quoting characters are structure.
  set_missing MATRIX_PG_PASSWORD "$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)"
  for key in MATRIX_MACAROON_SECRET MATRIX_FORM_SECRET MATRIX_REGISTRATION_SHARED_SECRET \
             OM_MATRIX_AS_TOKEN OM_MATRIX_HS_TOKEN; do
    set_missing "$key" "$(openssl rand -hex 32)"
  done
  set_missing OM_MATRIX_HOMESERVER_URL http://synapse:8008
  set_missing OM_MATRIX_SENDER_LOCALPART operis
  set_missing OM_MATRIX_USER_PREFIX om_
  set_missing OM_MATRIX_BOT_LOCALPART om_bot
  # Phase 1 posture, stated rather than defaulted, so flipping a phase is
  # editing a line that is already there.
  set_missing OM_CHAT_TRANSPORT local
  set_missing OM_CHAT_MATRIX_MODE shadow
  # Synapse runs as this uid so matrix/ stays writable for the next render.
  set_missing SYNAPSE_UID "$(id -u)"
  set_missing SYNAPSE_GID "$(id -g)"

  if [ "${#ADDED[@]}" -eq 0 ]; then
    log "nothing to add — every Matrix value is already set in $ENV_FILE"
  else
    log "added ${#ADDED[@]} value(s) to $ENV_FILE:"
    for key in "${ADDED[@]}"; do log "  ✓ $key"; done
  fi

  case ",$(read_env COMPOSE_PROFILES)," in
    *,matrix,*) ;;
    *) log "
NOTE: COMPOSE_PROFILES is '$(read_env COMPOSE_PROFILES)' — add 'matrix' to it or
the homeserver services stay disabled." ;;
  esac

  cat <<NEXT

server_name: $SERVER_NAME   (permanent from the first start)

Next:
  ./matrix-render.sh --check          confirm the values validate
  ./deploy.sh <current-tag>           or: ./matrix-render.sh && ./dc up -d matrix-postgres synapse
  ./dc logs -f synapse                first start migrates the schema (~1-2 min)

Chat stays on Postgres (OM_CHAT_TRANSPORT=local) until you change it — Phase 2
and 3 are described in deploy/MATRIX.md.
NEXT
  exit 0
fi

# ------------------------------------------------------------------------------
# Validate. Everything the app would refuse at boot is refused here first, so a
# mistake stops a deploy while the old release is still serving.
# ------------------------------------------------------------------------------
MISSING=()
for key in OM_MATRIX_SERVER_NAME MATRIX_PG_PASSWORD MATRIX_MACAROON_SECRET MATRIX_FORM_SECRET \
           MATRIX_REGISTRATION_SHARED_SECRET OM_MATRIX_AS_TOKEN OM_MATRIX_HS_TOKEN; do
  [ -n "$(read_env "$key")" ] || MISSING+=("$key")
done
[ "${#MISSING[@]}" -eq 0 ] || fail "$ENV_FILE is missing: ${MISSING[*]}
       Run: ./matrix-render.sh --init-secrets   (fills in only what is missing)"

SERVER_NAME="$(read_env OM_MATRIX_SERVER_NAME)"
USER_PREFIX="$(env_or OM_MATRIX_USER_PREFIX om_)"
SENDER_LOCALPART="$(env_or OM_MATRIX_SENDER_LOCALPART operis)"
BOT_LOCALPART="$(env_or OM_MATRIX_BOT_LOCALPART om_bot)"
AS_TOKEN="$(read_env OM_MATRIX_AS_TOKEN)"
HS_TOKEN="$(read_env OM_MATRIX_HS_TOKEN)"
HOMESERVER_URL="$(env_or OM_MATRIX_HOMESERVER_URL http://synapse:8008)"
APPSERVICE_URL="$(read_env OM_MATRIX_APPSERVICE_URL)"
PG_USER="$(env_or MATRIX_PG_USER synapse)"
PG_PASSWORD="$(read_env MATRIX_PG_PASSWORD)"
PG_DATABASE="$(env_or MATRIX_PG_DATABASE synapse)"
MACAROON_SECRET="$(read_env MATRIX_MACAROON_SECRET)"
FORM_SECRET="$(read_env MATRIX_FORM_SECRET)"
REGISTRATION_SHARED_SECRET="$(read_env MATRIX_REGISTRATION_SHARED_SECRET)"

# The same rules packages/matrix/src/config.ts applies when the app boots.
printf '%s' "$SERVER_NAME" | grep -Eq '^[A-Za-z0-9.-]+(:[0-9]{1,5})?$' \
  || fail "OM_MATRIX_SERVER_NAME '$SERVER_NAME' is not a valid Matrix server name"
for pair in "OM_MATRIX_USER_PREFIX=$USER_PREFIX" "OM_MATRIX_SENDER_LOCALPART=$SENDER_LOCALPART" \
            "OM_MATRIX_BOT_LOCALPART=$BOT_LOCALPART"; do
  printf '%s' "${pair#*=}" | grep -Eq '^[a-z0-9._=/+-]+$' \
    || fail "${pair%%=*} '${pair#*=}' contains characters that are not valid in a Matrix localpart"
done
[ "$BOT_LOCALPART" != "$SENDER_LOCALPART" ] \
  || fail "OM_MATRIX_BOT_LOCALPART must differ from OM_MATRIX_SENDER_LOCALPART — Synapse refuses /sync for the appservice sender"
case "$BOT_LOCALPART" in
  "$USER_PREFIX"*) ;;
  *) fail "OM_MATRIX_BOT_LOCALPART '$BOT_LOCALPART' must start with OM_MATRIX_USER_PREFIX '$USER_PREFIX' so it falls inside the exclusive namespace" ;;
esac
[ "${#AS_TOKEN}" -ge 32 ] || fail "OM_MATRIX_AS_TOKEN is shorter than 32 characters"
[ "${#HS_TOKEN}" -ge 32 ] || fail "OM_MATRIX_HS_TOKEN is shorter than 32 characters"
case "$HOMESERVER_URL" in
  http://*|https://*) ;;
  *) fail "OM_MATRIX_HOMESERVER_URL must start with http:// or https://" ;;
esac
if [ -n "$APPSERVICE_URL" ]; then
  case "$APPSERVICE_URL" in
    http://*|https://*) ;;
    *) fail "OM_MATRIX_APPSERVICE_URL must start with http:// or https://" ;;
  esac
  case "$APPSERVICE_URL" in
    */_matrix/*|*/api/chat_matrix/*) fail "OM_MATRIX_APPSERVICE_URL must be the app's BASE address (e.g. http://operis-app:3000).
       Synapse appends /_matrix/app/v1/transactions/{txnId} itself; naming any
       part of that path here 404s every push." ;;
  esac
fi

# The two one-way doors. Compared against what was rendered last time, because
# that is what the homeserver has already been started with.
if [ -f "$HOMESERVER_YAML" ]; then
  RENDERED_NAME="$(sed -n 's/^server_name: "\(.*\)"$/\1/p' "$HOMESERVER_YAML" | head -1)"
  if [ -n "$RENDERED_NAME" ] && [ "$RENDERED_NAME" != "$SERVER_NAME" ]; then
    fail "refusing to change server_name from '$RENDERED_NAME' to '$SERVER_NAME'.
       Every user id and room id the homeserver has minted contains the old
       name; changing it strands all of them. Put OM_MATRIX_SERVER_NAME back.
       Starting over is a deliberate act: stop synapse, remove the
       matrix_postgres_data volume AND matrix/, then render again."
  fi
fi
if [ -f "$REGISTRATION" ]; then
  RENDERED_PREFIX="$(sed -n "s/^ *regex: '@\(.*\)\.\*:.*'$/\1/p" "$REGISTRATION" | head -1)"
  if [ -n "$RENDERED_PREFIX" ] && [ "$RENDERED_PREFIX" != "$USER_PREFIX" ]; then
    fail "refusing to change the appservice user prefix from '$RENDERED_PREFIX' to '$USER_PREFIX'.
       The exclusive namespace is what stops a real signup impersonating a chat
       identity, and every identity already created lives under the old prefix."
  fi
fi

if [ "$MODE" = check ]; then
  log "ok: server_name $SERVER_NAME, namespace @${USER_PREFIX}*, push mode $([ -n "$APPSERVICE_URL" ] && echo on || echo off)"
  exit 0
fi

# ------------------------------------------------------------------------------
# Render.
# ------------------------------------------------------------------------------
[ -f "$TEMPLATE_DIR/homeserver.yaml.template" ] && [ -f "$TEMPLATE_DIR/log.config" ] \
  || fail "$TEMPLATE_DIR is missing or incomplete — CI syncs it with each release; run the deploy workflow once"

umask 077
if [ -e "$DATA_DIR" ]; then
  [ -w "$DATA_DIR" ] || fail "$DATA_DIR is not writable by $(id -un).
       Synapse chowns /data to the uid it runs as. Set SYNAPSE_UID=$(id -u) and
       SYNAPSE_GID=$(id -g) in $ENV_FILE (--init-secrets does this on a fresh
       stack), then: sudo chown -R $(id -u):$(id -g) $DATA_DIR"
else
  mkdir -p "$DATA_DIR"
fi
chmod 700 "$DATA_DIR"
mkdir -p "$DATA_DIR/media_store"

# install_file SRC DEST — moves SRC into place only when it differs, so the
# caller (deploy.sh) can tell from a checksum whether synapse needs a restart.
install_file() {
  local src="$1" dest="$2"
  if [ -f "$dest" ] && cmp -s "$src" "$dest"; then
    rm -f "$src"
    printf 'unchanged'
  else
    mv -f "$src" "$dest"
    chmod 600 "$dest"
    printf 'changed'
  fi
}

# Generated by Synapse itself, once. The format is a specific ed25519 seed
# encoding; a hand-made key produces a homeserver that starts and then fails
# to sign anything. Never regenerated: a new key is a new homeserver identity
# and every room's history stops verifying.
if [ ! -s "$DATA_DIR/signing.key" ]; then
  IMAGE="$(sed -n 's/^ *image: *\(ghcr\.io\/element-hq\/synapse:[^ ]*\).*/\1/p' "$COMPOSE_FILE" | head -1)"
  [ -n "$IMAGE" ] || fail "cannot find the synapse image in $COMPOSE_FILE"
  KEY="$(docker run --rm --entrypoint /bin/sh "$IMAGE" -c 'generate_signing_key -o /dev/stdout')"
  case "$KEY" in
    "ed25519 "*) ;;
    *) fail "unexpected signing key output from $IMAGE: ${KEY:0:40}" ;;
  esac
  printf '%s\n' "$KEY" > "$DATA_DIR/signing.key"
  chmod 600 "$DATA_DIR/signing.key"
  log "generated $DATA_DIR/signing.key — BACK IT UP OFF THIS SERVER NOW (deploy/MATRIX.md \"Backups\")"
fi

# Placeholders are substituted with bash's literal replacement — a pattern in
# double quotes is not a glob — so a password containing '/', '&' or '\' lands
# byte for byte. A placeholder the template names but this script does not
# supply is a failure, and so is one left behind: Synapse would accept the
# literal string '${MATRIX_PG_PASSWORD}' as a password and fail to connect
# several confusing minutes later.
MATRIX_SERVER_NAME="$SERVER_NAME"
MATRIX_PUBLIC_BASEURL="${HOMESERVER_URL%/}/"
MATRIX_PG_USER="$PG_USER"
MATRIX_PG_PASSWORD="$PG_PASSWORD"
MATRIX_PG_DATABASE="$PG_DATABASE"
MATRIX_MACAROON_SECRET="$MACAROON_SECRET"
MATRIX_FORM_SECRET="$FORM_SECRET"
MATRIX_REGISTRATION_SHARED_SECRET="$REGISTRATION_SHARED_SECRET"

rendered="$(cat "$TEMPLATE_DIR/homeserver.yaml.template")"
for name in MATRIX_SERVER_NAME MATRIX_PUBLIC_BASEURL MATRIX_PG_USER MATRIX_PG_PASSWORD \
            MATRIX_PG_DATABASE MATRIX_MACAROON_SECRET MATRIX_FORM_SECRET \
            MATRIX_REGISTRATION_SHARED_SECRET; do
  placeholder='${'"$name"'}'
  rendered="${rendered//"$placeholder"/${!name}}"
done
if [[ "$rendered" =~ \$\{[A-Z0-9_]+\} ]]; then
  fail "template references ${BASH_REMATCH[0]} but this script has no value for it"
fi

tmp="$(mktemp "$DATA_DIR/.tmp.XXXXXX")"
printf '%s\n' "$rendered" > "$tmp"
HOMESERVER_STATE="$(install_file "$tmp" "$HOMESERVER_YAML")"

tmp="$(mktemp "$DATA_DIR/.tmp.XXXXXX")"
cat "$TEMPLATE_DIR/log.config" > "$tmp"
LOG_STATE="$(install_file "$tmp" "$DATA_DIR/log.config")"

# `url` is the appservice's BASE address: Synapse appends the transactions path
# itself. `null` means pull-only — the app polls /sync — which is the default
# until a bridge originates messages the app did not send.
if [ -n "$APPSERVICE_URL" ]; then
  PUSH_URL="\"${APPSERVICE_URL%/}/api/chat_matrix/appservice\""
else
  PUSH_URL="null"
fi
# The namespace regexes are single-quoted YAML scalars on purpose: a
# double-quoted one processes backslash escapes and rejects '\.'.
ESCAPED_SERVER_NAME="${SERVER_NAME//./\\.}"
tmp="$(mktemp "$DATA_DIR/.tmp.XXXXXX")"
cat > "$tmp" <<REG
# Matrix application service registration for Operis.
#
# Rendered by matrix-render.sh from this stack's .env — contains live credentials.
# \`url: null\` means the homeserver never pushes transactions; Operis pulls with
# /sync instead. Set OM_MATRIX_APPSERVICE_URL in .env and re-render to turn on
# push mode; the poll keeps running alongside it as the safety net.
id: operis-chat
url: ${PUSH_URL}
as_token: "${AS_TOKEN}"
hs_token: "${HS_TOKEN}"
sender_localpart: ${SENDER_LOCALPART}
namespaces:
  users:
    # Exclusive: no account outside the appservice may ever hold one of these
    # localparts, so an Operis identity cannot be impersonated by a real signup.
    - exclusive: true
      regex: '@${USER_PREFIX}.*:${ESCAPED_SERVER_NAME}'
  aliases:
    - exclusive: true
      regex: '#${USER_PREFIX}.*'
  rooms: []
# Operis rate limits in chat/lib/rateLimits.ts; a second, invisible limit inside
# Synapse would throttle backfill and be attributed to the wrong layer.
rate_limited: false
REG
REGISTRATION_STATE="$(install_file "$tmp" "$REGISTRATION")"

log "rendered $DATA_DIR for server_name $SERVER_NAME"
log "  homeserver.yaml           $HOMESERVER_STATE"
log "  log.config                $LOG_STATE"
log "  registration.operis.yaml  $REGISTRATION_STATE   (push mode $([ -n "$APPSERVICE_URL" ] && echo on || echo off))"
if [ "$HOMESERVER_STATE$LOG_STATE$REGISTRATION_STATE" != "unchangedunchangedunchanged" ]; then
  log "a running synapse reads these only at start: deploy.sh restarts it for you; by hand, ./dc restart synapse"
fi
