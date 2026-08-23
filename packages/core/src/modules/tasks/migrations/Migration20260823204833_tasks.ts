import { Migration } from '@mikro-orm/migrations';

export class Migration20260823204833_tasks extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "tasks_labels" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "color" text not null default '#64748B', "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "tasks_labels_scope_idx" on "tasks_labels" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "tasks_labels" add constraint "tasks_labels_scope_name_uq" unique ("tenant_id", "organization_id", "name");`);

    this.addSql(`create table "tasks_milestones" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "name" text not null, "description" text null, "status" text not null default 'planned', "due_date" date null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "tasks_milestones_scope_idx" on "tasks_milestones" ("tenant_id", "organization_id");`);
    this.addSql(`create index "tasks_milestones_project_idx" on "tasks_milestones" ("project_id");`);
    this.addSql(`alter table "tasks_milestones" add constraint "tasks_milestones_status_check" check ("status" in ('planned', 'active', 'completed'));`);

    this.addSql(`create table "tasks_projects" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "key" text not null, "name" text not null, "description" text null, "icon" text not null default '📋', "owner_user_id" uuid null, "start_date" date null, "archived_at" timestamptz null, "is_inbox" boolean not null default false, "task_seq" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "tasks_projects_owner_idx" on "tasks_projects" ("owner_user_id");`);
    this.addSql(`create index "tasks_projects_scope_archived_idx" on "tasks_projects" ("tenant_id", "organization_id", "archived_at");`);
    this.addSql(`create index "tasks_projects_scope_idx" on "tasks_projects" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "tasks_projects" add constraint "tasks_projects_scope_key_uq" unique ("tenant_id", "organization_id", "key");`);

    this.addSql(`create table "tasks_project_docs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "parent_id" uuid null, "author_user_id" uuid null, "title" text not null, "body" text not null default '', "body_plaintext" text not null default '', "position" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "tasks_project_docs_author_idx" on "tasks_project_docs" ("author_user_id");`);
    this.addSql(`create index "tasks_project_docs_parent_idx" on "tasks_project_docs" ("parent_id");`);
    this.addSql(`create index "tasks_project_docs_project_idx" on "tasks_project_docs" ("project_id", "position");`);

    this.addSql(`create table "tasks_project_members" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "user_id" uuid not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "tasks_project_members_user_idx" on "tasks_project_members" ("user_id");`);
    this.addSql(`create index "tasks_project_members_project_idx" on "tasks_project_members" ("project_id");`);
    this.addSql(`alter table "tasks_project_members" add constraint "tasks_project_members_uq" unique ("project_id", "user_id");`);

    this.addSql(`create table "tasks_tasks" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "milestone_id" uuid null, "parent_task_id" uuid null, "number" int not null, "title" text not null, "description" text not null default '', "description_plaintext" text not null default '', "status" text not null default 'backlog', "priority" text not null default 'none', "reviewer_user_id" uuid null, "reporter_user_id" uuid null, "due_date" date null, "due_time" text null, "recurrence_freq" text null, "recurrence_weekday" int null, "recurrence_day_of_month" int null, "completed_at" timestamptz null, "rank" double precision not null default 0, "archived_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "tasks_tasks_scope_idx" on "tasks_tasks" ("tenant_id", "organization_id");`);
    this.addSql(`create index "tasks_tasks_status_due_idx" on "tasks_tasks" ("status", "due_date");`);
    this.addSql(`create index "tasks_tasks_due_date_idx" on "tasks_tasks" ("due_date");`);
    this.addSql(`create index "tasks_tasks_reporter_idx" on "tasks_tasks" ("reporter_user_id");`);
    this.addSql(`create index "tasks_tasks_reviewer_idx" on "tasks_tasks" ("reviewer_user_id");`);
    this.addSql(`create index "tasks_tasks_parent_idx" on "tasks_tasks" ("parent_task_id");`);
    this.addSql(`create index "tasks_tasks_project_milestone_idx" on "tasks_tasks" ("project_id", "milestone_id");`);
    this.addSql(`create index "tasks_tasks_board_idx" on "tasks_tasks" ("project_id", "status", "rank");`);
    this.addSql(`create index "tasks_tasks_project_idx" on "tasks_tasks" ("project_id");`);
    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_project_number_uq" unique ("project_id", "number");`);
    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_status_check" check ("status" in ('backlog', 'pending', 'in_progress', 'blocked', 'review', 'done', 'cancelled'));`);
    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_priority_check" check ("priority" in ('none', 'low', 'medium', 'high', 'urgent'));`);
    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_recurrence_freq_check" check ("recurrence_freq" in ('daily', 'weekdays', 'weekly', 'monthly'));`);

    this.addSql(`create table "tasks_task_assignees" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "user_id" uuid not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "tasks_task_assignees_user_idx" on "tasks_task_assignees" ("user_id");`);
    this.addSql(`create index "tasks_task_assignees_task_idx" on "tasks_task_assignees" ("task_id");`);
    this.addSql(`alter table "tasks_task_assignees" add constraint "tasks_task_assignees_uq" unique ("task_id", "user_id");`);

    this.addSql(`create table "tasks_task_assignment_targets" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "kind" text not null default 'role', "role_id" uuid not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "tasks_task_assignment_targets_role_idx" on "tasks_task_assignment_targets" ("role_id");`);
    this.addSql(`create index "tasks_task_assignment_targets_task_idx" on "tasks_task_assignment_targets" ("task_id");`);
    this.addSql(`alter table "tasks_task_assignment_targets" add constraint "tasks_task_assignment_targets_uq" unique ("task_id", "role_id");`);
    this.addSql(`alter table "tasks_task_assignment_targets" add constraint "tasks_task_assignment_targets_kind_check" check ("kind" in ('role'));`);

    this.addSql(`create table "tasks_task_comments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "author_user_id" uuid null, "body" text not null, "body_plaintext" text not null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "tasks_task_comments_author_idx" on "tasks_task_comments" ("author_user_id");`);
    this.addSql(`create index "tasks_task_comments_task_idx" on "tasks_task_comments" ("task_id", "created_at");`);

    this.addSql(`create table "tasks_task_labels" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "label_id" uuid not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "tasks_task_labels_label_idx" on "tasks_task_labels" ("label_id");`);
    this.addSql(`create index "tasks_task_labels_task_idx" on "tasks_task_labels" ("task_id");`);
    this.addSql(`alter table "tasks_task_labels" add constraint "tasks_task_labels_uq" unique ("task_id", "label_id");`);

    // Invariants MikroORM cannot express, so the migration owns them.

    // Exactly one Inbox per scope. The service creates it lazily and retries on
    // conflict, which only works if the database is the one arbitrating the race.
    this.addSql(`create unique index "tasks_projects_single_inbox_idx" on "tasks_projects" ("tenant_id", "organization_id") where is_inbox and deleted_at is null;`);

    // A due time is a 24h wall clock, stored timezone-neutral.
    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_due_time_check" check ("due_time" is null or "due_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');`);
    // ...and it only means something alongside a date.
    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_due_time_needs_date_check" check ("due_time" is null or "due_date" is not null);`);

    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_recurrence_weekday_check" check ("recurrence_weekday" is null or ("recurrence_weekday" >= 0 and "recurrence_weekday" <= 6));`);
    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_recurrence_day_of_month_check" check ("recurrence_day_of_month" is null or ("recurrence_day_of_month" >= 1 and "recurrence_day_of_month" <= 31));`);

    // Deeper cycles are rejected by the service; this catches the trivial one at
    // the storage layer where no code path can route around it.
    this.addSql(`alter table "tasks_tasks" add constraint "tasks_tasks_parent_not_self_check" check ("parent_task_id" is null or "parent_task_id" <> "id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "tasks_task_labels" cascade;`);
    this.addSql(`drop table if exists "tasks_task_comments" cascade;`);
    this.addSql(`drop table if exists "tasks_task_assignment_targets" cascade;`);
    this.addSql(`drop table if exists "tasks_task_assignees" cascade;`);
    this.addSql(`drop table if exists "tasks_tasks" cascade;`);
    this.addSql(`drop table if exists "tasks_project_members" cascade;`);
    this.addSql(`drop table if exists "tasks_project_docs" cascade;`);
    this.addSql(`drop table if exists "tasks_projects" cascade;`);
    this.addSql(`drop table if exists "tasks_milestones" cascade;`);
    this.addSql(`drop table if exists "tasks_labels" cascade;`);
  }

}
