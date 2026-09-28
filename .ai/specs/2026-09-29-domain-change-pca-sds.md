# Domain change to pca-sds.com and an Operis-owned gateway

> Status: **In progress.** Repo changes on `feat/domain-change`. Server steps not run;
> they wait on the read-only inventory in step 0.
> Related: `deploy/README.md`, `deploy/gateway/`, `2026-09-09-matrix-communications-foundation.md`

## TLDR

- Operis moves from `operis.faheemkamel.com` / `operis-staging.faheemkamel.com` to
  `operis.pca-sds.com` / `staging-operis.pca-sds.com`.
- pca_erp is retired from the VPS. Its nginx and certbot were Operis's only way in, so
  Operis gets its own gateway (`deploy/gateway/`: nginx + certbot). The existing vhost
  files move there with only the hostname changed.
- The old hostnames answer with a 308 to the new ones until they are retired.
- No application code, schema, API, ACL, event or permission change.

## Overview

| | Before | After |
|---|---|---|
| :80/:443 | `pca-erp-nginx` (pca_erp's stack) | `operis-gateway-nginx` (`/opt/operis-gateway`) |
| Certificates | volume `pca-erp-certbot-certs`, renewed by `pca-erp-certbot` | volume `operis-gateway-certs`, renewed by `operis-gateway-certbot` |
| Vhosts | hand-copied into `/opt/pca-erp/docker/nginx/templates/` | `deploy/gateway/nginx/*.conf` in `/opt/operis-gateway/nginx/` |
| Edge network | `pca-erp-network` (owned by pca_erp) | `operis-edge` (external, created once) |
| Production | `operis.faheemkamel.com` (Vercel DNS) | `operis.pca-sds.com` (PA Vietnam DNS) |
| Staging | `operis-staging.faheemkamel.com` | `staging-operis.pca-sds.com` |

## Problem Statement

Operis is served through another product's gateway. Tearing down pca_erp removes the
process on :80/:443, the certificates, the renewal loop and the Docker network the app
containers join. Doing it without a replacement takes both Operis environments offline.

## Proposed Solution

1. A small Operis gateway stack reproduces exactly what the vhosts inherited from
   pca_erp's `default.conf.template`: the TLS policy, Docker's resolver, the `:80`
   server that serves ACME challenges for any hostname and redirects to https, the 6h
   nginx reload and the twice-daily blanket `certbot renew`. It adds a `:443` default
   server that refuses unknown names (`ssl_reject_handshake`) instead of pca_erp's app.
2. Certificates for the new names are issued **through the current gateway** (its `:80`
   webroot) **into the new volume**, so the new gateway starts with valid certificates
   and the cutover needs no ACME step.
3. Cutover is one short maintenance window: edit both `.env` files, stop
   `pca-erp-nginx`, start the new gateway, recreate the two app containers.
4. pca_erp is torn down only after Operis has run on the new gateway for a few days,
   after a final backup is copied off the box. Volume deletion is a separate, later step.

Traefik (`docker-compose.fullapp.traefik.yml`) was not reused: it is upstream's overlay
for the single-app `fullapp` stack and would mean porting the reviewed nginx tuning
(SSE buffering, static-asset buffering, query-string redaction) to labels.

## Architecture

```
internet ─:80/:443─> operis-gateway-nginx ─(operis-edge)─┬─> operis-app          operis.pca-sds.com
                     operis-gateway-certbot (renew)      └─> operis-staging-app  staging-operis.pca-sds.com
                     308: operis.faheemkamel.com, operis-staging.faheemkamel.com -> pca-sds.com names
```

- `deploy/gateway/docker-compose.yml`: project `operis-gateway`. Network and both volumes
  are `external`, so no `down` can delete certificates or detach the apps.
- `deploy/gateway/nginx/00-gateway.conf`: http-context policy, default `:80` and `:443`.
- `deploy/gateway/nginx/operis.conf`, `operis-staging.conf`: the former
  `deploy/nginx/*.conf.template`, location blocks unchanged.
- `deploy/gateway/nginx/legacy-redirects.conf`: one certificate `operis-legacy` for both
  old names.
- `deploy/docker-compose.prod.yml` and `deploy/deploy.sh` default `EDGE_NETWORK` to
  `operis-edge`. An explicit `EDGE_NETWORK` in a server `.env` still wins, so merging
  before the cutover is safe; a server with no value fails `deploy.sh`'s network check
  before anything is pulled or restarted.
- The gateway is not synced by CI, as the vhosts were not before.

## Data Models

None.

## API Contracts

None. Only the public base URL changes. Links in mail are built from `APP_URL` and
`PLATFORM_PORTAL_BASE_URL`; request origins are checked against `APP_URL`,
`NEXT_PUBLIC_APP_URL` and `APP_ALLOWED_ORIGINS` (`packages/shared/src/lib/url.ts`), which
is why those change in the same window as the gateway.

## Runbook

`ubuntu@148.113.44.174` has passwordless sudo and is in the `docker` group. The `operis`
account is CI-only; humans reach it with `sudo -u operis`.

### 0. Read-only inventory (changes nothing)

Run from the laptop and review the output before step 1:

```bash
ssh ubuntu@148.113.44.174 'bash -s' <<'EOF'
echo "== compose projects";  docker compose ls -a
echo "== containers";        docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
echo "== on :80/:443";       sudo ss -ltnpH '( sport = :80 or sport = :443 )'
echo "== networks";          docker network ls --format '{{.Name}}'
echo "== on pca-erp-network"; docker network inspect pca-erp-network --format '{{range .Containers}}{{.Name}} {{end}}'
echo "== volumes";           docker volume ls --format '{{.Name}}'
echo "== gateway templates"; ls -la /opt/pca-erp/docker/nginx/templates/
echo "== hostnames served";  docker exec pca-erp-nginx nginx -T 2>/dev/null | grep -E '^\s*server_name' | sort -u
echo "== certificates";      docker exec pca-erp-certbot certbot certificates 2>/dev/null | grep -E 'Certificate Name|Domains|Expiry'
echo "== /opt";              ls -la /opt
echo "== pca-erp backups";   sudo ls -la /opt/pca-erp/backups 2>/dev/null | tail -8
echo "== other .env files mentioning pca-erp services (key names only)"
for f in $(sudo find /opt -maxdepth 3 -name '.env*' -type f 2>/dev/null | grep -v '^/opt/pca-erp/'); do
  k=$(sudo grep -iE 'pca-sds\.com|pca-erp|zitadel|minio|nextcloud' "$f" | cut -d= -f1 | tr '\n' ' ')
  [ -n "$k" ] && echo "$f: $k"
done
echo "== timers and cron mentioning pca"
systemctl list-timers --all --no-pager | grep -iE 'pca|erp'
sudo crontab -l 2>/dev/null | grep -iE 'pca|erp'
sudo grep -rlE 'pca-erp|pca_erp' /etc/cron* /etc/systemd/system 2>/dev/null
for d in /opt/operis /opt/operis-staging; do
  echo "== $d/.env (domain, network and mail keys only)"
  sudo grep -E '^(STACK_NAME|APP_DOMAIN|APP_URL|NEXT_PUBLIC_APP_URL|APP_ALLOWED_ORIGINS|EDGE_NETWORK|EMAIL_FROM|NOTIFICATIONS_EMAIL_FROM|ADMIN_EMAIL|PLATFORM_[A-Z_]*|CUSTOM_DOMAIN_[A-Z_]*|MCP_[A-Z_]*URL|MCP_OAUTH_ISSUER|OM_ENABLE_STORAGE_S3|OM_CHAT_TRANSPORT|OM_MATRIX_[A-Z_]*URL|OM_MATRIX_SERVER_NAME|OM_GMAIL_PUBSUB_AUDIENCE)=' "$d/.env"
  echo "RESEND_API_KEY set: $(sudo grep -cE '^RESEND_API_KEY=.+' "$d/.env")"
  echo "other keys mentioning faheemkamel/pca-erp/minio/zitadel: $(sudo grep -iE 'faheemkamel|pca-erp|minio|zitadel' "$d/.env" | cut -d= -f1 | tr '\n' ' ')"
  echo "integrations with saved credentials:"
  sudo -u operis bash -c "cd $d && ./dc exec -T postgres sh -c 'psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Atc \"select integration_id, count(*) from integration_credentials where deleted_at is null group by 1 order by 1\"'"
done
EOF
```

Stop and re-plan if any of these hold:
- a container outside the `pca-erp` project is attached to `pca-erp-network`;
- `nginx -T` serves a hostname that is neither pca_erp's four nor Operis's two;
- another stack's `.env` references `auth.pca-sds.com`, Zitadel, MinIO or Nextcloud;
- a timer or cron job outside `pca-erp` runs against it.

### 1. DNS (PA Vietnam, zone `pca-sds.com`)

| Host | Type | Value | TTL |
|---|---|---|---|
| `operis` | A | `148.113.44.174` | 300 |
| `staging-operis` | A | `148.113.44.174` | 300 |

Leave `erp`, `auth`, `files`, `cloud` in place until step 8. Verify against the
authoritative server (the zone has no wildcard):

```bash
dig +short @ns1.pavietnam.vn operis.pca-sds.com A          # 148.113.44.174
dig +short @ns1.pavietnam.vn staging-operis.pca-sds.com A  # 148.113.44.174
```

### 2. Stop pca_erp redeploying itself

Its `ci.yml` deploys to this box on every push to its `main`. After step 5 that would
restart its stack and try to take :80/:443 back.

```bash
gh workflow disable ci.yml -R PCA-SDS/pca_erp
```

### 3. Certificates, through the current gateway (no downtime)

`pca-erp-nginx` serves `/.well-known/acme-challenge/` from `pca-erp-certbot-webroot` for
any hostname. The challenge goes there; the certificates land in the new volume.
Replace `YOUR_EMAIL`.

```bash
docker network create operis-edge
docker volume create operis-gateway-certs
docker volume create operis-gateway-webroot

# rehearsal against Let's Encrypt staging; saves nothing
docker run --rm -v operis-gateway-certs:/etc/letsencrypt -v pca-erp-certbot-webroot:/var/www/certbot certbot/certbot:v3.1.0 certonly --webroot -w /var/www/certbot -d operis.pca-sds.com -d staging-operis.pca-sds.com --dry-run --email YOUR_EMAIL --agree-tos --no-eff-email --key-type ecdsa --non-interactive

docker run --rm -v operis-gateway-certs:/etc/letsencrypt -v pca-erp-certbot-webroot:/var/www/certbot certbot/certbot:v3.1.0 certonly --webroot -w /var/www/certbot -d operis.pca-sds.com --email YOUR_EMAIL --agree-tos --no-eff-email --key-type ecdsa --non-interactive
docker run --rm -v operis-gateway-certs:/etc/letsencrypt -v pca-erp-certbot-webroot:/var/www/certbot certbot/certbot:v3.1.0 certonly --webroot -w /var/www/certbot -d staging-operis.pca-sds.com --email YOUR_EMAIL --agree-tos --no-eff-email --key-type ecdsa --non-interactive
docker run --rm -v operis-gateway-certs:/etc/letsencrypt -v pca-erp-certbot-webroot:/var/www/certbot certbot/certbot:v3.1.0 certonly --webroot -w /var/www/certbot --cert-name operis-legacy -d operis.faheemkamel.com -d operis-staging.faheemkamel.com --email YOUR_EMAIL --agree-tos --no-eff-email --key-type ecdsa --non-interactive

docker run --rm -v operis-gateway-certs:/etc/letsencrypt certbot/certbot:v3.1.0 certificates
```

Renewal later runs in the new gateway's certbot with its own webroot at the same path
(`/var/www/certbot`), which the new nginx serves.

### 4. Stage the gateway (no downtime, binds no port)

```bash
# laptop, in the worktree on feat/domain-change
scp -r deploy/gateway ubuntu@148.113.44.174:/tmp/operis-gateway-new

# server
sudo install -d -m 755 /opt/operis-gateway /opt/operis-gateway/nginx
sudo install -m 644 /tmp/operis-gateway-new/docker-compose.yml /opt/operis-gateway/
sudo install -m 644 /tmp/operis-gateway-new/nginx/*.conf /opt/operis-gateway/nginx/
docker compose -f /opt/operis-gateway/docker-compose.yml pull
docker run --rm --network operis-edge -v /opt/operis-gateway/nginx:/etc/nginx/conf.d:ro -v operis-gateway-certs:/etc/letsencrypt:ro -v operis-gateway-webroot:/var/www/certbot:ro nginx:1.30-alpine nginx -t
```

The last line must print `test is successful`. It checks the real certificates.

### 5. Cutover (maintenance window; Operis is down for about 1 to 2 minutes)

Before starting: no Operis workflow running, nothing merged to Operis `main` until step 6.

5a. Both `.env` files, keeping a copy:

```bash
ssh -t ubuntu@148.113.44.174 'sudo -u operis bash -c "cd /opt/operis && exec bash"'
cp -p .env .env.bak-2026-09-29
nano .env
```

Set, adding any line that is missing:

```
APP_DOMAIN=operis.pca-sds.com
APP_URL=https://operis.pca-sds.com
EDGE_NETWORK=operis-edge
```

plus every other value step 0 showed on `faheemkamel.com`, except the mail sender (step
7). Repeat in `/opt/operis-staging` with `staging-operis.pca-sds.com`.

5b. Swap the gateway, then recreate both apps on the new network with the new env:

```bash
docker stop pca-erp-nginx
docker compose -f /opt/operis-gateway/docker-compose.yml up -d
sudo -u operis bash -c 'cd /opt/operis && ./dc up -d app'
sudo -u operis bash -c 'cd /opt/operis-staging && ./dc up -d app'
until [ "$(docker inspect -f '{{.State.Health.Status}}' operis-app)" = healthy ]; do sleep 5; done; echo production healthy
until [ "$(docker inspect -f '{{.State.Health.Status}}' operis-staging-app)" = healthy ]; do sleep 5; done; echo staging healthy
```

5c. Verify from the laptop, then sign in, open a record, upload a file and confirm live
notifications arrive:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://operis.pca-sds.com/api/configs/health
curl -sS -o /dev/null -w '%{http_code}\n' https://staging-operis.pca-sds.com/api/configs/health
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://operis.faheemkamel.com/login
```

Expected: `200`, `200`, `308 https://operis.pca-sds.com/login`.

### 6. GitHub variables (laptop)

CI's post-deploy checks curl `https://$APP_DOMAIN` and do not follow redirects.

```bash
gh variable set APP_DOMAIN --env production --body operis.pca-sds.com -R PCA-SDS/operis
gh variable set APP_DOMAIN --env staging --body staging-operis.pca-sds.com -R PCA-SDS/operis
gh variable set APP_DOMAIN --body operis.pca-sds.com -R PCA-SDS/operis
```

Then merge `feat/domain-change`.

### 7. External services (only those step 0 shows in use)

- **Mail sender.** If `EMAIL_FROM` is on `faheemkamel.com`, keep it until a `pca-sds.com`
  sender is verified in Resend. `pca-sds.com` mail runs on Google Workspace and its root
  has no SPF record, so verify a subdomain (for example `mail.pca-sds.com`) rather than
  the root, add the records Resend gives in PA Vietnam, then change `EMAIL_FROM` and
  recreate the app. Update any Resend webhook URL.
- Google OAuth redirect URIs and the Gmail push endpoint, if `channel_gmail` is configured.
- Stripe webhook endpoints, if `gateway_stripe` is configured.
- Uptime monitor: `https://operis.pca-sds.com/api/configs/health`.

### Rollback (any time before step 8)

```bash
docker compose -f /opt/operis-gateway/docker-compose.yml down
docker start pca-erp-nginx
sudo -u operis bash -c 'cd /opt/operis && cp -p .env.bak-2026-09-29 .env && ./dc up -d app'
sudo -u operis bash -c 'cd /opt/operis-staging && cp -p .env.bak-2026-09-29 .env && ./dc up -d app'
```

If a restored `.env` has no `EDGE_NETWORK` line, add `EDGE_NETWORK=pca-erp-network`
first: once this branch is merged, the synced compose file defaults to `operis-edge`.
Put the GitHub variables back if step 6 ran.

### 8. Tear down pca_erp (after a few days on the new gateway)

8a. Final backup, copied off the box. The backup container dumps every pca_erp database
and archives the MinIO and Nextcloud volumes when it starts:

```bash
docker restart pca-erp-backup
docker logs -f pca-erp-backup            # wait for the "ok" lines, then Ctrl-C
sudo tar czf /tmp/pca-erp-final-backup.tgz -C /opt/pca-erp backups && sudo chown ubuntu /tmp/pca-erp-final-backup.tgz
# laptop
scp ubuntu@148.113.44.174:/tmp/pca-erp-final-backup.tgz .
```

8b. Remove the stack's containers and network. Volumes stay:

```bash
docker ps -a --filter label=com.docker.compose.project=pca-erp --format '{{.Names}}'   # review
docker rm -f $(docker ps -aq --filter label=com.docker.compose.project=pca-erp)
docker network rm pca-erp-network
```

`network rm` refusing with "active endpoints" means something else is still attached:
stop and check.

8c. Delete the `erp`, `auth`, `files` and `cloud` A records in PA Vietnam.

8d. After a grace period, and only once the backup has been opened somewhere else. **This
is irreversible**:

```bash
docker volume rm pca-erp-postgres-data pca-erp-redis-data pca-erp-minio-data pca-erp-nextcloud-data pca-erp-nextcloud-db-data pca-erp-zitadel-db-data pca-erp-certbot-certs pca-erp-certbot-webroot
docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E '^(ghcr.io/pca-sds/pca-erp-|minio/|nextcloud:|ghcr.io/zitadel/)' | xargs -r docker image rm
sudo rm -rf /opt/pca-erp
```

Do not use `docker image prune -a`: it would also delete the previous Operis image that
`deploy.sh --rollback` depends on, and the box holds no registry login to pull it back.

### 9. Retire the legacy redirects (later)

As described in `deploy/gateway/nginx/legacy-redirects.conf`: remove the file, `nginx -t`,
reload, `certbot delete --cert-name operis-legacy`, then delete the `operis` and
`operis-staging` A records from `faheemkamel.com` at Vercel.

## Risks & Impact Review

| Scenario | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| New gateway fails to start at cutover | High | Both environments | Step 4 runs `nginx -t` against the real certificate volume before any swap; rollback is two commands | Seconds of extra downtime |
| HTTP-01 challenge fails for a new name | Medium | Certificates | Dry run first; nothing changes on the box until all certificates exist | Delay only |
| pca_erp CI redeploys and reclaims :80/:443 | Medium | Gateway | Step 2 disables its workflow before the cutover; a late deploy fails on the port already held | None once disabled |
| Another stack depends on pca_erp (Zitadel, MinIO, Postgres, network) | High | Other stacks | Step 0 lists attached containers and env references; teardown waits on review | Depends on inventory |
| App keeps the old `APP_URL` | Medium | Login, mail links | Env edited before the apps are recreated, in the same window | None |
| Mail sender on an unverified domain | Medium | Outbound mail | Sender changes only after Resend verifies a `pca-sds.com` domain | None |
| CI health check hits the old name and gets a 308 | Low | Deploy pipeline | Step 6 straight after the cutover | None |
| Data loss when removing pca_erp | High | pca_erp data | Final backup off the box, volumes kept for a grace period, deletion is separate and manual | Only after 8d |
| Users signed out once | Low | Sessions | Cookies are per hostname; expected | Users sign in again |
| Old links break | Low | Links in sent mail | 308 redirects while `operis-legacy` renews | Ends when step 9 runs |

Staging and production still share one edge network, as they shared `pca-erp-network`;
pca_erp's Postgres, Redis, MinIO and Zitadel are no longer on it.

## Final Compliance Report

- No application code, entity, migration, API route, ACL feature or event ID changed.
- Tenant and organization isolation untouched.
- No secret in the repo. Commands print key names, not values, for anything secret.
- `.dockerignore` excludes `deploy/`, `.github/` and `.ai/`, so the app image build
  context is unchanged.
- Verified locally: the gateway config under `nginx:1.30-alpine` with throwaway
  certificates (routing to both upstreams, 308s keeping path and query, refusal of
  unknown and missing SNI, ACME for any host, redirect and health on `:80`, headers,
  query redaction in the log), the base config starting with no certificates, a missing
  certificate failing `nginx -t`, the prod compose file rendering `operis-edge` by
  default and honouring an explicit `EDGE_NETWORK`, and
  `scripts/__tests__/deploy-scripts-app-dir.test.mjs`.

## Changelog

- **2026-09-29**: Initial version. Repo changes on `feat/domain-change`; server runbook
  pending the step 0 inventory.
