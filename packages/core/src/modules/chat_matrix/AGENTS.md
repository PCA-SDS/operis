# Chat Matrix Transport — Agent Guidelines

Maps Operis chat conversations onto Matrix rooms. Five mapping tables and
nothing else: no pages, no API routes, no UI. It exists so that the `chat`
module can keep every table, constraint and query it already has while a
homeserver carries the same messages alongside — and so that a WhatsApp bridge,
later, delivers into the same conversation without chat learning what WhatsApp is.

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

Two schedules, both registered only when the transport is Matrix: the drift check
every 15 minutes per organization, and the `/sync` reader every 5 seconds at
**system** scope — one appservice, one stream, one cursor. A per-organization
sync would start N readers racing for it.

## What the projector will not do

It skips, never throws, on: an event it already knows, a non-message, a redacted
message, **an `m.replace`**, a room Operis never created, an empty body, and **a
sender that is not an Operis identity**.

The `m.replace` skip is load-bearing and easy to miss: an edit arrives as an
ordinary `m.room.message` whose fallback body reads `* corrected text`, so
without it every edit — ours, an engineer's in Element, a bridge's later —
becomes a duplicate message in the transcript with an asterisk in front. It is
checked on `rel_type` alone, so a malformed edit is caught too, and so a rich
reply (no `rel_type`) still projects. That last one is the bot today and a bridged WhatsApp
contact tomorrow; attributing someone else's words to an employee would be worse
than not showing them, and doing it properly needs an external-participant model
the chat schema does not have.

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

## Still not done

Pins and membership changes are not mirrored (membership self-heals on a
refused send instead). Attachments stay in Operis — copying media into the
Matrix repo is the phase where a bridge needs to relay it. Mention tokens
(`<@uuid>`) go out verbatim, because resolving them needs names the transport
does not carry.
