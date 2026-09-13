# Chat on Matrix — closing the parity gap

> Status: **complete for this phase** — Phases 0, A, B, C done and D's transport
> prerequisite (push mode) shipped (2026-09-14). The full CI gate is green.
> What remains of D is one product decision, not code: see Phase D.
> Follows: [`.ai/specs/2026-09-10-matrix-chat-foundation.md`](2026-09-10-matrix-chat-foundation.md) (Phases 0–3),
> [`ADR-0006`](../../docs/architecture/adr/ADR-0006-matrix-chat-transport.md).

## Why

The foundation spec delivered a transport that carries **four** actions outward
(message, edit, redaction, reaction) and projects **one** inward (a plain text
message from an Operis identity). That was the right scope for proving the seam.
It is not an internal chat product, and it is not enough for a bridge: a
conversation that loses a reaction, an edit, a file and a membership change on
the way through is not the same conversation on the other side.

This spec closes that gap in four phases, each independently shippable and
independently revertible.

An audit on 2026-09-13 also found that the transport **had never actually run**
in a bundled build. Phase 0 records what that was and why every gate missed it,
because the same shape of bug is what the later phases are most likely to
reintroduce.

## Phase 0 — Make the transport actually reachable ✅ **DONE 2026-09-13**

Three faults in series, each hiding the next. A production build logged
`chat transport bound to Matrix` on every request while every message went only
to Postgres.

| # | Fault | Fix |
|---|---|---|
| 1 | `turbo run start` runs in strict env mode; `OM_CHAT_TRANSPORT` and every `OM_MATRIX_*` were missing from `globalPassThroughEnv`, so they were deleted before the process that reads them started. | Listed in `turbo.json`, with the reasoning in its `//` note. |
| 2 | `chat_matrix/di.ts` loaded its sibling by **relative** path through `createRequire`. A bundler resolves that against the bundled `di.js`, finds nothing, and returns an empty module rather than throwing — so `createMatrixChatTransport` was `undefined` and `register()` logged success anyway. | Load by **package** specifier (the form the generated DI registry already uses), take the first specifier that carries the export rather than the first that loads, and throw naming the binding when none does. |
| 3 | `chatTransportFrom` wrapped the resolve in `try { … } catch { return createLocalChatTransport() }` — a fallback for partial test containers. It caught the resulting `TypeError` and silently substituted `local`. Sends returned 200. | A registration that fails to resolve is not a missing one. The `hasRegistration` check stays; the resolve is no longer caught. |

Also fixed: the live send path passed `ownerUserIds: []` to `ensureConversation`,
so **no space owner was ever seated at the room's `redact` power level** and an
owner's deletion was refused by the homeserver. Only the backfill path passed
real owners, so a backfilled room behaved differently from one a person created.
`conversationRoster` now returns owners alongside the audience from the query
that was already reading those rows.

**Why every existing gate missed all four.** `matrix:verify` talks to the
homeserver without the app. `matrix:verify:transport` constructs the transport
directly, so it never goes through `di.ts` — and it passes `ownerUserIds:
[alice]`, so it could not see the empty-list bug either. The unit tests fake the
container. `TC-CHAT-009` was the one gate that would have caught faults 1–3, and
it runs inside the harness those faults broke: it failed, and its failure looked
like a timeout.

**New gate:** `yarn matrix:gap-probe` drives the real transport and the real
projector against real Synapse and asserts the **current boundary** — so closing
a gap makes a probe fail rather than quietly stay true.

## Phase A — The inbound direction ✅ **DONE 2026-09-13**

Today a reaction, edit or redaction performed in any Matrix client is dropped:
`projection.ts` skips everything that is not a plain `m.room.message`. The
homeserver is a write-only log, which is the opposite of what an authoritative
transport is for.

**Scope.** Project `m.reaction`, `m.room.redaction` and `m.replace` edits, for
senders that resolve to an Operis identity. A non-Operis sender still skips —
that is Phase D's work and needs a participant model chat does not have.

