import { Migration } from '@mikro-orm/migrations';

/**
 * Chats moved in from a personal WhatsApp. Spec:
 * `.ai/specs/2026-09-29-whatsapp-bridge.md` (Phase 5).
 *
 * `project_from` is the moment of the move; the projector drops anything said
 * in the room before it. The down migration refuses while a moved chat exists:
 * without the column, the next sync would read the employee's earlier messages
 * into Operis.
 */
export class Migration20260929172459_chat_matrix extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "chat_matrix_rooms" add "project_from" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`do $$ begin
      if exists (select 1 from "chat_matrix_rooms" where "project_from" is not null) then
        raise exception 'chat_matrix: chats were moved in from personal WhatsApp; dropping project_from would read their earlier messages into Operis';
      end if;
    end $$;`);
    this.addSql(`alter table "chat_matrix_rooms" drop column "project_from";`);
  }

}
