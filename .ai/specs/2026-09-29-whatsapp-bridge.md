# WhatsApp in Operis chat, through the mautrix bridge

> Status: **Approved — in implementation** (2026-09-29)
> Builds on: `2026-09-29-chat-external-participants.md` (the external-conversation model),
> `2026-09-10-matrix-chat-foundation.md`, `2026-09-13-chat-matrix-parity.md`, ADR-0006.
> Supersedes for WhatsApp: `SPEC-056` (official Business API inside `communication_channels`) and the
> draft `2026-09-09-matrix-communications-foundation.md` (Matrix as a `communication_channels`
> provider). Person-to-person messaging lives in `chat` (decided 2026-09-13).

## TLDR

A business connects its WhatsApp number to Operis by scanning a QR code (or typing a pairing code)
on a settings page. From then on every WhatsApp chat on that number lands in Operis chat as an
**external conversation**, handled by a team the admin picked, with colleagues replying from Operis
and the customer answered from the company's number. Colleagues can talk among themselves inside a
client chat without the client seeing it, share a chat read-only, hand it over, and link the client
to their CRM record. An employee may also connect their **personal** WhatsApp; only chats they
explicitly move to the company ever reach Operis.

The bridge is **mautrix-whatsapp v0.2609.0**, an unmodified AGPL program in its own container,
spoken to only over Matrix and its provisioning HTTP API. All business logic stays in Operis.

## Decisions (2026-09-29)

Direction comes from the leadership brief ("Define Beeper Infrastructure"): Beeper-style open
bridges under a closed product; company and personal accounts with explicit ownership; a shared
team inbox; internal discussion invisible to the client; read-only sharing; CRM context.

Approved by the user on 2026-09-29:

