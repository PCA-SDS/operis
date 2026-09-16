# Chat ↔ Tasks integration

Status: implemented
Module: `chat_tasks` (`requires: ['chat', 'tasks']`)
Related: [`2026-09-03-chat-direct-messaging.md`](2026-09-03-chat-direct-messaging.md),
[`2026-09-04-chat-spaces-and-replies.md`](2026-09-04-chat-spaces-and-replies.md),
[`2026-08-24-tasks-module-pca-parity.md`](2026-08-24-tasks-module-pca-parity.md)

## TLDR

Turn a sentence in a conversation into a real task without leaving the conversation, and
without either module learning anything about the other.

Type `/task Prepare the proposal by tomorrow 3pm p1` in a direct conversation, review the
resolved assignee, project, date and priority, and submit: the tasks module creates the
task, and a card appears in the transcript that resolves **per viewer** through an
authorized task read. Tasks is the only source of truth. There is no second task engine,
no LLM, no external service, and no new permission to grant — every gate applied is one
`chat` or `tasks` already owns.

The integration lives in a third module, `chat_tasks`, which owns exactly one thing: the
link between a conversation and a task. Neither `chat` nor `tasks` imports it. Disabling
it leaves both working and leaves two unreferenced tables behind.

## Problem statement

Work is decided in conversations and tracked in tasks, and today the two are joined by a
person retyping. That costs the obvious thing — the retyping — and three less obvious ones:

1. **The assignee is already known and gets asked for anyway.** A direct conversation has
   exactly two people in it. "Can you prepare the proposal?" has one possible owner.
2. **The link back is lost.** A task says "prepare the proposal"; the conversation says
   which proposal, for whom, and at what margin. Nothing connects them, so the context is
   found by searching chat for words somebody half-remembers.
3. **The naïve fix leaks.** Copying the message into the task moves confidential text from
   a two-person conversation into a record every colleague with `tasks.view` can read, and
   nothing about the copy says that happened.

The third is the reason this is a spec rather than a patch. A chat conversation and a task
have **genuinely different audiences**, and any join between them is a place where one
audience can be silently widened to the other.

## Proposed solution

### The shape: a third module

`chat` must not import `chat_tasks`, because chat has to work with the integration absent
or disabled. `chat_tasks` must not be inside `tasks`, because a task's rules cannot depend
on a conversation. So the integration is its own module that depends on both, and the
coupling runs one way: `chat_tasks → {chat, tasks}`.

Chat gains **six extension points** (`chat/extension-points.ts`) and nothing else
integration-shaped:

| Spot | Filled by |
|---|---|
| `chat:composer:commands` | the `/task`, `/mytasks`, `/tasks` entries |
| `chat:message:actions` | "Create task" on a message |
| `chat:message:card` | the card a `systemEvent: 'card'` row renders |
| `chat:conversation-panel:sections` | the "Tasks" tab |
| `chat:conversation-panel:section` | that tab's contents |
| `chat:conversation:overlays` | the always-mounted composer drawer |

With `chat_tasks` disabled every spot is empty, the composer knows no commands, the panel
grows no tab, and `MessageList` falls back to `chat.cards.unavailable` for any card row
left behind.

`tasks` gains nothing integration-specific at all. It gained two things that are
improvements in their own right — see § Changes to existing modules.

### The visibility model

Three statements, and everything else follows:

1. **Chat access never grants task access. Task access never grants chat access.** Both
   are proved, separately, for the caller, on every read and every write.
2. **A card stores no task data.** It is a pointer resolved per viewer.
3. **A link stores no message text.** It stores a message *id*.

The consequence worth stating plainly: two people looking at the same card in the same
conversation legitimately see different things. A participant with `tasks.view` sees the
reference, title, status, assignee, due date and priority. A participant without it sees
"A task is linked here that you can't see" — no title, no reference, **not even the task
id**, and nothing in a tooltip, an `aria-label`, a preview, the search index or a
notification that says otherwise.

The reverse direction is the same rule pointed the other way. A task's detail panel can
show where it came from, but only after `chat_tasks` independently re-checks that *this*
viewer is currently a participant of *that* conversation. If they are not, the source is
**omitted entirely** — not greyed out, not "1 hidden source", because the existence of a
conversation is itself information about who is talking to whom.

### Slash commands

