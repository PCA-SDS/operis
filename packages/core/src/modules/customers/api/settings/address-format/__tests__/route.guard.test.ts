/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const settingsId = '99999999-9999-4999-8999-999999999999'

const runRouteMutationGuardsMock = jest.fn()
const runAfterSuccessMock = jest.fn()
const commandBusExecuteMock = jest.fn()
const loadCustomerSettingsMock = jest.fn()

const commandBus = { execute: commandBusExecuteMock }
const container = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return commandBus
    if (token === 'em') return {}
    return {}
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: userId, tenantId, orgId: organizationId })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: organizationId,
    filterIds: [organizationId],
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

jest.mock('../../../../commands/settings', () => ({
  loadCustomerSettings: (...args: unknown[]) => loadCustomerSettingsMock(...args),
}))

import { PUT } from '../route'

const putRequest = () =>
  new Request('http://localhost/api/customers/settings/address-format', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ addressFormat: 'street_first' }),
  })

describe('customers settings address-format route mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    runRouteMutationGuardsMock.mockResolvedValue({ ok: true, runAfterSuccess: runAfterSuccessMock })
    runAfterSuccessMock.mockResolvedValue(undefined)
    commandBusExecuteMock.mockResolvedValue({ result: { settingsId, addressFormat: 'street_first' } })
    loadCustomerSettingsMock.mockResolvedValue(null)
  })

  it('runs the guard before save and the after-success hook on success', async () => {
    const response = await PUT(putRequest())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ addressFormat: 'street_first' })
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        container,
        auth: expect.objectContaining({ tenantId, organizationId, userId }),
        input: expect.objectContaining({
          resourceKind: 'customers.settings',
          resourceId: organizationId,
          operation: 'update',
          mutationPayload: expect.objectContaining({ addressFormat: 'street_first' }),
        }),
      }),
    )
    expect(commandBusExecuteMock).toHaveBeenCalledWith('customers.settings.save', expect.anything())
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it('short-circuits save when the guard blocks the mutation', async () => {
    runRouteMutationGuardsMock.mockResolvedValueOnce({ ok: false, errorStatus: 423, errorBody: { error: 'locked' } })

    const response = await PUT(putRequest())

    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({ error: 'locked' })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(runAfterSuccessMock).not.toHaveBeenCalled()
  })
})
