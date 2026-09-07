import { ResourcesResourceArea } from '../data/entities'

export type ComputedAreaNode = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  pathLabel: string
  parentId: string | null
  depth: number
  rootId: string
  treePath: string
  ancestorIds: string[]
  childIds: string[]
  descendantIds: string[]
  isActive: boolean
  sortOrder: number
}

export type ComputedAreaHierarchy = {
  map: Map<string, ComputedAreaNode>
  ordered: ComputedAreaNode[]
}

type InternalNode = {
  area: ResourcesResourceArea
  parentId: string | null
  children: Set<string>
}

function normalizeId(value: unknown): string | null {
  if (!value) return null
  const normalized = String(value).trim()
  if (!normalized || normalized.toLowerCase() === 'null' || normalized.toLowerCase() === 'undefined') {
    return null
  }
  return normalized
}

export function computeHierarchyForAreas(areas: ResourcesResourceArea[]): ComputedAreaHierarchy {
  const nodes = new Map<string, InternalNode>()

  for (const area of areas) {
    const id = String(area.id)
    nodes.set(id, {
      area,
      parentId: normalizeId(area.parentAreaId),
      children: new Set<string>(),
    })
  }

  for (const [id, node] of nodes) {
    const parentId = node.parentId
    if (!parentId || parentId === id || !nodes.has(parentId)) {
      node.parentId = null
      continue
    }
    nodes.get(parentId)!.children.add(id)
  }

  const computed = new Map<string, ComputedAreaNode>()
  const orderedIds: string[] = []
  const orderedSet = new Set<string>()
  const visited = new Set<string>()

  function walk(nodeId: string, ancestors: string[]): string[] {
    if (ancestors.includes(nodeId)) {
      const cyclic = nodes.get(nodeId)
      if (cyclic) {
        const entry: ComputedAreaNode = {
          id: nodeId,
          tenantId: cyclic.area.tenantId,
          organizationId: cyclic.area.organizationId,
          name: cyclic.area.name,
          pathLabel: cyclic.area.name,
          parentId: null,
          depth: 0,
          rootId: nodeId,
          treePath: nodeId,
          ancestorIds: [],
          childIds: [],
          descendantIds: [],
          isActive: !!cyclic.area.isActive,
          sortOrder: cyclic.area.sortOrder ?? 0,
        }
        computed.set(nodeId, entry)
        if (!orderedSet.has(nodeId)) {
          orderedIds.push(nodeId)
          orderedSet.add(nodeId)
        }
      }
      visited.add(nodeId)
      return []
    }

    const node = nodes.get(nodeId)
    if (!node) return []

    visited.add(nodeId)
    const area = node.area
    const id = String(area.id)
    const nextAncestors = [...ancestors, id]
    if (!orderedSet.has(id)) {
      orderedIds.push(id)
      orderedSet.add(id)
    }

    const childIds = Array.from(node.children)
      .filter((childId) => nodes.has(childId))
      .sort((a, b) => {
        const nodeA = nodes.get(a)!.area
        const nodeB = nodes.get(b)!.area
        const orderA = nodeA.sortOrder ?? 0
        const orderB = nodeB.sortOrder ?? 0
        if (orderA !== orderB) return orderA - orderB
        return nodeA.name.localeCompare(nodeB.name)
      })

    const descendantIds: string[] = []
    for (const childId of childIds) {
      const desc = walk(childId, nextAncestors)
      descendantIds.push(childId, ...desc)
    }

    const ancestorIds = ancestors
    const depth = ancestorIds.length
    const rootId = ancestorIds.length ? ancestorIds[0]! : id
    const treePath = nextAncestors.join('/')
    const ancestorNames = ancestors
      .map((ancestorId) => nodes.get(ancestorId)?.area.name)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    const pathLabel = [...ancestorNames, area.name].join(' / ')

    const computedNode: ComputedAreaNode = {
      id,
      tenantId: area.tenantId,
      organizationId: area.organizationId,
      name: area.name,
      pathLabel,
      parentId: node.parentId,
      depth,
      rootId,
      treePath,
      ancestorIds,
      childIds,
      descendantIds,
      isActive: !!area.isActive,
      sortOrder: area.sortOrder ?? 0,
    }
    computed.set(id, computedNode)
    return descendantIds
  }

  for (const [id, node] of nodes) {
    if (!node.parentId || !nodes.has(node.parentId)) {
      walk(id, [])
    }
  }

  for (const id of nodes.keys()) {
    if (!visited.has(id)) {
      walk(id, [])
    }
  }

  const ordered = orderedIds
    .map((id) => computed.get(id))
    .filter((node): node is ComputedAreaNode => !!node)

  return { map: computed, ordered }
}
