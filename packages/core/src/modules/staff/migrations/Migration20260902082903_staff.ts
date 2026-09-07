import { Migration } from '@mikro-orm/migrations';

export class Migration20260902082903_staff extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "staff_employee_profiles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "member_id" uuid not null, "employee_number" text null, "job_title" text null, "employment_type" text null, "start_date" date null, "end_date" date null, "work_phone" text null, "personal_phone" text null, "personal_email" text null, "date_of_birth" text null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "staff_employee_profiles_member_idx" on "staff_employee_profiles" ("member_id");`);
    this.addSql(`create index "staff_employee_profiles_tenant_org_idx" on "staff_employee_profiles" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "staff_employee_profiles" add constraint "staff_employee_profiles_member_id_foreign" foreign key ("member_id") references "staff_team_members" ("id");`);
    this.addSql(`alter table "staff_employee_profiles" add constraint "staff_employee_profiles_employment_type_check" check ("employment_type" in ('full_time', 'part_time', 'contract', 'intern', 'temporary'));`);

    // One LIVE HR record per member. Partial so clearing a record and entering
    // a fresh one works, matching `staff_time_projects_code_unique_idx`. Not
    // derivable from entity metadata, so it is written here by hand and the
    // snapshot records the plain index only.
    this.addSql(`create unique index "staff_employee_profiles_member_unique_idx" on "staff_employee_profiles" ("member_id") where "deleted_at" is null;`);
  }

}
