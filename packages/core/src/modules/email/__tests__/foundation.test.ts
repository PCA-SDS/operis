import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { features } from '../acl'
import { EmailAccountingDefaults, EmailTemplate } from '../data/entities'
import { pcaAccountingSourceTemplates } from '../data/pca-source-templates'
import { metadata } from '../index'
import searchConfig from '../search'
import setup from '../setup'

const MODULE_ROOT = join(__dirname, '..')
const MIGRATION_SOURCE = readFileSync(
  join(MODULE_ROOT, 'migrations', 'Migration20260903142415_email.ts'),
  'utf8',
)
const ENTITY_SOURCE = readFileSync(join(MODULE_ROOT, 'data', 'entities.ts'), 'utf8')
const COMMANDS_SOURCE = readFileSync(join(MODULE_ROOT, 'commands', 'templates.ts'), 'utf8')
const SETUP_SOURCE = readFileSync(join(MODULE_ROOT, 'setup.ts'), 'utf8')
const ACCOUNTING_DEFAULTS_PAGE_SOURCE = readFileSync(
  join(MODULE_ROOT, 'backend', 'email', 'accounting-defaults', 'page.tsx'),
  'utf8',
)
const TEMPLATES_ROUTE_SOURCE = readFileSync(join(MODULE_ROOT, 'api', 'templates', 'route.ts'), 'utf8')
const TEMPLATE_BUILDER_SOURCE = readFileSync(
  join(MODULE_ROOT, 'backend', 'email', 'templates', '_components', 'TemplateBuilderForm.tsx'),
  'utf8',
)
const TEMPLATE_EDIT_SOURCE = readFileSync(
  join(MODULE_ROOT, 'backend', 'email', 'templates', '[id]', 'edit', 'page.tsx'),
  'utf8',
)
const COMPOSE_PAGE_SOURCE = readFileSync(join(MODULE_ROOT, 'backend', 'email', 'compose', 'page.tsx'), 'utf8')
const COMPOSE_META_SOURCE = readFileSync(join(MODULE_ROOT, 'backend', 'email', 'compose', 'page.meta.ts'), 'utf8')
const README_SOURCE = readFileSync(join(MODULE_ROOT, 'README.md'), 'utf8')

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
      join('backend', 'email', 'compose', 'page.tsx'),
      join('backend', 'email', 'compose', 'page.meta.ts'),
      join('backend', 'email', 'templates', 'page.tsx'),
      join('backend', 'email', 'templates', 'page.meta.ts'),
      join('backend', 'email', 'templates', 'create', 'page.tsx'),
      join('backend', 'email', 'templates', 'create', 'page.meta.ts'),
      join('backend', 'email', 'templates', '[id]', 'edit', 'page.tsx'),
      join('backend', 'email', 'templates', '[id]', 'edit', 'page.meta.ts'),
      join('backend', 'email', 'accounting-defaults', 'page.tsx'),
      join('backend', 'email', 'accounting-defaults', 'page.meta.ts'),
      join('data', 'entities.ts'),
      join('data', 'pca-source-templates.ts'),
      join('data', 'validators.ts'),
    ]) {
      expect(existsSync(join(MODULE_ROOT, relativePath))).toBe(true)
    }
  })

  it('does not carry Finder conflict-copy module files', () => {
    const stack = [MODULE_ROOT]
    const conflictCopies: string[] = []
    while (stack.length) {
      const current = stack.pop()!
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name)
        if (entry.isDirectory()) stack.push(path)
        if (entry.isFile() && /\s2\.[^.]+$/.test(entry.name)) conflictCopies.push(path)
      }
    }
    expect(conflictCopies).toEqual([])
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

  it('does not seed PCA templates into every tenant by default', () => {
    expect(SETUP_SOURCE).not.toContain('pcaStarterTemplates')
    expect(SETUP_SOURCE).not.toContain('migratedFrom')
    expect(SETUP_SOURCE).not.toContain('PCA Accounting')
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

  it('uses optimistic locking for template update and delete commands', () => {
    expect(COMMANDS_SOURCE.match(/assertOptimisticLock\(/g)).toHaveLength(2)
    expect(COMMANDS_SOURCE).toContain('expected: parsed.expected_updated_at')
    expect(COMMANDS_SOURCE).toContain('existing.deletedAt = new Date()')
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

  it('uses a smaller grid projection so list pages do not fetch body payloads', () => {
    expect(TEMPLATES_ROUTE_SOURCE).toContain('const listFields')
    expect(TEMPLATES_ROUTE_SOURCE).toContain('const detailFields')
    expect(TEMPLATES_ROUTE_SOURCE).toContain('fields: (query) => query.id || query.ids || query.activeOnly ? detailFields : listFields')
    expect(TEMPLATES_ROUTE_SOURCE).toContain('item.accounting_metadata?.isActive !== false')
  })

  it('keeps the template builder non-technical for tenant users', () => {
    for (const hiddenLabel of [
      'Custom variables CSV',
      'Sample/default values JSON',
      'Rules JSON',
      'Stored block payload',
      'Developer block payload',
      'Display order',
      'Accounting fields',
    ]) {
      expect(TEMPLATE_BUILDER_SOURCE).not.toContain(hiddenLabel)
    }
    expect(TEMPLATE_BUILDER_SOURCE).toContain('Copy subject')
    expect(TEMPLATE_BUILDER_SOURCE).toContain('Copy body')
    expect(TEMPLATE_BUILDER_SOURCE).toContain('lg:sticky')
    expect(TEMPLATE_BUILDER_SOURCE).toContain('Insert variable:')
    expect(TEMPLATE_BUILDER_SOURCE).toContain('When to use this template')
    expect(TEMPLATE_BUILDER_SOURCE).toContain('Selection priority')
    expect(TEMPLATE_BUILDER_SOURCE).toContain('email.templates.form.subject.help')
    expect(TEMPLATE_BUILDER_SOURCE).toContain('email.templates.form.variableKey.help')
    expect(TEMPLATE_BUILDER_SOURCE).toContain('email.templates.form.variableType.help')
    expect(TEMPLATE_BUILDER_SOURCE).toContain('email.templates.form.variableSample.help')
    expect(TEMPLATE_BUILDER_SOURCE).toContain('onMouseDown={(event) => event.preventDefault()}')
    expect(TEMPLATE_BUILDER_SOURCE).toContain('key={index}')
    expect(TEMPLATE_BUILDER_SOURCE).not.toContain('key={`${variableName}')
  })

  it('loads template edits through the supported scoped collection query', () => {
    expect(TEMPLATE_EDIT_SOURCE).toContain('/api/email/templates?id=')
    expect(TEMPLATE_EDIT_SOURCE).toContain('function templateFromResponse')
    expect(TEMPLATE_EDIT_SOURCE).not.toContain('/api/email/templates/${encodeURIComponent(id)}')
  })

  it('keeps accounting defaults non-technical for tenant users', () => {
    expect(ACCOUNTING_DEFAULTS_PAGE_SOURCE).not.toContain('Workflow rules JSON')
    expect(ACCOUNTING_DEFAULTS_PAGE_SOURCE).toContain('Default sender name')
    expect(ACCOUNTING_DEFAULTS_PAGE_SOURCE).toContain('Default reply-to')
    expect(ACCOUNTING_DEFAULTS_PAGE_SOURCE).toContain('Common accounting placeholders')
    expect(ACCOUNTING_DEFAULTS_PAGE_SOURCE).toContain('Sample link placeholders')
    expect(ACCOUNTING_DEFAULTS_PAGE_SOURCE).toContain('key={`placeholder-${index}`}')
    expect(ACCOUNTING_DEFAULTS_PAGE_SOURCE).toContain('key={`link-placeholder-${index}`}')
    expect(ACCOUNTING_DEFAULTS_PAGE_SOURCE).not.toContain('key={`${row.key}-${index}`}')
  })

  it('keeps compose preview read-only and feature gated', () => {
    expect(COMPOSE_META_SOURCE).toContain("requireFeatures: ['email.templates.view']")
    expect(COMPOSE_PAGE_SOURCE).toContain('This does not send email')
    expect(COMPOSE_PAGE_SOURCE).toContain('Accounting values')
    expect(COMPOSE_PAGE_SOURCE).not.toContain('Accounting values JSON')
    expect(COMPOSE_PAGE_SOURCE).toContain('activeOnly=true')
    expect(COMPOSE_PAGE_SOURCE).toContain('/api/customers/companies?page=1&pageSize=50')
    expect(COMPOSE_PAGE_SOURCE).toContain('include=people')
    expect(COMPOSE_PAGE_SOURCE).toContain("'text/html'")
    expect(COMPOSE_PAGE_SOURCE).toContain('new Blob([html]')
    expect(COMPOSE_PAGE_SOURCE).toContain('key={`accounting-value-${index}`}')
    expect(COMPOSE_PAGE_SOURCE).not.toContain('key={`${row.key}-${index}`}')
    expect(COMPOSE_PAGE_SOURCE).not.toContain('/send')
    expect(COMPOSE_PAGE_SOURCE).not.toContain("method: 'POST'")
  })

  it('documents company and linked-people variable ownership', () => {
    expect(README_SOURCE).toContain('Company values represent the business customer selected from Operis Customers/Companies.')
    expect(README_SOURCE).toContain('People values represent linked contacts/recipients for that company.')
    expect(README_SOURCE).toContain('If no people are linked yet, company variables still render')
  })

  it('documents PCA parity without making PCA global behavior', () => {
    for (const capability of [
      'Template list/detail/create/update/delete APIs',
      'Template list search and active-only loading',
      'Template variables/default values/rules/sort order',
      'Client/company compose workspace',
      'Copy-ready generated draft',
      'Per-user Gmail connection / Gmail draft creation',
      'Seed five PCA templates for all tenants',
      'Real email sending',
    ]) {
      expect(README_SOURCE).toContain(capability)
    }
    expect(README_SOURCE).toContain('PCA-style Gmail Drafts need a future communication-channel draft bridge')
    expect(README_SOURCE).toContain('Intentionally not implemented; PCA templates are source data for the PCA tenant only.')
    expect(README_SOURCE).toContain('Intentionally deferred to Gmail/IMAP/SMTP channel integrations.')
  })
})
