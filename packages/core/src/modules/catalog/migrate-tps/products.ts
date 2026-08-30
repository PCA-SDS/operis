import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { SERVICE_MENU } from './data/serviceMenu'
import type { OptionGroup, Price } from './data/types'
import type { CatalogProductType } from '../data/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductVariant,
  CatalogProductPrice,
  CatalogPriceKind,
  CatalogProductOptionGroup,
  CatalogProductOption,
  CatalogProductConstraint,
} from '../data/entities'
import { randomUUID } from 'crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { parseTpsMigrateFlags } from './lib'
import {
  slugifyTpsText,
  parseTpsPrice,
  extractTpsDuration,
  parseTpsDurationForEntity,
} from './mapping'

const logger = createLogger('catalog')

function traverseOptionTree(
  em: EntityManager,
  groups: OptionGroup[],
  product: CatalogProduct,
  tenantId: string,
  organizationId: string,
  parentOption: CatalogProductOption | null = null,
  tpsOptionMap: Map<string, string> = new Map()
) {
  let sortOrderGroup = 0
  for (const group of groups) {
    const groupEntity = em.create(CatalogProductOptionGroup, {
      id: randomUUID(),
      tenantId,
      organizationId,
      product: product,
      parentOption: parentOption,
      name: group.label,
      requirement: group.requirement,
      selectMode: group.mode,
      sortOrder: sortOrderGroup++,
      isActive: true,
    })
    em.persist(groupEntity)

    let sortOrderOption = 0
    for (const opt of group.options) {
      const parsedPrice = parseTpsPrice(opt.price)
      const duration = extractTpsDuration(opt)
      const parsedDuration = parseTpsDurationForEntity(duration)
      
      const optionEntity = em.create(CatalogProductOption, {
        id: randomUUID(),
        tenantId,
        organizationId,
        group: groupEntity,
        name: opt.name,
        priceFlat: parsedPrice.unitPriceGross || undefined,
        priceMin: parsedPrice.priceMin || undefined,
        priceMax: parsedPrice.priceMax || undefined,
        durationUnit: parsedDuration.durationUnit,
        durationValue: parsedDuration.durationValue,
        durationMin: parsedDuration.durationMin,
        durationMax: parsedDuration.durationMax,
        note: opt.note,
        unit: opt.unit,
        sortOrder: sortOrderOption++,
        isActive: true,
        metadata: {
          ...(parsedPrice.metadata || {}),
          tps_id: opt.id,
        },
      })
      em.persist(optionEntity)
      tpsOptionMap.set(opt.id, optionEntity.id)

      if (opt.nextGroups && opt.nextGroups.length > 0) {
        traverseOptionTree(em, opt.nextGroups, product, tenantId, organizationId, optionEntity, tpsOptionMap)
      }
    }
  }
}

function createVariantForOption(em: EntityManager, product: CatalogProduct, defaultPriceKind: CatalogPriceKind, tenantId: string, organizationId: string, itemName: string, optionValuesMap: Record<string, string>, totalPrice: Price | undefined, variantSuffix: string, isDefault: boolean, extraDurations: string[]) {
  const parsedOptionValues: Record<string, string> = {}
  for (const [key, val] of Object.entries(optionValuesMap)) {
    parsedOptionValues[slugifyTpsText(key)] = slugifyTpsText(val)
  }

  const parsedPrice = parseTpsPrice(totalPrice)

  const variantMetadata: Record<string, unknown> = {}
  if (parsedPrice.metadata) {
    variantMetadata.originalPriceRange = parsedPrice.metadata
  }
  if (extraDurations.length > 0) {
    variantMetadata.extra_durations = extraDurations
  }

  const parsedDurations = parseTpsDurationForEntity(extraDurations[0]) // Simplification: just use the first duration found for the variant

  const variant = em.create(CatalogProductVariant, {
    id: randomUUID(),
    tenantId,
    organizationId,
    product: product,
    name: variantSuffix,
    sku: slugifyTpsText(`${itemName}-${variantSuffix}`),
    optionValues: parsedOptionValues,
    isActive: true,
    isDefault,
    durationUnit: parsedDurations.durationUnit,
    durationValue: parsedDurations.durationValue,
    durationMin: parsedDurations.durationMin,
    durationMax: parsedDurations.durationMax,
    metadata: Object.keys(variantMetadata).length > 0 ? variantMetadata : null,
  })
  em.persist(variant)

  if (parsedPrice.unitPriceGross || parsedPrice.priceMin || parsedPrice.priceMax) {
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
      unitPriceGross: parsedPrice.unitPriceGross || parsedPrice.priceMin, // Use priceMin as base display price if no flat price
      priceMin: parsedPrice.priceMin,
      priceMax: parsedPrice.priceMax,
      metadata: parsedPrice.metadata,
    })
    em.persist(priceEntity)
  }
}

