/**
 * Service to snapshot catalog options into appointment line option groups and options.
 * Preserves the nested group hierarchy and option metadata at booking time.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProductOptionGroup, CatalogProductOption } from '@open-mercato/core/modules/catalog/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { AppointmentLine, AppointmentLineOptionGroup, AppointmentLineOption } from '../data/entities'

export interface SelectedOptionsInput {
  /** Legacy JSONB format: { [groupId]: optionId | optionId[] } */
  selectedOptions?: Record<string, unknown> | Record<string, unknown>[] | null
}

/**
 * Build a breadcrumb path for a group by traversing up to root.
 */
function buildBreadcrumbPath(
  groupId: string,
  groupsById: Map<string, CatalogProductOptionGroup>,
  optionsById: Map<string, CatalogProductOption>,
  visited: Set<string> = new Set(),
): string | null {
  if (visited.has(groupId)) return null // Prevent infinite loop
  visited.add(groupId)

  const group = groupsById.get(groupId)
  if (!group) return null

  const parts: string[] = [group.name]

  // If this group has a parent option, prepend the parent's path
  if (group.parentOption?.id) {
    const parentOption = optionsById.get(group.parentOption.id)
    if (parentOption?.group?.id) {
      const parentPath = buildBreadcrumbPath(
        typeof parentOption.group === 'string' ? parentOption.group : parentOption.group.id,
        groupsById,
        optionsById,
        visited,
      )
      if (parentPath) {
        parts.unshift(parentPath)
      }
    }
  }

  return parts.join(' > ')
}

/**
 * Load catalog option groups and options for a product.
 * Queries across the organization and its ancestors (like seatPlannerService does).
 */
async function loadCatalogOptions(
  em: EntityManager,
  productId: string,
  tenantId: string,
  organizationId: string,
): Promise<{ groups: CatalogProductOptionGroup[]; options: CatalogProductOption[] }> {
  // Get organization and its ancestors (resources/catalog may be at parent org)
  const organization = await em.findOne(
    Organization,
    { id: organizationId, tenant: tenantId, deletedAt: null },
  )
  const organizationIds = [
    organizationId,
    ...(organization?.ancestorIds ?? []),
  ]

  const groups = await em.find(
    CatalogProductOptionGroup,
    {
      product: productId,
      tenantId,
      organizationId: { $in: organizationIds },
      deletedAt: null,
    },
    { orderBy: { sortOrder: 'asc' } },
  )

  const groupIds = groups.map((g) => g.id)
  const options = groupIds.length > 0
    ? await em.find(
        CatalogProductOption,
        {
          group: { $in: groupIds },
          tenantId,
          organizationId: { $in: organizationIds },
          deletedAt: null,
        },
        { orderBy: { sortOrder: 'asc' } },
      )
    : []

  return { groups, options }
}

/**
 * Create snapshots of selected options for an appointment line.
 * Also handles the legacy JSONB format in selectedOptions field.
 */
