import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchResultPresenter,
  SearchIndexSource,
} from '@open-mercato/shared/modules/search'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { formatSubtitle, pickString, snippet } from '@open-mercato/shared/modules/search/descriptorHelpers'

function appendLine(lines: string[], label: string, value: unknown) {
  if (value === null || value === undefined) return
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

function buildIndexSource(
  ctx: SearchBuildContext,
  presenter: SearchResultPresenter,
  lines: string[],
): SearchIndexSource | null {
  if (!lines.length) return null
  return {
    text: lines,
    presenter,
    checksumSource: { record: ctx.record, customFields: ctx.customFields },
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'customer_accounts:customer_user',
      aclFeatures: ['customer_accounts.view'],
      enabled: true,
      priority: 6,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.display_name ?? record.displayName)
        appendLine(lines, 'Email', record.email)
        return buildIndexSource(
          ctx,
          {
            title: pickString(record.display_name, record.displayName) ?? String(record.id),
            subtitle: formatSubtitle(record.email),
            icon: 'user',
            badge: t('customer_accounts.search.badge.customerUser', 'Customer User'),
          },
          lines,
        )
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        return {
          title: pickString(record.display_name, record.displayName) ?? String(record.id),
          subtitle: formatSubtitle(record.email),
          icon: 'user',
          badge: t('customer_accounts.search.badge.customerUser', 'Customer User'),
        }
      },
      resolveUrl: async (ctx) => `/backend/customer-accounts/users/${encodeURIComponent(String(ctx.record.id))}`,
      fieldPolicy: {
        searchable: ['display_name', 'email'],
        excluded: ['password_hash', 'email_hash'],
      },
    },
    {
      entityId: 'customer_accounts:customer_role',
      aclFeatures: ['customer_accounts.view'],
      enabled: true,
      priority: 6,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Description', record.description)
        return buildIndexSource(
          ctx,
          {
            title: pickString(record.name) ?? String(record.id),
            subtitle: formatSubtitle(snippet(record.description)),
            icon: 'shield',
            badge: t('customer_accounts.search.badge.customerRole', 'Customer Role'),
          },
          lines,
        )
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        return {
          title: pickString(record.name) ?? String(record.id),
          subtitle: formatSubtitle(snippet(record.description)),
          icon: 'shield',
          badge: t('customer_accounts.search.badge.customerRole', 'Customer Role'),
        }
      },
      resolveUrl: async (ctx) => `/backend/customer-accounts/roles/${encodeURIComponent(String(ctx.record.id))}/edit`,
      fieldPolicy: {
        searchable: ['name', 'description'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