| Item | Answer |
|---|---|
| Bridge | mautrix-whatsapp, QR / pairing-code login (not Meta's official API) |
| Image | `dock.mau.dev/mautrix/whatsapp:v0.2609.0`, pinned |
| New ACL features (chat Ask First) | `chat.accounts.manage` (company accounts), `chat.accounts.connect_own` (personal) |
| New notifications (chat Ask First) | `chat.external.assigned` (added to a client chat), `chat.account.disconnected` |
| New production dependency | `uqr` (MIT, zero dependencies) — draws the QR code |
| Personal privacy | Chats not marked as work never enter Operis — not stored, not shown, not even pushed |
| Production Matrix | This work takes over the uncommitted `operis-matrix` rollout and finishes it |

Decided in this spec (no approval needed, recorded for review):

- **Customers see the company**, not the colleague: replies leave from the company number. A per-
  account toggle prefixes the colleague's first name (`Jules: …`), off by default.
- **Viewers may write internal notes** but never message the client.
- A connected account imports its **30 most recent chats** with **20 messages** each; older history
  stays on the phone. Both are environment settings.
- **Status broadcasts are not bridged** — they are not conversations.

## Verified against the running bridge

Probed on an isolated Synapse + bridge stack (2026-09-29), not taken from documentation:

- Provisioning: `/_matrix/provision/v3/...`, `Authorization: Bearer <shared secret>` plus
  `?user_id=<mxid>` acts as that user. A wrong secret is `401 M_UNKNOWN_TOKEN`; a user outside
  `bridge.permissions` is `403 "User does not have login permissions"`.
- Login flows: `qr` and `phone`. `POST login/start/qr` returns `display_and_wait` with
  `type: qr` and `data` — a `https://wa.me/settings/linked_devices#…` string (277 chars) and **no
  image**, so Operis draws it. `POST login/step/{login}/{step}/display_and_wait` blocks until the
  next code (the first lasts ~60 s, then 20 s each; six codes) or completion.
  `POST login/start/phone` returns `user_input` with one field, `phone_number`.
- `POST login/cancel/{login}` works; `GET logins` lists `login_ids`.
- Defaults that must change: `bridge.kick_matrix_users: true` would eject every Operis identity
  from portals; `matrix.federate_rooms: true`; `provisioning.allow_matrix_auth: true`;
  `network.history_sync.max_initial_conversations: -1` (every chat); `enable_status_broadcast: true`.
- A partial config works: the bridge merges defaults in memory, and `-n` keeps it from rewriting
  the file — so the committed template carries only our overrides.
- The registration carries `receive_ephemeral` / `de.sorunome.msc2409.push_ephemeral` (receipts).
- Since v0.2608 direct chats use WhatsApp LIDs, not phone numbers, in ghost ids.

Still unverified without a real phone: portal power levels, auto-join under double puppeting,
and echo of phone-sent messages. The design tolerates either outcome (see Architecture), and the
end-to-end check with a real phone closes them.

## Architecture

```
Browser ──HTTP──▶ Operis (chat, chat_matrix)
                     │  appservice (AS token, push transactions)
                     │  provisioning API (shared secret, internal network)
                     ▼
                 Synapse ◀──appservice──▶ mautrix-whatsapp ◀──▶ WhatsApp
```

### Identities

| Mxid | Who | Namespace |
|---|---|---|
| `@om_u_<hex32>` | a colleague's puppet | Operis appservice, exclusive |
| `@om_a_<hex32>` | a **company** WhatsApp account (hex = account uuid) | Operis appservice, exclusive |
| `@opp_<hex32>` | a **personal** WhatsApp account | double-puppet registration only |
| `@whatsapp_<id>` | a WhatsApp contact (ghost) | bridge, exclusive |
| `@whatsappbot` | the bridge bot | bridge, exclusive |

Each connected account is one Matrix user that **owns the bridge login**. Messages it sends in a
portal leave as the WhatsApp account itself — no relay mode, so reactions, edits and deletions all
work (relayed reactions are not bridged at all).

### Registrations

1. `registration.operis.yaml` — as today (`@om_.*`, exclusive). **Push mode is required** once a
   bridge runs: `url` = the app's base address.
2. `registration.whatsapp.yaml` — the bridge's (`@whatsappbot`, `@whatsapp_.*`), rendered from
   `.env` tokens rather than generated, so re-renders are reproducible.
3. `registration.doublepuppet.yaml` — `url: null`, **non-exclusive** namespace
   `@(om_a_|opp_)[0-9a-f]{32}:<server>` only. The bridge double-puppets account identities with
   it (phone-sent messages appear as the account, invites auto-accept); it can never act as a
   colleague. Operis also uses this token to act as a personal identity.

### Why personal chats never reach Operis

Synapse pushes an appservice every event in rooms where one of **its** users is joined. Company
identities (`om_a_`) are in the Operis namespace, so their portals are pushed. Personal identities
(`opp_`) are only in the double-puppet namespace, whose `url` is null — Synapse pushes their
portals to nobody. Operis reads a personal chat only when its owner opens the move-to-company
picker (names only, live, never stored) and, after a move, that one room — by inviting `om_bot`,
which brings the room into the Operis namespace.

### Module boundaries

- **`chat`** owns the business model: accounts, their teams and owners, conversation ↔ account,
  internal notes, access levels, CRM links, and a **connector seam** (`chatAccountConnector` DI
  token, like `chatTransport`) that knows nothing about Matrix. Its steps are generic:
  `qr { data } | code { code } | input { fields } | complete | failed { reason }`.
- **`chat_matrix`** implements the connector with the provisioning API, adopts portals, sends as
  account identities, attributes phone-sent messages, and watches login state. It still adds only
  its own tables.
- **`@open-mercato/matrix`** gains the provisioning client and the account identity classes —
  transport-level, network-agnostic (every mautrix bridgev2 bridge speaks the same API).

No new provider package: mautrix bridgev2 is one API for WhatsApp, Telegram, Signal and Meta, so a
second network is a container and an environment line, not code.

## Data Models

`chat` (one migration per phase that touches it):

- **`chat_messaging_accounts`** — `id`, `tenant_id`, `organization_id`, `network` (label, as on
  contacts), `owner_type` (`company` | `user`), `owner_user_id` (set iff `user`), `display_name`
  (encrypted), `remote_handle` (encrypted — the phone number), `status`
  (`pending` | `connecting` | `connected` | `disconnected` | `failed`), `status_reason`,
  `show_sender_name` (bool), `connected_at`, `connected_by_user_id`, `created_at`, `updated_at`,
  `deleted_at`. CHECK: `(owner_type = 'user') = (owner_user_id is not null)`.
- **`chat_messaging_account_members`** — `account_id`, `user_id` (+ scope): the team a company
  account seats in every new chat. Composite FK on `(account_id, tenant_id, organization_id)`.
- **`chat_conversations.messaging_account_id`** — nullable; set only on `external` rows adopted
  from an account. Composite FK with the scope pair.
- **`chat_messages.sender_account_id`** — nullable; a message sent from the company phone itself.
  `chat_messages_sender_chk` becomes exactly one of `sender_user_id`, `sender_external_contact_id`,
  `sender_account_id`.
- Phase 2: **`chat_messages.visibility`** (`shared` | `internal`, default `shared`).
- Phase 3: **`chat_participants.access`** (`viewer` | `participant` | `manager`, null outside
  `external`); `role` keeps its space meaning.
- Phase 4: **`chat_external_contacts`** link to a CRM person or company through
  `data/extensions.ts` (no cross-module FK).

`chat_matrix`:

- **`chat_matrix_account_logins`** — `account_id`, scope, `mxid`, `network`, `login_id` (the
  bridge's `user_login_id`), `pending_login` (json: flow, login process id, step id, last step,
  started/expires), `bridge_state`, `last_state_at`.
- **`chat_matrix_rooms.account_id`** — nullable; the account whose portal this room is.

## Behaviour

### Connecting a company account (Phase 1)

1. An admin with `chat.accounts.manage` opens **Chat → WhatsApp accounts**, names the account,
   picks the team (at least one active colleague) and presses **Connect**.
2. Operis creates the account (`pending`), registers its identity, and calls `login/start` as it.
   The page shows the QR (drawn with `uqr`) or asks for the phone number and shows the 8-character
   pairing code.
3. A queue job (`chat-matrix-account-login`) loops `display_and_wait`, persisting each new step
   under the attempt id it was started with; the page re-reads the account every two seconds while
   it connects, so codes rotate on screen. (Polling, not a DOM event: a login lasts two minutes at
   most, and a poll needs no audience computation for who may see an account.) On `complete` the account is `connected` with its
   remote profile (number, business name, encrypted). On timeout or error it is `failed` with a
   reason the page shows, and **Try again** starts over. The browser never holds a long request,
   and never sees a login process id: those stay server-side, bound to the account identity.
4. **Disconnect** logs the login out (`logout/{login}`); conversations stay, read-only in effect
   (nothing can be sent through a disconnected account).

### New chats

The bridge creates a portal and (double puppeting) joins the account identity. The push arrives;
the projector sees an unmapped room with a company account joined and **adopts** it in order,
before projecting anything else in the transaction:

1. Contacts: every configured ghost in the room (`chat.externalContacts.ensure`), named from the
   room member display name.
2. `chat.conversations.createExternal` with the account's active team (falling back to the admin
   who connected it; if nobody is active the account is flagged and managers are notified), the
   room name as title for groups, and `messaging_account_id`.
