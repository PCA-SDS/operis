# Deploying Operis to an OVHcloud VPS

Push to `main` → GitHub Actions builds a container image → the VPS pulls it and restarts.

Nothing is compiled on the server. The image is built once in CI, pushed to GitHub
Container Registry, and pulled by tag. The server holds only the compose file, the
reverse-proxy config, and a `.env` that never leaves it.

```
  git push main
        │
        ▼
  GitHub Actions ── docker build (Dockerfile, target: runner) ──► ghcr.io/<you>/operis:sha-abc1234
        │                                                                    │
        │ ssh + rsync (compose, Caddyfile, scripts)                          │ docker pull
        ▼                                                                    ▼
  ┌──────────────────────────── OVH VPS ──────────────────────────────────────┐
  │  :80 :443  caddy ──► app ──► postgres (pgvector)                          │
  │            (TLS)      │  ├─► redis        (cache + BullMQ + rate limits)  │
  │                       │  └─► meilisearch  (search)                        │
  │                       └─ runs migrations on boot, then `yarn start`       │
  └───────────────────────────────────────────────────────────────────────────┘
```

Only Caddy publishes ports. Postgres, Redis, Meilisearch and the app are reachable
only on the internal Docker network — there is nothing else exposed to firewall.

---

## Files

| File | Runs where | Purpose |
|---|---|---|
| `00-audit-server.sh` | server | **Read-only** inventory. Changes nothing. Run first. |
| `01-bootstrap-server.sh` | server | Hardening + Docker install. **Dry-run unless `--apply`.** |
| `docker-compose.prod.yml` | server (as `docker-compose.yml`) | The stack. Never builds; pulls the CI image. |
| `Caddyfile` | server | TLS termination, automatic Let's Encrypt. |
| `redis.conf` | server | Redis with persistence on (queues live here). |
| `env.production.example` | → server `.env` | Every environment variable, annotated. |
| `deploy.sh` | server | Pull → back up → start → health-check → roll back on failure. |
| `backup.sh` | server | Nightly `pg_dump` with retention and integrity check. |
| `dc` | server | `docker compose` wrapper that supplies both env files. |
| `../.github/workflows/deploy-production.yml` | GitHub | The pipeline. |

`deploy.sh`, `backup.sh`, `dc`, the compose file, `Caddyfile` and `redis.conf` are
rsynced to the server by every deploy — edit them here, in git, never on the box.
`.env`, `backups/` and `logs/` are server-only and CI never touches them.

---

## Requirements

- Ubuntu 22.04 or 24.04 VPS
- **4 GB RAM minimum, 8 GB recommended.** Postgres + Redis + Meilisearch + a Next.js
  server on 2 GB will thrash. Check section 2 of the audit before committing.
- 40 GB disk
- A domain with an A record you can point at the VPS
- Ports 80 and 443 reachable (check the OVH control-panel firewall too — it is
  separate from anything on the machine)
- **x86_64.** The workflow builds `linux/amd64`, which covers every standard OVH VPS.
  If §1 of the audit reports `arch: aarch64`, change `--platform linux/amd64` to
  `linux/arm64` in the workflow — otherwise the server pulls the image and fails with
  `exec format error`.

---

## Phase 1 — Look before you touch

From your laptop, without copying anything to the server:

```bash
ssh root@YOUR_SERVER_IP 'bash -s' < deploy/00-audit-server.sh | tee server-audit.txt
```

Read `server-audit.txt`. The four things that decide the plan:

