# Chat — organization-scoped direct messaging (Phase 1)

## TLDR

**Key Points:**

- New `chat` core module: private 1:1 messaging between active users of the **same organization**, in the same tenant.
- Conversation-first schema (`chat_conversations` / `chat_participants` / `chat_messages`), not an extension of the envelope-shaped `messages` module.
- Realtime reuses the existing DOM Event Bridge (`/api/events/stream`) with **server-side per-recipient audience filtering** — no new transport.
- Persistence is the source of truth; SSE is a hint that triggers a refetch. A dropped socket degrades to a working, slightly staler app.

**Scope:** `packages/core/src/modules/chat/**`, one gated button on the staff team-member detail page, one topbar icon in the app chrome, one DS-lint escalation block, one line in the shipped-module plan.

**MVP boundary:** direct conversations only. No channels, groups, threads, reactions, attachments, presence, typing indicators, external/guest messaging.

**Concerns:** the SSE audience contract is a frozen surface (`packages/events/AGENTS.md` → Ask First); this spec consumes it as-is and changes nothing in `packages/events`.

## Problem statement

Operis has three communication surfaces and none of them is a chat:

| Module | Domain | Why it does not fit |
|---|---|---|
| `messages` | Email-style internal inbox: envelope + `message_recipients` fan-out, `to`/`cc`/`bcc`, subject, drafts, folders, archive, SMTP forwarding. Threads are reconstructed by walking `parent_message_id` on every read (`commands/conversation.ts`). | A chat turn is not an envelope. Reusing it means a synthetic subject per turn, two `message_recipients` rows per message in a 1:1, and a BFS + decryption pass per read at keystroke frequency. |
| `communication_channels` | Bridges **external** providers (Slack/WhatsApp/Gmail) into the `messages` inbox. | External parties, not internal user-to-user. |
| `inbox_ops` | LLM pipeline turning forwarded email into reviewable action proposals. | Not conversational. |

The in-repo precedent is decisive: `ai_assistant` faced the same choice and built `ai_chat_conversations` / `ai_chat_conversation_participants` / `ai_chat_messages` as separate tables rather than bending `messages`. This spec follows that precedent for human-to-human chat.

## Proposed solution

### 1. Tenancy and membership model

A user row carries exactly **one** `organization_id` (`users.organization_id`); there is no membership join table, and `sessionIntegrity.ts` rejects any JWT whose `orgId` no longer matches the user row. Two consequences the design leans on:

- Moving a user out of an organization revokes their access on the next request, with no extra bookkeeping in this module.
- "Same organization" is a single equality check, not a set intersection.

The rule, enforced server-side on **every** chat request:

```
participant(user, scope) ⟺ user.tenant_id   = scope.tenantId
                          ∧ user.organization_id = scope.organizationId
                          ∧ user.deleted_at IS NULL
                          ∧ user.is_confirmed = true
```

`scope.organizationId` comes from `resolveActiveOrganizationId(auth)` — never from the request body. The caller is checked against this predicate too, so a super-admin scoped into an organization they do not belong to cannot inject themselves into that organization's conversations.

`User` has no `isActive` column; "active" is `deleted_at IS NULL AND is_confirmed = true`, matching `warranty_claims/lib/assigneeNames.ts`.

### 2. Data model

`chat_conversations`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id`, `organization_id` | uuid NOT NULL | |
| `kind` | text NOT NULL default `'direct'` | the future-extension seam (group/space) — no other value is accepted in Phase 1 |
| `direct_key` | text NULL | canonical `min(userA,userB):max(userA,userB)`; NULL for non-direct kinds |
| `last_message_at` | timestamptz NOT NULL | conversation-list ordering, seeded to the creation time. Non-null so the keyset cursor compares one indexed column instead of a `COALESCE`, and a brand-new conversation sorts with the newest. |
| `last_message_preview` | text NULL | first 200 chars, denormalized so the list is one query, not N+1 |
| `last_message_sender_user_id` | uuid NULL | |
| `created_at`, `updated_at`, `deleted_at` | | |

**Canonicality is a database constraint, not application logic:**

```sql
create unique index "chat_conversations_direct_uq"
  on "chat_conversations" ("tenant_id", "organization_id", "direct_key")
  where "kind" = 'direct' and "direct_key" is not null and "deleted_at" is null;