3. The `chat_matrix_rooms` mapping (`ready`, `account_id`). Best effort: invite `om_bot` so the
   `/sync` safety net covers the room too.
4. Members' read cursors start at adoption time, and messages older than adoption are projected
   **quietly** — no notifications — so importing 30 chats is not 600 alerts.

A failure throws, so the transaction job retries instead of skipping the room's first messages.

### Sending, reacting, editing, deleting

In an account-backed conversation the transport sends **as the account identity** (with the
optional name prefix), for text, files, reactions, edits and redactions. Conversations linked by
hand with `link-room` keep today's behaviour. WhatsApp keeps one reaction per sender, so two
colleagues' reactions become the company's latest — documented, not hidden.

### Messages from the company phone

Double puppeting shows them as the account identity. The projector attributes them to the account
(`sender_account_id`), rendered "Sent from the WhatsApp phone"; they notify nobody. Without double
puppeting (fallback), the account's own ghost is recognised from its remote profile and treated
the same way — never as a customer.

### Account health

`GET whoami` per account on the drift schedule, plus the bridge's state in `whoami.logins[].state`.
A logged-out account becomes `disconnected` and every manager gets `chat.account.disconnected` once
per transition.

### Handover and team inbox (Phase 1)

Colleagues in an external conversation can add or remove colleagues (only active organization
members); an added colleague gets `chat.external.assigned`. The list shows external conversations
under their account.

