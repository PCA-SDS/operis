import { Migration } from '@mikro-orm/migrations';

export class Migration20260913140858_chat extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "chat_participants" add "muted_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "chat_participants" drop column "muted_at";`);
  }

}
