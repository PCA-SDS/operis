# Operis-owned gateway, pca_erp removal, and the move to pca-sds.com

> Status: **Phase 1 done on the server 2026-09-29** (Operis on its own gateway, pca_erp
> removed). **Phase 2 (move to pca-sds.com) not started.**
> Related: `deploy/README.md`, `deploy/gateway/`, `2026-09-09-matrix-communications-foundation.md`

## TLDR

- pca_erp is gone from the VPS. Its nginx and certbot were Operis's only way in, so Operis
  now runs its own gateway (`deploy/gateway/`: nginx + certbot) on :80/:443. The public
  names are unchanged: `operis.faheemkamel.com`, `operis-staging.faheemkamel.com`.
- Phase 2, separately: move to `operis.pca-sds.com` / `staging-operis.pca-sds.com`, with
  308 redirects from the old names.
- No application code, schema, API, ACL, event or permission change in either phase.

## Overview

| | Before | Now (Phase 1) | After Phase 2 |
|---|---|---|---|
| :80/:443 | `pca-erp-nginx` | `operis-gateway-nginx` (`/opt/operis-gateway`) | same |
| Certificates | volume `pca-erp-certbot-certs` | volume `operis-gateway-certs`, renewed by `operis-gateway-certbot` | same, plus the two pca-sds.com names |
| Site files | hand-copied into `/opt/pca-erp/docker/nginx/templates/` | `deploy/gateway/nginx/*.conf` in `/opt/operis-gateway/nginx/` | same files, new hostnames, plus `legacy-redirects.conf` |
| Edge network | `pca-erp-network` (owned by pca_erp) | `operis-edge` (external, created once) | same |
| Names | faheemkamel.com (Vercel DNS) | unchanged | pca-sds.com (PA Vietnam DNS); old names 308 |

## Problem Statement

Operis was served through another product's gateway. Removing pca_erp removed the process
on :80/:443, the certificates, the renewal loop and the Docker network the app containers
joined. Removing it without a replacement takes both Operis environments offline.

## Proposed Solution

- **Phase 1:** a small Operis gateway reproduces what the vhosts inherited from pca_erp's
  `default.conf.template` (TLS policy, Docker's resolver, a `:80` server that answers ACME
  challenges for any name and redirects to https, the 6h nginx reload, the twice-daily
  blanket `certbot renew`) and adds a `:443` default server that refuses unknown names
  (`ssl_reject_handshake`). Certificates were issued through the old gateway into the new
  volume, so the switch needed no ACME step. Then pca_erp was removed.
- **Phase 2:** change hostnames in the two site files, add redirect blocks for the old
  names, edit the two `.env` files, reload the gateway and recreate the apps.

Traefik (`docker-compose.fullapp.traefik.yml`) was not reused: it is upstream's overlay for
the single-app `fullapp` stack and would mean porting the reviewed nginx tuning (SSE
buffering, static-asset buffering, query-string redaction) to labels.

## Architecture

```
internet ─:80/:443─> operis-gateway-nginx ─(operis-edge)─┬─> operis-app          operis.faheemkamel.com
                     operis-gateway-certbot (renew)      └─> operis-staging-app  operis-staging.faheemkamel.com
```

- `deploy/gateway/docker-compose.yml`: project `operis-gateway`. The network and both
  volumes are `external`, so no `down` can delete certificates or detach the apps.
- `deploy/gateway/nginx/00-gateway.conf`: http-context policy, default `:80` and `:443`.
- `deploy/gateway/nginx/operis.conf`, `operis-staging.conf`: the former
  `deploy/nginx/*.conf.template`, location blocks unchanged.
- `deploy/docker-compose.prod.yml` and `deploy/deploy.sh` default `EDGE_NETWORK` to
  `operis-edge`; both server `.env` files also set it explicitly.
- The gateway is installed by hand and not synced by CI. After any change to
  `deploy/gateway/`, sync the server (command below); `nginx -t` gates every reload.

## Data Models

None.

## API Contracts

