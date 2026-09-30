import type { EntityManager } from '@mikro-orm/postgresql'
import { randomUUID } from 'node:crypto'
import { AppointmentLine, AppointmentLineOption, AppointmentLineOptionGroup } from '@open-mercato/core/modules/appointments/data/entities'
import { CatalogProductOption, CatalogProductOptionGroup } from '@open-mercato/core/modules/catalog/data/entities'

export type TpsSelectedOptionDetail = {
  optionId?: string
  path?: Array<{ optionId?: string }>
}

export type SelectedOptions = Record<string, string | string[]>

function getOptionGroupId(option: CatalogProductOption): string {
  return typeof option.group === 'string' ? option.group : option.group.id
}

export function buildSelectedOptions(
  productId: string,
  details: TpsSelectedOptionDetail[] | undefined,
  optionByProductAndSource: Map<string, CatalogProductOption>,
): SelectedOptions {
  const selectedOptions: SelectedOptions = {}

  const addOption = (sourceOptionId: string | undefined): void => {
    if (!sourceOptionId) return
    const option = optionByProductAndSource.get(`${productId}:${sourceOptionId}`)
    if (!option) return

    const groupId = getOptionGroupId(option)
    const current = selectedOptions[groupId]
    if (current === undefined) {
      selectedOptions[groupId] = option.id
      return
    }

    const currentOptions = Array.isArray(current) ? current : [current]
    if (currentOptions.includes(option.id)) return
    selectedOptions[groupId] = [...currentOptions, option.id]
  }

  for (const detail of details ?? []) {
    for (const pathEntry of detail.path ?? []) addOption(pathEntry.optionId)
    addOption(detail.optionId)
  }

  return selectedOptions
}

function buildBreadcrumbPath(
  groupId: string,
  groupsById: Map<string, CatalogProductOptionGroup>,
  optionsById: Map<string, CatalogProductOption>,
  visited: Set<string> = new Set(),
): string | null {
  if (visited.has(groupId)) return null
  visited.add(groupId)

  const group = groupsById.get(groupId)
  if (!group) return null

  const parts: string[] = [group.name]
  const parentOptionId = group.parentOption?.id
  if (parentOptionId) {
    const parentOption = optionsById.get(parentOptionId)
    if (parentOption?.group?.id) {
      const parentPath = buildBreadcrumbPath(
        typeof parentOption.group === 'string' ? parentOption.group : parentOption.group.id,
        groupsById,
        optionsById,
        visited,
      )
      if (parentPath) parts.unshift(parentPath)
    }
  }

  return parts.join(' > ')
}

export function createOptionSnapshots(
  em: EntityManager,
  line: AppointmentLine,
  selectedOptions: SelectedOptions,
  groupsById: Map<string, CatalogProductOptionGroup>,
  optionsById: Map<string, CatalogProductOption>,
): void {
  let sortOrder = 0
  for (const [groupId, selectedValue] of Object.entries(selectedOptions)) {
    const group = groupsById.get(groupId)
    if (!group) continue

    const groupSnapshot = em.create(AppointmentLineOptionGroup, {
      id: randomUUID(),
      line,
      catalogGroupId: group.id,
      parentOptionId: group.parentOption?.id ?? null,
      groupName: group.name,
      requirement: group.requirement,
      selectMode: group.selectMode,
      sortOrder: sortOrder++,
      breadcrumbPath: buildBreadcrumbPath(group.id, groupsById, optionsById),
      isRootGroup: !group.parentOption,
    })
    em.persist(groupSnapshot)

    const optionIds = Array.isArray(selectedValue) ? selectedValue : [selectedValue]
    for (const [optionSortOrder, optionId] of optionIds.entries()) {
      const option = optionsById.get(optionId)
      if (!option) continue
      em.persist(em.create(AppointmentLineOption, {
        id: randomUUID(),
        group: groupSnapshot,
        catalogOptionId: option.id,
        optionName: option.name,
        code: option.code ?? null,
        note: option.note ?? null,
        priceFlat: option.priceFlat ?? null,
        priceMin: option.priceMin ?? null,
        priceMax: option.priceMax ?? null,
        durationValue: option.durationValue ?? null,
        durationUnit: option.durationUnit ?? null,
        isAddon: option.isAddon,
        sortOrder: optionSortOrder,
      }))
    }
  }
}
