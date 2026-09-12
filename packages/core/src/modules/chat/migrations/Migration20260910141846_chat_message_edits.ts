import { Migration } from '@mikro-orm/migrations'

/**
 * When the author last rewrote a message, so the transcript can say "(edited)".
 *
 * Deliberately not reusing `updated_at`. That column carries an `onUpdate` hook
 * that fires on every flush touching the row — a reaction, a pin, a search
 * document backfill — so it answers "was this row written to", which is a
 * different question from "did a person change these words". Only the edit
 * command writes this one, which is what makes the marker honest.
 *
 * Nullable with no default and no backfill: every message that exists today was
 * never edited, and null says exactly that.
 */
export class Migration20260910141846_chat_message_edits extends Migration {
  override up(): void {
    this.addSql(`alter table "chat_messages" add "edited_at" timestamptz null;`)
  }

  override down(): void {
    this.addSql(`alter table "chat_messages" drop column "edited_at";`)
  }
}
