import { Migration } from '@mikro-orm/migrations';

/**
 * Internal notes: a message in a client conversation that colleagues read and
 * the customer never does. Spec: `.ai/specs/2026-09-29-whatsapp-bridge.md`
 * (Phase 2).
 *
 * Additive: every existing message is `shared`, which is what it always was.
 * The CHECK lets only a colleague's user message be internal, so nothing that
 * arrived from outside — an outsider's message, the company phone's, a system
 * row — can ever be one.
 *
 * The down migration refuses while an internal note exists: dropping the column
 * would turn it into an ordinary message, and an ordinary message in a client
 * conversation is one the transport may send to the customer.
 */
export class Migration20260929161918_chat extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "chat_messages" add "visibility" text not null default 'shared';`);
    this.addSql(`alter table "chat_messages" add constraint "chat_messages_visibility_chk" check ("visibility" in ('shared', 'internal') and ("visibility" = 'shared' or ("kind" = 'user' and "sender_user_id" is not null)));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`do $$ begin
      if exists (select 1 from "chat_messages" where "visibility" = 'internal') then
        raise exception 'chat: internal notes exist; dropping visibility would make them sendable to customers';
      end if;
    end $$;`);
    this.addSql(`alter table "chat_messages" drop constraint if exists "chat_messages_visibility_chk";`);
    this.addSql(`alter table "chat_messages" drop column "visibility";`);
  }

}
