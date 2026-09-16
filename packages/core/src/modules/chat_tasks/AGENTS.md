# Chat Tasks Module — Agent Guidelines

The join between `chat` and `tasks`: create, assign, view and update real tasks from a
conversation. It owns **the link and nothing else** — every task rule stays in `tasks`,
every access rule stays in the module that owns it, and neither of them imports this one.

## Always

- Treat the two boundaries as independent. **Chat access never grants task access; task
  access never grants chat access.** Every read and write proves both, separately, for the
  caller — never once, never inherited from the route that reached it.
- Answer **404, never 403**, for a conversation the caller is not a participant of, a task
  they may not read, and an id that never existed. The three are indistinguishable on
  purpose; telling them apart is an id-guessing oracle.
- Resolve every task **per viewer**, through `chatTaskService.hydrateTasks`. Two people in
  one conversation legitimately see different things.
- Return `{ available: false, task: null }` for a task the viewer cannot read. No title, no
  reference, no project, no status, **not even the task id** — the shape is all-or-nothing
  so it cannot be half-filled.
- Derive scope from the session. `resolveChatTasksRequest` is the only source of
  `tenantId` / `organizationId`; a body or query string is never read for either.
- Send `idempotencyKey` on every create. It is required, not optional — see § Idempotency.
- Reference chat and tasks rows by **plain uuid**. No ORM relation crosses the boundary.

## Ask First

- Ask before adding an ACL feature. This module deliberately declares **none**: every gate
  it applies is one of chat's two or one of the tasks module's fourteen, asked of the same
  RBAC service. A feature that exists only here is a third thing to grant, a third thing to
  forget, and a surface an operator could widen without realising what it widened.
- Ask before storing anything from a message in a task. The link carries the message *id*;
  the words are copied only when a person explicitly asks, after being shown what will be
  shared.
- Ask before putting a conversation id, a message id or a link id into a `tasks.*` event,
  a task DTO, the search index or an export. Those are organization-wide surfaces, and an
  identifier there reveals that two people are talking about something.

## Never

- Never infer a link. The panel shows only links recorded for *this* conversation — never
  anything derived from a shared assignee, a shared project or a text match.
- Never delete a task as compensation. If the card fails to publish, the task still exists
  and the caller is told so; deleting it would destroy work somebody may already own.
- Never cascade. Unlinking, removing a card and deleting a task are three separate acts,
  and no foreign key exists for one to travel down.
- Never let a chat write path reach a task without the task grant, or the reverse.

## Validation Commands

```bash
yarn workspace @open-mercato/core test -- src/modules/chat_tasks
yarn typecheck
yarn build:packages   # the ephemeral harness boots from dist/, not src/
JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral --no-reuse-env "modules/chat_tasks/__integration__"
```

`build:packages` before the integration run is not optional: the harness resolves entities
from `node_modules/@open-mercato/core/dist`, so a source-only change boots the previous
build and the failure looks like a missing module rather than a stale one.

## Data Model

Two tables, and **no change to any `chat_*` or `tasks_*` table**. Rolling the integration
back is dropping two tables nothing else reads.

| Table | Carries |
|---|---|
| `chat_task_links` | `conversation_id`, `task_id`, optional `source_message_id`, optional `card_message_id` — all plain uuids |
| `chat_task_requests` | the idempotency ledger: `(tenant, org, actor, idempotency_key)` plus a `request_hash` and the result |

Four constraints carry guarantees the application cannot make alone:

- **`chat_task_links_scope_uq`** — one live link per (scope, conversation, task). Two
  clicks race, the loser raises 23505, and both return the row that won rather than
  stacking two cards for one task. Partial on `deleted_at is null`, so unlinking and
  linking again is allowed.
- **`chat_task_links_card_uq`** — one link per card row, so a republish after a partial
  failure cannot point two links at one message.
- **`chat_task_requests_key_uq`** — the idempotency key, **scoped to the actor**. One
  person's retry can never replay another person's result.
- **`chat_task_requests_status_check`** — a frozen vocabulary written into rows.

## Idempotency

Creating a task, linking it and posting its card **cannot share one transaction**:
`tasks.tasks.create` holds a row lock on its project to mint `PROJ-n` and announces the
assignment when it is done. Composing it into an outer transaction would hold that lock for
the whole operation and — worse — emit an assignment notification inside a transaction that
may still roll back, telling somebody they own a task that then ceases to exist.

So the sequence is made **safe to repeat** instead of atomic:

```
A  claim the key            own transaction, unique index
B  create the task          its own transaction, its own lock
C  record the link          own transaction, ledger completed with it
D  publish the card         then record which message it is
```

A retry never reaches B twice: the claim in A either succeeds once or finds the row the
first attempt wrote.

| Same key, … | Answer |
|---|---|
| same details, completed | the original result, `replayed: true` — after re-checking access, and reading the card from the **link**, never from the ledger |
| different details | `409 idempotency_key_reuse` |
| first attempt still running | `409 request_in_progress` — never a second task |
| first attempt failed | retryable — and the row is **re-armed to `pending`** as it is handed over |