None. Phase 2 changes only the public base URL. Links in mail are built from `APP_URL`
and `PLATFORM_PORTAL_BASE_URL`; request origins are checked against `APP_URL`,
`NEXT_PUBLIC_APP_URL` and `APP_ALLOWED_ORIGINS` (`packages/shared/src/lib/url.ts`), which is
why those change in the same window as the site files.

## Phase 1 record (done 2026-09-29)

All commands ran from the laptop as `ubuntu@148.113.44.174`.

1. Read-only check: `pca-erp-network` held only pca_erp's containers plus `operis-app` and
   `operis-staging-app`; `pca-erp-nginx` served pca_erp's four names plus the two Operis
   names; no timer or cron job referenced pca_erp.
2. `docker network create operis-edge`; volumes `operis-gateway-certs` and
   `operis-gateway-webroot`; `deploy/gateway` installed at `/opt/operis-gateway`.
3. ECDSA certificates for `operis.faheemkamel.com` and `operis-staging.faheemkamel.com`,
   issued through `pca-erp-nginx`'s `:80` webroot into `operis-gateway-certs`.
4. Site files: at the time, copies of the pca_erp-hosted templates. The production one was
   the 2026-08-24 version, without the `/_next/static/` block added on 2026-08-31 (staging
   already had it). The sync below replaces both with the repo's files.
5. `EDGE_NETWORK=operis-edge` in both `.env` files (copies kept as `.env.bak-gateway`),
   `pca-erp-nginx` stopped, gateway started, both apps recreated with `--no-deps`. Both
   became healthy.
6. Verified from outside: both health URLs 200, the new certificates served, `/login` 200,
   `http://` 301 to `https://`, `erp.pca-sds.com` refused at TLS.
7. pca_erp removed: 14 containers, `pca-erp-network`, its 8 volumes, its images,
   `/opt/pca-erp`. Its GitHub workflow disabled. Its deploy key (`github-actions-deploy`,
   matched by fingerprint) removed from `ubuntu`'s `authorized_keys` (copy kept as
   `authorized_keys.bak-pca-erp`). Operis and the other stacks (ports 8088, 8090, 8091)
   answered afterwards.

Still to do after Phase 1: sync the server's site files with the repo (below), and delete
the `auth`, `erp`, `files` and `cloud` A records at PA Vietnam.

**Syncing the gateway with the repo.** Zero downtime: validates the new files in a
throwaway container, keeps a copy of the live ones, then `nginx -t` and a graceful reload.

```bash
git -C /path/to/operis fetch origin && git -C /path/to/operis archive origin/main deploy/gateway | ssh ubuntu@148.113.44.174 'set -e; rm -rf /tmp/operis-gateway-sync; mkdir /tmp/operis-gateway-sync; tar -x -C /tmp/operis-gateway-sync --strip-components=2; docker run --rm --network operis-edge -v /tmp/operis-gateway-sync/nginx:/etc/nginx/conf.d:ro -v operis-gateway-certs:/etc/letsencrypt:ro -v operis-gateway-webroot:/var/www/certbot:ro nginx:1.30-alpine nginx -t; sudo rm -rf /opt/operis-gateway/nginx.bak-sync; sudo cp -a /opt/operis-gateway/nginx /opt/operis-gateway/nginx.bak-sync; sudo install -m 644 /tmp/operis-gateway-sync/nginx/*.conf /opt/operis-gateway/nginx/; sudo install -m 644 /tmp/operis-gateway-sync/docker-compose.yml /opt/operis-gateway/; docker exec operis-gateway-nginx nginx -t; docker exec operis-gateway-nginx nginx -s reload; echo synced'
```

Never replace `/opt/operis-gateway/nginx` itself: it is bind-mounted, and a new directory
in its place is invisible to the running container. Copy files into it.

## Phase 2 runbook: move to pca-sds.com (not started)

**In a new branch:**
- `deploy/gateway/nginx/operis.conf` and `operis-staging.conf`: `server_name` and both
  certificate paths to `operis.pca-sds.com` / `staging-operis.pca-sds.com`.
