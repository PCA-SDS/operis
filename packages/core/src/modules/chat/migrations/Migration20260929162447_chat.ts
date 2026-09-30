import { Migration } from '@mikro-orm/migrations';

/**
 * Access levels in client conversations: `viewer` (reads, writes internal
 * notes), `participant` (also answers the client), `manager` (also decides who
 * is in it). Spec: `.ai/specs/2026-09-29-whatsapp-bridge.md` (Phase 3).
 *
 * Every colleague already in a client conversation keeps what they could do
 * before — everything — so they are backfilled as `manager`. Directs, spaces
 * and outsiders' rows stay NULL; the CHECK keeps an outsider from ever holding
 * a level.
 */
export class Migration20260929162447_chat extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "chat_participants" add "access" text null;`);
    this.addSql(`alter table "chat_participants" add constraint "chat_participants_access_chk" check ("access" is null or ("access" in ('viewer', 'participant', 'manager') and "user_id" is not null));`);
    this.addSql(`update "chat_participants" p
      set "access" = 'manager'
      from "chat_conversations" c
      where c."id" = p."conversation_id"
        and c."kind" = 'external'
        and p."user_id" is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "chat_participants" drop constraint if exists "chat_participants_access_chk";`);
    this.addSql(`alter table "chat_participants" drop column "access";`);
  }

}
