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
        │  ONE image. Staging and production deploy the same digest;         │
        │  nothing is rebuilt between them.                                  │
        │                                                                    │
        │  deploy staging ──► [approval] ──► deploy production               │
        │                                                                    │
        │ ssh + rsync (compose, redis.conf, scripts)                         │ docker pull
        ▼                                                                    ▼
  ┌──────────────────────────── OVH VPS ──────────────────────────────────────┐
  │                                                                           │
  │  :80 :443 ── pca-erp-nginx ─┬─► erp / auth / cloud / files.pca-sds.com    │
  │  (NOT OURS)                 │                                             │
  │                             ├─► operis.faheemkamel.com                    │
  │                             │            │ pca-erp-network                │
  │                             │            ▼                                │
  │                             │       operis-app ──┬─► operis-postgres  ┐   │
  │                             │                    ├─► operis-redis     │ operis-
  │                             │                    └─► operis-meilisearch┘ internal
  │                             │                                             │
  │                             └─► operis-staging.faheemkamel.com            │
  │                                          │ pca-erp-network                │
  │                                          ▼                                │
  │                             operis-staging-app ──┬─► operis-staging-postgres ┐
  │                                                  ├─► operis-staging-redis    │ operis-staging-
  │                                                  └─► operis-staging-meilisearch┘ internal
  └───────────────────────────────────────────────────────────────────────────┘
```

Both stacks run from the **same** `docker-compose.prod.yml`; `STACK_NAME` in each
stack's `.env` prefixes the compose project, every container name, the internal
network and every volume. The `pca-erp-network` gateway network is the one thing
they share, which is how one nginx reaches both.

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
| `nginx/operis.conf.template` | pca-erp templates dir | The production vhost. Installed **by hand, once**. |
| `nginx/operis-staging.conf.template` | pca-erp templates dir | The staging vhost. Same rules. Every http-context name in it is prefixed `operis_staging_*` — see below. |
| `redis.conf` | server | Redis with persistence on (queues live here). |
| `env.production.example` | → server `.env` | Every environment variable, annotated. |
| `env.staging.example` | → staging `.env` | The staging **delta** on top of the above, not a second copy of it. |
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
scp deploy/env.production.example ubuntu@148.113.44.174:/tmp/prod.env
ssh ubuntu@148.113.44.174 'sudo install -m 600 -o operis -g operis /tmp/prod.env /opt/operis/.env && rm -f /tmp/prod.env && sudo ls -l /opt/operis/.env'
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
ssh ubuntu@148.113.44.174 'systemctl list-timers operis-backup.timer --no-pager; sudo ls -lh /opt/operis/backups/'
```

---

## Staging

`operis-staging.faheemkamel.com`, at `/opt/operis-staging`, on this same host.

Every merge to `main` builds **one** image, deploys it to staging automatically, then
waits for a reviewer on the `production` environment before deploying **the same digest**
to production. Staging therefore costs no build time: the `runner` stage takes no
per-environment build arguments and the image is built with no `.env`, so one artifact
genuinely serves both. That is also what makes "it passed on staging" a statement about
the exact bytes production will run.

Staging is a QA environment, not a second production. Postgres runs at about half
production's settings, it gets a fresh `mercato init` seed rather than a copy of production
data, and it takes no pre-deploy database dump (`SKIP_BACKUP=1` — its database is
disposable, and with no backup timer nothing would prune the dumps).

**Staging costs no extra image disk.** Both stacks pull the *same tag*, so there is one
copy in the local image store, not two. That matters on this host: the image is ~6 GB and
`docker system df` already reports ~48 GB reclaimable in old Operis tags. `deploy.sh` prunes
images older than 168h on each deploy; staging deploying more often makes that run more
often, not less.

Measured on the box (2026-09-18): all 28 containers together use ~4.0 GiB against 17 GiB
available, and production Operis is 1.9 GiB of that. Staging is the same shape, so budget
~2 GiB. Re-check with `free -h` if this host ever gains another stack.