export async function snapshotLineOptions(
  em: EntityManager,
  line: AppointmentLine,
  input: SelectedOptionsInput,
): Promise<void> {
  if (!input.selectedOptions) return

  const { groups, options } = await loadCatalogOptions(
    em,
    line.productId,
    line.tenantId,
    line.organizationId,
  )

  if (groups.length === 0 || options.length === 0) return

  const groupsById = new Map(groups.map((g) => [g.id, g]))
  const optionsById = new Map(options.map((o) => [o.id, o]))

  // Build a map of optionId -> groupId for quick lookup
  const optionToGroup = new Map<string, string>()
  for (const opt of options) {
    const groupId = typeof opt.group === 'string' ? opt.group : opt.group.id
    optionToGroup.set(opt.id, groupId)
  }

  // Determine which groups and options are selected
  const selectedGroupIds = new Set<string>()
  const selectedOptionIds = new Set<string>()

  const parseSelectedOptions = (selected: Record<string, unknown> | Record<string, unknown>[]): void => {
    if (Array.isArray(selected)) {
      // Array format: [{ groupId: "...", optionId: "..." }, ...]
      for (const item of selected) {
        if (typeof item === 'object' && item !== null) {
          const record = item as Record<string, unknown>
          if (record.groupId && typeof record.groupId === 'string') {
            selectedGroupIds.add(record.groupId)
          }
          if (record.optionId && typeof record.optionId === 'string') {
            selectedOptionIds.add(record.optionId)
          }
        }
      }
    } else {
      // Object format: { [groupId]: optionId | optionId[] }
      for (const [groupId, value] of Object.entries(selected)) {
        selectedGroupIds.add(groupId)
        const optionIds = Array.isArray(value) ? value : [value]
        for (const optId of optionIds) {
          if (typeof optId === 'string') {
            selectedOptionIds.add(optId)
          }
        }
      }
    }
  }

  parseSelectedOptions(input.selectedOptions)

  // Build parent chain for nested groups
  const groupParentChain = new Map<string, string | null>()
  for (const group of groups) {
    groupParentChain.set(group.id, group.parentOption?.id ?? null)
  }

  // Find all root groups that should be created (either directly selected or parent of selected)
  const groupsToCreate = new Set<string>()

  // Add all directly selected groups
  for (const groupId of selectedGroupIds) {
    groupsToCreate.add(groupId)
  }

  // Add parent groups for selected options
  for (const optionId of selectedOptionIds) {
    const groupId = optionToGroup.get(optionId)
    if (groupId) {
      groupsToCreate.add(groupId)

      // Traverse up to find all ancestors
      let currentGroupId: string | null = groupId
      const visited = new Set<string>()
      while (currentGroupId && !visited.has(currentGroupId)) {
        visited.add(currentGroupId)
        const parentOptionId = groupParentChain.get(currentGroupId)
        if (parentOptionId) {
          const parentGroupId = optionToGroup.get(parentOptionId)
          if (parentGroupId) {
            groupsToCreate.add(parentGroupId)
            currentGroupId = parentGroupId
          } else {
            break
          }
        } else {
          break
        }
      }
    }
  }

  // Create option group snapshots
  const createdGroupEntities = new Map<string, AppointmentLineOptionGroup>()
  const visitedForPath = new Set<string>()

  for (const groupId of groupsToCreate) {
    const catalogGroup = groupsById.get(groupId)
    if (!catalogGroup) continue

    const isRootGroup = !catalogGroup.parentOption?.id
    const breadcrumbPath = buildBreadcrumbPath(groupId, groupsById, optionsById, visitedForPath)

    const groupEntity = em.create(AppointmentLineOptionGroup, {
      line,
      catalogGroupId: catalogGroup.id,
      parentOptionId: catalogGroup.parentOption?.id ?? null,
      groupName: catalogGroup.name,
      requirement: catalogGroup.requirement,
      selectMode: catalogGroup.selectMode,
      sortOrder: catalogGroup.sortOrder,
      breadcrumbPath,
      isRootGroup,
    })
    em.persist(groupEntity)
    createdGroupEntities.set(groupId, groupEntity)
  }

  // Create option snapshots for selected options
  for (const optionId of selectedOptionIds) {
    const catalogOption = optionsById.get(optionId)
    if (!catalogOption) continue

    const groupId = optionToGroup.get(optionId)
    const groupEntity = groupId ? createdGroupEntities.get(groupId) : undefined
    if (!groupEntity) continue

    const optionEntity = em.create(AppointmentLineOption, {
      group: groupEntity,
      catalogOptionId: catalogOption.id,
      optionName: catalogOption.name,
      code: catalogOption.code ?? null,
      note: catalogOption.note ?? null,
      priceFlat: catalogOption.priceFlat ?? null,
      priceMin: catalogOption.priceMin ?? null,
      priceMax: catalogOption.priceMax ?? null,
      durationValue: catalogOption.durationValue ?? null,
      durationUnit: catalogOption.durationUnit ?? null,
      isAddon: catalogOption.isAddon,
      sortOrder: catalogOption.sortOrder,
    })
    em.persist(optionEntity)
  }
}

/**
 * Load option group and option snapshots for a line (for display in seat planner).
 */
export async function loadLineOptionSnapshots(
  em: EntityManager,
  lineId: string,
): Promise<{
  groups: Array<{
    id: string
    catalogGroupId: string | null
    groupName: string
    breadcrumbPath: string | null
    isRootGroup: boolean
    options: Array<{
      id: string
      optionName: string
      code: string | null
      note: string | null
      priceFlat: string | null
      isAddon: boolean
    }>
  }>
}> {
  const groups = await em.find(
    AppointmentLineOptionGroup,
    { line: lineId },
    { populate: ['options'], orderBy: { sortOrder: 'asc' } },
  )

  return {
    groups: groups.map((g) => ({
      id: g.id,
      catalogGroupId: g.catalogGroupId ?? null,
      groupName: g.groupName,
      breadcrumbPath: g.breadcrumbPath ?? null,
      isRootGroup: g.isRootGroup,
      options: g.options.map((o) => ({
        id: o.id,
        optionName: o.optionName,
        code: o.code ?? null,
        note: o.note ?? null,
        priceFlat: o.priceFlat ?? null,
        isAddon: o.isAddon,
      })),
    })),
  }
}

/**
 * Delete all option snapshots for a line (used when replacing lines).
 */
export async function deleteLineOptionSnapshots(
  em: EntityManager,
  lineId: string,
): Promise<void> {
  const groups = await em.find(AppointmentLineOptionGroup, { line: lineId })
  for (const group of groups) {
    em.remove(group)
  }
  await em.flush()
}
