import { MatrixClient } from '../client'
import { matrixConfigFromEnv, resolveMatrixConfig } from '../config'
import { MatrixConfigError, MatrixNamespaceError } from '../errors'
import {
  PERSONAL_ACCOUNT_PREFIX,
  accountFromMxid,
  accountMxid,
  assertAccountIdentity,
  localpartForAccount,
  operisUserIdFromMxid,
} from '../identity'

/**
 * Account identities: the Matrix users that own a WhatsApp login. Company ones
 * live inside the Operis namespace so their rooms are pushed to Operis; personal
 * ones live outside it so an employee's private chats never are.
 */

const ACCOUNT = '0f8a2c1e-7b3d-4e5f-9a6b-1c2d3e4f5a6b'
const HEX = '0f8a2c1e7b3d4e5f9a6b1c2d3e4f5a6b'
const valid = {
  homeserverUrl: 'http://127.0.0.1:8008',
  serverName: 'operis.local',
  asToken: 'a'.repeat(64),
}
const config = resolveMatrixConfig({ ...valid, doublePuppetAsToken: 'd'.repeat(64) })

describe('account identities', () => {
  it('puts a company account inside the Operis namespace and a personal one outside it', () => {
    expect(localpartForAccount(config, ACCOUNT, 'company')).toBe(`om_a_${HEX}`)
    expect(localpartForAccount(config, ACCOUNT, 'user')).toBe(`${PERSONAL_ACCOUNT_PREFIX}${HEX}`)
    expect(localpartForAccount(config, ACCOUNT, 'user').startsWith(config.userPrefix)).toBe(false)
  })

  it.each(['company', 'user'] as const)('round-trips a %s account through its mxid', (owner) => {
    expect(accountFromMxid(config, accountMxid(config, ACCOUNT, owner))).toEqual({ accountId: ACCOUNT, owner })
  })

  it.each([
    ['a colleague', `@om_u_${HEX}:operis.local`],
    ['the bot', '@om_bot:operis.local'],
    ['an account on another server', `@om_a_${HEX}:elsewhere.example`],
    ['a malformed account', '@om_a_not-hex:operis.local'],
    ['a WhatsApp contact', '@whatsapp_4915123456789:operis.local'],
  ])('does not read %s as an account', (_label, mxid) => {
    expect(accountFromMxid(config, mxid)).toBeNull()
  })

  it('is never mistaken for a colleague', () => {
    expect(operisUserIdFromMxid(config, accountMxid(config, ACCOUNT, 'company'))).toBeNull()
  })

  it('refuses to derive an identity from something that is not a uuid', () => {
    expect(() => localpartForAccount(config, 'account-1', 'company')).toThrow(MatrixNamespaceError)
  })

  it('lets the double-puppet gate pass accounts and nobody else', () => {
    expect(assertAccountIdentity(config, accountMxid(config, ACCOUNT, 'user'))).toContain(HEX)
    expect(() => assertAccountIdentity(config, `@om_u_${HEX}:operis.local`)).toThrow(MatrixNamespaceError)
  })
})

