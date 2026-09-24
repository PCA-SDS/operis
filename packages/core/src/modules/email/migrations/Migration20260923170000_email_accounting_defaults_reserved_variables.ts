import { Migration } from '@mikro-orm/migrations'

export class Migration20260923170000_email_accounting_defaults_reserved_variables extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      update "email_accounting_defaults"
      set
        "placeholders" = coalesce("placeholders", '{}'::jsonb) - array['companyName', 'companyCode', 'companyEmail', 'contactNames', 'recipientEmails', 'greeting'],
        "link_placeholders" = coalesce("link_placeholders", '{}'::jsonb) - array['companyName', 'companyCode', 'companyEmail', 'contactNames', 'recipientEmails', 'greeting'],
        "updated_at" = now()
      where
        coalesce("placeholders", '{}'::jsonb) ?| array['companyName', 'companyCode', 'companyEmail', 'contactNames', 'recipientEmails', 'greeting']
        or coalesce("link_placeholders", '{}'::jsonb) ?| array['companyName', 'companyCode', 'companyEmail', 'contactNames', 'recipientEmails', 'greeting'];
    `)
  }

  async down(): Promise<void> {}
}