### Internal notes (Phase 2)

A composer switch, **Reply to {client} | Internal note**, writes `visibility: internal`. Internal
messages are **never published** to the transport (enforced in the send, edit, delete and react
commands, not the UI), render with a tinted, bordered, labelled bubble, may mention colleagues
(mentions are otherwise refused in external conversations), and notify mentioned colleagues as
`chat.mention.received`. A CHECK lets only a colleague's user message be internal, so nothing that
arrived from outside can be one. Notes stay writable while the account is disconnected (the
switch is pinned to notes then); receipts point at the newest shared message; the drift check
ignores notes; the phone can never edit or delete one.

### Access levels (Phase 3)

`viewer` reads everything and writes internal notes; `participant` also messages the client,
reacts, and edits or deletes what went out; `manager` also adds and removes colleagues and sets
their levels. The account team (and the colleagues an operator names in `link-room`) are
`manager` — they own the inbox and hand chats over; people added later default to `viewer`, and
the adder may choose. A chat keeps at least one manager and one colleague. Existing colleague
rows are backfilled as `manager` (what they could already do), and a NULL level reads as
`manager` too. Enforced in the send, edit, delete, react, typing, receipt and member commands; the
composer offers only internal notes to a viewer.

### CRM (Phase 4)

A contact's side panel offers **Link to CRM record** (person or company from `customers`), shown
with a link and respected by the CRM's own permissions. When the bridge reveals a phone number
(`phone_numbers_in_profile: true` for company accounts), a matching CRM person is suggested.

As built: the number comes from the ghost id (`@whatsapp_<digits>` → `+<digits>`; a hidden-number
`lid-…` ghost has none) and is stored encrypted as `chat_external_contacts.handle`. The link is
`customer_entity_id` on the contact (org-wide, no cross-module FK, declared in
`chat/data/extensions.ts`). Chat reads the CRM only through the `CustomerEntity` class `customers`
registers in DI (`lib/crm.ts`, `tryResolve`) — no CRM at all when it is absent. A linked record is
named and linked only for a viewer holding `customers.people.view` / `customers.companies.view`
for its kind; everyone else sees only that a link exists. Suggestions match the CRM's own
`primary_phone_hash` digest. Linking needs `participant` or better in the conversation and a
CRM view permission; a record from another organization, a hidden kind or nowhere is the same
404.

### Personal accounts (Phase 5)

An employee with `chat.accounts.connect_own` connects under **Profile → WhatsApp**, with a notice
of what stays private. Nothing is adopted. **Move a chat to the company** lists the employee's
chats live (names only) and, for the chosen one, invites `om_bot`, adopts it as an external
conversation owned by the employee (`manager`) and projects only messages from that moment on.
Replies in it leave as the employee's WhatsApp. Disconnecting stops everything; moved
conversations stay with the company.

As built: the page is `/backend/profile/whatsapp`. A personal account left unnamed takes its
owner's name, so colleagues read "via Ana Silva". Moving maps the room with
`chat_matrix_rooms.project_from` (the moment of the move) before the bot is invited, and the
projector drops any event older than it — the bot's first sync hands over recent history, which
stays the employee's. A move the bot cannot join is undone (mapping removed, conversation
closed). The disconnected notification for a personal account links to the profile page.

## API Contracts

All under `/api/chat/accounts` (features in brackets), scoped by the request's organization:

- `GET /` — accounts visible to the caller: company accounts [`chat.accounts.manage`] and the
  caller's own personal accounts [`chat.accounts.connect_own`].
