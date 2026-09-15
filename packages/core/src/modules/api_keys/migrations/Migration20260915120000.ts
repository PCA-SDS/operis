import { Migration } from '@mikro-orm/migrations';

export class Migration20260915120000 extends Migration {

  override async up(): Promise<void> {
    // `findApiKeyBySessionToken` is on the hot path for every AI-chat and MCP
    // request, and session keys are minted per chat session and only soft-deleted
    // on expiry — so this lookup was a sequential scan over a monotonically
    // growing table. Partial-unique mirrors "api_keys_opencode_session_id_uq".
    this.addSql(
      `create unique index "api_keys_session_token_uq" on "api_keys" ("session_token") where "session_token" is not null and "deleted_at" is null;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "api_keys_session_token_uq";`);
  }

}
