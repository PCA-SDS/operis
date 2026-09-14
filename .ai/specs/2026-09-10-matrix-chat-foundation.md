# Matrix as the Chat Foundation — Phase 1, internal messaging

Status: in progress — Phases 0–3 complete (2026-09-10). Phase 3 is implemented but has NOT had the 7-day shadow watch Phase 2 called for; see Risks. Phase 4 (mautrix bridges) next.
Phase: 6 of the chat module (1 direct messaging, 2 spaces + replies, 3 reactions/mentions/pins, 4 translation, 5 resource sharing)
Supersedes nothing. Related: [`2026-09-03-chat-direct-messaging.md`](2026-09-03-chat-direct-messaging.md), [`implemented/SPEC-056-2026-02-22-whatsapp-ai-chat-integration.md`](implemented/SPEC-056-2026-02-22-whatsapp-ai-chat-integration.md)

## TLDR

Put a **Matrix homeserver underneath the existing chat module** so that later
WhatsApp, Telegram and Instagram arrive as bridge deployments rather than as a
rewrite. Phase 1 covers organization-internal messaging only, at exactly today's
feature set.

The design in one sentence: **Matrix becomes the system of record for the message
stream; the `chat_*` tables stay exactly as they are and become a projection of
it.**

That is the whole trick. Every column, CHECK constraint, composite FK, GIN index,
translation cache row and attachment link survives untouched, so the 27 client API
functions, the 264 i18n keys and the entire UI keep working without a single
component edit. The new code is a transport seam plus four mapping tables, behind
a flag that is off by default and reverts with `DROP TABLE`.

**Three things the reader should know before deciding:**

1. **"Beeper's codebase" is not adoptable.** Beeper's server (hungryserv), its
   clients and its API are closed. What Beeper open-sourced is the **mautrix
   bridge family** and `mautrix-go`. `bbctl` — their self-hosting tool — refuses
   to talk to any homeserver but `beeper.com`. So "use Beeper" concretely means
   "run mautrix bridges against your own Synapse", and nothing else.
