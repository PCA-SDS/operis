import { Migration } from '@mikro-orm/migrations';

export class Migration20260904090000ResourcesResourceSortOrder extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "resources_resources" add column "sort_order" int not null default 0;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "resources_resources" drop column "sort_order";`);
  }

}
