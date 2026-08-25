import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { SERVICE_MENU } from './data/serviceMenu'
import type { Price, Option } from './data/types'
import type { CatalogProductType } from '../data/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogOptionSchemaTemplate,
  CatalogProductVariant,
  CatalogProductPrice,
  CatalogPriceKind,
} from '../data/entities'
import { randomUUID } from 'crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('catalog')

// Simple slugify helper
function slugifyText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

// Helper to sum two prices
function sumPrices(p1: Price | undefined, p2: Price | undefined): Price | undefined {
  if (!p1) return p2
  if (!p2) return p1

  const p1Min = typeof p1 === 'number' ? p1 : p1.kind === 'range' ? p1.min : p1.women
  const p1Max = typeof p1 === 'number' ? p1 : p1.kind === 'range' ? p1.max : (p1 as any).men || p1.women
  const p1IsRange = typeof p1 === 'object' && p1.kind === 'range'

  const p2Min = typeof p2 === 'number' ? p2 : p2.kind === 'range' ? p2.min : p2.women
  const p2Max = typeof p2 === 'number' ? p2 : p2.kind === 'range' ? p2.max : (p2 as any).men || p2.women
  const p2IsRange = typeof p2 === 'object' && p2.kind === 'range'

  if (p1IsRange || p2IsRange) {
    return { kind: 'range', min: p1Min + p2Min, max: p1Max + p2Max }
  }
  return p1Min + p2Min
}

// Helper to parse price into a safe DB value and metadata
function parsePrice(price: Price | undefined): { unitPriceGross: string | null; metadata: Record<string, any> | null } {
  if (price === undefined || price === null) {
    return { unitPriceGross: null, metadata: null }
  }
  if (typeof price === 'number') {
    return { unitPriceGross: price.toString(), metadata: null }
  }
  if (typeof price === 'object') {
    if (price.kind === 'range') {
      return { unitPriceGross: price.min.toString(), metadata: price }
    }
    if (price.kind === 'gender') {
      return { unitPriceGross: price.women.toString(), metadata: price }
    }
  }
  return { unitPriceGross: null, metadata: null }
}

function extractDuration(item: any): string | undefined {
  if (item.duration) return item.duration
  
  const regex = /(\d+(?:\s*[-–]\s*\d+)?)\s*(?:mins|min|m)\b/i
  
  if (item.name) {
    const match = item.name.match(regex)
    if (match) return `${match[1].replace('–', '-')} mins`
  }
  if (item.description) {
    const match = item.description.match(regex)
    if (match) return `${match[1].replace('–', '-')} mins`
  }
  return undefined
}

type OptionPath = {
  optionValues: Record<string, string>
  totalPrice: Price | undefined
  names: string[]
  durations: string[]
}

function collectAllGroups(groups: any[], schemaGroups: Map<string, Set<string>>) {
  for (const group of groups) {
    if (!schemaGroups.has(group.label)) {
      schemaGroups.set(group.label, new Set())
    }
    const optionSet = schemaGroups.get(group.label)!
    for (const opt of group.options) {
      optionSet.add(opt.name)
      if (opt.nextGroups && opt.nextGroups.length > 0) {
        collectAllGroups(opt.nextGroups, schemaGroups)
      }
    }
  }
}

function enumeratePaths(groups: any[], currentPath: OptionPath): OptionPath[] {
  if (!groups || groups.length === 0) {
    return [currentPath]
  }

  let paths: OptionPath[] = [currentPath]

  for (const group of groups) {
    const nextPaths: OptionPath[] = []
    for (const path of paths) {
      for (const opt of group.options) {
        const newDurations = [...path.durations]
        const optDuration = extractDuration(opt)
        if (optDuration) newDurations.push(optDuration)

        const newPath: OptionPath = {
          optionValues: { ...path.optionValues, [group.label]: opt.name },
          totalPrice: sumPrices(path.totalPrice, opt.price),
          names: [...path.names, opt.name],
          durations: newDurations,
        }

        if (opt.nextGroups && opt.nextGroups.length > 0) {
          nextPaths.push(...enumeratePaths(opt.nextGroups, newPath))
        } else {
          nextPaths.push(newPath)
        }
      }
    }
    paths = nextPaths
  }

  return paths
}

function createVariantForOption(em: EntityManager, product: CatalogProduct, defaultPriceKind: CatalogPriceKind, tenantId: string, organizationId: string, itemName: string, optionValuesMap: Record<string, string>, totalPrice: Price | undefined, variantSuffix: string, isDefault: boolean, extraDurations: string[]) {
  const parsedOptionValues: Record<string, string> = {}
  for (const [key, val] of Object.entries(optionValuesMap)) {
    parsedOptionValues[slugifyText(key)] = slugifyText(val)
  }

  const parsedPrice = parsePrice(totalPrice)

  const variantMetadata: Record<string, any> = {}
  if (parsedPrice.metadata) {
    variantMetadata.originalPriceRange = parsedPrice.metadata
  }
  if (extraDurations.length > 0) {
    variantMetadata.extra_durations = extraDurations
  }

  const variant = em.create(CatalogProductVariant, {
    id: randomUUID(),
    tenantId,
    organizationId,
    product: product,
    name: variantSuffix,
    sku: slugifyText(`${itemName}-${variantSuffix}`),
    optionValues: parsedOptionValues,
    isActive: true,
    isDefault,
    metadata: Object.keys(variantMetadata).length > 0 ? variantMetadata : null,
  })
  em.persist(variant)

  if (parsedPrice.unitPriceGross) {
    const priceEntity = em.create(CatalogProductPrice, {
      id: randomUUID(),
      tenantId,
      organizationId,
      variant: variant,
      product: product,
      priceKind: defaultPriceKind,
      currencyCode: 'VND',
      kind: 'regular',
      minQuantity: 1,
      unitPriceGross: parsedPrice.unitPriceGross,
      metadata: parsedPrice.metadata,
    })
    em.persist(priceEntity)
  }
}

