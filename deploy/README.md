# Deploying Operis to the OVH VPS (148.113.44.174)

Push to `main` → GitHub Actions builds a container image → the VPS pulls it and restarts.

**This is a shared host.** It already runs four unrelated production stacks. Everything
below is written to be additive: nothing here restarts, reconfigures or competes with
them, with exactly one exception that is called out where it happens.

```
  git push main
        │
        ▼
  GitHub Actions ── docker build (Dockerfile, target: runner) ──► ghcr.io/pca-sds/operis:sha-abc1234
        │                                                                    │
        │ ssh + rsync (compose, redis.conf, scripts)                         │ docker pull
        ▼                                                                    ▼
  ┌──────────────────────────── OVH VPS ──────────────────────────────────────┐
  │                                                                           │
  │  :80 :443 ── pca-erp-nginx ─┬─► erp / auth / cloud / files.pca-sds.com    │
  │  (NOT OURS)                 │                                             │
  │                             └─► operis.faheemkamel.com                    │
  │                                        │ pca-erp-network                  │
  │                                        ▼                                  │
  │                                   operis-app ──┬─► operis-postgres  ┐     │
  │                                                ├─► operis-redis     │ operis-
  │                                                └─► operis-meilisearch┘ internal
  └───────────────────────────────────────────────────────────────────────────┘
```

Operis publishes **no host ports at all**. The app is reachable only by containers on
`pca-erp-network` (i.e. the gateway); the datastores only by the app. That also
sidesteps Docker's iptables rules, which bypass ufw for published ports.

---

## Why the gateway is shared

`pca-erp-nginx` owns :80 and :443 and is `default_server` on both. There is no second
port 443 to hand out. Operis therefore serves through it.

Three properties of that stack's config make this cheap, and they are why this works
without touching their files:

- nginx mounts the whole `docker/nginx/templates/` **directory**, so a new
  `operis.conf.template` is picked up without editing `default.conf.template`
- their `:80` block is `server_name _` and serves `/.well-known/acme-challenge/` for
  **any** hostname — so the ACME HTTP-01 challenge for our domain works through it
  before our vhost exists
- their certbot runs `certbot renew` (every cert on the box, not a fixed list) twice a
  day, and nginx reloads every 6h — so our certificate renews with **zero** changes to
  their setup

`NGINX_ENVSUBST_FILTER` is restricted to five variable names, so our template hardcodes
the hostname rather than adding a sixth. Verified: rendering our template through their
filter produces a byte-identical file — no nginx runtime variable gets eaten.

---

## Files

| File | Runs where | Purpose |
|---|---|---|
| `00-audit-server.sh` | server | **Read-only** inventory. Changes nothing. Run before touching an unfamiliar box. |
| `01-bootstrap-server.sh` | — | **Not used on this host.** Correct for a *fresh* single-purpose VPS; see its header. |
| `docker-compose.prod.yml` | server (as `docker-compose.yml`) | The stack. Never builds; pulls the CI image. |
| `nginx/operis.conf.template` | pca-erp templates dir | The vhost. Installed **by hand, once**. |
| `redis.conf` | server | Redis with persistence on (queues live here). |
| `env.production.example` | → server `.env` | Every environment variable, annotated. |
| `init-env.sh` | server | Generates every secret straight into `.env` — never to stdout. |
| `install-backup-timer.sh` | server | Installs the nightly backup systemd timer. Run once. |
| `deploy.sh` | server | Pull → verify digest → back up → start → health-check → roll back on failure. |
| `required-env` | → server, next to `deploy.sh` | The variables `.env` must define. Checked before anything is pulled or restarted. |
| `backup.sh` | server | `pg_dump` with retention and an integrity check. Scheduled by the timer above. |
| `dc` | server | `docker compose` wrapper that supplies both env files. |
| `../.github/workflows/ci-deploy.yml` | GitHub | The pipeline: quality + build + deploy in one run. |

CI rsyncs `deploy.sh`, `backup.sh`, `required-env`, `dc`, the compose file and
`redis.conf` on every deploy — edit them in git, never on the box. `.env`,
`backups/` and `logs/` are server-only and CI never touches them.

**Which image gets deployed is decided by CI, not by the server.** The workflow
derives it from `github.repository` and passes it to `deploy.sh` as `--image`,
along with the `--digest` of the artifact it just built. `deploy.sh` verifies the
digest after pulling and refuses to continue on a mismatch. `APP_IMAGE` in `.env`
is only a fallback for running `deploy.sh` by hand; when the two disagree, CI
wins and the deploy log says which one it used. This is deliberate — the value
used to live only on the server, and an org transfer left it pointing at an image
namespace that no longer existed.