**Route everything through the existing commands.** `chat.messages.toggleReaction`,
`chat.messages.edit` and `chat.messages.delete` already enforce Operis' rules
(only the author edits; author or space owner deletes) and already rebuild the
search document, the mention rows, the link index and the conversation preview.
The projector resolves the actor from the event's `sender` and lets the command
refuse — exactly as `messages.send` already does. Writing rows directly would
skip every one of those invariants.

**Echo suppression is the mapping table, not a new flag — for reactions.**
`publishReaction` already returns early when a `chat_matrix_events` row exists
for the `reaction:<message>:<user>:<emoji>` subject key. Recording the inbound
annotation under that key **before** invoking the command therefore suppresses
the mirror with no new mechanism. Recording it first is also what makes
projection idempotent: a toggle re-applied is a reaction *removed*.

**Edits and deletions need `externalOrigin`**, matching `SendChatMessageInput`.
`publishEdit` and `publishDeletion` would otherwise write a second `m.replace`
or redact an already-redacted event. The marker is set only by the projector,
never by an HTTP caller.

**Un-react arrives as a redaction of the annotation**, not as a distinct event.
The projector resolves the redacted event id, finds the reaction mapping, and
removes both the reaction and the mapping — a redaction whose target maps to a
*message* is a delete instead.

New skip reasons: `unmapped-target` (the relation points at an event Operis has
no mapping for) and `not-permitted` (the command refused — logged, never fatal,
because one refused event must not stall the stream).

**Integration coverage (ships with the phase).** Extend `TC-CHAT-009`: react in
Element → the reaction appears over `GET /api/chat/conversations/{id}/messages`;
redact the annotation → it disappears; edit in Element → the body changes and
`editedAt` is set; redact a message → it leaves the transcript. Each asserted
through the HTTP API, with the event injected directly at the homeserver.

## Phase B — Attachments over Matrix ✅ **DONE 2026-09-13**

`PublishMessageInput.attachmentIds` crosses the seam and is never read. Every
message goes out as `msgtype: 'm.text'`, so a native client — and a bridge —
sees an incomplete transcript. Inbound, an `m.image` projects as a plain text
message whose body is the filename, and the `mxc://` is discarded.

**Outbound.** Upload each attachment to the media repo as the sender, emit one
`m.image`/`m.file`/`m.audio`/`m.video` event per attachment alongside the text
message, and record each in `chat_matrix_events`. `MatrixClient.uploadMedia`
already exists and has no caller.

**Inbound.** Download the `mxc://`, run it through the `attachments` module so it
gets a `scan_status`, and link it to the projected message. **A bridged file must
never be served straight from Synapse** — that is the one thing chat's
attachment design refuses to allow.

**Decided.** The ceiling is chat's own `resolveChatAttachmentLimits().maxBytes`
in both directions — a file Operis would not accept over HTTP has no business
crossing the seam either, and one limit is easier to reason about than two.
Inbound media is fetched **eagerly**, during projection: lazily would mean a
message whose attachment row promises bytes that are not there yet, and the
transcript already renders a `pending` scan state that would then be lying about
what it is waiting for.

**And one that was not on the list.** Only `clean` files leave Operis, because
`attachments/lib/access.ts` gates serving on exactly that status — copying an
`infected` file into a room would put bytes somewhere Operis itself refuses to
serve them from, with no scan gate on the far side to catch it.

**Integration coverage (shipped).** `TC-CHAT-009` now stages a file through the
ordinary upload route, sends it, and asserts an `m.file` carrying an `mxc://`
appears on the homeserver as its own event under the author's mxid — then
uploads an image to the media repo as the other person, posts it into the room,
drains the reader, and asserts it comes back as a real attachment on the
transcript rather than a filename in a message body.

## Phase C — Liveness and reach ✅ **DONE 2026-09-13**

