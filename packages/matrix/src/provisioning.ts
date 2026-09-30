import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { MatrixBridgeProvisioning } from './config'
import { readBounded } from './client'
import { MatrixError, classifyMatrixFailure } from './errors'

const logger = createLogger('matrix').child({ component: 'provisioning' })

/**
 * The provisioning API every mautrix bridgev2 bridge serves — WhatsApp,
 * Telegram, Signal and Meta alike — at `/_matrix/provision/v3`.
 *
 * Authorised by the bridge's shared secret, acting as the Matrix user named in
 * `?user_id=`. Verified against mautrix-whatsapp v0.2609.0: a wrong secret is
 * `401 M_UNKNOWN_TOKEN`, a user the bridge does not permit is `403`.
 *
 * The secret starts a WhatsApp login for any account on the homeserver, so it
 * goes in the Authorization header to the configured origin and nowhere else —
 * never a log, a query string or an error message.
 */

const DEFAULT_TIMEOUT_MS = 20_000
/**
 * `display_and_wait` blocks until the next QR code or completion. WhatsApp's
 * first code lives ~60 s; this leaves headroom so the bridge, not this client,
 * is what decides the wait is over.
 */
const WAIT_TIMEOUT_MS = 120_000

const loginStepSchema = z.looseObject({
  login_id: z.string(),
  type: z.string(),
  step_id: z.string(),
  instructions: z.string().optional().nullable(),
  display_and_wait: z
    .looseObject({ type: z.string(), data: z.string().optional().nullable() })
    .optional()
    .nullable(),
  user_input: z
    .looseObject({
      fields: z
        .array(
          z.looseObject({
            type: z.string(),
            id: z.string(),
            name: z.string().optional().nullable(),
            description: z.string().optional().nullable(),
          }),
        )
        .optional()
        .nullable(),
    })
    .optional()
    .nullable(),
  complete: z.looseObject({ user_login_id: z.string().optional().nullable() }).optional().nullable(),
})

const whoamiSchema = z.looseObject({
  bridge_bot: z.string().optional().nullable(),
  logins: z
    .array(
      z.looseObject({
        id: z.string(),
        name: z.string().optional().nullable(),
        state: z
          .looseObject({
            state_event: z.string().optional().nullable(),
            error: z.string().optional().nullable(),
            message: z.string().optional().nullable(),
          })
          .optional()
          .nullable(),
        profile: z
          .looseObject({ phone: z.string().optional().nullable(), name: z.string().optional().nullable() })
          .optional()
          .nullable(),
      }),
    )
    .optional()
    .nullable(),
})

const loginsSchema = z.looseObject({ login_ids: z.array(z.string()).optional().nullable() })

export type BridgeLoginField = { id: string; type: string; name: string | null; description: string | null }

/**
 * One step of a login, normalised. `unsupported` is a step this integration
 * cannot drive (a browser cookie jar, a webview, a passkey) — the caller fails
 * the login with a reason rather than guessing.
 */
export type BridgeLoginStep = {
  loginId: string
  stepId: string
  instructions: string | null
  kind: 'qr' | 'code' | 'emoji' | 'waiting' | 'input' | 'complete' | 'unsupported'
  /** The QR payload, the pairing code or the emoji, for the display kinds. */
  data: string | null
  fields: BridgeLoginField[]
  /** Set on `complete`: the bridge's id for the new login. */
  userLoginId: string | null
  /** The bridge's own step type, kept for diagnostics. */
  rawType: string
}

export type BridgeLogin = {
  id: string
  name: string | null
  /** The bridge's state event, e.g. `CONNECTED`, `TRANSIENT_DISCONNECT`, `BAD_CREDENTIALS`, `LOGGED_OUT`. */
  state: string | null
  stateError: string | null
  phone: string | null
  profileName: string | null
}

export type BridgeWhoami = { botMxid: string | null; logins: BridgeLogin[] }

function normaliseStep(raw: unknown): BridgeLoginStep {
  const parsed = loginStepSchema.safeParse(raw)
  if (!parsed.success) {
    throw new MatrixError({
      message: '[internal] bridge provisioning returned a login step this client cannot read',
      kind: 'permanent',
      status: 200,
    })
  }
  const step = parsed.data
  const base = {
    loginId: step.login_id,
    stepId: step.step_id,
    instructions: step.instructions?.trim() || null,
    data: null as string | null,
    fields: [] as BridgeLoginField[],
    userLoginId: null as string | null,
    rawType: step.type,
  }
  if (step.type === 'display_and_wait') {
    const display = step.display_and_wait
    const data = display?.data ?? null
    switch (display?.type) {
      case 'qr':
        return { ...base, kind: data ? 'qr' : 'unsupported', data }
      case 'code':
        return { ...base, kind: data ? 'code' : 'unsupported', data }
      case 'emoji':
        return { ...base, kind: data ? 'emoji' : 'unsupported', data }
      case 'nothing':
        return { ...base, kind: 'waiting' }
      default:
        return { ...base, kind: 'unsupported' }
    }
  }
  if (step.type === 'user_input') {
    const fields = (step.user_input?.fields ?? []).map((field) => ({
      id: field.id,
      type: field.type,
      name: field.name ?? null,
      description: field.description ?? null,
    }))
    return { ...base, kind: fields.length > 0 ? 'input' : 'unsupported', fields }
  }
  if (step.type === 'complete') {
    return { ...base, kind: 'complete', userLoginId: step.complete?.user_login_id ?? null }
  }
  return { ...base, kind: 'unsupported' }
}