`chat/lib/slashCommands.ts` is pure, isomorphic and deliberately strict. `COMMAND_TOKEN`
is `^\/([a-zA-Z0-9_-]*)$` against the text before the caret, so:

- `/task Prepare the proposal` — a command.
- `https://example.com/task` — text.
- `` `cd /tasks` ``, `"/task"`, `see /tasks in the docs` — text.
- `/nonsense` — **not** a command, **not** sent as a message, and **not** discarded: the
  composer says the command is unknown, keeps what was typed, and mutates nothing.

The menu is a listbox: `aria-controls` / `aria-activedescendant` on the textarea, arrows
to move, Enter or Tab to choose, Escape to dismiss, and every entry clickable and
tappable. `event.isComposing` is checked before the menu sees a key, because while an IME
is mid-word Enter belongs to the IME.

Three commands, all resolved server-side:

| Command | Opens |
|---|---|
| `/task [quick-add text]` | the composer drawer, pre-parsed |
| `/mytasks` | the personal workspace |
| `/tasks` | the conversation's Tasks panel |

The quick-add text goes through the **tasks module's own parser**, client-side for
instant feedback and then `POST /api/tasks/quick-add/parse` as the authority. What the
server returns is what the drawer shows and what gets stored — including its structured
warnings, rendered through tasks' own `useQuickAddWarning`. The composer never evaluates
command input, never interpolates it into SQL, and never treats it as anything but a
string to parse.

### Assignment by conversation kind

`chatTaskAssignmentService.composerContext` resolves this from **server-verified
membership**, never from a client-supplied counterpart id:

| Kind | Default assignee |
|---|---|
| `direct` | the other participant, if still an active member of the organization |
| `space` | **none** — `requiresExplicitAssignee: true`, with participants offered as suggestions |
| workspace | the caller |

A space refuses a create with no assignee (400) rather than picking a participant, and
`@everyone` is never expanded into a list of assignees: a task addressed to a room is a
task nobody owns. A direct whose counterpart has left the organization returns
`defaultAssigneeBlockedReason` so the drawer can say why instead of failing silently.

Two things this does **not** do: conversation membership is not evidence that somebody may
be assigned work (`tasks.assign` plus the module's own eligible-target check decides
that), and nobody is ever added to a conversation as a side effect of being assigned a
task.

### Creating a task from a message

"Create task" appears in a message's own menu, on messages the viewer can read. It
**copies nothing**: not the text, not the author's name, not the conversation title, not
replies, not attachments. The drawer opens with empty fields, a `Linked, not copied`
note, and — from the first frame, before anything is typed — the sentence that this task
will not be private to the conversation.

"Copy the message text into the description" is an explicit control. Ticking it reveals
the exact text that will be stored, beside the words "readable by anyone with task
access", **before** submission. The source reference is kept separate from the task's
broadly visible fields either way, later edits to the message are not synced into the
task, and attachments are never copied.

At submission the source is re-checked: still a message in this conversation, still
readable by this caller, still not deleted.

### The personal workspace

`/backend/chat/workspace` is an **isolated surface, not a conversation**. There is no
`chat_conversations` row, no participant list and no `direct_key`. The workspace *is* the
`(user, tenant, organization)` triple.

That choice is the whole design. A "conversation with yourself" would need either a
duplicate participant row or a relaxed "a direct has exactly two people" invariant —
`chat_conversations_kind_shape_chk` and `chat_conversations_direct_uq` both exist to make
that impossible, and weakening either to gain a self-chat would weaken it for every real
conversation. With no row: one workspace per person is true by construction, nothing
races, nothing exists for another employee or an administrator to read, no self-mention
notification can fire, no unread can accumulate, and the Matrix transport has nothing to
provision.

It is **not** a private task list, and the composer says so rather than implying
otherwise: *"This workspace is private. The tasks you create here are not — they follow
the same task permissions as any other task."* `/mytasks` and the workspace list both
delegate to the tasks module's own `assigned` view, so role-resolved assignment behaves
here exactly as on the Tasks screens.

### Cards

A card is a `chat_messages` row with `kind: 'system'`, `systemEvent: 'card'` and an
**empty body**, appended by the new `chat.messages.appendCard`.

Every part of that is load-bearing:

- **Empty body** — nothing task-shaped can reach `search_body`, the conversation preview,
  the translation cache, or an outbound Matrix event. The rendered card comes from an
  authorized read at display time instead.
