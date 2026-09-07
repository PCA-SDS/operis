import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { EmailAccountingDefaults, EmailTemplate } from './data/entities'

const pcaDefaultPlaceholders = {
  greeting: 'Dear Client,',
  companyCode: 'ACME',
  accountingPeriod: 'Q1 2026',
  quarterShort: 'Q1',
  quarterPeriod: 'Quarter 1 2026',
  bankStatementPeriod: '01/01/2026 to 31/03/2026',
  submissionDeadline: 'April 7, 2026',
  declarationDeadline: 'April 29, 2026',
  paymentDeadline: 'April 29, 2026',
  taxQuarter: 'Q1',
}

const pcaDefaultLinks = {
  uploadLink: 'https://example.com/company-upload-folder',
  vatPitReportsLink: 'https://example.com/vat-pit-reports-folder',
  taxTrackingLink: 'https://example.com/tax-obligations-tracking-sheet',
  citReportLink: 'https://example.com/cit-report-sheet',
}

const pcaStarterTemplates = [
  {
    templateKey: 'accounting.quarterly-info',
    name: 'Mau email xin thong tin hang quy (Mau chung)',
    description: 'Request quarterly accounting documents from a client.',
    subject: '[PCACS][{{companyCode}}] Accounting {{accountingPeriod}}',
    fields: ['accountingPeriod', 'quarterShort', 'bankStatementPeriod', 'uploadLink', 'submissionDeadline'],
    rules: { type: 'request_documents' },
    sortOrder: 1,
    html: '<p>{{greeting}}</p><p>A new quarter will come to an end soon. Please prepare supporting documents, VAT invoices, bank statements for {{bankStatementPeriod}}, new commercial contracts, and receivable/payable tracking files.</p><p>Upload folder: <a href="{{uploadLink}}">{{uploadLink}}</a></p><p>Please send them before {{submissionDeadline}}.</p><p>Best regards,</p>',
  },
  {
    templateKey: 'accounting.quarterly-tax-with-activity',
    name: 'Email bao cao thue quy - cong ty co phat sinh',
    description: 'Quarterly VAT and PIT report email for companies with payable taxes.',
    subject: 'Email bao cao thue quy - cong ty co phat sinh',
    fields: ['quarterPeriod', 'vatPitReportsLink', 'taxTrackingLink', 'declarationDeadline', 'vatPayable', 'pitPayable', 'totalTaxPayable', 'paymentDeadline'],
    rules: { type: 'tax_report', hasTaxPayable: true, hasCit: false },
    sortOrder: 2,
    html: '<p>{{greeting}}</p><p>PCA has prepared your accounting for {{quarterPeriod}}, including PIT declaration, VAT declaration, sales invoices report, expenses invoices report, and taxes obligations tracking.</p><p>VAT and PIT reports: <a href="{{vatPitReportsLink}}">{{vatPitReportsLink}}</a></p><p>Taxes obligations tracking: <a href="{{taxTrackingLink}}">{{taxTrackingLink}}</a></p><p>Declaration deadline: {{declarationDeadline}}.</p><p>VAT: {{vatPayable}}<br>PIT: {{pitPayable}}<br>Total: {{totalTaxPayable}}</p><p>Payment deadline: {{paymentDeadline}}.</p>',
  },
  {
    templateKey: 'accounting.quarterly-tax-no-activity',
    name: 'Email bao cao thue quy - cong ty khong phat sinh',
    description: 'Quarterly report email when no taxes are payable.',
    subject: 'Email bao cao thue quy - cong ty khong phat sinh',
    fields: ['quarterPeriod', 'vatPitReportsLink', 'taxTrackingLink', 'declarationDeadline'],
    rules: { type: 'tax_report', hasTaxPayable: false, hasCit: false },
    sortOrder: 3,
    html: '<p>{{greeting}}</p><p>PCA has prepared your accounting for {{quarterPeriod}}.</p><p>VAT and PIT reports: <a href="{{vatPitReportsLink}}">{{vatPitReportsLink}}</a></p><p>Taxes obligations tracking: <a href="{{taxTrackingLink}}">{{taxTrackingLink}}</a></p><p>Declaration deadline: {{declarationDeadline}}.</p><p>Taxes payable: 0 VND</p>',
  },
  {
    templateKey: 'accounting.q3-cit',
    name: 'Email bao cao thue danh cho Q3 - Co bao CIT phat sinh',
    description: 'Q3 tax report with provisional CIT payment details.',
    subject: 'Email bao cao thue danh cho Q3 - Co bao CIT phat sinh',
    fields: ['quarterPeriod', 'vatPitReportsLink', 'taxTrackingLink', 'citReportLink', 'declarationDeadline', 'vatPayable', 'pitPayable', 'totalTaxPayable', 'provisionalCit', 'citYear', 'citFirstPaymentDeadline', 'citRemainingPaymentDeadline', 'paymentDeadline'],
    rules: { type: 'tax_report', hasTaxPayable: true, hasCit: true, quarter: 'Q3' },
    sortOrder: 4,
    html: '<p>{{greeting}}</p><p>PCA has prepared your accounting for {{quarterPeriod}}, including provisional Corporate Income Tax (CIT) report.</p><p>VAT/PIT reports: <a href="{{vatPitReportsLink}}">{{vatPitReportsLink}}</a></p><p>Tax tracking: <a href="{{taxTrackingLink}}">{{taxTrackingLink}}</a></p><p>CIT report: <a href="{{citReportLink}}">{{citReportLink}}</a></p><p>Provisional CIT: {{provisionalCit}}</p>',
  },
  {
    templateKey: 'accounting.q4-cit',
    name: 'Mau email bao cao thue cho Q4 - Co phat sinh CIT',
    description: 'Q4 tax report with CIT annual payment details.',
    subject: 'Mau email bao cao thue cho Q4 - Co phat sinh CIT',
    fields: ['quarterPeriod', 'vatPitReportsLink', 'taxTrackingLink', 'citReportLink', 'declarationDeadline', 'vatPayable', 'pitPayable', 'citPayable', 'totalTaxPayable', 'paymentDeadline', 'citPaymentDeadline'],
    rules: { type: 'tax_report', hasTaxPayable: true, hasCit: true, quarter: 'Q4' },
    sortOrder: 5,
    html: '<p>{{greeting}}</p><p>PCA has prepared your accounting for {{quarterPeriod}}, including annual CIT payment details.</p><p>VAT/PIT reports: <a href="{{vatPitReportsLink}}">{{vatPitReportsLink}}</a></p><p>Tax tracking: <a href="{{taxTrackingLink}}">{{taxTrackingLink}}</a></p><p>CIT report: <a href="{{citReportLink}}">{{citReportLink}}</a></p><p>CIT payable: {{citPayable}}<br>Total: {{totalTaxPayable}}</p>',
  },
]

