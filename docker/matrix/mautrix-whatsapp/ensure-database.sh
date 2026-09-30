#!/bin/sh
# Create the WhatsApp bridge's own Postgres role and database inside the
# homeserver's Postgres, if they are missing. Runs as a one-shot container
# before the bridge starts, in development and production alike.
#
# The bridge gets a role of its own rather than Synapse's credentials: it can
# then read and write its own database and nothing of the homeserver's.
#
# Idempotent. Re-running changes nothing except the role's password, which
# follows WHATSAPP_PG_PASSWORD so a rotated secret takes effect on next start.
# Every identifier and literal goes through format(%I / %L), so no value is
# ever spliced into SQL text.
set -eu

: "${WHATSAPP_PG_USER:?WHATSAPP_PG_USER is empty}"
: "${WHATSAPP_PG_PASSWORD:?WHATSAPP_PG_PASSWORD is empty}"
: "${WHATSAPP_PG_DATABASE:?WHATSAPP_PG_DATABASE is empty}"

psql -v ON_ERROR_STOP=1 \
  -v role="$WHATSAPP_PG_USER" \
  -v pw="$WHATSAPP_PG_PASSWORD" \
  -v db="$WHATSAPP_PG_DATABASE" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'role', :'pw') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
SQL

echo "mautrix-whatsapp database ready: $WHATSAPP_PG_DATABASE (role $WHATSAPP_PG_USER)"
