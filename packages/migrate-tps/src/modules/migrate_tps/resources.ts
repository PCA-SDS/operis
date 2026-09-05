import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { EntityManager } from '@mikro-orm/postgresql'
import * as pg from 'pg'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { parseTpsMigrateFlags } from './lib'
import {
  ResourcesResource,
  ResourcesResourceArea,
  ResourcesResourceAreaType,
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
  is_active: string
  deleted_at: string | null
}

interface TpsSeatTypeConfig {
  id: string
  code: string
  name: string
  color_hex: string | null
  icon: string | null
  is_active: string
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
  is_active: string
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
// CSV Fallback helpers
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data')

function getDataDir(): string {
  return process.env.TPS_DATA_DIR || DATA_DIR
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

function parseCsv<T>(filename: string): T[] {
  const filePath = path.join(getDataDir(), filename)
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const rows: T[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i])
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? ''
    }
    rows.push(row as T)
  }
  return rows
}

function loadTpsSeatTypesFromCsv(): { rows: TpsSeatTypeConfig[]; rowCount: number } {
  const all = parseCsv<TpsSeatTypeConfig>('tps_seat_types.csv')
  const filtered = all.filter(r => !r.deleted_at)
  return { rows: filtered, rowCount: filtered.length }
}

function loadTpsFloorsFromCsv(locationFilter?: string | null): { rows: TpsFloor[]; rowCount: number } {
  const all = parseCsv<TpsFloor>('tps_floors.csv')
  const filtered = locationFilter
    ? all.filter(r => !r.deleted_at && r.location === locationFilter)
    : all.filter(r => !r.deleted_at)
  return { rows: filtered, rowCount: filtered.length }
}

function loadTpsSeatsFromCsv(locationFilter?: string | null): { rows: TpsSeat[]; rowCount: number } {
  const seats = parseCsv<TpsSeat>('tps_seats.csv')
  if (locationFilter) {
    const floors = loadTpsFloorsFromCsv(locationFilter).rows
    const floorIds = new Set(floors.map(f => f.id))
    const filtered = seats.filter(s => !s.deleted_at && floorIds.has(s.floor_id))
    return { rows: filtered, rowCount: filtered.length }
  }
  const filtered = seats.filter(s => !s.deleted_at)
  return { rows: filtered, rowCount: filtered.length }
}

// ---------------------------------------------------------------------------
// Seed default area types and return the "floor" area type ID
// ---------------------------------------------------------------------------