Two halves that are independent of the transport's correctness and are what
makes the product feel like chat.

### Ephemeral signals ✅ **DONE 2026-09-13**

Typing indicators and read receipts. `setTyping`,
`sendReceipt` and `setReadMarkers` are all written and tested in
`@open-mercato/matrix` with zero call sites; the sync filter requests
`ephemeral: { types: [] }`, so nothing can observe them. Needs a typing route, an
ephemeral SSE channel that is explicitly **not** persisted, a filter change, and
`markRead` mirroring `m.read`. Read receipts in a space also need a per-member
"seen by" read model — today the UI shows one line, directs only.

### Reach ✅ **DONE 2026-09-13**

Nothing subscribed to `chat.message.sent`, so chat is live only while
a tab is open. Needs a notification subscriber, web push, and — before any of it
ships — per-conversation mute, because a notification you cannot turn off is
worse than none. Mute is a new column on `chat_user_settings` or a new
`chat_conversation_settings` table; `m.push_rules` is the Matrix-native answer
and is the reason to model it as a room-level override.

**Decided.** Mute is a **column** — `chat_participants.muted_at`, beside
`last_read_at`, the other per-person-per-conversation state. A table would have
bought nothing: there is exactly one setting and it is keyed on the row that
already exists. A timestamp rather than a boolean because it answers "since
when" for free and a later "mute for two hours" needs a moment to measure from.

Web push needed no new infrastructure at all — `notifications` owns per-type,
per-channel opt-out and `push_notifications` owns the delivery rails, so chat
declares two notification types and a subscriber and inherits both. The service
worker question was moot.

**And the one that mattered.** `chat/AGENTS.md` says to ask before notifying per
space message, and the answer is that we do not: a direct notifies its
counterpart, a space notifies only the people a message **names**. That is what
Slack and Teams do, it is why a busy channel is usable, and it is the difference
between a chat people keep notifications on for and one they mute in week one.
Two types rather than one, so silencing mentions and silencing DMs are separate
switches.

**Integration coverage (shipped).** `TC-CHAT-011` asserts it over the ordinary
notifications API: a direct message notifies its counterpart and not its sender;
muting stops the next one while the unread count keeps moving; a plain space
message notifies nobody; a mention notifies exactly the person named and nobody
else.

## Phase D — Bridge readiness

What a mautrix bridge needs that does not exist. None of it is startable before
the AGPL sign-off ADR-0006 asks for.

| Prerequisite | Why it blocks |
|---|---|
| Appservice `PUT /_matrix/app/v1/transactions/{txnId}` | The registration is `url: null` — pull-only. Synapse sends transactions **in order** and blocks up to 60s per request, so the endpoint must verify `hs_token`, dedup on `chat_matrix_txns`, enqueue and return 200 without projecting inline. The verifier, the parser and the table all exist and have no caller. |
| External-participant model | `projection.ts` hard-skips any sender that is not an Operis identity, and `chat_participants.user_id` is a uuid into Operis users. A WhatsApp counterpart cannot have a row as the table stands. |
| Media relay | Phase B is a prerequisite, not a parallel track. |
| Legal sign-off | ADR-0006: counsel before any external-network phase. The CI dependency check named as the mitigation does not exist either. |

**Decided 2026-09-13 — where a bridged conversation lives.** Email stays in
`communication_channels`; every conversation with a *person* — colleagues today,
WhatsApp and Telegram later — belongs in `chat`. Email is a different medium and
gets its own screen; messaging is one product with one model.

That closes the half of the question ADR-0006 left open, and it settles the
consequence too: a customer who emails and the same customer on WhatsApp land in
two different places, with nothing joining them. Accepted deliberately. A
unified "everything this person said" view is a separate piece of work nobody has
asked for.

It also means the two modules divide cleanly, and cheaply — they already share no
code, and the chat-shaped parts of the hub (reactions, thread mapping) are unused
by the email adapters, which both declare `fileSharing: false`. Nothing needs
removing; it simply stops growing.