2. **Phase 1 ships no user-visible feature.** It is pure infrastructure. The
   payoff is Phase 4. This is stated plainly rather than buried, because it is
   the main reason to consider the cheaper alternative in
   [Scope note](#scope-note-a-cheaper-route-to-the-same-end-goal).
3. **A working Matrix adapter already existed in this repo** and was deleted. Its
   compiled output survived and the full TypeScript has been recovered — see
   [Prior art](#prior-art-the-deleted-channel_matrix-prototype). It is a
   `communication_channels` provider, not a chat backend, and it solves several
   problems this spec would otherwise have to rediscover.

## Problem Statement

Chat today is a self-contained Postgres application: ~30k lines across 9 entities,
27 client API functions, 14 commands, Postgres FTS search, a per-viewer
translation cache and an SSE fan-out. It is good, and it is entirely internal.
Every external network — WhatsApp first — would need its own protocol client,
its own session and media handling, its own reconnection logic and its own
conversation model.

Matrix is a way to buy all of that once. A Matrix room is a protocol-neutral
conversation; a mautrix bridge turns a WhatsApp thread into one. If Operis speaks
Matrix, then adding WhatsApp is deploying a container, not writing an integration.

The cost is that Matrix has to get underneath a module that is already load-bearing,
without breaking it.

## Scope note: a cheaper route to the same end goal

The stated goal is WhatsApp. There are two routes, and they are independent.

| | Track A — this spec | Track B — external only |
|---|---|---|
| What | Internal chat runs on Matrix | Internal chat untouched; Matrix used only for external networks |
| Where | `chat` module + new transport seam | `communication_channels` + `packages/channel-matrix` |
| Cost | Large. Touches the module's spine. | Moderate. The **adapter** is ~80% written (see Prior art); the gaps below are not. |
| WhatsApp appears in | The **Chat** UI | The **Messages** inbox — see below |
| Also gets you | Federation, native Matrix/mobile clients, one conversation model, E2EE option for private chats | Nothing else |

**The correction that matters**, established by reading the hub rather than
assuming: `communication_channels` composes into the **`messages`** module, never
into `chat_*`. The two are completely disjoint — a recursive grep of
`communication_channels/` for `chat` finds only prose in doc comments, and `chat/`
references the hub nowhere at all. So Track B surfaces a WhatsApp thread as a
`messages` thread rendered through the Messages inbox and its injection widgets.
**Getting those threads into the Chat UI is net-new work in either module; that
bridge does not exist.**

Four further gaps in the hub that a WhatsApp bridge would hit, none of them
adapter-shaped:

- **Attachments are dropped end to end.** Inbound files are normalised into
  `NormalizedAttachment[]` and then never read — `ingest-inbound-message.ts` never
  touches `message.attachments`, and there is no integration with the `attachments`
  module in either direction. Every existing provider ships `fileSharing: false`
  for exactly this reason. WhatsApp is a media-first network.
- **No participants model.** A WhatsApp group's membership has nowhere to live in
  the current schema.
- **Capability declarations are enforced at boot.** `validateAdapterCapabilities`
  makes `reactions: true` obligate `sendReaction` + `removeReaction`, and
  `conversationHistory: true` obligate `fetchHistory`. Declaring a capability you
  have not implemented fails the process, which is good, but it means WhatsApp
  reactions are all-or-nothing.
- **No delivery/read receipt ingest path.** `status_update` webhook events are
  acknowledged 202 and discarded; `getStatus` has no caller in the pipeline.

So the honest ranking is: **Track B is still the fastest route to seeing WhatsApp
messages inside Operis at all**, and it reuses a nearly-complete adapter. **Track A
is the route to WhatsApp inside the chat product**, and it is the coherent
long-term design precisely because a bridged conversation then lands in the chat
projection through the same path as an internal one.

The rest of this document specifies Track A as asked. Track B is sketched in
[Phase 4](#phase-4--external-networks-out-of-scope-here) and deserves its own spec.

## What is actually open source

Verified against `developers.beeper.com/open-source` and the npm registry,
2026-09-10.

| Component | License | Use here |
|---|---|---|
| `matrix-js-sdk` 42.3.0 | Apache-2.0 | ✅ safe dependency |
| `matrix-bot-sdk` 0.8.0 | MIT | ✅ safe dependency |
| `matrix-appservice-bridge` 12.0.0 | Apache-2.0 | ✅ safe dependency |
| `matrix-appservice` 4.1.0 | Apache-2.0 | ✅ safe dependency |
| **Synapse** (element-hq) | **AGPL-3.0** or commercial | ⚠️ run **unmodified**, separate process |
| **mautrix-whatsapp** | **AGPL-3.0** | ⚠️ run **unmodified**, separate process |
| `mautrix-go` | MPL-2.0 | not vendored; the bridges use it |
| Element Web | AGPL-3.0 / commercial | 🔧 engineering console **only**, never shipped |
| `matrix-react-sdk` | AGPL / GPL / commercial | ❌ never |
| Beeper hungryserv / clients / API | closed | ❌ not available |
| Dendrite | Apache-2.0 | ❌ maintenance mode — not a bet |
| Conduit / continuwuity / tuwunel | Apache-2.0 | 🅱️ fallback if AGPL is unacceptable |

**The licensing rule, and it is a hard one: no AGPL source ever enters this
repository.** Synapse and the mautrix bridges run as separate containers and are
spoken to only over the Matrix HTTP protocol, using the Apache-2.0/MIT client
libraries above. Under that arrangement Operis is a separate program communicating
at arm's length; the AGPL obligation attaches to Synapse and the bridges, and is
discharged by shipping them unmodified and pointing at upstream source.

Two consequences that follow from it:

- **Do not patch Synapse.** The moment a fork is deployed, its source must be
  offered to everyone who interacts with it over the network. Configuration is
  fine; a patch is not. Element sells AGPL exceptions if one is ever genuinely
  needed.
- **Get this in front of counsel before Phase 4 ships**, not after. It is a legal
  question with an engineering answer, and the engineering answer only holds if
  the constraint above is actually kept.

If AGPL is judged unacceptable at any point, the escape hatch is
**continuwuity/tuwunel** (Apache-2.0, Rust, Conduit lineage). They support
appservices — mautrix documents `register_appservice` for Conduit-family servers —
but are less battle-tested with the bridges than Synapse. Because everything in
this spec talks to the *Client-Server API* rather than to Synapse specifically,
that swap stays a deployment decision rather than a rewrite. Dendrite is not an
option: it has been in maintenance mode since 2023.

## Prior art: the deleted `channel_matrix` prototype

`packages/channel-matrix/` exists in the working tree but contains only
`dist/`, `.turbo/` and `tsconfig.tsbuildinfo`. It was **never tracked in git**,
never `.gitignore`d, and has no `package.json`. It was built at 16:55 on
2026-09-09 and its `src/` tree was emptied at 23:32 the same day — a deliberate
deletion, not a stray `clean`. **Ask whoever deleted it why before re-deriving
it**; there may be a reason this spec does not know about.

The compiled output carries full sourcemaps, so **all 15 files / 1542 lines of
original TypeScript have been recovered** and should be reviewed before any new
code is written. It is a `communication_channels` `ChannelAdapter`
(`providerKey: 'matrix'`), and it is good work. Five of its decisions should be
adopted wholesale:

1. **`channelScope: 'tenant'`.** An appservice connection is tenant
   infrastructure, never a per-user mailbox. This is what structurally prevents
   the connect flow from stamping a `user_id` on the channel and pulling somebody's
   private rooms into company scope.
2. **Deterministic transaction ids.** `transactionId = deriveTransactionId(omMessageId)`
   means a retried delivery makes Synapse return the *original* event rather than
   posting a second copy. Idempotency comes free from the protocol.
3. **Synapse refuses `/sync` for the appservice's own `sender_localpart`** —
   *"We no longer support AS users using /sync directly"*, matrix-doc#1144. A
   separate namespaced bot user (`om_bot`) is required. This trap costs a day to
   find and is already documented in the recovered `config.ts`.
4. **A narrowed sync filter.** Timeline-only, `m.room.message` only,
   `lazy_load_members: true`, `limit: 50`. Without it the first `/sync` against an
   established homeserver returns megabytes of room state to parse and discard.
5. **A hardened HTTP client.** Bearer token in the header (never a query
   parameter), SSRF guard on `homeserverUrl` with a private-host allowance for
   plain `http`, 16 MB bounded response reads, `redirect: 'manual'`,
   `retry_after_ms` parsing, and transient/permanent/reauth error classification.

Its identity scheme is also the right one and this spec adopts it unchanged:
`@om_u_<uuid-hex-32>:<serverName>`, with `assertMasqueradable()` refusing to act
as any user outside the registered namespace.

**Action before implementation starts:** restore the recovered sources into
`packages/channel-matrix/`, commit them so the work stops being lost, and review
them properly. The recovered tree is at
`scratchpad/channel-matrix-recovered/`. Note that its `lib/__tests__/` directory
was never compiled, so the tests are gone and must be rewritten.

## Proposed Solution

### The load-bearing decision: projection, not replacement

The naive reading of "replace chat's storage with Matrix" is: delete the tables,
query rooms live. That does not work here, and it is worth being precise about
why, because the reasons are the same ones that make the projection design safe.

Six things in the current module are anchored to `chat_messages` rows:

| Anchored on | Breaks if messages leave Postgres |
|---|---|
| Postgres FTS search | `search_body` + GIN `to_tsvector` index + `pg_trgm` scoring. Matrix's `/search` is far weaker and cannot express the scoring in `messageSearch.ts`. |
| Translation cache | Four-column FK `(message_id, conversation_id, tenant_id, organization_id)` → `chat_messages`. |
| Attachments | `attachments.entity_id = 'chat:chat_message'`, `record_id = messageId`. Both the transcript and the Shared panel join on it. |
| Reactions / mentions / pins / links | Composite FK `(message_id, conversation_id)` → `chat_messages(id, conversation_id)`, each `ON DELETE CASCADE`. |
| Unread model | One SQL predicate over `chat_participants.last_read_at` vs `chat_messages.created_at`. |
| Reply integrity | `chat_messages_reply_fk` — a composite FK that makes "a reply cannot target another conversation's message" a *database* fact, per the module's AGENTS.md. |

Rewriting all six is a multi-quarter project with a large blast radius. Keeping
them is free. So:

```
                    WRITE                                  READ
                      │                                     │
   POST /api/chat/.../messages                  GET /api/chat/.../messages
                      │                                     │
              chat.messages.send                       chatService
                      │                                     │
              ChatTransport                          chat_* tables
                 ├── local  ──────────────────────────────▲ (unchanged)
                 └── matrix                               │
                       │                                  │
                 PUT /rooms/{id}/send  ──► event_id ──► projection
                       │                                  ▲
                    SYNAPSE  (system of record)           │
                       │                                  │
                 appservice /sync or /transactions ───────┘
                       │
                 [Phase 4] mautrix-whatsapp ──► same room, same projection
```

Matrix owns ordering, durability, fan-out and — later — the bridges. Postgres
owns querying, search, business metadata and every guarantee the schema already
makes. A bridged WhatsApp message in Phase 4 lands in the projection through the
identical path, which is the entire point of doing this.

### Why the UI needs no changes at all

This falls out of two properties the module already has, both of them
deliberate:

- **Every SSE event payload is a pointer, never content.** `events.ts` is explicit:
  *"events are pointers and clients refetch over the authorized route"*. The UI
  reads only `payload.id` and `payload.payload.conversationId`, then invalidates a
  TanStack query and refetches over REST.
- **Reads go through `chatService` against the `chat_*` tables**, which the
  projection keeps populated.

So the realtime path needs one new thing and nothing else: when a Matrix event
lands, emit `chat.message.sent` with the correct `recipientUserIds`. That is a
call to the existing `emitConversationEvent`.

There is no `EventSource` in the chat module, no polling loop, no client-side
Matrix code, and **no browser ever talks to Synapse**. Operis stays the only
thing holding a Matrix credential, which is also what keeps tenant isolation in
Operis's existing authorization layer rather than in Matrix room ACLs.

### Send path in detail

The API contract requires `POST .../messages` to return a **complete
`ChatMessageDto`** synchronously (`{ message, deduplicated }`). So the send must
project inline; it cannot wait for the sync loop.

1. `chat.messages.send` runs every existing guard unchanged — org membership,
   participant row, reply-target scope, mention validation, `@everyone` only in
   spaces, departed-counterpart rule, attachment scan status.
2. Transport `matrix`: `PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}`
   as the impersonated sender, `txnId = deriveTransactionId(clientMessageId ?? generatedId)`.
3. On `{ event_id }`: insert the `chat_messages` row **and** the
   `chat_matrix_events` mapping row in one transaction, exactly as the `local`
   transport does today, including `search_body`, links, mentions and attachment
   linking.
4. `emitConversationEvent('chat.message.sent', …)` as today.
5. The sync loop later sees the same event, finds the mapping row, and skips it.
   This is standard bridge echo-handling.

Idempotency is now belt-and-braces: `chat_messages_client_id_uq` catches an
Operis-side retry, and the Matrix transaction id catches a Synapse-side one.

### Read path

Unchanged. `chatService` is not modified in Phase 1 through 3.

### What Phase 1 deliberately does *not* do

- No E2EE. Company-scope rooms are unencrypted so that server-side search,
  translation and AI keep working. Encrypted private-scope rooms are a Phase 5
  question and a genuinely different product decision.
- No federation. `federation_domain_whitelist: []`, port 8448 unexposed.
- No Matrix-native read receipts, typing or presence. `chat_participants.last_read_at`
  stays the unread model. Mirroring to Matrix receipts is Phase 5, needed only when
  a non-Operis client exists to read them.
- No per-tenant homeserver. One homeserver, one appservice, namespaced users, and
  tenant isolation enforced where it already is — in Operis.

## Architecture

### New package: `@open-mercato/matrix`

A transport-level Matrix client with **no chat knowledge**, so that
`channel-matrix` (Track B) and the chat transport (Track A) share one hardened
client rather than two. Seed it from the recovered `lib/matrix-client.ts`,
`identity.ts`, `config.ts` and `errors.ts`.

```
packages/matrix/src/
  client.ts        # CS API client: appservice bearer auth, ?user_id= masquerade,
                   # SSRF guard, bounded reads, manual redirects, retry-after,
                   # transient/permanent/reauth classification
  identity.ts      # mxid ⇄ Operis user id; assertMasqueradable()
  appservice.ts    # registration.yaml generation; txn verification via hs_token
  sync.ts          # /sync cursor loop with the narrowed filter
  events.ts        # m.room.message / m.reaction / m.replace / redaction typing
  errors.ts
```

Dependencies: `matrix-js-sdk` (Apache-2.0) *or* hand-rolled `fetch` as the
prototype did. **Recommendation: hand-rolled, following the prototype.** The
server side needs perhaps fifteen endpoints; `matrix-js-sdk` brings a sync
accumulator, a crypto stack and an IndexedDB store that a server-side proxy has
no use for. Revisit only if E2EE arrives, where the SDK's rust-crypto binding
becomes genuinely valuable.

### New module: `chat_matrix`

`packages/core/src/modules/chat_matrix/` — the seam, and the only place that
knows about both worlds.

```
chat_matrix/
  data/entities.ts       # the four mapping tables below
  lib/rooms.ts           # ensure a room exists for a conversation
  lib/identities.ts      # ensure an mxid exists for a user
  lib/project.ts         # Matrix event → chat_* rows (idempotent)
  lib/transport.ts       # the ChatTransport implementation
  subscribers/sync.ts    # queue worker draining /sync (or the txn queue)
  api/appservice/transactions/[txnId]/route.ts   # push mode, Phase 3+
  migrations/
```

Kept out of `chat` on purpose: the chat module stays free of Matrix imports, the
whole thing is deletable, and `yarn generate` treats it as an ordinary module.

### The transport seam

One interface, in `chat`, with the existing behaviour as the default
implementation. The chat module's AGENTS.md rule — *"Never add a second send
path"* — is respected: `chat.messages.send` remains the only send command. It
gains a delegate, not a sibling.

```ts
// packages/core/src/modules/chat/lib/transport.ts
export interface ChatTransport {
  readonly id: 'local' | 'matrix'
  ensureConversation(ctx: ChatWriteContext, conversationId: string): Promise<void>
  publishMessage(ctx: ChatWriteContext, input: PublishMessageInput): Promise<PublishedMessage>
  publishReaction(ctx: ChatWriteContext, input: PublishReactionInput): Promise<void>
  publishRedaction(ctx: ChatWriteContext, input: PublishRedactionInput): Promise<void>
  publishMembership(ctx: ChatWriteContext, input: PublishMembershipInput): Promise<void>
}
```

`PublishedMessage` carries `{ externalId: string | null }` — `null` for `local`.
Registered in `di.ts` alongside `chatService`, selected by
`OM_CHAT_TRANSPORT` (`local` | `matrix`, default `local`) with a per-tenant
override so rollout is one tenant at a time.

### Deployment

Two new containers in `docker-compose.fullapp.dev.yml`, beside the existing
`postgres` / `redis` / `keycloak` / `meilisearch` / `localstack`:

- `synapse` — unmodified upstream image, own Postgres database, appservice
  registration mounted read-only.
- `element` — dev profile only. The engineering console. Never deployed.

Synapse hardening, all configuration and no patches:

```yaml
enable_registration: false          # appservice creates every user
federation_domain_whitelist: []     # federate with nobody
presence: {enabled: false}
user_directory: {enabled: false}    # no cross-tenant user discovery
allow_public_rooms_over_federation: false
limit_profile_requests_to_users_who_share_rooms: true
room_list_publication_rules: [{action: deny}]
app_service_config_files: [/data/operis-registration.yaml]
```

Appservice registration:

```yaml
id: operis-chat
url: null                    # Phase 1-2: pull-only. See Push vs pull below.
as_token: <64 hex>           # secret; Operis → Synapse
hs_token: <64 hex>           # secret; Synapse → Operis
sender_localpart: operis
namespaces:
  users:  [{exclusive: true, regex: '@om_.*'}]
  aliases: [{exclusive: true, regex: '#om_.*'}]
  rooms: []
rate_limited: false
```

Both tokens live in the existing integration-credentials store, encrypted at rest.

### Push vs pull

The recovered prototype chose **pull** (`url: null`, poll `/sync`). That is the
right Phase 1 choice and should be kept, because it means no inbound endpoint
exists to authenticate, rate-limit or defend, and the cost is only that inbound
latency equals the poll cadence — which nothing in Phase 1 depends on, since
every Phase 1 message is also sent by Operis and projected inline.

**Push becomes necessary at Phase 4**, when bridges originate messages Operis did
not send. When that switch happens, one constraint dominates:

> Synapse sends appservice transactions **in order** and blocks up to 60s per
> HTTP request; a slow endpoint stalls the queue for every event
> (element-hq/synapse#17621). Oversized transactions can 413 and be retried
> forever (matrix-org/synapse#6478).

So `PUT /_matrix/app/v1/transactions/{txnId}` must: verify `hs_token`, dedup on
`txnId` against `chat_matrix_txns`, enqueue to `@open-mercato/queue`, and return
`200` — all without touching the projection inline. Processing happens in the
worker, idempotently.

## Data Models

Four new tables, all in `chat_matrix`. **No existing `chat_*` table is altered.**
That is what makes "nothing else breaks" structural rather than aspirational, and
what makes rollback a `DROP TABLE`.

### `chat_matrix_identities`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | no | |
| `tenant_id` | uuid | no | |
| `user_id` | uuid | no | Operis user |
| `mxid` | text | no | `@om_u_<hex32>:<server>` |
| `registered_at` | timestamptz | no | |
| `created_at` / `updated_at` | timestamptz | no / yes | |

`chat_matrix_identities_user_uq` UNIQUE `(tenant_id, user_id)`;
`chat_matrix_identities_mxid_uq` UNIQUE `(mxid)`.

Deliberately **not** organization-scoped: one person is one Matrix identity across
the organizations they belong to. Organization isolation is a property of room
membership and of the Operis authorization layer, not of the identity.

### `chat_matrix_rooms`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | no | |
| `tenant_id` / `organization_id` | uuid | no | mirrors the conversation |
| `conversation_id` | uuid | no | → `chat_conversations.id` |
| `room_id` | text | no | `!abc:server` |
| `state` | text | no | `pending` \| `ready` \| `failed` |
| `last_error` | text | yes | |
| `created_at` / `updated_at` | timestamptz | no / yes | |

`chat_matrix_rooms_conversation_uq` UNIQUE `(conversation_id)`;
`chat_matrix_rooms_room_uq` UNIQUE `(room_id)`;
`chat_matrix_rooms_scope_idx` `(tenant_id, organization_id)`.

Both unique constraints matter: one conversation must never fan out into two
rooms, and one room must never project into two conversations.

### `chat_matrix_events`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | no | |
| `tenant_id` / `organization_id` | uuid | no | |
| `message_id` | uuid | yes | → `chat_messages.id`; null for a non-message event |
| `conversation_id` | uuid | no | |
| `room_id` | text | no | |
| `event_id` | text | no | `$…` |
| `event_type` | text | no | `m.room.message` \| `m.reaction` \| `m.room.redaction` … |
| `origin_server_ts` | timestamptz | no | |
| `projected_at` | timestamptz | yes | null ⇒ seen, not yet projected |
| `created_at` | timestamptz | no | |

`chat_matrix_events_event_uq` UNIQUE `(event_id)` — **the idempotency key for the
whole projection**;
`chat_matrix_events_message_uq` UNIQUE `(message_id) WHERE message_id IS NOT NULL`;
`chat_matrix_events_room_idx` `(room_id, origin_server_ts)`.

### `chat_matrix_txns`

| Column | Type | Null | Notes |
|---|---|---|---|
| `txn_id` | text PK | no | appservice transaction id |
| `received_at` | timestamptz | no | |
| `event_count` | int | no | |
| `processed_at` | timestamptz | yes | |

Phase 3+ only, for push mode. In pull mode the cursor is a single `syncToken`
row; reuse the prototype's base64-JSON `channelState` shape.

### Identity derivation

`localpartForUser(userId) = 'om_u_' + userId.toLowerCase().replace(/-/g,'')`,
giving `@om_u_<32 hex>:<serverName>`. Taken verbatim from the recovered
`identity.ts`, including `assertMasqueradable()`, which refuses to act as any user
outside the namespace. That function is a security control, not a convenience:
without it a bug in room resolution could make Operis act as an arbitrary
homeserver user.

Display names are set once at registration and refreshed on rename. Email is
**never** sent to Synapse — `User.email` is encrypted at rest in Operis, and
copying it into a second datastore would silently widen the GDPR surface.

### Room shape

| Operis | Matrix |
|---|---|
| `kind: 'direct'` | private room, `is_direct: true`, both members, `preset: trusted_private_chat` |
| `kind: 'space'` | private room, `preset: private_chat`, invite-only |
| `chat_participants.role: 'owner'` | power level 50 |
| `chat_participants.role: 'member'` | power level 0 |
| conversation soft-delete | members kicked, room left tombstoned |

Note the name collision: an Operis **space** is a group conversation and maps to a
plain Matrix room. Matrix's own `m.space` concept is not used, and should not be —
`chat_conversations_kind_shape_chk` already carries the shape guarantee.

`power_levels` are set at creation so that Operis's role model is enforced by the
homeserver too, which matters once bridges and native clients can also write.

## API Contracts

**No public API change. That is the requirement, and it is testable.**

All 27 client functions in `components/api.ts`, every response DTO, every field
name and every error body stay byte-identical. The contract test in
[Verification](#verification) asserts this rather than assuming it.

Two internal, non-public endpoints are added:

### `PUT /api/chat_matrix/appservice/transactions/[txnId]` (Phase 3+)

Called by Synapse only. Auth: `Authorization: Bearer <hs_token>`, compared in
constant time. Body: `{ events: MatrixEvent[], ephemeral?: … }`.
Returns `200 {}` immediately after enqueueing. Never returns 4xx for a
well-formed transaction — a 4xx makes Synapse retry the same payload forever.

### `GET /api/chat_matrix/health`

Admin-gated. Returns `{ homeserver: 'ok'|'unreachable', whoami, syncLag, drift }`.
Reuse the recovered `lib/health.ts`.

## Rollout

Six phases. Each is independently shippable and independently revertible, and the
first three change no behaviour whatsoever.

### Phase 0 — Prove it ✅ **DONE 2026-09-10**

Delivered as committed infrastructure rather than a throwaway spike, because the
config and the acceptance checks are worth keeping either way:

| Artifact | What it is |
|---|---|
| `docker-compose.yml` (profile `matrix`) | Synapse `v1.160.0`, its own Postgres, Element `v1.12.27`. Pinned; a bare `docker compose up` does not start them. |
| `docker/matrix/synapse/homeserver.yaml.template` | The reviewable half of the config — federation off, user directory off, presence off, registration off, room publication denied, URL previews off. |
| `docker/matrix/element/config.json` | The engineering console, branded so nobody mistakes it for the product. |
| `scripts/matrix-dev.mjs` | `matrix:up` / `down` / `reset` / `status`. Generates secrets and the signing key once, re-renders config every run. |
| `scripts/matrix-verify.mjs` | 23 acceptance checks. |
| `docs/architecture/adr/ADR-0006-matrix-chat-transport.md` | The decision record. |

`yarn matrix:verify` — **23/23 passing.** It covers identity and namespace
enforcement, room lifecycle with the Operis role model, send/reply/react/edit/
redact, timeline pagination, receipts, authenticated media round-trip, and sync.

**Three things Phase 0 established that the spec had assumed:**

1. **The appservice bot must own every room, at PL 100.** The room creator needs
   PL 100 during creation to write the room's own state events, so creating a
   room *as* an Operis owner and setting them to PL 50 fails outright with
   `user_level (50) < send_level (100)`. Rooms are therefore created by
   `@om_bot`, with owner 50 and member 0 underneath — which is also the better
   design, since a conversation should not be orphaned when its creator leaves.
   Now asserted, along with "a PL 0 member cannot kick".
2. **The `/sync` refusal is real**, exactly as the recovered prototype recorded.
   `@operis:operis.local` is refused; `@om_bot:operis.local` works. It has its
   own negative check so it can never regress into a day of debugging.
3. **Transaction-id idempotency works as designed.** Sending twice with
   `sha256(operisMessageId)` returns the *same* `event_id`. Retry safety comes
   free from the protocol; Operis's `chat_messages_client_id_uq` becomes the
   second line rather than the only one.

Two smaller findings, both fixed: a regex in the appservice registration must be
a **single-quoted** YAML scalar (`\.` is an invalid escape in a double-quoted
one, and Synapse refuses to start), and a fresh database needs a **180s**
healthcheck `start_period` — 60s failed only the very first `matrix:up` on a
clean volume and passed every time after, which is the worst kind of flake.

**Not done, deliberately:** nothing in `chat` references any of this. No
dependency was added to any package. Phase 0 is reversible with
`yarn matrix:reset` and deleting six files.

### Phase 1 — The seam ✅ **DONE 2026-09-10**

Written from scratch rather than from the recovered prototype, which stays as
untracked reference only.

| Artifact | What it is |
|---|---|
| `packages/matrix` (`@open-mercato/matrix`) | Transport-level Matrix client. 8 modules, 148 tests. Only runtime dependency is `zod`. |
| `packages/core/src/modules/chat_matrix/` | The four mapping tables, their migration, ACL, setup, module contract tests. |
| `chat/lib/transport.ts` | `ChatTransport` + the `local` implementation + `publishMessageSafely`. |
| `chat/di.ts`, `chat/commands/{shared,messages}.ts` | Registration and the single call site. |

**Gate: 1498 suites / 12,631 tests passing, typecheck 26/26, build 26/26, lint 0
errors, repo-wide guards 39/39.** The chat suite went from 552 tests to 578 —
26 added, none changed.

**`matrix-js-sdk` was not adopted.** The server side needs about fifteen
endpoints; the SDK brings a sync accumulator, a crypto stack and an IndexedDB
store that a server-side proxy has no use for. Revisit only if E2EE arrives,
where its rust-crypto binding becomes genuinely valuable.

**How the seam avoids putting Matrix inside `chat`:** `chat/di.ts` registers
`chatTransport` as `local`; `chat_matrix` is listed *after* `chat` in
`modules.ts`, so in Phase 2 it re-registers the same DI token with a
homeserver-backed implementation. The chat module never imports anything
Matrix-shaped.

Four decisions worth recording:

1. **`local` is a no-op, and that is the correct behaviour rather than a stub.**
   With no external messaging system there is nothing to publish to — the
   database write that already happened *is* the delivery. It is what makes
   "zero behaviour change" provable rather than argued.
2. **The publish happens after the commit and cannot fail the send.** A network
   call inside a database transaction holds locks for the duration of somebody
   else's outage; and by the time it runs the message is durable and the readers
   already notified, so throwing would fail a send that succeeded.
3. **The transport payload is flat primitives, never the entity.** Passing the
   ORM object would let a transport mutate chat state. Asserted in the tests.
4. **`chat_matrix` has no ACL feature that reads anything.** Chat access is
   membership, not privilege, and a module that could read conversations would
   be a route around the thing chat's ACL deliberately does not have.

Two smaller findings: `@types/node` had to be declared explicitly in
`packages/matrix/tsconfig.json`, because every sibling package picks it up
transitively through a dependency and this one has none; and the migration
generator omits `down()`, which every chat migration has, so it was written by
hand.

**Not done, deliberately:** `chat_matrix` does not yet re-register the token, so
the `matrix` transport is unreachable. Reactions, redactions and membership are
not on the interface — wiring methods with no implementation to test against
would be a lie about what the seam does.

### Phase 2 — Shadow ✅ **DONE 2026-09-10**

`chat_matrix` now re-registers the `chatTransport` token, and with
`OM_CHAT_TRANSPORT=matrix` every committed message is published to the
homeserver as well. **Postgres remains the source of truth; nothing reads from
Matrix.**

| Artifact | What it is |
|---|---|
| `lib/identities.ts` | Operis user → namespaced Matrix account, idempotent, race-safe |
| `lib/rooms.ts` | conversation → room, owned by the bot at PL 100, resumable when half-provisioned |
| `lib/transport.ts` | the shadow writer |
| `lib/drift.ts` | the exit criterion, measured from the database alone |
| `lib/backfill.ts` | resumable publish of everything Matrix is missing |
| `cli.ts` | `chat_matrix drift`, `chat_matrix backfill` |
| `workers/drift-check.ts` + `setup.ts` | the same check every 15 min, scheduled only when the transport is Matrix |
| `scripts/matrix-transport-check.ts` | `yarn matrix:verify:transport` — the real transport against the real homeserver |

**Gate: 1502 suites / 12,671 tests, typecheck 26/26, lint 0 errors, and 8/8
end-to-end checks against live Synapse.** Messages verified in the room by
reading the timeline back: two events, two distinct namespaced senders, a
working `m.in_reply_to` relation.

**The end-to-end check earned its keep immediately.** It found that a republish
made a redundant homeserver round trip and then leaned on
`chat_matrix_events_event_uq` to reject the second mapping row. Correct, but
wasteful on exactly the path the backfill walks in bulk. `publishMessage` now
short-circuits on an existing mapping and the constraint is left as the backstop
for a genuine concurrent publish. No fake-based test would have shown this — the
fakes do not enforce constraints, which is precisely why the composition needed
a real homeserver.

Four decisions worth recording:

1. **Drift is measured from the database, not the homeserver.** The failure
   being hunted is a publish that failed and was swallowed, and that leaves no
   `chat_matrix_events` row. Asking Postgres finds every instance cheaply and
   works when the homeserver is unreachable — which is when you most want to ask.
2. **Before versus after the room existed is the whole distinction.** A message
   written before its room was provisioned is backfill scope, not drift.
   Counting them together would make an untouched deployment look permanently
   broken and hide the one number worth watching.
3. **`drift` reports and `backfill` repairs, and they are separate commands.** A
   monitor that silently fixed what it measured would make the measurement
   meaningless.
4. **`OM_CHAT_TRANSPORT=matrix` with no homeserver configured refuses to boot.**
   Quietly running `local` instead looks identical from outside — messages send,
   readers read — while the homeserver receives nothing and the drift check
   reports a growing gap nobody can explain.

**Exit:** 7 days of zero drift on a real tenant. `yarn mercato chat_matrix drift`
exits non-zero when unhealthy, so a cron entry can page on it.

**Not published yet:** reactions, redactions, edits, membership changes,
attachments. Mention tokens go out verbatim — resolving them needs names the
transport does not carry, and that is solved in the phase where a bridge relays
the room outward.

### Phase 3 — Flip ✅ **DONE 2026-09-10**

Matrix can now be the source of truth. Selected by a second flag so the change is
one variable and rolling back is flipping it, not redeploying.

| `OM_CHAT_TRANSPORT` | `OM_CHAT_MATRIX_MODE` | Who owns the stream |
|---|---|---|
| `local` (default) | — | Postgres. No homeserver. |
| `matrix` | `shadow` (default) | Postgres. Publish after commit; failure logged. |
| `matrix` | `authoritative` | **Matrix.** Publish before commit; failure fails the send. |

| Artifact | What it is |
|---|---|
| `chat/lib/transport.ts` | `mode`, and `recordPublication` split out of `publishMessage` |
| `chat/commands/messages.ts` | the inversion, plus `externalOrigin` |
| `chat_matrix/lib/projection.ts` | Matrix event → `chat.messages.send` |
| `chat_matrix/workers/sync.ts` | the `/sync` reader |
| `chat_matrix_sync_state` | the cursor, with a migration |

**Gate: 1503 suites / 12,700 tests, typecheck 26/26, lint 0 errors, guards 39/39,
13/13 end-to-end against live Synapse, and — finally — the dual-transport
integration run this spec promised in Verification and had never actually done.**

```
TC-CHAT-001…008, local transport      25 passed (5.0m)
TC-CHAT-001…008, matrix authoritative 25 passed (5.1m)
```

Not a single spec changed. And the transport verifiably engaged rather than
silently falling back: the run took the homeserver from 7 rooms to **35**,
registered **56** `@om_u_*` identities, and left **108 `m.room.message` events**
carrying the tests' own bodies. Real internal conversations, on Matrix, with the
existing suite passing unmodified.

That run also caught the only serious regression of the whole exercise — see
below — which is precisely why it was worth doing rather than declaring victory
on unit tests.

**Four decisions that shaped it:**

1. **The projector replays through `chat.messages.send`; it does not write rows.**
   Writing `chat_messages` directly would be shorter and would silently skip
   mention validation, attachment linking, the search document, the link index and
   the conversation preview — every invariant the chat module enforces in exactly
   one place. `externalOrigin` marks the replay so the message is not published
   straight back to the homeserver it came from. There is still one send path.
2. **The mapping is written inside the send transaction.** Row and mapping commit
   together, so a crash between them cannot leave a message the projector fails to
   recognise as already handled — which would re-project a duplicate, forever.
   This is why `recordPublication` had to be split out of `publishMessage`: in
   authoritative mode the publish happens before the row exists.
3. **The sync cursor advances only after the whole batch is projected.** An
   exception leaves it where it was and the next tick re-reads the same events,
   which is safe precisely because projection is idempotent on `event_id`.
   Advancing first would drop a batch permanently — the homeserver will not hand
   it over twice.
4. **The sync worker refuses to run unless the Matrix transport is bound.**
   Projection relies on the transport recording the mapping; if the token had
   resolved to `local` the mapping would never be written and the loop would
   re-project the same message every tick. That failure is quiet and catastrophic,
   so it is checked loudly.

**The regression the integration run caught, and nothing else would have.**
`yarn initialize` failed for the entire application with `column b.id does not
exist`. `ChatMatrixSyncState` and `ChatMatrixTransaction` had been given natural
primary keys (`stream`, `txn_id`) because the natural key *is* the identity —
but the query indexer aliases every table as `b` and selects `b.id`, so an entity
without an `id` column breaks initialization for every module, not just its own.
It surfaces from the reindex step long after the migration succeeded, so nothing
before the integration run had a chance to see it. Both tables now take a
surrogate `id` with the natural key as a `@Unique`, which is what the
deduplication actually needed. Recorded in `packages/core/AGENTS.md`.

**A membership gap, found by reading rather than testing.** `ensureRoom` returns
early for a room that is already `ready`, so it never revisits membership —
meaning somebody added to an Operis space *after* its room was built had no
Matrix membership, and in authoritative mode their first message would be refused
with `M_FORBIDDEN`. Reconciling the roster on every send would cost a round trip
per message to catch a once-per-person case; the publish path now repairs on the
refusal and retries exactly once, which costs nothing on the happy path and fixes
membership drift from any cause.

**Two things the end-to-end check taught us, neither findable with fakes:**

- **Synapse caches an initial `/sync`.** Polling with no cursor re-reads the same
  stale snapshot indefinitely. The real loop is unaffected — it syncs once and
  then advances a cursor — but the check had to learn to do the same.
- **`/sync` is eventually consistent** with `/send`: an accepted event reaches the
  stream a moment later.

**Not projected:** reactions, redactions, edits, membership. **Skipped by
design:** any sender that is not an Operis identity — the bot today, a bridged
WhatsApp contact tomorrow. That last one is Phase 4's actual work, and it needs
an external-participant model the chat schema does not have.

**Rollback:** set `OM_CHAT_MATRIX_MODE=shadow`. Nothing is rewritten; the
`chat_*` rows are the same rows either way.

### Phase 4 — External networks (out of scope here)

Deploy `mautrix-whatsapp` as its own container against the same Synapse. Switch
the appservice to push mode.

Because Phase 3 already projects every Matrix event into `chat_*`, a bridged room
becomes a chat conversation through the path that is by then well-tested. That is
the whole return on Phases 1–3, and it is why the four hub gaps listed in the
[Scope note](#scope-note-a-cheaper-route-to-the-same-end-goal) do not apply here:
chat already has an attachment pipeline with scanning, a participants table, a
reactions table and a read model.

Two things still have to be built:

- **Media**: bridged files arrive in the Matrix media repo. They must be copied
  into `attachments` on ingest so the existing scan gate stays meaningful — a file
  served straight from Synapse would bypass `scan_status`, which is the one thing
  chat's attachment design refuses to allow.
- **External participants**: a WhatsApp counterpart is not an Operis user and
  cannot have a `chat_participants` row as the table stands.

**Company-owned accounts only** to start — the ownership question for personal
accounts is a product decision, not a technical one, and needs its own spec
covering:

- `MessagingAccount.owner_type` (`USER` | `COMPANY`) versus conversation scope
  (`PRIVATE` | `COMPANY`) — these are orthogonal and conflating them is the main
  design error to avoid.
- Explicit **promote-to-company** as the only path by which a personal-account
  conversation becomes company data.
- Internal read-only sharing of a company conversation, which must never add the
  internal viewer to the external WhatsApp thread.

Note this needs a third `chat_conversations.kind` or an equivalent, and the chat
module's AGENTS.md says **ask first** — both existing kinds are load-bearing in
`chat_conversations_kind_shape_chk` and in the direct-pair partial unique index.

### Phase 5 — Native clients (optional, distant)

Per-user Matrix access tokens, Matrix-native read receipts and typing, E2EE for
private-scope rooms. Only worth doing if a non-Operis client actually exists.

## Verification

The whole plan rests on one claim — *the API contract does not change* — so that
claim gets a test rather than a promise.

**1. Dual-transport suite.** Both existing suites run twice, once per transport:

```bash
yarn workspace @open-mercato/core test -- src/modules/chat
OM_CHAT_TRANSPORT=matrix yarn workspace @open-mercato/core test -- src/modules/chat
JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral --no-reuse-env "modules/chat/__integration__"
OM_CHAT_TRANSPORT=matrix JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral --no-reuse-env "modules/chat/__integration__"
```

TC-CHAT-001 through 008 must pass unmodified on both. If a test needs changing to
pass on `matrix`, the transport is wrong — not the test.

**2. Contract-equivalence test (new, and the important one).** Drive the same
scripted scenario through both transports and assert the JSON responses are deeply
equal after normalising ids and timestamps. Cover every one of the 27 client
functions. This is what turns "nothing should break" into something CI can prove.

**3. A Synapse test container**, or a recorded-fixture fake for unit tests. Follow
the `OM_TRANSLATION_FAKE_PROVIDER` precedent in `chat/di.ts` — including its
refusal to boot in production, since a fake transport that silently drops messages
is a worse failure than a crash.

**4. Full gate** per `.ai/agentic.config.json` before each phase merges.

## Risks & Impact Review

| # | Risk | Failure scenario | Sev | Mitigation | Residual |
|---|---|---|---|---|---|
| 1 | **Cross-tenant leakage via Matrix** | A room is created with a member from another organization; Matrix has no tenant concept and would happily deliver it. | **Critical** | Room membership is only ever derived from `chat_participants`; `assertMasqueradable` bounds the namespace; user directory and room directory disabled; federation off; browsers never hold a Matrix token. TC-CHAT-002 runs on both transports. | Low |
| 2 | **Split brain** | Synapse accepts an event, projection insert fails; the message exists in Matrix and not in Operis. | **High** | Projection is idempotent on `event_id`; a reconciliation worker re-projects orphans; Phase 2 measures this for a week before anything depends on it. | Medium |
| 3 | **AGPL contamination** | Someone vendors mautrix or patches Synapse; source-disclosure obligations attach to the deployment. | **High** | No AGPL source in-repo, enforced by a CI dependency check; Synapse and bridges are unmodified upstream images; counsel signs off before Phase 4. | Low |
| 4 | **Appservice queue stall** (Phase 4) | A slow transaction handler blocks Synapse's ordered queue; all bridged messages stop. | **High** | Verify, dedup, enqueue, `200` — never process inline. Alarm on sync lag. | Low |
| 5 | **Timestamp/cursor skew** | Matrix `origin_server_ts` disagrees with `date_trunc('milliseconds', now())`; the keyset cursor in `lib/cursor.ts` mis-orders or skips a message. | **High** | Self-sent messages keep the DB clock. Bridged messages use `origin_server_ts` truncated to ms, with a monotonicity guard against the room's last projected ts. Explicit test for equal-timestamp ordering, which the `(created_at, id)` cursor already handles. | Medium |
| 6 | **Backfill blows up a real tenant** | Backfilling thousands of conversations swamps Synapse or the queue. | Medium | Resumable, rate-limited, per-tenant CLI; dry-run mode; run off-peak. | Low |
| 7 | **Operational surface doubles** | Synapse + its Postgres + bridges need backup, upgrade, monitoring, and Synapse upgrades are occasionally breaking. | Medium | Pin the image; stage upgrades; a Synapse restore drill before Phase 3. Accept honestly — this is a real, permanent cost. | **Accepted** |
| 8 | **Phase 1 delivers no user value** | Effort spent, nothing visible; the project stalls before Phase 4 and the cost is never repaid. | Medium | Stated up front; Track B named as the cheaper route to WhatsApp; each phase independently revertible. | **Accepted — a decision for the reader** |
| 9 | **PDU size limit** | A 4000-char body plus mentions, relations and attachment metadata approaches Matrix's 65536-byte PDU cap. | Low | 4000 chars leaves ample headroom; the prototype's 32768 limit is the guard. Reject at the edge with the existing validator. | Low |
| 9b | **The shadow watch was skipped** | Phase 3 was implemented and flipped on without the 7 days of measured zero drift Phase 2 called for, at the user's direction. The publish/commit ordering has therefore been proven correct in tests and end to end, but not under real traffic over time. | **High** | The flag is the mitigation: `OM_CHAT_MATRIX_MODE` defaults to `shadow`, so nothing changes until an operator opts in, and reverting is setting it back. Run the watch before enabling `authoritative` on anything that matters. | **Accepted — a decision the user made explicitly** |
| 9c | **Authoritative mode couples chat availability to the homeserver** | Synapse is down; every send fails with an error rather than degrading. In `shadow` this same outage is invisible to users. | **High** | Stated on every boot in the DI log line; documented in `.env.example` and both AGENTS.md files. Rollback is one variable. This is not a defect — it is the trade the mode exists to make, and it is the price of Matrix owning the stream. | **Accepted, by design** |
| 10 | **Media stored twice** | Matrix media repo and Operis `attachments` both hold the bytes. | Medium | Phase 1–3: attachments stay in Operis only; Matrix events carry a reference, not the file. Revisit at Phase 4, where bridged media arrives in the Matrix repo and must be copied into `attachments` to keep the scan gate meaningful. | Medium |

### Explicitly out of scope

E2EE; federation; per-user Matrix tokens; native Matrix clients; the `messages`
module; the `communication_channels` module (except as Track B); voice/video;
personal-account ownership rules.

## Final Compliance Report

| Rule | Status |
|---|---|
| No cross-tenant data exposure | Room membership derived only from `chat_participants`; federation, user directory and room directory disabled; browsers hold no Matrix credential. Risk #1. |
| No direct ORM relationships between modules | `chat_matrix` references `chat_conversations` / `chat_messages` by **FK id only**, no MikroORM relations. |
| No code directly under `apps/mercato/src/` | New code is in `packages/matrix` and `packages/core/src/modules/chat_matrix`. |
| Validate inputs with zod | Appservice transaction bodies and Matrix event shapes validated in `data/validators.ts`; credentials schema recovered from the prototype. |
| No `any` | Matrix event types declared in `packages/matrix/src/events.ts`, narrowed at the boundary. |
| Never bypass mutation guards | `chat.messages.send` keeps `runRouteMutationGuards`; the transport is invoked *inside* the command, not around it. |
| No second send path (chat AGENTS.md) | `chat.messages.send` remains the only send command; it gains a delegate. |
| No message body in event payloads (chat AGENTS.md) | Unchanged — payloads stay pointers. |
| Never drop `recipientUserIds` (chat AGENTS.md) | Projection emits via the existing `emitConversationEvent`, audience recomputed from live participant rows. |
| 404 not 403 for non-participants (chat AGENTS.md) | Read path unchanged. |
| Ask before a third `kind` (chat AGENTS.md) | Phase 4 flagged as needing that conversation. Phases 1–3 add no kind. |
| Ask before a new ACL feature (chat AGENTS.md) | No new chat feature. `chat_matrix` health endpoint reuses an existing admin feature. |
| Optimistic locking default ON | N/A — no new user-editable entity. Mapping tables are system-owned, and chat is already documented as append-only with server-owned toggles. |
| No hard-coded user-facing strings | Every new message is internal and `[internal]`-prefixed, per the recovered prototype. |
| Migrations reviewed, `yarn db:migrate` not run | Four `CREATE TABLE`s, no `ALTER` on any existing table. Snapshot updated by hand per the coding-agent exception. |
| Integration coverage in the same change | Dual-transport runs of TC-CHAT-001…008 plus the new contract-equivalence suite. |
| Backward compatibility | New event ids only if Phase 4 needs them; no existing ACL feature, event id, notification type or column renamed. |

## Open Questions

1. **Track A or Track B first?** If WhatsApp is the goal and internal chat on
   Matrix is not independently wanted, Track B is materially cheaper and mostly
   written. This is the decision the whole document turns on.
2. **Synapse (AGPL) or continuwuity/tuwunel (Apache-2.0)?** Synapse is the safe
   engineering choice; the licence is the only argument against it, and it is a
   real argument for a commercial ERP. Needs a legal answer, not an engineering one.
3. **One homeserver or one per tenant?** This spec assumes one, with namespaced
   users. Per-tenant homeservers give hard isolation at a large operational cost.
4. ~~Does `communication_channels` already model an external conversation well
   enough that Phase 4 should live there?~~ **Answered: partly.** It models the
   conversation and threading well, and composes into `messages`. It has no
   participants model, drops attachments entirely, and has no path into `chat_*`.
   So Phase 4 belongs in `chat` if the goal is a chat product, and in
   `communication_channels` if the goal is a shared inbox. That is a product
   question, and it is the one worth answering first.
5. **Who deleted the `channel_matrix` prototype, and why?** Recovering and
   committing it is cheap; re-deriving something that was deliberately abandoned
   is not.

## Changelog

| Date | Change |
|---|---|
| 2026-09-10 | Initial draft. Research: Beeper/mautrix open-source scope, Matrix appservice API, licensing of every component, Synapse appservice ordering constraints. Recovered the deleted `packages/channel-matrix` prototype (15 files, 1542 lines) from its dist sourcemaps and folded its decisions in. |
| 2026-09-10 | Corrected the Track B assessment after reading `communication_channels`: it composes into `messages`, never `chat_*`, drops attachments end to end, and has no participants model. Track B surfaces WhatsApp in the Messages inbox, not the Chat UI. |
| 2026-09-10 | **Phase 0 complete.** Synapse `v1.160.0` + Element `v1.12.27` under the `matrix` compose profile, config template, lifecycle script, 23-check acceptance script, ADR-0006. All 23 checks passing. Established that the appservice bot must own rooms at PL 100, confirmed the `/sync` sender refusal, and proved transaction-id idempotency. No chat code touched. |
| 2026-09-10 | **Phase 1 complete.** `@open-mercato/matrix` (transport client, 148 tests), the `chat_matrix` module with four mapping tables and its migration, and the `ChatTransport` seam in `chat` with `local` as the default. Gate green: 12,631 tests, typecheck 26/26, build 26/26, lint 0 errors. Chat suite grew by 26 tests and changed none. `matrix-js-sdk` not adopted — hand-rolled client instead. |
| 2026-09-10 | **Phase 2 complete.** Shadow writer live: identities, rooms, publish, drift check, backfill, CLI, scheduled worker, and an end-to-end check against real Synapse (8/8). Gate: 12,671 tests, typecheck 26/26, lint 0 errors. The end-to-end check found a redundant republish round trip, now short-circuited. |
| 2026-09-10 | **Phase 3 complete.** Matrix can be the source of truth behind `OM_CHAT_MATRIX_MODE=authoritative`: the send path inverts to publish-then-commit, the mapping is written inside the transaction, and a `/sync` worker projects inbound events back through `chat.messages.send`. Gate: 12,697 tests, guards 39/39, 13/13 end-to-end including the full round trip. The 7-day shadow watch was skipped at the user's direction. |
| 2026-09-10 | **Dual-transport integration run done — internal chat verified on Matrix.** TC-CHAT-001…008: 25/25 on `local`, 25/25 on `matrix`+`authoritative`, no spec changed; the run created 28 rooms, 56 identities and 108 messages on the homeserver. It caught a regression that broke `yarn initialize` for the whole app (entities with non-`id` primary keys vs the query indexer) and a membership-drift gap in the publish path. Both fixed. |
| 2026-09-10 | **Reactions mirrored to Matrix.** Adding sends an `m.annotation`, removing redacts it, re-reacting mirrors afresh; best-effort in both modes since reactions are Operis-owned either way. Keyed on `reaction:<message>:<user>:<emoji>` because the Operis row is deleted on un-react. The end-to-end check found that a tuple-derived transaction id makes re-reacting a permanent no-op — the homeserver returns the redacted event — so the reaction txn id is random and the database constraint is the idempotency guard. **Message edits were also asked for and do not exist:** Operis chat is append-only, with no edit or delete command, so there is nothing to mirror. Gate: 12,709 tests, 17/17 end-to-end. |
| 2026-09-10 | **End-to-end verification pass.** Added `TC-CHAT-009`, which drives the real HTTP API and then asserts on the **homeserver** — message, threaded reply, reaction annotation, redaction — 2/2 with the transport configured. Added `matrix:verify:drift`, which runs the drift and backfill SQL against a throwaway Postgres (16/16); that SQL had only ever been exercised against a fake connection. Closed a correctness hole found by reasoning: in authoritative mode a failed commit orphans a published event, and the projector would have resurrected it as a duplicate of the user's retry — every Operis message now carries `om.origin` and unmapped ones are refused. Gate: 12,712 tests, 23+17+16 live checks. |
| 2026-09-10 | **Ran it for real.** Migrations applied to a dev database, then the `/sync` worker, `drift` and `backfill` executed against real Postgres and real Synapse for the first time — every path that had only ever seen a fake. Three bugs surfaced that no test had: raw SQL bound with `$n` where MikroORM uses `?` (so `drift --tenant` and every backfill failed outright); the backfill could not publish history written by people who have since left a conversation, because rooms are provisioned from current participants; and the probe script itself was unfaithful, using `pg`'s dialect rather than the ORM's. The membership self-heal is now shared by both send paths. Backfilled 71 real messages across 4 conversations to `drifted=0 awaitingBackfill=0 conversationsWithoutRoom=0`. Gate: 12,715 tests, 23+17+16 live checks. |