The nginx template is **excluded from that sync on purpose**: it lives in another
stack's directory, and an automated bad copy there would break four other hostnames.

---

## What the audit found (2026-08-24)

| | |
|---|---|
| OS | Ubuntu 26.04 LTS, kernel 7.0.0-28, x86_64, KVM/OpenStack |
| CPU / RAM | 8 vCPU AMD EPYC-Milan, 22 GB (19 GB available), **no swap** |
| Disk | 193 GB, 8% used |
| Docker | 29.6.2 + Compose v5.3.1, **no `daemon.json`** (no global log rotation) |
| ufw | active; 22, 80, 443, 8088, 8090, 8091 open |
| sshd | `PermitRootLogin no`, `PasswordAuthentication no`, port 22 — already hardened |
| Existing stacks | pca-erp (80/443), pca_accounting (8080), pca-client-profile (8088), prive-booking (8090/8091), portainer (127.0.0.1:9090) |
| Pending | kernel reboot required; 27 package updates including Docker 29.7.2 |

Deliberately **not** changed: the pending reboot (it would restart four production
stacks — schedule it yourself), and `/etc/docker/daemon.json` (writing it needs
`systemctl restart docker`, which bounces all 23 containers). Operis's compose sets
per-container log limits, so it does not add to the un-rotated-logs problem.

---

## Setup

### 1 — DNS

```
A    operis    148.113.44.174    TTL 300
```

No AAAA record: the box has IPv6, but the existing gateway's vhosts are the only
tested path and there is no reason to introduce a second one.

```bash
dig +short operis.faheemkamel.com     # must return 148.113.44.174
```

### 2 — Deploy account

A dedicated account, not `ubuntu`. `ubuntu` currently carries five authorized keys —
including a contractor's and an intern's — and is in the `docker` group, so anyone
holding one of those keys can already read every `.env` on the box. Operis should not
widen that.

```bash
# on the server, as ubuntu (which has passwordless sudo)
sudo adduser --disabled-password --gecos "Operis deploy" operis
sudo usermod -aG docker operis
sudo install -d -m 750 -o operis -g operis /opt/operis
sudo install -d -m 700 -o operis -g operis /opt/operis/backups
sudo install -d -m 750 -o operis -g operis /opt/operis/logs
```

`docker` group membership is root-equivalent on this host. That is the standard
tradeoff for a CI deploy account; it is why this account is key-only and gets no sudo.

### 3 — CI key

```bash
# laptop
ssh-keygen -t ed25519 -C 'github-actions@operis' -f ~/.ssh/operis_deploy -N ''
ssh-copy-id -i ~/.ssh/operis_deploy.pub -o 'IdentityFile ~/.ssh/id_ed25519' operis@148.113.44.174
# or paste the .pub into /home/operis/.ssh/authorized_keys via sudo
ssh -i ~/.ssh/operis_deploy operis@148.113.44.174 'docker ps >/dev/null && echo OK'
```

### 4 — Secrets

```bash
scp deploy/env.production.example operis@148.113.44.174:/opt/operis/.env
ssh operis@148.113.44.174 'chmod 600 /opt/operis/.env'
```

Generate every secret with the block at the top of that file and fill it in. Minimum
set: `POSTGRES_PASSWORD`, `JWT_SECRET`, `AUTH_SECRET`, `CONSENT_INTEGRITY_SECRET`,
`TENANT_DATA_ENCRYPTION_FALLBACK_KEY`, `LOOKUP_HASH_PEPPER`, `MEILISEARCH_MASTER_KEY`,
`OM_INIT_SUPERADMIN_EMAIL`, `OM_INIT_SUPERADMIN_PASSWORD`, `ADMIN_EMAIL`.

> **Back up `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` and `LOOKUP_HASH_PEPPER` off this
> server, today.** Operis encrypts PII at rest with them. Lose them and a database
> backup restores unreadable data.

### 5 — Registry access

Nothing to do. The server holds **no** registry credential: the deploy job pipes the
run-scoped `GITHUB_TOKEN` over stdin for a `docker login`, pulls, and runs
`docker logout` again in an `always()` step. The token is valid only for the life of
that run, so there is no long-lived password on the VPS to leak or rotate.

That is also why the app service uses `pull_policy: missing` rather than `always` —
`deploy.sh` pulls explicitly while the login is held, and a later manual `./dc up -d`
must not try to re-pull an image already in the local store.

### 6 — Issue the certificate

Before the vhost exists, using the existing certbot volumes and webroot. This adds a
new certificate; it does not touch the `erp.pca-sds.com` one.

