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
  CatalogProductOptionGroup,
  CatalogProductOption,
} from '../data/entities'
import { randomUUID } from 'crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { parseTpsMigrateFlags } from './lib'
import {
  slugifyTpsText,
  sumTpsPrices,
  parseTpsPrice,
  extractTpsDuration,
  hasNestedTpsOptionTree,
  collectTpsSchemaGroups,
  enumerateTpsOptionPaths,
  type OptionPath,
} from './mapping'

const logger = createLogger('catalog')

function traverseOptionTree(
  em: EntityManager,
  groups: any[],
  product: CatalogProduct,
  tenantId: string,
  organizationId: string,
  parentOption: CatalogProductOption | null = null
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
      requirement: group.selection === 'single' ? 'required' : 'optional', // Guess based on common patterns
      selectMode: group.selection === 'multiple' ? 'multiple' : 'single',
      sortOrder: sortOrderGroup++,
      isActive: true,
    })
    em.persist(groupEntity)

    let sortOrderOption = 0
    for (const opt of group.options) {
      const parsedPrice = parseTpsPrice(opt.price)
      const duration = extractTpsDuration(opt)
      
      const optionEntity = em.create(CatalogProductOption, {
        id: randomUUID(),
        tenantId,
        organizationId,
        group: groupEntity,
        name: opt.name,
        priceFlat: parsedPrice.unitPriceGross || undefined,
        durationUnit: duration ? 'minute' : undefined, // Simplify duration parsing
        durationValue: duration ? parseInt(duration) : undefined,
        sortOrder: sortOrderOption++,
        isActive: true,
        metadata: parsedPrice.metadata,
      })
      em.persist(optionEntity)

      if (opt.nextGroups && opt.nextGroups.length > 0) {
        traverseOptionTree(em, opt.nextGroups, product, tenantId, organizationId, optionEntity)
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
    sku: slugifyTpsText(`${itemName}-${variantSuffix}`),
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
    const { tenantId, organizationId, replace } = parseTpsMigrateFlags(rest)
    if (!tenantId || !organizationId) {
      logger.error('Missing tenantId or organizationId')
      logger.error('Usage: yarn mercato catalog migrate-tps-products <tenantId> <organizationId> [--replace]')
      return
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
          return
        }
        logger.info(`Found ${existingCount} existing products. --replace flag is set, proceeding with cleanup...`)
      }

      await baseEm.transactional(async (em) => {
        if (existingCount > 0) {
          logger.info('Cleaning up existing products for this organization...')
          await em.nativeDelete(CatalogProductPrice, { tenantId, organizationId })
          await em.nativeDelete(CatalogProductCategoryAssignment, { tenantId, organizationId })
          await em.nativeDelete(CatalogProductVariant, { tenantId, organizationId })
          await em.nativeDelete(CatalogProductOption, { tenantId, organizationId })
          await em.nativeDelete(CatalogProductOptionGroup, { tenantId, organizationId })
          await em.nativeDelete(CatalogOptionSchemaTemplate, { tenantId, organizationId })
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
          // Any item with optionGroups is a service using the Option Tree — never a retail configurable.
          // (Retail configurable products like size/color variants are not part of the TPS service menu.)
          const isConfigurable = (item.optionGroups?.length ?? 0) > 0

          let mappedType: CatalogProductType = 'simple'
          if (category.type === 'service') mappedType = 'virtual'
          else if (category.type === 'package') mappedType = 'bundle'
          else if (isConfigurable) mappedType = 'virtual' // All option-tree items are services

          const isServiceOrBundle = mappedType === 'virtual' || mappedType === 'bundle'
          const finalProductType: CatalogProductType = isServiceOrBundle ? mappedType : 'simple'

          const productMetadata: Record<string, any> = {
            tps_id: item.id,
            tps_type: category.type || 'unknown',
          }
          const itemDuration = extractTpsDuration(item)
          if (itemDuration) {
            productMetadata.duration = itemDuration
          }
          
          const parsedProductPrice = parseTpsPrice(item.price)
          if (parsedProductPrice.metadata) {
            productMetadata.price_rules = parsedProductPrice.metadata
          }

          const product = em.create(CatalogProduct, {
            id: randomUUID(),
            tenantId,
            organizationId,
            title: item.name,
            description: item.description || '',
            sku: slugifyTpsText(`${category.label} ${item.name}`),
            handle: slugifyTpsText(`${category.label} ${item.name}`),
            productType: finalProductType,
            isConfigurable: false, // Option Tree items are never retail-configurable
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

          if (isConfigurable && !isServiceOrBundle && item.optionGroups) {
            // Retail configurable product (uses Variants)
            const optionSchema = em.create(CatalogOptionSchemaTemplate, {
              id: randomUUID(),
              tenantId,
              organizationId,
              name: `${category.label} - ${item.name} Options`,
              code: slugifyTpsText(`${category.label} ${item.name} Options`),
              isActive: true,
              schema: {
                options: (() => {
                  const schemaMap = new Map<string, Set<string>>()
                  collectTpsSchemaGroups(item.optionGroups || [], schemaMap)
                  const flatOptions: any[] = []
                  for (const [label, optionSet] of schemaMap.entries()) {
                    flatOptions.push({
                      code: slugifyTpsText(label),
                      label: label,
                      inputType: 'select' as const,
                      choices: Array.from(optionSet).map((optName) => ({
                        label: optName,
                        code: slugifyTpsText(optName),
                      })),
                    })
                  }
                  return flatOptions
                })(),
              },
            })
            em.persist(optionSchema)
            product.optionSchemaTemplate = optionSchema

            const paths = enumerateTpsOptionPaths(item.optionGroups || [], { optionValues: {}, totalPrice: item.price, names: [], durations: [] })
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
          } else if (isServiceOrBundle) {
            // Service or Package (uses Option Tree + 1 Default Variant)
            createVariantForOption(em, product, defaultPriceKind!, tenantId, organizationId, `${category.label} ${item.name}`, {}, item.price, 'Default', true, [])
            variantCount++
            
            if (isConfigurable && item.optionGroups) {
              traverseOptionTree(em, item.optionGroups, product, tenantId, organizationId)
            }
          } else {
            // Simple product (uses 1 Default Variant)
            createVariantForOption(em, product, defaultPriceKind!, tenantId, organizationId, `${category.label} ${item.name}`, {}, item.price, 'Default', true, [])
            variantCount++
          }
        }
      }
    }

    logger.info('Flushing records to database...')
    await em.flush()

    logger.info(`Migration successful! Created ${productCount} Products and ${variantCount} Variants.`)
      })
    } catch (err) {
      logger.error('An error occurred during Product migration', { err })
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  }
}