- **`system`, not `user`** — already excluded from the unread predicate, so raising a task
  does not manufacture unread activity for the other person; already not editable, so a
  card cannot be rewritten to point somewhere else.
- **Never a snapshot** — a stored copy of the title and status would go stale on the first
  task edit and would escape the per-viewer permission check.

The card renders reference, title, status, assignee, due date, priority, **Open task**,
and complete/reopen for a viewer with `tasks.edit`. Completing a **recurring** task
advances its occurrence and resets it to pending; the card shows the state the tasks
module actually produced rather than assuming "completed".

### The conversation Tasks panel

A section in chat's existing side panel, through the existing panel infrastructure and
its existing resize behaviour. It lists **only explicitly linked tasks the viewer can
read** — never anything inferred from a shared assignee, a shared project or a text match
— with a cursor-paged list, status and assignment filters, and counts that include only
authorized results.

Its responsive breakpoints measure `data-chat-tasks-panel` with a `ResizeObserver`, not
the window: the panel is a resizable column inside a shell, and a window-width media
query renders the wide layout in a narrow panel on a large screen.

## Architecture

### Modules and dependencies

```
chat_tasks ──requires──▶ chat
     │
     └────requires──▶ tasks
```

`chat` and `tasks` have no import of `chat_tasks` anywhere, asserted by
`tasks/__tests__/moduleGating.test.ts` (which reads each module's `requires` from its own
`index.ts`) and by `chat_tasks/__tests__/moduleContract.test.ts`.

### Data model

Two new tables. **No change to any `chat_*` or `tasks_*` table**, and no cross-module ORM
relation or foreign key — every reference is a plain scoped uuid, so neither module's rows
can be blocked from deletion by this one.

`chat_task_links`

| Column | Notes |
|---|---|
| `id`, `tenant_id`, `organization_id` | scope, on every query |
| `conversation_id` | plain uuid |
| `task_id` | plain uuid |
| `source_message_id` | nullable — set when raised from a message |
| `card_message_id` | nullable — set once the card is published |
| `created_by_user_id`, `created_at`, `updated_at`, `deleted_at` | soft delete |

`chat_task_requests` — the idempotency ledger

| Column | Notes |
|---|---|
| `actor_user_id`, `idempotency_key` | unique together, within scope |
| `request_hash` | canonical hash of the request payload |
| `status` | `pending` / `completed` / `failed` |
| `conversation_id`, `task_id`, `link_id`, `failure_reason` | the result to replay |

Four constraints carry guarantees the application cannot make alone:

- **`chat_task_links_scope_uq`** — partial unique on `(tenant, org, conversation, task)
  where deleted_at is null`. Two simultaneous links converge on one row instead of
  stacking two cards for one task; unlinking and linking again is still allowed.
- **`chat_task_links_card_uq`** — partial unique on `card_message_id`, so a republish
  after a partial failure cannot point two links at one message.
- **`chat_task_requests_key_uq`** — unique on `(tenant, org, actor, idempotency_key)`.
  **Scoped to the actor**, so one person's retry can never replay another's result.
- **`chat_task_requests_status_check`** — the status vocabulary, which is written into
  rows.

Migration: `chat_tasks/migrations/Migration20260914052553_chat_tasks.ts` plus its
snapshot. It creates two tables and touches nothing else.

### The coordinated create

Creating a task, recording the link and publishing the card **cannot share one
transaction**, and the reason is specific: `tasks.tasks.create` takes a row lock on its
project to mint the next `PROJ-n` reference, and emits its assignment notification on
commit. Wrapping it in an outer transaction would hold that lock for the whole operation
and — worse — could announce "you have been assigned a task" from inside a transaction
that then rolls back.

So the operation is made **safe to repeat** instead of atomic:

```
A  claim the idempotency key        own transaction; the unique index is the mutex
B  tasks.tasks.create               its own transaction, its own lock, its own events
C  record the link                  own transaction; the ledger completes with it
D  chat.messages.appendCard         then record which message it is
```

| Same key, … | Result |
|---|---|
| same payload, `completed` | the original result with `replayed: true`, **after** re-checking access |
| different payload | `409 idempotency_key_reuse` |
| first attempt still `pending` | `409 request_in_progress` — never a second task |
| first attempt `failed` | retryable; nothing was created |