### One-time setup

Steps run in this order. Step 5 will refuse to start nginx if step 4 has not happened.

#### 1 — DNS

```
A    operis-staging    148.113.44.174    TTL 300
```

```bash
dig +short operis-staging.faheemkamel.com     # must return 148.113.44.174 before step 4
```

#### 2 — Directories

Reuses the existing `operis` deploy account — same key, same `docker` group, no new
credential to manage.

> **You cannot SSH as `operis`.** That account's `authorized_keys` holds exactly one key,
> `github-actions@operis`, and that is the point: the deploy account is reachable by CI and
> by nothing else. Every human command below therefore connects as `ubuntu` (which carries
> your laptop key and has passwordless sudo) and drops to `operis` with `sudo -u operis`
> where file ownership matters.

```bash
ssh ubuntu@148.113.44.174 'sudo install -d -m 750 -o operis -g operis /opt/operis-staging && sudo install -d -m 700 -o operis -g operis /opt/operis-staging/backups && sudo install -d -m 750 -o operis -g operis /opt/operis-staging/logs && ls -ld /opt/operis-staging /opt/operis-staging/backups /opt/operis-staging/logs'
```

#### 3 — Secrets

Land the template in `ubuntu`'s home first, then move it into place with the right owner
and mode — `scp` straight to `/opt/operis-staging` cannot work, because that directory is
`operis`-owned and you are connecting as `ubuntu`:

```bash
scp deploy/env.production.example ubuntu@148.113.44.174:/tmp/staging.env
```

```bash
ssh ubuntu@148.113.44.174 'sudo install -m 600 -o operis -g operis /tmp/staging.env /opt/operis-staging/.env && rm -f /tmp/staging.env && sudo ls -l /opt/operis-staging/.env'
```

Now apply **every** override in `env.staging.example` on top of it, and generate fresh
secrets with the block at the top of `env.production.example`:

```bash
ssh ubuntu@148.113.44.174 "for v in JWT_SECRET AUTH_SECRET NEXTAUTH_SECRET CONSENT_INTEGRITY_SECRET TENANT_DATA_ENCRYPTION_FALLBACK_KEY LOOKUP_HASH_PEPPER OM_THREAD_TOKEN_SECRET OM_HUB_OAUTH_STATE_KEY MEILISEARCH_MASTER_KEY DOMAIN_CHECK_SECRET DOMAIN_RESOLVE_SECRET; do echo \"\$v=\$(openssl rand -hex 32)\"; done; echo \"POSTGRES_PASSWORD=\$(openssl rand -base64 33 | tr -d '/+=' | head -c 40)\"; echo \"OM_INIT_SUPERADMIN_PASSWORD=\$(openssl rand -base64 18)\""
```

Paste that output into the file, then edit the rest:

```bash
ssh -t ubuntu@148.113.44.174 'sudo -u operis nano /opt/operis-staging/.env'
```

> **`STACK_NAME=operis-staging` is the line that matters.** Without it this stack renders
> as compose project `operis` and would adopt **production's** containers and volumes.
> `deploy.sh` asserts it against the value CI passes and refuses to run if they disagree —
> but set it correctly rather than relying on the guard.

Do not copy production's secrets. A shared `JWT_SECRET` or `AUTH_SECRET` makes a token
minted on staging valid against production.

#### 4 — Certificate

Uses the existing certbot volumes and webroot; adds a certificate, touches no existing one.
Renewal needs nothing further — pca-erp's certbot runs a blanket `certbot renew` twice a day.

Rehearse first if DNS has only just propagated (Let's Encrypt allows 5 failures per hostname
per hour):

