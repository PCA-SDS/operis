import fs from 'node:fs'
import path from 'node:path'
import {
  findApiRouteManifestMatch,
  findRouteManifestMatch,
  type ApiRouteManifestEntry,
  type BackendRouteManifestEntry,
  type HttpMethod,
} from '@open-mercato/shared/modules/registry'

/**
 * What happens when the module is switched off.
 *
 * The app resolves pages and APIs by matching a path against the registered
 * manifest, so "chat is disabled" means precisely "its entries are not in the
 * manifest". These tests build the manifest from the module's own files and
 * resolve against it twice — with chat present and with chat removed — so a
 * route that leaked through without the module is caught here.
 */

const CORE_MODULES = path.resolve(__dirname, '../..')
const CHAT_ROOT = path.join(CORE_MODULES, 'chat')

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

/**
 * `backend/chat/[conversationId]/page.tsx` → `/backend/chat/[conversationId]`,
 * and the module-root `backend/page.tsx` → `/backend/chat`.
 */
function backendPattern(moduleId: string, moduleRoot: string, file: string): string {
  const relative = path.relative(path.join(moduleRoot, 'backend'), path.dirname(file))
  if (relative === '') return `/backend/${moduleId}`
  return `/backend/${relative.split(path.sep).join('/')}`
}

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

const chatBackendRoutes = walk(path.join(CHAT_ROOT, 'backend'), (file) => file === 'page.tsx').map(
  (file) => ({ pattern: backendPattern('chat', CHAT_ROOT, file), requireAuth: true }) as BackendRouteManifestEntry,
)

const chatApiRoutes = walk(path.join(CHAT_ROOT, 'api'), (file) => file === 'route.ts').map((file) => ({
  path: apiPath('chat', CHAT_ROOT, file),
  methods: methodsIn(fs.readFileSync(file, 'utf8')),
})) as ApiRouteManifestEntry[]

const messagesBackendRoutes = walk(
  path.join(CORE_MODULES, 'messages', 'backend'),
  (file) => file === 'page.tsx',
).map(
  (file) =>
    ({
      pattern: backendPattern('messages', path.join(CORE_MODULES, 'messages'), file),
      requireAuth: true,
    }) as BackendRouteManifestEntry,
)

const withChat = [...messagesBackendRoutes, ...chatBackendRoutes]
const withoutChat = [...messagesBackendRoutes]

describe('the module is discoverable when enabled', () => {
  it('registers the conversation list', () => {
    expect(findRouteManifestMatch(withChat, '/backend/chat')?.route.pattern).toBe('/backend/chat')
  })

  it('resolves a conversation through its dynamic segment, so deep links work', () => {
    const match = findRouteManifestMatch(withChat, '/backend/chat/3f0d2b1a')
    expect(match?.route.pattern).toBe('/backend/chat/[conversationId]')
    expect(match?.params.conversationId).toBe('3f0d2b1a')
  })

  it('resolves the "message this person" entry point other modules link to', () => {
    const match = findRouteManifestMatch(withChat, '/backend/chat/with/9c1e')
    expect(match?.route.pattern).toBe('/backend/chat/with/[userId]')
    expect(match?.params.userId).toBe('9c1e')
  })

  it('registers the API surface the pages call', () => {
    const endpoints: [HttpMethod, string][] = [
      ['GET', '/api/chat/directory'],
      ['GET', '/api/chat/conversations'],
      ['POST', '/api/chat/conversations'],
      ['GET', '/api/chat/conversations/abc'],
      ['GET', '/api/chat/conversations/abc/messages'],
      ['POST', '/api/chat/conversations/abc/messages'],
      ['POST', '/api/chat/conversations/abc/read'],
      ['GET', '/api/chat/unread-count'],
    ]
    const missing = endpoints.filter(
      ([method, endpoint]) => !findApiRouteManifestMatch(chatApiRoutes, method, endpoint),
    )
    expect(missing).toEqual([])
  })

  /** Read-only routes must not quietly accept writes. */
  it('exposes no write method on the read-only endpoints', () => {
    const forbidden: [HttpMethod, string][] = [
      ['POST', '/api/chat/directory'],
      ['DELETE', '/api/chat/conversations/abc'],
      ['PUT', '/api/chat/conversations/abc/messages'],
      ['POST', '/api/chat/unread-count'],
    ]
    const leaked = forbidden.filter(([method, endpoint]) =>
      findApiRouteManifestMatch(chatApiRoutes, method, endpoint),
    )
    expect(leaked).toEqual([])
  })
})

describe('the module disappears when disabled', () => {
  it('resolves none of its pages', () => {
    const chatPatterns = new Set(chatBackendRoutes.map((route) => route.pattern))
    const leaked = ['/backend/chat', '/backend/chat/abc', '/backend/chat/with/abc'].filter((page) => {
      const match = findRouteManifestMatch(withoutChat, page)
      return match && chatPatterns.has(match.route.pattern)
    })
    expect(leaked).toEqual([])
  })

  /**
   * `/backend/messages` is a neighbour, not a parent. Removing chat must not
   * change how it resolves.
   */
  it('leaves the messages module resolving exactly as before', () => {
    expect(findRouteManifestMatch(withoutChat, '/backend/messages')?.route.pattern).toBe(
      findRouteManifestMatch(withChat, '/backend/messages')?.route.pattern,
    )
  })
})
