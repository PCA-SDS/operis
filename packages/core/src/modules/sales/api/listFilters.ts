import { z } from 'zod'
import { buildAggregateSearchFilter } from './utils'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

export const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    search: z.string().optional(),
    isActive: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    withDeleted: z.coerce.boolean().optional(),
  })
  .passthrough()

export function buildFilters(query: z.infer<typeof listSchema>): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  const searchFilter = buildAggregateSearchFilter(query.search)
  if (searchFilter) Object.assign(filters, searchFilter)
  const isActive = parseBooleanToken(query.isActive)
  if (isActive !== null) filters.is_active = isActive
  return filters
}
