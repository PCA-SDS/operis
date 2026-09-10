import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { EmailAccountingDefaults } from './data/entities'

const defaultPlaceholders = {
  greeting: 'Dear customer,',
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

const defaultLinkPlaceholders = {
  uploadLink: 'https://example.com/company-upload-folder',
  vatPitReportsLink: 'https://example.com/vat-pit-reports-folder',
  taxTrackingLink: 'https://example.com/tax-obligations-tracking-sheet',
  citReportLink: 'https://example.com/cit-report-sheet',
}

export const setup: ModuleSetupConfig = {
  seedDefaults: async ({ em, tenantId, organizationId }) => {
    const defaults = await em.findOne(EmailAccountingDefaults, { tenantId, organizationId })
    if (defaults) return

    em.persist(em.create(EmailAccountingDefaults, {
      tenantId,
      organizationId,
      defaultSenderName: null,
      defaultReplyTo: null,
      placeholders: defaultPlaceholders,
      linkPlaceholders: defaultLinkPlaceholders,
      rules: {
        selection: 'rules-match-accounting-metadata',
        note: 'Rules are stored now and will drive workflow template selection in a later integration step.',
      },
    }))
    await em.flush()
  },

  defaultRoleFeatures: {
    admin: ['email.*'],
    employee: ['email.templates.view'],
  },
}

export default setup
