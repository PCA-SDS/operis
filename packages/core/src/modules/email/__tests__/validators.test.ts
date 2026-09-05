import {
  createEmailTemplateSchema,
  emailAccountingDefaultsSchema,
  updateEmailTemplateSchema,
} from '../data/validators'

const baseTemplate = {
  template_key: 'quarterly-tax-with-activity',
  name: 'Email bao cao thue quy - cong ty co phat sinh',
  description: 'Quarterly VAT and PIT report email for companies with payable taxes.',
  category: 'accounting',
  status: 'published',
  subject: 'Email bao cao thue quy - cong ty co phat sinh',
  preheader: '',
  variables: ['quarterPeriod', 'vatPitReportsLink', 'taxTrackingLink', 'declarationDeadline'],
  design: { source: 'pca-accounting-rich-html' },
  blocks: [
    {
      id: 'body',
      type: 'rich_text',
      label: 'Email body',
      props: { html: '<p>{{greeting}}</p><p>{{quarterPeriod}}</p>' },
      children: [],
    },
  ],
  accounting_metadata: {
    workflowKey: 'tax_report',
    ruleKeys: ['type:tax_report', 'hasTaxPayable:true'],
    migratedFrom: 'pca-accounting',
    sourceTemplateId: 'quarterly-tax-with-activity',
    fields: ['quarterPeriod', 'vatPitReportsLink'],
    defaultValues: {
      quarterPeriod: 'Quarter 1 2026',
      vatPitReportsLink: 'https://example.com/vat-pit-reports-folder',
    },
    rules: { type: 'tax_report', hasTaxPayable: true, hasCit: false },
    sortOrder: 2,
    isActive: true,
  },
}

describe('email validators', () => {
  it('accepts PCA accounting template payloads with rules, defaults, and builder blocks', () => {
    expect(createEmailTemplateSchema.parse(baseTemplate)).toMatchObject({
      template_key: 'quarterly-tax-with-activity',
      status: 'published',
      variables: ['quarterPeriod', 'vatPitReportsLink', 'taxTrackingLink', 'declarationDeadline'],
      accounting_metadata: {
        migratedFrom: 'pca-accounting',
        rules: { type: 'tax_report', hasTaxPayable: true, hasCit: false },
        defaultValues: {
          vatPitReportsLink: 'https://example.com/vat-pit-reports-folder',
        },
      },
    })
  })

  it('rejects unsafe template keys and over-broad metadata', () => {
    expect(() => createEmailTemplateSchema.parse({ ...baseTemplate, template_key: '../secret' })).toThrow()
    expect(() => createEmailTemplateSchema.parse({ ...baseTemplate, unknown: true })).toThrow()
  })

  it('allows optimistic-lock updates for existing templates', () => {
    const parsed = updateEmailTemplateSchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      expected_updated_at: '2026-09-04T00:00:00.000Z',
      subject: 'Updated {{quarterPeriod}}',
    })

    expect(parsed).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      expected_updated_at: '2026-09-04T00:00:00.000Z',
      subject: 'Updated {{quarterPeriod}}',
    })
  })

  it('stores tenant-owned accounting defaults with placeholder links only', () => {
    const parsed = emailAccountingDefaultsSchema.parse({
      default_sender_name: 'PCA Accounting',
      default_reply_to: 'accounting@example.com',
      placeholders: { greeting: 'Dear Mr. Client,' },
      link_placeholders: { vatPitReportsLink: 'https://example.com/vat-pit-reports-folder' },
      rules: { tax_report: { defaultDeadlineDays: 7 } },
    })

    expect(parsed.link_placeholders).toEqual({
      vatPitReportsLink: 'https://example.com/vat-pit-reports-folder',
    })
  })
})
