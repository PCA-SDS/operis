# Chat Module — Agent Guidelines

Internal messaging between people in one organization: 1:1 **direct**
conversations and named **space** group conversations, with structural message
replies. Everything runs on one set of tables and one command path — there is no
second messaging engine for groups.

## Always

- Treat a space as a conversation. `ChatConversation.kind` discriminates `direct`
  from `space`; both use the same messages, participants, read cursors, events and
  components.
- Resolve access through `chat_participants`. The row's existence IS the grant —
  read access, unread state and realtime delivery all hang off it.
- Answer **404, never 403**, for a conversation the caller is not a participant
  of. 403 is only for a member who lacks the *role* for an action they can
  otherwise see (renaming, managing membership).
- Derive the SSE audience from the live participant rows on every emit, via
  `emitConversationEvent`. That is what makes removal take effect immediately.
- Return the same refusal for "not in your organization", "deactivated" and "no
  such user" — `messages.memberNotFound`. Distinguishing them is an enumeration
  oracle.
- Validate a `replyToMessageId` against the conversation being posted to.
- Re-validate mentions on an **edit** exactly as on a send. A body is client
  input whichever verb delivered it, and skipping the check would make editing
  the way to mention a stranger or address `@everyone` in a direct.

## Translation

- Translation is **per viewer**. It never alters the stored message and never
  touches another reader's language. The reading language lives on
  `chat_user_settings (user_id, organization_id)` and is separate from the UI
  locale — French and Vietnamese have no interface translation and are exactly
  the pairings the feature exists for.
- **Never put a mention through the engine.** `segmentBody` splits the body at
  `<@...>` and only the prose between is translated. This is not caution: PUA
  markers were measured against the real M2M100 weights and survived generation
  **zero times out of twelve**, and two or more of them drove the decoder into a
  degenerate loop that replaced the message with repeated filler.
- Detect **once per message**, on all of its prose joined, and assert that
  source for every run. A single run of ordinary French measured 0.40 against
  the detector and was declined while the whole message was unambiguous.
- A cached row is only a hit when `source_hash` AND `pipeline_revision` match.
  Change preprocessing and you MUST bump `PREPROCESSING_REVISION` in
  `lib/translationGate.ts`, or readers keep the previous pipeline's output.
- Never cache a transient failure. `same-language` is a stable outcome and is
  cached; timeouts, overload and engine errors are not.
- Every requested message gets an outcome. Do not drop unfinished items from the
  response.

## Ask First

- Ask before adding a third `kind`. Both existing kinds are load-bearing in the
  `chat_conversations_kind_shape_chk` CHECK constraint and in the partial unique
  index that makes direct pairs canonical.
- Ask before adding an ACL feature. Space access is deliberately **membership,
  not privilege**: no role grant should open a space its holder was not added to.
- Ask before emitting a notification per space message — the read-cursor unread
  model is the intended UX, and one row per member per message is the noise the
  module exists to avoid.

## Never

- Never add a second send path. `chat.messages.send` handles both kinds; the only
  difference is how a departed counterpart is treated (see below). It also
  handles a message arriving **from** the transport — see `externalOrigin` below
  — which is a mode of the one command, not a second one.
- Never put a message body in an event payload. The bridge truncates over 4KB;
  events are pointers and clients refetch over the authorized route.
- Never drop `recipientUserIds` from an emit — a private message becomes an
  organization-wide broadcast.
- Never implement a reply by copying quoted text into the new body.

## Validation Commands

```bash
yarn workspace @open-mercato/core test -- src/modules/chat
yarn typecheck
JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral --no-reuse-env "modules/chat/__integration__"
```

## Data Model

| Table | Carries |
|---|---|
| `chat_conversations` | `kind` (`direct`/`space`), `direct_key` (pairs), `title` + `created_by_user_id` (spaces), denormalized last-message columns |
| `chat_participants` | membership, `role` (`owner`/`member`), `last_read_at` — the entire unread model |
| `chat_messages` | turns; `kind` (`user`/`system`), `reply_to_message_id`, `system_event` + `system_target_user_id`, `edited_at`, `deleted_at` |

Three constraints carry guarantees the application cannot promise alone:

- **`chat_conversations_direct_uq`** — partial unique on `(tenant, org, direct_key)
  where kind = 'direct'`. Makes one conversation per pair a database fact, so
  simultaneous "message them" from both sides converges. Spaces are excluded, so
  an organization may hold many spaces with the same people.
- **`chat_conversations_kind_shape_chk`** — a `direct` has a pair key and no
  title; a `space` has a title and no pair key. Without it a mis-set `kind`
  produces a space nobody can name, or a direct that escapes pair-uniqueness.
- **`chat_messages_reply_fk`** — composite FK on `(reply_to_message_id,
  conversation_id)` referencing `(id, conversation_id)`. A reply therefore
  **cannot** target a message in another conversation, space or organization,
  even if every application check were removed. A single-column FK would only
  prove the target exists somewhere.

## The Transport Seam

`chat/lib/transport.ts` is where a message goes besides the database. The default
`local` transport does nothing, and that is correct rather than a placeholder:
with no external messaging system, the database write *is* the delivery.
`chat_matrix` re-registers the `chatTransport` DI token to swap in a
homeserver-backed one — chat itself imports nothing Matrix-shaped.

Two flags decide the behaviour, and only the second changes what a user
experiences:

- `OM_CHAT_TRANSPORT` — `local` (default) or `matrix`.
- `OM_CHAT_MATRIX_MODE` — `shadow` (default) or `authoritative`.