```

`ensureDirectConversation` reads, inserts, and on unique violation (Postgres `23505`) re-reads and returns the winner. Simultaneous "Alice → Bob" and "Bob → Alice" therefore converge on one row.

`chat_participants` — `(conversation_id, user_id)` unique, plus `last_read_at` as the **read cursor**. No per-message read rows, no denormalized counter that can drift.

`chat_messages` — append-only. `body` text, `sender_user_id`, `created_at`, and `client_message_id` for idempotency:

```sql
create unique index "chat_messages_client_id_uq"
  on "chat_messages" ("conversation_id", "client_message_id")
  where "client_message_id" is not null and "deleted_at" is null;
```

A retried send with the same `client_message_id` returns the original message instead of duplicating it.

Indexes: `(tenant_id, organization_id, last_message_at, id)` for the list; `(conversation_id, created_at desc, id desc)` for keyset pagination; `(tenant_id, organization_id, user_id)` on participants for "my conversations" and the unread aggregate.

### 3. Unread state

Derived from the cursor, never stored as a counter:

```sql
count(*) from chat_messages m
join chat_participants p on p.conversation_id = m.conversation_id and p.user_id = :me
where m.sender_user_id <> :me and m.deleted_at is null
  and (p.last_read_at is null or m.created_at > p.last_read_at)