export const migrateTpsProductsCommand: ModuleCli = {
  command: 'migrate-tps-products',
  async run(rest) {
    const [tenantId, organizationId] = rest
    if (!tenantId || !organizationId) {
      logger.error('Missing tenantId or organizationId')
      logger.error('Usage: yarn mercato catalog migrate-tps-products <tenantId> <organizationId>')
      return
    }

    const { resolve } = await (await import('@open-mercato/shared/lib/di/container')).createRequestContainer()
    const em = resolve<EntityManager>('em').fork()

    logger.info(`Starting TPS Product migration for Tenant: ${tenantId}, Org: ${organizationId}`)

    logger.info('Cleaning up existing products for this tenant...')

    await em.nativeDelete(CatalogProductPrice, { tenantId })
    await em.nativeDelete(CatalogProductCategoryAssignment, { tenantId })
    await em.nativeDelete(CatalogProductVariant, { tenantId })
    await em.nativeDelete(CatalogOptionSchemaTemplate, { tenantId })
    await em.nativeDelete(CatalogProduct, { tenantId })
    
    logger.info('Cleanup complete.')

    let defaultPriceKind = await em.findOne(CatalogPriceKind, { tenantId, code: 'default' })
    if (!defaultPriceKind) {
      defaultPriceKind = em.create(CatalogPriceKind, {
        id: randomUUID(),
        tenantId,
        organizationId,
        code: 'default',
        title: 'Default Price',
        currencyCode: 'VND',
        displayMode: 'including-tax',
        isActive: true,
        isPromotion: false,
      })
      em.persist(defaultPriceKind)
      await em.flush()
    }

    const categories = await em.find(CatalogProductCategory, { tenantId, organizationId })
    const categoryMap = new Map<string, CatalogProductCategory>()
    categories.forEach((c) => {
      categoryMap.set(c.name, c)
    })

    let productCount = 0
    let variantCount = 0

    for (const rootCat of Object.values(SERVICE_MENU)) {
      for (const category of rootCat.categories) {
        for (const item of category.items) {
          const isConfigurable = (item.optionGroups?.length ?? 0) > 0
          
          let mappedType: CatalogProductType = 'simple'
          if (category.type === 'service') mappedType = 'virtual'
          else if (category.type === 'package') mappedType = 'bundle'

          const finalProductType = isConfigurable ? 'configurable' : mappedType

          const productMetadata: Record<string, any> = {
            tps_id: item.id,
            tps_type: category.type || 'unknown',
          }
          const itemDuration = extractDuration(item)
          if (itemDuration) {
            productMetadata.duration = itemDuration
          }
          
          const parsedProductPrice = parsePrice(item.price)
          if (parsedProductPrice.metadata) {
            productMetadata.price_rules = parsedProductPrice.metadata
          }

          const product = em.create(CatalogProduct, {
            id: randomUUID(),
            tenantId,
            organizationId,
            title: item.name,
            description: item.description || '',
            sku: slugifyText(`${category.label} ${item.name}`),
            handle: slugifyText(`${category.label} ${item.name}`),
            productType: finalProductType,
            isConfigurable: isConfigurable,
            isActive: true,
            metadata: productMetadata,
          })
          em.persist(product)
          productCount++

          if (category.label && categoryMap.has(category.label)) {
            const assignment = em.create(CatalogProductCategoryAssignment, {
              id: randomUUID(),
              tenantId,
              organizationId,
              product: product,
              category: categoryMap.get(category.label)!,
              position: 0,
            })
            em.persist(assignment)
          }

          if (isConfigurable && item.optionGroups) {
            const optionSchema = em.create(CatalogOptionSchemaTemplate, {
              id: randomUUID(),
              tenantId,
              organizationId,
              name: `${category.label} - ${item.name} Options`,
              code: slugifyText(`${category.label} ${item.name} Options`),
              isActive: true,
              schema: {
                options: (() => {
                  const schemaMap = new Map<string, Set<string>>()
                  collectAllGroups(item.optionGroups || [], schemaMap)
                  const flatOptions: any[] = []
                  for (const [label, optionSet] of schemaMap.entries()) {
                    flatOptions.push({
                      code: slugifyText(label),
                      label: label,
                      inputType: 'select' as const,
                      choices: Array.from(optionSet).map((optName) => ({
                        label: optName,
                        code: slugifyText(optName),
                      })),
                    })
                  }
                  return flatOptions
                })(),
              },
            })
            em.persist(optionSchema)
            product.optionSchemaTemplate = optionSchema

            const paths = enumeratePaths(item.optionGroups || [], { optionValues: {}, totalPrice: item.price, names: [], durations: [] })
            let isFirst = true

            for (const path of paths) {
              const combinedName = path.names.join(' - ')
              createVariantForOption(
                em,
                product,
                defaultPriceKind!,
                tenantId,
                organizationId,
                `${category.label} ${item.name}`,
                path.optionValues,
                path.totalPrice,
                combinedName,
                isFirst,
                path.durations
              )
              variantCount++
              isFirst = false
            }
          } else {
            createVariantForOption(em, product, defaultPriceKind!, tenantId, organizationId, `${category.label} ${item.name}`, {}, item.price, 'Default', true, [])
            variantCount++
          }
        }
      }
    }

    logger.info('Flushing records to database...')
    await em.flush()

    logger.info(`Migration successful! Created ${productCount} Products and ${variantCount} Variants.`)
  }
}