```bash
ssh ubuntu@148.113.44.174 "docker run --rm -v pca-erp-certbot-certs:/etc/letsencrypt -v pca-erp-certbot-webroot:/var/www/certbot certbot/certbot:v3.1.0 certonly --webroot -w /var/www/certbot -d operis-staging.faheemkamel.com --email YOU@example.com --agree-tos --no-eff-email --key-type ecdsa --non-interactive --staging --dry-run"
```

Then for real:

```bash
ssh ubuntu@148.113.44.174 "docker run --rm -v pca-erp-certbot-certs:/etc/letsencrypt -v pca-erp-certbot-webroot:/var/www/certbot certbot/certbot:v3.1.0 certonly --webroot -w /var/www/certbot -d operis-staging.faheemkamel.com --email YOU@example.com --agree-tos --no-eff-email --key-type ecdsa --non-interactive"
```

```bash
ssh ubuntu@148.113.44.174 "docker run --rm -v pca-erp-certbot-certs:/etc/letsencrypt certbot/certbot:v3.1.0 certificates"
```

#### 5 — Install the vhost

> **This is the step that can take four unrelated hostnames offline.** `map` and
> `log_format` live in nginx's http context, so both Operis templates render into one
> namespace — a duplicate name is fatal and nginx then refuses to start at all. Every such
> name in the staging template is prefixed `operis_staging_*` for exactly this reason. Both
> templates have been verified to load together; keep the prefix if you edit it.

```bash
scp deploy/nginx/operis-staging.conf.template ubuntu@148.113.44.174:/opt/pca-erp/docker/nginx/templates/
```

Re-render, then **validate before reloading**:

```bash
ssh ubuntu@148.113.44.174 "docker compose -f /opt/pca-erp/docker-compose.prod.yml --env-file /opt/pca-erp/.env.prod up -d --no-deps nginx && docker exec pca-erp-nginx nginx -t"
```

`nginx -t` must print `syntax is ok` / `test is successful`. Only then:

```bash
ssh ubuntu@148.113.44.174 'docker exec pca-erp-nginx nginx -s reload'
```

If `nginx -t` fails, the running config is untouched — remove the template and re-render.

#### 6 — GitHub environments

The reviewer on `production` **is** the gate; nothing in the workflow enforces it.

```bash
gh api -X PUT repos/PCA-SDS/operis/environments/staging
gh variable set APP_DOMAIN --env staging --body operis-staging.faheemkamel.com
gh variable set APP_DOMAIN --env production --body operis.faheemkamel.com
```

Then, in **Settings → Environments → production**, tick **Required reviewers** and add
yourself. `DEPLOY_*` secrets stay repository-level — same host, same user, same key.

#### 7 — First deploy

Actions → **CI & Deploy** → Run workflow. Staging deploys first; production then waits for
your approval.

First boot is slow: `mercato init` creates the schema and seeds before the app answers, and
the health check allows 10 minutes for it. Then sign in at
`https://operis-staging.faheemkamel.com` with the staging `OM_INIT_SUPERADMIN_*` and change
that password.

### Day-2

Identical to production, with `APP_DIR` pointing at the staging stack:

```bash
ssh ubuntu@148.113.44.174 'sudo -u operis env APP_DIR=/opt/operis-staging /opt/operis-staging/deploy.sh --status'
```

```bash
ssh ubuntu@148.113.44.174 "sudo -u operis bash -c 'cd /opt/operis-staging && ./dc logs -f app'"
```

```bash
ssh ubuntu@148.113.44.174 'sudo -u operis env APP_DIR=/opt/operis-staging /opt/operis-staging/deploy.sh --rollback'
```

To reset staging to a clean seed — destroys its data, leaves production untouched because
every volume is prefixed:

```bash
ssh ubuntu@148.113.44.174 "sudo -u operis bash -c 'cd /opt/operis-staging && ./dc down -v && APP_DIR=/opt/operis-staging ./deploy.sh --status'"
```

Then re-run the workflow; the next boot runs `mercato init` again.

### Emergency: production without staging