async function seedAreaTypeAndGetFloorId(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  now: Date,
): Promise<string> {
  const defaultTypes = [
    { name: 'Campus', description: 'A campus location.', appearanceIcon: '\u{1F3DB}' },
    { name: 'Building', description: 'A building within a campus.', appearanceIcon: '\u{1F3E2}' },
    { name: 'Floor', description: 'A floor within a building.', appearanceIcon: '\u{1F4A6}' },
    { name: 'Zone', description: 'A zone within a floor or area.', appearanceIcon: '\u{1F4CD}' },
    { name: 'Room', description: 'A room within a building or zone.', appearanceIcon: '\u{1F6AA}' },
    { name: 'Section', description: 'A section within a room or area.', appearanceIcon: '\u{1F4CB}' },
    { name: 'Other', description: 'Other area type.', appearanceIcon: '\u{1F4E6}' },
  ]

  const existing = await em.find(
    ResourcesResourceAreaType,
    { tenantId, organizationId, deletedAt: null },
  )
  const existingByName = new Map(existing.map(t => [t.name, t]))

  for (const seed of defaultTypes) {
    const existingType = existingByName.get(seed.name)
    if (existingType) {
      if (!existingType.description?.trim() && seed.description) {
        existingType.description = seed.description
        existingType.updatedAt = now
        em.persist(existingType)
      }
      continue
    }
    const areaType = em.create(ResourcesResourceAreaType, {
      tenantId,
      organizationId,
      name: seed.name,
      description: seed.description ?? null,
      appearanceIcon: seed.appearanceIcon ?? null,
      appearanceColor: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(areaType)
  }
  await em.flush()

  const floorType = await em.findOne(ResourcesResourceAreaType, {
    tenantId,
    organizationId,
    name: 'Floor',
    deletedAt: null,
  })
  return floorType?.id ?? ''
}

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

    const locationLabel = locationFilter ? `location="${locationFilter}"` : 'all locations'
    logger.info(`Starting TPS Resources migration for Tenant: ${tenantId}, Org: ${organizationId}, ${locationLabel}`)

    const container = await createRequestContainer()
    let tpsClient: Client | null = null

    let tpsSeatTypes: { rows: TpsSeatTypeConfig[]; rowCount: number }
    let tpsFloors: { rows: TpsFloor[]; rowCount: number }
    let tpsSeats: { rows: TpsSeat[]; rowCount: number }

    if (tpsDbUrl) {
      try {
        logger.info('Connecting to TPS database...')
        tpsClient = await connectTps(tpsDbUrl)
        ;[tpsSeatTypes, tpsFloors, tpsSeats] = await Promise.all([
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
              ? `SELECT s.*, ${seatSortOrderExpression} FROM seats s JOIN floors f ON f.id = s.floor_id WHERE s.deleted_at IS NULL AND f.deleted_at IS NULL AND f.location = $1`
              : `SELECT s.*, ${seatSortOrderExpression} FROM seats s WHERE s.deleted_at IS NULL`,
            locationFilter ? [locationFilter] : [],
          ) as Promise<{ rows: TpsSeat[]; rowCount: number }>,
        ])
        logger.info('Loaded data from TPS database.')
      } catch (err) {
        logger.warn(`Failed to connect to TPS database: ${err}. Falling back to CSV files...`)
        if (tpsClient) { await tpsClient.end(); tpsClient = null }
        ;[tpsSeatTypes, tpsFloors, tpsSeats] = [
          loadTpsSeatTypesFromCsv(),
          loadTpsFloorsFromCsv(locationFilter),
          loadTpsSeatsFromCsv(locationFilter),
        ]
        logger.info('Loaded data from CSV files.')
      }
    } else {
      logger.info('TPS_DATABASE_URL not set. Using CSV fallback from data directory...')
      ;[tpsSeatTypes, tpsFloors, tpsSeats] = [
        loadTpsSeatTypesFromCsv(),
        loadTpsFloorsFromCsv(locationFilter),
        loadTpsSeatsFromCsv(locationFilter),
      ]
      logger.info('Loaded data from CSV files.')
    }

    logger.info(`Found ${tpsSeatTypes.rowCount} seat type configs, ${tpsFloors.rowCount} floors, ${tpsSeats.rowCount} seats`)

    if (tpsSeatTypes.rowCount === 0 && tpsFloors.rowCount === 0 && tpsSeats.rowCount === 0) {
      logger.warn('No TPS data found. Nothing to migrate.')
      return
    }

    const baseEm = container.resolve<EntityManager>('em').fork()

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

    const now = new Date()

    try {
      await baseEm.transactional(async (em) => {
        if (replace && (existingTypes > 0 || existingAreas > 0 || existingResources > 0)) {
          logger.info('Cleaning up existing resources data...')
          await em.nativeDelete(ResourcesResource, { tenantId, organizationId })
          await em.nativeDelete(ResourcesResourceArea, { tenantId, organizationId })
          await em.nativeDelete(ResourcesResourceType, { tenantId, organizationId })
          logger.info('Cleanup complete.')
        }

        // Seed default area types and get the "floor" type ID
        const floorAreaTypeId = await seedAreaTypeAndGetFloorId(em, tenantId, organizationId, now)

        // Migrate: SeatTypeConfig -> ResourcesResourceType
        const tpsTypeIdMap: Record<string, string> = {}
        logger.info(`Migrating ${tpsSeatTypes.rowCount} seat type configs...`)
        for (const tpsType of tpsSeatTypes.rows) {
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
          logger.info(`  SeatType "${tpsType.code}" -> ResourceType`)
        }
        await em.flush()
        logger.info(`Migrated ${tpsSeatTypes.rowCount} resource types.`)

        // Migrate: Floor -> ResourcesResourceArea
        const floorMap: Record<string, string> = {}
        logger.info(`Migrating ${tpsFloors.rowCount} floors...`)
        for (const floor of tpsFloors.rows) {
          const newAreaId = randomUUID()
          const entity = em.create(ResourcesResourceArea, {
            id: newAreaId,
            tenantId,
            organizationId,
            name: floor.name,
            sortOrder: floor.sort_order ?? 0,
            isActive: floor.is_active === 'true' || floor.is_active === 't',
            createdAt: now,
            updatedAt: now,
          })
          entity.description = null
          entity.areaType = floorAreaTypeId
            ? (em.getReference(ResourcesResourceAreaType, floorAreaTypeId) as unknown as ResourcesResourceAreaType)
            : undefined
          entity.parentAreaId = null
          entity.sortOrder = floor.sort_order ?? 0
          entity.isActive = floor.is_active === 'true' || floor.is_active === 't'
          entity.appearanceIcon = null
          entity.appearanceColor = null
          em.persist(entity)
          floorMap[floor.id] = newAreaId
          logger.info(`  Floor "${floor.name}" -> Area`)
        }
        await em.flush()
        logger.info(`Migrated ${tpsFloors.rowCount} resource areas.`)

        // Migrate: Seat -> ResourcesResource
        let migratedResources = 0
        let skippedSeats = 0
        logger.info(`Migrating ${tpsSeats.rowCount} seats...`)
        for (const seat of tpsSeats.rows) {
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
          const newResourceId = randomUUID()
          const entity = em.create(ResourcesResource, {
            id: newResourceId,
            tenantId,
            organizationId,
            name: seat.name?.trim() || seat.code,
            sortOrder: seat.sort_order ?? 0,
            isActive: seat.is_active === 'true' || seat.is_active === 't',
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
          entity.isActive = seat.is_active === 'true' || seat.is_active === 't'
          entity.availabilityRuleSetId = null
          entity.customFieldsetCode = null
          em.persist(entity)
          migratedResources++
        }
        await em.flush()
        logger.info(`Migrated ${migratedResources} resources (skipped ${skippedSeats} seats).`)
        logger.info('TPS Resources migration completed successfully!')
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