- New `deploy/gateway/nginx/legacy-redirects.conf`: one `listen 443 ssl` server per old
  name, each using its existing certificate (`/etc/letsencrypt/live/<old name>/`),
  `access_log ... gateway_access`, and `return 308 https://<new name>$request_uri;`.
- `deploy/env.*.example`, `deploy/README.md` and the diagrams to the new names.
- The Matrix spec already plans `chat.operis.pca-sds.com`.

**On the server**, after that branch is pushed:

1. DNS at PA Vietnam: `A operis 148.113.44.174 TTL 300` and
   `A staging-operis 148.113.44.174 TTL 300`. Check with
   `dig +short @ns1.pavietnam.vn operis.pca-sds.com A` (the zone has no wildcard).
2. Certificates through the gateway itself (its Let's Encrypt account already exists):

```bash
ssh ubuntu@148.113.44.174 'bash -s' <<'EOF'
set -e
for n in operis.pca-sds.com staging-operis.pca-sds.com; do
  docker run --rm -v operis-gateway-certs:/etc/letsencrypt -v operis-gateway-webroot:/var/www/certbot certbot/certbot:v3.1.0 certonly --webroot -w /var/www/certbot --non-interactive --agree-tos --key-type ecdsa -d "$n"
done
docker run --rm -v operis-gateway-certs:/etc/letsencrypt certbot/certbot:v3.1.0 certificates
EOF
```

3. Stage and validate the branch's site files without touching the live ones:

```bash
git -C /path/to/operis archive <phase-2-branch> deploy/gateway/nginx | ssh ubuntu@148.113.44.174 'set -e; rm -rf /tmp/gw-new; mkdir /tmp/gw-new; tar -x -C /tmp/gw-new --strip-components=3; docker run --rm --network operis-edge -v /tmp/gw-new:/etc/nginx/conf.d:ro -v operis-gateway-certs:/etc/letsencrypt:ro -v operis-gateway-webroot:/var/www/certbot:ro nginx:1.30-alpine nginx -t'
```

4. Switch (Operis down for 1 to 2 minutes while the apps restart). The mail sender is left
   alone on purpose: it changes only after a pca-sds.com sender is verified in Resend.

```bash
ssh ubuntu@148.113.44.174 'bash -s' <<'EOF'
set -e
for d in /opt/operis /opt/operis-staging; do
  sudo -u operis bash -s "$d" <<'INNER'
cd "$1"
cp -p .env .env.bak-domain
sed -i -E \
  -e '/^(EMAIL_FROM|NOTIFICATIONS_EMAIL_FROM|RESEND_FROM|ADMIN_EMAIL)=/!s/operis-staging\.faheemkamel\.com/staging-operis.pca-sds.com/g' \
  -e '/^(EMAIL_FROM|NOTIFICATIONS_EMAIL_FROM|RESEND_FROM|ADMIN_EMAIL)=/!s/operis\.faheemkamel\.com/operis.pca-sds.com/g' .env
chmod 600 .env
diff .env.bak-domain .env || true
INNER
done
sudo rm -rf /opt/operis-gateway/nginx.bak-domain
sudo cp -a /opt/operis-gateway/nginx /opt/operis-gateway/nginx.bak-domain
sudo install -m 644 /tmp/gw-new/*.conf /opt/operis-gateway/nginx/
docker exec operis-gateway-nginx nginx -t
docker exec operis-gateway-nginx nginx -s reload
sudo -u operis bash -c 'cd /opt/operis && ./dc up -d --no-deps app'
sudo -u operis bash -c 'cd /opt/operis-staging && ./dc up -d --no-deps app'
for c in operis-app operis-staging-app; do
  s=starting
  for i in $(seq 120); do
    s=$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null || echo missing)
    [ "$s" = healthy ] && break
    sleep 5
  done
  [ "$s" = healthy ] || { echo "$c is not healthy after 10 minutes. Roll back."; exit 1; }
  echo "$c healthy"
done
EOF
```

5. Verify: `https://operis.pca-sds.com/api/configs/health` and
   `https://staging-operis.pca-sds.com/api/configs/health` return 200;
   `https://operis.faheemkamel.com/login` returns `308` to `https://operis.pca-sds.com/login`.
6. GitHub variables (CI's post-deploy checks curl `https://$APP_DOMAIN` without following
   redirects): `gh variable set APP_DOMAIN --env production --body operis.pca-sds.com`,
   the same for `--env staging` with `staging-operis.pca-sds.com`, and the repository-level
   `APP_DOMAIN`. Add `-R PCA-SDS/operis`: the repo has two remotes.
7. Merge the branch. Update external services that hold the old URL: Resend (sender and
   webhook), Google OAuth and the Gmail push endpoint if `channel_gmail` is configured,
   Stripe webhooks if `gateway_stripe` is configured, the uptime monitor.

**Rollback (Phase 2):** copy the files from `/opt/operis-gateway/nginx.bak-domain/` back
into `/opt/operis-gateway/nginx/` (remove `legacy-redirects.conf`), `nginx -t`, reload;
restore each `.env.bak-domain`; `./dc up -d --no-deps app` in both stacks; put the GitHub
variables back.

**Retiring the old names (later):** delete `legacy-redirects.conf`, `nginx -t`, reload,
`certbot delete --cert-name operis.faheemkamel.com` and `--cert-name
operis-staging.faheemkamel.com` in the gateway's certbot, then remove the two A records at
Vercel. Until then those records must keep pointing here: the old names sent a one-year
HSTS header, so browsers only reach them over https, which needs a valid certificate.

## Risks & Impact Review

| Scenario | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Gateway config error on a sync or the Phase 2 reload | High | Both environments | Files validated in a throwaway container first, then `nginx -t` in the live one; a failed test leaves the running config untouched | None |
| HTTP-01 challenge fails for a new name | Medium | Certificates | DNS checked against the authoritative server first; nothing live changes until the certificates exist | Delay only |
| App keeps the old `APP_URL` | Medium | Login, mail links | `.env` edited before the apps are recreated, in the same window | None |
| Mail sender on an unverified domain | Medium | Outbound mail | Sender changes only after Resend verifies a pca-sds.com domain (subdomain; the root runs Google Workspace and has no SPF) | None |
| CI health check hits an old name and gets a 308 | Low | Deploy pipeline | GitHub variables changed straight after the switch | None |
| Users signed out once | Low | Sessions | Cookies are per hostname; expected | Users sign in again |
| Old links break | Low | Links in sent mail | 308 redirects while the old certificates renew | Ends when the old names are retired |
| Server drifts from `deploy/gateway` | Medium | Gateway | Hand-installed by design; sync command above after every change | Depends on discipline |

Staging and production share one edge network, as they shared `pca-erp-network`; pca_erp's
Postgres, Redis, MinIO and Zitadel are no longer on it.

## Final Compliance Report

- No application code, entity, migration, API route, ACL feature or event ID changed.
- Tenant and organization isolation untouched. No secret in the repo.
- `.dockerignore` excludes `deploy/`, `.github/` and `.ai/`, so the app image build
  context is unchanged.
- Verified locally: the gateway config under `nginx:1.30-alpine` with throwaway
  certificates (routing to both upstreams, refusal of unknown and missing SNI, ACME for
  any host, redirect and health on `:80`, headers, query redaction in the log), the base
  config starting with no certificates, a missing certificate failing `nginx -t`, the prod
  compose file rendering `operis-edge` by default and honouring an explicit
  `EDGE_NETWORK`, `scripts/__tests__/deploy-scripts-app-dir.test.mjs`, and the Phase 2
  `.env` edit against GNU sed.
- Verified on the server (Phase 1): see the record above.
- Not yet exercised: Phase 2, and a real certificate renewal inside the gateway (first
  one due about 2026-11-27).

## Changelog

- **2026-09-29**: Initial version, a one-shot move to pca-sds.com.
- **2026-09-29**: Split into two phases after the owner chose to remove pca_erp first.
  Phase 1 ran on the server the same day; the repo's gateway and deploy files now describe
  that live state, and Phase 2 starts from it.