**A failure between B and D is a partial success and is reported as one.** The response
carries the real `taskId` with `cardPublished: false`; the UI says the task was created,
offers **Open task**, and offers a retry that republishes the card — `POST
/api/chat_tasks/links/{linkId}/card` — without ever re-running the create. The task is
**never** deleted as compensation: it exists, it may already be assigned, and somebody may
already own it.

Realtime is published only after the durable write. A card row is committed before
`chat.message.sent` mentions it.

### Per-viewer authorization

`chatTaskService.hydrateTasks` is the single funnel. It short-circuits when the caller
lacks `tasks.view` (so a chat-only member costs one RBAC check, not a task query per
card), batches the authorized read for a page of cards into one call, and returns
`{ available: false, task: null }` for anything the caller may not read. The shape is
all-or-nothing so it cannot be half-populated by a later edit.

For creation the server independently verifies, in order: identity; tenant and active
organization; module entitlements; the chat grant **and** current membership of this
conversation; `tasks.view` / `tasks.create`; assignment permission and eligible targets;
that the project and labels are valid and in scope; and — when present — that the source
message belongs to this conversation, is readable, and still exists. Scope and actor come
from the authenticated server context; a client-supplied tenant, organization,
counterpart id or permission flag is never read.

### Route gates

Route `requireFeatures` is the coarse gate; per-record membership and readability are
checked inside.

| Route | GET | Write |
|---|---|---|
| `conversations/[id]/composer` | `chat.view`, `tasks.view` | — |
| `conversations/[id]/cards` | `chat.view` | — |
| `conversations/[id]/tasks` | `chat.view` | POST `chat.send`, `tasks.create` |
| `conversations/[id]/links` | — | POST `chat.send`, `tasks.view` |
| `links/[linkId]` | `chat.view` | DELETE `chat.view`, `tasks.view` |
| `links/[linkId]/card` | — | POST `chat.send`, `tasks.view` |
| `tasks/[taskId]/sources` | `chat.view`, `tasks.view` | — |
| `workspace/tasks` | `tasks.view` | POST `tasks.create` |

Three GETs take `chat.view` alone, deliberately: their job for a member without task
access is to return the unavailable state, and a route-level `tasks.view` would refuse the
request instead — a 403 mid-transcript renders as a broken row, not as an unavailable
card. `moduleContract.test.ts` pins the exemption to exactly those three and requires
every other route, and every write in those same files, to name a grant from both modules.

`chat.send` is required to **publish** a card, because that writes to a conversation.
`/mytasks` and the workspace deliberately do **not** require it: reading your own task
list is not sending a message.

### Commands

| Command | Does |
|---|---|
| `chat_tasks.links.createTask` | the four-phase create above |
| `chat_tasks.links.linkExisting` | links an already-authorized task |
| `chat_tasks.cards.publish` | publishes or republishes a link's card |
| `chat_tasks.links.unlink` | soft-deletes the link, removes the card row |
| `chat.messages.appendCard` | appends a card row (new, in `chat`) |
| `chat.messages.removeCard` | removes one (new, in `chat`) |

Unlinking, deleting a card and deleting a task are three separate acts. Nothing cascades,
and no foreign key exists for one to travel down.

Task updates from a card carry `OPTIMISTIC_LOCK_HEADER_NAME`, so a stale card cannot
overwrite a newer edit and a retried completion cannot advance a recurring task twice.

## Realtime, notifications and Matrix

**Chat frames** stay recipient-scoped and body-free: `chat.message.sent` with
`card: true`, addressed to `recipientUserIds` derived from live participant rows, carrying
no task fields. Clients refetch over the authorized route.

**Tasks events are broadcast far more widely**, so nothing chat-shaped goes into one. No
conversation id, no message id, no link id, no participant list, no excerpt — an
identifier alone would reveal that two particular people are discussing something.
`moduleContract.test.ts` asserts this about the module's event payloads.

**Notifications** reuse the tasks module's existing assignment notification. No second
chat notification is emitted for the same assignment, and no new notification type is
introduced. Mute and unread keep their existing meaning: a card is a system row, so it
bumps `last_message_at` without counting toward unread. There are no due-date reminders
and no automatic task-update messages posted into conversations.

