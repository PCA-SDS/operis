import type { EntityManager } from '@mikro-orm/postgresql'
import { TasksLabel, TasksProject } from '../data/entities'
import {
  QUICK_ADD_PARSER_VERSION,
  type QuickAddLabelMatchDto,
  type QuickAddParseResultDto,
  type QuickAddProjectMatchDto,
  type QuickAddWarningDto,
  type TaskUserDto,
} from '../data/types'
import type { QuickAddParseRequest } from '../data/validators'
import { parseQuickAdd } from '../lib/quick-add/parser'
import { listScopedUsers, type TasksScope } from '../lib/people'
import { resolveTimeZone, todayInTimeZone } from '../lib/values'

/**
 * Fold a reference for matching: lowercase, strip accents, drop everything that
 * is not a letter or digit. So "#Client Ops", "#client-ops" and "#ClientOps"
 * all resolve to the same project.
 */
function normalizeCompact(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** Exact folded matches win outright; only when there is none do prefixes count.
 *  Typing "#Ops" must not become ambiguous just because "#Operations" exists. */
function bestMatches<T>(candidates: readonly T[], folded: string, foldOf: (item: T) => string[]): T[] {
  if (folded.length === 0) return []
  const exact = candidates.filter((item) => foldOf(item).some((value) => value === folded))
  if (exact.length > 0) return exact
  return candidates.filter((item) => foldOf(item).some((value) => value.startsWith(folded)))
}

export interface QuickAddService {
  parse(
    em: EntityManager,
    scope: TasksScope,
    body: QuickAddParseRequest,
  ): Promise<QuickAddParseResultDto>
}

export class DefaultQuickAddService implements QuickAddService {
  async parse(
    em: EntityManager,
    scope: TasksScope,
    body: QuickAddParseRequest,
  ): Promise<QuickAddParseResultDto> {
    const timeZone = resolveTimeZone(body.tz)
    const parsed = parseQuickAdd(body.text, todayInTimeZone(timeZone))
    const warnings: QuickAddWarningDto[] = [...parsed.warnings]

    const [projectMatches, userMatches, labelMatchesByQuery] = await Promise.all([
      parsed.projectQuery ? this.matchProjects(em, scope, parsed.projectQuery) : [],
      parsed.assigneeQuery ? this.matchUsers(em, scope, parsed.assigneeQuery) : [],
      this.matchLabelQueries(em, scope, parsed.labelQueries),
    ])

    let project: QuickAddProjectMatchDto | null = null
    if (parsed.projectQuery) {
      if (projectMatches.length === 1) project = projectMatches[0]!
      else if (projectMatches.length === 0) {
        warnings.push({ code: 'projectNotFound', params: { query: parsed.projectQuery } })
      } else warnings.push({ code: 'projectAmbiguous', params: { query: parsed.projectQuery } })
    }

    let assignee: TaskUserDto | null = null
    if (parsed.assigneeQuery) {
      if (userMatches.length === 1) assignee = userMatches[0]!
      else if (userMatches.length === 0) {
        warnings.push({ code: 'assigneeNotFound', params: { query: parsed.assigneeQuery } })
      } else warnings.push({ code: 'assigneeAmbiguous', params: { query: parsed.assigneeQuery } })
    }

    const labels: QuickAddLabelMatchDto[] = []
    for (const [index, query] of parsed.labelQueries.entries()) {
      const matches = labelMatchesByQuery[index] ?? []
      if (matches.length === 1) {
        if (!labels.some((label) => label.id === matches[0]!.id)) labels.push(matches[0]!)
      } else if (matches.length === 0) {
        warnings.push({ code: 'labelNotFound', params: { query } })
      } else warnings.push({ code: 'labelAmbiguous', params: { query } })
    }

    return {
      originalText: body.text,
      title: parsed.title,
      project,
      projectQuery: parsed.projectQuery,
      assignee,
      assigneeQuery: parsed.assigneeQuery,
      labels,
      labelQueries: parsed.labelQueries,
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime,
      recurrence: parsed.recurrence,
      priority: parsed.priority,
      recognizedTokens: parsed.recognizedTokens,
      warnings,
      parserVersion: QUICK_ADD_PARSER_VERSION,
    }
  }

  private async matchProjects(
    em: EntityManager,
    scope: TasksScope,
    query: string,
  ): Promise<QuickAddProjectMatchDto[]> {
    const folded = normalizeCompact(query)
    if (folded.length === 0) return []
    const projects = await em.find(
      TasksProject,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        archivedAt: null,
        deletedAt: null,
      },
      { orderBy: { name: 'asc' } },
    )
    return bestMatches(projects, folded, (project) => [
      normalizeCompact(project.name),
      normalizeCompact(project.key),
    ]).map((project) => ({
      id: project.id,
      key: project.key,
      name: project.name,
      icon: project.icon,
      isInbox: project.isInbox,
    }))
  }

  private async matchUsers(
    em: EntityManager,
    scope: TasksScope,
    query: string,
  ): Promise<TaskUserDto[]> {
    const folded = normalizeCompact(query)
    if (folded.length === 0) return []
    const people = await listScopedUsers(em, scope)
    return bestMatches(people, folded, (person) => [normalizeCompact(person.name)]).map((person) => ({
      id: person.id,
      name: person.name,
    }))
  }

  private async matchLabelQueries(
    em: EntityManager,
    scope: TasksScope,
    queries: readonly string[],
  ): Promise<QuickAddLabelMatchDto[][]> {
    const folded = queries.map(normalizeCompact)
    if (!folded.some((value) => value.length > 0)) return queries.map(() => [])
    const labels = await em.find(
      TasksLabel,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      { orderBy: { name: 'asc' } },
    )
    return folded.map((value) =>
      bestMatches(labels, value, (label) => [normalizeCompact(label.name)]).map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      })),
    )
  }
}
