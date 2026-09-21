import { Migration } from '@mikro-orm/migrations'

/**
 * At most one PENDING payment confirmation per invoice (or per installment).
 *
 * `request()` supersedes prior pending rows before inserting the replacement, but that is a
 * check-then-write: under READ COMMITTED two concurrent requests each fail to see the other's
 * uncommitted row and both commit. Two live tokens then make `findIncoming`'s
 * `confirmations.length !== 1` guard reject the receiver's Accept for good.
 *
 * Two indexes rather than one because `installment_id` is nullable and Postgres treats NULLs as
 * distinct in a unique index, so a single composite would not constrain whole-invoice rows.
 */
export class Migration20260916120000_invoice_payment_confirmation_pending_unique extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`create unique index if not exists "invoice_payment_confirmations_pending_installment_uq" on "invoice_payment_confirmations" ("invoice_id", "installment_id") where "status" = 'PENDING' and "installment_id" is not null;`)
    this.addSql(`create unique index if not exists "invoice_payment_confirmations_pending_invoice_uq" on "invoice_payment_confirmations" ("invoice_id") where "status" = 'PENDING' and "installment_id" is null;`)
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "invoice_payment_confirmations_pending_installment_uq";`)
    this.addSql(`drop index if exists "invoice_payment_confirmations_pending_invoice_uq";`)
  }
}
