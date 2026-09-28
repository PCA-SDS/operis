/** @jest-environment node */

const getAuthFromRequestMock = jest.fn()
const resolveFeatureCheckContextMock = jest.fn()
const service = {
  getBoolConfig: jest.fn(),
  getStringConfig: jest.fn(),
  getJsonConfig: jest.fn(),
  getNumberConfig: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'featureTogglesService') return service
      throw new Error(`Unexpected container resolve: ${name}`)
    },
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: (...args: unknown[]) => resolveFeatureCheckContextMock(...args),
}))

import { GET as checkBoolean } from '../boolean/route'
import { GET as checkString } from '../string/route'
import { GET as checkJson } from '../json/route'
import { GET as checkNumber } from '../number/route'

function request(identifier?: string) {
  const url = new URL('http://localhost/api/feature_toggles/check')
  if (identifier !== undefined) url.searchParams.set('identifier', identifier)
  return new Request(url.toString())
}

describe.each([
  ['boolean', checkBoolean, 'getBoolConfig', true],
  ['string', checkString, 'getStringConfig', 'blue'],
  ['json', checkJson, 'getJsonConfig', { limit: 3 }],
  ['number', checkNumber, 'getNumberConfig', 7],
] as const)('feature toggle %s check route', (_kind, handler, reader, value) => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1' })
    resolveFeatureCheckContextMock.mockResolvedValue({ scope: { tenantId: 'tenant-1' } })
  })

  it('reads the toggle through its own service method', async () => {
    service[reader].mockResolvedValue({ ok: true, value })

    const response = await handler(request('beta-flag'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, value })
    expect(service[reader]).toHaveBeenCalledWith('beta-flag', 'tenant-1')
    for (const other of Object.keys(service) as Array<keyof typeof service>) {
      if (other !== reader) expect(service[other]).not.toHaveBeenCalled()
    }
  })

  it('answers 404 for a missing toggle and 400 for other failures', async () => {
    service[reader].mockResolvedValueOnce({ ok: false, error: { code: 'MISSING_TOGGLE' } })
    expect((await handler(request('beta-flag'))).status).toBe(404)

    service[reader].mockResolvedValueOnce({ ok: false, error: { code: 'TYPE_MISMATCH' } })
    expect((await handler(request('beta-flag'))).status).toBe(400)
  })

  it('rejects a request without an identifier or tenant', async () => {
    const missingIdentifier = await handler(request())
    expect(missingIdentifier.status).toBe(400)
    await expect(missingIdentifier.json()).resolves.toEqual({ error: 'Missing required parameter: identifier' })

    resolveFeatureCheckContextMock.mockResolvedValueOnce({ scope: { tenantId: null } })
    const missingTenant = await handler(request('beta-flag'))
    expect(missingTenant.status).toBe(400)
    await expect(missingTenant.json()).resolves.toEqual({ error: 'Tenant context required. Please select a tenant.' })
    expect(service[reader]).not.toHaveBeenCalled()
  })

  it('answers 401 without an authenticated caller', async () => {
    getAuthFromRequestMock.mockResolvedValueOnce(null)

    const response = await handler(request('beta-flag'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })
})
