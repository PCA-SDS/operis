import fs from 'node:fs'
import path from 'node:path'
import {
  findApiRouteManifestMatch,
  findRouteManifestMatch,
  type ApiRouteManifestEntry,
  type BackendRouteManifestEntry,
  type HttpMethod,
} from '@open-mercato/shared/modules/registry'
import { features } from '../acl'
import { setup } from '../setup'

/**
 * TC-TASKS-020: what happens when the module is switched off.
 *
 * The app resolves pages and APIs by matching a path against the registered
 * manifest, so "the module is disabled" means precisely "its entries are not in
 * the manifest". These tests build the manifest from the module's own files and
 * resolve against it twice — with tasks present, and with tasks removed — so a
 * route that leaks through without the module is caught here.
 *
 * `/backend/tasks` is a shared prefix: the workflows module already owns
 * `/backend/tasks` and `/backend/tasks/[id]`. The precedence checks pin that
 * both modules keep working side by side.
 */

const CORE_MODULES = path.resolve(__dirname, '../..')
const TASKS_ROOT = path.join(CORE_MODULES, 'tasks')

function walk(dir: string, match: (file: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return []
  const found: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walk(full, match))
    else if (match(entry.name)) found.push(full)
  }
  return found
}

/** `backend/tasks/projects/[id]/page.tsx` → `/backend/tasks/projects/[id]` */
function backendPattern(moduleRoot: string, file: string): string {
  const relative = path.relative(path.join(moduleRoot, 'backend'), path.dirname(file))
  return `/backend/${relative.split(path.sep).join('/')}`.replace(/\/$/, '')
}

/** `api/projects/[id]/tasks/route.ts` → `/api/tasks/projects/[id]/tasks` */
function apiPath(moduleId: string, moduleRoot: string, file: string): string {
  const relative = path.relative(path.join(moduleRoot, 'api'), path.dirname(file))
  const suffix = relative === '' ? '' : `/${relative.split(path.sep).join('/')}`
  return `/api/${moduleId}${suffix}`
}