Two details of that table are load-bearing and were each a real bug:

- **Re-arming a `failed` row.** Leaving it saying `failed` while the retry runs means a
  crash during that retry leaves it saying `failed` still — and the attempt after that is
  admitted too, creating a second task under a key whose whole purpose is that it cannot.
- **Reading the card from the link.** The ledger records which task and which link were
  produced; whether a card exists lives on the link and changes afterwards. Reporting a
  remembered `null` told a user who had merely double-clicked that the card could not be
  posted, and sent them to a retry that failed with `card_already_published`.

**Known window:** a crash between B and C leaves the ledger `pending` and a real, visible
task nothing points at. A retry is refused rather than duplicating, and the orphan is a task
the user can see and link by hand. That is the honest failure — no duplicate, nothing
silently deleted, and nothing claimed to have failed that actually succeeded.

## Cards

A card is a `chat_messages` row with `kind: 'system'`, `systemEvent: 'card'` and an **empty
body**, appended through chat's own `chat.messages.appendCard`. Each of those matters:

- **Empty body** — nothing task-shaped can reach `search_body`, the conversation preview,
  the translation cache or the outbound transport. The card is rendered per viewer from an
  authorized read instead.
- **`system`, not `user`** — already excluded from the unread predicate, so posting a card
  does not manufacture unread activity, and already not editable, so nobody can rewrite a
  card into something it does not point at.

`cardPublished: false` with a real `taskId` is a **partial success, not a failure**. Say so,
offer `POST /api/chat_tasks/links/{id}/card`, and never re-run the create.

## The Personal Workspace

`/backend/chat/workspace` is an **isolated surface, not a conversation**. There is no
`chat_conversations` row, no participant list and no `direct_key`: the workspace *is* the
(user, tenant, organization) triple, so "one per person" is true by construction, nothing
races, no row exists for another employee or administrator to read, and there is nothing for
the Matrix transport to provision.

It is **not** a private task list. A task made there has exactly the visibility every other
task has, and the composer says so — `chat_tasks.workspace.sharedNotice`, asserted by
TC-CHATTASKS-004 so nobody can quietly add a private-task ACL and call it a bug fix.

`/mytasks` and the workspace list both delegate to the tasks module's own `assigned` view,
so role-resolved assignment behaves here exactly as it does on the Tasks screens.

## Route Gates

Route `requireFeatures` is the **coarse** gate — it can only express the union. Membership
of a particular conversation and readability of a particular task are checked per record.

Three reads take `chat.view` **alone**, and that is deliberate: their job for a member with
no task access is to say "a task is linked here that you cannot see", and a route-level
`tasks.view` would refuse the request instead — a 403 in the middle of a transcript renders
as a broken row, not as an unavailable card.

```
api/conversations/[id]/cards      GET   chat.view
api/conversations/[id]/tasks      GET   chat.view          POST chat.send + tasks.create
api/links/[linkId]                GET   chat.view          DELETE chat.view + tasks.view
```

`moduleContract.test.ts` pins that exemption to those three GETs: any other route, and any
write in those files, must name a grant from both modules.

## Where Things Live

| Concern | File |
|---|---|
| Per-viewer authorization and hydration | `services/chatTaskService.ts` |
| Who a task is for, by conversation kind | `services/chatTaskAssignmentService.ts` |
| The coordinated create, the ledger, the card | `commands/links.ts` |
| Request plumbing, rate limit, guard | `api/shared.ts` |
| The card a reader sees | `components/ChatTaskCard.tsx` |
| The composer drawer | `components/ChatTaskComposer.tsx` |
| Command → drawer, across two lazily-loaded chunks | `components/overlayBridge.ts` |
| Where a task opens | `lib/routes.ts` |

## What This Module Changed Elsewhere

Kept small on purpose, and each one is a seam rather than a special case:

- **`chat/extension-points.ts`** — six hosts, so chat renders spots and imports nothing from
  here. Removing this module empties them.
- **`chat/commands/cards.ts`** — `appendCard` / `removeCard`. Not a second send path: no
  body, no mentions, no links, no attachments, no transport.
- **`ChatSystemEvent` gains `'card'`** — a text column, so no migration.
- **`tasks.tasks.complete` / `.reopen` gain the optimistic-lock guard** — additive, a no-op
  without the header. Completing a recurring task advances its occurrence, so a retried
  completion would silently move a deadline; the card sends the expected version.
- **`?task=<id>` on the tasks personal views** — the tasks module had no task deep link at
  all. A query parameter on a route it already serves, never a new route: `/backend/tasks`
  and `/backend/tasks/{id}` belong to `workflows`.

## Specs

- [`.ai/specs/2026-09-14-chat-tasks-integration.md`](../../../../../.ai/specs/2026-09-14-chat-tasks-integration.md)
