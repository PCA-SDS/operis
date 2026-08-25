import { Migration } from '@mikro-orm/migrations';

export class Migration20260824222711_attachments extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create index "attachments_tenant_file_size_idx" on "attachments" ("tenant_id", "file_size");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "attachments_tenant_file_size_idx";`);
  }

}