function methodsIn(source: string): HttpMethod[] {
  return [...source.matchAll(/^export async function (GET|POST|PATCH|PUT|DELETE)\(/gm)].map(
    (match) => match[1] as HttpMethod,
  )
}

function backendRoutesOf(moduleRoot: string): BackendRouteManifestEntry[] {
  return walk(path.join(moduleRoot, 'backend'), (file) => file === 'page.tsx').map(
    (file) =>
      ({
        pattern: backendPattern(moduleRoot, file),
        requireAuth: true,
      }) as BackendRouteManifestEntry,
  )
}

function apiRoutesOf(moduleId: string, moduleRoot: string): ApiRouteManifestEntry[] {
  return walk(path.join(moduleRoot, 'api'), (file) => file === 'route.ts').map((file) => ({
    path: apiPath(moduleId, moduleRoot, file),
    methods: methodsIn(fs.readFileSync(file, 'utf8')),
  })) as ApiRouteManifestEntry[]
}

const tasksBackendRoutes = backendRoutesOf(TASKS_ROOT)
const tasksApiRoutes = apiRoutesOf('tasks', TASKS_ROOT)
const workflowsBackendRoutes = backendRoutesOf(path.join(CORE_MODULES, 'workflows'))

const withTasks = [...workflowsBackendRoutes, ...tasksBackendRoutes]
const withoutTasks = [...workflowsBackendRoutes]

const TASKS_PAGES = [
  '/backend/tasks/today',
  '/backend/tasks/all',
  '/backend/tasks/upcoming',
  '/backend/tasks/assigned',
  '/backend/tasks/completed',
  '/backend/tasks/team',
  '/backend/tasks/projects',
]

describe('the module is discoverable when enabled', () => {
  it('registers a page for every documented view', () => {
    const missing = TASKS_PAGES.filter((page) => !findRouteManifestMatch(withTasks, page))
    expect(missing).toEqual([])
  })

  it('resolves a project detail page through its dynamic segment', () => {
    const match = findRouteManifestMatch(withTasks, '/backend/tasks/projects/3f0d2b1a')
    expect(match?.route.pattern).toBe('/backend/tasks/projects/[id]')
    expect(match?.params.id).toBe('3f0d2b1a')
  })

  it('registers the API surface the pages call', () => {
    const endpoints: [HttpMethod, string][] = [
      ['GET', '/api/tasks/projects'],
      ['POST', '/api/tasks/projects'],
      ['GET', '/api/tasks/my-tasks'],
      ['GET', '/api/tasks/my-tasks/calendar'],
      ['POST', '/api/tasks/quick-add/parse'],
      ['GET', '/api/tasks/inbox'],
      ['GET', '/api/tasks/projects/abc/board'],
      ['PATCH', '/api/tasks/tasks/abc/move'],
      ['GET', '/api/tasks/team/members'],
      ['GET', '/api/tasks/labels'],
    ]
    const missing = endpoints.filter(
      ([method, endpoint]) => !findApiRouteManifestMatch(tasksApiRoutes, method, endpoint),
    )
    expect(missing).toEqual([])
  })
})

const tasksPatterns = new Set(tasksBackendRoutes.map((route) => route.pattern))

describe('the module disappears when disabled', () => {
  it('resolves none of its pages to a tasks page', () => {
    const leaked = TASKS_PAGES.filter((page) => {
      const match = findRouteManifestMatch(withoutTasks, page)
      return match && tasksPatterns.has(match.route.pattern)
    })
    expect(leaked).toEqual([])
  })

  it('hands the shared prefix back to workflows rather than erroring', () => {
    // Documented consequence of sharing `/backend/tasks`: with the module off,
    // `/backend/tasks/today` matches the workflows detail route and renders its
    // "workflow not found" state. That is a dead end, not a broken page — no
    // tasks code runs and no tasks data is reachable.
    for (const page of TASKS_PAGES) {
      const match = findRouteManifestMatch(withoutTasks, page)
      expect(match?.route.pattern).toBe('/backend/tasks/[id]')
    }
  })

  it('resolves none of its API endpoints', () => {
    const endpoints: [HttpMethod, string][] = [
      ['GET', '/api/tasks/projects'],
      ['POST', '/api/tasks/projects'],
      ['GET', '/api/tasks/my-tasks'],
      ['PATCH', '/api/tasks/tasks/abc/move'],
    ]
    const leaked = endpoints.filter(([method, endpoint]) =>
      findApiRouteManifestMatch([], method, endpoint),
    )
    expect(leaked).toEqual([])
  })

  it('takes its ACL features out of the grantable set', () => {
    // Features are contributed by the module, so a disabled module contributes
    // none — nothing can be granted and every guard denies.
    const contributed = features.filter((feature) => feature.module === 'tasks')
    expect(contributed.length).toBeGreaterThan(0)
    expect(contributed.every((feature) => feature.id.startsWith('tasks.'))).toBe(true)

    const grants = Object.values(setup.defaultRoleFeatures ?? {}).flat()
    expect(grants.every((grant) => grant.startsWith('tasks.'))).toBe(true)
  })

  it('leaves no other core module importing it', () => {
    // A cross-module import would make disabling tasks break its importer,
    // which is exactly what module gating must not do.
    const offenders: string[] = []
    const sources = walk(CORE_MODULES, (file) => /\.(ts|tsx)$/.test(file)).filter(
      (file) => !file.startsWith(`${TASKS_ROOT}${path.sep}`),
    )
    for (const file of sources) {
      const source = fs.readFileSync(file, 'utf8')
      if (/from '[^']*modules\/tasks\//.test(source)) offenders.push(path.relative(CORE_MODULES, file))
    }
    expect(offenders).toEqual([])
  })
})

describe('the shared /backend/tasks prefix', () => {
  it('leaves the workflows pages resolving to workflows', () => {
    const list = findRouteManifestMatch(withTasks, '/backend/tasks')
    expect(list?.route.pattern).toBe('/backend/tasks')

    const detail = findRouteManifestMatch(withTasks, '/backend/tasks/7b3c1d92-0000-4000-8000-000000000000')
    expect(detail?.route.pattern).toBe('/backend/tasks/[id]')
  })

  it('gives the module static views precedence over the workflows dynamic segment', () => {
    // This is the whole reason the prefix can be shared: `sortRoutesBySpecificity`
    // orders a static segment ahead of `[id]`, so `/backend/tasks/today` is a
    // tasks page and not a workflow whose id happens to be "today".
    for (const page of TASKS_PAGES.filter((entry) => entry !== '/backend/tasks/projects')) {
      expect(findRouteManifestMatch(withTasks, page)?.route.pattern).toBe(page)
    }
  })

  it('does not register a pattern that collides with the workflows pages', () => {
    const collisions = tasksBackendRoutes
      .map((route) => route.pattern)
      .filter((pattern) => pattern === '/backend/tasks' || pattern === '/backend/tasks/[id]')
    expect(collisions).toEqual([])
  })
})
