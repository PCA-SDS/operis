import { z } from 'zod'

/**
 * The repository cap from the root `AGENTS.md` ("Keep `pageSize` at or below
 * 100"), and the same ceiling `makeCrudRoute` clamps to at runtime.
 */
export const MAX_PAGE_SIZE = 100
export const DEFAULT_PAGE_SIZE = 50

export type PaginationSchemaOptions = {
  defaultPageSize?: number
  maxPageSize?: number
}

/**
 * `page` / `pageSize` for a list query, parsed from query-string values.
 *
 * Two things this fixes wherever it is adopted. `page` is an **integer** — about
 * 25 routes declare `z.coerce.number().min(1)`, which happily accepts `1.5`.
 * And `pageSize` is capped: nine routes currently declare a max of 200 or 500,
 * contradicting the documented limit and the factory's own runtime clamp.
 *
 * Routes whose ceiling is genuinely higher should say so explicitly via
 * `maxPageSize` rather than omitting the bound.
 */
export function paginationQuerySchema(options: PaginationSchemaOptions = {}) {
  const { defaultPageSize = DEFAULT_PAGE_SIZE, maxPageSize = MAX_PAGE_SIZE } = options
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(maxPageSize).default(defaultPageSize),
  })
}
