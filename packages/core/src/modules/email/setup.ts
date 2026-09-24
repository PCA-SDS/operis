import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { EmailAccountingDefaults, EmailTemplate } from './data/entities'
import { Organization, Tenant } from '../directory/data/entities'
import { pcaAccountingSourceTemplates } from './data/pca-source-templates'

const defaultPlaceholders = {
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

function templateBlocks(templateKey: string, bodyHtml: string) {
  return [{
    id: `pca-${templateKey}-body`,
    type: 'rich-text-html',
    label: 'Body text',
    props: { html: bodyHtml, order: 0 },
    children: [],
  }]
}

async function seedPcaTemplates(em: EntityManager, tenantId: string, organizationId: string) {
  const tenant = await em.findOne(Tenant, tenantId)
  if (tenant?.name !== 'PCA Company Services') return

  for (const template of pcaAccountingSourceTemplates) {
    const existing = await em.findOne(EmailTemplate, {
      tenantId,
      organizationId,
      templateKey: template.templateKey,
      deletedAt: null,
    })
    if (existing) continue

    em.persist(em.create(EmailTemplate, {
      tenantId,
      organizationId,
      templateKey: template.templateKey,
      name: template.name,
      description: template.description,
      category: template.category,
      status: 'published',
      subject: template.subject,
      design: { version: 1, source: 'pca-accounting-seed', body: { format: 'blocks+html', html: template.bodyHtml } },
      blocks: templateBlocks(template.templateKey, template.bodyHtml),
      variables: template.fields,
      accountingMetadata: {
        workflowKey: template.rules.type,
        ruleKeys: Object.entries(template.rules).map(([key, value]) => `${key}:${String(value)}`),
        migratedFrom: 'pca-accounting',
        sourceTemplateId: template.templateKey,
        fields: template.fields,
        defaultValues: template.defaultValues,
        variableTypes: template.variableTypes,
        rules: template.rules,
        ruleNotes: template.ruleNotes,
        sortOrder: template.sortOrder,
        isActive: template.isActive,
      },
    }))
  }
}

async function seedPcaTemplatesForAllTenants(em: EntityManager) {
  const tenant = await em.findOne(Tenant, { name: 'PCA Company Services' })
  if (!tenant) return
  const organization = await em.findOne(Organization, { tenant: tenant.id })
  if (!organization) return
  await seedPcaTemplates(em, tenant.id, organization.id)
}

export const setup: ModuleSetupConfig = {
  onTenantCreated: async ({ em, tenantId, organizationId }) => {
    await seedPcaTemplates(em, tenantId, organizationId)
    await em.flush()
  },

  seedDefaults: async ({ em, tenantId, organizationId }) => {
    const defaults = await em.findOne(EmailAccountingDefaults, { tenantId, organizationId })
    if (!defaults) {
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
    }
    await seedPcaTemplates(em, tenantId, organizationId)
    await seedPcaTemplatesForAllTenants(em)
    await em.flush()
  },

  defaultRoleFeatures: {
    admin: ['email.*'],
    employee: ['email.templates.view'],
  },
}

export default setup
