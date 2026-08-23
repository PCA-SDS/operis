import fs from 'node:fs'
import path from 'node:path'
import { features } from '../acl'
import { setup } from '../setup'
import { notificationTypes } from '../notifications'
import eventsConfig from '../events'
import { extensionPoints } from '../extension-points'
import { translatableFields } from '../translations'

/**
 * The module's own contract, asserted from its source rather than its runtime.
 *
 * Each check collects the offending entries and asserts the list is empty, so a
 * failure names exactly which route, page or key broke the rule instead of
 * stopping at the first one.
 */

const MODULE_ROOT = path.resolve(__dirname, '..')
const featureIds = new Set(features.map((feature) => feature.id))
const locale = JSON.parse(
  fs.readFileSync(path.join(MODULE_ROOT, 'i18n/en.json'), 'utf8'),
) as Record<string, string>

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

function relative(file: string): string {
  return path.relative(MODULE_ROOT, file)
}

function read(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

/** Every `requireFeatures: [...]` literal in a metadata block. */
function declaredFeatures(source: string): string[] {
  return [...source.matchAll(/requireFeatures:\s*\[([^\]]*)\]/g)].flatMap((match) =>
    [...match[1]!.matchAll(/'([^']+)'/g)].map((entry) => entry[1]!),
  )
}

function dependenciesOf(featureId: string): string[] {
  const feature = features.find((entry) => entry.id === featureId)
  return (feature as { dependsOn?: string[] } | undefined)?.dependsOn ?? []
}

const apiRoutes = walk(path.join(MODULE_ROOT, 'api'), (file) => file === 'route.ts')
const pageMetas = walk(path.join(MODULE_ROOT, 'backend'), (file) => file === 'page.meta.ts')
const subscribers = walk(path.join(MODULE_ROOT, 'subscribers'), (file) => file.endsWith('.ts'))

