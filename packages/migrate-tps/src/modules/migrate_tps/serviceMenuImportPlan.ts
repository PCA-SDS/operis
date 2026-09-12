import type {
  OptionGroup,
  OptionReference,
  ServiceCategory,
  ServiceItem,
  ServiceMenuData,
  ServiceTabMenu,
} from './data/types'
import { extractTpsDuration, parseTpsDurationForEntity, slugifyTpsText } from './mapping'

export const SERVICE_SCHEDULE_FIELDSET = 'service_schedule'
export const SERVICE_DURATION_FIELD = 'service_duration_minutes'
export const CATALOG_PRODUCT_ENTITY_ID = 'catalog:catalog_product'
export const CATALOG_PRODUCT_VARIANT_ENTITY_ID = 'catalog:catalog_product_variant'

export type ServiceMenuProductPlan = {
  tabId: string
  categoryId: string
  categoryLabel: string
  categoryType: string
  item: ServiceItem
  productId: string
  sku: string
  handle: string
  title: string
  duration?: string
  durationSummaryMinutes?: number
  durationRange?: { min: number; max: number }
}

export type ServiceMenuOptionOccurrence = {
  key: string
  productId: string
  optionId: string
  groupId: string
  name: string
  groupPath: string[]
  optionPath: string[]
}

export type ServiceMenuConstraintEndpoint =
  | { kind: 'product'; productId: string }
  | { kind: 'option'; optionKey: string }

export type ServiceMenuConstraintPlan = {
  constraintType: 'conflicts_with_item' | 'mutually_exclusive_item' | 'includes_item'
  source: ServiceMenuConstraintEndpoint
  target: ServiceMenuConstraintEndpoint
  locked: boolean
  sourcePath: string
}

export type ServiceMenuImportPlan = {
  products: ServiceMenuProductPlan[]
  productById: Map<string, ServiceMenuProductPlan>
  optionOccurrences: ServiceMenuOptionOccurrence[]
  optionOccurrencesByKey: Map<string, ServiceMenuOptionOccurrence>
  constraints: ServiceMenuConstraintPlan[]
}

type TraversalContext = {
  tab: ServiceTabMenu
  category: ServiceCategory
  item: ServiceItem
}

export function buildServiceMenuOptionKey(productId: string, optionPath: string[]): string {
  return `${productId}::${optionPath.join('/')}`
}

export function buildServiceMenuImportPlan(menu: ServiceMenuData): ServiceMenuImportPlan {
  const products: ServiceMenuProductPlan[] = []
  const productById = new Map<string, ServiceMenuProductPlan>()
  const optionOccurrences: ServiceMenuOptionOccurrence[] = []
  const optionOccurrencesByKey = new Map<string, ServiceMenuOptionOccurrence>()

  for (const tab of Object.values(menu)) {
    for (const category of tab.categories) {
      for (const item of category.items) {
        const product = buildProductPlan(tab, category, item)
        addUnique(productById, item.id, product, 'product id')
        products.push(product)
        collectOptionOccurrences({ tab, category, item }, item.optionGroups ?? [], [], [], optionOccurrences, optionOccurrencesByKey)
      }
    }
  }

  assertUnique(products, 'sku', (product) => product.sku)
  assertUnique(products, 'handle', (product) => product.handle)

  const constraints = collectConstraints(menu, productById, optionOccurrences)

  return {
    products,
    productById,
    optionOccurrences,
    optionOccurrencesByKey,
    constraints,
  }
}

