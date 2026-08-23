# Tasks Module — PCA ERP Work-Management Parity

- **Status**: implemented
- **Owner**: core
- **Module**: `packages/core/src/modules/tasks`
- **Reference implementation**: PCA ERP `apps/{backend,frontend}/src/modules/tasks` (NestJS + Prisma / React + react-router)

## 1. Why

Operis has no work-management surface. `planner` is availability scheduling; `customers`'
"customer tasks" are CRM interactions bound to a customer record. Neither models projects,
boards, subtasks, milestones, recurrence, or a personal task inbox.

PCA ERP ships a mature Linear/Todoist-style module that the business already uses. This spec
carries that **product** into Operis — same features, workflows, layout, density and
interaction patterns — reimplemented on Operis/OpenMercato foundations (MikroORM, commands,
auto-discovered API routes, Awilix DI, RBAC features, tenant + organization scoping, events,
notifications, search, i18n) and repainted with Operis design-system tokens.

PCA ERP defines *what* Task Management looks and behaves like. Operis defines *how* it exists
inside the platform.

## 2. Scope

In scope: projects, milestones, tasks, subtasks, labels, comments, project docs, personal task
views, calendar, quick add, Kanban board, team view, RBAC, tenant/org isolation, module gating,
search, events, notifications, optional attachments.

Out of scope: time tracking, task dependencies (PCA has none), portal-facing task surfaces,
external calendar sync.

## 3. Data model

Ten entities in `data/entities.ts`, all tables prefixed `tasks_`, all carrying
`tenant_id` + `organization_id` + `created_at` + `updated_at` (+ `deleted_at` on
soft-deletable rows). No cross-module ORM relations: user/role references are plain
`uuid` columns validated at the service layer.

| Table | Purpose | Notable columns |
|---|---|---|
| `tasks_projects` | a unit of work | `key` (uppercase prefix, unique per tenant+org), `name`, `icon` (emoji), `owner_user_id`, `start_date`, `archived_at`, `is_inbox`, `task_seq`, `search_text` |
| `tasks_project_members` | membership join | `(project_id, user_id)` |
| `tasks_milestones` | dated goal in a project | `name`, `description`, `status`, `due_date` |
| `tasks_tasks` | unit of work | `number` (unique per project), `title`, `description` + `description_plaintext`, `status`, `priority`, `reviewer_user_id`, `reporter_user_id`, `due_date`, `due_time`, `recurrence_freq`/`_weekday`/`_day_of_month`, `completed_at`, `rank` (double), `parent_task_id`, `milestone_id`, `archived_at`, `search_text` |
| `tasks_task_assignees` | explicit user assignees | `(task_id, user_id)` |
| `tasks_task_assignment_targets` | dynamic role audience | `(task_id, role_id)`, `kind='role'` |
| `tasks_task_comments` | threaded comments | `body` + `body_plaintext`, `author_user_id` |
| `tasks_project_docs` | doc page tree | `parent_id`, `title`, `body` + `body_plaintext`, `position` |
| `tasks_labels` | per-tenant label catalog | `name` (unique per tenant+org), `color` |
| `tasks_task_labels` | task ↔ label join | `(task_id, label_id)` |

Enums (wire values verbatim, frozen because they are persisted):
- `TaskStatus`: `backlog | pending | in_progress | blocked | review | done | cancelled`
- `TaskPriority`: `none | low | medium | high | urgent`
- `MilestoneStatus`: `planned | active | completed`
- `TaskRecurrenceFrequency`: `daily | weekdays | weekly | monthly`

Key indexes: `(project_id, number)` unique, `(project_id, status, rank)`,
`(project_id, due_date)`, `(due_date)`, `(parent_task_id)`, `(tenant_id, organization_id)`,
`(tenant_id, organization_id, is_inbox)` partial unique for the Inbox.

## 4. Domain rules (preserved from PCA ERP)

1. **Task references** — `taskSeq` on the project increments inside the create transaction;
   a task is displayed as `${projectKey}-${number}` (e.g. `ENG-42`).
2. **Board ordering** — `rank` is a `double precision` bisection key. Moving after a neighbour
   sets `rank` to the midpoint of its neighbours; to the top uses `firstRank - STEP`; to an
   empty column uses `STEP`. A status change outside the board appends to the bottom.
