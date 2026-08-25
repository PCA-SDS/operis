import { Resend } from 'resend'
import React from 'react'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseBooleanWithDefault } from '../boolean'
import { parseNumberWithDefault } from '../number'
import { createLogger } from '../logger'
import { FetchTimeoutError, withTimeout } from '../http/fetchWithTimeout'
import { resolveDefaultEmailFromAddress } from './config'

const logger = createLogger('shared').child({ component: 'email' })

export const EMAIL_SEND_TIMEOUT_ENV = 'OM_EMAIL_SEND_TIMEOUT_MS'
const DEFAULT_EMAIL_SEND_TIMEOUT_MS = 15_000

/**
 * The Resend SDK applies no timeout of its own, so an unanswered call inherits
 * undici's ~5 minute headers timeout. `sendEmail` runs on request paths (quote
 * send/accept, portal invitations), and each hung request pins both a Node
 * connection and its pooled DB connection — roughly `DB_POOL_MAX` concurrent
 * hangs exhaust the pool for the whole process.
 */
export function resolveEmailSendTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseNumberWithDefault(env[EMAIL_SEND_TIMEOUT_ENV], DEFAULT_EMAIL_SEND_TIMEOUT_MS, {
    min: 1,
    integer: true,
  })
}

export type SendEmailOptions = {
  to: string
  subject: string
  react: React.ReactElement
  from?: string
  replyTo?: string
  attachments?: Array<{
    filename: string
    content: string
    contentType?: string
  }>
}

type CapturedEmail = {
  to: string
  subject: string
  from: string | null
  replyTo: string | null
  links: string[]
  text: string
  capturedAt: string
}

type ReactElementProps = {
  href?: unknown
  children?: unknown
}

const DEFAULT_TEST_EMAIL_CAPTURE_PATH = join(tmpdir(), 'open-mercato-email-capture.jsonl')

function resolveTestEmailCapturePath(): string {
  return process.env.OM_TEST_EMAIL_CAPTURE_PATH?.trim() || DEFAULT_TEST_EMAIL_CAPTURE_PATH
}

function readElementProps(node: React.ReactElement): ReactElementProps {
  return node.props as ReactElementProps
}

function collectEmailLinks(node: unknown, links: string[] = []): string[] {
  if (node == null || typeof node === 'boolean') return links
  if (Array.isArray(node)) {
    for (const child of node) collectEmailLinks(child, links)
    return links
  }
  if (React.isValidElement(node)) {
    const props = readElementProps(node)
    if (typeof props.href === 'string' && props.href.length > 0) links.push(props.href)
    collectEmailLinks(props.children, links)
  }
  return links
}

function collectEmailText(node: unknown, parts: string[] = []): string[] {
  if (node == null || typeof node === 'boolean') return parts
  if (typeof node === 'string' || typeof node === 'number') {
    parts.push(String(node))
    return parts
  }
  if (Array.isArray(node)) {
    for (const child of node) collectEmailText(child, parts)
    return parts
  }
  if (React.isValidElement(node)) {
    collectEmailText(readElementProps(node).children, parts)
  }
  return parts
}

async function captureEmailForTests(options: SendEmailOptions): Promise<void> {
  if (!parseBooleanWithDefault(process.env.OM_TEST_MODE, false)) return

  const capturePath = resolveTestEmailCapturePath()
  const record: CapturedEmail = {
    to: options.to,
    subject: options.subject,
    from: options.from ?? resolveDefaultEmailFromAddress() ?? null,
    replyTo: options.replyTo ?? null,
    links: collectEmailLinks(options.react),
    text: collectEmailText(options.react).join(' ').replace(/\s+/g, ' ').trim(),
    capturedAt: new Date().toISOString(),
  }

  await mkdir(dirname(capturePath), { recursive: true })
  await appendFile(capturePath, `${JSON.stringify(record)}\n`, 'utf8')
}

// `Resend` is exported as both a class and a namespace, so it resolves to the
// namespace in type position (TS2709). Reach the instance type explicitly.
type ResendClient = InstanceType<typeof Resend>

const RESEND_SEND_LABEL = 'resend.emails.send'

/**
 * `Resend.post()` spreads its options object straight into the `fetch()` init,
 * so an `AbortSignal` passed here reaches undici and actually cancels the
 * in-flight request. The published request-options type does not declare
 * `signal`, hence the local widening.
 */
type SendRequestOptions = NonNullable<Parameters<ResendClient['emails']['send']>[1]> & {
  signal: AbortSignal
}

type ResendSendResult = Awaited<ReturnType<ResendClient['emails']['send']>>

/**
 * The SDK swallows every `fetch` rejection — an aborted request comes back as a
 * generic `application_error` result rather than a throw — so the abort has to
 * be re-raised for `withTimeout` to classify it. Anything thrown after the
 * deadline is converted by `withTimeout` into a `FetchTimeoutError`.
 */
async function sendWithTimeout(
  resend: ResendClient,
  payload: Parameters<ResendClient['emails']['send']>[0],
  timeoutMs: number,
): Promise<ResendSendResult> {
  return withTimeout(
    async (signal) => {
      const requestOptions: SendRequestOptions = { signal }
      const response = await resend.emails.send(payload, requestOptions)
      signal.throwIfAborted()
      return response
    },
    timeoutMs,
    RESEND_SEND_LABEL,
  )
}

export async function sendEmail({ to, subject, react, from, replyTo, attachments }: SendEmailOptions) {
  const emailDisabled =
    parseBooleanWithDefault(process.env.OM_DISABLE_EMAIL_DELIVERY, false) ||
    parseBooleanWithDefault(process.env.OM_TEST_MODE, false)

  await captureEmailForTests({ to, subject, react, from, replyTo, attachments })

  if (emailDisabled) return

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not set')
  const resend = new Resend(apiKey)
  const fromAddr = from || resolveDefaultEmailFromAddress()
  if (!fromAddr) {
    throw new Error('EMAIL_FROM_NOT_CONFIGURED: set NOTIFICATIONS_EMAIL_FROM, EMAIL_FROM, or ADMIN_EMAIL')
  }
  const payload = {
    to,
    subject,
    from: fromAddr,
    react,
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(attachments?.length ? { attachments } : {}),
  }
  const timeoutMs = resolveEmailSendTimeoutMs()
  let result: ResendSendResult
  try {
    result = await sendWithTimeout(resend, payload, timeoutMs)
  } catch (err) {
    if (err instanceof FetchTimeoutError) {
      logger.error('Email send timed out', { provider: 'resend', timeoutMs })
      throw new Error(`RESEND_SEND_TIMEOUT: no response after ${timeoutMs}ms`)
    }
    logger.error('Email send failed', { provider: 'resend', timeoutMs, err })
    throw err
  }
  const errorMessage =
    typeof (result as any)?.error === 'string'
      ? (result as any).error
      : typeof (result as any)?.error?.message === 'string'
        ? (result as any).error.message
        : null
  if (errorMessage) {
    throw new Error(`RESEND_SEND_FAILED: ${errorMessage}`)
  }
}
