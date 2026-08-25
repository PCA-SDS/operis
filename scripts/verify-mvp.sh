#!/usr/bin/env bash
# MVP verification — exercises the Definition of Done scenarios against a running app.
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
PW="${OM_DEV_SEED_PASSWORD:-Operis!23}"
JAR_DIR="$(mktemp -d)"
PASS=0; FAIL=0

pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }
head2() { printf '\n\033[1m%s\033[0m\n' "$1"; }

login() { # login <name> <email> [password]
  local name="$1" email="$2" pw="${3:-$PW}" code attempt=0
  rm -f "$JAR_DIR/$name.txt"
  while :; do
    code=$(curl -s -o "$JAR_DIR/$name.body" -w '%{http_code}' -c "$JAR_DIR/$name.txt" \
      -X POST "$BASE/api/auth/login" \
      -H 'Content-Type: application/x-www-form-urlencoded' \
      --data-urlencode "email=$email" --data-urlencode "password=$pw")
    # The login endpoint rate-limits by account and by IP (a deliberate
    # credential-stuffing guard). Running this script back-to-back, or right
    # after the Playwright suite, legitimately trips it — wait the block out
    # rather than reporting a security control as a failure.
    if [ "$code" != "429" ] || [ "$attempt" -ge 4 ]; then
      printf '%s' "$code"
      return
    fi
    attempt=$((attempt + 1))
    [ "$attempt" = "1" ] && printf '\n  (login rate limit hit — waiting for the window to clear)\n' >&2
    sleep 20
  done
}

get() { # get <name> <path> -> http code, body in $JAR_DIR/last.body
  curl -s -o "$JAR_DIR/last.body" -w '%{http_code}' -b "$JAR_DIR/$1.txt" "$BASE$2"
}

anon() { curl -s -o "$JAR_DIR/last.body" -w '%{http_code}' "$BASE$1"; }

head2 "Scenario B — Platform Superadmin (admin@operis.local)"
code=$(login operis admin@operis.local)
[ "$code" = "200" ] && pass "authenticates (200)" || fail "authenticates (got $code)"
grep -q '"ok":true' "$JAR_DIR/operis.body" && pass "login payload ok:true" || fail "login payload"
code=$(get operis /api/directory/tenants)
[ "$code" = "200" ] && pass "can list tenants (platform administration)" || fail "can list tenants (got $code)"
tenant_count=$(node -e "try{const d=JSON.parse(require('fs').readFileSync('$JAR_DIR/last.body','utf8'));console.log((d.items||d.data||[]).length)}catch(e){console.log(0)}")
[ "$tenant_count" -ge 3 ] && pass "sees all $tenant_count tenants across the platform" || fail "sees only $tenant_count tenants"

head2 "Scenario C — Tenant Admin (admin@acme.local)"
code=$(login acme admin@acme.local)
[ "$code" = "200" ] && pass "authenticates (200)" || fail "authenticates (got $code)"
code=$(get acme /api/directory/tenants)
[ "$code" = "403" ] || [ "$code" = "401" ] && pass "CANNOT reach platform tenant administration ($code)" || fail "reached tenant admin (got $code)"
code=$(get acme /api/directory/organizations)
[ "$code" = "200" ] && pass "can manage its own organizations (200)" || fail "own organizations (got $code)"
code=$(get acme /api/customers/people)
[ "$code" = "200" ] && pass "can reach an entitled business module (customers)" || fail "customers (got $code)"

head2 "Scenario D — Tenant User (user@acme.local)"
code=$(login acmeuser user@acme.local)
[ "$code" = "200" ] && pass "authenticates (200)" || fail "authenticates (got $code)"
code=$(get acmeuser /api/directory/tenants)
[ "$code" = "403" ] || [ "$code" = "401" ] && pass "CANNOT reach platform administration ($code)" || fail "reached platform admin (got $code)"
code=$(get acmeuser /api/auth/users)
[ "$code" = "403" ] || [ "$code" = "401" ] && pass "CANNOT manage users ($code)" || fail "reached user management (got $code)"
code=$(get acmeuser /api/customers/people)
[ "$code" = "200" ] && pass "can reach what its role permits (customers)" || fail "customers (got $code)"

head2 "Scenario — Module entitlement (Globex has tasks withheld)"
code=$(login globex admin@globex.local)
[ "$code" = "200" ] && pass "Globex admin authenticates" || fail "Globex admin login (got $code)"
code=$(get acme /api/tasks/tasks)
[ "$code" = "200" ] && pass "Acme (tasks granted) reaches tasks" || fail "Acme tasks (got $code)"
code=$(get globex /api/tasks/tasks)
[ "$code" = "403" ] || [ "$code" = "401" ] && pass "Globex (tasks withheld) is DENIED tasks ($code)" || fail "Globex reached withheld tasks (got $code)"