describe('ACL features', () => {
  it('namespaces every feature under the module', () => {
    const offenders = features.filter(
      (feature) => !feature.id.startsWith('tasks.') || feature.module !== 'tasks' || !feature.title,
    )
    expect(offenders.map((feature) => feature.id)).toEqual([])
  })

  it('declares no duplicates', () => {
    expect(featureIds.size).toBe(features.length)
  })

  it('only depends on features it also declares', () => {
    const offenders = features.flatMap((feature) =>
      dependenciesOf(feature.id)
        .filter((dependency) => !featureIds.has(dependency))
        .map((dependency) => `${feature.id} -> ${dependency}`),
    )
    expect(offenders).toEqual([])
  })

  it('has no dependency cycles', () => {
    const offenders: string[] = []
    for (const start of featureIds) {
      const seen = new Set<string>()
      const queue = [...dependenciesOf(start)]
      while (queue.length) {
        const next = queue.shift()!
        if (next === start) {
          offenders.push(start)
          break
        }
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(...dependenciesOf(next))
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('default role grants', () => {
  const grants = setup.defaultRoleFeatures ?? {}

  it('gives admin the whole module', () => {
    expect(grants.admin).toContain('tasks.*')
  })

  it('grants employees only features that exist', () => {
    const offenders = (grants.employee ?? []).filter((granted) => !featureIds.has(granted))
    expect(offenders).toEqual([])
  })

  it('withholds the workspace-shaping grants from employees', () => {
    // An employee runs their own work; reshaping projects, the label catalog or
    // milestones is an administrative act.
    const withheld = ['tasks.projects.manage', 'tasks.labels.manage', 'tasks.labels.manage']
    const leaked = withheld.filter((feature) => (grants.employee ?? []).includes(feature))
    expect(leaked).toEqual([])
  })

  it('keeps the employee grant self-consistent with its dependencies', () => {
    const granted = new Set(grants.employee ?? [])
    const missing = [...granted].flatMap((feature) =>
      dependenciesOf(feature)
        .filter((dependency) => !granted.has(dependency))
        .map((dependency) => `${feature} needs ${dependency}`),
    )
    expect(missing).toEqual([])
  })
})

describe('API routes', () => {
  it('registers routes at all', () => {
    expect(apiRoutes.length).toBeGreaterThan(15)
  })

  it('declares metadata on every route file', () => {
    const offenders = apiRoutes.filter((file) => !read(file).includes('export const metadata'))
    expect(offenders.map(relative)).toEqual([])
  })

  it('requires auth on every exported handler', () => {
    // An unguarded method is an open door regardless of its siblings.
    const offenders: string[] = []
    for (const file of apiRoutes) {
      const source = read(file)
      const methods = [...source.matchAll(/^export async function (GET|POST|PATCH|PUT|DELETE)\(/gm)].map(
        (match) => match[1]!,
      )
      if (methods.length === 0) offenders.push(`${relative(file)} exports no handler`)
      for (const method of methods) {
        if (!new RegExp(`\\b${method}:\\s*\\{[^}]*requireAuth:\\s*true`).test(source)) {
          offenders.push(`${relative(file)} ${method}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('gates every route behind a declared feature', () => {
    const offenders: string[] = []
    for (const file of apiRoutes) {
      const required = declaredFeatures(read(file))
      if (required.length === 0) offenders.push(`${relative(file)} requires nothing`)
      for (const feature of required) {
        if (!featureIds.has(feature)) offenders.push(`${relative(file)} -> ${feature}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('documents every route for the OpenAPI surface', () => {
    const offenders = apiRoutes.filter((file) => !read(file).includes('export const openApi'))
    expect(offenders.map(relative)).toEqual([])
  })

  it('routes every write through the guarded command path', () => {
    // `quick-add/parse` is a POST because the input is a body, not because it
    // writes: it interprets a line of text and returns the reading. The client
    // then creates the task through the normal create endpoint, which is guarded.
    const readOnlyPosts = new Set(['api/quick-add/parse/route.ts'])
    const offenders = apiRoutes.filter((file) => {
      if (readOnlyPosts.has(relative(file))) return false
      const source = read(file)
      const writes = source.match(/^export async function (POST|PATCH|PUT|DELETE)\(/gm)
      return !!writes && !source.includes('runGuardedCommand')
    })
    expect(offenders.map(relative)).toEqual([])
  })

  it('keeps the read-only exemptions free of command dispatch', () => {
    // If one of these ever starts writing it must lose the exemption, so pin
    // the property that justifies it rather than trusting the list.
    const source = read(path.join(MODULE_ROOT, 'api/quick-add/parse/route.ts'))
    expect(source).not.toContain('commandBus')
  })
})

describe('backend pages', () => {
  it('ships a metadata file for every page', () => {
    const pages = walk(path.join(MODULE_ROOT, 'backend'), (file) => file === 'page.tsx')
    expect(pages.length).toBeGreaterThan(0)
    expect(pageMetas.length).toBe(pages.length)
  })

  it('gates every page behind auth and a declared feature', () => {
    const offenders: string[] = []
    for (const file of pageMetas) {
      const source = read(file)
      if (!source.includes('requireAuth: true')) offenders.push(`${relative(file)} missing requireAuth`)
      const required = declaredFeatures(source)
      if (required.length === 0) offenders.push(`${relative(file)} requires nothing`)
      for (const feature of required) {
        if (!featureIds.has(feature)) offenders.push(`${relative(file)} -> ${feature}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('files every navigable page under one nav group', () => {
    const groups = new Set<string>()
    for (const file of pageMetas) {
      const match = read(file).match(/pageGroupKey:\s*'([^']+)'/)
      if (match) groups.add(match[1]!)
    }
    expect([...groups]).toEqual(['tasks.nav.group'])
  })

  it('resolves every page title and nav group through the locale bundle', () => {
    const offenders: string[] = []
    for (const file of pageMetas) {
      const source = read(file)
      for (const match of source.matchAll(/(?:pageTitleKey|pageGroupKey|labelKey):\s*'([^']+)'/g)) {
        if (!locale[match[1]!]) offenders.push(`${relative(file)} -> ${match[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('events', () => {
  it('namespaces every event under the module', () => {
    const offenders = eventsConfig.events.filter(
      (event) => !event.id.startsWith('tasks.') || event.module !== 'tasks',
    )
    expect(offenders.map((event) => event.id)).toEqual([])
  })

  it('broadcasts the writes an open board must react to', () => {
    const broadcast = new Set(
      eventsConfig.events.filter((event) => event.clientBroadcast).map((event) => event.id),
    )
    const missing = [
      'tasks.task.created',
      'tasks.task.updated',
      'tasks.task.moved',
      'tasks.task.deleted',
    ].filter((id) => !broadcast.has(id))
    expect(missing).toEqual([])
  })

  it('subscribes only to events it declares', () => {
    const declared = new Set(eventsConfig.events.map((event) => event.id))
    const offenders: string[] = []
    for (const file of subscribers) {
      const match = read(file).match(/event:\s*'([^']+)'/)
      if (match && !declared.has(match[1]!)) offenders.push(`${relative(file)} -> ${match[1]}`)
    }
    expect(offenders).toEqual([])
  })
})

describe('notifications', () => {
  const subscriberSources = subscribers.map(read)

  it('declares only types the module actually sends', () => {
    // A declared-but-never-sent type is dead surface in the operator's
    // notification delivery settings.
    const offenders = notificationTypes
      .filter((type) => !subscriberSources.some((source) => source.includes(type.type)))
      .map((type) => type.type)
    expect(offenders).toEqual([])
  })

  it('resolves every notification string through the locale bundle', () => {
    const offenders = notificationTypes.flatMap((type) =>
      [type.titleKey, type.bodyKey].filter((key) => !locale[key]),
    )
    expect(offenders).toEqual([])
  })

  it('scopes every type to this module', () => {
    const offenders = notificationTypes.filter((type) => type.module !== 'tasks').map((type) => type.type)
    expect(offenders).toEqual([])
  })
})

describe('extension points', () => {
  it('is consumed by the file it names as its source', () => {
    const offenders: string[] = []
    for (const host of Object.values(extensionPoints.hosts)) {
      const source = path.join(MODULE_ROOT, (host as { source: string }).source)
      if (!fs.existsSync(source)) {
        offenders.push(`${(host as { source: string }).source} does not exist`)
        continue
      }
      // The call site must read the id from the declaration, not repeat the
      // literal — a duplicated string leaves the host unbound.
      if (!read(source).includes('extensionPoints.hosts')) {
        offenders.push(`${(host as { source: string }).source} does not consume the declaration`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('translatable fields', () => {
  it('declares fields only on entities the module owns', () => {
    const offenders = Object.keys(translatableFields).filter((entityId) => !entityId.startsWith('tasks:'))
    expect(offenders).toEqual([])
  })
})

describe('locale bundle', () => {
  it('namespaces every key under the module', () => {
    const offenders = Object.keys(locale).filter((key) => !key.startsWith('tasks.'))
    expect(offenders).toEqual([])
  })

  it('has no blank copy', () => {
    const offenders = Object.entries(locale)
      .filter(([, value]) => typeof value !== 'string' || value.trim().length === 0)
      .map(([key]) => key)
    expect(offenders).toEqual([])
  })

  it('covers every status, priority and milestone status', () => {
    const required = [
      ...['backlog', 'pending', 'in_progress', 'blocked', 'review', 'done', 'cancelled'].map(
        (status) => `tasks.status.${status}`,
      ),
      ...['none', 'low', 'medium', 'high', 'urgent'].map((priority) => `tasks.priority.${priority}`),
      ...['planned', 'active', 'completed'].map((status) => `tasks.milestoneStatus.${status}`),
    ]
    expect(required.filter((key) => !locale[key])).toEqual([])
  })
})
