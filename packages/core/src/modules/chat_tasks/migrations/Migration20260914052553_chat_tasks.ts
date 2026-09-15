import { Migration } from '@mikro-orm/migrations';

/**
 * The link between a chat conversation and a task, and the ledger that makes
 * creating one safe to repeat.
 *
 * Two new tables and **no change to any `chat_*` or `tasks_*` table**. That is what
 * makes "removing this integration cannot break either module" a structural fact
 * rather than a promise: `down()` drops two tables nothing else reads, and every
 * CHECK constraint, composite foreign key and partial index the other two modules
 * depend on is untouched.
 *
 * There are deliberately **no foreign keys to `chat_conversations`,
 * `chat_messages` or `tasks_tasks`**. Modules do not form ORM relations across
 * their boundary here, and a hard FK would be worse than merely unconventional: it
 * would let this table refuse a chat-side or task-side delete, so disabling an
 * integration could block deleting a conversation. The references are plain uuids,
 * validated at the service layer — the same choice `chat_matrix` makes for rooms.
 *
 * Four constraints carry guarantees the application cannot make alone:
 *
 * - **`chat_task_links_scope_uq`** — one link per (scope, conversation, task) while
 *   it is live. This is what makes "link this task here" converge: two clicks race,
 *   the loser raises 23505, and both return the row that won instead of stacking two
 *   cards for one task in one room. Partial on `deleted_at is null`, so unlinking
 *   and linking again is allowed — the index prevents duplicates, not history.
 * - **`chat_task_links_card_uq`** — one link per card row. Without it a republish
 *   after a partial failure could point two links at the same message, and the
 *   transcript would render one card twice for two different tasks.
 * - **`chat_task_requests_key_uq`** — the idempotency key, scoped to the actor
 *   inside their tenant and organization. Creating a task, linking it and posting
 *   its card cannot share one transaction (the task command holds its own
 *   project-number lock and announces its own assignment), so the sequence is made
 *   safe to repeat instead: the claim either succeeds once or finds the row the
 *   first attempt wrote. The actor is in the key so one person's retry can never
 *   replay another person's result.
 * - **`chat_task_requests_status_check`** — a frozen vocabulary written into rows,
 *   guarded the way the tasks module guards its own statuses.
 *
 * Both partial indexes on `chat_task_links` are `where deleted_at is null` for the
 * same reason: every read filters on it, so indexing the soft-deleted rows would
 * pay for rows no query wants.
 */
export class Migration20260914052553_chat_tasks extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "chat_task_links" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "conversation_id" uuid not null, "task_id" uuid not null, "source_message_id" uuid null, "card_message_id" uuid null, "created_by_user_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "chat_task_links_card_uq" on "chat_task_links" ("card_message_id") where "card_message_id" is not null;`);
    this.addSql(`create index "chat_task_links_task_idx" on "chat_task_links" ("tenant_id", "organization_id", "task_id") where "deleted_at" is null;`);
    this.addSql(`create index "chat_task_links_conversation_idx" on "chat_task_links" ("tenant_id", "organization_id", "conversation_id", "created_at") where "deleted_at" is null;`);
    this.addSql(`create index "chat_task_links_scope_idx" on "chat_task_links" ("tenant_id", "organization_id");`);
    this.addSql(`create unique index "chat_task_links_scope_uq" on "chat_task_links" ("tenant_id", "organization_id", "conversation_id", "task_id") where "deleted_at" is null;`);

    this.addSql(`create table "chat_task_requests" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "actor_user_id" uuid not null, "idempotency_key" text not null, "request_hash" text not null, "conversation_id" uuid null, "status" text not null default 'pending', "task_id" uuid null, "link_id" uuid null, "failure_reason" text null, "created_at" timestamptz not null, "updated_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "chat_task_requests_scope_idx" on "chat_task_requests" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "chat_task_requests" add constraint "chat_task_requests_key_uq" unique ("tenant_id", "organization_id", "actor_user_id", "idempotency_key");`);
    this.addSql(`alter table "chat_task_requests" add constraint "chat_task_requests_status_check" check ("status" in ('pending', 'completed', 'failed'));`);
  }

  override down(): void | Promise<void> {
    // Two tables, nothing else. Rolling the integration back leaves chat and tasks
    // exactly as they were — which is the whole point of owning the link here rather
    // than adding a column to either of them.
    this.addSql(`drop table if exists "chat_task_requests" cascade;`);
    this.addSql(`drop table if exists "chat_task_links" cascade;`);
  }

}
