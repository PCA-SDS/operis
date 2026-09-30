import {
  BridgeProvisioningClient as ProvisioningExport,
  MatrixClient as MatrixClientExport,
  MatrixError,
  type BridgeLoginStep,
  type MatrixConfig,
} from '@open-mercato/matrix'
import type { ConnectorAccount } from '@open-mercato/core/modules/chat/lib/accountConnector'
import {
  checkAccountHealth,
  createMatrixAccountConnector,
  driveAccountLogin,
  failureReasonOf,
  type LoginDriverDeps,
} from '../lib/accounts'
import { ChatMatrixAccountLogin } from '../data/entities'
import { FakeEntityManager, FakeMatrixClient } from './fakes'

/**
 * The WhatsApp login, driven through the bridge's provisioning API: what
 * starts it, what the page is shown, how a rotating QR code and the outcome
 * reach chat, and that a replaced or cancelled attempt stops at once.
 */

const mockEnqueue = jest.fn()
jest.mock('../lib/queue', () => ({
  ...jest.requireActual('../lib/queue'),
  enqueueAccountLogin: (...args: unknown[]) => mockEnqueue(...args),
}))
jest.mock('@open-mercato/matrix', () => {
  const actual = jest.requireActual('@open-mercato/matrix')
  return { ...actual, MatrixClient: jest.fn(), BridgeProvisioningClient: jest.fn() }
})
const Provisioning = ProvisioningExport as unknown as jest.Mock
const MatrixClient = MatrixClientExport as unknown as jest.Mock

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const ACCOUNT = '0a0b0c0d-1111-4222-8333-444455556666'
const ACCOUNT_MXID = '@om_a_0a0b0c0d111142228333444455556666:operis.local'
const PERSONAL_MXID = '@opp_0a0b0c0d111142228333444455556666:operis.local'

const config: MatrixConfig = {
  baseUrl: 'http://synapse:8008',
  serverName: 'operis.local',
  asToken: 'a'.repeat(64),
  senderLocalpart: 'operis',
  userPrefix: 'om_',
  botLocalpart: 'om_bot',
  bridgeGhosts: [{ network: 'whatsapp', prefix: 'whatsapp_' }],
  doublePuppetAsToken: 'd'.repeat(64),
  // A distinct URL per suite run, so the connector's client cache never hands
  // a previous test's fake back.
  provisioning: { whatsapp: { url: 'http://mautrix-whatsapp:29318', secret: 's'.repeat(64) } },
}

const account: ConnectorAccount = { id: ACCOUNT, network: 'whatsapp', ownerType: 'company', ownerUserId: null, scope }

function step(kind: BridgeLoginStep['kind'], overrides: Partial<BridgeLoginStep> = {}): BridgeLoginStep {
  return {
    loginId: 'process-1',
    stepId: `step-${kind}`,
    instructions: null,
    kind,
    data: kind === 'qr' ? 'https://wa.me/settings/linked_devices#one' : kind === 'code' ? 'ABCD1234' : null,
    fields: kind === 'input' ? [{ id: 'phone_number', type: 'phone_number', name: 'Phone', description: null }] : [],
    userLoginId: kind === 'complete' ? 'wa-login-1' : null,
    rawType: kind,
    ...overrides,
  }
}

type FakeProvisioning = {
  whoami: jest.Mock
  listLogins: jest.Mock
  startLogin: jest.Mock
  submitInput: jest.Mock
  waitForStep: jest.Mock
  cancelLogin: jest.Mock
  logout: jest.Mock
}

let provisioning: FakeProvisioning
let configUrl = 0

function freshConfig(): MatrixConfig {
  configUrl += 1
  return {
    ...config,
    provisioning: { whatsapp: { url: `http://mautrix-whatsapp-${configUrl}:29318`, secret: 's'.repeat(64) } },
  }
}

beforeEach(() => {
  mockEnqueue.mockReset()
  provisioning = {
    whoami: jest.fn(async () => ({ botMxid: '@whatsappbot:operis.local', logins: [] })),
    listLogins: jest.fn(async () => []),
    startLogin: jest.fn(async () => step('qr')),
    submitInput: jest.fn(async () => step('code')),
    waitForStep: jest.fn(),
    cancelLogin: jest.fn(async () => undefined),
    logout: jest.fn(async () => undefined),
  }
  Provisioning.mockReset()
  Provisioning.mockImplementation(() => provisioning)
  MatrixClient.mockReset()
})

