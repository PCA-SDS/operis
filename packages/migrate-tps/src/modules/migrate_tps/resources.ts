import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { EntityManager } from '@mikro-orm/postgresql'
import * as pg from 'pg'
import { randomUUID } from 'crypto'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { parseTpsMigrateFlags } from './lib'
import {
  ResourcesResource,
  ResourcesResourceArea,
  ResourcesResourceType,
} from '@open-mercato/core/modules/resources/data/entities'

type Client = InstanceType<typeof pg.Client>

const logger = createLogger('migrate_tps')

// ---------------------------------------------------------------------------
// TPS Source types
// ---------------------------------------------------------------------------

interface TpsFloor {
  id: string
  location: string
  name: string
  sort_order: number
  is_active: boolean
  deleted_at: string | null
}

interface TpsSeatTypeConfig {
  id: string
  code: string
  name: string
  color_hex: string | null
  icon: string | null
  is_active: boolean
  deleted_at: string | null
}

interface TpsSeat {
  id: string
  floor_id: string
  seat_type_id: string
  code: string
  name: string | null
  sort_order: number
  status: string | null
  is_active: boolean
  deleted_at: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function connectTps(url: string): Promise<Client> {
  const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1')
  const client = new pg.Client({
    connectionString: url,
    ssl: isLocalhost ? false : { rejectUnauthorized: false },
  })
  await client.connect()
  return client
}

// ---------------------------------------------------------------------------
// Parse --location flag from CLI args
// ---------------------------------------------------------------------------

function parseLocationFlag(rest: string[]): string | null {
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--location' && rest[i + 1]) {
      return rest[i + 1]
    }
  }
  return null
}

