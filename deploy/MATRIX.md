# Chat on Matrix and WhatsApp — production runbook

Everything here runs **on the server**, in the stack's directory (`/opt/operis` or
`/opt/operis-staging`). Each stack opts in on its own through its `.env`. A stack
that never sets `COMPOSE_PROFILES` renders and runs exactly as before.

Architecture and reasons: ADR-0006, `.ai/specs/2026-09-10-matrix-chat-foundation.md`,
`.ai/specs/2026-09-29-whatsapp-bridge.md`.

| Phase | What changes | Switch |
|---|---|---|
| 0 | Decide the two permanent values | nothing runs yet |
| 1 | Synapse runs; chat still on Postgres | `COMPOSE_PROFILES=matrix` |
| 2 | Chat mirrors every message to Matrix (shadow) | `OM_CHAT_TRANSPORT=matrix` |
| 3 | Matrix owns the message stream | `OM_CHAT_MATRIX_MODE=authoritative` |
| WhatsApp | The WhatsApp bridge runs; businesses connect numbers | `COMPOSE_PROFILES=matrix,whatsapp` |

## Phase 0 — two decisions that cannot be undone

- **`OM_MATRIX_SERVER_NAME`** is embedded in every user id and room id the
  homeserver will ever mint. Production and staging must differ
  (e.g. `chat.pca-sds.com` and `chat-staging.pca-sds.com`). It never needs DNS —
  nothing federates — but pick a name you own.
- **`OM_MATRIX_USER_PREFIX`** (default `om_`) is the appservice's exclusive
  namespace. Leave the default.

`matrix-render.sh` refuses to change either once rendered.

## Phase 1 — the homeserver, chat unchanged

```bash
echo 'OM_MATRIX_SERVER_NAME=chat.example.com' >> .env   # Phase 0's decision
./matrix-render.sh --init-secrets    # fills in only what is missing, never prints a secret
./matrix-render.sh --check
./deploy.sh <current-tag>            # renders, backs up, starts matrix-postgres + synapse
./dc logs -f synapse                 # first start migrates the schema (~1-2 min)
```

`--init-secrets` sets `COMPOSE_PROFILES=matrix`, generates every Matrix secret,
and records `SYNAPSE_UID/GID` so `matrix/` stays writable by the deploy user.
`OM_CHAT_TRANSPORT` stays `local`: users see no change.

**Back up `matrix/signing.key` off this server now** (see Backups).

## Phase 2 — shadow

```bash
sed -i 's/^OM_CHAT_TRANSPORT=.*/OM_CHAT_TRANSPORT=matrix/' .env
./deploy.sh <current-tag>
./dc exec app yarn mercato chat_matrix backfill --dry-run   # what history Matrix lacks
./dc exec app yarn mercato chat_matrix backfill             # publish it
./dc exec app yarn mercato chat_matrix drift                # healthy = exit 0
```

Postgres is still the source of truth; a homeserver outage only delays the mirror.
`deploy.sh` runs `chat_matrix schedules` after every healthy deploy on this
transport, so the `/sync` reader and drift checks exist even though the tenants
were set up on `local`.

## Phase 3 — authoritative

```bash
sed -i 's/^OM_CHAT_MATRIX_MODE=.*/OM_CHAT_MATRIX_MODE=authoritative/' .env
./deploy.sh <current-tag>
```

A send now fails if the homeserver refuses it. Back out by setting `shadow`.

## WhatsApp

**Before enabling:** the bridge is AGPL-3.0 software run unmodified (ADR-0006),
and it links a WhatsApp account the way WhatsApp Web does — an unofficial client.
WhatsApp may ban a number it flags; use a dedicated business number, not
someone's personal one, and no bulk or automated sending. The decision to accept
that is the business's (made 2026-09-29, see the spec).

```bash
sed -i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=matrix,whatsapp/' .env
echo 'OM_MATRIX_APPSERVICE_URL=http://app:3000' >> .env      # push mode — REQUIRED
echo 'OM_MATRIX_BRIDGE_GHOSTS=whatsapp=whatsapp_' >> .env    # who counts as a WhatsApp contact
./matrix-render.sh --init-secrets    # adds the bridge's tokens, database role and provisioning secret
./matrix-render.sh --check
./deploy.sh <current-tag>
./dc logs -f mautrix-whatsapp        # "Bridge started"
```

Requires Phase 2 or 3 (`OM_CHAT_TRANSPORT=matrix`). Push mode is required
because a company account's chats reach the app only by push; `--check` refuses
without it and without the ghost prefix, since either would leave chats silently
missing.