3. **Recurrence** — completing a recurring task advances `due_date` to the next occurrence and
   resets status to `pending` instead of marking it done. `weekly` carries a weekday (0–6),
   `monthly` a day-of-month anchor (1–31) that clamps to short months but returns to the anchor.
4. **Inbox** — one hidden `is_inbox` project per tenant+org, lazily created, excluded from
   project lists, and rejected for rename/archive/delete. Quick Add defaults there.
5. **Subtasks** — unlimited depth within one project. Self-parenting and cycles are rejected
   (400). Deleting a parent cascades the whole subtree.
6. **Assignment** — explicit user assignees *and/or* dynamic `role` targets whose current
   members resolve at read time, so role-membership changes propagate automatically.
7. **Due time** — `due_time` (`HH:MM`, 24h) requires a `due_date`; clearing the date clears the
   time and (unless explicitly set) the recurrence.
8. **Milestone progress** — derived at query time from the tasks pointing at it, never stored.
9. **Terminal statuses** — `done` and `cancelled`. Every "incomplete" view excludes exactly
   these; the subtask counter excludes `cancelled` from both numerator and denominator.
10. **Labels** are a tenant+org catalog shared across projects; cross-scope references rejected.

## 5. Operis translations of PCA architecture

| PCA ERP | Operis |
|---|---|
| `@RequiresModule("tasks")` module guard | module enablement in `apps/mercato/src/modules.ts` + `requireFeatures` in `page.meta.ts` / API guards |
| tenant-only scoping | `tenant_id` **and** `organization_id`, enforced in every service query |
| no per-action permissions | `acl.ts` features (§6), checked server-side on every route |
| `OrgAuthorityService` reporting lines | caller's visible organization scope (`directory.Organization.parentId` descendants + RBAC org visibility) |
| Prisma services called from controllers | services in `services/` + writes through `commands/` (audit, undo, events, index) |
| `sonner` toasts, `framer-motion` | `flash()` from `@open-mercato/ui/backend/FlashMessages`, CSS transitions |
| TipTap `RichTextEditor` | `RichEditor` primitive + `sanitizeHtmlRichText` |
| Nextcloud DMS `AttachmentsPanel` behind an `IntegrationGate` | the `tasks:task-panel:sidebar` injection spot (declared in `extension-points.ts`, rendered by `TaskPanel`). Attachments — or any other module — contribute a widget there; the spot renders nothing when unclaimed, so tasks never imports or resolves the peer |
| no concurrency control | optimistic locking (Operis default ON) via `updated_at` + `buildOptimisticLockHeader` + `surfaceRecordConflict` |

## 6. Access control

`acl.ts` features, all `dependsOn` `tasks.view` unless noted:

| Feature | Gates |
|---|---|
| `tasks.view` | reading any tasks surface |
| `tasks.create` | creating tasks / subtasks / quick add |
| `tasks.edit` | editing a task, changing status, priority, dates, board moves |
| `tasks.delete` | deleting tasks |
| `tasks.assign` | changing assignees and role targets |
| `tasks.projects.view` | reading projects, board, docs, milestones |
| `tasks.projects.manage` | creating/editing/archiving/deleting projects and members |
| `tasks.milestones.manage` | milestone CRUD |
| `tasks.labels.manage` | label catalog CRUD |
| `tasks.docs.view` / `tasks.docs.manage` | project doc pages |
| `tasks.comments.create` / `tasks.comments.manage` | own comments / any comment |
| `tasks.team.view` | the Team surface |

`setup.ts` `defaultRoleFeatures`: `admin: ['tasks.*']`,
`employee: ['tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign', 'tasks.projects.view', 'tasks.docs.view', 'tasks.comments.create']`.

## 7. API surface

All routes auto-discovered under `api/`, every file exporting `openApi`. Non-CRUD writes wire
the mutation-guard registry and honour the optimistic-lock header.

