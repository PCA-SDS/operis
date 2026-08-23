import type {
  SearchBuildContext,
  SearchIndexSource,
  SearchModuleConfig,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

function pickString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function snippet(value: unknown, max = 140): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.length) return undefined
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 3)}...`
}

function appendLine(lines: string[], label: string, value: unknown): void {
  if (value === null || value === undefined) return
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

function buildSource(
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

/**
 * Tasks, projects and doc pages are all searchable. Descriptions and doc bodies
 * are indexed through their plaintext mirrors — the stored HTML would flood the
 * index with markup and match on tag names.
 */
export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'tasks:tasks_task',
      aclFeatures: ['tasks.view'],
      enabled: true,
      priority: 8,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Title', record.title)
        appendLine(lines, 'Description', record.description_plaintext)
        return buildSource(ctx, taskPresenter(t, record), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return taskPresenter(t, ctx.record)
      },
      resolveUrl: async (ctx) =>
        `/backend/tasks/projects/${encodeURIComponent(String(ctx.record.project_id))}?tab=list`,
      fieldPolicy: { searchable: ['title', 'description_plaintext'] },
    },
    {
      entityId: 'tasks:tasks_project',
      aclFeatures: ['tasks.projects.view'],
      enabled: true,
      priority: 6,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Key', record.key)
        appendLine(lines, 'Description', record.description)
        return buildSource(ctx, projectPresenter(t, record), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return projectPresenter(t, ctx.record)
      },
      resolveUrl: async (ctx) => `/backend/tasks/projects/${encodeURIComponent(String(ctx.record.id))}`,
      fieldPolicy: { searchable: ['name', 'key', 'description'] },
    },
    {
      entityId: 'tasks:tasks_project_doc',
      aclFeatures: ['tasks.docs.view'],
      enabled: true,
      priority: 4,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Title', record.title)
        appendLine(lines, 'Body', record.body_plaintext)
        return buildSource(ctx, docPresenter(t, record), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return docPresenter(t, ctx.record)
      },
      resolveUrl: async (ctx) =>
        `/backend/tasks/projects/${encodeURIComponent(String(ctx.record.project_id))}?tab=docs`,
      fieldPolicy: { searchable: ['title', 'body_plaintext'] },
    },
  ],
}

type Translate = (key: string, fallback: string) => string

function taskPresenter(t: Translate, record: Record<string, unknown>): SearchResultPresenter {
  return {
    title: pickString(record.title) ?? t('tasks.search.badge.task', 'Task'),
    subtitle: snippet(record.description_plaintext),
    icon: 'check-square',
    badge: t('tasks.search.badge.task', 'Task'),
  }
}

function projectPresenter(t: Translate, record: Record<string, unknown>): SearchResultPresenter {
  const key = pickString(record.key)
  const description = snippet(record.description)
  return {
    title: pickString(record.name) ?? t('tasks.search.badge.project', 'Project'),
    subtitle: [key, description].filter(Boolean).join(' · ') || undefined,
    icon: 'folder-kanban',
    badge: t('tasks.search.badge.project', 'Project'),
  }
}

function docPresenter(t: Translate, record: Record<string, unknown>): SearchResultPresenter {
  return {
    title: pickString(record.title) ?? t('tasks.search.badge.doc', 'Project page'),
    subtitle: snippet(record.body_plaintext),
    icon: 'file-text',
    badge: t('tasks.search.badge.doc', 'Project page'),
  }
}

export default searchConfig
export const config = searchConfig
