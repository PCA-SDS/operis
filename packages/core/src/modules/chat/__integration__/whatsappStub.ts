import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'

/**
 * A stand-in for mautrix-whatsapp's provisioning API, for the WhatsApp tests.
 *
 * The real bridge cannot finish a login without a phone scanning a code, so
 * the account tests talk to this instead: the same routes, bodies and error
 * codes the bridge answers with (verified against v0.2609.0), with the test
 * deciding when a code rotates and when the phone "scans". The app is pointed
 * at it by `OM_MATRIX_WHATSAPP_PROVISIONING_URL`; everything Matrix-side still
 * runs against a real homeserver.
 */

type Json = Record<string, unknown>
type Pending = { resolve: (status: number, body: Json) => void; timer: NodeJS.Timeout }
type Login = { processId: string; userId: string; flow: string; step: number }
type UserState = { logins: Array<{ id: string; state: string; phone: string; name: string }> }

export type StubCall = { method: string; path: string; userId: string | null }

export type WhatsAppStub = {
  url: string
  calls: StubCall[]
  /** Hand the next QR code to whoever is waiting on this identity's login. */
  rotate(userId: string): boolean
  /** The phone "scans": the login completes with this profile. */
  complete(userId: string, profile?: { phone?: string; name?: string }): boolean
  /** The login ends with a bridge error code, e.g. `FI.MAU.WHATSAPP.LOGIN_TIMEOUT`. */
  fail(userId: string, errcode: string): boolean
  /** What `whoami` reports for an identity's logins from now on (`LOGGED_OUT`, `BAD_CREDENTIALS`, …). */
  setState(userId: string, state: string): void
  loginsOf(userId: string): string[]
  close(): Promise<void>
}

const WAIT_LIMIT_MS = 90_000

