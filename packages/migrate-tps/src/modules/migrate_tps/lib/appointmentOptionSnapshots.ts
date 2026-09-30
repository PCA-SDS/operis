import type { EntityManager } from '@mikro-orm/postgresql'
import { randomUUID } from 'node:crypto'
import { AppointmentLine, AppointmentLineOption, AppointmentLineOptionGroup } from '@open-mercato/core/modules/appointments/data/entities'
import { CatalogProductOption, CatalogProductOptionGroup } from '@open-mercato/core/modules/catalog/data/entities'

export type TpsSelectedOptionDetail = {
  optionId?: string
  path?: Array<{ optionId?: string }>
}

export type SelectedOptions = Record<string, string | string[]>
export type OptionsByProductAndSource = Map<string, CatalogProductOption[]>

function getOptionGroupId(option: CatalogProductOption): string {
  return typeof option.group === 'string' ? option.group : option.group.id
}

export function buildSelectedOptions(
  productId: string,
  details: TpsSelectedOptionDetail[] | undefined,
  optionsByProductAndSource: OptionsByProductAndSource,
  groupsById: Map<string, CatalogProductOptionGroup>,
): SelectedOptions {
  const selectedOptions: SelectedOptions = {}

  const resolveOption = (sourceOptionId: string, parentOptionId: string | null): CatalogProductOption | undefined => {
    const candidates = optionsByProductAndSource.get(`${productId}:${sourceOptionId}`) ?? []
    const matchingCandidates = candidates.filter((candidate) => {
      const group = groupsById.get(getOptionGroupId(candidate))
      return (group?.parentOption?.id ?? null) === parentOptionId
    })
    if (matchingCandidates.length === 1) return matchingCandidates[0]
    return undefined
  }

  const addOption = (option: CatalogProductOption): void => {
    const groupId = getOptionGroupId(option)
    const group = groupsById.get(groupId)
    const current = selectedOptions[groupId]
    if (current === undefined) {
      selectedOptions[groupId] = group?.selectMode === 'multiple' ? [option.id] : option.id
      return
    }

    const currentOptions = Array.isArray(current) ? current : [current]
    if (currentOptions.includes(option.id)) return
    selectedOptions[groupId] = [...currentOptions, option.id]
  }

  for (const detail of details ?? []) {
    let parentOptionId: string | null = null
    for (const sourceOptionId of [...(detail.path ?? []).map((entry) => entry.optionId), detail.optionId]) {
      if (!sourceOptionId) continue
      const option = resolveOption(sourceOptionId, parentOptionId)
      if (!option) break
      addOption(option)
      parentOptionId = option.id
    }
  }

  return selectedOptions
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
      breadcrumbPath: group.name,
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
