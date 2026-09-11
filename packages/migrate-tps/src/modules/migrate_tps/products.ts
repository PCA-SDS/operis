import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { SERVICE_MENU } from './data/serviceMenu'
import type { OptionGroup, Price } from './data/types'
import type { CatalogProductType } from '@open-mercato/core/modules/catalog/data/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { DefaultDataEngine } from '@open-mercato/shared/lib/data/engine'
import { cf, defineFields } from '@open-mercato/shared/modules/dsl'
import { CustomFieldEntityConfig } from '@open-mercato/core/modules/entities/data/entities'
import { ensureCustomFieldDefinitions } from '@open-mercato/core/modules/entities/lib/field-definitions'
import {
  normalizeEntityFieldsetConfig,
  type CustomFieldsetDefinition,
} from '@open-mercato/core/modules/entities/lib/fieldsets'
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
} from '@open-mercato/core/modules/catalog/data/entities'
import { EntityTranslation } from '@open-mercato/core/modules/translations/data/entities'
import { randomUUID } from 'crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { parseTpsMigrateFlags } from './lib'
import {
  slugifyTpsText,
  parseTpsPrice,
  extractTpsDuration,
  parseTpsDurationForEntity,
  buildTranslationsPayload,
} from './mapping'
import {
  buildServiceMenuImportPlan,
  buildServiceMenuOptionKey,
  CATALOG_PRODUCT_ENTITY_ID,
  CATALOG_PRODUCT_VARIANT_ENTITY_ID,
  SERVICE_DURATION_FIELD,
  SERVICE_SCHEDULE_FIELDSET,
  type ServiceMenuConstraintEndpoint,
} from './serviceMenuImportPlan'

const logger = createLogger('migrate_tps')

const SERVICE_UNIT = 'service'

type CatalogIdRegistry = {
  productsBySourceId: Map<string, string>
  optionsBySourceKey: Map<string, string>
}

const PRODUCT_SERVICE_FIELDSET: CustomFieldsetDefinition = {
  code: SERVICE_SCHEDULE_FIELDSET,
  label: 'Services - Scheduling',
  icon: 'solar:calendar-linear',
  description: 'Scheduling, preparation, and delivery metadata for service offerings.',
  groups: [
    { code: 'identity', title: 'Identity' },
    { code: 'timing', title: 'Timing rules' },
    { code: 'resources', title: 'Resources & Delivery' },
  ],
}

const VARIANT_SERVICE_FIELDSET: CustomFieldsetDefinition = {
  code: SERVICE_SCHEDULE_FIELDSET,
  label: 'Services - Scheduling',
  icon: 'solar:calendar-linear',
  description: 'Provider, duration, and environment metadata for service slots.',
  groups: [
    { code: 'provider', title: 'Provider' },
    { code: 'environment', title: 'Environment' },
  ],
}