export class BridgeProvisioningClient {
  private readonly provisioning: MatrixBridgeProvisioning

  constructor(provisioning: MatrixBridgeProvisioning) {
    this.provisioning = provisioning
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    userId: string,
    options: { body?: unknown; timeoutMs?: number } = {},
  ): Promise<unknown> {
    const url = new URL(`${this.provisioning.url}/_matrix/provision/v3${path}`)
    url.searchParams.set('user_id', userId)
    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.provisioning.secret}`,
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        // A bridge has no business redirecting a call that carries its secret.
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      })
    } catch (error) {
      throw new MatrixError({
        message: `[internal] bridge provisioning ${method} ${path} did not answer`,
        kind: 'transient',
        status: 0,
        cause: error,
      })
    }
    if (response.status >= 300 && response.status < 400) {
      throw new MatrixError({
        message: '[internal] bridge provisioning returned a redirect, which is not followed',
        kind: 'permanent',
        status: response.status,
      })
    }
    const text = await readBounded(response)
    let body: unknown = {}
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = {}
      }
    }
    if (!response.ok) {
      const errcode =
        body && typeof body === 'object' && typeof (body as { errcode?: unknown }).errcode === 'string'
          ? ((body as { errcode: string }).errcode)
          : undefined
      logger.debug('bridge provisioning call failed', { method, path, status: response.status, errcode })
      throw new MatrixError({
        message: `[internal] bridge provisioning ${method} ${path} failed: ${response.status}${errcode ? ` ${errcode}` : ''}`,
        kind: classifyMatrixFailure(response.status, errcode),
        status: response.status,
        errcode,
      })
    }
    return body
  }

  async whoami(userId: string): Promise<BridgeWhoami> {
    const parsed = whoamiSchema.safeParse(await this.call('GET', '/whoami', userId))
    if (!parsed.success) {
      throw new MatrixError({ message: '[internal] unreadable bridge whoami', kind: 'permanent', status: 200 })
    }
    return {
      botMxid: parsed.data.bridge_bot ?? null,
      logins: (parsed.data.logins ?? []).map((login) => ({
        id: login.id,
        name: login.name ?? null,
        state: login.state?.state_event ?? null,
        stateError: login.state?.error ?? login.state?.message ?? null,
        phone: login.profile?.phone ?? null,
        profileName: login.profile?.name ?? null,
      })),
    }
  }

  async listLogins(userId: string): Promise<string[]> {
    const parsed = loginsSchema.safeParse(await this.call('GET', '/logins', userId))
    return parsed.success ? (parsed.data.login_ids ?? []) : []
  }

  async startLogin(userId: string, flowId: string): Promise<BridgeLoginStep> {
    return normaliseStep(await this.call('POST', `/login/start/${encodeURIComponent(flowId)}`, userId, { body: {} }))
  }

  async submitInput(
    userId: string,
    step: Pick<BridgeLoginStep, 'loginId' | 'stepId'>,
    values: Record<string, string>,
  ): Promise<BridgeLoginStep> {
    return normaliseStep(
      await this.call(
        'POST',
        `/login/step/${encodeURIComponent(step.loginId)}/${encodeURIComponent(step.stepId)}/user_input`,
        userId,
        { body: values },
      ),
    )
  }

  /** Block until the bridge moves on: a fresh code, completion, or an error. */
  async waitForStep(userId: string, step: Pick<BridgeLoginStep, 'loginId' | 'stepId'>): Promise<BridgeLoginStep> {
    return normaliseStep(
      await this.call(
        'POST',
        `/login/step/${encodeURIComponent(step.loginId)}/${encodeURIComponent(step.stepId)}/display_and_wait`,
        userId,
        { body: {}, timeoutMs: WAIT_TIMEOUT_MS },
      ),
    )
  }

  async cancelLogin(userId: string, loginId: string): Promise<void> {
    await this.call('POST', `/login/cancel/${encodeURIComponent(loginId)}`, userId, { body: {} })
  }

  async logout(userId: string, userLoginId: string): Promise<void> {
    await this.call('POST', `/logout/${encodeURIComponent(userLoginId)}`, userId, { body: {} })
  }
}