describe('startLogin', () => {
  it('registers the account identity once, starts a QR login and hands the waiting to a job', async () => {
    const em = new FakeEntityManager()
    const client = new FakeMatrixClient()
    const connector = createMatrixAccountConnector({ config: freshConfig(), client: client.asClient() })

    const started = await connector.startLogin({ em: em.asEntityManager(), container: {} }, account, 'qr', {})

    expect(client.callsTo('registerUser')[0]!.args).toEqual(['om_a_0a0b0c0d111142228333444455556666'])
    expect(provisioning.startLogin).toHaveBeenCalledWith(ACCOUNT_MXID, 'qr')
    expect(started).toMatchObject({ kind: 'step', step: { flow: 'qr', kind: 'qr', data: 'https://wa.me/settings/linked_devices#one' } })
    const [row] = em.rowsOf(ChatMatrixAccountLogin)
    const attemptId = (started as { step: { attemptId: string } }).step.attemptId
    expect(row).toMatchObject({ accountId: ACCOUNT, mxid: ACCOUNT_MXID, ownerType: 'company' })
    expect(row!.pendingLogin).toMatchObject({ attemptId, processId: 'process-1', stepId: 'step-qr', flow: 'qr' })
    expect(mockEnqueue).toHaveBeenCalledWith({ ...scope, accountId: ACCOUNT, attemptId })
    // The bridge's process id stays server-side.
    expect(JSON.stringify(started)).not.toContain('process-1')
  })

  it('types the phone number into the bridge and shows the pairing code', async () => {
    const em = new FakeEntityManager()
    provisioning.startLogin.mockResolvedValueOnce(step('input'))
    const connector = createMatrixAccountConnector({ config: freshConfig(), client: new FakeMatrixClient().asClient() })

    const started = await connector.startLogin({ em: em.asEntityManager(), container: {} }, account, 'phone', {
      phoneNumber: '+4915123456789',
    })

    expect(provisioning.startLogin).toHaveBeenCalledWith(ACCOUNT_MXID, 'phone')
    expect(provisioning.submitInput.mock.calls[0]![2]).toEqual({ phone_number: '+4915123456789' })
    expect(started).toMatchObject({ kind: 'step', step: { kind: 'code', data: 'ABCD1234' } })
  })

  it('logs the identity out everywhere first, so one account is one number', async () => {
    const em = new FakeEntityManager()
    provisioning.whoami.mockResolvedValueOnce({
      botMxid: null,
      logins: [{ id: 'old-login', name: null, state: 'CONNECTED', stateError: null, phone: '+1', profileName: null }],
    })
    const connector = createMatrixAccountConnector({ config: freshConfig(), client: new FakeMatrixClient().asClient() })
    await connector.startLogin({ em: em.asEntityManager(), container: {} }, account, 'qr', {})
    expect(provisioning.logout).toHaveBeenCalledWith(ACCOUNT_MXID, 'old-login')
  })

  it('cancels and reports a step it cannot show', async () => {
    const em = new FakeEntityManager()
    provisioning.startLogin.mockResolvedValueOnce(step('emoji', { data: '🐱🐶' }))
    const connector = createMatrixAccountConnector({ config: freshConfig(), client: new FakeMatrixClient().asClient() })
    await expect(
      connector.startLogin({ em: em.asEntityManager(), container: {} }, account, 'qr', {}),
    ).resolves.toEqual({ kind: 'failed', reason: 'unsupported_step' })
    expect(provisioning.cancelLogin).toHaveBeenCalledWith(ACCOUNT_MXID, 'process-1')
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('reports what the bridge refused, and throws only when it cannot be reached', async () => {
    const em = new FakeEntityManager()
    const connector = createMatrixAccountConnector({ config: freshConfig(), client: new FakeMatrixClient().asClient() })
    provisioning.startLogin.mockRejectedValueOnce(
      new MatrixError({ message: 'bad number', kind: 'permanent', status: 400, errcode: 'FI.MAU.WHATSAPP.PHONE_NUMBER_TOO_SHORT' }),
    )
    await expect(
      connector.startLogin({ em: em.asEntityManager(), container: {} }, account, 'qr', {}),
    ).resolves.toEqual({ kind: 'failed', reason: 'invalid_phone_number' })

    provisioning.startLogin.mockRejectedValueOnce(new MatrixError({ message: 'down', kind: 'transient', status: 0 }))
    await expect(
      connector.startLogin({ em: em.asEntityManager(), container: {} }, account, 'qr', {}),
    ).rejects.toBeInstanceOf(MatrixError)
  })

  it('uses the personal identity, through the double-puppet client, for a personal account', async () => {
    const em = new FakeEntityManager()
    const accounts = new FakeMatrixClient()
    MatrixClient.mockImplementation(() => accounts)
    const connector = createMatrixAccountConnector({ config: freshConfig(), client: new FakeMatrixClient().asClient() })
    await connector.startLogin(
      { em: em.asEntityManager(), container: {} },
      { ...account, ownerType: 'user', ownerUserId: '77777777-7777-4777-8777-777777777777' },
      'qr',
      {},
    )
    expect(MatrixClient).toHaveBeenCalledWith(expect.anything(), { scope: 'accounts' })
    expect(accounts.callsTo('registerUser')[0]!.args).toEqual(['opp_0a0b0c0d111142228333444455556666'])
    expect(provisioning.startLogin).toHaveBeenCalledWith(PERSONAL_MXID, 'qr')
  })
})

describe('driveAccountLogin', () => {
  function driver(em: FakeEntityManager, applied: (commandId: string) => boolean = () => true) {
    const reports: Array<{ commandId: string; input: Record<string, unknown> }> = []
    const deps: LoginDriverDeps = {
      em: em.asEntityManager(),
      config: freshConfig(),
      client: new FakeMatrixClient().asClient(),
      container: {} as LoginDriverDeps['container'],
      commandBus: {
        execute: async (commandId: string, args: { input: Record<string, unknown> }) => {
          reports.push({ commandId, input: args.input })
          return { result: { applied: applied(commandId) } }
        },
      } as unknown as LoginDriverDeps['commandBus'],
    }
    return { deps, reports }
  }

  function seedPending(em: FakeEntityManager, attemptId = 'attempt-1') {
    em.seed(ChatMatrixAccountLogin, {
      id: 'login-row',
      ...scope,
      accountId: ACCOUNT,
      ownerType: 'company',
      network: 'whatsapp',
      mxid: ACCOUNT_MXID,
      registeredAt: new Date(),
      pendingLogin: { attemptId, flow: 'qr', processId: 'process-1', stepId: 'step-qr', startedAt: '2026-09-29T12:00:00Z' },
    })
  }

  it('passes each rotated code to chat, then the connected number', async () => {
    const em = new FakeEntityManager()
    seedPending(em)
    provisioning.waitForStep
      .mockResolvedValueOnce(step('qr', { stepId: 'step-qr-2', data: 'https://wa.me/settings/linked_devices#two' }))
      .mockResolvedValueOnce(step('complete'))
    provisioning.whoami.mockResolvedValue({
      botMxid: null,
      logins: [{ id: 'wa-login-1', name: 'Acme', state: 'CONNECTED', stateError: null, phone: '+4915123456789', profileName: 'Acme GmbH' }],
    })
    const { deps, reports } = driver(em)

    await driveAccountLogin(deps, { ...scope, accountId: ACCOUNT, attemptId: 'attempt-1' })

    expect(reports.map((report) => report.commandId)).toEqual(['chat.accounts.recordLoginStep', 'chat.accounts.markState'])
    expect(reports[0]!.input.step).toEqual({
      flow: 'qr',
      kind: 'qr',
      data: 'https://wa.me/settings/linked_devices#two',
      attemptId: 'attempt-1',
    })
    expect(reports[1]!.input).toMatchObject({ status: 'connected', attemptId: 'attempt-1', remoteHandle: '+4915123456789' })
    const [row] = em.rowsOf(ChatMatrixAccountLogin)
    expect(row).toMatchObject({ pendingLogin: null, userLoginId: 'wa-login-1' })
    // The second wait resumed from the step the first one returned.
    expect(provisioning.waitForStep.mock.calls[1]![1]).toEqual({ loginId: 'process-1', stepId: 'step-qr-2' })
  })

  it('stops at once when its attempt was replaced', async () => {
    const em = new FakeEntityManager()
    seedPending(em, 'attempt-2')
    const { deps, reports } = driver(em)
    await driveAccountLogin(deps, { ...scope, accountId: ACCOUNT, attemptId: 'attempt-1' })
    expect(provisioning.waitForStep).not.toHaveBeenCalled()
    expect(reports).toEqual([])
  })

  it('lets the bridge go when chat has moved on', async () => {
    const em = new FakeEntityManager()
    seedPending(em)
    provisioning.waitForStep.mockResolvedValueOnce(step('qr', { stepId: 'step-qr-2' }))
    const { deps } = driver(em, () => false)
    await driveAccountLogin(deps, { ...scope, accountId: ACCOUNT, attemptId: 'attempt-1' })
    expect(provisioning.cancelLogin).toHaveBeenCalledWith(ACCOUNT_MXID, 'process-1')
    expect(em.rowsOf(ChatMatrixAccountLogin)[0]!.pendingLogin).toBeNull()
  })

  it('reports an expired code as a timeout', async () => {
    const em = new FakeEntityManager()
    seedPending(em)
    provisioning.waitForStep.mockRejectedValueOnce(
      new MatrixError({ message: 'timed out', kind: 'permanent', status: 400, errcode: 'FI.MAU.WHATSAPP.LOGIN_TIMEOUT' }),
    )
    const { deps, reports } = driver(em)
    await driveAccountLogin(deps, { ...scope, accountId: ACCOUNT, attemptId: 'attempt-1' })
    expect(reports).toEqual([
      {
        commandId: 'chat.accounts.markState',
        input: { ...scope, accountId: ACCOUNT, attemptId: 'attempt-1', status: 'failed', reason: 'timeout' },
      },
    ])
  })

  it('undoes a link that finished after it was cancelled', async () => {
    const em = new FakeEntityManager()
    seedPending(em)
    provisioning.waitForStep.mockResolvedValueOnce(step('complete'))
    provisioning.whoami.mockResolvedValue({
      botMxid: null,
      logins: [{ id: 'wa-login-1', name: null, state: 'CONNECTED', stateError: null, phone: '+1', profileName: null }],
    })
    const { deps } = driver(em, (commandId) => commandId !== 'chat.accounts.markState')
    await driveAccountLogin(deps, { ...scope, accountId: ACCOUNT, attemptId: 'attempt-1' })
    expect(provisioning.logout).toHaveBeenCalledWith(ACCOUNT_MXID, 'wa-login-1')
  })
})

describe('checkAccountHealth', () => {
  it.each([
    ['CONNECTED', 'connected', undefined],
    ['TRANSIENT_DISCONNECT', 'connected', undefined],
    ['BAD_CREDENTIALS', 'disconnected', 'bad_credentials'],
    ['LOGGED_OUT', 'disconnected', 'logged_out'],
  ])('reads %s as %s', async (bridgeState, status, reason) => {
    const em = new FakeEntityManager()
    em.seed(ChatMatrixAccountLogin, {
      ...scope,
      accountId: ACCOUNT,
      ownerType: 'company',
      network: 'whatsapp',
      mxid: ACCOUNT_MXID,
      registeredAt: new Date(),
      pendingLogin: null,
      userLoginId: 'wa-login-1',
    })
    provisioning.whoami.mockResolvedValue({
      botMxid: null,
      logins: [{ id: 'wa-login-1', name: null, state: bridgeState, stateError: null, phone: '+1', profileName: null }],
    })
    const reports: Array<Record<string, unknown>> = []
    await checkAccountHealth(
      {
        em: em.asEntityManager(),
        config: freshConfig(),
        client: new FakeMatrixClient().asClient(),
        container: {} as LoginDriverDeps['container'],
        commandBus: {
          execute: async (_id: string, args: { input: Record<string, unknown> }) => {
            reports.push(args.input)
            return { result: { applied: true } }
          },
        } as unknown as LoginDriverDeps['commandBus'],
      },
      scope,
    )
    expect(reports[0]).toMatchObject({ accountId: ACCOUNT, status, ...(reason ? { reason } : {}) })
    expect(reports[0]).not.toHaveProperty('attemptId')
  })

  it('reports nothing for a state it cannot read as up or down', async () => {
    const em = new FakeEntityManager()
    em.seed(ChatMatrixAccountLogin, {
      ...scope,
      accountId: ACCOUNT,
      ownerType: 'company',
      network: 'whatsapp',
      mxid: ACCOUNT_MXID,
      registeredAt: new Date(),
      pendingLogin: null,
    })
    provisioning.whoami.mockResolvedValue({
      botMxid: null,
      logins: [{ id: 'x', name: null, state: 'UNKNOWN_ERROR', stateError: 'eh', phone: null, profileName: null }],
    })
    const execute = jest.fn()
    await checkAccountHealth(
      {
        em: em.asEntityManager(),
        config: freshConfig(),
        client: new FakeMatrixClient().asClient(),
        container: {} as LoginDriverDeps['container'],
        commandBus: { execute } as unknown as LoginDriverDeps['commandBus'],
      },
      scope,
    )
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('failureReasonOf', () => {
  it.each([
    ['FI.MAU.WHATSAPP.LOGIN_TIMEOUT', 400, 'timeout'],
    ['FI.MAU.BRIDGE.LOGIN_TIMED_OUT', 400, 'timeout'],
    ['FI.MAU.BRIDGE.LOGIN_CANCELLED', 400, 'cancelled'],
    ['FI.MAU.WHATSAPP.PHONE_NUMBER_NOT_INTERNATIONAL', 400, 'invalid_phone_number'],
    ['FI.MAU.WHATSAPP.RATE_LIMITED', 429, 'rate_limited'],
    [undefined, 502, 'bridge_unreachable'],
    ['FI.MAU.WHATSAPP.PAIR_ERROR', 500, 'error'],
  ])('%s (%i) → %s', (errcode, status, reason) => {
    expect(failureReasonOf(new MatrixError({ message: 'x', kind: 'permanent', status, errcode }))).toBe(reason)
  })
})
