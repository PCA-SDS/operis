# Chat Matrix Transport — Agent Guidelines

Maps Operis chat conversations onto Matrix rooms. Five mapping tables, no pages,
no UI, and exactly **one** API route — the homeserver's own. It exists so that
the `chat` module can keep every table, constraint and query it already has
while a homeserver carries the same messages alongside — and so that a WhatsApp
bridge, later, delivers into the same conversation without chat learning what
WhatsApp is.

Architecture: [`ADR-0006`](../../../../../docs/architecture/adr/ADR-0006-matrix-chat-transport.md).
Spec: [`.ai/specs/2026-09-10-matrix-chat-foundation.md`](../../../../../.ai/specs/2026-09-10-matrix-chat-foundation.md).

## The one rule everything else rests on

**This module adds tables. It never changes a `chat_*` table.**

That is what makes the whole plan safe: every CHECK constraint, composite
foreign key and GIN index the chat module depends on stays exactly as it is, and
rolling the transport back is dropping four tables nothing else reads.
`__tests__/moduleContract.test.ts` asserts it against the migration SQL, so it
cannot quietly stop being true.

## Always

- Keep Matrix out of `chat`. The seam is `chat/lib/transport.ts`; this module
  re-registers the `chatTransport` DI token, which works because `modules.ts`
  lists `chat_matrix` **after** `chat`.
- Reference chat rows by plain uuid. No ORM relation and no foreign key across
  the module boundary — a hard FK here would also let these tables block a
  chat-side delete.
- Treat `chat_matrix_events.event_id` as the projection's idempotency key. The
  send path writes a row inline; the sync loop finds it and skips. Bypass it and
  a redelivered transaction duplicates history permanently.
- Derive an mxid with `@open-mercato/matrix`'s `mxidForUser`, never by hand.

## Never

- Never grant a way into a conversation. Chat access is membership, not
  privilege — `chat_matrix.view` is transport health for operators, and adding a
  feature that reads message content would make this module a route around the
  thing chat's ACL deliberately does not have.
- Never let a transport failure fail a send. The message is already committed
  and the readers already notified; `publishMessageSafely` logs and moves on.
- Never publish inside the chat write transaction. A network call inside a
  database transaction holds locks for the duration of somebody else's outage.
- Never order the transcript by `origin_server_ts`. Operis timestamps come from
  the database clock (`chat/lib/clock.ts`) and the keyset cursor is built on
  them; two clocks deciding one sort order is how a message goes missing from a
  page. The homeserver timestamp is recorded for reconciliation only.

## Ask First

- Ask before adding a foreign key to `chat_conversations` or `chat_messages`.
- Ask before storing message bodies here. Matrix holds the stream and `chat`
  holds the projection; a third copy is a third thing to keep consistent.

## Validation Commands

```bash
yarn workspace @open-mercato/core test -- src/modules/chat_matrix
yarn workspace @open-mercato/core test -- src/modules/chat
yarn typecheck
```

Against a live homeserver — `yarn matrix:up` first:

```bash
yarn matrix:verify:all
```

Three verifiers, each proving something the others cannot:

| | Proves |
|---|---|
| `matrix:verify` | the homeserver accepts the operations at all (23 checks) |
| `matrix:verify:transport` | the real transport composed against real Synapse (17) |
| `matrix:verify:drift` | the drift and backfill **SQL**, against real Postgres (16) |

And through the real HTTP API, with the transport configured:

```bash
OM_CHAT_TRANSPORT=matrix OM_CHAT_MATRIX_MODE=authoritative \
  yarn test:integration:ephemeral --no-reuse-env "modules/chat/__integration__"
```

`TC-CHAT-009` asserts what reached the **homeserver**, not just what the API
returned — the two look identical from outside when a publish silently fails.
The rest of the suite must pass unchanged on both transports; if a spec needs
editing to pass on `matrix`, the transport is wrong, not the spec.

## Data Model