export const setup: ModuleSetupConfig = {
  seedDefaults: async ({ em, tenantId, organizationId }) => {
    const defaults = await em.findOne(EmailAccountingDefaults, { tenantId, organizationId })
    if (!defaults) {
      em.persist(em.create(EmailAccountingDefaults, {
        tenantId,
        organizationId,
        defaultSenderName: 'PCA Accounting',
        defaultReplyTo: null,
        placeholders: pcaDefaultPlaceholders,
        linkPlaceholders: pcaDefaultLinks,
        rules: {
          selection: 'rules-match-accounting-metadata',
          note: 'Rules are stored now and will drive workflow template selection in a later integration step.',
        },
      }))
    }

    for (const starter of pcaStarterTemplates) {
      const existing = await em.findOne(EmailTemplate, {
        tenantId,
        organizationId,
        templateKey: starter.templateKey,
        deletedAt: null,
      })
      if (existing) continue
      em.persist(em.create(EmailTemplate, {
        tenantId,
        organizationId,
        templateKey: starter.templateKey,
        name: starter.name,
        description: starter.description,
        category: 'accounting',
        status: 'draft',
        subject: starter.subject,
        preheader: null,
        variables: starter.fields,
        blocks: [{ id: 'body-html', type: 'rich-text-html', label: 'Body', props: { html: starter.html, order: 0 }, children: [] }],
        design: { version: 1, source: 'pca-accounting-starter', body: { format: 'html', html: starter.html } },
        accountingMetadata: {
          workflowKey: String(starter.rules.type),
          ruleKeys: Object.entries(starter.rules).map(([key, value]) => `${key}:${String(value)}`),
          migratedFrom: 'pca-accounting',
          sourceTemplateId: starter.templateKey.replace(/^accounting\./, ''),
          fields: starter.fields,
          defaultValues: Object.fromEntries(starter.fields.map((field) => [field, { ...pcaDefaultPlaceholders, ...pcaDefaultLinks }[field] ?? ''])),
          rules: starter.rules,
          sortOrder: starter.sortOrder,
          isActive: true,
        },
      }))
    }
    await em.flush()
  },

  defaultRoleFeatures: {
    admin: ['email.*'],
    employee: ['email.templates.view'],
  },
}

export default setup