```bash
docker run --rm \
  -v pca-erp-certbot-certs:/etc/letsencrypt \
  -v pca-erp-certbot-webroot:/var/www/certbot \
  certbot/certbot:v3.1.0 certonly --webroot -w /var/www/certbot \
  -d operis.faheemkamel.com \
  --email <you@example.com> --agree-tos --no-eff-email \
  --key-type ecdsa --non-interactive

# verify before going further
docker run --rm -v pca-erp-certbot-certs:/etc/letsencrypt \
  certbot/certbot:v3.1.0 certificates
```

Rehearse with `--staging` first if DNS has only just propagated — Let's Encrypt allows
5 failures per account per hostname per hour.

### 7 — Install the vhost

**Order matters.** nginx refuses to start when `ssl_certificate` points at a missing
file, so the certificate must already exist (step 6) before this file lands.

```bash
# laptop
scp deploy/nginx/operis.conf.template \
    ubuntu@148.113.44.174:/opt/pca-erp/docker/nginx/templates/

# server — render + validate BEFORE reloading
docker exec pca-erp-nginx sh -c 'ls /etc/nginx/templates/'
docker compose -f /opt/pca-erp/docker-compose.prod.yml --env-file /opt/pca-erp/.env.prod \
  up -d --no-deps nginx        # re-renders templates
docker exec pca-erp-nginx nginx -t     # MUST print "syntax is ok" / "test is successful"
docker exec pca-erp-nginx nginx -s reload
```

`nginx -t` is the gate. A config it rejects never reaches the running process, so a
mistake here fails closed rather than taking the pca-sds.com hostnames down.

The file is untracked inside `/opt/pca-erp`'s git checkout. `git pull` leaves untracked
files alone, so it survives their deploys — but `git clean -fd` would remove it. Commit
it to the pca-erp repo when convenient.

### 8 — GitHub configuration

**Secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `DEPLOY_SSH_KEY` | contents of `~/.ssh/operis_deploy` (private key, whole file) |
| `DEPLOY_HOST` | `148.113.44.174` |
| `DEPLOY_USER` | `operis` |
| `DEPLOY_KNOWN_HOSTS` | `148.113.44.174 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBdKBpdKv5F5XFVMa80QQFZyplaJLmdoG5v5R0m9PdK3` |

`DEPLOY_PORT` is not needed (22).

**Variables** tab: `APP_DOMAIN` = `operis.faheemkamel.com`.

**Environments → `production`** (recommended): move those secrets into it and add
yourself as a required reviewer, so deploys pause for a click and no other workflow in
the repo can read the deploy key.

### 9 — First deploy

Actions → **CI & Deploy** → Run workflow.

The first build takes **30–60 minutes** (cold cache, whole monorepo). First container
start is also slow: `mercato init` creates the schema and seeds before the app answers,
which is why the health check allows 10 minutes.

Then sign in at `https://operis.faheemkamel.com` with `OM_INIT_SUPERADMIN_EMAIL` /
`OM_INIT_SUPERADMIN_PASSWORD` and **change that password immediately**.

### 10 — Nightly backups

`backup.sh` is synced by CI but **nothing calls it until the timer is installed**.
On a single-purpose host `01-bootstrap-server.sh` would have done this; here it is a
separate step, because that script cannot run on a shared box.

```bash
scp deploy/install-backup-timer.sh ubuntu@148.113.44.174:/tmp/
ssh ubuntu@148.113.44.174 'sudo bash /tmp/install-backup-timer.sh --verify'
```

`--verify` takes one backup immediately, so you find out now — rather than in a
crisis — that the dump works and restores. Confirm afterwards:

```bash
ssh operis@148.113.44.174 'systemctl list-timers operis-backup.timer --no-pager; ls -lh /opt/operis/backups/'
```

---

## Day-2 operations

From `/opt/operis`:

```bash
./dc ps                       # what is running
./dc logs -f app              # follow application logs
./dc restart app
./dc stats
./deploy.sh --status          # deployed tag + health of every service

./deploy.sh --rollback        # back to the previous image, immediately
./backup.sh                   # ad-hoc backup
./backup.sh --list
./backup.sh --verify          # restore into a scratch DB and count tables

./dc exec postgres psql -U operis -d operis
```

Gateway and TLS live in the other stack:

```bash
docker logs --tail 100 pca-erp-nginx
docker exec pca-erp-certbot certbot certificates
docker exec pca-erp-nginx nginx -t && docker exec pca-erp-nginx nginx -s reload
```

Redeploy an older build without rebuilding: Actions → **CI & Deploy** → Run workflow →
put the tag (`sha-abc1234`) in the **image_tag** input. `skip_quality` is the
emergency escape hatch when a flaky test is blocking a needed deploy.

