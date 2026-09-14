import fs from 'node:fs'
import path from 'node:path'
import { metadata } from '../index'
import eventsConfig from '../events'
import injectionTable from '../widgets/injection-table'
import chatExtensionPoints from '@open-mercato/core/modules/chat/extension-points'
import tasksExtensionPoints from '@open-mercato/core/modules/tasks/extension-points'

/**
 * The module's own contract, asserted from its source rather than its runtime.
 *
 * Each check collects the offending entries and asserts the list is empty, so a
 * failure names exactly which route, key or spot broke the rule instead of stopping
 * at the first one.
 */

const MODULE_ROOT = path.resolve(__dirname, '..')

const LOCALES = fs
  .readdirSync(path.join(MODULE_ROOT, 'i18n'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))
  .sort()

const locale = JSON.parse(fs.readFileSync(path.join(MODULE_ROOT, 'i18n/en.json'), 'utf8')) as Record<
  string,
  string
>

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

const relative = (file: string) => path.relative(MODULE_ROOT, file)
const read = (file: string) => fs.readFileSync(file, 'utf8')

function declaredFeatures(source: string): string[] {
  return [...source.matchAll(/requireFeatures:\s*\[([^\]]*)\]/g)].flatMap((match) =>
    [...match[1]!.matchAll(/'([^']+)'/g)].map((entry) => entry[1]!),
  )
}

const apiRoutes = walk(path.join(MODULE_ROOT, 'api'), (file) => file === 'route.ts')
const pageMetas = walk(path.join(MODULE_ROOT, 'backend'), (file) => file === 'page.meta.ts')
const sourceFiles = walk(
  MODULE_ROOT,
  (file) => (file.endsWith('.ts') || file.endsWith('.tsx')) && !file.endsWith('.d.ts'),
).filter((file) => !relative(file).startsWith('__tests__'))

/**
 * Every grant this module is allowed to require.
 *
 * It declares no ACL feature of its own — deliberately, so an operator cannot widen
 * access to chat or to tasks by granting something that only exists here. This list
 * is therefore the union of the two host modules' features, and a route asking for
 * anything outside it is asking for a permission nobody can grant.
 */
const CHAT_FEATURES = ['chat.view', 'chat.send']
const TASKS_FEATURES = [
  'tasks.view',
  'tasks.create',
  'tasks.edit',
  'tasks.delete',
  'tasks.assign',
  'tasks.projects.view',
  'tasks.comments.create',
  'tasks.team.view',
]
const ALLOWED_FEATURES = new Set([...CHAT_FEATURES, ...TASKS_FEATURES])

describe('module declaration', () => {
  it('declares both host modules as hard requirements', () => {
    // There is nothing here without a conversation to read and a task to point at, so
    // a deployment missing either should fail at provisioning rather than render
    // empty panels.
    expect(metadata.requires).toEqual(['chat', 'tasks'])
  })

  it('ships no ACL feature of its own', () => {
    // The integration must not become a third thing to grant. Every gate it applies
    // belongs to chat or to tasks and is checked against the same RBAC service.
    expect(fs.existsSync(path.join(MODULE_ROOT, 'acl.ts'))).toBe(false)
  })
})