function buildProductPlan(
  tab: ServiceTabMenu,
  category: ServiceCategory,
  item: ServiceItem,
): ServiceMenuProductPlan {
  const duration = extractTpsDuration(item)
  const parsedDuration = parseTpsDurationForEntity(duration)
  const durationRange = parsedDuration.durationMin !== undefined && parsedDuration.durationMax !== undefined
    ? { min: parsedDuration.durationMin, max: parsedDuration.durationMax }
    : undefined

  return {
    tabId: tab.tabId,
    categoryId: category.id,
    categoryLabel: category.label,
    categoryType: category.type ?? 'unknown',
    item,
    productId: item.id,
    sku: item.id || slugifyTpsText(`${category.label} ${item.name}`),
    handle: slugifyTpsText(`${category.label} ${item.name}`),
    title: item.name,
    duration,
    durationSummaryMinutes: parsedDuration.durationValue ?? parsedDuration.durationMin,
    durationRange,
  }
}

function collectOptionOccurrences(
  context: TraversalContext,
  groups: OptionGroup[],
  groupPath: string[],
  optionPath: string[],
  occurrences: ServiceMenuOptionOccurrence[],
  occurrencesByKey: Map<string, ServiceMenuOptionOccurrence>,
): void {
  for (const group of groups) {
    const nextGroupPath = [...groupPath, group.id]
    for (const option of group.options) {
      const nextOptionPath = [...optionPath, group.id, option.id]
      const occurrence: ServiceMenuOptionOccurrence = {
        key: buildServiceMenuOptionKey(context.item.id, nextOptionPath),
        productId: context.item.id,
        optionId: option.id,
        groupId: group.id,
        name: option.name,
        groupPath: nextGroupPath,
        optionPath: nextOptionPath,
      }
      addUnique(occurrencesByKey, occurrence.key, occurrence, 'option path')
      occurrences.push(occurrence)
      collectOptionOccurrences(
        context,
        option.nextGroups ?? [],
        nextGroupPath,
        nextOptionPath,
        occurrences,
        occurrencesByKey,
      )
    }
  }
}

function collectConstraints(
  menu: ServiceMenuData,
  productById: Map<string, ServiceMenuProductPlan>,
  optionOccurrences: ServiceMenuOptionOccurrence[],
): ServiceMenuConstraintPlan[] {
  const constraints: ServiceMenuConstraintPlan[] = []
  for (const tab of Object.values(menu)) {
    for (const category of tab.categories) {
      for (const item of category.items) {
        requireProduct(productById, item.id, `item ${item.id}`)

        for (const targetProductId of item.mutuallyExclusiveItems ?? []) {
          requireProduct(productById, targetProductId, `${item.id}.mutuallyExclusiveItems`)
          constraints.push({
            constraintType: 'mutually_exclusive_item',
            source: { kind: 'product', productId: item.id },
            target: { kind: 'product', productId: targetProductId },
            locked: false,
            sourcePath: `${tab.tabId}/${category.id}/${item.id}`,
          })
        }

        if (item.include) {
          requireProduct(productById, item.include.itemId, `${item.id}.include`)
          constraints.push({
            constraintType: 'includes_item',
            source: { kind: 'product', productId: item.id },
            target: { kind: 'product', productId: item.include.itemId },
            locked: item.include.locked ?? false,
            sourcePath: `${tab.tabId}/${category.id}/${item.id}`,
          })
        }

        collectOptionConstraints(
          item,
          item.optionGroups ?? [],
          [],
          productById,
          optionOccurrences,
          constraints,
        )
      }
    }
  }
  return constraints
}

