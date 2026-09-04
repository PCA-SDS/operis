# Chat Reactions, Mentions, @everyone and Pinned Messages

Status: in progress
Phase: 3 of the chat module (phase 1 direct messaging, phase 2 spaces + replies)

## Summary

Four collaboration features hung off the existing message/conversation model. No
new service layer, no second realtime channel, no parallel messaging pipeline —
each is a table keyed to `chat_messages` or `chat_conversations`, a command, a
route, and a piece of the transcript that already renders.

## Data model

All additive. One migration.

### `chat_message_reactions`

| Column | Why |
|---|---|
| `message_id` + `conversation_id` | The pair, so the composite FK below can pin a reaction to the conversation its message lives in |
| `user_id`, `emoji` | Who reacted with what |
| `tenant_id`, `organization_id` | Scope, as every chat row carries |

- `chat_message_reactions_uq` UNIQUE `(message_id, user_id, emoji)` — one person
  may hold a given emoji on a given message once. Clicking again removes it, so
  the toggle cannot produce duplicates however many times it is pressed.
- `chat_message_reactions_message_idx` on `(message_id)` — the aggregation reads
  every reaction for a page of messages at once.
- `chat_message_reactions_conversation_fk` composite FK on
  `(message_id, conversation_id)` → `chat_messages (id, conversation_id)`, the
  same construction replies use: a reaction cannot attach to a message in another
  conversation, space or organization even if every application check were
  removed.

### `chat_message_mentions`

| Column | Why |
|---|---|
| `message_id` + `conversation_id` | Composite FK, as above |
| `mentioned_user_id` | The structural reference — see below |

- `chat_message_mentions_uq` UNIQUE `(message_id, mentioned_user_id)`.
- `chat_message_mentions_user_idx` on `(mentioned_user_id, conversation_id)` —
  "which of my conversations mention me" is one indexed read.

### `chat_messages.mentions_everyone`

A boolean, not 200 mention rows. `@everyone` means "the members of this space
**now**", so it is resolved against live membership when the audience is built
rather than frozen into rows at send time — which is also what stops a removed
member being notified.

### `chat_pinned_messages`

| Column | Why |
|---|---|
| `conversation_id`, `message_id` | What is pinned, and where |
| `pinned_by_user_id`, `pinned_at` | Who and when — the panel orders by this |

- `chat_pinned_messages_uq` UNIQUE `(conversation_id, message_id)` — pinning
  twice is idempotent rather than a second row.
- `chat_pinned_messages_recent_idx` on `(conversation_id, pinned_at DESC)` — the
  panel's only query.
- Composite FK on `(message_id, conversation_id)`, so a forged id from another
  conversation is unstorable.

## Mentions are stored as tokens, not names

A mention is written into the body as `<@{userId}>`, and the transcript resolves
that id to the person's **current** display name at render time. Storing
`@Alice Tan` would freeze a label that changes the moment she is renamed, and
would make the mention unrecoverable as a relationship. `<@everyone>` is the
one reserved token that resolves to a word rather than a person.

The body remains plain text and is still rendered as text nodes — the token is
split out by a parser, never by `dangerouslySetInnerHTML`, so a mention is not a
route to inject markup.

`chat_message_mentions` is written alongside, so "who was mentioned" is an
indexed question rather than a `LIKE` over message bodies.

## Permissions

| Action | Who |
|---|---|
| React / unreact | Any conversation member |
| Mention a person | Any member; the target must be a member of that conversation |
| `@everyone` | Any member of the space |
| Pin / unpin | Direct: either participant. Space: **owners only** |

`@everyone` is deliberately not owner-gated. Operis has no existing product rule
for it, and the module's own principle is that access is membership rather than
privilege — a role grant should not be what decides whether a colleague can say
"this concerns all of us". The friction is a confirmation above a threshold
instead, which stops the accident without inventing a hierarchy.

Pinning IS owner-gated in a space, because a pin is shared furniture: it changes
what every member sees at the top of the conversation, and the module already
has owners for exactly that class of decision.

## Realtime

No new channel. Reactions, pins and mentions ride `chat.message.reacted`,
`chat.conversation.pinned` and the existing `chat.message.sent`, all emitted
through `emitConversationEvent`, which recomputes `recipientUserIds` from the
live participant rows on every emit. Payloads stay pointers — the client
refetches over the authorized route.

## Notifications and unread

One model, no cascade. A message already produces unread through the read
cursor; a mention does not add a second notification, it raises the *severity* of
the unread that already exists. The conversation list shows an `@` on a
conversation holding an unread message that names you, so unread and mention are
one badge with two states rather than two competing counters.

Reactions and pins deliberately produce no unread and no notification: they
change a message that is already in the transcript.

## Message context lookup

Pin navigation needs a message that may be far back in history, so
`GET /messages?around={id}` returns a window centred on that message rather than
the client walking pages until it finds one.

## Verification

Full re-verification pass on 2026-09-05, against the running app and a fresh
ephemeral environment.

**Gate** — typecheck (24/24), lint (0 errors), DS lint (0 chat findings), unit
(51/51 packages, chat 199/199), i18n hardcoded-string check (0 chat findings),
`db:generate` drift (`chat: no changes`), agents budget (pass), production build
(compiled successfully), integration `TC-CHAT-001..005` (15/15).

