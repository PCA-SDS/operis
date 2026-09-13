/**
 * Repo-wide audit: no ungated cross-module deep link.
 *
 * A module can be withheld from a tenant (`tenant_modules`) or from one user
 * (`user_modules`). Every surface derived from `grantedFeatures` handles that on
 * its own — navigation, page guards, API guards, injection widgets. A hardcoded
 * `'/backend/<something>'` string does not: it carries no feature to test, so it
 * survives into a UI whose owning module the guards now deny, and tells the user
 * a capability exists that they cannot reach.
 *
 * The rule this enforces: a file may hardcode a link into another module only
 * when it also consults the viewer's reachable module set
 * (`useModuleEnabled` / `useEnabledModules` / `ModuleGate` / `hasVisibleRoute`),
 * or when it appears in ALLOWED_CROSS_MODULE_LINKS below with a reason.
 *
 * Scope: files belonging to a module that is part of the shipped plan
 * (`ModuleInfo.defaultEntitlement === 'enabled'`), plus shared code that every
 * page loads. A link between two modules that are both outside the plan is
 * unreachable — the page holding it is gated too — so it is not flagged. Adding
 * a module to the plan therefore surfaces its links for review, which is the
 * point.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

/**
 * Modules entitlement never governs. Read from source by a test below rather
 * than imported, because importing the runtime module pulls in the ORM entity
 * graph this audit has no use for — and a copy that silently drifts would let
 * this guard wave through links into a module that stopped being platform.
 */
const PLATFORM_MODULE_IDS = new Set([
  'core', 'auth', 'directory', 'configs', 'entities', 'query_index', 'widgets',
  'dashboards', 'translations', 'notifications', 'attachments', 'audit_logs',
  'dictionaries', 'feature_toggles', 'perspectives', 'progress', 'search',
  'scheduler', 'telemetry', 'events', 'queue', 'cache',
])

/** Any of these in a file means it resolves module reachability at runtime. */
const MODULE_GATE_MARKERS = [
  'useModuleEnabled',
  'useEnabledModules',
  'ModuleGate',
  'hasVisibleRoute',
  'isModuleAllowed',
  'enabledModuleIds',
]

/**
 * Reviewed exceptions. Each entry states why the link cannot be reached by a
 * user whose tenant lacks the target module — not merely that it is
 * inconvenient to fix.
 */
const ALLOWED_CROSS_MODULE_LINKS: Record<string, string> = {
  'apps/mercato/src/app/(backend)/backend/loading.tsx':
    'Not a link. The backend is one catch-all route with one Suspense fallback, and this compares the pathname to pick which placeholder shape it draws. It renders no navigation, imports no module code, and the branch is unreachable without the chat module because nothing serves that path without it.',
  'packages/ui/src/backend/IntegrationsButton.tsx':
    'Rendered only by BackendHeaderChrome, which gates it on hasVisibleRoute(payload.groups, "/backend/integrations").',
  'packages/ui/src/backend/messages/MessagesIcon.tsx':
    'Rendered only by BackendHeaderChrome, which gates it on hasVisibleRoute(payload.groups, "/backend/messages").',
  'packages/ui/src/backend/messages/MessageComposer.tsx':
    'The /backend/messages fallback is the inline-compose back link, used only when a messages-module host mounts the composer without an explicit inlineBackHref.',
  'packages/core/src/modules/communication_channels/notifications.ts':
    'Notification action target. The fan-out selects recipients through RbacService, which drops users whose entitlement withholds messages, so the action never reaches them.',
  'packages/core/src/modules/communication_channels/notifications.client.ts':
    'Renderer for the notification above; it only ever runs for a recipient the entitlement-aware fan-out selected.',
  'packages/search/src/modules/search/ai-tools.ts':
    'AI tool result link. Tool discovery reads rbacService.getGrantedFeatures, which applies both entitlement layers, so a withheld module contributes no searchable records.',
  'packages/core/src/helpers/integration/salesUi.ts':
    'Playwright helper, not application code — it drives a browser against a fully entitled test tenant.',
}

type ModuleSource = { moduleId: string; indexPath: string }

function listDirectories(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
}

function collectModuleSources(): ModuleSource[] {
  const sources: ModuleSource[] = []
  const roots = [
    ...listDirectories(path.join(REPO_ROOT, 'packages'))
      .map((name) => path.join(REPO_ROOT, 'packages', name, 'src', 'modules')),
    ...listDirectories(path.join(REPO_ROOT, 'apps'))
      .map((name) => path.join(REPO_ROOT, 'apps', name, 'src', 'modules')),
  ]
  for (const root of roots) {
    for (const moduleId of listDirectories(root)) {
      const indexPath = path.join(root, moduleId, 'index.ts')
      if (existsSync(indexPath)) sources.push({ moduleId, indexPath })
    }
  }
  return sources
}

function collectSourceFiles(root: string, acc: string[] = []): string[] {
  if (!existsSync(root)) return acc
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__integration__' || entry.name === 'node_modules') continue
      collectSourceFiles(full, acc)
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    if (entry.name.includes('.generated.')) continue
    acc.push(full)
  }
  return acc
}

/**
 * Maps a `/backend/<prefix>` segment to the module that serves it.
 *
 * A prefix several modules publish pages under (`config`, `profile`, `tasks`)
 * is shared chrome rather than one module's namespace, so it is excluded: a
 * link to `/backend/config/...` says nothing about which module answers it.
 */
