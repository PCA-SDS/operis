import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { features } from '../acl'
import { EmailAccountingDefaults, EmailTemplate } from '../data/entities'
import { metadata } from '../index'
import searchConfig from '../search'
import setup from '../setup'

const MODULE_ROOT = join(__dirname, '..')
const MIGRATION_SOURCE = readFileSync(
  join(MODULE_ROOT, 'migrations', 'Migration20260903142415_email.ts'),
  'utf8',
)
const ENTITY_SOURCE = readFileSync(join(MODULE_ROOT, 'data', 'entities.ts'), 'utf8')

describe('email module foundation', () => {
  it('exposes module metadata and auto-discovery convention files', () => {
    expect(metadata).toMatchObject({
      name: 'email',
      title: 'Email Templates',
      defaultEntitlement: 'disabled',
      category: 'Communication',
    })

    for (const relativePath of [
      'index.ts',
      'acl.ts',
      'setup.ts',
      'di.ts',
      'search.ts',
      join('api', 'openapi.ts'),
      join('api', 'templates', 'route.ts'),
      join('api', 'templates', '[id]', 'route.ts'),
      join('api', 'accounting-defaults', 'route.ts'),
      join('backend', 'email', 'templates', 'page.tsx'),
      join('backend', 'email', 'templates', 'page.meta.ts'),
      join('backend', 'email', 'templates', 'create', 'page.tsx'),
      join('backend', 'email', 'templates', 'create', 'page.meta.ts'),
      join('data', 'entities.ts'),
      join('data', 'validators.ts'),
    ]) {
      expect(existsSync(join(MODULE_ROOT, relativePath))).toBe(true)
    }
  })

  it('registers scoped ACL features and default role grants', () => {
    expect(features.map((feature) => feature.id).sort()).toEqual([
      'email.accounting_defaults.manage',
      'email.accounting_defaults.view',
      'email.templates.manage',
      'email.templates.view',
    ])

    expect(setup.defaultRoleFeatures?.admin).toEqual(['email.*'])
    expect(setup.defaultRoleFeatures?.employee).toEqual(['email.templates.view'])
  })

  it('exports discoverable email entities', () => {
    expect(EmailTemplate.name).toBe('EmailTemplate')
    expect(EmailAccountingDefaults.name).toBe('EmailAccountingDefaults')
    expect(ENTITY_SOURCE).toContain('export class EmailTemplate')
    expect(ENTITY_SOURCE).toContain('export class EmailAccountingDefaults')
  })

  it('keeps template data tenant and organization scoped', () => {
    expect(MIGRATION_SOURCE).toContain('create table "email_templates"')
    expect(MIGRATION_SOURCE).toContain('"organization_id" uuid not null')
    expect(MIGRATION_SOURCE).toContain('"tenant_id" uuid not null')
    expect(MIGRATION_SOURCE).toContain(
      'create unique index "email_templates_key_scope_unique_idx" on "email_templates" ("organization_id", "tenant_id", "template_key") where deleted_at is null',
    )
  })

  it('keeps accounting defaults private per tenant organization scope', () => {
    expect(MIGRATION_SOURCE).toContain('create table "email_accounting_defaults"')
    expect(MIGRATION_SOURCE).toContain(
      'alter table "email_accounting_defaults" add constraint "email_accounting_defaults_scope_unique" unique ("organization_id", "tenant_id")',
    )
  })

  it('declares search without indexing accounting default secrets', () => {
    expect(searchConfig.entities.map((entity) => entity.entityId)).toEqual(['email:email_template'])
    expect(searchConfig.entities[0]?.aclFeatures).toEqual(['email.templates.view'])
    expect(searchConfig.entities[0]?.fieldPolicy?.excluded).toEqual(
      expect.arrayContaining(['design', 'blocks', 'accounting_metadata']),
    )
  })
})