What runs: `mautrix-whatsapp-db` (one-shot: the bridge's own Postgres role and
database inside `matrix-postgres` — it cannot read the homeserver's tables) and
`mautrix-whatsapp` (as the deploy user, config read-only, internal network only).

Then, in Operis, as someone with `chat.accounts.manage` (admins have it):
**Chat → WhatsApp** (`/backend/chat/accounts`) → **Add account**, name it, pick
the team, and **Connect** — scan the QR code with the business phone (WhatsApp →
Settings → Linked devices → Link a device), or choose **Use a code instead** and
type the 8-character code there. Every chat on the number then appears in Chat
for the team; replies leave from the number. The last 30 chats (20 messages
each) are imported as already read.

The phone must come online at least every ~14 days or WhatsApp unlinks it; the
drift schedule notices within 15 minutes, marks the account disconnected and
notifies its managers, and reconnecting is one scan. To check now:

```bash
./dc exec -T app yarn mercato chat_matrix accounts      # one line per account, bridge state
```

Contact and account names and numbers are encrypted at rest: the migrations that
add accounts and contact numbers also update the encryption maps of every tenant
that already encrypts, so nothing is stored in plain text on an existing tenant.

**Personal WhatsApp.** Grant `chat.accounts.connect_own` to the roles that may
use it (admins have it). Those people connect their own number under **Profile →
My WhatsApp** (`/backend/profile/whatsapp`) the same way. Nothing on a personal
number is read until its owner picks **Move a chat to the company**, and then
only what is said from that moment on; replies in it leave from their number.
It needs the double-puppet registration `--init-secrets` already renders.

Internal notes, access levels (viewer / participant / manager) and the CRM link
need no operations. The CRM link and its phone-number suggestions appear when
the `customers` module is enabled.

To stop WhatsApp without touching chat: remove `whatsapp` from
`COMPOSE_PROFILES` and redeploy. Existing conversations stay; nothing new arrives.

## Backups

`backup.sh` (daily timer) and `deploy.sh` (before every deploy) dump:

| Dump | Contains |
|---|---|
| `*-matrix-*.dump` | the homeserver database — every room and message |
| `*-whatsapp-*.dump` | the bridge database — every connected account's WhatsApp session |

Two things are **not** in any dump and must be copied off the server by hand:

- `matrix/signing.key` — the homeserver's identity. It cannot be regenerated;
  a new key is a new homeserver and every room's history stops verifying.
- `matrix/media_store/` — files sent through Matrix. Operis keeps its own copy
  of every chat attachment, so this is the homeserver's cache, but a restore
  without it shows broken images in the Matrix history.

`whatsapp/config.yaml` and every registration are re-rendered from `.env` by
`matrix-render.sh`; back up `.env` (it already holds the app's secrets).

## Restore

```bash
./dc stop app mautrix-whatsapp synapse
docker exec -i "$(./dc ps -q matrix-postgres)" pg_restore -U synapse -d synapse --clean --if-exists < backups/<stamp>-matrix-<stamp>.dump
docker exec -i "$(./dc ps -q matrix-postgres)" pg_restore -U synapse -d mautrix_whatsapp --clean --if-exists < backups/<stamp>-whatsapp-<stamp>.dump
./matrix-render.sh && ./dc up -d
```

Restore `matrix/signing.key` first if the server itself was lost.

## Turning it off

| Goal | Change |
|---|---|
| Stop WhatsApp only | drop `whatsapp` from `COMPOSE_PROFILES` |
| Chat back on Postgres | `OM_CHAT_TRANSPORT=local` (Matrix keeps what it had) |
| Stop the homeserver | drop `matrix` from `COMPOSE_PROFILES` (data kept in its volume and `matrix/`) |

Nothing here deletes data; removing `matrix_postgres_data` and `matrix/` does,
and is only for starting over.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `matrix-render.sh` refuses to change `server_name` | the one-way door — put the old value back |
| synapse unhealthy, `password authentication failed` | `MATRIX_PG_PASSWORD` changed after the volume was created |
| WhatsApp chats never appear | push mode off, or `OM_MATRIX_BRIDGE_GHOSTS` missing `whatsapp=whatsapp_` |
| account shows *disconnected* | the phone was offline ~14 days, or it was unlinked on the phone — reconnect |
| `mautrix-whatsapp` restarts in a loop | `./dc logs mautrix-whatsapp`; usually its database role (re-run the deploy) |
