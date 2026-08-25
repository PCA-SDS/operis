import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { SERVICE_MENU } from './data/serviceMenu'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProductCategory } from '../data/entities'
import { rebuildCategoryHierarchyForOrganization } from '../lib/categoryHierarchy'
import { randomUUID } from 'crypto'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('catalog')

export const migrateTpsCategoriesCommand: ModuleCli = {
  command: 'migrate-tps-categories',
  async run(rest) {
    const [tenantId, organizationId] = rest
    if (!tenantId || !organizationId) {
      logger.error('Missing tenantId or organizationId')
      logger.error('Usage: yarn mercato catalog migrate-tps-categories <tenantId> <organizationId>')
      return
    }

    const { resolve } = await (await import('@open-mercato/shared/lib/di/container')).createRequestContainer()
    const em = resolve<EntityManager>('em').fork()
    
    logger.info(`Starting TPS Category migration for Tenant: ${tenantId}, Org: ${organizationId}`)

    logger.info('Cleaning up existing categories for this tenant...')
    await em.getConnection().execute(
      'DELETE FROM catalog_product_categories WHERE tenant_id = ? AND organization_id = ?',
      [tenantId, organizationId]
    )
    logger.info('Cleanup complete.')


    const slugCounts = new Set<string>()
    function generateUniqueSlug(text: string): string {
      const baseSlug = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '')

      let attempt = baseSlug
      let count = 1
      while (slugCounts.has(attempt)) {
        attempt = `${baseSlug}-${count}`
        count++
      }
      slugCounts.add(attempt)
      return attempt
    }

    let addedCategories = 0
    let addedSubcategories = 0
    const now = new Date()
    
    try {
      for (const [tabKey, tab] of Object.entries(SERVICE_MENU)) {
        // Create Parent Category (Tab)
        const parentId = randomUUID()
        const parentCat = em.create(CatalogProductCategory, {
          id: parentId,
          tenantId,
          organizationId,
          name: tab.label,
          slug: generateUniqueSlug(tab.label),
          depth: 0,
          ancestorIds: [],
          childIds: [],
          descendantIds: [],
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        em.persist(parentCat)
        addedCategories++

        if (tab.categories && tab.categories.length > 0) {
          for (const childCat of tab.categories) {
            // Create Child Category
            const childId = randomUUID()
            const childEntity = em.create(CatalogProductCategory, {
              id: childId,
              tenantId,
              organizationId,
              name: childCat.label,
              slug: generateUniqueSlug(childCat.label),
              description: childCat.note || null,
              parentId: parentId,
              depth: 0,
              ancestorIds: [],
              childIds: [],
              descendantIds: [],
              isActive: true,
              metadata: {
                type: childCat.type,
                requirement: childCat.requirement,
                mode: childCat.mode,
                legacyId: childCat.id,
                itemsCount: childCat.items?.length || 0,
              },
              createdAt: now,
              updatedAt: now,
            })
            em.persist(childEntity)
            addedSubcategories++
          }
        }
      }

      logger.info('Flushing records to database...')
      await em.flush()

      logger.info('Rebuilding category hierarchy tree...')
      await rebuildCategoryHierarchyForOrganization(em, organizationId, tenantId)
      
      logger.info(`Migration successful! Created ${addedCategories} Root Categories and ${addedSubcategories} Subcategories.`)
    } catch (err) {
      logger.error('An error occurred during Category migration', { err })
    }
  },
}
