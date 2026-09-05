import type { SearchBuildContext, SearchIndexSource, SearchModuleConfig, SearchResultPresenter } from '@open-mercato/shared/modules/search'
import type { EntityId } from '@open-mercato/shared/modules/entities'

const EMAIL_TEMPLATE_ENTITY = 'email:email_template' as EntityId

function pickString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function presenter(record: Record<string, unknown>): SearchResultPresenter {
  return {
    title: pickString(record.name) ?? pickString(record.template_key) ?? 'Email template',
    subtitle: pickString(record.subject) ?? undefined,
    icon: 'mail',
    badge: 'Email template',
  }
}

function buildSource(ctx: SearchBuildContext): SearchIndexSource | null {
  const record = ctx.record
  const lines = [
    pickString(record.template_key),
    pickString(record.name),
    pickString(record.description),
    pickString(record.category),
    pickString(record.status),
    pickString(record.subject),
    pickString(record.preheader),
  ].filter((value): value is string => Boolean(value))
  if (!lines.length) return null
  return {
    text: lines,
    presenter: presenter(record),
    checksumSource: { record, customFields: ctx.customFields },
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: EMAIL_TEMPLATE_ENTITY,
      aclFeatures: ['email.templates.view'],
      enabled: true,
      priority: 6,
      buildSource,
      formatResult: (ctx) => presenter(ctx.record),
      resolveUrl: (ctx) => `/backend/email/templates?template=${encodeURIComponent(String(ctx.record.id))}`,
      fieldPolicy: {
        searchable: ['template_key', 'name', 'description', 'category', 'status', 'subject', 'preheader'],
        excluded: ['design', 'blocks', 'variables', 'accounting_metadata'],
      },
    },
  ],
}

export default searchConfig
