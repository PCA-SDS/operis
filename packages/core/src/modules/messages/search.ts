import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchIndexSource,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { appendLine, pickString, snippet } from '@open-mercato/shared/modules/search/descriptorHelpers'

function buildMessagePresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const title = pickString(record.subject) ?? translate('messages.search.fallback.title', 'Message')
  const body = snippet(record.body)
  const externalName = pickString(record.external_name, record.externalName)
  const subtitle = [externalName, body].filter(Boolean).join(' · ') || undefined
  return {
    title: String(title),
    subtitle,
    icon: 'mail',
    badge: translate('messages.search.badge.message', 'Message'),
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'messages:message',
      aclFeatures: ['messages.view'],
      enabled: false,
      priority: 5,
      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Subject', record.subject)
        appendLine(lines, 'Body', record.body)
        appendLine(lines, 'From name', record.external_name ?? record.externalName)
        if (!lines.length) return null
        return {
          text: lines,
          presenter: buildMessagePresenter(t, record),
          checksumSource: {
            record: {
              subject: record.subject,
              body: record.body,
              external_name: record.external_name ?? record.externalName,
              external_email_hash: record.external_email_hash ?? record.externalEmailHash,
            },
          },
        }
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildMessagePresenter(t, ctx.record)
      },
      resolveUrl: async (ctx) => {
        const id = pickString(ctx.record.id)
        return id ? `/backend/messages/${encodeURIComponent(id)}` : null
      },
      fieldPolicy: {
        searchable: ['subject', 'body', 'external_name'],
        hashOnly: ['external_email'],
        excluded: ['action_data', 'action_result'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
