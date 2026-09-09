# Matrix Communications Foundation

> Status: **Draft — pending decision gates in §3 and §12**
> Author: planning pass, 2026-09-09
> Related: `SPEC-045d-communication-notification-hubs.md`, `2026-05-21-email-integration-foundation.md`,
> `docs/architecture/adr/ADR-0002-exclude-enterprise-edition.md` (licensing precedent)

---

## 1. TLDR

Adopt **Matrix** (self-hosted Synapse + mautrix bridges on the existing VPS) as the
transport and interoperability plane for Operis communications, wired in as a
**new provider package `packages/channel-matrix`** behind the *existing*
`ChannelAdapter` contract in `communication_channels`.

This unlocks WhatsApp, Telegram, Signal, Instagram, Messenger, Slack, Discord,
Google Messages/SMS and native Matrix inside the ERP's unified inbox — **without
touching a single line of the `chat` module, the `messages` module, or any
existing UI**.

Three things this plan deliberately does *not* do:

1. It does **not** rip out the `chat` module. `chat` is internal org messaging
   (direct + spaces) with per-viewer translation, mentions, pins, reactions and
   read cursors — 30 379 lines across 144 files, all working. Matrix adds nothing
   to those semantics. Mirroring `chat` onto Matrix is a **separate, opt-in,
   flag-gated Phase 6** whose value is *native Element/mobile access*, not a
   transport upgrade.
2. It does **not** put Matrix credentials in the browser. The browser keeps
   talking only to the ERP API; the ERP holds the appservice token server-side.
   Existing UI, ACL and tenancy stay in one place.
3. It does **not** pretend Beeper is self-hostable. See §2.

---

## 2. What "Beeper/Matrix" actually means here

Beeper is a **product** (Automattic-owned), not a self-hostable server. What is
genuinely free and open source — and what this plan uses — is the stack Beeper
itself is built on:

| Layer | Component | License | Role here |
|---|---|---|---|
| Homeserver | [Synapse](https://github.com/element-hq/synapse) | **AGPL-3.0** (dual, since Dec 2023) | The message bus. Only homeserver with complete appservice + worker support. |
| Bridges | [mautrix-*](https://github.com/mautrix) (whatsapp, telegram, signal, meta, slack, discord, gmessages, twitter) | **AGPL-3.0** | Terminate each foreign network's protocol, expose it as Matrix rooms. Beeper uses these same bridges. |
| Bridge framework | `mautrix/go` `bridgev2` ("megabridge") | AGPL-3.0 | Gives every modern bridge a uniform **`/_matrix/provision` v3 API** — this is what lets the ERP render a WhatsApp QR login *inside Operis*. |
| Webhook/DevOps bridge | [matrix-hookshot](https://github.com/matrix-org/matrix-hookshot) | Apache-2.0 | Optional: GitHub/GitLab/Jira/generic webhooks into rooms. |
| Auth (optional) | [Matrix Authentication Service](https://github.com/matrix-org/matrix-authentication-service) | Apache-2.0 | Optional Phase 8: ERP as OIDC provider → staff log into Element with their Operis account. |
| Admin | synapse-admin | Apache-2.0 | Ops console, internal-network only. |
| Client SDK | matrix-js-sdk / matrix-bot-sdk | Apache-2.0 | Only needed if Phase 8 exposes a direct-to-Matrix client. Phase 1–7 use plain `fetch`. |

**Beeper's own `bridge-manager` (`bbctl`) is explicitly out of scope**: it runs
self-hosted bridges *against Beeper's servers*, which would put customer message
content on a third party. We run our own homeserver.

### 2.1 AGPL — the one licensing question that needs an ADR

Synapse and every mautrix bridge are AGPL-3.0. Operis is MIT. This is **not** a
contamination problem as designed, because:

- Operis talks to them over documented HTTP APIs (Client-Server API, appservice
  API, provisioning API) as separate network services. Aggregation over a network
  boundary is not derivation.
- We deploy **unmodified upstream container images**, pinned by digest.

The obligations that *do* apply, and the rules that follow from them:

- **Never fork or patch Synapse or a bridge.** The moment you modify one and
  offer it over a network, you must offer that modified source to its users.
  Configuration is not modification; a patched Dockerfile that changes behaviour
  is. If a patch becomes necessary, publish the fork.
- Anyone interacting with the homeserver over the network is entitled to
  Synapse's source. Serving unmodified upstream satisfies this by pointing at
  upstream, but it must be a conscious, recorded decision.

**Action: write `docs/architecture/adr/ADR-0006-matrix-agpl-boundary.md` before
Phase 1 merges.** This repo already excluded the Enterprise Edition on licensing
grounds (ADR-0002); the same rigour applies here.

---

## 3. Decision gate — WhatsApp is two different products

This is the single most consequential choice in the plan and it is a **business**
decision, not a technical one.

| | **Track A — mautrix-whatsapp** | **Track B — WhatsApp Business Cloud API** |
|---|---|---|
| How | `whatsmeow`, the reverse-engineered WhatsApp Web multi-device protocol | Meta's official Graph API |
| Cost | Free | Per-conversation pricing + Meta business verification |
| Capability | Full: groups, media, reactions, edits, read receipts, any number | Template-gated outside the 24h customer service window |
| Risk | **Meta has intensified detection of unofficial clients through 2025–2026. The number can be banned.** Violates WhatsApp ToS. | Sanctioned |
| Fit | Internal ops, a team's own number, low volume, tolerant of disruption | Customer-facing, external system, anything contractual |

**Recommendation: build both, on the same adapter contract.** Track A ships in
Phase 3 (free, immediate, all the other networks come with it). Track B ships in
Phase 5 as `packages/channel-whatsapp-cloud`, speaking the official API through
the *identical* `ChannelAdapter` interface — so the unified inbox, threading,
CRM contact resolution and UI are written once.

Never point Track A at a number the business cannot afford to lose. Use a
dedicated SIM, never a director's personal number.

> **EU note:** the Digital Markets Act forced WhatsApp third-party interoperability,
> and Element demonstrated 1:1 Matrix↔WhatsApp over the DMA APIs. It is EEA-only
> and not productised. Track it; do not plan on it.

---

## 4. Problem statement

Operis today has three separate communication surfaces:

| Module | Scope | Size | Transport |
|---|---|---|---|
| `chat` | Internal, one organization. Direct + spaces. Translation, mentions, pins, reactions, read cursors. | 144 files / 30 379 LOC | ERP DB + SSE |
| `messages` | Unified inbox. Email-shaped, threads, recipients, attachments. | 200 files / 27 088 LOC | ERP DB |
| `communication_channels` | Bridge from external providers into `messages`. | 236 files / 33 777 LOC | Provider adapters |

`communication_channels` was *designed* for this — `apps/mercato/src/modules.ts`
already says it bridges "Slack, WhatsApp, Email" and that
"Provider packages (channel-slack, channel-whatsapp, …) register adapters here."
**Those packages were never written.** Only `channel-gmail`, `channel-imap` and
three push providers exist.

So the gap is not architectural. The gap is that nobody has written a provider
for chat networks — and writing one *per network* (WhatsApp, Telegram, Signal,
Instagram, Messenger, Slack, Discord, SMS) means eight reverse-engineered
protocol implementations, eight auth flows, eight media pipelines, eight
maintenance burdens.

**Matrix collapses that to one.** Write one adapter against the Matrix
Client-Server API; every mautrix bridge is a config file after that.

---

## 5. Proposed solution — two planes

```
                    ┌──────────────────────────────────────────────────┐
  PLANE A           │            Operis (unchanged UI)                 │
  external comms    │  messages inbox  ·  customers  ·  portal         │
                    └───────────────┬──────────────────────────────────┘
                                    │  ChannelAdapter (existing contract)
                    ┌───────────────┴──────────────────────────────────┐
                    │  packages/channel-matrix  (NEW)                  │
                    │  /sync ingest · masqueraded send · provisioning  │
                    └───────────────┬──────────────────────────────────┘
                                    │  Matrix C-S API + as_token
                    ┌───────────────┴──────────────────────────────────┐
                    │  Synapse   (federation OFF, registration OFF)    │
                    └───┬────────┬────────┬────────┬────────┬──────────┘
                        │        │        │        │        │
                  whatsapp  telegram  signal    meta     slack   … (mautrix)
                        │        │        │        │        │
                   WhatsApp  Telegram  Signal  IG/FB    Slack


  PLANE B (Phase 6, opt-in, flag-gated — NOT required for Plane A)
  chat module ⟷ channel-matrix mirror ⟷ Synapse ⟷ Element mobile/desktop
```

**Plane A is the whole point and carries essentially no risk to what exists.**
Plane B is a bonus that is deliberately sequenced last.

### 5.1 Why the `ChannelAdapter` contract fits Matrix almost suspiciously well

`packages/core/src/modules/communication_channels/lib/adapter.ts:501-630`:

| Adapter requirement | Matrix answer |
|---|---|
| `external_messages` unique `(channel_id, external_message_id)` (`data/entities.ts:234`) | Matrix `event_id` — globally unique, server-assigned. **Free deduplication.** |
| `external_conversation_id` | Matrix `room_id`. |
| `channel_state jsonb` opaque cursor (`entities.ts:~150`) | The `/sync` `next_batch` token. **Free resumable ingest.** |
| `verifyWebhook` MUST throw when unverifiable (`adapter.ts:541`) | `hs_token` constant-time comparison — or, in the recommended design, *no inbound endpoint at all*. |
| `capabilities.realtimePush !== false` ⇒ hub schedules polling (`adapter.ts:50`) | Long-poll `/sync` maps exactly onto the existing `communication-channels-poll` worker. |
| `sendReaction` / `removeReaction` / `editMessage` / `deleteMessage` | `m.reaction`, `m.replace`, `m.room.redaction`. |
| `fetchHistory(cursor, channelState)` (`adapter.ts:561`) | `/sync` with `since`. |
| `importHistory` (`adapter.ts:569`) | `/messages` back-pagination. |
| `resolveContact` (`adapter.ts:596`) | Ghost localpart carries the phone number: `@whatsapp_447700900123:server`. |
| Outbound retry with no provider idempotency key (`commands/deliver-outbound-message.ts:421-423`) | Matrix `PUT .../send/m.room.message/{txnId}` — **the transaction ID is the idempotency key.** Derive it from the ERP message UUID and retries become free. |

### 5.2 The key architectural call: pull, don't push

The Matrix appservice spec normally has the homeserver **PUSH** transactions to
`PUT <your-url>/_matrix/app/v1/transactions/{txnId}`. **Do not do that in Phase 1.**

Register the appservice with **`url: null`** — an explicitly supported
configuration, the same one the mautrix double-puppet registration uses — and
have the ERP **PULL** with `/sync` as the appservice sender, using the `as_token`.

| | Push (transactions) | **Pull (`/sync`) — recommended** |
|---|---|---|
| Inbound HTTP surface on the ERP | A new unauthenticated endpoint | **None** |
| Synapse → ERP network reachability | Required | Not required |
| Resumability | Manual txn tracking | `next_batch` in `channel_state`, already modelled |
| Reuses hub machinery | New path | **`poll-tick` → `poll-channel` → `fetchHistory`, already built and tested** |
| Latency | Immediate | ~sub-second with `timeout=30000` long-poll |

Pull is fewer moving parts, a smaller attack surface, and lands on code paths
that already have retry, backoff, dead-lettering and stuck-channel recovery
(`workers/poll-tick.ts:142-196`).

If sub-100ms latency is ever needed, push is available as a Phase-4 swap. It is
implementable: the app mounts module API routes through the generated dispatcher
behind `apps/mercato/src/app/api/[...slug]/route.ts`, and the route scanner only
skips `__tests__`/`__mocks__` and HTTP-method folder names
(`packages/cli/src/lib/generators/scanner.ts:76-77,148`) — so a literal
`api/put/channel_matrix/appservice/_matrix/app/v1/transactions/[txnId]/route.ts`
resolves correctly and Next.js's private-folder rule never applies.

---

## 6. Deployment topology (the actual VPS)

Ground truth from `deploy/README.md` and `deploy/docker-compose.prod.yml`:

- One OVH VPS. **8 vCPU, 22 GB RAM, no swap**, 193 GB disk at 8%.
- `pca-erp-nginx` owns :80/:443 as `default_server`; Operis is an additive SNI
  vhost (`deploy/nginx/operis.conf.template`) hand-installed into
  `/opt/pca-erp/docker/nginx/templates/`.
- Operis compose project `operis`, networks `operis-internal` + external
  `pca-erp-network`. **Zero published host ports.**
- ufw open: 22, 80, 443, 8088, 8090, 8091. **8448 is closed** — good, we want it closed.
- Secrets: `/opt/operis/.env`, mode 600, generated by `deploy/init-env.sh`.
- Backups: `deploy/backup.sh` covers the Operis DB **only**.

### 6.1 New stack: separate compose project `operis-matrix`

Keep it a **separate compose project with its own internal network**, joined to
`pca-erp-network` only by the one container nginx must reach. Rationale is the
repo's own (`deploy/docker-compose.prod.yml`): decoupled upgrade cycles,
connection budgets and restore windows.

| Service | Image | `mem_limit` | Network | Exposed |
|---|---|---|---|---|
| `synapse` | `ghcr.io/element-hq/synapse` (digest-pinned) | 1500m | matrix-internal + edge | via nginx vhost only |
| `synapse-postgres` | `postgres:17-alpine`, `LC_COLLATE=C LC_CTYPE=C` | 1024m | matrix-internal | no |
| `mautrix-whatsapp` | `dock.mau.dev/mautrix/whatsapp` | 512m | matrix-internal | no |
| `mautrix-telegram` | `dock.mau.dev/mautrix/telegram` | 512m | matrix-internal | no |
| `mautrix-signal` | `dock.mau.dev/mautrix/signal` | 512m | matrix-internal | no |
| `mautrix-meta` | `dock.mau.dev/mautrix/meta` | 512m | matrix-internal | no |
| `mautrix-slack` | `dock.mau.dev/mautrix/slack` | 384m | matrix-internal | no |
| `synapse-admin` | `awesometechnologies/synapse-admin` | 64m | matrix-internal | no (SSH tunnel) |

`operis-app` joins `matrix-internal` so it can reach `synapse:8008` and each
bridge's `:8080/_matrix/provision` **without ever traversing the public internet**.

**`mem_limit` is mandatory on every container.** The host has no swap, which is
exactly why `translation` is already capped at 3 GB.

**Budget: ≈5.0 GB with all five bridges, ≈3.0 GB with Synapse + WhatsApp only.**
Phase 0 must verify headroom with `free -m` and `docker stats` before anything is
committed — 22 GB across 23 existing containers is not obviously spare.

### 6.2 Synapse configuration — security posture

```yaml
server_name: chat.operis.faheemkamel.com   # PERMANENT. Appears in every user ID forever.
public_baseurl: https://chat.operis.faheemkamel.com/

enable_registration: false
enable_registration_without_verification: false
registration_shared_secret: null           # provisioning is via the appservice only

federation_domain_whitelist: []            # federation OFF — closes the remote-media
                                           # disk-fill class (CVE fixed in 1.106) and a
                                           # large slice of the attack surface entirely
allow_public_rooms_over_federation: false
allow_profile_lookup_over_federation: false
limit_profile_requests_to_users_who_share_rooms: true

enable_room_list_search: false
room_list_publication_rules: [{action: deny}]

url_preview_enabled: false                 # SSRF vector; the ERP does its own previews
                                           # (chat already has chat_message_links)

max_upload_size: 50M
media_retention: {remote_media_lifetime: 14d}
retention: {enabled: true}                 # see §10 GDPR

rc_message: {per_second: 10, burst_count: 50}
# appservice senders are rate-limit-exempt via `rate_limited: false` in the registration
```

`server_name` is chosen as `chat.<operis domain>` and served directly at that
host, so **no `.well-known` delegation is needed**. With federation off, the
cleaner-ID argument for delegating from the apex is worth less than the extra
failure mode. This value can never be changed after the first user is created.

### 6.3 nginx

One more hand-installed template alongside `operis.conf.template`, same
`nginx -t`-before-reload discipline, same certbot volumes:

- `chat.operis.faheemkamel.com` → `http://synapse:8008`
- `client_max_body_size 50m` (must match `max_upload_size`)
- **`/_matrix/client/*` only.** Do **not** proxy `/_synapse/admin/*` — reach
  synapse-admin over an SSH tunnel.
- Do not open 8448.

---

## 7. Identity, tenancy and the trust boundary

**Matrix has no concept of tenancy. This is the single biggest security risk in
the plan and it is mitigated in exactly one place: the ERP.**

### 7.1 Namespaces

Appservice registration claims **exclusive** namespaces so no other actor can
mint an ERP identity:

```yaml
id: operis
as_token: <64 hex>          # ERP → Synapse
hs_token: <64 hex>          # Synapse → ERP (unused while url: null)
url: null                    # PULL model — see §5.2
sender_localpart: operis
rate_limited: false
namespaces:
  users:  [{exclusive: true, regex: "@om_.*:chat\\.operis\\.faheemkamel\\.com"}]
  aliases:[{exclusive: true, regex: "#om_.*:chat\\.operis\\.faheemkamel\\.com"}]
```

- ERP user `d3f1…` → `@om_u_d3f1…:chat…` (UUID hex, dashes stripped, lowercase —
  all valid localpart characters).
- Bridge ghosts keep their own namespaces (`@whatsapp_.*` etc.), owned by each
  bridge's own registration.

### 7.2 The tenancy rule

> **Never infer tenant or organization from anything Matrix tells you.**

Every inbound event is resolved through the ERP's **own** mapping:
`external_conversations.external_conversation_id = <room_id>` → `channel_id` →
`communication_channels.tenant_id / organization_id`. A `room_id` with no ERP
mapping row is **dropped and dead-lettered** (`lib/dead-letter.ts`), never
ingested and never used to create a channel.

This mirrors the posture already recorded for the query engine: isolation is
enforced centrally, and a foreign system is never a source of scope.

Room creation stamps `m.room.create` content with `operis.tenant_id` /
`operis.organization_id` for forensics — but that stamp is **evidence, not
authority**. The DB mapping is authority.

### 7.3 Multi-tenant escalation path

One homeserver + strict ERP mediation is correct for a small number of tenants.
If Operis ever hosts mutually distrusting tenants on shared infrastructure, the
answer is **one Synapse per tenant**, not cleverer room ACLs. Record that
threshold in the ADR rather than discovering it later.

---

## 8. Data model

### 8.1 Plane A — zero new tables

Everything reuses `communication_channels`:

| Existing column | Matrix value |
|---|---|
| `communication_channels.provider_key` | `matrix_whatsapp`, `matrix_telegram`, `matrix_signal`, `matrix_meta`, `matrix_slack`, `matrix` |
| `communication_channels.channel_type` | `whatsapp`, `telegram`, `signal`, `chat`, … |
| `communication_channels.external_identifier` | the bridged account (phone / handle) |
| `communication_channels.credentials_ref` | → `integration_credentials` (encrypted): homeserver URL, `as_token`, bridge provisioning secret |
| `communication_channels.channel_state` | `{ syncToken, botUserId, bridgeBotUserId }` |
| `external_conversations.external_conversation_id` | `room_id` |
| `external_messages.external_message_id` | `event_id` |
| `message_channel_links.channel_payload` | the raw Matrix event |
| `channel_thread_mappings` | `room_id` ↔ `messages.thread_id` |

**One adapter implementation, registered N times** under different
`providerKey`s with per-network `capabilities` (WhatsApp has no threads; Slack
does; Signal has no edits). The registry supports this —
`registerChannelAdapter` only rejects duplicate `providerKey`
(`lib/registry.ts:34-39`).

### 8.2 Plane B (Phase 6) — extension entities only, `chat` untouched

Per the cross-module rule ("add a separate extension entity and declare a link in
`data/extensions.ts`"), `channel_matrix` owns:

- `chat_conversation_matrix_rooms` — `chat_conversation_id` ↔ `room_id`, unique both ways
- `chat_message_matrix_events` — `chat_message_id` ↔ `event_id`, unique both ways (loop prevention)

`chat`'s own schema, commands, events and UI are **not modified**.

---

## 9. Message flow

### 9.1 Inbound (WhatsApp → Operis)

```
WhatsApp → mautrix-whatsapp → Synapse
  → [poll-tick :28] enqueues per-channel job
  → [poll-channel :52] adapter.fetchHistory({channelState.syncToken})
       ⇒ GET /_matrix/client/v3/sync?since=…&timeout=30000  (as_token)
  → adapter.normalizeInbound(event)
       ⇒ externalMessageId = event_id
         externalConversationId = room_id
         senderIdentifier = @whatsapp_447700900123:…  → +447700900123
  → [inbound-processor :31] commandBus 'communication_channels.message.ingest_inbound'
  → [ingest-inbound-message.ts:49]
       dedup (channel_id, event_id) → upsert ExternalConversation → matchThread
       → resolveContact → CRM person → messages.messages.compose
       → ExternalMessage + MessageChannelLink
  → events: conversation.created / contact.resolved / message.received
  → unified inbox, notifications, SSE
```

Every hop already exists. The adapter supplies `fetchHistory` +
`normalizeInbound` and nothing else changes.

### 9.2 Outbound (Operis → WhatsApp)

```
messages.message.sent
  → [outbound-bridge.ts:29] mapping by threadId, idempotency + ownership gates
  → [outbound-delivery.ts:34] 3 attempts, classified retry
  → [deliver-outbound-message.ts:76] adapter.convertOutbound → adapter.sendMessage
       ⇒ PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}
            ?user_id=@om_u_<erpUserId>:…        ← masquerade, so WhatsApp shows the right agent
            Authorization: Bearer <as_token>
         txnId = deterministic hash of the ERP message id  ← native idempotency
  → mautrix-whatsapp → WhatsApp
```

`txnId` derived from the ERP message UUID means a duplicate delivery attempt is
**silently deduplicated by Synapse**. That directly closes the gap flagged in
`deliver-outbound-message.ts:421-423` ("no provider idempotent-send key").

### 9.3 Media

Inbound: event carries an `mxc://` URI → adapter downloads via **authenticated
media** (`GET /_matrix/client/v1/media/download/{server}/{id}`, `as_token`) →
`NormalizedAttachment`.

Outbound: `POST /_matrix/media/v3/upload` → `mxc://` → send `m.image`/`m.file`.

**This requires §11.1 to be fixed first.**

---

## 10. Security requirements

Non-negotiable, in priority order:

1. **Tenancy is resolved from the ERP DB, never from Matrix.** Unmapped room ⇒
   drop + dead-letter. (§7.2)
2. **Federation disabled.** Removes the entire remote-federation attack surface
   and the remote-media disk-fill class. Re-enabling is a separate spec.
3. **`as_token` / `hs_token` / bridge provisioning secrets live in
   `integration_credentials`,** encrypted at rest by `TenantDataEncryptionService`
   (`integrations/encryption.ts`). They are **not** app env vars. Synapse's own
   copy is a mode-600 registration YAML on the VPS, backed up with the same care
   as `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`.
4. **Bridge provisioning APIs are never internet-reachable.** `/_matrix/provision`
   binds to `matrix-internal` only. The ERP proxies it through an authenticated
   route gated on `communication_channels.connect_user_channel`, rate-limited,
   with the shared secret injected server-side.
5. **WhatsApp QR payloads are live session credentials.** Never log them, never
   persist them, never put them in an event payload. Deliver over the
   authenticated ERP channel with a short TTL, and treat the pairing route as a
   credential-issuing endpoint for rate-limiting and audit purposes.
6. **Exclusive namespaces** so nothing else can mint `@om_*`.
7. **Media is scanned on ingest** through the existing attachments pipeline
   (`attachments/lib/scanning/` ClamAV, `lib/imageSafety.ts`) — inbound WhatsApp
   media is attacker-controlled bytes from an unauthenticated party.
8. **`url_preview_enabled: false`** — Synapse-side SSRF vector.
9. **The bridge databases contain message content in cleartext.** They inherit the
   ERP's backup and disk-encryption posture, and `deploy/backup.sh` must be
   extended (§13).
10. **No E2EE in Phase 1–5, deliberately.** Rationale below.

### 10.1 Why encryption is OFF on ERP rooms — a recorded decision, not an oversight

- For the **external** plane it buys nearly nothing: WhatsApp's own E2EE is
  already terminated at the bridge, and the remaining hops (bridge → Synapse →
  ERP) are all on one host's private Docker network.
- For the **internal** plane it would *break shipped features*: `chat` does
  server-side search (`chat_messages.search_body`), per-viewer translation
  (`chat_message_translations`) and link extraction. E2EE makes all three
  impossible server-side.
- Compensating controls: disk encryption, DB-at-rest encryption for the sensitive
  columns, no federation, strict ACL, audited access.

If a future requirement demands E2EE, it is a first-class spec with its own key
management story — not a config flip.

---

## 11. Two real gaps in core this uncovers

Both are pre-existing, both block WhatsApp, and both are worth fixing on their
own merits.

### 11.1 Inbound attachments are silently dropped

`lib/email-mime.ts:336-360` normalizes attachments into
`NormalizedInboundMessage.attachments`, and `data/validators.ts:56,123` accepts
them — but `commands/ingest-inbound-message.ts` **never reads `m.attachments`**.
Grep the file: zero hits. The compose call (`:349-383`) passes no attachment ids,
and `channel_payload` (`:459`) has no `attachments` key.

So today, every inbound email attachment is discarded. For WhatsApp — where media
*is* the message — this is fatal.

**Fix (Phase 2):** persist `NormalizedAttachment[]` through the `attachments`
module inside the ingest transaction, following the pattern already proven in
`chat/lib/attachments.ts:90-140` (`linkDraftAttachmentsToMessage`) and
`messages/lib/attachments.ts:18-40`. This benefits Gmail and IMAP immediately.

### 11.2 A notification type nothing produces

`communication_channels.message.received` is declared (`notifications.ts:5`) with
a client renderer and a reactive handler (`notifications.handlers.ts:69-70`) — but
**no server-side subscriber ever creates it**. Inbound channel messages currently
notify only via the generic `messages.new` path.

**Fix (Phase 2):** add the missing subscriber, feature-gated, respecting
assignment (`external_conversations.assigned_user_id`).

---

## 12. Phases

Each phase is independently shippable and independently revertible.

### Phase 0 — Spike + ADR *(no production change)*
- `free -m`, `docker stats` → confirm ≥6 GB genuine headroom.
- Stand up Synapse + `mautrix-whatsapp` on the VPS, internal network only.
- Pair a **burner** WhatsApp number. Leave it 7 days. Confirm it survives.
- Write `ADR-0006-matrix-agpl-boundary.md`.
- **Gate:** if the number is banned or RAM is tight, Track B (§3) becomes primary and Phase 3 is rewritten.

### Phase 1 — `packages/channel-matrix`, native Matrix only
Copy `packages/channel-fcm` (22 files, smallest complete provider). Deliver
`integration.ts`, `di.ts`, `setup.ts`, `acl.ts`, `lib/{adapter,matrix-client,credentials,health,normalize-inbound,convert-outbound,capabilities}.ts`,
connect widget, i18n, unit + integration tests.
Prove the full loop against a plain Matrix room. **No bridges.**
- *Not breaking anything:* new package, new `modules.ts` entry, zero core edits.

### Phase 2 — Core gaps *(§11)*
Inbound attachment persistence + the missing notification subscriber.
Regression coverage for Gmail and IMAP, which both gain attachments.

### Phase 3 — WhatsApp via mautrix-whatsapp *(Track A)*
Bridge deployment; ERP-proxied provisioning route; **QR pairing UI inside
Operis** (megabridge `/_matrix/provision` v3 — legacy v1/v2 are deprecated and
being removed, so target v3 from day one); ghost→CRM contact resolution; relay
mode for a shared team number; media both directions.

### Phase 4 — Telegram, Signal, Instagram/Messenger, Slack, Discord, SMS
Config + one `providerKey` registration each. **No new code path.** This is where
the Matrix bet pays off.

### Phase 5 — `packages/channel-whatsapp-cloud` *(Track B)*
Official Meta Cloud API on the same `ChannelAdapter`. Template management,
24-hour-window handling, webhook signature verification. Runs *beside* Track A.

### Phase 6 — Internal `chat` ⟷ Matrix mirror *(opt-in, flag-gated)*
- **6a — outbound mirror only.** Subscriber on `chat.message.sent` (which
  deliberately carries no body — refetch, exactly as `outbound-bridge.ts:75-86`
  does) → mirror into a Matrix room. Staff read internal chat in Element mobile.
  **Read-only in Element. Zero inbound risk.**
- **6b — inbound.** Matrix → `chat.messages.send`, using `client_message_id =
  event_id` so the module's existing partial unique index
  (`chat_messages_client_id_uq`, `entities.ts:236-240`) provides idempotency for free.
  - ⚠️ **Open design question, resolve in the pre-implementation audit:**
    `chat.messages.send` takes the sender from the session
    (`commands/shared.ts:20 actingUserId`) and never from the payload — correctly.
    A mirror needs to act *on behalf of* a user. The recommended shape is a
    server-only `onBehalfOfUserId` that the HTTP route cannot set, but this must
    be designed against the command bus's actor model before any code is written.
    Do not weaken the existing rule.

### Phase 7 — Customer portal
Portal-facing conversations over the same rooms; `portalBroadcast: true`;
`requireCustomerAuth` / `requireCustomerFeatures` guards.

### Phase 8 — SSO *(optional)*
Matrix Authentication Service, Operis as upstream OIDC provider. Staff log into
Element with their Operis account. Only worth it once Phase 6 proves demand.

---

## 13. Operational impact

- **Backups.** `deploy/backup.sh` covers only the Operis DB. Synapse's Postgres
  and every bridge's DB hold message content and session state — a lost bridge DB
  means re-pairing every WhatsApp number. Extend the script and the systemd timer.
- **Disk.** Media accumulates. `media_retention` + a purge job, monitored.
- **Health.** Add Synapse and each bridge to the existing
  `/api/communication_channels/get/channels/[id]/health` surface via
  `integration.healthCheck.service`.
- **Logs.** Per-container `json-file` rotation, matching the existing 10m×5.
- **Upgrades.** Digest-pinned images; Synapse and bridges upgrade on their own
  cadence, independent of Operis deploys. Bridges occasionally require a Synapse
  minimum version — read release notes before bumping.

---

## 14. Risks

| # | Risk | Sev | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | WhatsApp bans the bridged number | **High** | Meta detects `whatsmeow`; number dies; customer conversations stop mid-thread | Burner number; Track B in Phase 5; documented as accepted risk | **Real and permanent under Track A** |
| R2 | Cross-tenant leak via a Matrix room | **Critical** | A room maps to the wrong channel; messages surface in the wrong tenant's inbox | §7.2 — tenancy from ERP DB only; unmapped rooms dead-lettered; integration test asserting rejection | Low |
| R3 | VPS RAM exhaustion (no swap) | High | OOM killer takes a container; Operis or another product on the box goes down | `mem_limit` everywhere; Phase 0 measurement gate | Medium — 22 GB across 23 containers is not obviously spare |
| R4 | Phase 6b regresses `chat` | High | The mirror weakens `actingUserId`; sender spoofing becomes possible | Phase 6a is outbound-only; 6b blocked on a design review of the actor model | Low if sequenced |
| R5 | AGPL obligation triggered | Medium | Someone patches Synapse or a bridge to fix a bug; obligation attaches unnoticed | ADR-0006; unmodified pinned images; forks must be published | Low |
| R6 | Inbound media is attacker-controlled | High | Malicious file from an unauthenticated WhatsApp sender reaches staff | Existing ClamAV + `imageSafety.ts` path; `max_upload_size` | Low |
| R7 | Bridge DB loss | Medium | Every network needs re-pairing; history gaps | §13 backups | Low once fixed |
| R8 | Provisioning API exposed | **Critical** | Anyone reaching `/_matrix/provision` can pair or hijack accounts | Internal network only; ERP-proxied and ACL-gated | Low |
| R9 | Matrix latency under long-poll | Low | Perceived slowness vs. push | Pull is sub-second; push swap available (§5.2) | Low |
| R10 | `server_name` chosen wrongly | Medium | Baked into every user ID forever; changing it means rebuilding the server | Decided in §6.2 before Phase 0 | Low |

---

## 15. Testing

Per `.ai/qa/AGENTS.md`, integration coverage ships in the same change as each phase.

- **Unit** — `normalizeInbound` / `convertOutbound` against recorded Matrix event
  fixtures per network; `txnId` determinism; ghost-localpart → phone parsing.
- **Contract** — the adapter against a stubbed Matrix HTTP server. No live
  homeserver in CI.
- **Integration** — self-contained per the repo rule (create fixtures in setup,
  clean up in teardown, no reliance on seeded data): inbound→inbox, outbound→sent,
  dedupe on replayed `event_id`, **unmapped-room rejection (R2)**, dead-lettering.
- **Manual QA** — a `docker-compose.matrix.dev.yml` profile with Synapse + a
  bridge for local pairing.
- **Regression** — the full `chat` and `messages` suites must be green and
  unchanged through Phase 5; that is the "nothing broke" gate.

---

## 16. Rollback

- **Phase 1–5:** remove the `channel_matrix` entry from
  `apps/mercato/src/modules.ts`, run `yarn generate` +
  `yarn mercato configs cache structural --all-tenants`, redeploy. Routes, adapter
  and UI disappear. Rows remain inert. Existing channels are untouched.
- **Phase 6:** the mirror is flag-gated; disabling it leaves `chat` exactly as it
  is today, because `chat` was never modified.
- **Infrastructure:** `docker compose -p operis-matrix down`. Operis does not
  depend on it being up — every Matrix call must fail soft, marking the channel
  `disconnected` via the existing status machinery rather than throwing.

---

## 17. Open questions

1. **§3 — Track A, Track B, or both?** Drives Phase 3 vs Phase 5 priority.
2. **Is Phase 6 (internal chat on Matrix) actually wanted?** Its only real value
   is native Element/mobile access for staff. If nobody will install Element, it
   is pure risk and should be cut.
3. **How many tenants share this homeserver?** More than a handful ⇒ per-tenant
   Synapse (§7.3).
4. **Confirmed RAM headroom?** Blocks everything (R3).
5. Which networks beyond WhatsApp are actually needed in Phase 4?

---

## 18. Changelog

- **2026-09-09** — Initial draft. Research pass over `chat`, `messages`,
  `communication_channels`, the provider-package pattern, and the production
  deployment. No code changed.