| Table | Carries |
|---|---|
| `chat_matrix_identities` | Operis user ⇄ mxid, and that registration already happened |
| `chat_matrix_rooms` | conversation ⇄ room, plus provisioning state |
| `chat_matrix_events` | Matrix event ⇄ Operis row — the idempotency ledger, and the reaction mapping |
| `chat_matrix_txns` | appservice transactions already applied (push mode) |
| `chat_matrix_sync_state` | where the `/sync` reader has got to |

Three constraints carry guarantees the application cannot promise alone:

- **`chat_matrix_rooms_conversation_uq`** — a conversation can never fan out
  into two rooms. Without it a retried provisioning attempt splits history with
  no way to tell which room is real.
- **`chat_matrix_rooms_room_uq`** — a room can never project into two
  conversations. Without it one message appears twice, under two different
  authorization scopes.
- **`chat_matrix_events_event_uq`** — the projection's idempotency key.
- **`chat_matrix_events_subject_uq`** — one mirrored event per reaction. A
  `chat_message_reactions` row is DELETED on un-react, so the mapping cannot be
  keyed on it; it is keyed on `reaction:<message>:<user>:<emoji>`, which is what
  makes the annotation findable again in order to redact it.

## Status

**Phase 3 — Matrix can be the source of truth.** Two flags:

| `OM_CHAT_TRANSPORT` | `OM_CHAT_MATRIX_MODE` | Who owns the stream |
|---|---|---|
| `local` (default) | — | Postgres. No homeserver involved. |
| `matrix` | `shadow` (default) | Postgres. Publish after commit, failure logged. |
| `matrix` | `authoritative` | **Matrix.** Publish before commit, failure fails the send. |

`authoritative` is a real behaviour change: **a homeserver outage stops people
sending.** That is the trade, and it buys the inbound direction — a message
Operis did not originate becomes an ordinary chat message, which is the path a
bridge will feed.

## How a message moves

**Outbound, authoritative.** Guards → publish to the homeserver → open the
transaction → create the message row **and** its `chat_matrix_events` mapping
together → commit → emit SSE. The mapping is written inside the transaction on
purpose: a crash between row and mapping would leave a message the projector
cannot recognise as already handled, and it would re-project a duplicate.

**Inbound.** `workers/sync.ts` reads `/sync` from the stored cursor and hands
each event to `lib/projection.ts`, which **replays it through
`chat.messages.send`** rather than writing rows. Anything already mapped is an
echo and is skipped — including every message Operis itself sent.

The cursor advances only after the whole batch is projected. An exception leaves
it where it was and the next tick re-reads the same events, which is safe exactly
because projection is idempotent on `event_id`.

## Push mode

`OM_MATRIX_APPSERVICE_URL` turns it on: the registration then carries that base
address and Synapse PUTs each transaction instead of leaving it to be found on
the next poll. Unset, there is no inbound endpoint for a homeserver to reach.

**The registration `url` is the appservice's BASE address, not the endpoint.**
A homeserver appends `/_matrix/app/v1/transactions/{txnId}` to whatever it is
given, so naming the transactions path there produces a PUT with the segment in
it twice and a 404 on every push — which is exactly what the first attempt did,
retried with backoff, and logged as `push_bulk … code=404`. The route therefore
lives at `api/appservice/_matrix/app/v1/transactions/[txnId]`, which is the spec
path hanging off `/api/chat_matrix/appservice`.

**The endpoint projects nothing.** It verifies the token, records the
transaction and returns 200. Synapse blocks on that response and holds every
later transaction behind it — up to 60s per request — so the work happens in
`workers/appservice-transaction.ts`, at concurrency 1 because transactions
arrive in order and a relation whose target is still in the previous job is a
relation that is lost.

**Push does not replace the poll.** A pushed transaction has no cursor: one lost
while Operis is down is retried by Synapse for a while and then gone, with
nothing left to rediscover it with. The `/sync` reader keeps its own cursor and
finds anything push missed, and because projection is idempotent on `event_id`
running both costs a parked long-poll. Push buys latency; the poll is what still
guarantees delivery.

