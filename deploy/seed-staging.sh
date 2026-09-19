#!/usr/bin/env bash
# ==============================================================================
# Operis — seed QA tenants into STAGING
# ==============================================================================
# Creates the multi-tenant fixture QA works against: seven tenants, each with its
# own admin and employee, plus one platform superadmin.
#
#   ./seed-staging.sh              # seed
#   ./seed-staging.sh --dry-run    # print what it would run, touch nothing
#
# Runs ON the server. It execs `mercato auth seed-tenant` inside the staging app
# container, so the app's own DI container, encryption service and module setup
# hooks do the work — nothing here talks to Postgres directly.
#
# ------------------------------------------------------------------------------
# WHY NOT `mercato auth setup` PER TENANT
#
# `auth setup` mints a PLATFORM-WIDE superadmin as its primary user, by design
# and by its own documentation. Seeded that way, admin@y.com could read and write
# every other tenant — which is exactly the isolation this fixture exists to test,
# so every tenant would silently pass a test it should fail.
#
# `seed-tenant` assigns the primary user `admin` instead, while still running the
# per-tenant module `setup.ts` hooks (dashboards, configs, feature toggles,
# query-index rows) that `auth add-org` skips.
#
# ------------------------------------------------------------------------------
# RE-RUNNING
#
# Not idempotent, deliberately: `seed-tenant` aborts if a user already exists
# rather than re-pointing an account at a new tenant. To re-seed, wipe first —
# staging's data is disposable by design:
#
#   cd /opt/operis-staging && ./dc down -v
#   # then redeploy, let `mercato init` run, then re-run this script
# ==============================================================================

set -Eeuo pipefail

CONTAINER="${CONTAINER:-operis-staging-app}"
PASSWORD="${SEED_PASSWORD:-Password@123}"
SUPERADMIN_EMAIL="${SUPERADMIN_EMAIL:-faheem@operis.com}"
SUPERADMIN_ORG="${SUPERADMIN_ORG:-operis-platform}"
DRY_RUN=0

[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

# ------------------------------------------------------------------------------
# Refuse to run against production.
#
# The only thing separating "seed QA fixtures" from "invent seven fake tenants in
# the live ERP" is one container name. A typo in CONTAINER, or copying this file
# to the wrong stack, is the whole failure. There is no undo: nothing here can
# delete a tenant once module hooks have provisioned it.
# ------------------------------------------------------------------------------
case "$CONTAINER" in
  *staging*) ;;
  *)
    echo "REFUSING: container '$CONTAINER' does not look like a staging stack." >&2
    echo "This script seeds fake tenants and has no undo. If you genuinely mean" >&2
    echo "to target it, rename the container or edit this guard deliberately." >&2
    exit 1
    ;;
esac

if [ "$DRY_RUN" = 0 ] && ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "ERROR: container '$CONTAINER' is not running." >&2
  echo "The staging stack must be deployed and healthy before seeding." >&2
  exit 1
fi

# org name | admin email | user email        (empty admin = user becomes the primary account)
TENANTS=(
  "organization-y|admin@y.com|user@y.com"
  "organization-huong|admin@huong.com|user@huong.com"
  "organization-hung|admin@hung.com|user@hung.com"
  "organization-nam|admin@nam.com|user@nam.com"
  "organization-tien|admin@tien.com|user@tien.com"
  "organization-jules||user@jules.com"
  "organization-faheem|admin@faheem.com|user@faheem.com"
)

run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '  would run: mercato %s\n' "$*"
    return 0
  fi
  docker exec "$CONTAINER" yarn mercato "$@"
}

echo "Seeding ${#TENANTS[@]} tenants into $CONTAINER"
[ "$DRY_RUN" = 1 ] && echo "(dry run — nothing will change)"
echo

for row in "${TENANTS[@]}"; do
  IFS='|' read -r org admin user <<<"$row"
  args=(auth seed-tenant --orgName "$org" --password "$PASSWORD")
  [ -n "$admin" ] && args+=(--admin "$admin")
  [ -n "$user" ] && args+=(--user "$user")
  echo "--- $org"
  run "${args[@]}"
done

# The platform superadmin gets its own tenant, exactly as `mercato init` gives the
# first one its own. It is global: its reach comes from the superadmin role's
# wildcard ACL, not from which organization it happens to sit in.
echo
echo "--- $SUPERADMIN_ORG (platform superadmin)"
run auth setup --orgName "$SUPERADMIN_ORG" --email "$SUPERADMIN_EMAIL" --password "$PASSWORD"

echo
if [ "$DRY_RUN" = 1 ]; then
  echo "Dry run complete."
else
  echo "Done. Verify with:"
  echo "  docker exec $CONTAINER yarn mercato auth list-users"
  echo "  docker exec $CONTAINER yarn mercato auth list-tenants"
fi
