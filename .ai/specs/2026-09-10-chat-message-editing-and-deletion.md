# Chat Message Editing and Deletion

Status: implemented
Phase: 3 of the chat module (phase 1: `.ai/specs/2026-09-03-chat-direct-messaging.md`,
phase 2: `.ai/specs/2026-09-04-chat-spaces-and-replies.md`)

## TLDR

A message can now be rewritten by its author and removed by its author or, in a
space, by an owner. One new nullable column (`chat_messages.edited_at`), two new
commands, one new route file carrying `PATCH` and `DELETE`, and a composer that
doubles as an editor. Deletion reuses the `deleted_at` column the schema has
carried since phase 1 and that every read path already filters on.

## Problem Statement

Chat shipped without either verb. A typo stood forever, and a message sent to the
wrong space could not be taken back — the only remedy was a follow-up message
asking readers to ignore the previous one. Every other chat product the module is
measured against has both, and their absence was the most conspicuous gap in a
module that otherwise matches them.

The schema was already half-prepared for one of the two. `chat_messages` has had
`deleted_at` since phase 1; `chatService.listMessages` filters `deletedAt: null`;
`lib/replies.ts` renders a quote of a deleted message as "Original message
unavailable"; the link and search queries join on `m.deleted_at is null`. Nothing
ever set the column. Editing had no such preparation.

## Proposed Solution

### Permissions, and why the two verbs differ

| | Author | Space owner | Other member |
|---|---|---|---|
| Edit | ✅ | ❌ | ❌ |
| Delete | ✅ | ✅ | ❌ |

**Editing is the author and nobody else.** Rewriting somebody's words puts
sentences in their mouth under their name, and there is no role that should be
able to do that — not a space owner, and not the other person in a direct.

**Deleting is wider because it is moderation.** Removing a message from a shared
room is the same class of decision as renaming the space, changing who is in it,
or pinning something to the top, and the module already has owners for exactly
that (`requirePinPermission` is the precedent). A direct conversation has no
owner and only two people, so there only the author may delete.

System rows (`kind: 'system'`) are neither editable nor deletable. They are the
transcript's record of what happened to the conversation, not something anybody
typed.

### An edit rebuilds everything derived from the body

Four things are derived from a message body, and all four are rebuilt inside the
same transaction as the new text:

| Derived | Why it cannot be left alone |
|---|---|
| `search_body` | The message would stay findable by words it no longer contains |
| `chat_message_mentions` + `mentions_everyone` | Re-validated against the conversation exactly as a send validates them. Skipping the check would make editing the way to mention somebody a send refuses, or to address `@everyone` in a direct |
| `chat_message_links` | The Shared panel would keep offering a URL that was taken out, and miss one that was put in |
| `chat_conversations.last_message_preview` | Only when this is the message the list is showing. `last_message_at` is deliberately NOT touched: an edit does not change when the message was written, so it must not reorder the list |

Attachments are untouched. They are separate rows with their own scan lifecycle,
and swapping them under an existing message would strand the originals — which is
also why the validator refuses an empty body on an edit while allowing one on a
send.

The translation cache needs no invalidation. Its rows are keyed by a hash of the
source text (`sourceHash(normalizeText(body))`), so an edited message misses the
cache and is translated afresh, and the write path re-checks the live body's hash
before storing.

### A delete is a soft delete, plus two things the column cannot do

`deleted_at` alone removes the message from the transcript, from search, from the
unread mention predicate and from the Shared panel's links — every one of those
queries already filters it. Two pieces of bookkeeping remain:

- **Pins to the message are removed.** `listPinned` already hides a pin whose
  message is deleted, but `countPinnedPerConversation` is a plain `count(*)` and
  would go on including it, so the header badge would be permanently wrong.
- **The conversation's last-message columns are repointed** at whatever is now
  newest, `last_message_at` included, so the list cannot advertise activity a
  reader cannot find. With nothing left, they fall back to the conversation's own
  `created_at` with a null preview and sender.

Replies to a deleted message keep their reference and render as "Original message
unavailable" — that behaviour already existed and needed no change.

## Data Models

One nullable column:

```sql
alter table "chat_messages" add "edited_at" timestamptz null;
```

**Deliberately not `updated_at`.** That column carries an `onUpdate` hook that
fires on every flush touching the row — a reaction, a pin, a search-document
backfill — so it answers "was this row written to", which is a different question
from "did a person change these words". Only the edit command writes `edited_at`,
which is what makes the "(edited)" marker honest.

No backfill and no default: every message that exists today was never edited, and
null says exactly that.

## API Contracts

One new route file, `api/conversations/[id]/messages/[messageId]/route.ts`, both
methods behind `chat.send` and metered on the send rate-limit bucket (the same
bucket reactions and pins use).