# Entitlement must also shape what the UI offers, not only what the API allows.
get acme /api/auth/admin/nav >/dev/null; cp "$JAR_DIR/last.body" "$JAR_DIR/nav-acme.json"
get globex /api/auth/admin/nav >/dev/null; cp "$JAR_DIR/last.body" "$JAR_DIR/nav-globex.json"
read -r a_tasks a_cust a_nav <<<"$(node -e "
const d=JSON.parse(require('fs').readFileSync('$JAR_DIR/nav-acme.json','utf8'));const g=d.grantedFeatures||[];
console.log(g.filter(x=>x.startsWith('tasks.')).length, g.filter(x=>x.startsWith('customers.')).length, (JSON.stringify(d.groups||[]).match(/\/backend\/tasks/g)||[]).length)")"
read -r g_tasks g_cust g_nav <<<"$(node -e "
const d=JSON.parse(require('fs').readFileSync('$JAR_DIR/nav-globex.json','utf8'));const g=d.grantedFeatures||[];
console.log(g.filter(x=>x.startsWith('tasks.')).length, g.filter(x=>x.startsWith('customers.')).length, (JSON.stringify(d.groups||[]).match(/\/backend\/tasks/g)||[]).length)")"
[ "$a_tasks" -gt 0 ] && pass "Acme capability payload carries tasks grants ($a_tasks)" || fail "Acme has no tasks grants"
[ "$g_tasks" -eq 0 ] && pass "Globex capability payload carries NO tasks grants" || fail "Globex still has $g_tasks tasks grants"
[ "$a_nav" -gt 0 ] && pass "Acme navigation offers tasks ($a_nav entries)" || fail "Acme nav has no tasks entries"
[ "$g_nav" -eq 0 ] && pass "Globex navigation does NOT offer tasks" || fail "Globex nav still offers tasks ($g_nav entries)"
[ "$a_cust" = "$g_cust" ] && pass "both tenants keep identical customers grants ($a_cust) — only the withheld module differs" \
  || fail "customers grants differ ($a_cust vs $g_cust)"

head2 "Scenario E — Cross-tenant isolation"
acme_tid=$(docker exec mercato-postgres psql -U postgres -d open-mercato -tAc "select id from tenants where name='Acme'")
globex_tid=$(docker exec mercato-postgres psql -U postgres -d open-mercato -tAc "select id from tenants where name='Globex'")
globex_oid=$(docker exec mercato-postgres psql -U postgres -d open-mercato -tAc "select id from organizations where tenant_id='$globex_tid'")
globex_uid=$(docker exec mercato-postgres psql -U postgres -d open-mercato -tAc "select id from users where tenant_id='$globex_tid' limit 1")

code=$(get acme "/api/directory/organizations?id=$globex_oid")
body_has_globex=$(grep -c "$globex_oid" "$JAR_DIR/last.body" || true)
[ "$body_has_globex" = "0" ] && pass "Acme admin cannot read Globex organization by direct ID" || fail "LEAK: Globex org id present in Acme response"

code=$(get acme "/api/auth/users?id=$globex_uid")
body_has_user=$(grep -c "$globex_uid" "$JAR_DIR/last.body" || true)
[ "$body_has_user" = "0" ] && pass "Acme admin cannot read a Globex user by direct ID" || fail "LEAK: Globex user id present in Acme response"

code=$(get acme "/api/auth/users")
leak=$(grep -c "$globex_tid" "$JAR_DIR/last.body" || true)
[ "$leak" = "0" ] && pass "Acme user list contains no Globex tenant rows" || fail "LEAK: Globex tenant id in Acme user list"

# Forged tenant cookie: a non-superadmin must not be able to scope into another tenant.
code=$(curl -s -o "$JAR_DIR/last.body" -w '%{http_code}' -b "$JAR_DIR/acme.txt" \
  -H "Cookie: $(grep auth_token "$JAR_DIR/acme.txt" | awk '{print "auth_token="$7}'); om_selected_tenant=$globex_tid" \
  "$BASE/api/auth/users")
leak=$(grep -c "$globex_uid" "$JAR_DIR/last.body" || true)
[ "$leak" = "0" ] && pass "forged om_selected_tenant cookie does not cross the tenant boundary" || fail "LEAK: tenant cookie override worked for a tenant admin"

head2 "Authentication failure modes"
code=$(login bad nosuch@nowhere.local)
[ "$code" != "200" ] && pass "unknown email rejected ($code)" || fail "unknown email accepted"
msg1=$(cat "$JAR_DIR/bad.body")
code=$(login bad2 admin@acme.local WrongPassword!1)
[ "$code" != "200" ] && pass "wrong password rejected ($code)" || fail "wrong password accepted"
msg2=$(cat "$JAR_DIR/bad2.body")
[ "$msg1" = "$msg2" ] && pass "identical error for unknown email vs wrong password (no account enumeration)" \
  || fail "error messages differ — leaks account existence: [$msg1] vs [$msg2]"
echo "$msg1" | grep -Eqi 'stack|at [A-Za-z]+\.|select |postgres|password_hash' && fail "error body leaks internals" || pass "error body leaks no internals"

head2 "Unauthenticated access"
code=$(anon /api/directory/tenants)
[ "$code" = "401" ] || [ "$code" = "403" ] && pass "anonymous API access denied ($code)" || fail "anonymous access (got $code)"
code=$(anon /api/auth/users)
[ "$code" = "401" ] || [ "$code" = "403" ] && pass "anonymous user list denied ($code)" || fail "anonymous user list (got $code)"

head2 "Health"
code=$(anon /api/configs/health)
[ "$code" = "200" ] && pass "GET /api/configs/health responds 200" || fail "GET /api/configs/health (got $code)"
node -e "const d=JSON.parse(require('fs').readFileSync('$JAR_DIR/last.body','utf8'));process.exit(d.checks&&d.checks.database&&d.checks.database.ok?0:1)" \
  && pass "health reports database connectivity" || fail "health payload missing database check"

head2 "Logout"
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_DIR/acme.txt" -c "$JAR_DIR/acme.txt" -X POST "$BASE/api/auth/logout")
code2=$(get acme /api/directory/organizations)
[ "$code2" = "401" ] || [ "$code2" = "403" ] && pass "session no longer authorized after logout ($code2)" || fail "still authorized after logout ($code2)"

printf '\n\033[1mRESULT: %d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
