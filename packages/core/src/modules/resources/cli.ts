import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { seedResourcesActivityTypes, seedResourcesAddressTypes, seedResourcesCapacityUnits, seedResourcesResourceExamples, type ResourcesSeedScope } from './lib/seeds'
import { ResourcesResource, ResourcesResourceArea, ResourcesResourceAreaType } from './data/entities'
import { CustomFieldValue } from '../entities/data/entities'
import { E } from '#generated/entities.ids.generated'

function parseArgs(rest: string[]) {
  const args: Record<string, string> = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part) continue
    if (part.startsWith('--')) {
      const [rawKey, rawValue] = part.slice(2).split('=')
      if (rawValue !== undefined) args[rawKey] = rawValue
      else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) {
        args[rawKey] = rest[i + 1]!
        i += 1
      }
    }
  }
  return args
}

const seedCapacityUnitsCommand: ModuleCli = {
  command: 'seed-capacity-units',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato resources seed-capacity-units --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: ResourcesSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedResourcesCapacityUnits(tem, scope)
      })
      console.log('📏 Resources capacity units seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedActivityTypesCommand: ModuleCli = {
  command: 'seed-activity-types',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato resources seed-activity-types --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: ResourcesSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedResourcesActivityTypes(tem, scope)
      })
      console.log('🗂️  Resources activity types seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedAddressTypesCommand: ModuleCli = {
  command: 'seed-address-types',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato resources seed-address-types --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: ResourcesSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedResourcesAddressTypes(tem, scope)
      })
      console.log('🏠 Resources address types seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedExamplesCommand: ModuleCli = {
  command: 'seed-examples',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato resources seed-examples --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: ResourcesSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedResourcesResourceExamples(tem, scope)
      })
      console.log('🧩 Resources example resources seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

async function getOrCreateAreaType(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  areaTypeName: string,
): Promise<ResourcesResourceAreaType> {
  let existing = await em.findOne(ResourcesResourceAreaType, { tenantId, organizationId, name: areaTypeName, deletedAt: null })
  if (existing) return existing
  const created = em.create(ResourcesResourceAreaType, {
    tenantId,
    organizationId,
    name: areaTypeName,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  em.persist(created)
  return created
}

const migrateAreasCommand: ModuleCli = {
  command: 'migrate-areas',
  async run(_rest) {
    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      console.log('🚀 Starting Resource Areas migration...')
      await em.transactional(async (tem) => {
        const entityId = E.resources.resources_resource

        // Fetch all custom field values for room_zone and room_floor
        const zoneValues = await tem.find(CustomFieldValue, {
          entityId,
          fieldKey: 'room_zone',
          deletedAt: null,
        })
        const floorValues = await tem.find(CustomFieldValue, {
          entityId,
          fieldKey: 'room_floor',
          deletedAt: null,
        })

        if (zoneValues.length === 0 && floorValues.length === 0) {
          console.log('No legacy room_zone or room_floor custom fields found.')
          return
        }

        console.log(`Found ${zoneValues.length} zone fields and ${floorValues.length} floor fields.`)

        // Collect unique orgs to seed area types per org.
        // custom_field_values.organization_id / tenant_id are nullable but the
        // area tables are `uuid not null`, so an unscoped legacy row would reach
        // em.create() as the string "undefined" and abort the whole migration.
        const orgKeys = new Set<string>()
        let unscopedValues = 0
        for (const v of [...zoneValues, ...floorValues]) {
          if (!v.organizationId || !v.tenantId) {
            unscopedValues++
            continue
          }
          orgKeys.add(`${v.organizationId}:${v.tenantId}`)
        }
        if (unscopedValues > 0) {
          console.warn(`Skipping ${unscopedValues} legacy value(s) with no organization/tenant.`)
        }

        const zoneMap = new Map<string, ResourcesResourceArea>()
        const floorMap = new Map<string, ResourcesResourceArea>()

        // Seed Zone and Floor area types for each org, then process areas
        for (const orgKey of orgKeys) {
          const [organizationId, tenantId] = orgKey.split(':')
          const zoneType = await getOrCreateAreaType(tem, tenantId, organizationId, 'Zone')
          const floorType = await getOrCreateAreaType(tem, tenantId, organizationId, 'Floor')

          await tem.flush()

          // Only this organization's values: the loops used to walk every value
          // on every pass, so the first organization in the set created areas
          // for all the others and stamped them with ITS Zone/Floor area type —
          // a cross-organization reference, and one later passes skipped because
          // the key was already in the map.
          const belongsToOrg = (value: CustomFieldValue) =>
            value.organizationId === organizationId && value.tenantId === tenantId

          // Process zones
          for (const zv of zoneValues.filter(belongsToOrg)) {
            const zoneName = zv.valueText?.trim()
            if (!zoneName) continue
            const key = `${organizationId}:${tenantId}:${zoneName}`
            if (zoneMap.has(key)) continue

            let area = await tem.findOne(ResourcesResourceArea, {
              organizationId,
              tenantId,
              name: zoneName,
            })
            if (!area) {
              area = tem.create(ResourcesResourceArea, {
                organizationId,
                tenantId,
                name: zoneName,
                areaType: zoneType,
                isActive: true,
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              tem.persist(area)
            }
            zoneMap.set(key, area)
          }

          await tem.flush()

          // Process floors
          for (const fv of floorValues.filter(belongsToOrg)) {
            const floorName = fv.valueText?.trim()
            if (!floorName) continue
            const key = `${organizationId}:${tenantId}:${floorName}`
            if (floorMap.has(key)) continue

            const zv = zoneValues.find(z => z.recordId === fv.recordId)
            const zoneName = zv?.valueText?.trim() || ''
            const parentZone = zoneMap.get(`${organizationId}:${tenantId}:${zoneName}`)

            let area = await tem.findOne(ResourcesResourceArea, {
              organizationId,
              tenantId,
              name: floorName,
            })
            if (!area) {
              area = tem.create(ResourcesResourceArea, {
                organizationId,
                tenantId,
                name: floorName,
                areaType: floorType,
                parentAreaId: parentZone?.id ?? null,
                isActive: true,
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              tem.persist(area)
            }
            floorMap.set(key, area)
          }

          await tem.flush()
        }

        // Now link resources
        let linkedCount = 0
        const resourceIds = [...new Set([...zoneValues.map(z => z.recordId), ...floorValues.map(f => f.recordId)])]

        for (const resId of resourceIds) {
          const resource = await tem.findOne(ResourcesResource, { id: resId })
          if (!resource) continue

          const floorVal = floorValues.find(f => f.recordId === resId)?.valueText?.trim()
          const zoneVal = zoneValues.find(z => z.recordId === resId)?.valueText?.trim()

          let targetArea: ResourcesResourceArea | undefined
          if (floorVal) {
            targetArea = floorMap.get(`${resource.organizationId}:${resource.tenantId}:${floorVal}`)
          } else if (zoneVal) {
            targetArea = zoneMap.get(`${resource.organizationId}:${resource.tenantId}:${zoneVal}`)
          }

          if (targetArea) {
            resource.areaId = targetArea.id
            linkedCount++
          }
        }

        console.log(`✅ Successfully linked ${linkedCount} resources to areas.`)
      })
    } catch (err) {
      console.error('❌ Migration failed:', err)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const commands = [seedCapacityUnitsCommand, seedActivityTypesCommand, seedAddressTypesCommand, seedExamplesCommand, migrateAreasCommand]
export default commands
