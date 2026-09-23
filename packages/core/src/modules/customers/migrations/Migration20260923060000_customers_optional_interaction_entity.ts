import { Migration } from '@mikro-orm/migrations'

/**
 * `customer_interactions.entity_id` becomes optional.
 *
 * An interaction is usually about a customer, and when it is, the link is what
 * puts it on that customer's timeline and drives their `next_interaction_*`
 * projection. But the calendar is also used for internal work — a team sync, an
 * internal deadline, a personal block — and those are real entries with no
 * customer to name. Requiring one made the calendar unusable for them.
 *
 * Widening only: every existing row keeps its entity, and every reader that
 * filters by `entity_id` is unaffected because NULL never matches an equality
 * filter, so internal entries simply do not appear on customer timelines.
 */
export class Migration20260923060000_customers_optional_interaction_entity extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "customer_interactions" alter column "entity_id" drop not null;')
    // The foreign key has to follow the column: while `entity_id` was NOT NULL
    // it could only restrict, and a nullable link should clear itself when the
    // customer is deleted rather than block the delete.
    this.addSql('alter table "customer_interactions" drop constraint if exists "customer_interactions_entity_id_foreign";')
    this.addSql('alter table "customer_interactions" add constraint "customer_interactions_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on delete set null;')
  }

  override async down(): Promise<void> {
    // Rows created without a customer cannot be given one, so they are removed
    // rather than guessed at — this is the only way back to a NOT NULL column.
    this.addSql('delete from "customer_interactions" where "entity_id" is null;')
    this.addSql('alter table "customer_interactions" drop constraint if exists "customer_interactions_entity_id_foreign";')
    this.addSql('alter table "customer_interactions" add constraint "customer_interactions_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id");')
    this.addSql('alter table "customer_interactions" alter column "entity_id" set not null;')
  }
}
