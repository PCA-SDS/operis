#!/usr/bin/env bash
# ==============================================================================
# Operis — generate /opt/operis/.env from the template
# ==============================================================================
# Runs ON the server, as the deploy user. Every generated secret is written
# straight into the file: none is printed to stdout, so none ends up in your
# terminal scrollback, your shell history, or a chat log.
#
#   scp deploy/env.production.example operis@SERVER:/tmp/operis.env.example
#   scp deploy/init-env.sh            operis@SERVER:/tmp/
#   ssh operis@SERVER 'bash /tmp/init-env.sh /tmp/operis.env.example'
#
# It refuses to overwrite an existing .env — rotating a live secret is a
# deliberate act with consequences (rotating JWT_SECRET signs everyone out;
# rotating the encryption keys orphans encrypted data), not something a
# re-run should do by accident.
#
# Values it does NOT invent, because only you know them, are listed at the end.
# ==============================================================================

set -Eeuo pipefail

TEMPLATE="${1:?usage: init-env.sh <path to env.production.example>}"
TARGET="${TARGET:-/opt/operis/.env}"

[ -r "$TEMPLATE" ] || { echo "ERROR: cannot read template: $TEMPLATE" >&2; exit 1; }
if [ -e "$TARGET" ]; then
  echo "ERROR: $TARGET already exists — refusing to overwrite." >&2
  echo "       To rotate a single value, edit the file by hand." >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "ERROR: openssl not found" >&2; exit 1; }

# 077 so the file is 600 from the instant it is created — never briefly 644
# with real secrets already in it.
umask 077
cp "$TEMPLATE" "$TARGET"

# set_var NAME VALUE — replaces the whole line, trailing comment included.
# '|' as the sed delimiter: hex and the stripped base64 alphabet cannot
# contain it, so no value can break out of the expression.
set_var() {
  local name="$1" value="$2"
  if ! grep -qE "^${name}=" "$TARGET"; then
    printf '%s=%s\n' "$name" "$value" >> "$TARGET"
    return
  fi
  sed -i "s|^${name}=.*|${name}=${value}|" "$TARGET"
}

hex32() { openssl rand -hex 32; }

echo "Generating secrets…"

for name in JWT_SECRET AUTH_SECRET NEXTAUTH_SECRET CONSENT_INTEGRITY_SECRET \
            TENANT_DATA_ENCRYPTION_FALLBACK_KEY LOOKUP_HASH_PEPPER \
            MEILISEARCH_MASTER_KEY; do
  set_var "$name" "$(hex32)"
  echo "  ✓ $name"
done

# Postgres password: alphanumeric only. It is interpolated into a DATABASE_URL
# by docker-compose, where '/', '+', '@' and ':' would be parsed as URL
# structure and silently truncate the password.
set_var POSTGRES_PASSWORD "$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)"
echo "  ✓ POSTGRES_PASSWORD"

# First-boot superadmin password. Also alphanumeric — it gets typed by a human
# on the first login, and ambiguous punctuation in a generated password is a
# support ticket waiting to happen.
SUPERADMIN_PW="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)"
set_var OM_INIT_SUPERADMIN_PASSWORD "$SUPERADMIN_PW"
echo "  ✓ OM_INIT_SUPERADMIN_PASSWORD"

chmod 600 "$TARGET"

cat <<EOF

Wrote $TARGET ($(stat -c '%a %U:%G' "$TARGET"))

STILL TO FILL IN BY HAND — the file will not pass deploy.sh's checks until the
first group is set:

  OM_INIT_SUPERADMIN_EMAIL   the account you will first sign in as
  ADMIN_EMAIL                onboarding notifications + last-resort mail sender

  RESEND_API_KEY             optional, but WITHOUT IT NOBODY CAN RESET A PASSWORD
  EMAIL_FROM                 must be on a domain verified with the mail provider
  OPENAI_API_KEY             optional; leave empty and the AI Assistant stays off

  nano $TARGET

Your first-login password is in the file. Read it once, change it in the UI
after signing in, then it no longer matters:

  grep OM_INIT_SUPERADMIN_PASSWORD $TARGET

BACK UP THESE TWO SOMEWHERE OTHER THAN THIS SERVER, NOW:

  TENANT_DATA_ENCRYPTION_FALLBACK_KEY
  LOOKUP_HASH_PEPPER

Operis encrypts personal data at rest with them. A database backup restored
without them is unreadable — they are not recoverable from anything else.

  grep -E 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY|LOOKUP_HASH_PEPPER' $TARGET
EOF