```
GET  POST            /api/tasks/projects
GET  PATCH DELETE    /api/tasks/projects/[id]
PATCH                /api/tasks/projects/[id]/archive
GET                  /api/tasks/inbox
GET                  /api/tasks/assignable-users
GET                  /api/tasks/assignment-options
GET  POST            /api/tasks/projects/[id]/tasks
GET                  /api/tasks/projects/[id]/board
GET  PATCH DELETE    /api/tasks/tasks/[id]
PATCH                /api/tasks/tasks/[id]/complete | /reopen | /move
GET                  /api/tasks/my-tasks
GET                  /api/tasks/my-tasks/calendar
POST                 /api/tasks/quick-add/parse
GET  POST            /api/tasks/tasks/[id]/comments
PATCH DELETE         /api/tasks/comments/[id]
GET  POST            /api/tasks/projects/[id]/docs
GET  PATCH DELETE    /api/tasks/docs/[id]
GET  POST PATCH DELETE  /api/tasks/labels
GET  POST            /api/tasks/projects/[id]/milestones
PATCH DELETE         /api/tasks/milestones/[id]
GET                  /api/tasks/team/members
GET                  /api/tasks/team/members/[userId]/board | /tasks
```

## 8. UI

Pages under `backend/tasks/**`, each rendering a `TasksShell` (module sidebar + content +
Quick Add modal + Calendar drawer + Project form dialog), replicating PCA's layout:

| Route | Surface |
|---|---|
| `/backend/tasks/{all,today,upcoming,assigned,completed}` | My Tasks |
| `/backend/tasks/projects` | Projects list |
| `/backend/tasks/projects/[id]` | Project detail (Tasks / Board / Completed / Overview / Milestones / Docs) |
| `/backend/tasks/team` | Team |

**Shared `/backend/tasks` prefix.** The `workflows` module already owns
`/backend/tasks` (its "User Tasks" queue) and `/backend/tasks/[id]`. Both keep working:
`sortRoutesBySpecificity` in `packages/shared/src/modules/registry.ts` orders static
segments ahead of dynamic ones, so `/backend/tasks/today` matches this module while
`/backend/tasks/<uuid>` still matches workflows. The prefix is deliberately shared to keep
PCA ERP's URLs; a future **static** workflows route under `/backend/tasks/…` would be the
one thing that collides, so add such a route to `workflows` only after checking this list.

Design-token mapping (PCA hex → Operis DS token):

| Status / priority | Token |
|---|---|
| `backlog`, `cancelled` | `status-neutral-*` / `disabled-foreground` |
| `pending` | `status-info-*` |
| `in_progress` | `status-pink-*` (DS categorical accent for stage chips) |
| `blocked` | `status-error-*` |
| `review` | `status-warning-*` |
| `done` | `status-success-*` |
| priority `low → urgent` | `status-neutral-icon` → `status-info-icon` → `status-warning-icon` → `status-error-icon` |

No hardcoded hex, no `dark:` overrides on tokens, no arbitrary Tailwind values; the module
ships with `error`-severity `om-ds/*` lint.

## 9. Events, search, notifications

- `events.ts`: `tasks.project.{created,updated,archived,deleted}`,
  `tasks.task.{created,updated,moved,completed,reopened,deleted}`,
  `tasks.comment.*`, `tasks.label.*`, `tasks.milestone.*`, `tasks.doc.*`.
  Board-visible writes carry `clientBroadcast: true` so open boards refresh over SSE.
- `search.ts`: indexes `tasks:tasks_task`, `tasks:tasks_project`, `tasks:tasks_project_doc`.
- `notifications.ts`: `tasks.task.assigned`, `tasks.task.comment`, `tasks.task.due_today`.

## 10. Test coverage

**Unit** (`__tests__/`): recurrence normalize/first-occurrence/advance-after-completion incl.
month clamping, rank bisection, quick-add parser corpus (ported from PCA's parser + corpus
specs), subtask cycle guard, validators, assignment predicate, status/priority token map,
`trimRichText`, date/timezone helpers.

**Integration** (`__integration__/TC-TASKS-*.spec.ts`). One file may carry several IDs where
the scenarios share a fixture; the file name carries the lowest.