`workflow_dispatch` → **skip_staging**. Mirrors `skip_quality`: available when staging is
broken and a fix must ship, and it means the release reaches production having run nowhere.

---

## Day-2 operations

From `/opt/operis`, **as the `operis` user**. You cannot SSH as `operis` (its
`authorized_keys` holds the CI key only), and `/opt/operis` is mode 750 owned by
`operis`, so `ubuntu` cannot even `cd` into it. Open a shell there like this:

```bash
ssh -t ubuntu@148.113.44.174 'sudo -u operis bash -c "cd /opt/operis && exec bash"'
```

Note the `cd` sits *inside* the `sudo`. Putting it outside — `ssh ubuntu@… 'cd /opt/operis
&& sudo -u operis …'` — fails with `Permission denied`, because the `cd` runs as `ubuntu`
before `sudo` is ever reached. Same applies to `/opt/operis-staging`.

Then, in that shell:

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
put the tag (`sha-abc1234`) in the **image_tag** input. That tag goes to staging first and
then waits for the production approval, exactly like a fresh build.

Two emergency escape hatches, both `workflow_dispatch` inputs: `skip_quality` when a flaky
test is blocking a needed deploy, and `skip_staging` when staging itself is broken. Each
removes a gate that exists for a reason — `skip_staging` in particular means the release
reaches production having run nowhere.

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
   concurrently. Both deploys wait for both, so nothing ships unless both are green.
   The image build is itself a second gate: `next build` type-checks and lints,
   with no `ignoreBuildErrors` in `next.config.ts`.
2. **Staging deploys first**, automatically, via steps 3–9 below against
   `/opt/operis-staging`.
3. **Production waits for a reviewer** on the `production` environment, then runs the
   same steps against `/opt/operis` with the **same image digest**. Nothing is rebuilt
   in between.

Each deploy, staging or production, is the same sequence:

4. CI rsyncs the compose file, `redis.conf` and the scripts into that stack's directory.
5. `deploy.sh` asserts the stack identity — `STACK_NAME` in that `.env` must match the
   stack CI is targeting — then checks `pca-erp-network` still exists and pulls the image
   **first**, so a registry failure cannot take the running app down.
6. It takes a `pg_dump` and **refuses to continue if the backup fails**. Skipped on
   staging, whose database is disposable.
7. `docker compose up -d`. The app container runs `init-or-migrate.sh`: migrations plus
   role-ACL sync, then `yarn start`.
8. It polls the container health check (`/api/configs/health`, a real DB round-trip)
   for up to 10 minutes.
9. On failure it prints the app log and rolls the **image** back to the previous tag.
10. CI curls that environment's `/api/configs/health` from outside, then probes
    `POST /api/auth/login` with deliberately wrong credentials — a 401 proves the DI
    container resolved, a 5xx proves it did not.

nginx needs no reload on deploy: it resolves `operis-app` / `operis-staging-app` per
request via `resolver 127.0.0.11 valid=10s`, so a recreated container is picked up within
seconds.

Because `concurrency.group` is per-ref and does not cancel on main, a run holding a pending
production approval **queues the next merge to main behind it**. That is the cost of the
gate; approve promptly, or split the concurrency groups.

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
| `stack mismatch — refusing to deploy` | that stack's `.env` renders a different compose project than the deploy targets — almost always a staging `.env` missing `STACK_NAME=operis-staging`. Nothing was pulled or restarted. Set it and re-run |
| `duplicate "map"` / `duplicate "log_format"` from `nginx -t` | the staging vhost reuses an http-context name from the production one. Every such name must be `operis_staging_*`. The running config is untouched while `nginx -t` fails |
| Production job never starts | either staging failed (production requires staging to have *succeeded*, not merely not-failed) or the environment approval is still pending — check the run's Review deployments prompt |
| Staging and production disagree about what is deployed | compare `deploy.sh --status` on both; each prints its own `CURRENT_TAG`. They differ whenever an approval is outstanding, which is the gate working |
