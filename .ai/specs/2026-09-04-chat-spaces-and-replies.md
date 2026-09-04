# Chat Spaces and Message Replies

Status: implemented
Phase: 2 of the chat module (phase 1: `.ai/specs/2026-09-03-chat-direct-messaging.md`)

## Summary

Extend the existing chat module so a conversation can hold more than two people,
and so any message can structurally reference another. Nothing is rebuilt: the
same `chat_conversations` / `chat_participants` / `chat_messages` tables, the
same command bus, the same SSE audience mechanism, the same read-cursor unread
model, the same query keys and the same components carry both conversation kinds.

## Terminology: "Space"

`Workspace` is already Operis's word for the **tenant** — `auth.login.workspaceTitle`
("Sign in to Your Workspace"), `onboarding.preparing.title` ("We are preparing your
workspace"), `tasks.errors.unknownLabels` ("don't belong to your workspace"),
`attachments.library.description` ("every file stored in this workspace"). Reusing
it for a group chat would make "your workspace" ambiguous inside one ERP.

`Team` is taken by `staff_teams`; `Channel` by `communication_channels` and
`sales_channels`; `Group` is used across the UI for menu groups and
`catalog_product_option_groups`.

**Space** is unused as a domain noun anywhere in the repo (the only matches are
`space-y-*` Tailwind classes) and is the term Google Chat uses for the same
concept. It is used consistently in the UI, the routes, the API, the `kind`
column value and this document.

## Data model

All changes are additive; no existing column changes type or nullability, and no
existing index is dropped.

### `chat_conversations`

| Column | Type | Why |
|---|---|---|
| `title` | `text null` | The space name. Null for a direct conversation, whose name is derived from the counterpart. |
| `created_by_user_id` | `uuid null` | Who created the space. Null for directs (a direct has no creator; it belongs to the pair). |

`kind` (already present, already defaulted to `'direct'`) gains the value
`'space'`. The phase-1 partial unique index `chat_conversations_direct_uq` is
already scoped `where kind = 'direct'`, so spaces do not participate in
direct-pair uniqueness and directs are unaffected.

A CHECK constraint (`chat_conversations_kind_shape_chk`) makes the two shapes
mutually exclusive at the database level: a `direct` row must have a
`direct_key` and no `title`; a `space` row must have a `title` and no
`direct_key`. Without it a mis-set `kind` would produce a space nobody can name
or a direct that escapes pair-uniqueness.

### `chat_participants`

| Column | Type | Why |
|---|---|---|
| `role` | `text not null default 'member'` | `owner` or `member`. Directs are all `member`; the column is meaningless there and never read. |

`chat_participants_owner_idx` — partial index on `(conversation_id)
where role = 'owner'` — makes "does this space still have an owner?" an index
lookup rather than a scan of the membership.

### `chat_messages`

| Column | Type | Why |
|---|---|---|
| `reply_to_message_id` | `uuid null` | The structural reply reference. Never quoted text copied into the body. |
| `kind` | `text not null default 'user'` | `user` or `system`. System rows are membership/rename events, modelled properly rather than faked as authored messages. |
| `system_event` | `text null` | `member_added`, `member_removed`, `member_left`, `space_renamed`. Null for `kind = 'user'`. |
| `system_target_user_id` | `uuid null` | The person a membership event is about. The *actor* is `sender_user_id`, which every message already has. |

**A reply can never cross a conversation, as a database fact.** A plain FK on
`reply_to_message_id` would only prove the target message exists — it would still
permit referencing a message in another conversation, another space or another
organization. Instead:

- `chat_messages_id_conversation_uq UNIQUE (id, conversation_id)`
- `chat_messages_reply_fk FOREIGN KEY (reply_to_message_id, conversation_id)
  REFERENCES chat_messages (id, conversation_id)`

The composite FK carries `conversation_id` on both sides, so the referenced row
is required to be in the *same* conversation. A forged `replyToMessageId` from
another space cannot be stored even if every application check were removed.
Since `conversation_id` is already scoped to one tenant and organization, this
also closes the cross-organization case.

`chat_messages_reply_idx` on `(reply_to_message_id) where reply_to_message_id is
not null` supports hydrating reply targets for a page.

## Permissions

Two roles, because there are only two distinct capability sets:

| | `owner` | `member` |
|---|---|---|
| Read, send, reply | yes | yes |
| Rename the space | yes | no |
| Add members | yes | no |
| Remove members | yes | no |
| Promote a member to owner | yes | no |
| Leave | yes, unless last owner with members remaining | yes |

The creator becomes `owner`. Existing `chat.view` / `chat.send` ACL features are
unchanged and still gate the module; space roles are **membership**, not ACL —
consistent with phase 1's "access is membership, not privilege". No new ACL
feature is added, because no role grant should be able to open a space its holder
was not added to.

**The last owner cannot leave while other members remain.** The members panel
offers "Make owner", so this is a redirect to a real action rather than a dead
end. A sole owner who is also the only member may leave; the space is
soft-deleted with them.

## Realtime

Unchanged mechanism. `emitConversationEvent` recomputes `recipientUserIds` from
the live `chat_participants` rows on **every** emit, and the SSE endpoint drops
the frame for any connection not in that list before writing it. A removed member
therefore stops matching on the very next message with no disconnect, no
re-authorization pass and no stale-subscription window — and because chat frames
carry a pointer rather than content, even a frame they did receive would tell
them nothing they could not already see.

Membership and rename changes emit `chat.conversation.updated` to the current
members **plus** the removed user, so the removed client refetches, receives 404
from `requireParticipant`, and drops the space from its list without a refresh.

## Unread and notifications

Unchanged model: one `last_read_at` cursor per participant row, unread derived in
SQL. Spaces get it for free.

System messages are excluded from the unread predicate (`m.kind = 'user'`), so
being added to a space does not arrive as an unread badge for everyone already in
it. They still bump `last_message_at` and the list preview, which is the useful
half.

No per-message notification records: the module's unread state already provides
the intended UX, and one notification row per member per message is exactly the
noise §33 warns against.

## API

Spaces are conversations, so they reuse the conversation URL space rather than
opening a parallel one.

| Route | Method | Purpose |
|---|---|---|
| `/api/chat/conversations` | POST | Extended to a discriminated union: `{kind:'direct', userId}` or `{kind:'space', title, memberIds}`. A body with only `userId` still means direct, so existing clients are unaffected. |
| `/api/chat/conversations/[id]` | PATCH | Rename a space. Owners only. |
| `/api/chat/conversations/[id]/members` | GET, POST | List members (paged); add members. |
| `/api/chat/conversations/[id]/members/[userId]` | DELETE, PATCH | Remove or leave; change role. |

Every one resolves scope from the session, re-checks organization membership for
each affected user server-side, and answers 404 (never 403) for a conversation
the caller is not in.

## Reply

`replyToMessageId` is accepted by the existing send endpoint and validated by the
existing send command: the target must exist, be undeleted, and be in the same
conversation — before the composite FK gets a chance to refuse it. The service
hydrates one batch of reply targets per message page and returns
`replyTo: { id, senderUserId, body, deleted }`, so rendering costs no extra
round trip per message.

A reply whose target was deleted or has fallen outside the loaded window renders
as "Original message unavailable" rather than breaking. The quote is clickable
**only** when the target is currently loaded (it scrolls to and highlights it via
the `data-message-id` anchor the transcript already carries); otherwise it is
inert text rather than a link that goes nowhere.

## Coverage

Integration tests ship with the change and cover every new API path:

| Spec | Covers |
|---|---|
| `TC-CHAT-003-spaces` | create with members; member/non-member access; unread across a space; member-only refusal of rename/add/remove/promote; adding a member and their access to prior history; idempotent re-add; removal ending access on the next request while their messages remain; rename propagation; the last-owner rule and its way out; the full cross-organization matrix including the identical-refusal enumeration check |
| `TC-CHAT-004-replies` | replies in both conversation kinds through one mechanism; structural persistence across a refetch; the body never carrying quoted text; cross-conversation targets refused for a member of both; fabricated and malformed ids; nothing written on refusal |
| `TC-CHAT-001` / `TC-CHAT-002` | unchanged, and still passing — the direct-messaging regression gate |

## Changelog

- 2026-09-04 — initial spec, written alongside the implementation.
- 2026-09-04 — implemented. Notes worth keeping:

  **The composite reply FK is the load-bearing constraint.** `yarn db:generate`
  produced a migration matching the hand-written one in every respect except
  this: MikroORM cannot express a composite foreign key to a non-primary unique
  pair from entity decorators, so the generated file omitted it entirely. The
  generated migration was deleted and the hand-written one kept; the snapshot
  reports no drift because the snapshot tracks what the entities express.
  Verified directly against Postgres: a cross-conversation reply insert is
  refused with `foreign_key_violation`, and both `kind`-shape violations with
  `check_violation`.

  **Departed members mean different things in the two kinds.** The phase-1 send
  command refused a send when any recipient was no longer an active organization
  member — correct for a direct conversation, which has become one-way, and badly
  wrong for a space, where one departed colleague would have silently broken the
  room for everyone. The check is now branched on `kind`: refuse for a direct,
  drop from the audience for a space.

  **System messages are excluded from unread.** Counting them made a space with
  active membership permanently unread for every member. They still bump
  `last_message_at`, so the space rises in the list — which is the useful half.
  Verified live: a member's unread was 3 across a space holding 3 user messages
  and 3 membership events.

  **A day separator cannot key off the grouping cursor.** System rows deliberately
  do not become `previous` (so they cannot split one person's turn in two), which
  meant a system row opening a day left the separator un-tracked and the next real
  message printed a second one. Day tracking is now its own variable.

  **Found in the browser, not in tests:** the member picker wrapped the DS
  `Checkbox` — itself a `<button>` — inside a `<button role="checkbox">`. Invalid
  HTML and a React hydration error. Replaced with a `<label>` around the checkbox,
  which gives the same full-row target and one tab stop without the nesting.

- 2026-09-04 — the message action bar was unreachable by any normal pointer
  movement, and the dialogs were rebuilt on the DS chrome.

  **The action bar had a dead band.** Parked at a fixed `-top-10`, the bar's
  bottom edge stopped ~2px clear of the bubble, and those pixels belong to the
  gap between rows rather than to the message. Moving the pointer up to press the
  button therefore left the row, which dropped `:hover`, which hid the bar — so
  the only way to click it was to cross the band fast enough to land on the bar
  in a single pointer sample. Measured in the browser by walking
  `elementFromPoint` up the path: under the old geometry y=258 and y=259
  hit-tested to the `<ol>`, not to the row; under the new one every pixel from
  248 to 262 belongs to the row.

  The fix splits the bar into a positioner and its chrome. The positioner is
  anchored `bottom-full` (bottom edge glued to the bubble's top), laps it with
  `-mb-px`, and carries the visual offset as `pb-1.5` — so the padding is a hit
  bridge and the box runs continuously from the chrome into the message. Because
  the box is a DOM descendant of the row, hovering the bridge keeps `:hover` on
  the row, so the bar stays up for as long as the pointer is heading towards it.
  Confirmed with a deliberately slow five-step cursor walk that opens the menu.

  **The dialogs were not on the house chrome.** The picker used `SearchInput`,
  whose default tone is `bg-surface-muted` and borderless — the filter-bar
  grammar — directly beneath a bordered `Input`, putting two kinds of field in
  one form. They now use the same `Input`-with-leading-glyph construction as
  `LinkEntityDialog`, the product's existing people picker, along with its round
  trailing selection indicator instead of a leading checkbox column. The dialogs
  also take `DialogContent size`, `DialogHeader leading` and `DialogFooter
  bordered` rather than hand-rolled `max-w-*` and unbordered footers over a
  scrolling body.

- 2026-09-04 — the reply quote redesigned to Google Chat's shape, and bounded to
  three lines.

  It was a one-line accent rule with muted text, which reads as the reply's first
  line rather than as a quotation. It is now the card Google uses on both
  surfaces — the sent bubble and the composer strip: a bordered `bg-surface`
  panel sitting on the bubble's own fill, a quote glyph, the author in bold, and
  the quoted text below. The composer strip adds the author's avatar, the way
  Google's does. Colours are Operis tokens throughout; only the structure is
  borrowed.

  **The bound is three RENDERED lines, so it lives in CSS.** Only the browser
  knows how many characters three lines holds at the reader's pane width, so
  `line-clamp-3` does the truncating and the server cap is a payload bound
  underneath it. That meant dropping `truncate` from the quote — it pins text to
  one line, and the clamp can never engage.

  Two things the server was doing wrong for this, both found by measuring the
  response rather than reading the code. `truncate()` ran the body through
  `buildMessagePreview` first, which caps at 200 and collapses newlines: raising
  `REPLY_PREVIEW_LENGTH` to 300 silently did nothing, and a two-line question was
  quoted as one line even though the card renders `whitespace-pre-wrap`. The
  quote now takes the message's own text, capped once, so it keeps its shape.

  Measured in the browser: a short quote renders one line and is not truncated; a
  300-character quote renders at exactly 48px against a 16px line height — three
  lines — with `scrollHeight` past `clientHeight`, so the ellipsis is the
  browser's own.

- 2026-09-04 — a pass over the module for clutter and dead ends. One real bug,
  one unreadable control, and three pieces of chrome that were doing nothing.

  **The read receipt disappeared from a space.** `lastOwnMessageId` walked back
  for the newest message whose sender was the viewer — but a membership event
  carries the ACTOR's id, so adding someone to a space made a system row the
  newest thing you had "sent". System rows render as a centred line with no
  receipt, so "Delivered / Read" silently vanished from the whole conversation
  until you typed again. Filtered to `kind === 'user'`; a regression test fails
  without it.

  **The member-avatar stack in the rail was unreadable.** Operis has no avatar
  images, so a stack of member faces was two or three sets of INITIALS
  overlapping inside 20px — smudged letters, not people. A space now wears one
  quiet group glyph in the same slot a direct uses for initials, which also
  removed `memberPreview` from the DTO and, with it, every member-name lookup the
  conversation list was doing for spaces.

  **Chrome that carried no information.** The date separator was a label flanked
  by two full-width hairlines — two rules across the pane for something already
  unique on the screen by being centred; the label now stands alone. Each system
  line was prefixed with its own clock, so three membership changes read as three
  timestamps before three facts; the time moved to the tooltip. The composer held
  a 58px row open around a 44px field for a single send button, in a product with
  no attachments, model picker or dictation to put beside it: the control moved
  onto the field's own line and the box went 102px → 78px.

  **Discoverability.** The space header opens the details panel and looked like
  plain text; it now carries a chevron. A direct has no details, so its header
  stays inert rather than growing an affordance that opens nothing.

  A separator now carries `data-row="separator"`. Its test used to count hairline
  spans, so decoration changes broke a test about counting separators.

- 2026-09-04 — end-to-end reverification. Three things it changed:

  **One component, not two.** The round selection mark existed twice — once in
  `LinkEntityDialog`, once in the chat member picker. It is now
  `@open-mercato/ui/primitives/selection-indicator`, used by both. It carries
  `role="checkbox"` when given a `label` (the entity linker, whose row is a
  `div`) and `aria-hidden` when not (the chat picker, whose row is already a
  `<button role="checkbox">`) — a second checkbox inside the first would
  announce one option twice with two conflicting states.

  **A 2px misalignment in the composer.** `items-end` bottom-aligned a 32px
  counter against a 28px send button, so their optical centres sat 2px apart.
  `items-center` and a matched row height; measured spread is now 0.00px.

  **A guard I had missed.** Adding a primitive trips
  `gallery-coverage.test.ts`, which requires every file in `ui/src/primitives`
  to have either a gallery entry or an allowlisted reason. I had checked
  `inventory-parity` and wrongly concluded a new primitive was free. Allowlisted
  as a sub-primitive, alongside `label.tsx` and `close-button.tsx`, which are
  the same shape of thing.

  Alignment audited by measuring optical centres rather than by eye: 53
  icon/avatar-to-text pairings across the rail, transcript, reply cards and
  dialogs, 0 misaligned. Flows driven through the real UI as the seeded users:
  create → send → reply → rename → add → remove → last-owner refusal, then
  checked from three other accounts — a member sees the space with the right
  unread and role, a removed member cannot see it at all, an added member reads
  the history that predates them and their reply reference resolves, and another
  organization's directory returns only its own people.

- 2026-09-04 — production-hardening pass. Four defects, all found by exercising
  the running application rather than by reading the code.

  **Concurrent adds returned 500.** Two owners pressing "Add" on the same person
  both saw them missing and both inserted; `chat_participants_conversation_user_uq`
  rejected the loser and the 23505 surfaced unhandled. Measured with six parallel
  adds: the membership stayed correct at one row while several callers got a
  server error. The command now re-reads and seats whatever is genuinely still
  missing, and treats a second violation as the other writer having finished the
  job. Re-measured: sixteen parallel adds, all 200, one row each.

  **A double-click sent the message twice.** `setValue('')` lands on the next
  render, so several clicks in one tick all read the same draft and each called
  `onSend` — and since every send mints its own idempotency key, the server
  stored each one. Measured: a triple click posted three copies. The draft is now
  tracked in a ref that clears synchronously, so extra clicks see an empty box
  while typing something new re-arms it immediately. Disabling the button instead
  would have blocked the legitimate case of sending two lines quickly.

  **Reading a conversation refetched it.** `chat.conversation.read` is emitted to
  the reader's own sessions so their other tabs can clear the badge, and it came
  back to the tab that caused it, where the live-refresh hook invalidated the
  whole chat key space — so opening a conversation refetched the messages it had
  just loaded. A read can only move a badge, so it now refreshes the two surfaces
  that show one. Cold load went from 17 requests to 11 in production; idle
  traffic is zero, so nothing polls.

  **Dialogs dropped keyboard focus on `<body>`.** Both are reached through a
  dropdown, and choosing an item unmounts the menu — so the element Radix would
  restore to no longer exists by the time the dialog closes. The rail's create
  control now carries a stable handle and the shell restores focus to it.

  Also: the conversation header stopped asserting a member count while the
  conversation can no longer be read — a failed refetch keeps the cached copy, so
  a stale "2 members" sat directly above "Couldn't open this conversation".

  Verified live and not by inference: eviction while the page is open (the view
  transitions itself to the access-lost state, the post-eviction message never
  reaches the DOM, the composer disappears, the space leaves the rail); reply
  state cleared across a conversation switch while a cancel keeps the draft; a
  space name carrying markup rendered as text with zero injected nodes; a
  superadmin scoped outside their organization reaching nothing; the full
  four-user scenario end to end; and no horizontal overflow at 1920, 1024, 768
  and 375.