**Still ask first, and it is now the only open decision:** an external
participant is a schema change to `chat_participants`, the table the whole access
model rests on — membership *is* the grant. There is no longer an alternative
route to weigh it against; the question is purely how to model somebody who is
not an Operis user without letting one missed check leak an internal conversation
to an outsider.

## Out of scope

E2EE; federation; per-user Matrix tokens; native Matrix clients; voice/video;
threads as a distinct UI (flat replies stay); rich text and `formatted_body`.

## Rollback

Phase A: the projector's new branches are additive skips — reverting restores
the current "not-a-message" behaviour and loses nothing already written.
Phase B: attachments stay in Operis, as today. Phase C: both halves are
independently revertible. Phase D: not started.

## Closing this phase

The chat module runs on Matrix, in both directions, and the whole CI gate passes
— thirteen steps including the full monorepo suite and the application build.
Everything below is verified rather than asserted:

| Gate | |
|---|---|
| `yarn build:packages` → `build:app` (13 steps) | green |
| chat + chat_matrix unit | 776 across 42 suites |
| `@open-mercato/matrix` unit | 154 |
| integration, `matrix` / `authoritative` | 34 / 34 |
| integration, `local` | 29 + 5 skipped |
| live homeserver (`verify` / `transport` / `drift`) | 23 + 22 + 16 |
| `matrix:gap-probe` | 3 known gaps, 0 errors |

**The three remaining probe gaps are deliberate and documented**: renaming a
space does not rename the room, removing a member does not remove them from it,
and an inbound `m.thread` projects flat. Each is a mirror that has never
existed, not a regression — and none of them is reachable by a user of the chat
UI today.

**Two things an operator must do before this is live:** apply the migration
(`chat_participants.muted_at`), and — if the homeserver is wanted — set
`OM_CHAT_TRANSPORT=matrix`. Chat works without Matrix; the transport is opt-in
and `local` remains the default.

## Changelog