function buildRoutePrefixOwners(): Map<string, string> {
  const claims = new Map<string, Set<string>>()
  for (const { moduleId, indexPath } of collectModuleSources()) {
    const backendRoot = path.join(path.dirname(indexPath), 'backend')
    for (const file of collectSourceFiles(backendRoot)) {
      if (path.basename(file) !== 'page.tsx') continue
      const relative = path.relative(backendRoot, file).split(path.sep)
      const prefix = relative[0]
      if (!prefix || prefix.endsWith('.tsx')) continue
      if (!claims.has(prefix)) claims.set(prefix, new Set())
      claims.get(prefix)!.add(moduleId)
    }
  }
  const owners = new Map<string, string>()
  for (const [prefix, moduleIds] of claims) {
    if (moduleIds.size === 1) owners.set(prefix, Array.from(moduleIds)[0])
  }
  return owners
}

function readShippedPlan(): Set<string> {
  const planned = new Set<string>()
  for (const { moduleId, indexPath } of collectModuleSources()) {
    const source = readFileSync(indexPath, 'utf8')
    if (/defaultEntitlement:\s*'enabled'/.test(source)) planned.add(moduleId)
  }
  return planned
}

/**
 * `info.requires` per module.
 *
 * A hard dependency makes the link safe without a runtime gate: entitlement
 * resolution drops a module whose prerequisite is withheld
 * (`resolveReachableModuleIds`), so a page in `sync_excel` can never render for
 * a viewer who cannot also reach `integrations`.
 */
function readModuleDependencies(): Map<string, string[]> {
  const dependencies = new Map<string, string[]>()
  for (const { moduleId, indexPath } of collectModuleSources()) {
    const source = readFileSync(indexPath, 'utf8')
    const match = /requires:\s*\[([^\]]*)\]/.exec(source)
    dependencies.set(
      moduleId,
      match ? Array.from(match[1].matchAll(/'([^']+)'/g)).map((entry) => entry[1]) : [],
    )
  }
  return dependencies
}

function moduleIdForFile(file: string): string | null {
  const relative = path.relative(REPO_ROOT, file).split(path.sep).join('/')
  const match = /(?:packages|apps)\/[^/]+\/src\/modules\/([^/]+)\//.exec(relative)
  return match ? match[1] : null
}

/** `PLATFORM_MODULE_IDS` as the runtime declares it, read from source. */
function readRuntimePlatformModuleIds(): string[] {
  const source = readFileSync(
    path.join(REPO_ROOT, 'packages/core/src/modules/directory/lib/tenantModules.ts'),
    'utf8',
  )
  const match = /export const PLATFORM_MODULE_IDS[^=]*=\s*\[([^\]]*)\]/.exec(source)
  if (!match) throw new Error('[internal] PLATFORM_MODULE_IDS literal not found')
  return Array.from(match[1].matchAll(/'([^']+)'/g)).map((entry) => entry[1])
}

describe('cross-module UI gating', () => {
  const routePrefixOwners = buildRoutePrefixOwners()
  const shippedPlan = readShippedPlan()
  const moduleDependencies = readModuleDependencies()

  it('carries the same platform-module list the runtime enforces', () => {
    expect([...PLATFORM_MODULE_IDS].sort()).toEqual(readRuntimePlatformModuleIds().sort())
  })

  it('maps route prefixes to the module that serves them', () => {
    expect(routePrefixOwners.get('customers')).toBe('customers')
    expect(routePrefixOwners.get('sales')).toBe('sales')
    // Several modules publish under /backend/config, so it belongs to none.
    expect(routePrefixOwners.has('config')).toBe(false)
  })

  it('finds the shipped plan through ModuleInfo.defaultEntitlement', () => {
    expect(shippedPlan.has('customers')).toBe(true)
    expect(shippedPlan.has('wms')).toBe(false)
  })

  it('has no hardcoded link into another module without a module gate', () => {
    const scanRoots = [
      ...listDirectories(path.join(REPO_ROOT, 'packages'))
        .map((name) => path.join(REPO_ROOT, 'packages', name, 'src')),
      path.join(REPO_ROOT, 'apps', 'mercato', 'src'),
    ]

    const violations: string[] = []
    for (const root of scanRoots) {
      for (const file of collectSourceFiles(root)) {
        const relative = path.relative(REPO_ROOT, file).split(path.sep).join('/')
        if (ALLOWED_CROSS_MODULE_LINKS[relative]) continue

        const owningModuleId = moduleIdForFile(file)
        // Shared code (packages/ui, the app shell) ships to every page, so it is
        // always in scope. Module code is in scope when that module is part of
        // the shipped plan and therefore actually reachable by a user.
        const inScope = owningModuleId === null || shippedPlan.has(owningModuleId)
        if (!inScope) continue

        const source = readFileSync(file, 'utf8')
        if (MODULE_GATE_MARKERS.some((marker) => source.includes(marker))) continue

        const declaredDependencies = new Set(
          owningModuleId ? moduleDependencies.get(owningModuleId) ?? [] : [],
        )
        const linked = new Set<string>()
        for (const match of source.matchAll(/['"`]\/backend\/([a-z0-9-]+)/g)) {
          const target = routePrefixOwners.get(match[1])
          if (!target || target === owningModuleId) continue
          if (PLATFORM_MODULE_IDS.has(target)) continue
          if (declaredDependencies.has(target)) continue
          linked.add(`${match[1]} → ${target}`)
        }
        if (linked.size) {
          violations.push(`${relative}: ${Array.from(linked).sort().join(', ')}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
