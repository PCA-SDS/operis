/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockParseScopedCommandInput = jest.fn()
const mockExecute = jest.fn()
const mockRunRouteMutationGuards = jest.fn()
const mockRunAfterSuccess = jest.fn()

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return { execute: mockExecute }
    return undefined
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args: unknown) => mockResolveOrganizationScope(args)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key })),
}))

jest.mock('@open-mercato/shared/lib/api/scoped', () => ({
  parseScopedCommandInput: jest.fn((...args: unknown[]) => mockParseScopedCommandInput(...args)),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => mockRunRouteMutationGuards(...args),
}))

type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']

beforeAll(async () => {
  postHandler = (await import('../route')).POST
})

const buildRequest = () =>
  new Request('http://localhost/api/staff/leave-requests/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'leave-1' }),
  })

describe('staff leave-requests accept route mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      features: ['staff.leave_requests.manage'],
    })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: 'tenant-1', selectedId: 'org-1', filterIds: ['org-1'] })
    mockParseScopedCommandInput.mockReturnValue({ id: 'leave-1', decisionComment: null })
    mockExecute.mockResolvedValue({ result: { requestId: 'leave-1' }, logEntry: null })
    mockRunRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess: mockRunAfterSuccess })
  })

  it('blocks the decision when the mutation guard denies the request', async () => {
    mockRunRouteMutationGuards.mockResolvedValueOnce({ ok: false, errorStatus: 423, errorBody: { error: 'Locked' } })

    const response = await postHandler(buildRequest())

    expect(response.status).toBe(423)
    await expect(response.json()).resolves.toEqual({ error: 'Locked' })
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(
      expect.objectContaining({
        container: mockContainer,
        input: expect.objectContaining({
          resourceKind: 'staff.leave_request',
          resourceId: 'leave-1',
          operation: 'update',
        }),
      }),
    )
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockRunAfterSuccess).not.toHaveBeenCalled()
  })

  it('runs the guard after-success step once the command succeeds', async () => {
    const response = await postHandler(buildRequest())

    expect(response.status).toBe(200)
    expect(mockExecute).toHaveBeenCalledWith('staff.leave-requests.accept', expect.anything())
    expect(mockRunAfterSuccess).toHaveBeenCalledWith({ resourceId: 'leave-1' })
  })

  it('does not run the guard after-success step when the command fails', async () => {
    mockExecute.mockRejectedValueOnce(new Error('command failed'))

    const response = await postHandler(buildRequest())

    expect(response.status).toBe(400)
    expect(mockRunAfterSuccess).not.toHaveBeenCalled()
  })
})