- **§2 Resources** — enough RAM and disk?
- **§3 Open ports** — is anything already on `:80`/`:443`? If yes, see
  [Running behind an existing nginx](#running-behind-an-existing-nginx).
- **§8 Docker** — already installed? Already running containers you care about?
- **§9 Directories** — anything of value in `/opt`, `/srv`, `/var/www`?

The script prints SSH key **fingerprints**, never key material, and never reads a
`.env`. It runs no `apt update` and starts nothing.

---

## Phase 2 — DNS

Point the domain at the server *before* bootstrapping. Caddy proves control of the
hostname to Let's Encrypt over port 80; without DNS, certificate issuance fails.

```
Type  Name   Value             TTL
A     app    <SERVER_IPv4>     300
```

Verify (allow for propagation):

```bash
dig +short app.your-domain.com          # must return the server IP
```

---

## Phase 3 — Create the CI deploy key

On your laptop. This key is what GitHub Actions authenticates with — it belongs to
the pipeline, not to you, and has no passphrase because CI cannot type one.

```bash
ssh-keygen -t ed25519 -C 'github-actions@operis' -f ~/.ssh/operis_deploy -N ''
cat ~/.ssh/operis_deploy.pub      # public  → goes on the server
cat ~/.ssh/operis_deploy          # private → goes in a GitHub secret
```

---

## Phase 4 — Bootstrap the server

Copy the script over and **look at the plan first** — it does nothing without `--apply`:

```bash
scp deploy/01-bootstrap-server.sh root@YOUR_SERVER_IP:/tmp/
ssh root@YOUR_SERVER_IP

# 1) dry run — prints every change it would make, changes nothing
bash /tmp/01-bootstrap-server.sh --ci-key "ssh-ed25519 AAAA... github-actions@operis"

# 2) if the plan looks right
bash /tmp/01-bootstrap-server.sh --ci-key "ssh-ed25519 AAAA... github-actions@operis" --apply
```

It creates the `deploy` user, authorizes the CI key, hardens sshd (drop-in file,
validated with `sshd -t`, applied with `reload` so your session survives), enables
ufw + fail2ban + unattended security upgrades, installs Docker CE with log rotation,
adds swap if RAM < 8 GB, creates `/opt/operis`, and installs a nightly backup timer.

**Before closing that session**, open a second terminal and prove you are not locked out:

```bash
ssh -i ~/.ssh/operis_deploy deploy@YOUR_SERVER_IP 'docker ps && echo OK'
```

> The script sets `PermitRootLogin prohibit-password` rather than `no`. Tighten it to
> `no` in `/etc/ssh/sshd_config.d/99-operis.conf` once you have confirmed you can get
> in as `deploy`.

---

## Phase 5 — Secrets on the server

```bash
scp deploy/env.production.example deploy@YOUR_SERVER_IP:/opt/operis/.env
ssh deploy@YOUR_SERVER_IP
chmod 600 /opt/operis/.env

# generate every secret at once, then paste the values in
for v in JWT_SECRET AUTH_SECRET NEXTAUTH_SECRET CONSENT_INTEGRITY_SECRET \
         TENANT_DATA_ENCRYPTION_FALLBACK_KEY LOOKUP_HASH_PEPPER MEILISEARCH_MASTER_KEY; do
  echo "$v=$(openssl rand -hex 32)"
done
echo "POSTGRES_PASSWORD=$(openssl rand -base64 33 | tr -d '/+=' | head -c 40)"
echo "OM_INIT_SUPERADMIN_PASSWORD=$(openssl rand -base64 18)"

nano /opt/operis/.env
```

Fill in at minimum: `APP_DOMAIN`, `APP_URL`, `ACME_EMAIL`, `APP_IMAGE`,
`POSTGRES_PASSWORD`, `JWT_SECRET`, `AUTH_SECRET`, `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`,
`LOOKUP_HASH_PEPPER`, `MEILISEARCH_MASTER_KEY`, `OM_INIT_SUPERADMIN_EMAIL`,
`OM_INIT_SUPERADMIN_PASSWORD`, `ADMIN_EMAIL`. Every variable is documented in the file.

> **Back up `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` and `LOOKUP_HASH_PEPPER` somewhere
> other than this server, today.** Operis encrypts PII at rest with them. Lose them and
> the data is unreadable — a database backup will not save you.

### Let the server pull from GHCR

Create a GitHub Personal Access Token (classic) with **only** `read:packages`
(Settings → Developer settings → Personal access tokens), then:

```bash
echo 'ghp_YOUR_READ_PACKAGES_TOKEN' | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

Stored once in `~/.docker/config.json`; the pipeline never carries it.

---

## Phase 6 — GitHub configuration

**Settings → Secrets and variables → Actions → Secrets:**

| Secret | Value |
|---|---|
| `DEPLOY_SSH_KEY` | contents of `~/.ssh/operis_deploy` (the **private** key, whole file including header/footer lines) |
| `DEPLOY_HOST` | server IPv4 |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_PORT` | SSH port (omit if 22) |
| `DEPLOY_KNOWN_HOSTS` | output of the command below |

```bash
ssh-keyscan -t ed25519 YOUR_SERVER_IP        # run from your laptop
```

Pinning the host key is deliberate: `StrictHostKeyChecking=accept-new` would make CI
trust whatever answers on first connect, which is a machine-in-the-middle handing your
deploy key to someone else.

**Variables** tab:

| Variable | Value |
|---|---|
| `APP_DOMAIN` | `app.your-domain.com` — used for the post-deploy smoke test |

**Settings → Environments → New environment → `production`** *(recommended)*: move the
five secrets above into it and add yourself as a required reviewer. Deploys then pause
for a click, and no other workflow in the repo can read those secrets.

---

## Phase 7 — First deploy

Actions → **Deploy to production** → Run workflow.

Expect the first run to take **30–60 minutes**: the image build compiles the whole
monorepo with no warm cache. Later runs reuse the registry build cache and are much
faster. First container start is also slow — `mercato init` creates the schema and
seeds data before the app answers, which is why the health check allows 10 minutes.

Then visit `https://app.your-domain.com` and sign in with `OM_INIT_SUPERADMIN_EMAIL` /
`OM_INIT_SUPERADMIN_PASSWORD`. **Change that password immediately.**

Once HTTPS works, uncomment the `Strict-Transport-Security` header in `Caddyfile` and
push. (Enabling HSTS before HTTPS works locks browsers out of the domain for a year.)

After that, every push to `main` deploys automatically.

---

## Day-2 operations

All from `/opt/operis` on the server:

```bash
./dc ps                       # what is running
./dc logs -f app              # follow application logs
./dc logs --tail 200 caddy    # TLS / certificate problems
./dc restart app
./dc stats                    # live CPU/memory per container
./deploy.sh --status          # deployed tag + health of every service

./deploy.sh --rollback        # back to the previous image, immediately
./backup.sh                   # ad-hoc backup
./backup.sh --list
./backup.sh --verify          # restore into a scratch DB and count tables

./dc exec postgres psql -U operis -d operis
```

Redeploy an older build without rebuilding: Actions → Run workflow → put the tag
(`sha-abc1234`) in the **image_tag** input.

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

1. CI builds the image. `next build` type-checks and lints, so a broken `main` never
   produces an image and never reaches the server.
2. CI rsyncs the compose file, `Caddyfile`, `redis.conf` and the scripts.
3. `deploy.sh` pulls the image **first** — a registry failure cannot take the running
   app down.
4. It takes a `pg_dump` and **refuses to continue if the backup fails**.
5. `docker compose up -d`. The app container runs `init-or-migrate.sh`: migrations plus
   role-ACL sync, then `yarn start`.
6. It polls the container health check (which hits `/api/configs/health`, a real DB
   round-trip) for up to 10 minutes.
7. On failure it prints the app log and rolls the **image** back to the previous tag.
8. CI then curls `https://APP_DOMAIN/api/configs/health` from outside as an independent
   check.

---

## Honest limitations

**There is a downtime window of roughly 30–90 seconds per deploy.** One app container
is replaced by another, and migrations run at boot. This is not blue/green. If you need
zero downtime later, run two app replicas behind Caddy and move migrations into a
separate one-shot job that runs before the new replicas start.

**Rolling the image back does not roll the database back.** If a bad release applied a
migration, the previous image may then be running against a newer schema. The
pre-deploy dump is the escape hatch, and restoring it is a deliberate manual act — see
above. Write backward-compatible migrations (add columns, don't rename or drop in the
same release as the code change) and this stays theoretical.

**Backups live on the machine they protect.** Losing the VPS loses them. Add an off-site
copy — `backup.sh` ends with a worked rclone example.

**The app container runs as uid 0.** Upstream's own compose does the same; the
entrypoint writes the init marker and attachment volume before handing off. It
publishes no ports and carries `no-new-privileges`. Moving to the image's `omuser`
(uid 1001) is possible but needs the marker path and corepack cache relocated first —
worth doing, not worth doing untested on your first deploy.

**The `deploy` user is in the `docker` group, which is root-equivalent** on that host.
That is the standard tradeoff for a CI deploy account; it is why the account is
key-only and has no sudo rights.

**No monitoring or alerting is included.** You will not be told when the site goes down.
Point an uptime checker at `https://app.your-domain.com/api/configs/health` — it returns
200/`ok` or 503/`degraded` — and set `TELEMETRY_BACKEND` in `.env` when you want traces.

---

## Troubleshooting

| Symptom | Where to look |
|---|---|
| Workflow fails at *Verify connectivity* | `DEPLOY_KNOWN_HOSTS` wrong or stale (rebuilt server = new host key), or ufw is blocking the SSH port |
| `cannot pull … is the server logged in?` | redo the GHCR `docker login` in Phase 5; token needs `read:packages` |
| Browser shows a certificate warning | `./dc logs caddy` — usually DNS not pointing here yet, or :80 blocked so the ACME challenge fails |
| App container restarts in a loop | `./dc logs --tail 100 app` — most often a missing/short secret in `.env`; `JWT_SECRET` under 32 chars refuses to boot |
| Health check times out on first deploy | normal for `mercato init` on a slow VPS; watch `./dc logs -f app`, raise `HEALTH_TIMEOUT` if genuinely needed |
| `503 degraded` from the health endpoint | the app cannot reach Postgres — `./dc ps`, `./dc logs postgres` |
| Deploy blocked by *another deploy is in progress* | a previous run died holding the lock: `rm /opt/operis/.deploy.lock` after confirming nothing is running |
| Out of disk | `docker system df`, `./backup.sh --list`; log rotation is capped at 10 MB × 5 per container |

---

## Running behind an existing nginx

If the audit showed something already on `:80`/`:443`, do not fight it. Remove the
`caddy` service from `docker-compose.prod.yml`, publish the app on loopback only:

```yaml
  app:
    ports:
      - "127.0.0.1:3000:3000"
```

and proxy to it from the existing server, keeping the forwarded headers intact:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_buffering off;          # required: the app streams SSE
    client_max_body_size 32m;     # attachment uploads
}
```

`127.0.0.1:` on the port binding matters. A bare `"3000:3000"` publishes on every
interface and Docker's iptables rules bypass ufw, so the app would be reachable
from the internet on port 3000 while ufw insists the port is closed.

## Custom domains per customer

The single-domain Caddy setup here serves exactly `APP_DOMAIN`. If you later let
customers point their own domains at the portal, switch the edge to the repo's Traefik
overlay (`docker-compose.fullapp.traefik.yml` + `docker/traefik/README.md`), which
implements the ForwardAuth domain-check gate and on-demand certificates. Section F of
`env.production.example` lists the variables that turns on.