**The `hs_token` is the entire security boundary**, because this is the module's
only unauthenticated surface. It is compared in constant time, before the body
is read, and a deployment with no token configured refuses everything rather
than comparing against an empty string. A bad token, an unconfigured deployment
and a transport that is not Matrix all return the same `403 M_FORBIDDEN`, so
nothing tells an unauthenticated caller which it was. A failure to RECORD the
transaction returns 500 on purpose — acknowledging what was not recorded loses
it permanently.

## Operating it

```bash
yarn mercato chat_matrix drift                    # exits non-zero when unhealthy
yarn mercato chat_matrix drift --tenant <uuid>
yarn mercato chat_matrix backfill --dry-run       # what would be published
yarn mercato chat_matrix backfill --limit 50      # publish what Matrix is missing
yarn mercato chat_matrix sync                     # drain the /sync stream now
```

**Raw SQL here binds with `?`, never `$n`.** `em.getConnection().execute()` goes
through Knex. A `$1` reaches Postgres as a literal it has no parameter for, and
only on the paths that actually bind something — so an unscoped `drift` looks
fine while `--tenant` fails with "there is no parameter $1". Both were written
that way and both were caught by running the CLI against a real database.

**Two things conspire to run `local` while every log says `matrix`, and both are
now guarded.** `di.ts` loads the Matrix half through `createRequire` so the
module stays inert when switched off — but a bundler resolves a RELATIVE
specifier against the bundled `di.js`, finds nothing, and hands back an empty
module instead of throwing. `createMatrixChatTransport` was then `undefined`,
`register` logged "chat transport bound to Matrix" anyway, and the TypeError
surfaced only when something resolved the token — where
`chat/commands/shared.ts` caught it and substituted the local transport. Every
send returned 200 and the homeserver received nothing. So: load the sibling by
PACKAGE specifier (the form the generated DI registry already uses), take the
first specifier that carries the export rather than the first that loads, and
never swallow a `chatTransport` resolution failure. And the app is started via
`turbo run start`, which is strict about env — `OM_CHAT_TRANSPORT` and every
`OM_MATRIX_*` must be listed in `turbo.json`'s `globalPassThroughEnv` or they
never reach the process that reads them.

Two schedules, both registered only when the transport is Matrix: the drift check
every 15 minutes per organization, and the `/sync` reader every 5 seconds at
**system** scope — one appservice, one stream, one cursor. A per-organization
sync would start N readers racing for it.

## What the projector does, and what it will not

Four things arrive: a plain message, an `m.reaction`, an `m.room.redaction` and
an `m.replace` edit. Each **replays through the command that owns the rule** —
`chat.messages.send`, `.toggleReaction`, `.delete`, `.edit` — never by writing
`chat_*` rows here. The actor is resolved from the event's `sender`, so Operis'
own permissions apply to a Matrix action: an edit by someone who is not the
author is refused, exactly as it would be over HTTP.

**A redaction is two different things wearing one event type.** Matrix has no
un-react — taking a reaction back is redacting the annotation — so what a
redaction means depends entirely on whether the mapping row for the redacted
event carries a `message_id` or a `subject_key`. That table is the only thing
that knows.

**An inbound reaction's mapping row is written BEFORE the command runs**, and
both halves of that ordering are load-bearing. It is what makes the outbound
mirror recognise the reaction as already represented and decline to send it
straight back — `publishReaction` returns early when a row exists for the
subject key, so no new suppression mechanism was needed. And it is what makes a
redelivery a no-op: a reaction replayed through a *toggle* is a reaction taken
away. If the command then refuses, the claim is given back.

**Edits and deletions carry `externalOrigin` instead**, matching a send.
`publishEdit` records no mapping of its own — the mapping belongs to the message,
not to each revision — so an Operis edit echoed back cannot be caught by the
`already-known` gate and is caught by `om.origin` instead.