**Matrix.** Slash commands are **never** executed from inbound Matrix messages, quoted
text, edits or replayed events: commands exist only in the composer, behind an explicit
authenticated application action, and the projector's path into `chat.messages.send`
carries `externalOrigin` and never touches command parsing. Personal workspaces are local
and are never provisioned as rooms. A card row has an empty body, so there is nothing for
the outbound serializer, a backfill or an attachment path to flatten into plaintext — the
protection is structural rather than a filter that a future serializer could forget. Task
information is never protected by Matrix room membership; it is protected by the task
read. Ordinary chat behaviour is unchanged in `local`, `shadow` and `authoritative` modes.

## Changes to existing modules

Deliberately small, and each one a seam rather than a special case.

**`chat`**

- `extension-points.ts` — the six hosts above.
- `commands/cards.ts` — `appendCard` / `removeCard`. Not a second send path: no mentions,
  no links, no attachments, no reply target, no publish.
- `ChatSystemEvent` gains `'card'` — a text column, so no migration.
- `MessageComposer` gains a command menu; `MessageList` a card row and injected message
  actions; `ConversationView` the panel sections and the overlay mount.
- Three new translation keys in all eight locales.

**`tasks`**

- `tasks.tasks.complete` and `.reopen` gain `enforceCommandOptimisticLockWithGuards`.
  Additive and a no-op without the header. This is the protection against a retried
  completion advancing a recurring task's occurrence twice, and it was missing: the
  assumption that every existing command already had optimistic locking was wrong.
- `?task=<id>` on the tasks personal views opens the existing `TaskPanel`. The tasks
  module had no deep link to a task at all. A query parameter on a route it already
  serves, never a new route — `/backend/tasks` and `/backend/tasks/{id}` belong to
  `workflows` and are untouched.
- `TaskPanel` falls back to the task's own `projectId` when rendered without one.

## Risks and impact review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| A card leaks a task title to a chat member without task access | High | No task data is stored in the card; per-viewer hydration; the unavailable shape omits the id too | TC-CHATTASKS-002 asserts the unavailable state and that no title appears in any field |
| A task's source reveals a conversation to someone not in it | High | `sourcesForTask` re-checks chat membership per link and omits non-members' links entirely | Covered; the count is computed after filtering |
| Task titles reach chat search, previews, translation or Matrix | High | The card body is empty by construction, not filtered | Structural |
| A double-click creates two tasks | Medium | Server-enforced idempotency key scoped to actor + scope, with payload hash | Converges; a concurrent first attempt gets `request_in_progress` |
| A retried completion advances a recurring task twice | Medium | Optimistic lock on `tasks.tasks.complete` | Second attempt gets 409 |
| The card fails to publish after the task is created | Medium | Reported as partial success with a retry that never re-creates | A crash between B and C leaves a `pending` ledger row and a visible orphan task — refused rather than duplicated, and linkable by hand |
| Membership revoked mid-operation | Medium | Access re-validated inside the mutation and before returning a replay | Concurrent removal loses the write, not the data |
| Chat grants become a path to task data | High | Both proved separately on every read and write; no admin bypass; project membership is never treated as an ACL | `moduleContract.test.ts` pins the gates |
| External/portal users reach Tasks | High | Portal identity resolves no employee grants; the boundary is fail-closed | Unchanged by this module |
| Disabling the module blocks chat or task deletion | Medium | No cross-module FK; plain uuids | Orphan links are ignored by every read |

## Coverage

**Unit** — `chat/__tests__/`: `slashCommands`, `MessageComposerCommands`,
`MessageListInjectedActions`. `chat_tasks/__tests__/`: `chatTaskService`, `assignment`,
`idempotency`, `moduleContract`, `ChatTaskCard`, `ChatTaskComposerSource`.

**Integration** — `chat_tasks/__integration__/`, each with
`integrationMeta.dependsOnModules = ['chat', 'tasks', 'chat_tasks']`:

| Case | Asserts |
|---|---|
| TC-CHATTASKS-001 | creation from a direct (assignee defaulted) and a space (refused without one); the real task; the empty-bodied card row; both participants' authorized reads; the quick-add round trip |
| TC-CHATTASKS-002 | non-member 404 including an administrator; chat member without task access gets the unavailable card; sources omitted for a non-member; no task field in any unavailable response |
| TC-CHATTASKS-003 | replay, payload-mismatch 409, in-progress 409; link/unlink; recurrence advancing rather than completing; the optimistic-lock 409 |
| TC-CHATTASKS-004 | the workspace: self-assignment, no conversation, per-person lists, a `view` parameter that cannot widen it, that its tasks are **not** private, idempotency, and that the Workflows routes still resolve to Workflows |
| TC-CHATTASKS-005 | the browser walkthrough: the command menu, the drawer's resolved fields, the card in the transcript, the panel, and persistence across reload |

