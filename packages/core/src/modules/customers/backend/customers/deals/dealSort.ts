import type { SortOption } from './pipeline/components/SortByPopover'

/**
 * Translate the UI SortOption into the deals CRUD API's `sortField` / `sortDir` query params.
 *
 * Returns `null` for `owner_asc` because the deals table only stores `owner_user_id` (a UUID);
 * the UI displays a resolved owner name, so a UUID-alphabetical server sort would be misleading.
 * For that case the caller falls back to a sensible default sort server-side and re-sorts the
 * page client-side via `sortDeals`. All other options sort server-side over the full result set,
 * so paging (25/lane → Show more) keeps a globally correct order.
 */
export function mapSortOptionToApi(option: SortOption): { sortField: string; sortDir: 'asc' | 'desc' } | null {
  switch (option) {
    case 'updated_desc':
      return { sortField: 'updatedAt', sortDir: 'desc' }
    case 'updated_asc':
      return { sortField: 'updatedAt', sortDir: 'asc' }
    case 'created_desc':
      return { sortField: 'createdAt', sortDir: 'desc' }
    case 'value_desc':
      return { sortField: 'value', sortDir: 'desc' }
    case 'value_asc':
      return { sortField: 'value', sortDir: 'asc' }
    case 'probability_desc':
      return { sortField: 'probability', sortDir: 'desc' }
    case 'close_asc':
      return { sortField: 'expectedCloseAt', sortDir: 'asc' }
    case 'owner_asc':
    default:
      return null
  }
}
