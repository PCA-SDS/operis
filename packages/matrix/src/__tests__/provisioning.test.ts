import { MatrixError } from '../errors'
import { BridgeProvisioningClient } from '../provisioning'

/**
 * The provisioning client, against the shapes mautrix-whatsapp v0.2609.0 was
 * seen to return on 2026-09-29 (see .ai/specs/2026-09-29-whatsapp-bridge.md).
 */

const SECRET = 's'.repeat(64)
const ACCOUNT = '@om_a_0f8a2c1e7b3d4e5f9a6b1c2d3e4f5a6b:operis.local'
const client = new BridgeProvisioningClient({ url: 'http://mautrix-whatsapp:29318', secret: SECRET })

type Call = { url: URL; method: string; headers: Headers; body: unknown; redirect: RequestRedirect | undefined }
let calls: Call[] = []
const originalFetch = global.fetch

function respond(...responses: Array<{ status?: number; body?: unknown }>) {
  let index = 0
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      redirect: init?.redirect,
    })
    const next = responses[Math.min(index, responses.length - 1)]!
    index += 1
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), { status: next.status ?? 200 })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  calls = []
})
afterEach(() => {
  global.fetch = originalFetch
})

const qrStep = (data: string) => ({
  login_id: 'datrao44gnis73c44mp0',
  type: 'display_and_wait',
  step_id: 'fi.mau.whatsapp.login.qr',
  instructions: 'Scan the QR code with the WhatsApp mobile app to log in',
  display_and_wait: { type: 'qr', data },
})

describe('the request itself', () => {
  it('acts as the named user, with the secret only in the Authorization header', async () => {
    respond({ body: { logins: [] } })
    await client.whoami(ACCOUNT)
    const [call] = calls
    expect(call!.url.origin + call!.url.pathname).toBe('http://mautrix-whatsapp:29318/_matrix/provision/v3/whoami')
    expect(call!.url.searchParams.get('user_id')).toBe(ACCOUNT)
    expect(call!.headers.get('authorization')).toBe(`Bearer ${SECRET}`)
    expect(call!.url.toString()).not.toContain(SECRET)
    expect(call!.redirect).toBe('manual')
  })

  it('encodes every path segment it did not write', async () => {
    respond({ body: {} })
    await client.cancelLogin(ACCOUNT, '../../whoami?x=1')
    expect(calls[0]!.url.pathname).toBe('/_matrix/provision/v3/login/cancel/..%2F..%2Fwhoami%3Fx%3D1')
  })

  it.each([
    [401, 'M_UNKNOWN_TOKEN', 'reauth'],
    [403, 'M_FORBIDDEN', 'permanent'],
    [404, 'M_NOT_FOUND', 'permanent'],
    [502, undefined, 'transient'],
    [429, 'M_LIMIT_EXCEEDED', 'transient'],
  ])('classifies %i %s as %s', async (status, errcode, kind) => {
    respond({ status, body: errcode ? { errcode, error: 'nope' } : undefined })
    const error = await client.whoami(ACCOUNT).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(MatrixError)
    expect((error as MatrixError).kind).toBe(kind)
    expect((error as MatrixError).message).not.toContain(SECRET)
  })

  it('refuses to follow a redirect that would carry the secret elsewhere', async () => {
    respond({ status: 302 })
    await expect(client.whoami(ACCOUNT)).rejects.toMatchObject({ kind: 'permanent', status: 302 })
  })

  it('reads a bridge that does not answer as transient', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    await expect(client.whoami(ACCOUNT)).rejects.toMatchObject({ kind: 'transient', status: 0 })
  })
})