| ID(s) | File | Covers |
|---|---|---|
| 001 | `projects-crud` | project create/read/update/archive/delete |
| 002 | `inbox` | Inbox lazy creation + rename/archive/delete rejection |
| 003 | `task-crud` | task create/edit/delete, `PROJ-n` numbering |
| 004 | `quick-add` | quick-add parse → create round trip |
| 005 | `assignment` | named assignees, role targets resolved at read time, out-of-scope rejection |
| 006, 007 | `status-recurrence` | status, priority, complete/reopen, recurrence advance |
| 008 | `board-move` | board move within/between columns + persistence |
| 009 | `subtasks` | subtasks incl. cycle rejection |
| 010, 011 | `comments-docs` | comments CRUD + authorship, docs tree CRUD |
| 012, 013 | `milestones-labels` | milestones + derived progress, labels CRUD + cross-scope rejection |
| 014, 015, 016 | `views-team` | my-tasks views/filters/pagination, calendar window+modes, team + forbidden peer |
| 017, 018, 022 | `isolation` | tenant + organization isolation on every entity, HTML sanitisation |
| 019, 021 | `rbac-locking` | RBAC grant/deny matrix, optimistic-lock 409 |
| 020 | *(unit)* `moduleGating.test.ts` | module gating — see below |
| 030 | `ui-walkthrough` | the §24 operator script end to end, incl. reload persistence |

Module gating (020) is a **unit** test rather than a Playwright one: "disabled" means the
module's entries are absent from the route manifest, which is a property of the manifest, not
of a running server — and a Playwright run cannot restart the app without the module. The test
builds the manifest from the module's own files and resolves against it twice, with and
without tasks.

**UI** (`jest.dom`): Quick Add parse + keyboard + mention menus, Kanban drag callback and
failure rollback, comment composer keyboard + stale-draft read, empty/loading/error states.

**Contract** (`__tests__/moduleContract.test.ts`, `moduleGating.test.ts`): every API route
requires auth and a declared feature on every exported method; every write dispatches through
the guarded command path; every page is gated and titled from the locale bundle; ACL
dependencies resolve and do not cycle; declared notification types are actually sent; the
module resolves only when registered, and its features/pages/APIs vanish when it is not.

## 11. PCA ERP → Operis parity audit

Audited 2026-08-24 against `~/Documents/Github/pca_erp` at the state described in §1. ✅ = at
parity, ⚠️ = deliberately different (reason given). No ❌ remain.

### 11.1 Pages and shell

| PCA | Operis | |
|---|---|---|
| `TasksLayout` shell: sidebar + outlet + Quick Add modal + Calendar drawer + project modal | `TasksShell` + `TasksSidebar` + `QuickAddDialog` + `CalendarPanel` (Sheet) + `ProjectFormDialog` | ✅ |
| My Tasks `/tasks/{all,today,upcoming,assigned,completed}` | `/backend/tasks/{all,today,upcoming,assigned,completed}` | ✅ |
| Projects list `/tasks/projects` | `/backend/tasks/projects` | ✅ |
| Project detail `/tasks/projects/:id`, 6 tabs | `/backend/tasks/projects/[id]`, same 6 tabs | ✅ |
| Team `/tasks/team` | `/backend/tasks/team` | ✅ |
| Sidebar entries: Add Task, 5 views w/ counts, project list w/ open counts, New project | same, plus Team | ✅ |
| Nav icons `Sun` / `LayoutList` / `CalendarDays` / `UserCheck` / `CheckCircle2` / `CirclePlus` / `FolderKanban` / `Users` | identical; `folder-kanban`, `sun`, `message-square` added to the DS icon registry by the build scan | ✅ |
| `sonner` toasts, `framer-motion` transitions | `flash()` + CSS transitions | ⚠️ Operis has no `sonner`/`framer-motion`; `flash` is the platform's own surface |

### 11.2 Task surfaces

| PCA | Operis | |
|---|---|---|
| Day-grouped list w/ Overdue heading, inline status select, priority bars, subtask progress, due chip, recurrence chip, comment count, project chip | `TaskListRow` + `badges.tsx`, same composition | ✅ |
| `TaskCard` board card | `TaskCard`, same layout | ✅ |
| `TaskPanel` detail modal: inline title, rich description, properties rail, subtasks, comments, reporter/reviewer, delete confirm; doubles as "New task" | `TaskPanel`, same | ✅ |
| `AttachmentsPanel` behind an `IntegrationGate` (Nextcloud) | `tasks:task-panel:sidebar` injection spot | ⚠️ tasks never imports the attachments module; it degrades to rendering nothing |
| 7 hand-drawn `StatusIcon` glyphs, `PriorityBars` | same glyphs, painted from `var(--status-*-icon)` | ✅ |
| Status colours `#64748B/#2563EB/#7C3AED/#DC2626/#B45309/#047857/#6B7280` | `status-neutral/info/pink/error/warning/success` + `disabled-foreground` | ⚠️ theme swap, as briefed |
| New-task flash-and-scroll | `useNewTaskFlash`, same query-param protocol | ✅ |
| 7 hover-control sites (`group-hover:*`) | all 7 present, same selectors | ✅ |
| Tooltips: subtask-of, assign trigger, role chip | present and translated, plus priority / subtask-progress / avatar-name | ✅ |