| Method | Body | Response | Refusals |
|---|---|---|---|
| `PATCH` | `{ body: string }` | `{ messageId, body, editedAt }` | 403 not the author · 400 empty body, system message, or a mention the conversation does not allow · 404 no such message, or a conversation the caller is not in |
| `DELETE` | — | `{ messageId, deletedAt }` | 403 not the author and not a space owner · 400 system message · 404 as above |

`ChatMessageDto` gains `editedAt: string | null`, carried by every read path.

Deleting something already deleted converges rather than erroring — a space owner
and the author may press it at the same moment — and does not mirror or emit a
second time. The lookup opts into `includeDeleted`, which relaxes the liveness
filter and **nothing else**: scope, conversation and membership are checked
identically, and the author-or-owner permission still runs on the deleted row.
Every other caller of that guard keeps the strict default, because reacting to,
pinning or rewriting a message that is gone is a real 404.

Two new events, both `clientBroadcast: true`: `chat.message.edited` and
`chat.message.deleted`. The client's `useChatLiveRefresh` subscribes to `chat.*`
and puts anything it does not specifically narrow on the wide refresh path, so
both are handled without a client change: correct, because either can move the
conversation list's preview and a delete can clear an unread mention.

## Transport Mirroring

`ChatTransport` gains `publishEdit` and `publishDeletion`, with
`publishEditSafely` / `publishDeletionSafely` wrappers. Both are best-effort in
**both** modes — like reactions, unlike a message.

The asymmetry is about which system can lose something. A send that Matrix
refuses in `authoritative` mode must not commit, because a row would then exist
for a message the stream has never carried. An edit has no such hole: the body
lives in `chat_messages` whichever system owns the stream, the message is already
published, and nothing inbound turns a Matrix edit back into an Operis one.

In the Matrix transport an edit is an `m.replace` carrying `m.new_content` plus
the conventional `* ` fallback body, and a deletion is a redaction of the
original event **as the actor** — the author may always redact their own event,
and a space owner sits at power level 50, which is the room's `redact` level, so
the homeserver enforces the same rule Operis does.

**The edit transaction id is derived from the message id AND `edited_at`.** This
is the reaction-transaction-id bug in a different costume: keyed on the message
alone, a second edit would carry the first one's transaction id, the homeserver
would return the first edit's event, and every edit after the first would be a
permanent no-op that looks like a success. A redaction keys on the event id
alone, because a message is deleted once.

## Frontend

| Piece | Change |
|---|---|
| `MessageList` | `onEdit` / `onDelete` props and a `canModerate` flag; the per-row gate is `row.mine` for edit, `row.mine \|\| canModerate` for delete. Delete is last in the menu and `destructive` |
| `MessageList` | An "(edited)" line rendered as a **sibling** of `MessageBody`, never inside it — appending it to the body would shift the mention-token offsets and the search-highlight ranges |
| `MessageComposer` | `editTarget` / `onSubmitEdit` / `onCancelEdit`. Prefills, focuses, saves on Enter, cancels on Escape, hides the attach control, and stashes the in-progress draft on the way in so a misclick does not destroy it |
| `ConversationView` | Owns `editTarget`, clears it on a conversation switch alongside `replyTarget`, and holds the confirm dialog for deletion (`onConfirm`, so a double confirmation is impossible on a slow connection) |
| `hooks.ts` | `useMessageEngagement` gains `editMessage` / `deleteMessage`, both on the wide invalidation path rather than the narrow `settled` one that reactions and pins use |
| i18n | 12 keys across all 8 locales |

### The projector must skip `m.replace`

Found by running `matrix:verify:transport` after the mirroring landed: the two
edit events it produced appeared in the inbound `/sync` batch, and the projector
recognised them only by the `om.origin` marker — reporting them, misleadingly, as
sends that failed to commit. An `m.replace` from any other sender (an engineer
editing in Element, a bridge later) had no such marker and would have been
projected as a **brand-new chat message** carrying the `* corrected text`
fallback.

`isReplacement()` was added to `@open-mercato/matrix` and the projector now skips
on it, ahead of the orphan check so an Operis edit is reported as an edit. It
keys on `rel_type` alone rather than through the existing `replacement()`
accessor, because a malformed edit — one with no `m.new_content` — is still an
edit and still not a message.

## Known limitation

**Editing a message to add a mention does not notify the person named**, if they
had already read past it. The unread predicate in `lib/messageExtras.ts` anchors
on `chat_messages.created_at` — `m.created_at > coalesce(p.last_read_at, ...)`
and `m.created_at >= p.created_at` — so a message the reader has already passed
stays read no matter what its mention rows say afterwards. The mention row is
written with the edit's timestamp and the mention renders correctly in the
transcript; only the badge is unaffected.

