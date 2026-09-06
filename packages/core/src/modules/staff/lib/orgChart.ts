export type OrgChartRole = {
  id: string
  name: string
  parentRoleId: string | null
}

export type OrgChartNode<TRole extends OrgChartRole> = TRole & { children: OrgChartNode<TRole>[] }

/**
 * Walks up from `startParentId` looking for `selfId`.
 *
 * Attaching a node under a parent that is already below it would close a loop,
 * and a looped tree renders forever. The walk also stops on a parent chain that
 * loops elsewhere, so a cycle further up cannot hang this check either.
 */
function parentChainReaches<TRole extends OrgChartRole>(
  startParentId: string,
  selfId: string,
  byId: Map<string, TRole>,
): boolean {
  let current: string | null = startParentId
  const seen = new Set<string>()
  while (current) {
    if (current === selfId) return true
    if (seen.has(current)) return false
    seen.add(current)
    current = byId.get(current)?.parentRoleId ?? null
  }
  return false
}

/**
 * Arranges roles into a forest by their reporting line.
 *
 * Roles are edited one at a time and nothing stops an administrator from
 * deleting a parent or pointing two roles at each other, so the data is not
 * guaranteed to be a tree. Every role is placed exactly once regardless: one
 * that cannot attach — missing parent, its own parent, or a parent that sits
 * below it — becomes a root instead of being dropped. A chart that quietly
 * omits people is worse than one that shows a broken branch at the top level.
 */
export function buildOrgForest<TRole extends OrgChartRole>(roles: TRole[]): OrgChartNode<TRole>[] {
  const byId = new Map<string, TRole>(roles.map((role) => [role.id, role]))
  const nodes = new Map<string, OrgChartNode<TRole>>(
    roles.map((role) => [role.id, { ...role, children: [] as OrgChartNode<TRole>[] }]),
  )

  const roots: OrgChartNode<TRole>[] = []
  for (const role of roles) {
    const node = nodes.get(role.id)
    if (!node) continue
    const parent = role.parentRoleId ? nodes.get(role.parentRoleId) : undefined
    if (!parent || parent.id === node.id || parentChainReaches(parent.id, node.id, byId)) {
      roots.push(node)
      continue
    }
    parent.children.push(node)
  }
  return roots
}
