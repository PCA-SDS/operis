# ADR-0006 — Run Matrix as external infrastructure for the chat transport

- **Status:** Accepted (Phases 0–3 implemented; off by default, and a shadow writer unless explicitly made authoritative)
- **Date:** 2026-09-10
- **Spec:** [`.ai/specs/2026-09-10-matrix-chat-foundation.md`](../../../.ai/specs/2026-09-10-matrix-chat-foundation.md)

## Context

Chat is an internal-only Postgres application. Every external network we might
add — WhatsApp first — would otherwise need its own protocol client, session
handling, media pipeline, reconnection logic and conversation model.

Matrix buys that once. A Matrix room is a protocol-neutral conversation, and a
mautrix bridge turns a WhatsApp thread into one. If Operis speaks Matrix, adding
WhatsApp becomes a container deployment rather than an integration project.

Three constraints shaped every decision below.

**Beeper is not adoptable.** Their homeserver, clients and API are closed
source. What Beeper published is the mautrix bridge family and `mautrix-go`, and
their self-hosting tool `bbctl` refuses to talk to any homeserver but
`beeper.com`. "Use Beeper" therefore means exactly one thing: run mautrix
bridges against our own homeserver.

**The good parts of the ecosystem are AGPL.** Synapse and every mautrix bridge
are AGPL-3.0. Element Web is AGPL-3.0 or commercial. Operis is a commercial ERP.

**The chat module is load-bearing.** Nine entities, 27 client API functions,
Postgres full-text search, a per-viewer translation cache, and a set of CHECK
constraints and composite foreign keys that the module's own guidelines describe
as carrying guarantees the application cannot promise alone.

## Decision

### Matrix runs as external infrastructure, never as vendored code

Synapse and the mautrix bridges run as unmodified upstream container images.
Operis talks to them only over the Matrix HTTP protocol, using client libraries
that are permissively licensed:

| Component | License |
|---|---|
| `matrix-js-sdk` | Apache-2.0 |
| `matrix-bot-sdk` | MIT |
| `matrix-appservice-bridge` | Apache-2.0 |
| Synapse | AGPL-3.0 — external process |
| mautrix bridges | AGPL-3.0 — external process |
| Element Web | AGPL-3.0 — developer tool only |

**No AGPL source enters this repository, and Synapse is never patched.** A fork
would attach source-disclosure obligations to every deployment that talks to it.
Configuration is not modification, so all homeserver behaviour is expressed in
`docker/matrix/synapse/homeserver.yaml.template`.

This position should be confirmed by counsel before any external-network phase
ships. Element sells AGPL exceptions if one is ever needed, and
continuwuity/tuwunel (Apache-2.0, Conduit lineage) are the escape hatch if the
licence is judged unacceptable — everything here targets the Client-Server API
rather than Synapse specifically, so that swap stays a deployment decision.

### Synapse, not Dendrite or a Conduit fork

Synapse is the reference implementation and the only homeserver the mautrix
bridges are genuinely battle-tested against. Dendrite has been in maintenance
mode since 2023 and is not a bet worth making. The Conduit family is a credible
Apache-2.0 alternative but less proven with bridges; it stays the fallback.

Pinned to `v1.160.0`. `latest` would let a homeserver upgrade land in the middle
of an unrelated branch.

### Who owns the message stream is a flag, not a rewrite

`OM_CHAT_TRANSPORT` selects the transport; `OM_CHAT_MATRIX_MODE` selects who is
the source of truth. `shadow` commits then publishes and swallows a publish
failure; `authoritative` publishes then commits and lets a failure fail the send.

Two consequences follow, and both are deliberate:

- **In `authoritative`, a homeserver outage stops people sending.** That is the
  price of Matrix owning the stream, and it is what buys the inbound direction —
  a message Operis did not originate becoming an ordinary chat message, which is
  the path a bridge feeds.
- **Rolling back is setting one variable.** Nothing is rewritten: the `chat_*`
  rows are the same rows in either mode, because they were never a cache.

The mapping between an Operis message and a Matrix event is written **inside the
transaction that creates the message row**. That atomicity is what stops a crash
between the two from leaving a message the projector cannot recognise as already
handled — which it would then re-project, forever.

### The projector goes through the command, never the tables

An inbound event is replayed through `chat.messages.send` with an `externalOrigin`
marker rather than written into `chat_messages` directly. Writing rows would be
shorter and would silently skip mention validation, attachment linking, the search
document, the link index and the conversation preview. Going through the command
keeps every invariant in the one place that owns it, and keeps the chat module's
own rule that there is a single send path.

### The browser never talks to Synapse

