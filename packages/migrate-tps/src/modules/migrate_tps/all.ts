import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { spawn } from 'node:child_process'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { TPS_LOCATION_MAPPING } from './lib'

const logger = createLogger('migrate_tps')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runMercato(args: string[], env?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('yarn', ['mercato', ...args], {
      stdio: 'pipe',
      env: { ...process.env, ...env },
    })

    let stderr = ''

    proc.stdout.on('data', (data) => process.stdout.write(data.toString()))
    proc.stderr.on('data', (data) => {
      stderr += data.toString()
      process.stderr.write(data.toString())
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command failed with code ${code}\n${stderr}`))
      }
    })
    proc.on('error', reject)
  })
}

async function queryChildOrgs(tenantId: string, parentId: string): Promise<Array<{ id: string; name: string; slug: string }>> {
  const container = await createRequestContainer()
  try {
    const em = container.resolve<EntityManager>('em').fork()
    const orgs = await em.find(Organization, {
      tenant: tenantId as unknown as any,
      parentId: parentId,
      deletedAt: null,
    })
    return orgs.map(o => ({
      id: o.id as string,
      name: o.name,
      slug: o.slug ?? '',
    }))
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export const migrateTpsAllCommand: ModuleCli = {
  command: 'all',
  async run(rest) {
    if (rest.includes('--help') || rest.includes('-h')) {
      logger.info('Usage: yarn mercato migrate_tps all <tenantId> <rootOrgId> [--replace]')
      logger.info('')
      logger.info('Arguments:')
      logger.info('  tenantId    - Tenant ID')
      logger.info('  rootOrgId   - Root organization ID (parent for TPS branches)')
      logger.info('')
      logger.info('Environment:')
      logger.info('  TPS_DATABASE_URL  - (optional) Postgres URL to TPS database')
      logger.info('                    - If not set, uses CSV fallback from data/ directory')
      logger.info('')
      logger.info('Options:')
      logger.info('  --replace        Overwrite existing data')
      logger.info('  --skip-branches  Skip branches migration')
      return
    }

    // Parse tenantId and rootOrgId from args
    const positionalArgs = rest.filter(arg => !arg.startsWith('--'))
    const tenantId = positionalArgs[0]
    const rootOrgId = positionalArgs[1]

    if (!tenantId || !rootOrgId) {
      logger.error('Missing tenantId or rootOrgId')
      logger.error('Usage: yarn mercato migrate_tps all <tenantId> <rootOrgId> [--replace]')
      throw new Error('Missing tenantId or rootOrgId')
    }

    const replace = rest.includes('--replace')
    const skipBranches = rest.includes('--skip-branches')

    logger.info('========================================')
    logger.info('  TPS Migration - All Modules')
    logger.info('========================================')
    logger.info(`Tenant: ${tenantId}`)
    logger.info(`Root Org: ${rootOrgId}`)
    logger.info(`Replace: ${replace}`)
    logger.info('========================================')

    try {
      // Step 1: Categories (migrate to root org)
      if (!rest.includes('--skip-categories')) {
        logger.info('')
        logger.info('>>> Step 1/4: Migrating categories...')
        const args = ['migrate_tps', 'categories', tenantId, rootOrgId]
        if (replace) args.push('--replace')
        await runMercato(args)
      }

      // Step 2: Products (migrate to root org)
      if (!rest.includes('--skip-products')) {
        logger.info('')
        logger.info('>>> Step 2/4: Migrating products...')
        const args = ['migrate_tps', 'products', tenantId, rootOrgId]
        if (replace) args.push('--replace')
        await runMercato(args)
      }

      // Step 3: Branches (create child orgs from TPS locations under root org)
      if (!skipBranches) {
        logger.info('')
        logger.info('>>> Step 3/4: Migrating branches...')
        const args = ['migrate_tps', 'branches', tenantId, rootOrgId]
        if (replace) args.push('--replace')
        await runMercato(args)

        // Query DB to get the child org IDs that were just created
        logger.info('Querying child organizations from database...')
        const childOrgs = await queryChildOrgs(tenantId, rootOrgId)

        // Match child organizations back to the TPS location that created them,
        // using the same mapping branches.ts wrote them with.
        const orgBySlug = new Map(childOrgs.map((org) => [org.slug, org]))
        const tpsOrgs: Array<{ id: string; name: string; slug: string; location: string }> = []
        for (const mapping of TPS_LOCATION_MAPPING) {
          const org = orgBySlug.get(mapping.slug)
          if (!org) {
            // Report per location: only the all-missing case used to warn, so a
            // single unresolved branch was skipped silently and the run still
            // finished by declaring every migration successful.
            logger.warn(`No organization found for TPS location "${mapping.tpsKey}" (slug "${mapping.slug}") — its resources are not migrated.`)
            continue
          }
          tpsOrgs.push({ ...org, location: mapping.tpsKey })
        }

        if (tpsOrgs.length === 0) {
          logger.warn('No TPS child organizations found in database. Skipping resources migration.')
        } else {
          logger.info(`Found ${tpsOrgs.length} TPS child organizations:`)
          for (const org of tpsOrgs) {
            logger.info(`  - ${org.name} (${org.slug}): ${org.id}`)
          }

          // Step 4: Resources (migrate to each TPS child org)
          if (!rest.includes('--skip-resources')) {
            logger.info('')
            logger.info('>>> Step 4/4: Migrating resources...')

            for (const org of tpsOrgs) {
              logger.info(`  Migrating resources for "${org.name}" (${org.id})...`)
              const args = ['migrate_tps', 'resources', tenantId, org.id, '--location', org.location]
              if (replace) args.push('--replace')
              await runMercato(args)
            }
          }
        }
      }

      logger.info('')
      logger.info('========================================')
      logger.info('  All migrations completed successfully!')
      logger.info('========================================')
    } catch (err) {
      logger.error('Migration failed:', { err })
      throw err
    }
  },
}
