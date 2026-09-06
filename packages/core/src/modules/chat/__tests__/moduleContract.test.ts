import fs from 'node:fs'
import path from 'node:path'
import { features } from '../acl'
import { setup } from '../setup'
import eventsConfig from '../events'

/**
 * The module's own contract, asserted from its source rather than its runtime.
 *
 * Each check collects the offending entries and asserts the list is empty, so a
 * failure names exactly which route, page or key broke the rule instead of
 * stopping at the first one.
 */

const MODULE_ROOT = path.resolve(__dirname, '..')
const LOCALES = ['en', 'pl', 'es', 'de', 'ko'] as const

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

const relative = (file: string) => path.relative(MODULE_ROOT, file)
const read = (file: string) => fs.readFileSync(file, 'utf8')

/** Comments discuss `new Date()`; only real calls should fail the guard below. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** Every `requireFeatures: [...]` literal in a metadata block. */
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

describe('ACL features', () => {
  it('namespaces every feature under the module', () => {
    expect(features.filter((feature) => !feature.id.startsWith('chat.'))).toEqual([])
  })

  it('grants every declared feature to a default role, so a fresh tenant can use the module', () => {
    const granted = new Set(Object.values(setup.defaultRoleFeatures ?? {}).flat())
    const ungranted = [...featureIds].filter(
      (id) => !granted.has(id) && !granted.has(`${id.split('.')[0]}.*`),
    )
    expect(ungranted).toEqual([])
  })

  it('declares dependencies that themselves exist', () => {
    const dangling = features.flatMap((feature) =>
      ((feature as { dependsOn?: string[] }).dependsOn ?? [])
        .filter((dependency) => !featureIds.has(dependency))
        .map((dependency) => `${feature.id} → ${dependency}`),
    )
    expect(dangling).toEqual([])
  })
})