describe('login steps', () => {
  it('starts a QR login and reads its code', async () => {
    respond({ body: qrStep('https://wa.me/settings/linked_devices#2@abc') })
    const step = await client.startLogin(ACCOUNT, 'qr')
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url.pathname).toBe('/_matrix/provision/v3/login/start/qr')
    expect(step).toMatchObject({
      kind: 'qr',
      loginId: 'datrao44gnis73c44mp0',
      stepId: 'fi.mau.whatsapp.login.qr',
      data: 'https://wa.me/settings/linked_devices#2@abc',
    })
  })

  it('waits on the step it was given, and returns the next code', async () => {
    respond({ body: qrStep('https://wa.me/settings/linked_devices#2@next') })
    const next = await client.waitForStep(ACCOUNT, { loginId: 'datrao44gnis73c44mp0', stepId: 'fi.mau.whatsapp.login.qr' })
    expect(calls[0]!.url.pathname).toBe(
      '/_matrix/provision/v3/login/step/datrao44gnis73c44mp0/fi.mau.whatsapp.login.qr/display_and_wait',
    )
    expect(next.data).toBe('https://wa.me/settings/linked_devices#2@next')
  })

  it('asks for the phone number, then shows the pairing code', async () => {
    respond(
      {
        body: {
          login_id: 'p1',
          type: 'user_input',
          step_id: 'fi.mau.whatsapp.login.phone',
          user_input: {
            fields: [{ type: 'phone_number', id: 'phone_number', name: 'Phone number', description: 'International format' }],
          },
        },
      },
      {
        body: {
          login_id: 'p1',
          type: 'display_and_wait',
          step_id: 'fi.mau.whatsapp.login.code',
          display_and_wait: { type: 'code', data: 'ABCD-EFGH' },
        },
      },
    )
    const input = await client.startLogin(ACCOUNT, 'phone')
    expect(input).toMatchObject({
      kind: 'input',
      fields: [{ id: 'phone_number', type: 'phone_number', name: 'Phone number', description: 'International format' }],
    })
    const code = await client.submitInput(ACCOUNT, input, { phone_number: '+4915123456789' })
    expect(calls[1]!.body).toEqual({ phone_number: '+4915123456789' })
    expect(code).toMatchObject({ kind: 'code', data: 'ABCD-EFGH' })
  })

  it('reports completion with the new login id', async () => {
    respond({ body: { login_id: 'l', type: 'complete', step_id: 'fi.mau.whatsapp.login.complete', complete: { user_login_id: '4915123456789' } } })
    const step = await client.startLogin(ACCOUNT, 'qr')
    expect(step).toMatchObject({ kind: 'complete', userLoginId: '4915123456789' })
  })

  it.each([
    ['a cookie jar', { login_id: 'l', type: 'cookies', step_id: 's', cookies: { url: 'https://example.com' } }],
    ['a display type it has never seen', { login_id: 'l', type: 'display_and_wait', step_id: 's', display_and_wait: { type: 'hologram' } }],
    ['a QR code without its data', { login_id: 'l', type: 'display_and_wait', step_id: 's', display_and_wait: { type: 'qr' } }],
  ])('calls %s unsupported rather than guessing', async (_label, body) => {
    respond({ body })
    await expect(client.startLogin(ACCOUNT, 'qr')).resolves.toMatchObject({ kind: 'unsupported' })
  })

  it('refuses a step it cannot read at all', async () => {
    respond({ body: { hello: 'world' } })
    await expect(client.startLogin(ACCOUNT, 'qr')).rejects.toBeInstanceOf(MatrixError)
  })
})

describe('accounts', () => {
  it('reads each login with its state and remote profile', async () => {
    respond({
      body: {
        bridge_bot: '@whatsappbot:operis.local',
        logins: [
          {
            id: '4915123456789',
            name: '+49 151 23456789',
            state: { state_event: 'BAD_CREDENTIALS', error: 'wa-logged-out' },
            profile: { phone: '+4915123456789', name: 'Acme GmbH' },
          },
        ],
      },
    })
    await expect(client.whoami(ACCOUNT)).resolves.toEqual({
      botMxid: '@whatsappbot:operis.local',
      logins: [
        {
          id: '4915123456789',
          name: '+49 151 23456789',
          state: 'BAD_CREDENTIALS',
          stateError: 'wa-logged-out',
          phone: '+4915123456789',
          profileName: 'Acme GmbH',
        },
      ],
    })
  })

  it('logs out one login by its id', async () => {
    respond({ body: {} })
    await client.logout(ACCOUNT, '4915123456789')
    expect(calls[0]!.url.pathname).toBe('/_matrix/provision/v3/logout/4915123456789')
  })
})