This was left as it is rather than fixed here. Changing it means changing the
module's core unread SQL, whose two `created_at` clauses each carry a deliberate
guarantee (the second is what stops a newly added space member inheriting every
`@everyone` ever sent there). That is a separate change with its own blast
radius, not a detail of this one.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| An edit stores a mention a send would refuse | High — a stranger's client would be made to fetch a conversation | The edit command runs the identical validation: participants, active organization members, `@everyone` only in a space | None |
| Derived rows drift from the body | Medium — a message findable by words it no longer contains | Mentions, links, `search_body` and the preview are rebuilt in the same transaction as the text | None |
| The header pin count outlives the pinned message | Medium — a badge that can never be cleared | The pin row is deleted with the message | None |
| A deleted latest message leaves the list advertising it | Medium | `repointConversation` moves preview, sender and `last_message_at` to what is now newest | None |
| A failed redaction leaves Matrix holding a deleted message | Low — a retention question, not a consistency one | Logged; the mapping row is kept so a reconciliation can find the event. The drift check does not see it (`m.deleted_at is null`) | Accepted for internal rooms nothing else reads |
| An edit races a concurrent delete | Low | The transaction re-reads the message under the full scope with `deletedAt: null` and raises 404; a delete losing the same race converges | None |
| `includeDeleted` widens what a caller can reach | Medium if wrong — it is on the guard four commands stand on | It relaxes only the `deleted_at` clause; tenant, organization, conversation and participation are unchanged, and `__tests__/messageGuard.test.ts` asserts all three still refuse under the opt-in | None |
| Losing an in-progress draft by clicking Edit | Low | The composer stashes it and restores it when edit mode ends, saved or abandoned | None |

## Coverage

Integration tests ship with the change:

| Spec | Covers |
|---|---|
| `TC-CHAT-010-edit-and-delete` | the author's edit visible to the whole space; `editedAt` null before and set after; the search document rebuilt (old wording stops matching, new wording starts); the link index rebuilt; a non-author refused with 403 and the body unchanged; an emptied body refused; a member refused deletion of somebody else's message; the author's own deletion removing it from the transcript; the reply surviving as unavailable; the pin count following; the preview repointed; a second delete converging; a space owner moderating |

Unit coverage: `chat/__tests__/messageGuard.test.ts` (the guard four commands
stand on: cross-conversation, non-participant and cross-tenant ids all refused,
with and without the deletion opt-in), `chat/__tests__/transport.test.ts` (the local no-ops and both
safe wrappers, including best-effort under `authoritative`),
`chat_matrix/__tests__/matrixTransport.test.ts` (the `m.replace` shape, the `* `
fallback, sending as the author, a different transaction id per edit and the same
one for a retry, redaction as the actor, the mapping row kept, and both no-op
paths), `chat/__tests__/validators.test.ts` (`chatEditMessageSchema`),
`chat/__tests__/MessageComposer.test.tsx` (prefill, save-not-send, empty refused,
unchanged treated as cancel, Escape, draft stash/restore, attach hidden),
`chat/__tests__/MessageList.test.tsx` (the per-row permission matrix and the
"(edited)" marker).

## Changelog

- 2026-09-10 — written alongside the implementation, and implemented. Notes worth
  keeping:

  **`edited_at` had to be its own column.** Reusing `updated_at` was the obvious
  first move and is wrong for a reason that is invisible until it ships: its
  `onUpdate` hook fires on every flush that touches the row, so a message would
  start claiming to be edited because somebody reacted to it.

  **The edit transaction id is the reaction bug again.** The previous session
  found that a deterministic reaction transaction id made re-reacting a permanent
  no-op, because the tuple it was derived from did not change between attempts.
  An edit has exactly the same shape — `(message)` is constant across edits — and
  the fix is the same in spirit but different in kind: rather than going random,
  the id folds in `edited_at`, which is unique per edit and stable per retry. A
  regression test asserts both halves.

  **`repointConversation` must flush before it reads.** The delete path sets
  `deleted_at`, then asks for the newest live message. Without the intervening
  flush the query hands back the message being deleted and the preview keeps
  pointing at text nobody can see.

  **A second delete 404'd instead of converging**, and only the integration
  suite found it. The convergence branch inside the transaction was written and
  looked right, but `requireMessageInConversation` filters `deleted_at is null`,
  so the outer guard raised 404 first and that branch was unreachable in the
  common case. Fixed with an explicit `includeDeleted` opt-in on the guard rather
  than by loosening it for everyone, and pinned by a unit test so the next
  regression costs two seconds rather than a five-minute Playwright run.

  **The projector had a hole this feature opened.** See "The projector must skip
  `m.replace`" above — caught by the real-homeserver check, not by any unit test,
  because the fakes had no reason to produce an edit event.

  **`requireMessageInConversation` moved** from `commands/engagement.ts` to
  `commands/shared.ts`. Four commands now need it — react, pin, edit, delete —
  and it is the check that stops a forged message id from another space being
  acted on. Duplicating it was not an option: for reactions and pins a composite
  foreign key is the backstop, but an edit writes to `chat_messages` itself,
  where no constraint would catch it.
