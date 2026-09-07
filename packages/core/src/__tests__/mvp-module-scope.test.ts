/**
 * Repo-wide audit: the shipped module plan.
 *
 * `ModuleInfo.defaultEntitlement` decides which modules a newly provisioned
 * tenant gets switched on, and absence means "off" — so the plan is expressed
 * across ~60 module `index.ts` files and cannot be read in one place. This test
 * is that one place: it pins the exact set, so widening or narrowing the product
 * surface is a deliberate, reviewable diff rather than a side effect of adding a
 * module.
 *
 * It also enforces the closure rule. `resolveReachableModuleIds` drops a module
 * whose `info.requires` are not entitled, so a planned module whose dependency
 * is unplanned would be provisioned "on" and still be unreachable — a state that
 * reads as a bug from every direction.
 *
 * Background: `.ai/specs/2026-08-25-mvp-module-scope-and-ui-gating.md`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

/**
 * Entitlement never governs these, so they are never "planned" — and a
 * dependency on one places no constraint an operator could violate.
 * `listEntitleableModules` strips them from `requires` for the same reason.
 */
const PLATFORM_MODULE_IDS = new Set([
  'core', 'auth', 'directory', 'configs', 'entities', 'query_index', 'widgets',
  'dashboards', 'translations', 'notifications', 'attachments', 'audit_logs',
  'dictionaries', 'feature_toggles', 'perspectives', 'progress', 'search',
  'scheduler', 'telemetry', 'events', 'queue', 'cache',
])

/**
 * The agreed MVP surface: CRM, the dashboard, tasks, employees, AI and the
 * modules those depend on. Everything else ships in the build but stays
 * switched off until someone decides it belongs in the product.
 *
 * `chat` joins the plan because internal direct messaging is a baseline
 * capability of the product rather than an add-on: it needs no configuration,
 * no external credentials and no seed data, so a tenant provisioned with it off
 * would simply be missing a way for colleagues to talk to each other. See
 * `.ai/specs/2026-09-03-chat-direct-messaging.md`.
 */
const EXPECTED_DEFAULT_ENABLED_MODULE_IDS = [
  'ai_assistant',
  'business_rules',
  'channel_gmail',
  'channel_imap',
  'chat',
  'communication_channels',
  'currencies',
  'customers',
  'data_sync',
  'integrations',
  'mcp',
  'messages',
  'planner',
  'resources',
  'staff',
  'sync_excel',
  'tasks',
  'workflows',
].sort()

type ModuleDeclaration = {
  moduleId: string
  defaultEntitlement: 'enabled' | 'disabled'
  requires: string[]
}

function listDirectories(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
}

/**
 * Module ids the app actually compiles in, parsed from `enabledModules`.
 *
 * A module declaring itself part of the shipped plan while the app does not
 * register it is a contradiction that nothing else catches: the plan says
 * "switch it on for every tenant", and the registry never offers it, so
 * `provisionTenant` silently skips it and the gap only surfaces as a missing
 * page much later.
 */
function readRegisteredModuleIds(): Set<string> {
  const source = readFileSync(path.join(REPO_ROOT, 'apps', 'mercato', 'src', 'modules.ts'), 'utf8')
  const arrayStart = source.indexOf('export const enabledModules')
  if (arrayStart === -1) throw new Error('[internal] enabledModules declaration not found')
  const registered = new Set<string>()
  for (const match of source.slice(arrayStart).matchAll(/id:\s*'([a-z0-9_]+)'/g)) {
    registered.add(match[1])
  }
  return registered
}

function readModuleDeclarations(): ModuleDeclaration[] {
  const declarations: ModuleDeclaration[] = []
  const roots = [
    ...listDirectories(path.join(REPO_ROOT, 'packages'))
      .map((name) => path.join(REPO_ROOT, 'packages', name, 'src', 'modules')),
    ...listDirectories(path.join(REPO_ROOT, 'apps'))
      .map((name) => path.join(REPO_ROOT, 'apps', name, 'src', 'modules')),
  ]
  for (const root of roots) {
    for (const moduleId of listDirectories(root)) {
      const indexPath = path.join(root, moduleId, 'index.ts')
      if (!existsSync(indexPath)) continue
      const source = readFileSync(indexPath, 'utf8')
      const requiresMatch = /requires:\s*\[([^\]]*)\]/.exec(source)
      declarations.push({
        moduleId,
        defaultEntitlement: /defaultEntitlement:\s*'enabled'/.test(source) ? 'enabled' : 'disabled',
        requires: requiresMatch
          ? Array.from(requiresMatch[1].matchAll(/'([^']+)'/g)).map((match) => match[1])
          : [],
      })
    }
  }
  return declarations
}

describe('shipped module plan', () => {
  const declarations = readModuleDeclarations()

  it('finds every module on disk', () => {
    expect(declarations.length).toBeGreaterThan(40)
    expect(declarations.map((entry) => entry.moduleId)).toContain('customers')
  })

  it('switches on exactly the agreed MVP surface', () => {
    const planned = declarations
      .filter((entry) => entry.defaultEntitlement === 'enabled')
      .map((entry) => entry.moduleId)
      .sort()

    expect(planned).toEqual(EXPECTED_DEFAULT_ENABLED_MODULE_IDS)
  })

  it('keeps every planned module reachable — its hard dependencies are planned too', () => {
    const planned = new Set(
      declarations.filter((entry) => entry.defaultEntitlement === 'enabled').map((entry) => entry.moduleId),
    )
    const byId = new Map(declarations.map((entry) => [entry.moduleId, entry]))

    const unsatisfied: string[] = []
    for (const moduleId of planned) {
      for (const dependency of byId.get(moduleId)?.requires ?? []) {
        if (PLATFORM_MODULE_IDS.has(dependency)) continue
        // A dependency the repo does not ship is a stale declaration, not an
        // entitlement problem, and is reported by the assertion below.
        if (!byId.has(dependency)) continue
        if (!planned.has(dependency)) unsatisfied.push(`${moduleId} requires ${dependency}`)
      }
    }

    expect(unsatisfied).toEqual([])
  })

  it('registers every module the plan switches on', () => {
    const registered = readRegisteredModuleIds()
    const planned = declarations
      .filter((entry) => entry.defaultEntitlement === 'enabled')
      .map((entry) => entry.moduleId)

    expect(planned.filter((moduleId) => !registered.has(moduleId))).toEqual([])
  })

  it('declares no dependency on a module the repo does not ship', () => {
    const known = new Set(declarations.map((entry) => entry.moduleId))
    const dangling: string[] = []
    for (const entry of declarations) {
      for (const dependency of entry.requires) {
        if (!known.has(dependency)) dangling.push(`${entry.moduleId} requires ${dependency}`)
      }
    }

    expect(dangling).toEqual([])
  })
})