export const migrateTpsProductsCommand: ModuleCli = {
  command: 'migrate-tps-products',
  async run(rest) {
    const { tenantId, organizationId, replace } = parseTpsMigrateFlags(rest)
    if (!tenantId || !organizationId) {
      logger.error('Missing tenantId or organizationId')
      logger.error('Usage: yarn mercato catalog migrate-tps-products <tenantId> <organizationId> [--replace]')
      throw new Error('Missing tenantId or organizationId')
    }

    const container = await (await import('@open-mercato/shared/lib/di/container')).createRequestContainer()
    try {
      const baseEm = container.resolve<EntityManager>('em').fork()

      logger.info(`Starting TPS Product migration for Tenant: ${tenantId}, Org: ${organizationId}`)

      const existingCount = await baseEm.count(CatalogProduct, { tenantId, organizationId })
      if (existingCount > 0) {
        if (!replace) {
          logger.error(`Found ${existingCount} existing products for organization ${organizationId}.`)
          logger.error('Aborting. Use --replace to overwrite existing data.')
          throw new Error(`Existing products already found for organization ${organizationId}`)
        }
        logger.info(`Found ${existingCount} existing products. --replace flag is set, proceeding with cleanup...`)
      }

      await baseEm.transactional(async (em) => {
        if (existingCount > 0) {
          logger.info('Cleaning up existing products for this organization...')
          await em.nativeDelete(CatalogProductPrice, { tenantId, organizationId })
          await em.nativeDelete(CatalogProductCategoryAssignment, { tenantId, organizationId })
          await em.nativeDelete(CatalogProductVariant, { tenantId, organizationId })
          await em.nativeDelete(CatalogProductConstraint, { tenantId, organizationId })
          await em.nativeDelete(CatalogProductOption, { tenantId, organizationId })
          await em.nativeDelete(CatalogProductOptionGroup, { tenantId, organizationId })
          await em.nativeDelete(CatalogProduct, { tenantId, organizationId })
          logger.info('Cleanup complete.')
        }

    let defaultPriceKind = await em.findOne(CatalogPriceKind, { tenantId, organizationId, code: 'default' })
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

    const categories = await em.find(CatalogProductCategory, { tenantId, organizationId, depth: 1 })
    const categoryMap = new Map<string, CatalogProductCategory>()
    categories.forEach((c) => {
      categoryMap.set(c.name, c)
    })

    let productCount = 0
    let variantCount = 0
    let constraintCount = 0

    const tpsProductMap = new Map<string, string>()
    const tpsOptionMap = new Map<string, string>()

    for (const rootCat of Object.values(SERVICE_MENU)) {
      for (const category of rootCat.categories) {
        for (const item of category.items) {
          // Any item with optionGroups is a service using the Option Tree — never a retail configurable.
          // (Retail configurable products like size/color variants are not part of the TPS service menu.)
          const hasOptionTree = (item.optionGroups?.length ?? 0) > 0

          // NOTE: The flattening path (configurable → virtual/bundle → variant explosion)
          // is intentionally not used. All TPS products migrate as 'service' type with
          // Option Tree for modifiers and exactly one Default variant. Variants represent
          // the base service, not combinatorial SKU explosion — per the option-tree design
          // where modifiers are modeled as option groups/options, not retail variants.
          const finalProductType: CatalogProductType = 'service'

          const productMetadata: Record<string, unknown> = {
            tps_id: item.id,
            tps_type: category.type || 'unknown',
          }
          const itemDuration = extractTpsDuration(item)
          
          const parsedProductPrice = parseTpsPrice(item.price)

          const product = em.create(CatalogProduct, {
            id: randomUUID(),
            tenantId,
            organizationId,
            title: item.name,
            description: item.description || '',
            sku: item.id || slugifyTpsText(`${category.label} ${item.name}`),
            handle: slugifyTpsText(`${category.label} ${item.name}`),
            productType: finalProductType,
            isConfigurable: false, // Option Tree items are never retail-configurable
            isActive: true,
            metadata: productMetadata,
          })
          em.persist(product)
          if (item.id) {
            tpsProductMap.set(item.id, product.id)
          }
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

          // Service (uses Option Tree + 1 Default Variant)
          createVariantForOption(em, product, defaultPriceKind!, tenantId, organizationId, `${category.label} ${item.name}`, {}, item.price, 'Default', true, itemDuration ? [itemDuration] : [])
          variantCount++
          
          if (hasOptionTree && item.optionGroups) {
            traverseOptionTree(em, item.optionGroups, product, tenantId, organizationId, null, tpsOptionMap)
          }
        }
      }
    }

    // Pass 2: Constraints
    for (const rootCat of Object.values(SERVICE_MENU)) {
      for (const category of rootCat.categories) {
        for (const item of category.items) {
          const sourceProductId = item.id ? tpsProductMap.get(item.id) : undefined
          
          if (sourceProductId && item.mutuallyExclusiveItems) {
            for (const targetTpsId of item.mutuallyExclusiveItems) {
              const targetProductId = tpsProductMap.get(targetTpsId)
              if (targetProductId) {
                em.persist(em.create(CatalogProductConstraint, {
                  id: randomUUID(),
                  tenantId,
                  organizationId,
                  constraintType: 'mutually_exclusive_item',
                  sourceProduct: em.getReference(CatalogProduct, sourceProductId),
                  targetProduct: em.getReference(CatalogProduct, targetProductId),
                  locked: false,
                }))
                constraintCount++
              }
            }
          }

          if (sourceProductId && item.include) {
            const targetProductId = tpsProductMap.get(item.include.itemId)
            if (targetProductId) {
              em.persist(em.create(CatalogProductConstraint, {
                id: randomUUID(),
                tenantId,
                organizationId,
                constraintType: 'includes_item',
                sourceProduct: em.getReference(CatalogProduct, sourceProductId),
                targetProduct: em.getReference(CatalogProduct, targetProductId),
                locked: item.include.locked ?? false,
              }))
              constraintCount++
            }
          }

          if (item.optionGroups) {
            const queue = [...item.optionGroups]
            while (queue.length > 0) {
              const group = queue.shift()!
              for (const opt of group.options) {
                const sourceOptionId = tpsOptionMap.get(opt.id)
                if (sourceOptionId && opt.conflictsWithItems) {
                  for (const targetTpsId of opt.conflictsWithItems) {
                    const targetProductId = tpsProductMap.get(targetTpsId)
                    if (targetProductId) {
                      em.persist(em.create(CatalogProductConstraint, {
                        id: randomUUID(),
                        tenantId,
                        organizationId,
                        constraintType: 'conflicts_with_item',
                        sourceOption: em.getReference(CatalogProductOption, sourceOptionId),
                        targetProduct: em.getReference(CatalogProduct, targetProductId),
                        locked: false,
                      }))
                      constraintCount++
                    }
                  }
                }
                
                if (sourceOptionId && opt.mutuallyExclusive) {
                  for (const targetTpsId of opt.mutuallyExclusive) {
                    const targetOptionId = tpsOptionMap.get(targetTpsId)
                    if (targetOptionId) {
                      em.persist(em.create(CatalogProductConstraint, {
                        id: randomUUID(),
                        tenantId,
                        organizationId,
                        constraintType: 'mutually_exclusive_item',
                        sourceOption: em.getReference(CatalogProductOption, sourceOptionId),
                        targetOption: em.getReference(CatalogProductOption, targetOptionId),
                        locked: false,
                      }))
                      constraintCount++
                    }
                  }
                }

                if (opt.nextGroups) {
                  queue.push(...opt.nextGroups)
                }
              }
            }
          }
        }
      }
    }

    logger.info('Flushing records to database...')
    await em.flush()

    logger.info(`Migration successful! Created ${productCount} Products, ${variantCount} Variants, and ${constraintCount} Constraints.`)
      })
    } catch (err) {
      logger.error('An error occurred during Product migration', { err })
      throw err instanceof Error ? err : new Error('Product migration failed')
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  }
}