function collectOptionConstraints(
  item: ServiceItem,
  groups: OptionGroup[],
  optionPath: string[],
  productById: Map<string, ServiceMenuProductPlan>,
  optionOccurrences: ServiceMenuOptionOccurrence[],
  constraints: ServiceMenuConstraintPlan[],
): void {
  for (const group of groups) {
    for (const option of group.options) {
      const currentPath = [...optionPath, group.id, option.id]
      const sourceOption = resolveOptionRef(
        optionOccurrences,
        {
          productId: item.id,
          optionId: option.id,
          optionPath: currentPath,
        },
        `${item.id}.${option.id}`,
      )

      for (const targetProductId of option.conflictsWithItems ?? []) {
        requireProduct(productById, targetProductId, `${item.id}.${option.id}.conflictsWithItems`)
        constraints.push({
          constraintType: 'conflicts_with_item',
          source: { kind: 'option', optionKey: sourceOption.key },
          target: { kind: 'product', productId: targetProductId },
          locked: false,
          sourcePath: sourceOption.key,
        })
      }

      for (const targetRef of option.conflictsWithOptions ?? []) {
        const targetOption = resolveOptionRef(optionOccurrences, targetRef, `${item.id}.${option.id}.conflictsWithOptions`)
        constraints.push({
          constraintType: 'conflicts_with_item',
          source: { kind: 'option', optionKey: sourceOption.key },
          target: { kind: 'option', optionKey: targetOption.key },
          locked: false,
          sourcePath: sourceOption.key,
        })
      }

      for (const targetOptionId of option.mutuallyExclusive ?? []) {
        const targetOption = resolveOptionRef(
          optionOccurrences,
          { productId: item.id, optionId: targetOptionId },
          `${item.id}.${option.id}.mutuallyExclusive`,
        )
        constraints.push({
          constraintType: 'mutually_exclusive_item',
          source: { kind: 'option', optionKey: sourceOption.key },
          target: { kind: 'option', optionKey: targetOption.key },
          locked: false,
          sourcePath: sourceOption.key,
        })
      }

      collectOptionConstraints(
        item,
        option.nextGroups ?? [],
        currentPath,
        productById,
        optionOccurrences,
        constraints,
      )
    }
  }
}

function resolveOptionRef(
  occurrences: ServiceMenuOptionOccurrence[],
  ref: OptionReference,
  context: string,
): ServiceMenuOptionOccurrence {
  const matches = occurrences.filter((occurrence) => {
    if (occurrence.productId !== ref.productId) return false
    if (occurrence.optionId !== ref.optionId) return false
    if (ref.groupPath && !samePath(occurrence.groupPath, ref.groupPath)) return false
    if (ref.optionPath && !samePath(occurrence.optionPath, ref.optionPath)) return false
    return true
  })

  if (matches.length === 1) return matches[0]
  if (matches.length === 0) {
    throw new Error(`[internal] migrate_tps: unresolved option ref ${formatOptionRef(ref)} at ${context}`)
  }

  throw new Error(
    `[internal] migrate_tps: ambiguous option ref ${formatOptionRef(ref)} at ${context}; candidates: ${matches
      .map((match) => match.key)
      .join(', ')}`,
  )
}

function requireProduct(
  productById: Map<string, ServiceMenuProductPlan>,
  productId: string,
  context: string,
): ServiceMenuProductPlan {
  const product = productById.get(productId)
  if (!product) {
    throw new Error(`[internal] migrate_tps: unresolved product ref ${productId} at ${context}`)
  }
  return product
}

function addUnique<T>(map: Map<string, T>, key: string, value: T, label: string): void {
  if (map.has(key)) {
    throw new Error(`[internal] migrate_tps: duplicate ${label} ${key}`)
  }
  map.set(key, value)
}

function assertUnique<T>(items: T[], label: string, getKey: (item: T) => string): void {
  const seen = new Set<string>()
  for (const item of items) {
    const key = getKey(item)
    if (seen.has(key)) {
      throw new Error(`[internal] migrate_tps: duplicate ${label} ${key}`)
    }
    seen.add(key)
  }
}

function samePath(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((segment, index) => segment === right[index])
}

function formatOptionRef(ref: OptionReference): string {
  const parts = [`productId=${ref.productId}`, `optionId=${ref.optionId}`]
  if (ref.groupPath) parts.push(`groupPath=${ref.groupPath.join('/')}`)
  if (ref.optionPath) parts.push(`optionPath=${ref.optionPath.join('/')}`)
  return `{ ${parts.join(', ')} }`
}