- `POST /` `{ network, name, ownerType, memberUserIds }` — create.
- `PATCH /{id}` `{ name?, memberUserIds?, showSenderName? }` — update.
- `POST /{id}/connect` `{ flow: 'qr' | 'phone', phoneNumber? }` → the first step.
- `GET /{id}` → the account with its current login step (the page re-reads it on each event).
- `POST /{id}/connect/cancel`, `POST /{id}/disconnect`, `DELETE /{id}` (disconnect + soft delete).
- `GET /{id}/chats` (the caller's own personal account) → live chat names; `POST
  /{id}/chats/move` `{ chatId }` → `{ conversationId }` (idempotent).

Conversations: `POST /api/chat/conversations/{id}/members` (`access` for the people added) and
`DELETE .../members/{userId}` accept external conversations (`manager`s; anyone may leave); `PATCH
.../members/{userId}` sets `access`. Messages accept `visibility`. The member list carries each
outsider's `handle`, `customer` and `suggestion`, and `crm: { available, canLink }`; `GET
.../crm-search?q=` finds CRM records to link; `PUT .../contacts/{contactId}/customer`
`{ customerEntityId | null }` links or unlinks.

Operators: `yarn mercato chat_matrix accounts [--organization <id>]` runs the health check now.

## Security

- The provisioning secret, AS tokens and double-puppet token live in `.env` and rendered files
  (mode 600) only; none reaches a browser, log or event.
- The bridge and its provisioning port are on the internal network only; no host port in
  production, loopback-only in development.
- Login process ids are server-side state bound to the account identity; the browser only names
  an account it may manage, which the route resolves in the caller's organization.
- An account identity is derived from the account uuid, so one organization's account can never
  address another's identity.
- The double-puppet namespace excludes colleague identities by construction.
- Portals of company accounts are adopted only into the account's own organization; a room is
  never re-adopted (`chat_matrix_rooms` unique on room).
- Personal chats never reach Operis (see Architecture); a move is initiated only by the owner.
- Remote profile data (numbers, names) is encrypted at rest; ghost mxids are never logged above
  debug.

## Infrastructure

- **Development** (`yarn matrix:up`): a `mautrix-whatsapp` service in the `matrix` profile, its
  database in `matrix-postgres`, config and registrations rendered by `scripts/matrix-dev.mjs`,
  push mode on, `matrix.env` gains the provisioning URL and secret and
  `OM_MATRIX_BRIDGE_GHOSTS=whatsapp=whatsapp_`.
- **Production**: the same service in `deploy/docker-compose.prod.yml`, rendered by
  `deploy/matrix-render.sh`, backed up by `deploy/backup.sh`, runbook `deploy/MATRIX.md`.
- The template is `docker/matrix/mautrix-whatsapp/config.yaml.template` (overrides only); the
  bridge runs as the deploy user with `-n`.

## Implementation Plan

Each phase ships working and verified: unit tests, integration tests where the path is reachable
without a phone (a stub provisioning server and synthetic transactions), the CI gate, the Docker
image build, i18n in all eight chat locales.

- **Phase 0 — Matrix in production.** Carry the `operis-matrix` rollout; fix CI not shipping
  `matrix-render.sh` and the template; write `deploy/MATRIX.md`; make `COMPOSE_PROFILES` parsing
  agree; add `chat_matrix schedules` (idempotent) and run it from `deploy.sh` when the transport is
  Matrix, so a stack initialised on `local` still gets its `/sync` and drift schedules.
- **Phase 1 — Company accounts end to end.** Infrastructure, provisioning client, identities,
  accounts model/commands/API/UI, login job, adoption, sending as the account, phone-sent
  attribution, health, handover, both notifications.
- **Phase 2 — Internal notes.**
- **Phase 3 — Access levels and read-only sharing.**
- **Phase 4 — CRM link.**
- **Phase 5 — Personal accounts.**
- **Phase 6 — Real-phone verification** with a test number, in development, then production
  enablement per `deploy/MATRIX.md`.

## Integration Coverage

`TC-CHAT-013-whatsapp-accounts` (stub provisioning server on the matrix transport): create, connect
by QR (codes rotate, complete), connect by pairing code, cancel, failure, disconnect, permission
refusals, tenant isolation of accounts. `TC-CHAT-014-whatsapp-inbox` (synthetic transactions):
adoption of a new portal with the team seated, quiet import, sending as the account (asserted on
the homeserver), phone-sent attribution, handover notification. `TC-CHAT-015` internal notes (never
reach the homeserver), `TC-CHAT-016` access levels, `TC-CHAT-017` CRM link, `TC-CHAT-018` personal
accounts (nothing projected until a move). The real phone closes the rest in Phase 6.

## Risks & Impact Review

#### WhatsApp bans the number
- **Scenario:** WhatsApp flags an unofficial client and bans the company number.
- **Severity:** high. **Affected area:** the business's WhatsApp.
- **Mitigation:** stated to the admin on the connect page; recommend a dedicated number; no bulk
  or automated sending.
- **Residual risk:** accepted by the user (bridge chosen over the official API).

#### The phone goes quiet
- **Scenario:** WhatsApp unlinks companion devices after ~14 days without the phone online.
- **Severity:** medium. **Mitigation:** health checks mark the account `disconnected` and notify
  managers; reconnecting is one scan. **Residual risk:** messages during the gap wait on the phone.

#### A colleague's words reach the client by mistake
- **Scenario:** someone types an internal remark into a client chat.
- **Severity:** high. **Mitigation:** Phase 2 internal notes; the composer warning stays.
- **Residual risk:** a shared message is still a shared message.

#### Import floods the inbox
- **Scenario:** connecting a busy number creates hundreds of conversations and notifications.
- **Mitigation:** 30 chats / 20 messages by default; quiet import; cursors start at adoption.

#### Personal chats leak into company scope
- **Scenario:** a personal chat is pushed, stored or shown.
- **Severity:** critical. **Mitigation:** personal identities outside the Operis namespace;
  unmapped rooms never projected; the picker reads live and stores nothing; a test asserts no
  personal event reaches the transaction endpoint.

#### Bridge compromise
- **Scenario:** the bridge container is compromised.
- **Severity:** high. **Mitigation:** it can act only as its ghosts and account identities, never
  as a colleague; internal network only; unmodified pinned image.

## Final Compliance Report — 2026-09-29

- Ask First items approved: ACL features, notifications, `uqr`, image download, personal privacy
  model, production Matrix takeover.
- No cross-module ORM relations; FKs are within `chat`; `chat_matrix` adds only its own tables and
  two nullable columns on its own `chat_matrix_rooms`. The CRM link is an id plus an
  `EntityExtension`; `customers` is read only through DI and never imported.
- AGPL boundary: bridge unmodified, pinned, separate process, protocol-only.

## Changelog

| Date | Change |
|---|---|
| 2026-09-29 | Spec written from the leadership brief and a probe of the running bridge; decisions approved. |
| 2026-09-30 | Phase 0 and Phase 1 implemented. Additions found while building: the account actor (`ChatActor` `kind: 'account'`) for messages the company phone sends, edits or deletes; the `sender_account_id` read paths (transcript, search, pins, replies, shared panel); `chat.accounts.recordLoginStep`/`markState` keyed on an opaque attempt id so a late report from a replaced login is dropped; replies, edits, deletions and reactions refused (409) while an account is not connected; the encryption-map backfill for existing tenants (guarded for fresh databases); `chat_matrix accounts` CLI; the provisioning stub (`chat/__integration__/whatsappStub.ts`) for TC-CHAT-013/014. |
| 2026-09-30 | Phases 2–5 implemented. Internal notes; access levels with the last-manager and last-colleague rules checked under the conversation's row lock; CRM link (`handle`, `customer_entity_id`, `lib/crm.ts`, member-list enrichment, CRM search, TC-CHAT-017); personal accounts (profile page, live chat list, move with `project_from`, TC-CHAT-018). Fixes found on the way: the Operis bot was never registered on the homeserver (`ensureBotRegistered` wherever it acts); the local queue must have a single consumer, so the in-app consumers were removed in favour of the worker process; the accounts page now re-reads the list when a login ends; the provisioning stub acts only on a login Operis is already waiting on; the account team picker can include the admin creating it (`/api/chat/directory?includeSelf=true`). |