It still skips, never throws, on: an event it already knows, a non-message, a
redacted message, a room Operis never created, an empty body, a relation whose
target has no mapping (`unmapped-target`), a command refusal (`not-permitted`)
and **a sender that is not an Operis identity**. That last one is the bot today
and a bridged WhatsApp contact tomorrow; attributing someone else's words to an
employee would be worse than not showing them, and doing it properly needs an
external-participant model the chat schema does not have.

One refused event must never stall the stream: the cursor would stop advancing
and everything behind it would be stuck too, over a permission decision that
will never change. So a refusal is logged and skipped, not rethrown.

## Reactions

Mirrored outward, best-effort, in **both** modes — unlike a message. Reactions
live in `chat_message_reactions` whichever system owns the message stream, so
pushing them out is for the benefit of anything else reading the room and is
never something a user's action depends on. `publishReactionSafely` logs and
moves on.

Adding sends an `m.annotation`; removing redacts the event the addition
produced. Re-reacting after a removal mirrors afresh.

**The reaction transaction id is random, and that is deliberate.** Deriving it
from the reaction tuple looks right and is wrong: the tuple does not change when
a reaction is taken back and re-applied, so the second `m.reaction` would carry
the first one's transaction id and the homeserver would hand back the
**redacted** event — making re-reacting a permanent no-op. Found end to end
against a real homeserver. Idempotency lives in `chat_matrix_events_subject_uq`
instead, which is stronger anyway because it survives a restart.

## Our own orphans

In authoritative mode the publish precedes the transaction, so a commit that
fails leaves an event in the room with no mapping. Every message Operis sends
therefore carries `om.origin: 'operis'` in its content, and the projector
**refuses to resurrect** an unmapped event carrying it.

Without that the projector would faithfully turn the orphan into a chat message
— alongside the one the user's retry already succeeded in sending. A duplicate
is worse than a gap, and the gap is what the user already saw and acted on.

The trade is that Matrix keeps an event Operis does not. Nothing else reads
those rooms for internal chat; when something does, the honest repair is to
redact the orphan rather than project it.

## Edits and deletions

Mirrored outward, best-effort, in **both** modes — like reactions, and unlike a
message. The asymmetry is about which system can lose something: a send that
Matrix refuses in authoritative mode must not commit, because a row would then
exist for a message the stream has never carried. An edit has no such hole — the
body lives in `chat_messages` whichever system owns the stream, and nothing
inbound turns a Matrix edit back into an Operis one — so a failed mirror leaves
the room showing older words, not Operis showing wrong ones.

An edit sends an `m.replace` carrying `m.new_content`, with the `* ` fallback
body for clients that do not understand edits. A deletion redacts the original
event **as the actor**, not as the bot: the author may always redact their own
event and a space owner sits at power level 50, which is the room's `redact`
level — so the homeserver enforces the same rule Operis does and the room records
who removed the message.

**The edit transaction id is derived from the message id AND `edited_at`.** This
is the reaction bug in a different costume: keyed on the message alone, a second
edit would carry the first one's transaction id and the homeserver would hand
back the first edit's event, making every edit after the first a permanent no-op.
`edited_at` changes with every edit and is stable across a retry of one, which is
exactly what a transaction id needs. A redaction can key on the event id alone,
because a message is deleted once.

A failed redaction leaves the homeserver holding something Operis has deleted.
That is a retention question rather than a consistency one, and the drift check
does not see it — its query filters `m.deleted_at is null`. The mapping row is
left in place so a reconciliation can still find the event.

## Attachments

Carried **both ways**, and the bytes are copied rather than linked in each
direction. Matrix models a file as a message of its own, so a chat message with
two pictures is three events in the room.

