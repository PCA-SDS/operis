import { z } from 'zod'

/**
 * RFC 5321 caps a whole address at 320 octets (64 local + @ + 255 domain). It is
 * the length every schema in this repo that bothers to set one already uses.
 */
export const EMAIL_MAX_LENGTH = 320

export type EmailSchemaOptions = {
  /** Message or i18n key for a malformed address. Defaults to zod's own. */
  message?: string
  /** Override the length cap. Prefer leaving this alone. */
  maxLength?: number
}

/**
 * The canonical email schema: trim, validate, cap at {@link EMAIL_MAX_LENGTH}.
 *
 * Before this existed there were 51 independent email schemas, 34 of which set
 * no length cap at all, plus eight copies of a loose `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
 * regex on the client and two hand-rolled 25-line validators. Use this for any
 * new field, and prefer it when touching an existing one.
 *
 * Client-side forms may use it for fast feedback, but the server schema is the
 * enforcement point — a client check is never a substitute for one.
 */
export function emailSchema(options: EmailSchemaOptions = {}) {
  const { message, maxLength = EMAIL_MAX_LENGTH } = options
  return message
    ? z.string().trim().email(message).max(maxLength)
    : z.string().trim().email().max(maxLength)
}

/** Lower-cased for storage or equality lookup; addresses are case-insensitive in practice. */
export function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length ? trimmed : null
}