## Final compliance report

| Check | Status |
|---|---|
| TLDR present | Yes |
| Problem statement | Yes |
| Architecture (module graph, command flow) | Yes |
| Data models with constraints | Yes |
| API contracts with per-route gates | Yes |
| Auto-discovery paths (api, backend, widgets, migrations, i18n) | Yes |
| Backward-compatibility assessment | Yes — additive only; `ChatSystemEvent` gains a value in a text column, no persisted identifier renamed, no ACL feature added |
| Risks and impact review with mitigations | Yes |
| Integration coverage for every new API path | Yes — TC-CHATTASKS-001..005 |
| Changelog | Yes |

Gates run against the implementation:

| Gate | Result |
|---|---|
| `chat` + `chat_tasks` + `tasks` unit | 69 suites, 1264 tests, all passing |
| `chat_tasks` integration (real Postgres, ephemeral) | 24 / 24 passing |
| `chat` integration | 33 passed, 1 skipped (a pre-existing Matrix-only skip) |
| `tasks` integration | 68 / 68 passing |
| `@open-mercato/core` full unit | matches the pre-existing baseline exactly (13 failures in `workflows` design-system tests, present on a clean tree); 13,198 passing vs 13,059 before, i.e. +139 new tests |
| `@open-mercato/app` unit | 4 failed suites / 5 failed tests — **identical with this work stashed**, so pre-existing (`AppProviders`, `DemoFeedbackWidget`, and two login import-graph tests) |
| `@open-mercato/cli` unit | 89 suites, 1749 tests passing |
| `yarn typecheck` | pass |
| `yarn lint`, `yarn lint:ds` | pass, 0 errors |
| `yarn i18n:check-sync` | "All translation files are in sync" |
| `yarn build:packages`, `yarn build:app` | pass |

Repo-wide guards that constrain this work specifically — `mvp-module-scope`,
`module-decoupling`, `module-facts.bc-guard`, `optimistic-lock-editable-entities` and
`tasks/moduleGating` — all pass, with the two gating tests extended rather than relaxed:
`moduleGating` gained an explicit `chat_tasks` allowlist plus a companion test that
re-reads each module's `requires` from its own `index.ts`, so the allowlist cannot hide a
module that quietly starts importing `tasks`.

## Changelog