**Security** — every new route carries `requireAuth` plus a `chat.view`/
`chat.send` feature guard, and passes the request scope into the service rather
than trusting a body field. The one raw query (`loadUnreadMentionFlags`) is a
Kysely tagged template — every interpolation is a bound parameter — and filters
on `tenant_id` and `organization_id` taken from the viewer's own participant row.
`TC-CHAT-005` proves the boundaries end-to-end: a non-member reacting gets 404
rather than 403 (the message's existence is not disclosed), a reaction cannot be
forged onto a message in another conversation, mentions of a non-member, a
cross-organization user and a nonexistent id are all rejected, `@everyone` is
refused in a direct conversation, and pinning is owner-only in a space.

### Defects found and fixed in this pass

- **Every message reserved a dead 28px band.** The reactions row was rendered on
  every message so the add-control could fade in on hover, and an `opacity-0`
  control still occupies its box. The picker moved into the hover bar; the chips
  row now renders only when there are reactions. An unreacted row went 88px → 60px.
- **The transcript was lopsided.** Both incoming and outgoing rows used
  `pl-10 pr-2`, so an incoming bubble sat 40px off the left rail and an outgoing
  one 8px off the right. Now `px-10`: 40/40.
- **The hover bar mixed two button treatments.** The quick emoji were
  hand-rolled `rounded-md hover:bg-surface-muted` next to `IconButton`s that are
  `rounded-lg hover:bg-accent`. All five controls are now the same primitive, and
  the divider is the DS `Separator` rather than a bare span.
- **Composer field sat high in its box** — `pt-2.5 pb-0` gave 10px above the text
  and 6px below; now `py-2`.
- **Unpin control was 2px off its row's first line** — a hand-picked `mt-2`
  against a sibling's `py-2.5`.
- **Jumping to a pinned message dropped focus to `<body>`.** The panel is a
  dialog whose trigger unmounts with it, so a keyboard reader's next Tab
  restarted from the top of the page. The jump now focuses the target row
  (`tabIndex={-1}`, `preventScroll`), which also gives a screen reader something
  to announce on arrival. Covered by three regression tests.

## Second re-verification pass

A deeper audit across realtime, notifications, performance, database and code
consistency. The security model held throughout — audience derivation, tenant
scoping, membership gates and mention validation all verified correct, and the
composite foreign keys were proven against Postgres to reject cross-conversation
writes for all three new tables. The defects were performance and UX.

- **One reaction refetched the whole module.** `scopeForEvent` collapsed every
  event except `chat.conversation.read` onto the wide path, and
  `useMessageEngagement` invalidated `chatKeys.all` on success — so someone
  adding an emoji made every participant refetch their conversation list, member
  list, directory and *every loaded page* of a transcript that might not even be
  the one reacted in, twice (once from the mutation, once from the event echo).
  Both sides now narrow to the conversation the server named: measured 5 requests
  for a reaction, none of them touching another conversation or the list.
- **Members past the first page were unmentionable.** The composer was fed an
  unfiltered membership fetch that the server pages at 50, so in a larger space
  the menu silently never offered anyone beyond the first page — while the server
  would have accepted the mention. The typed query is now debounced up to the
  parent and searched server-side, across the whole membership.
- **The conversation list hydrated every member of every space.** It needs the
  caller's own row plus, for directs, the other person's; it was fetching all
  participants of all conversations — 2,500 entities for five 500-member spaces.
  Narrowed to exactly those rows.
- **New members were told they had been named before they joined.** A fresh
  participant inherits a null read cursor, so every historical `@everyone` in the
  space became a personal unread mention. The flag is now scoped to messages at
  or after the participant's join. Covered by an integration test.
- **Pinning spent the conversation-creation rate-limit budget.** The pin route
  metered on `chatConversationCreateRateLimit`, a bucket named and tuned for
  defending against directory walking, so pinning twenty messages blocked
  starting a new conversation. Moved to the send bucket, matching reactions.
- **A read-only viewer could never see who reacted.** The chip was a `disabled`
  button inside a tooltip, and a disabled button emits no pointer events — so the
  one person who can only look was the one person the tooltip never opened for.
  With nothing to press it is no longer a control: a labelled, non-focusable chip
  that still reads out its count.
- **The mention menu drifted from the design system.** The `@everyone` row
  hand-rolled its circle, giving it a different fill from the `Avatar` rows
  directly beneath it; it now uses `Avatar`'s `icon` slot.
- **The mention menu never announced its highlighted row.** Now wired with
  `aria-controls` + `aria-activedescendant` on the textarea. Deliberately *not*
  `role="combobox"` — that overrides the textarea's native role, and a multiline
  combobox is inconsistently announced by screen readers.
- Housekeeping: removed an unused `chatPinSchema`, merged three duplicated import
  groups in `chatService`, and restored `MessageList`'s `"use client"` quote style
  so it matches its thirteen siblings.

Known and accepted: the actor receives their own engagement event back, so a
reaction costs two narrow invalidations rather than one. Suppressing the echo
would mean tracking which events this client caused, for a modest gain over an
already-coalesced 200ms window.

## Changelog

- 2026-09-05 — second re-verification pass: nine further defects fixed (see
  above), TC-CHAT-006 end-to-end spec and reaction/mention/late-join tests added.
- 2026-09-05 — re-verification pass: full gate green, six defects fixed (listed
  above), three focus regression tests added.
- 2026-09-05 — initial spec, written alongside the implementation.