### 11.3 Kanban

| PCA | Operis | |
|---|---|---|
| dnd-kit, 7 columns, drag overlay, rank bisection | same, `resolveBoardDrop` + server-side `rankForMove` | ✅ |
| Drop on column = append; drop on card = take its place | same | ✅ |
| Persisted status + order | `PATCH /api/tasks/tasks/[id]/move`, `onSettled` invalidates the board | ✅ |
| — | drop on the dragged card itself is a no-op | ⚠️ Operis-only fix; PCA reorders the card to the top of its column on a short drag |
| Failed move | `flash(reason, 'error')` + query invalidation, so the card snaps back | ✅ |

### 11.4 Quick Add

| PCA | Operis | |
|---|---|---|
| One-line NL parser, live token highlighting | parser ported near-verbatim, `buildHighlightSegments` | ✅ |
| `@` assignee and `+` label mention menus, inline label creation | same, `role="listbox"`/`role="option"` | ✅ |
| Arrow keys move highlight, Enter/Tab accept, Escape dismisses menu then composer | same | ✅ |
| Enter submits; created task routes to a view that shows it | same, `createdTaskDestination` | ✅ |
| Date/time/recurrence/priority/assignee/label override pickers + project dropdown + description editor | same | ✅ |
| Warnings as prose strings | `{ code, params }` rendered through `t()` | ⚠️ prose on the wire cannot be translated |

### 11.5 Keyboard

| Interaction | PCA | Operis |
|---|---|---|
| Quick Add: Enter submit / Esc close / menu keys | ✅ | ✅ |
| Comment box: Enter posts, Shift+Enter newline | ✅ | ✅ |
| Task title row: Enter commits | ✅ | ✅ |
| Label picker: Enter creates the typed label | ✅ | ✅ |
| Calendar drawer: Esc closes | ✅ | ✅ (Sheet) |
| Task panel / project modal: Esc closes unless saving | ✅ | ✅ (Dialog, guarded on pending) |

### 11.6 Domain rules

Per-project `taskSeq` numbering, `rank` bisection, recurrence rolling the due date forward
instead of completing, hidden per-scope Inbox, unlimited-depth subtasks with cycle rejection,
dynamic role targets resolved at read time, scope-level label catalog, derived milestone
progress, `dueTime` requires `dueDate` — all ✅, and all covered by tests in §10.

### 11.7 API

All 38 PCA endpoints have an Operis equivalent across 26 route files. Two shapes differ:
comment and milestone writes are addressed by their own id (`/api/tasks/comments/[id]`,
`/api/tasks/milestones/[id]`) rather than nested under task/project — ⚠️ the ids are already
unique, so the parent segment was redundant and unenforced.

### 11.8 Deliberately not carried over

| PCA | Why |
|---|---|
| `OrgAuthorityService` reporting-line team visibility | Operis has no reporting line; Team scopes to the caller's organization, the boundary every other tasks read honours |
| Tenant-only scoping | Operis entities carry `tenant_id` **and** `organization_id`; every query filters both |
| No optimistic locking | Operis default is ON; every user-editable tasks entity carries `updated_at` and returns `updatedAt` |

## 12. Changelog

- 2026-08-24 — spec created; implementation started.
- 2026-08-24 — implementation complete. Documented the `/backend/tasks` prefix shared with
  `workflows`, attachments via injection spot, structured quick-add warning codes, and the
  §11 parity audit. All five locale bundles ship at full key parity (461 keys each,
  placeholder-validated); `de`/`es`/`ko`/`pl` are authored, not natively reviewed.
  Known gap: the integration specs are authored but not executed here — the tasks migration
  has not been applied to a local database, and applying one needs the maintainer's go-ahead.
