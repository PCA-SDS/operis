import { NextRequest } from 'next/server'
import type { ApiRouteManifestEntry, HttpMethod } from '@open-mercato/shared/modules/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

// The default-off runtime bridge is mocked so we can assert dispatcher wiring
// 5xx + recordHttpDuration on every completed request) without a real backend.
// The semconv histogram shape recordHttpDuration emits is covered by the
// telemetry package's own nextjs tests; here we only verify the dispatcher
// calls it with the right method/route/status.
const mockReportError = jest.fn()
const mockRecordHttpDuration = jest.fn()
const mockLifecycleEmit = jest.fn().mockResolvedValue(undefined)
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({
    reportError: mockReportError,
    recordHttpDuration: mockRecordHttpDuration,
  }),
}))

// The dispatcher bootstraps through the API-only entry point; mocking `@/bootstrap`
// alone would let the real module graph (and `@open-mercato/ui`'s ESM deps) load here.
jest.mock('@/bootstrap-api', () => ({
  bootstrap: jest.fn(),
  isBootstrapped: jest.fn(() => true),
}))

jest.mock('@/bootstrap', () => ({
  bootstrap: jest.fn(),
  isBootstrapped: jest.fn(() => true),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  resolveAuthFromRequestDetailed: jest.fn(async () => ({ auth: null, status: 'unauthenticated' })),
  attachTrustedAuthContext: jest.fn((request: Request) => request),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => null }),
}))

jest.mock('@open-mercato/shared/modules/events', () => ({
  getGlobalEventBus: () => ({ emit: mockLifecycleEmit }),
}))

// Three public routes: a 200, a 5xx (throws), and a returned 4xx.
const okHandler = async () => new Response('ok', { status: 200 })
const throwingHandler = async () => {
  throw new Error('boom')
}
const badRequestHandler = async () => new Response('bad', { status: 400 })
const crudErrorHandler = async () => {
  throw new CrudHttpError(400, { error: 'Organization context is required', code: 'organization_scope_required' })
}

function getMockedApiRoutes(): ApiRouteManifestEntry[] {
  const publicMeta = { metadata: { GET: { requireAuth: false } } }
  return [
    { moduleId: 'tele', kind: 'route-file', path: '/tele/ok', methods: ['GET'], load: async () => ({ GET: okHandler, ...publicMeta }) },
    { moduleId: 'tele', kind: 'route-file', path: '/tele/boom', methods: ['GET'], load: async () => ({ GET: throwingHandler, ...publicMeta }) },
    { moduleId: 'tele', kind: 'route-file', path: '/tele/bad', methods: ['GET'], load: async () => ({ GET: badRequestHandler, ...publicMeta }) },
    { moduleId: 'tele', kind: 'route-file', path: '/tele/crud-error', methods: ['GET'], load: async () => ({ GET: crudErrorHandler, ...publicMeta }) },
  ]
}

// Runtime registration goes through the request-prefix shard facades; the legacy
// manifests stay mocked because they remain the public compatibility surface.
jest.mock('@/.mercato/generated/api-route-shards.generated', () => ({ apiRouteFacades: getMockedApiRoutes() }))
jest.mock('@/.mercato/generated/api-routes.generated', () => ({ apiRoutes: getMockedApiRoutes() }))
jest.mock('@/.mercato/generated/backend-routes.generated', () => ({ backendRoutes: [] }))

jest.mock('@open-mercato/shared/modules/registry', () => {
  const actual = jest.requireActual('@open-mercato/shared/modules/registry')
  return {
    ...actual,
    registerBackendRouteManifests: jest.fn(),
    findApiRouteManifestMatch: jest.fn((_routes: ApiRouteManifestEntry[], method: HttpMethod, pathname: string) => {
      const route = getMockedApiRoutes().find((entry) => entry.path === pathname && entry.methods.includes(method))
      return route ? { route, params: {} } : undefined
    }),
  }
})

// resolveTranslations() runs early in the dispatcher and needs registered modules.
import { registerModules } from '@open-mercato/shared/lib/i18n/server'
registerModules([{ id: 'tele' }] as never)

import { GET } from '@/app/api/[...slug]/route'

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost/api${path}`, { method: 'GET' })
}

beforeEach(() => {
  mockReportError.mockClear()
  mockRecordHttpDuration.mockClear()
  mockLifecycleEmit.mockClear()
})

describe('API dispatcher telemetry wiring', () => {
  it('reports a 5xx exception and emits a 500 duration metric, then re-throws', async () => {
    await expect(GET(request('/tele/boom'), { params: Promise.resolve({ slug: ['tele', 'boom'] }) })).rejects.toThrow('boom')

    expect(mockReportError).toHaveBeenCalledTimes(1)
    const [error, ctx] = mockReportError.mock.calls[0]
    expect((error as Error).message).toBe('boom')
    expect(ctx?.attributes).toMatchObject({
      'http.request.method': 'GET',
      'http.route': '/tele/boom',
      'http.response.status_code': 500,
    })

    expect(mockRecordHttpDuration).toHaveBeenCalledTimes(1)
    const [method, route, status, startedAt] = mockRecordHttpDuration.mock.calls[0]
    expect(method).toBe('GET')
    expect(route).toBe('/tele/boom')
    expect(status).toBe(500)
    expect(typeof startedAt).toBe('number')
  })

  it('does NOT report on a successful response, and emits the response status', async () => {
    const res = await GET(request('/tele/ok'), { params: Promise.resolve({ slug: ['tele', 'ok'] }) })
    expect(res.status).toBe(200)
    expect(mockReportError).not.toHaveBeenCalled()

    expect(mockRecordHttpDuration).toHaveBeenCalledTimes(1)
    expect(mockRecordHttpDuration).toHaveBeenCalledWith('GET', '/tele/ok', 200, expect.any(Number))
  })

  it('does NOT report a returned 4xx (only unhandled throws are 5xx)', async () => {
    const res = await GET(request('/tele/bad'), { params: Promise.resolve({ slug: ['tele', 'bad'] }) })
    expect(res.status).toBe(400)
    expect(mockReportError).not.toHaveBeenCalled()

    expect(mockRecordHttpDuration).toHaveBeenCalledTimes(1)
    expect(mockRecordHttpDuration).toHaveBeenCalledWith('GET', '/tele/bad', 400, expect.any(Number))
  })

  it('serializes a handler-thrown CrudHttpError and records it as a completed 4xx request', async () => {
    const res = await GET(request('/tele/crud-error'), { params: Promise.resolve({ slug: ['tele', 'crud-error'] }) })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: 'Organization context is required',
      code: 'organization_scope_required',
    })
    expect(mockReportError).not.toHaveBeenCalled()
    expect(mockRecordHttpDuration).toHaveBeenCalledWith('GET', '/tele/crud-error', 400, expect.any(Number))
    expect(mockLifecycleEmit).toHaveBeenCalledWith(
      'application.request.completed',
      expect.objectContaining({ status: 400 }),
    )
  })
})
