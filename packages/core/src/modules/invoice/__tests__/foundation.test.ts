import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { asValue, createContainer, InjectionMode } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

import { features } from '../acl'
import { register } from '../di'
import {
  Invoice,
  InvoiceAutoPaidTaxCode,
  InvoiceCompany,
  InvoiceCompanyEmail,
  InvoiceCompanyRegistry,
  InvoiceInstallment,
  InvoiceLineItem,
  InvoicePaymentConfirmation,
  InvoiceSyncJob,
} from '../data/entities'
import { metadata } from '../index'
import searchConfig from '../search'
import setup from '../setup'
import type { InvoiceScopedPersistenceService } from '../services/scoped-persistence-service'
import type { InvoicePartnerTermsService } from '../services/partner-terms-service'

const MODULE_ROOT = join(__dirname, '..')
const MIGRATION_SOURCE = readFileSync(
  join(MODULE_ROOT, 'migrations', 'Migration20260825105741_invoice.ts'),
  'utf8',
)
const ENTITY_SOURCE = readFileSync(join(MODULE_ROOT, 'data', 'entities.ts'), 'utf8')

const TARGET_TABLES = [
  'invoice_auto_paid_tax_codes',
  'invoice_companies',
  'invoice_invoices',
  'invoice_company_emails',
  'invoice_company_registry',
  'invoice_installments',
  'invoice_invoice_line_items',
  'invoice_payment_confirmations',
  'invoice_sync_jobs',
] as const

const ENTITY_EXPORTS = {
  Invoice,
  InvoiceAutoPaidTaxCode,
  InvoiceCompany,
  InvoiceCompanyEmail,
  InvoiceCompanyRegistry,
  InvoiceInstallment,
  InvoiceLineItem,
  InvoicePaymentConfirmation,
  InvoiceSyncJob,
} as const

function createTestContainer(): AppContainer {
  const container = createContainer<Record<string, unknown>>({
    injectionMode: InjectionMode.PROXY,
  }) as unknown as AppContainer
  const em = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
  } as unknown as EntityManager
  container.register({ em: asValue(em) })
  register(container)
  return container
}

describe('invoice module foundation', () => {
  it('exposes module metadata and auto-discovery convention files', () => {
    expect(metadata).toMatchObject({
      name: 'invoice',
      title: 'Invoice',
      defaultEntitlement: 'disabled',
    })

    for (const relativePath of [
      'index.ts',
      'acl.ts',
      'setup.ts',
      'di.ts',
      'events.ts',
      'search.ts',
      join('api', 'openapi.ts'),
      join('data', 'entities.ts'),
      join('data', 'validators.ts'),
    ]) {
      expect(existsSync(join(MODULE_ROOT, relativePath))).toBe(true)
    }
  })

  it('registers the expected ACL features and default setup grants', () => {
    expect(features.map((feature) => feature.id).sort()).toEqual([
      'invoice.ai.view',
      'invoice.delete',
      'invoice.manage',
      'invoice.payment_confirmations.manage',
      'invoice.settings.manage',
      'invoice.sync',
      'invoice.view',
    ])

    expect(setup.defaultRoleFeatures?.admin).toEqual(['invoice.*'])
    expect(setup.defaultRoleFeatures?.employee).toEqual([
      'invoice.view',
      'invoice.manage',
      'invoice.payment_confirmations.manage',
    ])
  })

  it('resolves DI services and entity tokens', () => {
    const container = createTestContainer()

    const service = container.resolve<InvoiceScopedPersistenceService>('invoiceScopedPersistenceService')
    expect(typeof service.findOne).toBe('function')
    expect(typeof service.findMany).toBe('function')
    expect(typeof service.findById).toBe('function')
    expect(typeof service.createScoped).toBe('function')

    const partnerTermsService = container.resolve<InvoicePartnerTermsService>('invoicePartnerTermsService')
    expect(typeof partnerTermsService.listPartners).toBe('function')
    expect(typeof partnerTermsService.matchPartner).toBe('function')
    expect(typeof partnerTermsService.updateDefaultDueDays).toBe('function')
    expect(typeof partnerTermsService.resolveDefaultDueDate).toBe('function')

    for (const [token, entity] of Object.entries(ENTITY_EXPORTS)) {
      expect(container.resolve(token)).toBe(entity)
    }
  })

  it('exports every target invoice entity class for discovery', () => {
    for (const [className, entity] of Object.entries(ENTITY_EXPORTS)) {
      expect(typeof entity).toBe('function')
      expect(entity.name).toBe(className)
      expect(ENTITY_SOURCE).toContain(`export class ${className}`)
    }
  })

  it('declares search configuration for searchable invoice entities', () => {
    expect(searchConfig.entities.map((entity) => entity.entityId).sort()).toEqual([
      'invoice:invoice',
      'invoice:invoice_company',
    ])

    for (const entity of searchConfig.entities) {
      expect(entity.aclFeatures).toEqual(['invoice.view'])
      expect(entity.fieldPolicy?.excluded).toEqual(expect.arrayContaining(['search_text']))
      expect(typeof entity.buildSource).toBe('function')
      expect(typeof entity.formatResult).toBe('function')
      expect(typeof entity.resolveUrl).toBe('function')
    }

    expect(searchConfig.entities.find((entity) => entity.entityId === 'invoice:invoice')?.fieldPolicy).toMatchObject({
      hashOnly: ['seller_tax_code', 'buyer_tax_code'],
      excluded: expect.arrayContaining(['email_tracking_token_hash']),
    })
    expect(searchConfig.entities.find((entity) => entity.entityId === 'invoice:invoice_company')?.fieldPolicy).toMatchObject({
      hashOnly: ['tax_code'],
    })
  })

  it('pins tenant and organization columns on every target migration table', () => {
    for (const table of TARGET_TABLES) {
      expect(MIGRATION_SOURCE).toContain(`create table "${table}"`)
      const tableDefinition = MIGRATION_SOURCE.match(new RegExp(`create table "${table}" \\(([^;]+)\\);`))?.[1] ?? ''
      expect(tableDefinition).toContain('"organization_id" uuid not null')
      expect(tableDefinition).toContain('"tenant_id" uuid not null')
    }
  })

  it('scopes uniqueness on soft-deletable tables to live rows only', () => {
    expect(MIGRATION_SOURCE).toContain(
      'create unique index "invoice_companies_tax_code_scope_unique_idx" on "invoice_companies" ("organization_id", "tenant_id", "tax_code") where deleted_at is null',
    )
    expect(MIGRATION_SOURCE).toContain(
      'create unique index "invoice_invoices_source_scope_unique_idx" on "invoice_invoices" ("organization_id", "tenant_id", "source_invoice_id") where deleted_at is null',
    )
    expect(MIGRATION_SOURCE).toContain(
      'create unique index "invoice_invoices_email_tracking_hash_unique_idx" on "invoice_invoices" ("email_tracking_token_hash") where email_tracking_token_hash is not null and deleted_at is null',
    )
  })

  it('pins key invoice migration constraints and FK behavior', () => {
    expect(MIGRATION_SOURCE).toContain('invoice_payment_confirmations_token_hash_unique')
    expect(MIGRATION_SOURCE).toContain('references "invoice_companies" ("id") on delete restrict')
  })

  it('pins optimistic-lock foundation on the representative editable invoice entity', () => {
    const invoiceClass = ENTITY_SOURCE.match(/export class Invoice\b[\s\S]*?(?=\nexport class|$)/)?.[0] ?? ''

    expect(invoiceClass).toContain("name: 'updated_at'")
    expect(invoiceClass).toContain('updatedAt')
  })
})
