import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Client } from 'pg'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { parseTpsMigrateFlags } from './lib'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'

const logger = createLogger('migrate_tps')

// ---------------------------------------------------------------------------
// TPS location key → Operis organization name mapping
// ---------------------------------------------------------------------------

const LOCATION_MAPPING: Array<{ tpsKey: string; orgName: string; slug: string }> = [
  { tpsKey: 'benThanh',     orgName: 'Bến Thành',     slug: 'ben-thanh' },
  { tpsKey: 'thaoDien',     orgName: 'Thảo Điền',     slug: 'thao-dien' },
  { tpsKey: 'phuMyHung',    orgName: 'Phú Mỹ Hưng',   slug: 'phu-my-hung' },
  { tpsKey: 'hoanKiem',     orgName: 'Hoàn Kiếm',     slug: 'hoan-kiem' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function connectTps(url: string): Promise<Client> {
  const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1')
  const client = new Client({
    connectionString: url,
    ssl: isLocalhost ? false : { rejectUnauthorized: false },
  })
  await client.connect()
  return client
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export const migrateTpsBranchesCommand: ModuleCli = {
  command: 'branches',
  async run(rest) {
    const { tenantId, organizationId, replace } = parseTpsMigrateFlags(rest)
    if (!tenantId || !organizationId) {
      logger.error('Missing tenantId or organizationId')
      logger.error('Usage: yarn mercato migrate_tps branches <tenantId> <organizationId> [--replace]')
      throw new Error('Missing tenantId or organizationId')
    }

    const tpsDbUrl = process.env.TPS_DATABASE_URL
    if (!tpsDbUrl) {
      logger.error('Missing TPS_DATABASE_URL environment variable')
      throw new Error('TPS_DATABASE_URL not set')
    }

    logger.info(`Starting TPS Branches migration for Tenant: ${tenantId}`)

    const container = await createRequestContainer()
    let tpsClient: Client | null = null

    try {
      tpsClient = await connectTps(tpsDbUrl)

      // Verify locations exist in TPS
      const locations = await tpsClient.query<{ location: string }>(
        'SELECT DISTINCT location FROM floors WHERE deleted_at IS NULL ORDER BY location',
      )
      logger.info(`Found ${locations.rowCount} TPS locations: ${locations.rows.map(r => r.location).join(', ')}`)

      const baseEm = container.resolve<EntityManager>('em').fork()

      // Verify parent organization exists
      const parentOrg = await baseEm.findOne(Organization, { id: organizationId })
      if (!parentOrg) {
        throw new Error(`Parent organization ${organizationId} not found`)
      }
      logger.info(`Parent org: "${parentOrg.name}" (${organizationId})`)

      // Check existing child orgs for this tenant
      const existingOrgs = await baseEm.find(Organization, {
        tenant: tenantId as unknown as any,
        deletedAt: null,
      })
      const existingBySlug = new Map(existingOrgs.map(o => [o.slug ?? '', o]))
      const existingByName = new Map(existingOrgs.map(o => [o.name, o]))

      const now = new Date()

      await baseEm.transactional(async (em) => {
        let created = 0
        let skipped = 0

        for (const mapping of LOCATION_MAPPING) {
          const hasFloors = locations.rows.some(r => r.location === mapping.tpsKey)
          if (!hasFloors) {
            logger.info(`  ⏭ Skipping "${mapping.orgName}" — no floors in TPS`)
            skipped++
            continue
          }

          const existing = existingBySlug.get(mapping.slug) ?? existingByName.get(mapping.orgName)

          if (existing) {
            if (!replace) {
              logger.info(`  ⏭ "${mapping.orgName}" already exists (${existing.id}) — skipping (use --replace to update)`)
              continue
            }
            // Soft-delete existing so we can recreate
            existing.deletedAt = now
            existing.isActive = false
            em.persist(existing)
            logger.info(`  🔄 "${mapping.orgName}" — soft-deleted existing (${existing.id})`)
          }

          // Create new child organization under parent
          const newOrg = em.create(Organization, {
            id: existing?.id ?? undefined, // reuse id if replace
            tenant: tenantId as unknown as any,
            name: mapping.orgName,
            slug: mapping.slug,
            isActive: true,
            logoPreserveAspectRatio: false,
            parentId: organizationId,
            rootId: organizationId,
            treePath: `${organizationId}/${existing?.id ?? ''}`,
            depth: 1,
            ancestorIds: [organizationId],
            childIds: [],
            descendantIds: [],
            createdAt: now,
            updatedAt: now,
          })
          em.persist(newOrg)
          logger.info(`  ✓ "${mapping.orgName}" → Organization (${newOrg.id})`)
          created++
        }

        await em.flush()

        // Rebuild full tenant hierarchy to fix tree_path / descendant_ids
        logger.info('Rebuilding tenant organization hierarchy...')
        const allOrgs = await em.find(Organization, {
          tenant: tenantId as unknown as any,
          deletedAt: null,
        })
        await rebuildTenantOrgHierarchy(em, tenantId, allOrgs, organizationId)
        await em.flush()

        logger.info(`✅ Branches migration done. Created/updated ${created} organizations, skipped ${skipped}.`)
      })
    } catch (err) {
      logger.error('TPS Branches migration failed', { err })
      throw err instanceof Error ? err : new Error('TPS Branches migration failed')
    } finally {
      if (tpsClient) await tpsClient.end()
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

// ---------------------------------------------------------------------------
// Rebuild tenant org hierarchy (simplified rebuildTenantHierarchyForTenant)
// ---------------------------------------------------------------------------

function normalizeUuid(value: unknown): string | null {
  if (!value) return null
  const v = String(value).trim()
  if (!v || v.toLowerCase() === 'null' || v.toLowerCase() === 'undefined') return null
  return v
}

interface OrgNode {
  id: string
  org: Organization
  parentId: string | null
  children: Set<string>
}

async function rebuildTenantOrgHierarchy(
  em: EntityManager,
  tenantId: string,
  organizations: Organization[],
  _parentRootId: string,
): Promise<void> {
  const nodes = new Map<string, OrgNode>()

  for (const org of organizations) {
    const id = String(org.id)
    nodes.set(id, {
      id,
      org,
      parentId: normalizeUuid(org.parentId),
      children: new Set<string>(),
    })
  }

  // Establish child relationships
  for (const [, node] of nodes) {
    if (!node.parentId || node.parentId === node.id) {
      node.parentId = null
      continue
    }
    const parent = nodes.get(node.parentId)
    if (!parent) {
      node.parentId = null
      continue
    }
    parent.children.add(node.id)
  }

  const visited = new Set<string>()
  const now = new Date()

  function walk(nodeId: string, ancestors: string[]): string[] {
    if (ancestors.includes(nodeId)) {
      // Cycle — break
      const node = nodes.get(nodeId)
      if (!node) return []
      node.org.rootId = nodeId
      node.org.treePath = nodeId
      node.org.depth = 0
      node.org.ancestorIds = []
      node.org.childIds = []
      node.org.descendantIds = []
      node.org.updatedAt = now
      visited.add(nodeId)
      return []
    }

    const node = nodes.get(nodeId)
    if (!node) return []

    visited.add(nodeId)
    const id = String(node.org.id)
    const nextAncestors = [...ancestors, id]

    const childIds = Array.from(node.children)
      .filter(cid => nodes.has(cid))
      .sort((a, b) => {
        const an = nodes.get(a)!.org.name.toLowerCase()
        const bn = nodes.get(b)!.org.name.toLowerCase()
        return an.localeCompare(bn)
      })

    const descendantIds: string[] = []
    for (const childId of childIds) {
      const desc = walk(childId, nextAncestors)
      descendantIds.push(childId, ...desc)
    }

    const depth = ancestors.length
    const rootId = ancestors.length ? ancestors[0] : id
    const treePath = nextAncestors.join('/')

    node.org.parentId = node.parentId
    node.org.rootId = rootId
    node.org.treePath = treePath
    node.org.depth = depth
    node.org.ancestorIds = ancestors
    node.org.childIds = childIds
    node.org.descendantIds = descendantIds
    node.org.updatedAt = now

    return descendantIds
  }

  // Walk roots first
  for (const [id, node] of nodes) {
    if (!node.parentId || !nodes.has(node.parentId)) {
      walk(id, [])
    }
  }
  // Handle remaining (orphaned / cycles)
  for (const id of nodes.keys()) {
    if (!visited.has(id)) {
      walk(id, [])
    }
  }
}
