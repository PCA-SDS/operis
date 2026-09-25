import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'

type OrganizationNode = {
  id?: unknown
  name?: unknown
  pathLabel?: unknown
  selectable?: unknown
  children?: unknown
}

type OrganizationListResponse = {
  items?: unknown[]
}

function flattenOrganizationNodes(nodes: unknown[], options: CrudFieldOption[] = []): CrudFieldOption[] {
  for (const rawNode of nodes) {
    if (!rawNode || typeof rawNode !== 'object') continue
    const node = rawNode as OrganizationNode
    const id = typeof node.id === 'string' ? node.id.trim() : ''
    if (!id) continue
    const label = typeof node.pathLabel === 'string' && node.pathLabel.trim().length > 0
      ? node.pathLabel.trim()
      : typeof node.name === 'string' && node.name.trim().length > 0
        ? node.name.trim()
        : id
    if (node.selectable !== false) options.push({ value: id, label })
    if (Array.isArray(node.children)) flattenOrganizationNodes(node.children, options)
  }
  return options
}

export async function fetchOrganizationOptions(
  tenantId: string | null,
  query?: string,
): Promise<CrudFieldOption[]> {
  const params = new URLSearchParams({ view: 'tree', status: 'active' })
  if (tenantId) params.set('tenantId', tenantId)
  if (query?.trim()) params.set('search', query.trim())
  try {
    const response = await apiCall<OrganizationListResponse>(
      `/api/directory/organizations?${params.toString()}`,
      undefined,
      { fallback: { items: [] } },
    )
    if (!response.ok || !Array.isArray(response.result?.items)) return []
    return flattenOrganizationNodes(response.result.items)
  } catch {
    return []
  }
}
