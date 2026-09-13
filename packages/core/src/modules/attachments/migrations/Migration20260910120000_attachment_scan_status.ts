import { Migration } from '@mikro-orm/migrations'

/**
 * The malware-scan lifecycle for attachments.
 *
 * The column defaults to `pending`, so a row created from now on is closed
 * until something clears it. Every row that already exists is backfilled to
 * `clean` in the same statement: those files were readable before this column
 * existed, they are served by catalog, sales, sync_excel, warranty_claims and
 * messages today, and retroactively quarantining all of them would take a
 * working system down without making anything safer.
 *
 * The index is partial. Only `pending` rows are ever looked up by status — that
 * is the scan queue's own query — while `clean` is the overwhelming majority and
 * is always reached by id. Indexing the whole column would be a large index
 * answering a question nobody asks.
 */
export class Migration20260910120000_attachment_scan_status extends Migration {
  override up(): void {
    this.addSql(`alter table "attachments" add column "scan_status" text not null default 'pending';`)
    this.addSql(`alter table "attachments" add column "scanned_at" timestamptz null;`)
    this.addSql(`alter table "attachments" add column "scanner" text null;`)

    // Everything that predates the column was already being served.
    this.addSql(`update "attachments" set "scan_status" = 'clean', "scanned_at" = "created_at", "scanner" = 'legacy';`)

    this.addSql(`create index "attachments_scan_status_idx" on "attachments" ("scan_status") where "scan_status" <> 'clean';`)
  }

  override down(): void {
    this.addSql(`drop index if exists "attachments_scan_status_idx";`)
    this.addSql(`alter table "attachments" drop column if exists "scanner";`)
    this.addSql(`alter table "attachments" drop column if exists "scanned_at";`)
    this.addSql(`alter table "attachments" drop column if exists "scan_status";`)
  }
}

export default Migration20260910120000_attachment_scan_status
