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
  difference is how a departed counterpart is treated (see below).
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
| `chat_messages` | append-only turns; `kind` (`user`/`system`), `reply_to_message_id`, `system_event` + `system_target_user_id` |

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
| Read model | `services/chatService.ts` |
| Shared people picker | `components/MemberPicker.tsx` — used by both create and add-people |

Routes live under `/api/chat/conversations/...` rather than a parallel `/spaces`
tree, because a space **is** a conversation. `POST /api/chat/conversations` is a
discriminated union on `kind` that defaults to `direct`, so a pre-space client
posting a bare `{ userId }` is unaffected.

## Specs

- Phase 1 (direct messaging): [`.ai/specs/2026-09-03-chat-direct-messaging.md`](../../../../../.ai/specs/2026-09-03-chat-direct-messaging.md)
- Phase 2 (spaces and replies): [`.ai/specs/2026-09-04-chat-spaces-and-replies.md`](../../../../../.ai/specs/2026-09-04-chat-spaces-and-replies.md)
