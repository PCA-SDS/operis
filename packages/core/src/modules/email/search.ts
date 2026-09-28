import type { SearchBuildContext, SearchIndexSource, SearchModuleConfig, SearchResultPresenter } from '@open-mercato/shared/modules/search'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { normalizeOptionalString } from '@open-mercato/shared/lib/string'

const EMAIL_TEMPLATE_ENTITY = 'email:email_template' as EntityId

function presenter(record: Record<string, unknown>): SearchResultPresenter {
  return {
    title: normalizeOptionalString(record.name) ?? normalizeOptionalString(record.template_key) ?? 'Email template',
    subtitle: normalizeOptionalString(record.subject) ?? undefined,
    icon: 'mail',
    badge: 'Email template',
  }
}

function buildSource(ctx: SearchBuildContext): SearchIndexSource | null {
  const record = ctx.record
  const lines = [
    normalizeOptionalString(record.template_key),
    normalizeOptionalString(record.name),
    normalizeOptionalString(record.description),
    normalizeOptionalString(record.category),
    normalizeOptionalString(record.status),
    normalizeOptionalString(record.subject),
    normalizeOptionalString(record.preheader),
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
      // Every other module deep-links to the record route; the list page never
      // read `?template=`, so a search hit landed on the unfiltered list.
      resolveUrl: (ctx) => `/backend/email/templates/${encodeURIComponent(String(ctx.record.id))}/edit`,
      fieldPolicy: {
        searchable: ['template_key', 'name', 'description', 'category', 'status', 'subject', 'preheader'],
        excluded: ['design', 'blocks', 'variables', 'accounting_metadata'],
      },
    },
  ],
}

export default searchConfig