function traverseOptionTree(
  em: EntityManager,
  groups: OptionGroup[],
  product: CatalogProduct,
  tenantId: string,
  organizationId: string,
  productSourceId: string,
  optionPath: string[] = [],
  parentOption: CatalogProductOption | null = null,
  catalogIdRegistry: CatalogIdRegistry,
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

    const groupTranslations = buildTranslationsPayload({ name: group.labelKey })
    if (Object.keys(groupTranslations).length > 0) {
      em.persist(em.create(EntityTranslation, {
        id: randomUUID(),
        entityType: 'catalog:catalog_product_option_group',
        entityId: groupEntity.id,
        tenantId,
        organizationId,
        translations: groupTranslations,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    }

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
        code: opt.id,
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
          tps_product_id: productSourceId,
          tps_path: buildServiceMenuOptionKey(productSourceId, [...optionPath, group.id, opt.id]),
        },
      })
      em.persist(optionEntity)

      const optionTranslations = buildTranslationsPayload({ name: opt.nameKey, description: opt.descriptionKey, note: opt.noteKey, unit: opt.unitKey })
      if (Object.keys(optionTranslations).length > 0) {
        em.persist(em.create(EntityTranslation, {
          id: randomUUID(),
          entityType: 'catalog:catalog_product_option',
          entityId: optionEntity.id,
          tenantId,
          organizationId,
          translations: optionTranslations,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      }

      const nextOptionPath = [...optionPath, group.id, opt.id]
      catalogIdRegistry.optionsBySourceKey.set(buildServiceMenuOptionKey(productSourceId, nextOptionPath), optionEntity.id)

      if (opt.nextGroups && opt.nextGroups.length > 0) {
        traverseOptionTree(
          em,
          opt.nextGroups,
          product,
          tenantId,
          organizationId,
          productSourceId,
          nextOptionPath,
          optionEntity,
          catalogIdRegistry,
        )
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
    customFieldsetCode: SERVICE_SCHEDULE_FIELDSET,
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

function resolveCatalogEndpoint(
  endpoint: ServiceMenuConstraintEndpoint,
  catalogIdRegistry: CatalogIdRegistry,
): { productId?: string; optionId?: string } {
  if (endpoint.kind === 'product') {
    const productId = catalogIdRegistry.productsBySourceId.get(endpoint.productId)
    if (!productId) throw new Error(`[internal] migrate_tps: missing catalog product for source ${endpoint.productId}`)
    return { productId }
  }

  const optionId = catalogIdRegistry.optionsBySourceKey.get(endpoint.optionKey)
  if (!optionId) throw new Error(`[internal] migrate_tps: missing catalog option for source ${endpoint.optionKey}`)
  return { optionId }
}

async function ensureServiceScheduleCustomFields(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
): Promise<void> {
  await ensureServiceScheduleFieldsetConfig(
    em,
    tenantId,
    organizationId,
    CATALOG_PRODUCT_ENTITY_ID,
    PRODUCT_SERVICE_FIELDSET,
  )
  await ensureServiceScheduleFieldsetConfig(
    em,
    tenantId,
    organizationId,
    CATALOG_PRODUCT_VARIANT_ENTITY_ID,
    VARIANT_SERVICE_FIELDSET,
  )
  await ensureCustomFieldDefinitions(
    em,
    [
      defineFields(CATALOG_PRODUCT_ENTITY_ID, [
        cf.integer(SERVICE_DURATION_FIELD, {
          label: 'Duration (minutes)',
          description: 'Length of a single service slot.',
          fieldset: SERVICE_SCHEDULE_FIELDSET,
          group: { code: 'timing' },
          filterable: true,
        }),
      ], 'migrate_tps'),
    ],
    { tenantId, organizationId, createOnly: true },
  )
}

async function ensureServiceScheduleFieldsetConfig(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  entityId: string,
  fieldset: CustomFieldsetDefinition,
): Promise<void> {
  const now = new Date()
  let config = await em.findOne(CustomFieldEntityConfig, {
    entityId,
    tenantId,
    organizationId,
  })
  if (!config) {
    config = em.create(CustomFieldEntityConfig, {
      id: randomUUID(),
      entityId,
      tenantId,
      organizationId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
  }

  const currentConfig = normalizeEntityFieldsetConfig(config.configJson ?? {})
  const nextFieldsets = [
    ...currentConfig.fieldsets.filter((entry) => entry.code !== fieldset.code),
    fieldset,
  ]
  config.configJson = {
    fieldsets: nextFieldsets,
    singleFieldsetPerRecord: currentConfig.singleFieldsetPerRecord,
  }
  config.isActive = true
  config.updatedAt = now
  config.deletedAt = null
  em.persist(config)
}

export const migrateTpsProductsCommand: ModuleCli = {
  command: 'products',
  async run(rest) {
    const { tenantId, organizationId, replace } = parseTpsMigrateFlags(rest)
    if (!tenantId || !organizationId) {
      logger.error('Missing tenantId or organizationId')
      logger.error('Usage: yarn mercato migrate_tps products <tenantId> <organizationId> [--replace]')
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

          // See categories.ts: the translations module cleans up per record from
          // `query_index.delete_one`, which this migration does not emit, and a
          // raw `getConnection().execute()` would run outside the transaction
          // the surrounding `nativeDelete` calls take part in.
          await em.nativeDelete(EntityTranslation, {
            tenantId,
            organizationId,
            entityType: {
              $in: [
                'catalog:catalog_product',
                'catalog:catalog_product_option_group',
                'catalog:catalog_product_option',
              ],
            },
          })

          await em.nativeDelete(CatalogProductPrice, { tenantId, organizationId })
          await em.nativeDelete(CatalogProductCategoryAssignment, { tenantId, organizationId })
          await em.nativeDelete(CatalogProductVariant, { tenantId, organizationId })
          await em.nativeDelete(CatalogProductConstraint, { tenantId, organizationId })
          await em.nativeDelete(CatalogProductOption, { tenantId, organizationId })
          await em.nativeDelete(CatalogProductOptionGroup, { tenantId, organizationId })
          await em.nativeDelete(CatalogProduct, { tenantId, organizationId })
          logger.info('Cleanup complete.')
        }

    const importPlan = buildServiceMenuImportPlan(SERVICE_MENU)
    await ensureServiceScheduleCustomFields(em, tenantId, organizationId)

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
    const customFieldAssignments: Array<() => Promise<void>> = []
    const dataEngine = new DefaultDataEngine(em, container)

    const catalogIdRegistry: CatalogIdRegistry = {
      productsBySourceId: new Map<string, string>(),
      optionsBySourceKey: new Map<string, string>(),
    }

    for (const rootCat of Object.values(SERVICE_MENU)) {
      for (const category of rootCat.categories) {
        for (const item of category.items) {
          const productPlan = importPlan.productById.get(item.id)
          if (!productPlan) {
            throw new Error(`[internal] migrate_tps: missing import plan for product ${item.id}`)
          }
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
            tps_type: productPlan.categoryType,
            tps_tab_id: productPlan.tabId,
            tps_category_id: productPlan.categoryId,
            tps_category_label: productPlan.categoryLabel,
          }
          if (productPlan.duration) productMetadata.tps_duration = productPlan.duration
          if (productPlan.durationRange) productMetadata.tps_duration_range = productPlan.durationRange
          
          const product = em.create(CatalogProduct, {
            id: randomUUID(),
            tenantId,
            organizationId,
            title: item.name,
            description: item.description || '',
            sku: productPlan.sku,
            handle: productPlan.handle,
            productType: finalProductType,
            primaryCurrencyCode: 'VND',
            defaultUnit: SERVICE_UNIT,
            defaultSalesUnit: SERVICE_UNIT,
            requiresShipping: false,
            customFieldsetCode: SERVICE_SCHEDULE_FIELDSET,
            isConfigurable: false, // Option Tree items are never retail-configurable
            isActive: true,
            metadata: productMetadata,
          })
          em.persist(product)

          const productTranslations = buildTranslationsPayload({ title: item.nameKey, description: item.descriptionKey })
          if (Object.keys(productTranslations).length > 0) {
            em.persist(em.create(EntityTranslation, {
              id: randomUUID(),
              entityType: 'catalog:catalog_product',
              entityId: product.id,
              tenantId,
              organizationId,
              translations: productTranslations,
              createdAt: new Date(),
              updatedAt: new Date(),
            }))
          }

          if (item.id) {
            catalogIdRegistry.productsBySourceId.set(item.id, product.id)
          }
          productCount++

          if (productPlan.durationSummaryMinutes !== undefined) {
            customFieldAssignments.push(() => dataEngine.setCustomFields({
              entityId: CATALOG_PRODUCT_ENTITY_ID,
              recordId: product.id,
              organizationId,
              tenantId,
              values: { [SERVICE_DURATION_FIELD]: productPlan.durationSummaryMinutes },
              notify: false,
            }))
          }

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
          createVariantForOption(em, product, defaultPriceKind!, tenantId, organizationId, `${category.label} ${item.name}`, {}, item.price, 'Default', true, productPlan.duration ? [productPlan.duration] : [])
          variantCount++
          
          if (hasOptionTree && item.optionGroups) {
            traverseOptionTree(
              em,
              item.optionGroups,
              product,
              tenantId,
              organizationId,
              item.id,
              [],
              null,
              catalogIdRegistry,
            )
          }
        }
      }
    }

    // Pass 2: Constraints
    for (const constraint of importPlan.constraints) {
      const source = resolveCatalogEndpoint(constraint.source, catalogIdRegistry)
      const target = resolveCatalogEndpoint(constraint.target, catalogIdRegistry)
      em.persist(em.create(CatalogProductConstraint, {
        id: randomUUID(),
        tenantId,
        organizationId,
        constraintType: constraint.constraintType,
        sourceProduct: source.productId ? em.getReference(CatalogProduct, source.productId) : null,
        sourceOption: source.optionId ? em.getReference(CatalogProductOption, source.optionId) : null,
        targetProduct: target.productId ? em.getReference(CatalogProduct, target.productId) : null,
        targetOption: target.optionId ? em.getReference(CatalogProductOption, target.optionId) : null,
        locked: constraint.locked,
      }))
      constraintCount++
    }

    logger.info('Flushing records to database...')
    await em.flush()

    for (const assign of customFieldAssignments) {
      try {
        await assign()
      } catch (err) {
        logger.warn('Failed to set TPS service custom field summary', { err })
      }
    }

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