**`shadow`**: commit, then publish, and never let a publish failure fail a send.
Postgres is the source of truth; a gap is found by `chat_matrix drift`.

**`authoritative`**: publish, then commit — and a failed publish fails the send.
The ordering is the point: a row must never exist for a message the messaging
system never accepted. The cost is that chat now depends on the homeserver being
reachable.

### `externalOrigin`

`SendChatMessageInput.externalOrigin` marks a message that already exists in the
messaging system and is being replayed in. Set **only** by the transport's
projector, never by an HTTP caller. It suppresses the publish — the event is the
reason the call is happening — and pins the id and timestamp to the ones the
event carries.

It exists so the projector does not write `chat_messages` rows itself. Writing
them directly would be shorter and would silently skip mention validation,
attachment linking, the search document, the link index and the conversation
preview. Routing through the command keeps every invariant in the one place that
owns it.

Authorship on that path still comes from the server: the projector resolves the
sender from the event's `sender`, a namespaced identity only the appservice can
mint. It is never taken from a payload.

## Editing and Deleting

Two commands, `chat.messages.edit` and `chat.messages.delete`, behind
`PATCH`/`DELETE` on `/api/chat/conversations/{id}/messages/{messageId}`.

**The permissions are deliberately different widths.** Editing is the author and
nobody else — not a space owner, not the other person in a direct — because
rewriting somebody's words puts sentences in their mouth. Deleting is the author
always, plus a space owner, because removing a message is moderation and a space
already has owners for exactly that class of decision. A direct has no owner, so
only the author may delete there. System rows are neither editable nor deletable:
they are the transcript's record of what happened to the conversation.

**An edit is not a small update.** Four things are derived from a body, and all
four are rebuilt in the same transaction — `search_body`, `chat_message_mentions`
plus `mentions_everyone`, `chat_message_links`, and the conversation preview when
this is the message the list is showing. A message whose text says one thing
while its search document still describes the previous version is worse than one
that was never edited. Attachments are untouched, and the validator refuses an
empty body precisely so an edit cannot strand them.

`edited_at` is its own column and **not** `updated_at`: that one's `onUpdate`
hook fires on every flush touching the row, so it cannot answer "did a person
change these words".

A second delete **converges** rather than 404ing: the lookup opts into
`includeDeleted`, which relaxes the liveness filter and nothing else — scope,
conversation, membership and the author-or-owner check are unchanged. Every other
caller of `requireMessageInConversation` keeps the strict default.

**A delete is a soft delete**, and the read model already does most of the work —
every path filters `deleted_at is null`, the Shared panel's join drops the
message's links, and `lib/replies.ts` renders a quote of it as "Original message
unavailable" rather than as nothing. Two things it cannot do by itself: pins to
the message are removed (`listPinned` hides it, but the pin COUNT is a plain
count), and the conversation's last-message columns are repointed at whatever is
now newest — `last_message_at` included, so the list cannot advertise activity a
reader cannot find.

The translation cache needs no invalidation either way: its rows are keyed by a
hash of the source text, so an edited message misses and is translated afresh.

## Departed Members

A participant row outlives the organization membership that created it. What that
means depends on the kind, and `chat.messages.send` treats them differently on
purpose:

- **direct** — the counterpart is the only recipient, so the conversation has
  quietly become one-way. The send is **refused**, which stops someone typing
  sensitive material into it.
- **space** — one departed colleague must not break the room for everyone else.
  They are **dropped from the audience** and the send proceeds.

`listMembers` omits them for the same reason: a roster of people who cannot sign
in invites removing them one by one for no effect.

## Space Roles

`owner` renames, adds, removes and promotes; `member` reads, sends and replies.
The creator becomes owner. **A space always keeps an owner** — the last owner
cannot leave or demote themselves while other members remain, and "Make owner" in
the members panel is the way out, so the rule is a redirect rather than a dead
end. A sole owner who is also the last member may leave; the space is
soft-deleted with them.

## System Messages

Membership changes are real rows with `kind: 'system'`, not messages posted as the
actor. They carry the event and its target in their own columns and the sentence
is assembled client-side from translations plus current display names — a stored
English string would be wrong in four of the module's five locales and would
freeze a name that later changes.

They are **excluded from the unread predicate** (`m.kind = 'user'`), so a space
with active membership is not permanently unread for everyone in it. They still
bump `last_message_at`, so the space rises in the list.

## Where Things Live

| Concern | File |
|---|---|
| Access + role gates | `lib/spaces.ts` (`loadSpaceForMember` / `loadSpaceForOwner`) |
| Reply hydration | `lib/replies.ts` — one batched query per page, reusing names the page already resolved |
| Organization membership predicate | `lib/scope.ts` |
| Space writes | `commands/spaces.ts` |
| Send, edit, delete | `commands/messages.ts` |
| The message-in-conversation guard | `commands/shared.ts` (`requireMessageInConversation`) |
| Read model | `services/chatService.ts` |
| Shared people picker | `components/MemberPicker.tsx` — used by both create and add-people |

Routes live under `/api/chat/conversations/...` rather than a parallel `/spaces`
tree, because a space **is** a conversation. `POST /api/chat/conversations` is a
discriminated union on `kind` that defaults to `direct`, so a pre-space client
posting a bare `{ userId }` is unaffected.

## Specs

- Phase 1 (direct messaging): [`.ai/specs/2026-09-03-chat-direct-messaging.md`](../../../../../.ai/specs/2026-09-03-chat-direct-messaging.md)
- Phase 2 (spaces and replies): [`.ai/specs/2026-09-04-chat-spaces-and-replies.md`](../../../../../.ai/specs/2026-09-04-chat-spaces-and-replies.md)