describe('an accounts-scoped client', () => {
  const originalFetch = global.fetch
  let seen: Array<{ url: URL; authorization: string | null }> = []

  beforeEach(() => {
    seen = []
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: new URL(String(input)),
        authorization: new Headers(init?.headers).get('authorization'),
      })
      return new Response(JSON.stringify({ user_id: 'x' }), { status: 200 })
    }) as unknown as typeof fetch
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('needs the double-puppet token', () => {
    expect(() => new MatrixClient(resolveMatrixConfig(valid), { scope: 'accounts' })).toThrow(MatrixConfigError)
  })

  it('acts as an account with the double-puppet token', async () => {
    const client = new MatrixClient(config, { scope: 'accounts' })
    await client.whoami(accountMxid(config, ACCOUNT, 'user'))
    expect(seen[0]!.authorization).toBe(`Bearer ${'d'.repeat(64)}`)
    expect(seen[0]!.url.searchParams.get('user_id')).toBe(accountMxid(config, ACCOUNT, 'user'))
  })

  it('refuses to act as a colleague before anything is sent', async () => {
    const client = new MatrixClient(config, { scope: 'accounts' })
    await expect(client.whoami(`@om_u_${HEX}:operis.local`)).rejects.toBeInstanceOf(MatrixNamespaceError)
    expect(seen).toHaveLength(0)
  })

  it('leaves the default client exactly as it was: the appservice token, the Operis namespace', async () => {
    const client = new MatrixClient(config)
    await client.whoami(`@om_u_${HEX}:operis.local`)
    expect(seen[0]!.authorization).toBe(`Bearer ${'a'.repeat(64)}`)
    await expect(client.whoami(accountMxid(config, ACCOUNT, 'user'))).rejects.toBeInstanceOf(MatrixNamespaceError)
  })
})

describe('bridge provisioning config', () => {
  const env = (extra: Record<string, string>) =>
    ({
      OM_MATRIX_HOMESERVER_URL: valid.homeserverUrl,
      OM_MATRIX_SERVER_NAME: valid.serverName,
      OM_MATRIX_AS_TOKEN: valid.asToken,
      OM_MATRIX_BRIDGE_GHOSTS: 'whatsapp=whatsapp_',
      ...extra,
    }) as NodeJS.ProcessEnv

  it('arrives from OM_MATRIX_WHATSAPP_PROVISIONING_*', () => {
    const loaded = matrixConfigFromEnv(
      env({
        OM_MATRIX_WHATSAPP_PROVISIONING_URL: 'http://mautrix-whatsapp:29318/',
        OM_MATRIX_WHATSAPP_PROVISIONING_SECRET: 's'.repeat(64),
        OM_MATRIX_DOUBLE_PUPPET_AS_TOKEN: 'd'.repeat(64),
      }),
    )
    expect(loaded?.provisioning).toEqual({ whatsapp: { url: 'http://mautrix-whatsapp:29318', secret: 's'.repeat(64) } })
    expect(loaded?.doublePuppetAsToken).toBe('d'.repeat(64))
  })

  it('has none unless configured', () => {
    expect(matrixConfigFromEnv(env({}))?.provisioning).toEqual({})
  })

  it.each([
    ['a URL without a secret', { OM_MATRIX_WHATSAPP_PROVISIONING_URL: 'http://mautrix-whatsapp:29318' }],
    ['a secret without a URL', { OM_MATRIX_WHATSAPP_PROVISIONING_SECRET: 's'.repeat(64) }],
    [
      'a short secret',
      { OM_MATRIX_WHATSAPP_PROVISIONING_URL: 'http://mautrix-whatsapp:29318', OM_MATRIX_WHATSAPP_PROVISIONING_SECRET: 'short' },
    ],
    [
      'plain http to a public host',
      { OM_MATRIX_WHATSAPP_PROVISIONING_URL: 'http://bridge.example.com', OM_MATRIX_WHATSAPP_PROVISIONING_SECRET: 's'.repeat(64) },
    ],
  ])('refuses %s', (_label, extra) => {
    expect(() => matrixConfigFromEnv(env(extra))).toThrow(MatrixConfigError)
  })

  it('refuses a bridge whose contacts would not be recognised', () => {
    expect(() =>
      resolveMatrixConfig({
        ...valid,
        provisioning: { whatsapp: { url: 'http://mautrix-whatsapp:29318', secret: 's'.repeat(64) } },
      }),
    ).toThrow(MatrixConfigError)
  })

  it('refuses a ghost prefix that reaches into personal account identities', () => {
    expect(() => resolveMatrixConfig({ ...valid, bridgeGhosts: [{ network: 'whatsapp', prefix: 'op' }] })).toThrow(
      MatrixConfigError,
    )
  })
})