export async function startWhatsAppStub(options: { url: string; secret: string }): Promise<WhatsAppStub> {
  const target = new URL(options.url)
  const users = new Map<string, UserState>()
  const logins = new Map<string, Login>()
  const waiting = new Map<string, Pending>()
  const calls: StubCall[] = []
  let codes = 0

  const userState = (userId: string): UserState => {
    let state = users.get(userId)
    if (!state) {
      state = { logins: [] }
      users.set(userId, state)
    }
    return state
  }

  const qrStep = (login: Login): Json => {
    login.step += 1
    codes += 1
    return {
      login_id: login.processId,
      type: 'display_and_wait',
      step_id: `fi.mau.whatsapp.login.qr.${login.step}`,
      instructions: 'Scan the QR code on your WhatsApp mobile app',
      display_and_wait: { type: 'qr', data: `https://wa.me/settings/linked_devices#stub-${codes}` },
    }
  }

  const reply = (res: ServerResponse, status: number, body: Json) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  const error = (errcode: string, message: string): Json => ({ errcode, error: message })

  const readBody = async (req: IncomingMessage): Promise<Json> => {
    let raw = ''
    for await (const chunk of req) raw += String(chunk)
    try {
      return raw ? (JSON.parse(raw) as Json) : {}
    } catch {
      return {}
    }
  }

  const settle = (processId: string, status: number, body: Json): boolean => {
    const pending = waiting.get(processId)
    if (!pending) return false
    waiting.delete(processId)
    clearTimeout(pending.timer)
    pending.resolve(status, body)
    return true
  }

  const loginOf = (userId: string): Login | null =>
    [...logins.values()].find((login) => login.userId === userId) ?? null

  /**
   * The login somebody is blocked on right now. A test that says "the phone
   * scanned" before Operis has started waiting must be told no, and must change
   * nothing — otherwise the wait that follows finds its login gone.
   */
  const waitingLoginOf = (userId: string): Login | null => {
    const login = loginOf(userId)
    return login && waiting.has(login.processId) ? login : null
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub')
    const userId = url.searchParams.get('user_id')
    calls.push({ method: req.method ?? 'GET', path: url.pathname, userId })

    if (req.headers.authorization !== `Bearer ${options.secret}`) {
      return reply(res, 401, error('M_UNKNOWN_TOKEN', 'Unknown token'))
    }
    if (!userId) return reply(res, 400, error('M_MISSING_PARAM', 'user_id is required'))

    const path = url.pathname.replace(/^\/_matrix\/provision\/v3/, '')
    const segments = path.split('/').filter(Boolean).map(decodeURIComponent)
    const body = req.method === 'POST' ? await readBody(req) : {}

    if (req.method === 'GET' && path === '/whoami') {
      return reply(res, 200, {
        bridge_bot: '@whatsappbot:stub',
        logins: userState(userId).logins.map((login) => ({
          id: login.id,
          name: login.name,
          state: { state_event: login.state },
          profile: { phone: login.phone, name: login.name },
        })),
      })
    }
    if (req.method === 'GET' && path === '/logins') {
      return reply(res, 200, { login_ids: userState(userId).logins.map((login) => login.id) })
    }
    if (req.method === 'POST' && segments[0] === 'login' && segments[1] === 'start') {
      const flow = segments[2] ?? ''
      const login: Login = { processId: randomUUID(), userId, flow, step: 0 }
      logins.set(login.processId, login)
      if (flow === 'qr') return reply(res, 200, qrStep(login))
      if (flow === 'phone') {
        return reply(res, 200, {
          login_id: login.processId,
          type: 'user_input',
          step_id: 'fi.mau.whatsapp.login.phone',
          user_input: {
            fields: [{ type: 'phone_number', id: 'phone_number', name: 'Phone number', description: 'Your WhatsApp phone number in international format' }],
          },
        })
      }
      logins.delete(login.processId)
      return reply(res, 404, error('M_NOT_FOUND', 'Unknown login flow'))
    }
    if (req.method === 'POST' && segments[0] === 'login' && segments[1] === 'step') {
      const login = logins.get(segments[2] ?? '')
      if (!login || login.userId !== userId) return reply(res, 404, error('M_NOT_FOUND', 'Login not found'))
      const kind = segments[4]
      if (kind === 'user_input') {
        const phone = String(body.phone_number ?? '')
        if (!/^\+\d{7,15}$/.test(phone)) {
          return reply(res, 400, error('FI.MAU.WHATSAPP.PHONE_NUMBER_NOT_INTERNATIONAL', 'Phone number must be in international format'))
        }
        login.step += 1
        return reply(res, 200, {
          login_id: login.processId,
          type: 'display_and_wait',
          step_id: 'fi.mau.whatsapp.login.code',
          display_and_wait: { type: 'code', data: 'STUB1234' },
        })
      }
      if (kind === 'display_and_wait') {
        // Held open until the test rotates, completes or fails it — the way
        // the bridge holds it until WhatsApp says something.
        const timer = setTimeout(
          () => settle(login.processId, 400, error('FI.MAU.WHATSAPP.LOGIN_TIMEOUT', 'Login timed out')),
          WAIT_LIMIT_MS,
        )
        waiting.set(login.processId, { resolve: (status, reply_) => reply(res, status, reply_), timer })
        // The response's `close`, not the request's: a request stream closes as
        // soon as its body has been read, which would end every wait at once.
        res.on('close', () => {
          if (!res.writableEnded) settle(login.processId, 499, error('M_UNKNOWN', 'client went away'))
        })
        return
      }
      return reply(res, 400, error('M_UNRECOGNIZED', 'Unknown step type'))
    }
    if (req.method === 'POST' && segments[0] === 'login' && segments[1] === 'cancel') {
      const processId = segments[2] ?? ''
      // What v0.2609.0 answers the wait with: 410 Gone, the moment the cancel lands.
      settle(processId, 410, error('FI.MAU.BRIDGE.LOGIN_CANCELLED', 'Login process was cancelled'))
      logins.delete(processId)
      return reply(res, 200, {})
    }
    if (req.method === 'POST' && segments[0] === 'logout') {
      const state = userState(userId)
      state.logins = state.logins.filter((login) => login.id !== segments[1])
      return reply(res, 200, {})
    }
    return reply(res, 404, error('M_UNRECOGNIZED', 'Unrecognized request'))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(Number(target.port), target.hostname, () => resolve())
  })

  return {
    url: options.url,
    calls,
    rotate(userId) {
      const login = waitingLoginOf(userId)
      return login ? settle(login.processId, 200, qrStep(login)) : false
    },
    complete(userId, profile = {}) {
      const login = waitingLoginOf(userId)
      if (!login) return false
      const loginId = `wa-${randomUUID().slice(0, 8)}`
      const state = userState(userId)
      state.logins = [
        { id: loginId, state: 'CONNECTED', phone: profile.phone ?? '+4915100000000', name: profile.name ?? 'QA Stub Business' },
      ]
      logins.delete(login.processId)
      return settle(login.processId, 200, {
        login_id: login.processId,
        type: 'complete',
        step_id: 'fi.mau.whatsapp.login.complete',
        complete: { user_login_id: loginId },
      })
    },
    fail(userId, errcode) {
      const login = waitingLoginOf(userId)
      if (!login) return false
      logins.delete(login.processId)
      return settle(login.processId, 400, error(errcode, 'Login failed'))
    },
    setState(userId, state) {
      for (const login of userState(userId).logins) login.state = state
    },
    loginsOf(userId) {
      return userState(userId).logins.map((login) => login.id)
    },
    async close() {
      for (const processId of [...waiting.keys()]) settle(processId, 503, error('M_UNKNOWN', 'stub closing'))
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