const seatSortOrderExpression = `
  (
    row_number() over (
      partition by s.floor_id
      order by
        regexp_replace(s.code, '\\d+', '', 'g'),
        nullif(regexp_replace(s.code, '\\D', '', 'g'), '')::int nulls last,
        s.code,
        coalesce(s.name, ''),
        s.created_at,
        s.id
    ) - 1
  )::int as sort_order
`

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export const migrateTpsResourcesCommand: ModuleCli = {
  command: 'resources',
  async run(rest) {
    const { tenantId, organizationId, replace } = parseTpsMigrateFlags(rest)
    const locationFilter = parseLocationFlag(rest)

    if (!tenantId || !organizationId) {
      logger.error('Missing tenantId or organizationId')
      logger.error('Usage: yarn mercato migrate_tps resources <tenantId> <organizationId> [--location <benThanh|thaoDien|phuMyHung|hoanKiem>] [--replace]')
      throw new Error('Missing tenantId or organizationId')
    }

    const tpsDbUrl = process.env.TPS_DATABASE_URL
    if (!tpsDbUrl) {
      logger.error('Missing TPS_DATABASE_URL environment variable')
      throw new Error('TPS_DATABASE_URL not set')
    }

    const locationLabel = locationFilter
      ? `location="${locationFilter}"`
      : 'all locations'
    logger.info(`Starting TPS Resources migration for Tenant: ${tenantId}, Org: ${organizationId}, ${locationLabel}`)

    const container = await createRequestContainer()
    let tpsClient: Client | null = null

    try {
      tpsClient = await connectTps(tpsDbUrl)

      // ---------------------------------------------------------------------------
      // 1. Fetch source data from TPS
      // ---------------------------------------------------------------------------

      const [tpsSeatTypes, tpsFloors, tpsSeats] = await Promise.all([
        tpsClient.query(
          'SELECT * FROM seat_type_configs WHERE deleted_at IS NULL',
        ) as Promise<{ rows: TpsSeatTypeConfig[]; rowCount: number }>,
        tpsClient.query(
          locationFilter
            ? 'SELECT * FROM floors WHERE deleted_at IS NULL AND location = $1'
            : 'SELECT * FROM floors WHERE deleted_at IS NULL',
          locationFilter ? [locationFilter] : [],
        ) as Promise<{ rows: TpsFloor[]; rowCount: number }>,
        tpsClient.query(
          locationFilter
            ? `SELECT s.*, ${seatSortOrderExpression} FROM seats s JOIN floors f ON f.id = s.floor_id
               WHERE s.deleted_at IS NULL AND f.deleted_at IS NULL AND f.location = $1`
            : `SELECT s.*, ${seatSortOrderExpression} FROM seats s WHERE s.deleted_at IS NULL`,
          locationFilter ? [locationFilter] : [],
        ) as Promise<{ rows: TpsSeat[]; rowCount: number }>,
      ])

      logger.info(`Found ${tpsSeatTypes.rowCount} seat type configs, ${tpsFloors.rowCount} floors, ${tpsSeats.rowCount} seats`)

      if (tpsSeatTypes.rowCount === 0 && tpsFloors.rowCount === 0 && tpsSeats.rowCount === 0) {
        logger.warn('No TPS data found. Nothing to migrate.')
        return
      }

      const baseEm = container.resolve<EntityManager>('em').fork()

      // Check existing data
      const [existingTypes, existingAreas, existingResources] = await Promise.all([
        baseEm.count(ResourcesResourceType, { tenantId, organizationId }),
        baseEm.count(ResourcesResourceArea, { tenantId, organizationId }),
        baseEm.count(ResourcesResource, { tenantId, organizationId }),
      ])

      if (!replace && (existingTypes > 0 || existingAreas > 0 || existingResources > 0)) {
        logger.error(`Found existing data: ${existingTypes} types, ${existingAreas} areas, ${existingResources} resources.`)
        logger.error('Use --replace to overwrite existing data.')
        throw new Error('Existing resource data found. Use --replace to overwrite.')
      }

      // ---------------------------------------------------------------------------
      // 3. Migrate: SeatTypeConfig → ResourcesResourceType (preserve UUID)
      // ---------------------------------------------------------------------------

      const now = new Date()

      await baseEm.transactional(async (em) => {
        // Cleanup existing data if replace
        if (replace && (existingTypes > 0 || existingAreas > 0 || existingResources > 0)) {
          logger.info('Cleaning up existing resources data...')
          await em.nativeDelete(ResourcesResource, { tenantId, organizationId })
          await em.nativeDelete(ResourcesResourceArea, { tenantId, organizationId })
          await em.nativeDelete(ResourcesResourceType, { tenantId, organizationId })
          logger.info('Cleanup complete.')
        }

        logger.info(`Migrating ${tpsSeatTypes.rowCount} seat type configs...`)
        const tpsTypeIdMap: Record<string, string> = {}
        for (const tpsType of tpsSeatTypes.rows) {
          // Generate new UUID — TPS type IDs are shared across all locations
          const newTypeId = randomUUID()
          const entity = em.create(ResourcesResourceType, {
            id: newTypeId,
            tenantId,
            organizationId,
            name: tpsType.name,
            createdAt: now,
            updatedAt: now,
          })
          entity.description = null
          entity.appearanceColor = tpsType.color_hex || null
          entity.appearanceIcon = tpsType.icon || 'Box'
          em.persist(entity)
          tpsTypeIdMap[tpsType.id] = newTypeId
          logger.info(`  ✓ SeatType "${tpsType.code}" → ResourceType`)
        }
        await em.flush()
        logger.info(`Migrated ${tpsSeatTypes.rowCount} resource types.`)

        // ---------------------------------------------------------------------------
        // 4. Migrate: Floor → ResourcesResourceArea (preserve UUID, type=FLOOR)
        // ---------------------------------------------------------------------------

        const floorMap: Record<string, string> = {}
        logger.info(`Migrating ${tpsFloors.rowCount} floors...`)
        for (const floor of tpsFloors.rows) {
          // Generate new UUID — TPS floor IDs are shared across locations (same floor name = same ID across branches)
          const newAreaId = randomUUID()
          const entity = em.create(ResourcesResourceArea, {
            id: newAreaId,
            tenantId,
            organizationId,
            name: floor.name,
            areaType: 'floor',
            sortOrder: floor.sort_order ?? 0,
            isActive: floor.is_active,
            createdAt: now,
            updatedAt: now,
          })

          entity.name = floor.name
          entity.description = null
          entity.areaType = 'floor'
          entity.parentAreaId = null
          entity.sortOrder = floor.sort_order ?? 0
          entity.isActive = floor.is_active
          entity.appearanceIcon = null
          entity.appearanceColor = null
          em.persist(entity)
          // Map: TPS floor id → new Operis area id
          floorMap[floor.id] = newAreaId
          logger.info(`  ✓ Floor "${floor.name}" (${floor.id.slice(0,8)}…) → Area (${newAreaId.slice(0,8)}…)`)
        }
        await em.flush()
        logger.info(`Migrated ${tpsFloors.rowCount} resource areas.`)

        // ---------------------------------------------------------------------------
        // 5. Migrate: Seat → ResourcesResource (preserve UUID)
        // ---------------------------------------------------------------------------

        let migratedResources = 0
        let skippedSeats = 0

        logger.info(`Migrating ${tpsSeats.rowCount} seats...`)
        for (const seat of tpsSeats.rows) {
          // Skip seats without a valid floor or type mapping
          if (!seat.floor_id || !seat.seat_type_id) {
            skippedSeats++
            continue
          }

          const mappedAreaId = floorMap[seat.floor_id]
          const mappedTypeId = tpsTypeIdMap[seat.seat_type_id]
          if (!mappedAreaId || !mappedTypeId) {
            skippedSeats++
            continue
          }

          // Generate new UUID — TPS seat IDs are shared across locations
          const newResourceId = randomUUID()
          const entity = em.create(ResourcesResource, {
            id: newResourceId,
            tenantId,
            organizationId,
            name: seat.name?.trim() || seat.code,
            sortOrder: seat.sort_order ?? 0,
            isActive: seat.is_active,
            createdAt: now,
            updatedAt: now,
          })

          entity.name = seat.name?.trim() || seat.code
          entity.description = null
          entity.resourceTypeId = mappedTypeId
          entity.areaId = mappedAreaId
          entity.sortOrder = seat.sort_order ?? 0
          entity.capacity = 1
          entity.capacityUnitValue = null
          entity.capacityUnitName = null
          entity.capacityUnitColor = null
          entity.capacityUnitIcon = null
          entity.appearanceIcon = null
          entity.appearanceColor = null
          entity.isActive = seat.is_active
          entity.availabilityRuleSetId = null
          entity.customFieldsetCode = null
          em.persist(entity)
          migratedResources++
        }
        await em.flush()
        logger.info(`Migrated ${migratedResources} resources (skipped ${skippedSeats} seats without valid floor/type mapping).`)

        logger.info('✅ TPS Resources migration completed successfully!')
      })
    } catch (err) {
      logger.error('TPS Resources migration failed', { err })
      throw err instanceof Error ? err : new Error('TPS Resources migration failed')
    } finally {
      if (tpsClient) await tpsClient.end()
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}
