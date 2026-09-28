import { z } from 'zod'

export const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  sort: z.enum(['label-asc', 'label-desc', 'name-asc', 'name-desc', 'recent']).default('label-asc'),
})

export type DealLinkedEntitySort = 'label-asc' | 'label-desc' | 'recent'

export function normalizeSort(sort: z.infer<typeof querySchema>['sort']): DealLinkedEntitySort {
  if (sort === 'name-asc') return 'label-asc'
  if (sort === 'name-desc') return 'label-desc'
  return sort
}