describe('API routes', () => {
  it('covers every endpoint the module ships', () => {
    expect(apiRoutes.map(relative).sort()).toEqual([
      'api/conversations/[id]/attachments/direct/route.ts',
      'api/conversations/[id]/attachments/route.ts',
      'api/conversations/[id]/members/[userId]/route.ts',
      'api/conversations/[id]/members/route.ts',
      'api/conversations/[id]/messages/[messageId]/pin/route.ts',
      'api/conversations/[id]/messages/[messageId]/reactions/route.ts',
      'api/conversations/[id]/messages/route.ts',
      'api/conversations/[id]/pins/route.ts',
      'api/conversations/[id]/read/route.ts',
      'api/conversations/[id]/route.ts',
      'api/conversations/[id]/search/route.ts',
      'api/conversations/[id]/shared/route.ts',
      'api/conversations/[id]/translate/route.ts',
      'api/conversations/route.ts',
      'api/directory/route.ts',
      'api/read-all/route.ts',
      'api/search/route.ts',
      'api/settings/route.ts',
      'api/unread-count/route.ts',
    ])
  })

  /** An unguarded chat route would expose someone else's private messages. */
  it('guards every route with auth and a declared feature', () => {
    const unguarded = apiRoutes.filter((file) => {
      const source = read(file)
      return !source.includes('requireAuth: true') || declaredFeatures(source).length === 0
    })
    expect(unguarded.map(relative)).toEqual([])
  })

  it('requires only features this module declares', () => {
    const unknown = apiRoutes.flatMap((file) =>
      declaredFeatures(read(file))
        .filter((feature) => !featureIds.has(feature))
        .map((feature) => `${relative(file)} → ${feature}`),
    )
    expect(unknown).toEqual([])
  })

  it('exports openApi from every route, so the API docs stay complete', () => {
    const undocumented = apiRoutes.filter((file) => !read(file).includes('export const openApi'))
    expect(undocumented.map(relative)).toEqual([])
  })

  /**
   * Scope must come from the session. A route that read `organizationId` or
   * `tenantId` out of the request body would let a caller name someone else's
   * tenant.
   */
  it('never reads tenant or organization scope from request input', () => {
    const offenders = apiRoutes.filter((file) => {
      const source = read(file)
      return /body\.(tenantId|organizationId)/.test(source) || /query\.(tenantId|organizationId)/.test(source)
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

  it('requires only features this module declares', () => {
    const unknown = pageMetas.flatMap((file) =>
      declaredFeatures(read(file))
        .filter((feature) => !featureIds.has(feature))
        .map((feature) => `${relative(file)} → ${feature}`),
    )
    expect(unknown).toEqual([])
  })
})

describe('events', () => {
  it('namespaces every event under the module', () => {
    expect(eventsConfig.events.filter((event) => !event.id.startsWith('chat.'))).toEqual([])
  })

  /**
   * Realtime is the whole point of a chat, and `clientBroadcast` is what puts an
   * event on the SSE bridge. An event that lost the flag would silently degrade
   * the module to "refresh to see new messages".
   */
  it('bridges every event to the browser', () => {
    const notBroadcast = eventsConfig.events.filter((event) => event.clientBroadcast !== true)
    expect(notBroadcast.map((event) => event.id)).toEqual([])
  })

  /**
   * Chat is staff-facing. `portalBroadcast` would push an internal message onto
   * the customer portal's event stream.
   */
  it('never bridges to the customer portal', () => {
    const portalBound = eventsConfig.events.filter(
      (event) => (event as { portalBroadcast?: boolean }).portalBroadcast === true,
    )
    expect(portalBound.map((event) => event.id)).toEqual([])
  })
})

describe('i18n', () => {
  it('defines every key the module uses', () => {
    const used = new Set<string>()
    for (const file of sourceFiles) {
      // The lookbehind matters: without it `useAppEvent('chat.*')` and
      // `emitChatEvent('chat.message.sent')` both end in `t(` and would be
      // mistaken for translation lookups.
      for (const match of read(file).matchAll(/(?<![\w$])t\(\s*'(chat\.[^']+)'/g)) used.add(match[1]!)
    }
    const missing = [...used].filter((key) => !(key in locale)).sort()
    expect(missing).toEqual([])
  })

  it('keeps every locale at key parity with English', () => {
    const englishKeys = Object.keys(locale).sort()
    const drift = LOCALES.filter((name) => name !== 'en').flatMap((name) => {
      const bundle = JSON.parse(
        fs.readFileSync(path.join(MODULE_ROOT, `i18n/${name}.json`), 'utf8'),
      ) as Record<string, string>
      const keys = Object.keys(bundle).sort()
      return keys.join('\u0000') === englishKeys.join('\u0000') ? [] : [name]
    })
    expect(drift).toEqual([])
  })
})

describe('timestamps', () => {
  /**
   * Every chat timestamp that is *compared* — a message's `created_at` against a
   * participant's `last_read_at`, or against another message's for pagination —
   * must come from the database's clock, because those rows are written by
   * different application instances. A local `new Date()` makes each instance's
   * wall clock the authority, and a fast one can write a message ahead of a read
   * cursor set later by a correctly-clocked instance, which hides that message
   * from the unread count permanently.
   *
   * `lib/clock.ts` owns the one sanctioned way to read it.
   */
  it('never writes a compared timestamp from the local clock', () => {
    const writers = walk(path.join(MODULE_ROOT, 'commands'), (file) => file.endsWith('.ts'))
    const offenders = writers.filter((file) => /(^|[^.\w])new Date\(\)/.test(stripComments(read(file))))
    expect(offenders.map(relative)).toEqual([])
  })

  it('routes the database clock through the one helper', () => {
    const clock = read(path.join(MODULE_ROOT, 'lib/clock.ts'))
    // Truncation is not cosmetic: `timestamptz` holds microseconds, a JS `Date`
    // does not, and a keyset cursor built from a silently-rounded value skips
    // every row in the sub-millisecond window it rounded past.
    expect(clock).toContain("date_trunc('milliseconds', now())")
  })
})

describe('message rendering', () => {
  /**
   * A chat message is user-supplied text from a colleague. Rendering it as
   * markup is how stored XSS gets in, so the module ships no HTML path at all
   * and this guard keeps it that way.
   */
  it('never renders message content as HTML', () => {
    const offenders = sourceFiles.filter((file) => read(file).includes('dangerouslySetInnerHTML'))
    expect(offenders.map(relative)).toEqual([])
  })
})