Operis is the only holder of a Matrix credential. Every read and write goes
through the existing Operis API, which means tenant isolation stays in the
authorization layer that already enforces it, rather than being re-expressed as
Matrix room ACLs. It also means the chat UI needs no changes at all.

### The appservice bot owns every room

Rooms are created by the appservice's namespaced bot at power level 100, not by
the user who started the conversation. Two reasons:

- **A hard constraint.** The creator must hold PL 100 during creation to write
  the room's own state events. A room created as an Operis owner and immediately
  demoted to 50 fails with `user_level (50) < send_level (100)`. This is
  asserted in `scripts/matrix-verify.mjs`.
- **Design.** Operis is the authority over the conversation. A room must not be
  orphaned when the person who started it leaves the organization.

The Operis role model sits underneath: space owner PL 50, member PL 0. The
homeserver then enforces the same rule Operis does, which matters once bridges
and native clients can also write to a room.

### A separate namespaced bot user for reading

Synapse refuses `/sync` for an appservice's own `sender_localpart` — *"We no
longer support AS users using /sync directly"* (matrix-doc#1144). Anything that
reads a timeline must be a different namespaced account, `@om_bot:<server>`. The
mautrix bridges do the same thing for the same reason.

This is the single most expensive thing to discover late, so it has a dedicated
negative check in the verification script.

### Pull, not push, until bridges exist

The appservice registration sets `url: null`, so the homeserver never posts to
Operis; Operis polls `/sync`. That leaves no inbound endpoint to authenticate,
rate-limit or defend, and costs nothing while every message is also sent by
Operis and projected inline.

Push mode becomes necessary when bridges originate messages Operis did not send.
At that point one constraint dominates: Synapse sends appservice transactions in
order and blocks up to 60s per request, so a slow endpoint stalls the queue for
every event (element-hq/synapse#17621). The transaction endpoint must verify,
deduplicate, enqueue and return 200 without touching the projection inline.

### Isolation is configuration, and it is deliberate

Federation is disabled by empty whitelist and by never publishing port 8448. The
user directory is off, because a directory of every user on the homeserver is a
cross-tenant enumeration oracle. Room publication is denied. Presence is off.
Self-registration is off — the appservice creates every chat identity, inside an
exclusive `@om_*` namespace that no real signup can occupy. URL previews are off
because they would make the homeserver fetch arbitrary URLs typed into messages.

### `server_name` is `operis.local` in development, environment-driven elsewhere

It is embedded in every user ID and room ID the homeserver ever mints and cannot
be changed without stranding all of them, so `scripts/matrix-dev.mjs` refuses to
change it in place and directs the developer to `yarn matrix:reset`.

## Consequences

**Good.** External networks become deployments rather than integrations. The
chat UI, API contract and database guarantees are untouched — the seam is behind
`chat.messages.send`. The homeserver becomes a second enforcement point for the
role model. Rollback at every phase is a flag plus dropping tables that no
existing code reads.

**Costly, and accepted.** The operational surface grows permanently: Synapse,
its own Postgres, and later each bridge all need backup, upgrade and monitoring,
and Synapse upgrades are occasionally breaking. Phase 0 through 3 deliver no
user-visible feature; the payoff is entirely in the external-network phase.

**Unresolved.** The AGPL position needs legal sign-off before an external phase
ships. Whether bridged conversations belong in `chat` or in
`communication_channels` is a product question — the latter already models
external threads but composes into `messages`, drops attachments entirely, and
has no participants model.

## Verification

`yarn matrix:verify` asserts 23 properties against the running homeserver,
including the three that are expensive to discover late: masquerade outside the
namespace is refused, a repeated transaction id returns the same event rather
than posting a duplicate, and `/sync` is refused for the appservice sender.

```bash
yarn matrix:up                # generate config and secrets, start, wait healthy
yarn matrix:verify            # 23 homeserver acceptance checks
yarn matrix:verify:transport  # the real chat transport against the real homeserver
yarn matrix:status            # what is running
yarn matrix:down              # stop, keep data
yarn matrix:reset             # stop, drop the volume and .matrix-dev/
```

`matrix:verify:transport` exists because the unit tests prove the transport
makes the right decisions against fakes, and `matrix:verify` proves the
homeserver accepts the operations — neither proves the composition. It found a
real defect on its first run that no fake-based test could have: fakes do not
enforce unique constraints, so a redundant republish round trip looked correct
until a real database was on the other end.

Once the transport is running, the operator commands are:

```bash
yarn mercato chat_matrix drift      # does Matrix have everything Postgres has?
yarn mercato chat_matrix backfill   # publish what it is missing
```