```

One grouped query serves the whole conversation list; one aggregate serves the topbar badge. Consistent across refreshes, tabs and devices because it is a server-side read of one row per participant.

### 4. Realtime

No new infrastructure. `chat.message.sent` and `chat.conversation.read` are declared `clientBroadcast: true` and emitted with:

- **trusted scope** in `EmitOptions` (`{ tenantId, organizationId }`) — the SSE endpoint then ignores payload tenant/org entirely;
- `recipientUserIds` in the payload — the only channel the bridge offers for per-user targeting.

`matchesAudience()` in `packages/events/.../stream/route.ts` drops the frame for every connection that is not one of the two participants, before the write. The browser does no security filtering; it never receives the frame.

The payload is a **notification, not the content**: `{ tenantId, organizationId, conversationId, messageId, senderUserId, recipientUserIds, createdAt }`. Reasons: the bridge truncates payloads over 4096 bytes into an unusable stub, the cross-process Postgres `NOTIFY` bridge caps at 7000 bytes, and message bodies do not belong in a transport whose only guard is the audience filter. Clients invalidate and refetch.

Recovery is inherited from `eventBridge.ts`: exponential backoff, 45s heartbeat timeout, 500ms dedup, and a synthetic `om:bridge:reconnected` event that the chat hooks treat as "refetch everything".

### 5. API

All under `/api/chat`, all `requireAuth`, all feature-gated, all deriving scope from the session.

| Route | Method | Feature | Notes |
|---|---|---|---|
| `/api/chat/directory` | GET | `chat.view` | org-scoped people search, `q` ≥ 1 char, max 25 results |
| `/api/chat/conversations` | GET | `chat.view` | paginated, ordered by `last_message_at desc` |
| `/api/chat/conversations` | POST | `chat.send` | `{ userId }` → get-or-create canonical direct conversation |
| `/api/chat/conversations/[id]` | GET | `chat.view` | participant-only |
| `/api/chat/conversations/[id]/messages` | GET | `chat.view` | keyset pagination, `cursor` + `limit` ≤ 50 |
| `/api/chat/conversations/[id]/messages` | POST | `chat.send` | rate limited, idempotent |
| `/api/chat/conversations/[id]/read` | POST | `chat.view` | advances the caller's own cursor only |
| `/api/chat/unread-count` | GET | `chat.view` | topbar badge |

Rate limits are applied **in-route, keyed on `tenant:user`**, not via `metadata.rateLimit`: the declarative path keys on client IP and falls back to a single shared `'global'` bucket when `RATE_LIMIT_TRUST_PROXY_DEPTH` is 0 (the default), which would let one chatty user throttle the whole deployment.

| Limiter | Default | Env prefix |
|---|---|---|
| send message | 30 / 10s, block 30s | `CHAT_SEND` |
| create conversation | 20 / 60s | `CHAT_CONVERSATION_CREATE` |
| directory search | 60 / 60s | `CHAT_DIRECTORY` |

### 6. UI

`/backend/chat` (list) and `/backend/chat/[conversationId]` (conversation) — real routes, so deep links, refresh and browser back/forward all work. On `lg:` and up both panes render side by side; below that the list and the conversation are separate screens with a back affordance.

Composed entirely from shipped primitives: `Page`/`PageHeader`/`PageBody` with `fill`, `Avatar`, `SearchInput`, `Textarea`, `Button`/`IconButton`, `Badge`, `Skeleton`, `EmptyState`, `LoadingMessage`, `ErrorMessage`, `Dialog`, `Separator`. No chat-specific design system, no arbitrary values, no hardcoded colours.

Message bodies render as **text nodes**. There is no HTML path, no `dangerouslySetInnerHTML`, and no markdown renderer in Phase 1.

### 7. Integration points

Exactly two, both minimal:

1. **Topbar unread icon** — mirrors `MessagesIcon` in `apps/mercato/src/components/BackendHeaderChrome.tsx`, gated on `hasVisibleRoute(payload.groups, '/backend/chat')` so a tenant without the module never sees it. Sidebar nav rows cannot carry badges without an `AppShell` change, which is an Ask-First surface — the topbar is the shipped convention for unread counts.
2. **"Message" on the staff team-member detail page** — a `<ModuleGate module="chat">`-wrapped link to `/backend/chat/with/<userId>`, sitting beside the "send a message" affordance that page already carries. It resolves the canonical conversation through chat's own `POST /api/chat/conversations`, so staff owns no conversation logic.

   A DataTable row-action injection widget was the first choice, since it couples the modules more loosely. It was rejected after reading `DataTable.resolvedRowActions`: when a host's `rowActions(row)` returns `null` — which the staff table does for its team **group header** rows — the merge path falls through to rendering the injected items alone, so a "Message" action would appear on rows that are not people. Fixing that would mean changing the DataTable merge contract, an Ask-First surface. A gated link on the detail page delivers the same capability without regressing another module's screen.

   `/backend/chat/with/<userId>` is the reusable half of this: any module that knows a colleague's user id can link there, and none of them need to know what a conversation is.

### 8. Notifications

Deliberately **no** `notifications.ts` type and no per-message notification row. The task brief and `packages/core/AGENTS.md` both warn against emitting a chat unread event *and* an identical bell notification. Unread lives in the chat's own cursor model, surfaced through the shared `NotificationCountBadge` primitive. A future "notify me when I'm mentioned" feature is where a notification type earns its place.

## Deliberate omissions

Three files a comparable module ships, and why chat does not:

- **`search.ts`** — indexing private 1:1 messages would make them readable to anyone in the organization holding `chat.view`. Global search gates on entity-type ACL features plus organization scope (`packages/search/.../search/route.ts`), not on per-record participant membership, so there is no way to index chat without breaking its central promise.
- **`notifications.ts`** — a bell entry per message is noise (a twenty-message exchange becomes twenty entries), and the brief warns against emitting both an unread event and an identical notification. Unread lives in the cursor model and surfaces through the shared badge. The consequence is real and stated under Known limitations: someone offline gets no push, only the badge on next login. The Phase 2 answer is a digest or a first-unread-per-conversation notification, not one per message.
- **`extension-points.ts`** — the convention requires a declared host to be bound at a real call site ("it is not a documentation-only inventory"). Chat has no injection slot yet and no consumer asking for one, so declaring hosts would add exactly the unbound inventory the rule forbids. Note the `tasks` module currently declares two hosts whose spot ids appear nowhere else in the tree.

## Out of scope (Phase 1)

Group conversations, channels/spaces, threads, reactions, mentions, attachments, message edit/delete, message search, presence/typing indicators, read receipts beyond the unread cursor, external or guest participants, AI participants, voice/video.

## Known limitations

Found during the review pass and deliberately left, each with the reason and the fix:

1. **Descendant organizations are out of reach.** Chat pins to one organization
   (`resolveActiveOrganizationId`) rather than expanding `Organization.descendantIds`
   the way `resolveOrganizationScopeFilter` does. A manager whose scope spans child
   organizations sees their records everywhere else but cannot message their people.
   This is *stricter* than the platform default, never looser. Widening it is a
   product decision — "who counts as a colleague" — not a bug fix, and it would need
   the participant model to carry the scope a conversation was created under.

2. **Super-admins in "all organizations" mode get no realtime.** The SSE connection
   records `conn.organizationId = ctx.selectedOrganizationId ?? auth.orgId`, but
   `resolveRequestContext` never sets `selectedOrganizationId`, so for a super-admin
   with `om_selected_org=__all__` it is `null` and `matchesAudience` drops every
   frame. REST still works, so chat is silently stale rather than broken. The fix is
   in `packages/events/.../stream/route.ts`, which `packages/events/AGENTS.md` lists
   as an Ask-First surface — so it is reported rather than changed here.

3. **No offline reach.** See Deliberate omissions — a bell entry per message is
   noise, so unread lives only in the badge until next login.

## Future extension points

- `chat_conversations.kind` + nullable `direct_key` — a `'group'` row simply has no `direct_key`, so the canonicality index does not apply to it.
- `chat_participants` is already an N-row membership table with a per-user cursor; group chat needs no schema change there.
- `chat_conversations` can gain `subject_entity_type` / `subject_entity_id` for record-linked discussions, following the FK-id + snapshot convention.
- The event payload already carries `recipientUserIds`, so a group conversation fans out over the same audience contract.

## Performance notes

**Directory search** goes through the shared `search_tokens` index (`findEntityIdsBySearchTokens` in `@open-mercato/shared/lib/search/tokenLookup`) — the same encryption-safe path `/api/auth/users` uses. `User.email` and `User.name` are encrypted with a per-value IV so no SQL predicate can match them; the index stores hashes of the plaintext, so the query resolves candidate ids in SQL and only the handful of rows about to be returned are ever decrypted. A bounded 200-row fallback scan covers the degraded case (search disabled, or a tenant with no tokens yet) and sets `truncated` so the UI says the answer may be partial.

**Unread counting** is a single Kysely `GROUP BY` over a join, not rows loaded and counted in JS. The cursor predicate is `m.created_at > coalesce(p.last_read_at, '-infinity')` rather than an `OR` — a disjunction cannot be pushed into the index bound, so it would scan every message in every one of the caller's conversations on every badge refresh.

**The conversation list is a bounded top-N, not a cursor walk.** Its ordering key
`last_message_at` is rewritten by every send, and a descending keyset cannot return a
row that has moved *above* the cursor — so a conversation bumped between two page
fetches left the un-fetched region, entered the already-loaded (stale) one, and
vanished from the list at the moment it became most relevant. "Load more" grows a
single bounded request instead, capped at 200: every fetch re-reads the current top N
in the current order, which has no gap to fall through and no page boundary to appear
on twice. Keyset pagination stays where it belongs — the message transcript, whose
ordering key is immutable and append-only.

Membership is an `EXISTS` rather than a pre-fetched id list, so the list is one query
instead of two and is bounded regardless of how many conversations the caller has.
Measured at 500 conversations: `Index Scan Backward using
chat_conversations_scope_recent_idx`, 31 rows read, 0.13 ms. Worth recording that the
`IN (…)` form it replaced did **not** defeat the index for ordering as expected — the
planner used the same index scan either way. The real cost it removed was the
unbounded step before it: a sequential scan hydrating 500 participant entities and a
22.5 KB SQL literal, on every request.

**Every compared timestamp comes from the database clock**, via `lib/clock.ts`. A
message's `created_at` is compared against a participant's `last_read_at`, and against
other messages' for pagination — rows written by different application instances. With
`new Date()` each instance's wall clock was the authority, so a fast one could write a
message *ahead* of a read cursor set later by a correctly-clocked instance, and that
message was then permanently invisible to the unread count. `now()` inside the
transaction is one clock for all of them, and being the transaction start time it also
makes a message and the conversation's denormalized copy share one instant.

The value is truncated to milliseconds, which is load-bearing rather than tidiness:
`timestamptz` stores microseconds and a JavaScript `Date` cannot hold them, so an
untruncated value would lose precision the moment the ORM converted it — and a keyset
cursor built from the rounded value would skip every message in the sub-millisecond
window it rounded past. Note that MikroORM's `onCreate` only fires when a property is
null, so the explicit database value stands; `onUpdate` fires unconditionally, which is
why `updated_at` is left to it (audit metadata, never compared).

The read cursor is one `UPDATE` that clamps to `now()`, keeps itself monotonic with
`greatest`, and uses `returning` as its authorization check — closing a matching hole
where a client could send a far-future `readAt` and suppress its own unread count
forever, and removing the read-modify-write race two tabs could hit.

**Client refreshes are coalesced** in a 200ms window at module scope. One send produces several events and the refresh hook is mounted by more than one component; without coalescing each invalidation cancelled the previous one's in-flight refetch (`invalidateQueries` defaults to `cancelRefetch: true`) and restarted work the server had already done.

## Rollout

Two per-tenant steps are needed on any environment that already exists; a freshly
provisioned tenant gets both from setup.

1. `yarn mercato auth sync-role-acls` — grants `chat.view` / `chat.send` to the
   seeded roles listed in `setup.ts`. Existing tenants only receive newly
   declared grants after this runs.
2. `yarn mercato directory sync-tenant-modules` — records the module's
   `defaultEntitlement: 'enabled'` as a `tenant_modules` row. **Without this row
   the module is not entitled and the sidebar entry is filtered out even when
   every ACL grant is present**, which reads exactly like a missing route. The
   no-flag form only records modules with no decision yet, so it never overturns
   a module an operator deliberately turned off.

## Testing

Unit (`__tests__/`): direct-key canonicalization, membership predicate, cursor pagination, unread derivation, validators, module contract (every route/page feature declared in `acl.ts` and granted in `setup.ts`; every i18n key present), module gating (routes vanish when the module is disabled).

Integration (`__integration__/`): the two-user happy path and the cross-tenant/cross-organization denial matrix, including forged conversation ids and forged `organizationId` in request bodies.

## Changelog

- 2026-09-03 — initial spec, written alongside the implementation.
- 2026-09-03 — integration point moved from a staff DataTable row action to a gated button on the staff team-member detail page; rationale recorded above.
- 2026-09-03 — compared timestamps moved onto the database clock at millisecond
  precision; read cursor rewritten as a single clamped, monotonic `UPDATE`.
- 2026-09-03 — conversation list converted from keyset pagination to a bounded
  growing top-N with an `EXISTS` membership predicate, fixing the mutable-cursor skip
  and the unbounded membership fetch together.
- 2026-09-03 — review pass. Directory search moved onto the shared `search_tokens` index; unread counting rewritten as a sargable SQL aggregate; query keys partitioned by organization scope; recipient membership re-checked on every send; rate limits added to the read-cursor and unread-count endpoints with an explicit per-endpoint fail-open/fail-closed policy; `chat.send` gated in the UI; several dead-end UI states fixed (transcript empty state, header retained in loading/error, pagination failure no longer discards loaded data).
- 2026-09-03 — chat granted to every seeded role (adding WMS's `operator` and `supervisor`); Rollout section added after the missing `tenant_modules` entitlement row proved to be why the sidebar entry never appeared.
- 2026-09-03 — empty states reworked: one persistent "New chat" affordance in the list header instead of three on the first-run screen, and the transcript pane no longer tells a new user to "choose someone on the left" when the left pane is empty.