### Restoring the database

```bash
cd /opt/operis
./dc stop app
docker exec -i $(./dc ps -q postgres) \
  pg_restore -U operis -d operis --clean --if-exists --no-owner \
  < backups/daily-20260824T031700Z.dump
./dc start app
```

---

## What happens on each deploy

1. `quality` (lint + typecheck + unit tests) and `build` (the Docker image) run
   concurrently. `deploy` waits for both, so nothing ships unless both are green.
   The image build is itself a second gate: `next build` type-checks and lints,
   with no `ignoreBuildErrors` in `next.config.ts`.
2. CI rsyncs the compose file, `redis.conf` and the scripts.
3. `deploy.sh` checks that `pca-erp-network` still exists, then pulls the image
   **first** — a registry failure cannot take the running app down.
4. It takes a `pg_dump` and **refuses to continue if the backup fails**.
5. `docker compose up -d`. The app container runs `init-or-migrate.sh`: migrations plus
   role-ACL sync, then `yarn start`.
6. It polls the container health check (`/api/configs/health`, a real DB round-trip)
   for up to 10 minutes.
7. On failure it prints the app log and rolls the **image** back to the previous tag.
8. CI curls `https://operis.faheemkamel.com/api/configs/health` from outside.

nginx needs no reload on deploy: it resolves `operis-app` per request via
`resolver 127.0.0.11 valid=10s`, so a recreated container is picked up within seconds.

---

## Honest limitations

**30–90 seconds of downtime per deploy.** One app container is replaced by another and
migrations run at boot. Not blue/green.

**Rolling the image back does not roll the database back.** If a bad release migrated,
the previous image may run against a newer schema. The pre-deploy dump is the escape
hatch, restored deliberately. Write backward-compatible migrations and this stays
theoretical.

**Operis shares `pca-erp-network` with that stack's Postgres, Redis, MinIO and
Zitadel.** Network reachability is not access — those services have their own
credentials — but a compromised Operis container is one hop closer to them than it
would be on an isolated network. The alternative (`docker network connect` onto a
private network) does not survive a pca-erp redeploy recreating nginx, which is a worse
failure mode.

**Backups live on the machine they protect.** Losing the VPS loses them. `backup.sh`
ends with a worked rclone example.

**The app container runs as uid 0**, matching upstream's own compose. It publishes no
ports and carries `no-new-privileges`.

**One shared gateway is one shared blast radius.** A future change to
`operis.conf.template` is a change to the process serving four other hostnames. Always
`nginx -t` first.

**No monitoring or alerting.** Point an uptime checker at
`https://operis.faheemkamel.com/api/configs/health` — 200/`ok` or 503/`degraded`.

---

## Troubleshooting

| Symptom | Where to look |
|---|---|
| Workflow fails at *Verify connectivity* | `DEPLOY_KNOWN_HOSTS` wrong, or the `operis` user's key not installed |
| `cannot pull …` | CI passes the image, so the namespace is no longer a suspect. Check the tag exists in the `Building ghcr.io/…` line of the build job, then redo the GHCR `docker login` as the `operis` user (token needs `read:packages`), then confirm the GHCR package is linked to this repository and its visibility allows the pull |
| `digest mismatch — refusing to deploy` | the tag no longer resolves to the image CI built: it was re-pushed, or the registry served a stale manifest. Nothing was changed on the server. Re-run the workflow to build and deploy a fresh tag |
| `N required variable(s) missing or too short` | `.env` does not satisfy `required-env`; the failing keys are listed by name. Nothing was pulled or restarted. Generate secrets with the snippet at the top of `env.production.example` |
| `network pca-erp-network does not exist` | the pca-erp stack was torn down or renamed; `docker network ls`, then set `EDGE_NETWORK` in `.env` |
| Browser shows the PCA ERP site or a cert warning | the vhost is not loaded — `docker exec pca-erp-nginx nginx -T \| grep operis` |
| 502 from the gateway | app container down or not on the edge network: `./dc ps`, then `docker inspect operis-app --format '{{json .NetworkSettings.Networks}}'` |
| App container restarts in a loop | `./dc logs --tail 100 app` — usually a missing/short secret; `JWT_SECRET` under 32 chars refuses to boot |
| Health check times out on first deploy | normal for `mercato init`; watch `./dc logs -f app` |
| `503 degraded` from the health endpoint | app cannot reach Postgres — `./dc logs postgres` |
| SSE / live updates never arrive | the streaming `location` block in the vhost — confirm `proxy_buffering off` survived a template edit |
| Deploy blocked by *another deploy is in progress* | stale lock: `rm /opt/operis/.deploy.lock` after confirming nothing is running |