| Date | Entry |
|---|---|
| 2026-09-14 | **Phase closed.** Swept the chat module for the container-vs-viewport mistake the header exposed: `ChatShell` and the back button legitimately own the viewport decision, the dialogs are viewport-relative by nature, and message bubbles already size against their container — the header was the only instance, and it now uses a container query so it reacts to its own 376px rather than the window's 1024px. Also closed the hole that let it ship: the module's contract test hardcoded five locales while the module ships eight, so eighteen keys reached five and CI caught the rest; it now reads the locale list off disk. Gate: all thirteen CI steps green, 776 + 154 unit, 34/34 and 29+5 integration, 61 live checks. |
| 2026-09-13 | **Phase D, first prerequisite shipped — push mode.** `PUT /api/chat_matrix/appservice/_matrix/app/v1/transactions/{txnId}`, the module's only unauthenticated route, guarded solely by a constant-time `hs_token` check made before the body is read. It records and enqueues, never projects: Synapse blocks on the response and holds every later transaction behind it. A repeat of a `txn_id` is a success rather than a conflict, because a retry means our 200 was lost; a failure to record is a 500, because acknowledging what was not recorded loses it permanently. Verified against real Synapse: 22 transactions pushed and processed, and a message sent outside Operis reached the transcript **with the `/sync` scheduler off**, so push was the only path it could have taken. One thing worth writing down — a registration's `url` is the appservice's BASE address and the homeserver appends the spec path to it; naming the transactions path there 404s every push, which is how the first attempt failed. Gate: 776 chat unit tests (15 new), 34/34 integration on `matrix`/`authoritative` including an end-to-end push and both refusals. |
| 2026-09-13 | **Phase C, second half shipped — reach.** Two notification types (`chat.direct.received`, `chat.mention.received`) and a subscriber on `chat.message.sent`, inheriting per-channel opt-out and push delivery from the `notifications` + `push_notifications` stack rather than building any of it. A direct notifies its counterpart; a space notifies only the people a message names — which is the answer to chat's own ask-first rule about per-space-message notifications. Three exclusions: the sender, anyone muted, and anyone whose cursor is already past it. `groupKey` is keyed on the conversation and reader so five messages leave one entry. Mute is a new `chat_participants.muted_at` column with its own route, command, DTO field and a header toggle in five locales; it silences notifications only — the unread count still moves, because conflating the two is how people lose things in rooms they silenced months ago. Gate: 761 chat unit tests (17 new), 33/33 integration on `matrix`/`authoritative`, 27+6-skipped on `local`. |
| 2026-09-13 | **Phase C, first half shipped — ephemeral signals.** Typing goes out (`chat.conversations.setTyping` → an SSE frame to everyone but the typist, plus `m.typing`), with a throttled composer signal and an indicator above it in all five locales. Receipts go both ways: `markRead` announces `m.read`, and an inbound one replays through `markRead`, whose clamped monotonic UPDATE makes a redelivery free. Inbound typing is deliberately NOT read — it would duplicate a frame the recipients already have and cost a poll per keystroke. Two things surfaced while verifying: the manual `chat_matrix sync` was long-polling for 20s before answering "nothing new", now it drains; and the first `/sync` after enabling the transport projects the tail of every joined room in one unbounded job, measured at 2,791 events across 279 rooms and minutes of wall clock — the per-room half is now bounded and the room-count half is documented as the one-off it is. Also recorded our own edit and redaction events, which `matrix:verify:transport` caught us re-projecting. Gate: 744 chat unit tests (10 new), 31/31 integration on `matrix`/`authoritative` against a freshly reset homeserver with no flake, 27+4-skipped on `local`, 23+22+16 live checks, and `matrix:gap-probe` down from 5 confirmed gaps to 3. |
| 2026-09-13 | **Phase B shipped.** Attachments travel both ways, bytes copied rather than linked in each direction. Outbound each file becomes its own `m.image`/`m.file` event, best-effort in both modes and idempotent on an `attachment:<id>` subject key, and only a `clean` scan status is allowed to leave. Inbound the `mxc://` is downloaded and pushed through the same upload service the HTTP route uses, landing as a draft owned by the sender so `chat.messages.send` can link it — the projector still writes no rows itself. The scan race is the subtle part: a terminal status is trusted as returned and only a `pending` one is polled, because with a real scanner the verdict lands on a `setImmediate` and the send would otherwise be refused as `not_ready`. Gate: 734 chat unit tests (9 new), 31/31 integration on `matrix`/`authoritative` including a file round trip through the real upload route and the real media repo, and `matrix:gap-probe` down from 7 confirmed gaps to 5. |
| 2026-09-13 | **Phase A shipped.** `m.reaction`, `m.room.redaction` and `m.replace` now project, each replayed through the command that owns the rule so Operis' permissions apply to a Matrix actor. A redaction resolves through the mapping table to either a message deletion or an un-react — Matrix has no un-react event. The inbound reaction's mapping is written before the command, which suppresses the outbound mirror with no new mechanism and makes a redelivery a no-op rather than a reaction taken away; a refusal gives the claim back. Edits and deletions carry `externalOrigin` instead, matching a send. Gate: 725 chat unit tests (12 new), 30/30 integration on `matrix`/`authoritative` including a new inbound spec that posts events as an Element user would and asserts over the HTTP API, 27+3-skipped on `local`, and `matrix:gap-probe` down from 12 confirmed gaps to 7. |
| 2026-09-13 | Written after an end-to-end audit against a live Synapse. Phase 0 fixed and verified: 29/29 on the chat suite over HTTP in `authoritative` mode (was 28/29, and the 28 were passing on `local` because the app had silently fallen back), 27+2-skipped on `local`, 153+713 unit, 23+22+16 live checks, plus a new `matrix:gap-probe` that confirmed 12 boundary gaps against a running homeserver. |