describe('API routes', () => {
  it('covers every endpoint the module ships', () => {
    expect(apiRoutes.map(relative).sort()).toEqual([
      'api/conversations/[id]/cards/route.ts',
      'api/conversations/[id]/composer/route.ts',
      'api/conversations/[id]/links/route.ts',
      'api/conversations/[id]/tasks/route.ts',
      'api/links/[linkId]/card/route.ts',
      'api/links/[linkId]/route.ts',
      'api/tasks/[taskId]/sources/route.ts',
      'api/workspace/tasks/route.ts',
    ])
  })

  it('guards every route with auth and a declared feature', () => {
    const unguarded = apiRoutes.filter((file) => {
      const source = read(file)
      return !source.includes('requireAuth: true') || declaredFeatures(source).length === 0
    })
    expect(unguarded.map(relative)).toEqual([])
  })

  it('requires only features the host modules actually declare', () => {
    const unknown = apiRoutes.flatMap((file) =>
      declaredFeatures(read(file))
        .filter((feature) => !ALLOWED_FEATURES.has(feature))
        .map((feature) => `${relative(file)} -> ${feature}`),
    )
    expect(unknown).toEqual([])
  })

  /**
   * Reads that must answer a chat member who has NO task access.
   *
   * These three back the per-viewer card model: their whole job for such a member is
   * to say "a task is linked here that you cannot see", and a route-level `tasks.view`
   * would refuse the request instead — a 403 in the middle of a transcript renders as a
   * broken row, not as an unavailable card. The task grant is checked per task inside
   * `hydrateTasks`, which short-circuits and reads no task row, so nothing is widened.
   *
   * `chatTaskService.test.ts` is what proves that: it asserts the `available: false`
   * payload carries no title, reference, project, status or task id.
   */
  const CHAT_ONLY_READS = [
    'api/conversations/[id]/cards/route.ts',
    'api/conversations/[id]/tasks/route.ts',
    'api/links/[linkId]/route.ts',
  ]

  it('gates the per-viewer card reads on chat alone, and nothing else on chat alone', () => {
    // A GET-only route in this set may name just `chat.view`; every other route must
    // name a task grant too, so an accidental omission cannot quietly widen anything.
    const offenders = apiRoutes
      .filter((file) => !relative(file).startsWith('api/workspace/'))
      .filter((file) => !CHAT_ONLY_READS.includes(relative(file)))
      .filter((file) => {
        const features = declaredFeatures(read(file))
        return (
          !features.some((feature) => CHAT_FEATURES.includes(feature)) ||
          !features.some((feature) => TASKS_FEATURES.includes(feature))
        )
      })
    expect(offenders.map(relative)).toEqual([])
  })

  it('keeps every chat-only read a read — a write there must still name a task grant', () => {
    // The exemption above is about GET. If one of these files grows a write, that write
    // has to be gated like every other write rather than inheriting the read's laxity.
    const offenders: string[] = []
    for (const route of CHAT_ONLY_READS) {
      const file = apiRoutes.find((candidate) => relative(candidate) === route)
      if (!file) {
        offenders.push(`${route} (missing)`)
        continue
      }
      const source = read(file)
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const block = new RegExp(`${method}:\\s*\\{[^}]*requireFeatures:\\s*\\[([^\\]]*)\\]`).exec(source)
        if (!block) continue
        const features = [...block[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!)
        if (!features.some((feature) => TASKS_FEATURES.includes(feature))) {
          offenders.push(`${route} → ${method}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('never requires a chat write grant for a private read', () => {
    // Opening your own task list must not require permission to post in a
    // conversation. The workspace routes touch no conversation and must say so.
    const workspace = apiRoutes.filter((file) => relative(file).startsWith('api/workspace/'))
    expect(workspace.map(relative)).not.toEqual([])
    for (const file of workspace) {
      expect(declaredFeatures(read(file))).not.toContain('chat.send')
    }
  })

  it('requires chat.send wherever a card is published', () => {
    // Posting a card is a write to the conversation, so it takes the write grant even
    // though the thing being created is a task.
    for (const route of [
      'api/conversations/[id]/tasks/route.ts',
      'api/conversations/[id]/links/route.ts',
      'api/links/[linkId]/card/route.ts',
    ]) {
      const file = apiRoutes.find((candidate) => relative(candidate) === route)
      expect(file).toBeTruthy()
      expect(declaredFeatures(read(file as string))).toContain('chat.send')
    }
  })

  it('exports openApi from every route, so the API docs stay complete', () => {
    const undocumented = apiRoutes.filter((file) => !read(file).includes('export const openApi'))
    expect(undocumented.map(relative)).toEqual([])
  })

  /**
   * Scope must come from the session. A route that read `organizationId` or
   * `tenantId` out of a body or a query string would let a caller name somebody
   * else's tenant — the one mistake that turns every other check here into theatre.
   */
  it('never reads tenant or organization scope from request input', () => {
    const offenders = apiRoutes.filter((file) => {
      const source = read(file)
      return (
        /body\.(tenantId|organizationId)/.test(source) ||
        /query\.(tenantId|organizationId)/.test(source)
      )
    })
    expect(offenders.map(relative)).toEqual([])
  })
})

describe('backend pages', () => {
  it('guards every page with auth and a declared feature', () => {
    const unguarded = pageMetas.filter((file) => {
      const source = read(file)
      return !source.includes('requireAuth: true') || declaredFeatures(source).length === 0
    })
    expect(unguarded.map(relative)).toEqual([])
  })

  it('requires only features the host modules declare', () => {
    const unknown = pageMetas.flatMap((file) =>
      declaredFeatures(read(file))
        .filter((feature) => !ALLOWED_FEATURES.has(feature))
        .map((feature) => `${relative(file)} -> ${feature}`),
    )
    expect(unknown).toEqual([])
  })

  /**
   * `/backend/tasks` and `/backend/tasks/{id}` belong to the `workflows` user-task
   * queue, and the static `/backend/tasks/*` pages belong to the tasks module. This
   * module adds a page under chat's own prefix and must never add one under either,
   * or route resolution becomes a question of which module loaded first.
   */
  it('adds no page under the shared /backend/tasks prefix', () => {
    const offenders = pageMetas.map(relative).filter((file) => file.startsWith('backend/tasks'))
    expect(offenders).toEqual([])
  })
})

describe('events', () => {
  it('namespaces every event under the module', () => {
    expect(eventsConfig.events.filter((event) => !event.id.startsWith('chat_tasks.'))).toEqual([])
  })

  it('bridges every event to the browser, so a card refreshes without a poll', () => {
    const notBroadcast = eventsConfig.events.filter((event) => event.clientBroadcast !== true)
    expect(notBroadcast.map((event) => event.id)).toEqual([])
  })

  /**
   * A declared event that nothing emits is worse than no event at all: the client
   * subscribes to it, the subscription looks like live refresh, and every viewer
   * but the actor silently keeps stale data until a stale-time expires. Both of
   * these were declared, bridged, and never emitted — so link and unlink left
   * every other participant's panel wrong.
   *
   * Matching on the id in a source file rather than on a mock, because the point
   * is that a call site exists at all.
   */
  it('emits every event it declares', () => {
    const sources = walk(MODULE_ROOT, (file) => file.endsWith('.ts') || file.endsWith('.tsx'))
      .filter((file) => !file.includes('__tests__') && !file.includes('__integration__'))
      .filter((file) => !file.endsWith('events.ts'))
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n')

    const unemitted = eventsConfig.events
      .map((event) => event.id)
      .filter((id) => !sources.includes(`'${id}'`) && !sources.includes(`"${id}"`))

    expect(unemitted).toEqual([])
  })

  /**
   * Bridging one of these to the customer portal would put an internal conversation's
   * activity on a customer-facing stream.
   */
  it('never bridges to the customer portal', () => {
    const portalBound = eventsConfig.events.filter(
      (event) => (event as { portalBroadcast?: boolean }).portalBroadcast === true,
    )
    expect(portalBound.map((event) => event.id)).toEqual([])
  })
})

describe('injection table', () => {
  const declaredSpots = new Set(
    [
      ...Object.values(chatExtensionPoints.hosts).map((host) => (host as { spotId?: string }).spotId),
      ...Object.values(tasksExtensionPoints.hosts).map((host) => (host as { spotId?: string }).spotId),
      // Not an extension point but a real platform spot the sidebar renders.
      'menu:sidebar:main',
    ].filter((spotId): spotId is string => typeof spotId === 'string'),
  )

  /**
   * The table's keys are written as literals so the extension-facts generator can
   * parse them. This is what keeps those literals honest: a renamed spot fails here
   * rather than quietly emptying a panel nobody notices for a release.
   */
  it('only names spots a host module actually declares', () => {
    const unknown = Object.keys(injectionTable).filter((spotId) => !declaredSpots.has(spotId))
    expect(unknown).toEqual([])
  })

  it('claims every chat spot this module needs', () => {
    for (const host of Object.values(chatExtensionPoints.hosts)) {
      const spotId = (host as { spotId?: string }).spotId
      expect(Object.keys(injectionTable)).toContain(spotId)
    }
  })

  it('points every entry at a widget that exists on disk', () => {
    const widgetIds = new Set(
      walk(path.join(MODULE_ROOT, 'widgets/injection'), (file) => file === 'widget.ts')
        .flatMap((file) => [...read(file).matchAll(/id:\s*'([^']+)'/g)].map((match) => match[1]!))
        .filter((id) => id.startsWith('chat_tasks.injection.')),
    )
    const dangling = Object.entries(injectionTable).flatMap(([spotId, slots]) =>
      (Array.isArray(slots) ? slots : [slots])
        .map((slot) => (typeof slot === 'string' ? slot : slot.widgetId))
        .filter((widgetId) => !widgetIds.has(widgetId))
        .map((widgetId) => `${spotId} -> ${widgetId}`),
    )
    expect(dangling).toEqual([])
  })
})

describe('i18n', () => {
  it('defines every key the module uses', () => {
    const used = new Set<string>()
    for (const file of sourceFiles) {
      // The lookbehind matters: without it an identifier ending in `t(` would be
      // mistaken for a translation lookup.
      for (const match of read(file).matchAll(/(?<![\w$])t\(\s*'(chat_tasks\.[^']+)'/g)) {
        used.add(match[1]!)
      }
    }
    const missing = [...used].filter((key) => !(key in locale) && !key.endsWith('.*')).sort()
    expect(missing).toEqual([])
  })

  it('keeps every locale at key parity with English', () => {
    const englishKeys = Object.keys(locale).sort().join('|')
    const drift = LOCALES.filter((name) => name !== 'en').flatMap((name) => {
      const bundle = JSON.parse(
        fs.readFileSync(path.join(MODULE_ROOT, `i18n/${name}.json`), 'utf8'),
      ) as Record<string, string>
      return Object.keys(bundle).sort().join('|') === englishKeys ? [] : [name]
    })
    expect(drift).toEqual([])
  })

  it('covers every frozen task status and priority, so a card never shows a raw enum', () => {
    for (const status of [
      'backlog',
      'pending',
      'in_progress',
      'blocked',
      'review',
      'done',
      'cancelled',
    ]) {
      expect(Object.keys(locale)).toContain(`chat_tasks.status.${status}`)
    }
    for (const priority of ['none', 'low', 'medium', 'high', 'urgent']) {
      expect(Object.keys(locale)).toContain(`chat_tasks.priority.${priority}`)
    }
  })
})

describe('module boundaries', () => {
  /**
   * Cross-module references are plain uuids validated at the service layer. An ORM
   * relation here would let this table block a chat-side or task-side delete, which
   * is exactly what "removing the integration cannot break either module" rules out.
   */
  it('declares no ORM relation to another module', () => {
    const entities = read(path.join(MODULE_ROOT, 'data/entities.ts'))
    for (const decorator of ['@ManyToOne', '@OneToMany', '@OneToOne', '@ManyToMany']) {
      expect(entities).not.toContain(decorator)
    }
  })

  it('never imports a host module by a deep relative path', () => {
    // Package specifiers only when crossing a module boundary: a relative climb out of
    // this directory is what a bundler silently turns into an empty module.
    const offenders = sourceFiles.filter((file) => /from '\.\.\/\.\.\/(chat|tasks)\//.test(read(file)))
    expect(offenders.map(relative)).toEqual([])
  })
})
