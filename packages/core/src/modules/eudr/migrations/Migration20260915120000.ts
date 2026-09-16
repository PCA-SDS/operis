import { Migration } from '@mikro-orm/migrations';

export class Migration20260915120000 extends Migration {

  override async up(): Promise<void> {
    // The compliance-overview widget runs one COUNT per submission status scoped
    // to the viewer's tenant/org. The table previously had no tenant or
    // organization index at all, so every count was a full sequential scan.
    this.addSql(
      `create index "eudr_submissions_tenant_org_status_idx" on "eudr_evidence_submissions" ("tenant_id", "organization_id", "status") where "deleted_at" is null;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "eudr_submissions_tenant_org_status_idx";`);
  }

}