- 2026-09-14 — initial spec, written alongside the implementation.
- 2026-09-14 — re-verified against a running app and hardened. Nine defects found and
  fixed; the ones worth remembering:

  **Two declared events were never emitted.** `chat_tasks.link.created` / `.removed` were
  declared, bridged to the browser, and subscribed to by the client — and nothing ever
  called the emitter. Creating a task only appeared to refresh other viewers because
  `tasks.tasks.create` happens to emit `tasks.task.created`; linking, unlinking and
  publishing a card wrote no task row, so every other participant's panel stayed wrong
  until a stale-time expired. The contract test asserted every event *was* `clientBroadcast`
  and never that any was emitted, which is precisely how it survived. Both are now emitted
  after the durable write, addressed to the conversation's live participants, and
  `moduleContract.test.ts` now fails if a declared event has no call site. Verified live
  against three concurrent SSE sessions: the participant receives both frames, a chat member
  who is not in the conversation receives nothing, and a task-only identity receives nothing.

  **A failed idempotency row was handed over without being re-armed**, so a crash during the
  retry left it saying `failed` and admitted a third attempt — a second task under a key
  whose entire purpose is that it cannot produce one.

  **A replayed create always reported its card as unpublished.** The ledger has no card
  column, and the replay branch returned a hardcoded `null` rather than reading the link it
  already had. A double-click told the user the card could not be posted and offered a retry
  that then failed with `card_already_published`.

  **The sidebar grew a second "Chat" group.** `mergeMenuItems` only takes the
  join-an-existing-group branch when a menu item declares no `placement`; declaring one sent
  the item down the relative-placement path, which matches menu-item ids, and a page-derived
  entry like Conversations has none. The group id also has to be the page's `pageGroupKey`
  (`chat.nav.group`), not its display name.

  **Plain text was being written into a rich-text column.** `tasks_tasks.description` is
  sanitized and rendered with `dangerouslySetInnerHTML`, so a copied message lost every line
  break and had `deploy <service> first` stripped to `deploy  first` — the stored task said
  something different from the text the writer had reviewed and approved, which is the one
  promise that flow makes.

  **The Tasks panel had no way to reach its second page.** The endpoint returned a keyset
  cursor and `hasMore`; the client rendered "Narrow the filters to see others" and dropped
  the cursor on the floor. Now an infinite query and a "Show older" control, matching chat's
  own cursor-paged hooks. Verified in the browser against a conversation with 150 links.

  **The composer loaded and decrypted every user in the organization** to answer whether a
  handful of conversation participants were assignable. Replaced with
  `filterScopedUserIds` — the tasks module's own predicate, expressed once so
  `assertScopedUserIds` and this cannot drift.

  Also: `cards.publish` and `links.unlink` did not check module entitlement; `tz` was
  missing from the request fingerprint though it changes the resulting task; a `dueTime`
  sent without a `dueDate` was silently dropped where the tasks module returns 400; the
  workspace self-assign default overrode an explicitly chosen role audience; and two writes
  re-read their row without scope.

  **Measured, not asserted.** The panel read is flat at 17–21 ms from 25 to 150 linked
  tasks. The marginal cost of hydrating one more card is ~0.04 ms, so the unbounded
  hydration this replaced would have cost roughly 35 ms rather than 29 ms at 150 links — the
  fix removes an unbounded growth path, and is **not** a large speed-up at realistic sizes.

- 2026-09-14 — implemented. Notes worth keeping:

  **`asFunction` needs `.proxy()` under `InjectionMode.CLASSIC`.** Every `chat_tasks`
  write returned 500 while reads worked. The DI registration destructured its dependencies
  from a `cradle` parameter, which is Awilix's PROXY convention; this container runs
  CLASSIC, so the factory received positional arguments and the service's collaborators
  were `undefined`. Reads had been passing because the read path resolved a different
  registration. `auth/di.ts` documents the same trap; the fix is `.proxy()` on the factory.
  Diagnosed by probing routes rather than reading code: a guessed-id request 404'd
  correctly while the composer 500'd, which located the failure in construction rather
  than authorization.

  **A route-level `tasks.view` broke the very state it was meant to protect.** A chat
  member without task access got a 403 from the cards endpoint, so the transcript rendered
  a broken row instead of "a task is linked here you can't see". Three GETs were relaxed to
  `chat.view` alone and the contract test was extended with an explicit `CHAT_ONLY_READS`
  allowlist plus a companion assertion that writes in those same files still name a task
  grant — an exemption that is pinned rather than a gate that quietly disappeared.

  **Quick-add's parse is the authority, and the drawer must show what it returned.** An
  early version highlighted recognized tokens with a transparent-text overlay on the input.
  It misaligned by a character at some widths and rendered the field invisible at others.
  Removed entirely: the resolved-field list (assignee, project, due date, priority,
  warnings) already satisfies "show what was understood before submission", and it does so
  in words rather than in an overlay that has to track font metrics.

  **A unit test caught the injected message action losing the body.** The binding for
  `chat:message:actions` passed conversation, message and sender but not `body`, so
  "Use message text" would have had nothing to copy — a silent no-op rather than an error,
  and invisible to the integration tests because they exercise the API. Found by the test
  written for the binding itself.

  **Playwright specifics for a command menu.** `fill()` sets the value without moving the
  caret, and the menu opens from a caret-relative draft, so the menu never appeared —
  `pressSequentially` is required. `pressSequentially` also *appends*, so a `toPass` retry
  produced `//` then `///`; each attempt needs `fill('')` first. `RowActions` closes 150 ms
  after the pointer leaves, which makes hover-menu assertions inherently racy, so those
  moved to unit tests, following chat's own TC-CHAT-008 precedent.

  **The ephemeral harness boots from `dist/`.** A source-only change runs the previous
  build, and the failure presents as a missing module rather than a stale one.
  `yarn build:packages` before `yarn test:integration:ephemeral --no-reuse-env` is
  mandatory, not hygiene.
