import { Migration } from '@mikro-orm/migrations'

export class Migration20260925034700_planner_backfill extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`
      insert into "planner_organization_availability_settings" (
        "tenant_id",
        "organization_id",
        "operating_hours_rule_set_id",
        "last_customer_before_close_minutes",
        "time_overflow_minutes",
        "created_at",
        "updated_at"
      )
      select
        rule_set."tenant_id",
        rule_set."organization_id",
        rule_set."id",
        0,
        0,
        now(),
        now()
      from "planner_availability_rule_sets" rule_set
      join (
        select "tenant_id", "organization_id"
        from "planner_availability_rule_sets"
        where "name" = 'Standard Business Hours'
          and "deleted_at" is null
        group by "tenant_id", "organization_id"
        having count(*) = 1
      ) unique_rule_set
        on unique_rule_set."tenant_id" = rule_set."tenant_id"
       and unique_rule_set."organization_id" = rule_set."organization_id"
      where rule_set."name" = 'Standard Business Hours'
        and rule_set."deleted_at" is null
      on conflict ("tenant_id", "organization_id") do nothing;
    `)
  }
}