**Outbound**, each file is uploaded to the media repo as the sender and
announced as an `m.image`/`m.video`/`m.audio`/`m.file`. Best-effort in both
modes, like an edit and unlike the message itself: a file lives in Operis' own
store whichever system owns the stream, so a failed copy leaves the room missing
a picture rather than Operis missing a message. Idempotent on
`chat_matrix_events.subject_key` (`attachment:<id>`) — that matters more here
than anywhere else in the transport, because re-uploading is the one operation
whose cost is measured in megabytes.

**Only `clean` files leave.** `attachments/lib/access.ts` gates serving on
exactly that status, so copying an `infected` or `failed` file into a room would
put bytes somewhere Operis itself refuses to serve them from — and a room has no
scan gate to catch it later.

**Inbound**, the `mxc://` is downloaded and pushed through the same upload
service the HTTP route uses, so a bridged file is scanned by the same scanner
and served by the same authorized route as one a colleague uploaded. **Never
serve a bridged file straight from Synapse** — that is the one thing chat's
attachment design refuses to allow. It lands as a DRAFT owned by the sender,
because that is the only shape `chat.messages.send` can link. A file that cannot
be brought across degrades to a plain message whose body is the filename, which
is what an unhandled `m.image` used to produce for everything.

The scan is the subtle part. With no scanner configured the upload service
settles the row to `clean` inline; with a real one the verdict lands on a
`setImmediate` and the row is `pending` for a moment — long enough for
`linkDraftAttachmentsToMessage` to refuse it as `not_ready`. So a terminal
status is trusted as returned, and only a `pending` one is polled for.

## Typing and read receipts

Ephemeral in the strict sense — nothing is stored on either side — which is what
makes them safe to send on a keystroke and safe to drop on a failure. Neither
even logs a warning when it fails: the homeserver reports the CURRENT state of
each, so the next one corrects whatever the last one failed to say.

**Typing goes out only.** `chat.conversations.setTyping` fans an SSE frame to
everyone in the conversation except the person typing, then mirrors `m.typing`.
The reader does **not** ask for `m.typing` on its filter, and that is a
decision rather than an omission: every Operis user's keystrokes are already
announced directly, so projecting them would duplicate a frame the recipients
have — and a typist who is not an Operis identity cannot be attributed to
anybody until the external-participant model exists. Asking for it would cost a
notification per keystroke in every joined room and buy nothing.

**Receipts go both ways.** `markRead` resolves the cursor to the newest message
at or before it and announces `m.read`; the reader projects an inbound one back
through `markRead`, whose clamped, monotonic UPDATE is what makes a redelivered
receipt free. The one case it serves is real: a colleague reading in Element
should not still see the conversation unread in Operis. `m.read.private` is
deliberately not read — it exists so a client can advance its own marker without
telling the room.

Both carry `externalOrigin` on the way in, for the same reason an edit does:
without it a receipt read from Matrix is answered with a receipt sent to Matrix,
forever.

**The first `/sync` after enabling the transport is the slowest thing here.** It
returns the tail of every joined room at once and the projector touches the
database for each event. `FIRST_PASS_TIMELINE_LIMIT` bounds the per-room half;
the room-count half cannot be bounded, because the appservice is joined to every
conversation by design. Measured at 2,791 events across 279 rooms, that pass ran
for minutes. The cursor persists, so it is a one-off — but a large installation
should expect it.

## Still not done

Pins and membership changes are not mirrored (membership self-heals on a
refused send instead). Mention tokens (`<@uuid>`) go out verbatim, because
resolving them needs names the transport does not carry. An inbound `m.thread`
reply projects flat. The backfill publishes text only — it predates the seam and
calls `publishOne` directly rather than going through the transport.

`yarn matrix:gap-probe` asserts every one of these against a live homeserver, so
closing one makes a probe fail rather than quietly stay true. The remaining
phases are [`.ai/specs/2026-09-13-chat-matrix-parity.md`](../../../../../.ai/specs/2026-09-13-chat-matrix-parity.md).
