import type { EntityData, EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { assertOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { sanitizeRichTextHtml } from '@open-mercato/shared/lib/html/sanitizeRichText'
import { EmailTemplate } from '../data/entities'
import { createEmailTemplateSchema, updateEmailTemplateSchema, deleteEmailTemplateSchema } from '../data/validators'

type StoredBlock = { type?: unknown; props?: unknown }

/**
 * Sanitize on write as well as on render, the way tasks handles comment bodies.
 * `rich-text-html` is the one block type whose HTML is stored verbatim, so a
 * stored body could otherwise carry active markup to every later consumer.
 */
function sanitizeTemplateBlocks<T>(blocks: T): T {
  if (!Array.isArray(blocks)) return blocks
  return blocks.map((block) => {
    const candidate = block as StoredBlock
    if (candidate?.type !== 'rich-text-html') return block
    const props = candidate.props
    if (!props || typeof props !== 'object') return block
    const html = (props as Record<string, unknown>).html
    if (typeof html !== 'string') return block
    return { ...candidate, props: { ...(props as Record<string, unknown>), html: sanitizeRichTextHtml(html) } }
  }) as unknown as T
}

function ensureEmailScope(ctx: CommandRuntimeContext): { tenantId: string; organizationId: string } {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant context is required' })
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!organizationId) throw new CrudHttpError(400, { error: 'Organization context is required' })
  return { tenantId, organizationId }
}

function mapTemplate(template: EmailTemplate) {
  return {
    id: template.id,
    template_key: template.templateKey,
    name: template.name,
    description: template.description ?? null,
    category: template.category,
    status: template.status,
    subject: template.subject,
    preheader: template.preheader ?? null,
    design: template.design,
    blocks: template.blocks,
    variables: template.variables,
    accounting_metadata: template.accountingMetadata ?? null,
    tenant_id: template.tenantId,
    organization_id: template.organizationId,
    created_by_user_id: template.createdByUserId ?? null,
    updated_by_user_id: template.updatedByUserId ?? null,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  }
}

const createTemplateCommand: CommandHandler<Record<string, unknown>, ReturnType<typeof mapTemplate>> = {
  id: 'email.templates.create',
  async execute(rawInput, ctx) {
    const parsed = createEmailTemplateSchema.parse(rawInput)
    const scope = ensureEmailScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const template = em.create(EmailTemplate, {
      ...(parsed.id ? { id: parsed.id } : {}),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      templateKey: parsed.template_key,
      name: parsed.name,
      description: parsed.description ?? null,
      category: parsed.category,
      status: parsed.status,
      subject: parsed.subject,
      preheader: parsed.preheader ?? null,
      design: parsed.design,
      blocks: sanitizeTemplateBlocks(parsed.blocks),
      variables: parsed.variables,
      accountingMetadata: parsed.accounting_metadata ?? null,
      createdByUserId: ctx.auth?.sub ?? null,
      updatedByUserId: ctx.auth?.sub ?? null,
    })
    em.persist(template)
    await em.flush()
    return mapTemplate(template)
  },
}

const updateTemplateCommand: CommandHandler<Record<string, unknown>, ReturnType<typeof mapTemplate>> = {
  id: 'email.templates.update',
  async execute(rawInput, ctx) {
    const parsed = updateEmailTemplateSchema.parse(rawInput)
    const scope = ensureEmailScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const where = {
      id: parsed.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<EmailTemplate>
    const existing = await em.findOne(EmailTemplate, where)
    if (!existing) throw new CrudHttpError(404, { error: 'Email template not found' })
    assertOptimisticLock({
      resourceKind: 'email.template',
      resourceId: existing.id,
      expected: parsed.expected_updated_at,
      current: existing.updatedAt,
    })

    const patch: EntityData<EmailTemplate> = {}
    if (parsed.template_key !== undefined) patch.templateKey = parsed.template_key
    if (parsed.name !== undefined) patch.name = parsed.name
    if (parsed.description !== undefined) patch.description = parsed.description ?? null
    if (parsed.category !== undefined) patch.category = parsed.category
    if (parsed.status !== undefined) patch.status = parsed.status
    if (parsed.subject !== undefined) patch.subject = parsed.subject
    if (parsed.preheader !== undefined) patch.preheader = parsed.preheader ?? null
    if (parsed.design !== undefined) patch.design = parsed.design
    if (parsed.blocks !== undefined) patch.blocks = sanitizeTemplateBlocks(parsed.blocks)
    if (parsed.variables !== undefined) patch.variables = parsed.variables
    if (parsed.accounting_metadata !== undefined) patch.accountingMetadata = parsed.accounting_metadata ?? null
    patch.updatedByUserId = ctx.auth?.sub ?? null
    Object.assign(existing, patch)
    await em.flush()
    return mapTemplate(existing)
  },
}

const deleteTemplateCommand: CommandHandler<Record<string, unknown>, { ok: true }> = {
  id: 'email.templates.delete',
  async execute(rawInput, ctx) {
    const parsed = deleteEmailTemplateSchema.parse(rawInput)
    const scope = ensureEmailScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await em.findOne(EmailTemplate, {
      id: parsed.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<EmailTemplate>)
    if (!existing) throw new CrudHttpError(404, { error: 'Email template not found' })
    assertOptimisticLock({
      resourceKind: 'email.template',
      resourceId: existing.id,
      expected: parsed.expected_updated_at,
      current: existing.updatedAt,
    })
    existing.deletedAt = new Date()
    await em.flush()
    return { ok: true }
  },
}

registerCommand(createTemplateCommand)
registerCommand(updateTemplateCommand)
registerCommand(deleteTemplateCommand)
