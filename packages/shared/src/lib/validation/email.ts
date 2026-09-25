import { z } from 'zod'

/**
 * RFC 5321 caps a whole address at 320 octets (64 local + @ + 255 domain). It is
 * the length every schema in this repo that bothers to set one already uses.
 */
export const EMAIL_MAX_LENGTH = 320

/**
 * A deliberately loose "looks like an address" pattern: one or more non-space,
 * non-`@` characters, an `@`, then a dotted domain.
 *
 * Two legitimate uses, and only these:
 *
 * 1. **Fast client-side feedback** before a form is submitted. It is not an
 *    enforcement point — the server schema built from {@link emailSchema} is.
 *    This pattern is looser than `zod`'s `.email()` and applies no length cap,
 *    so anything it accepts must still pass the server schema.
 * 2. **Classifying** a free-text value, e.g. deciding whether a search term
 *    should be matched against an email column. Here "is this shaped like an
 *    address" is the whole question and rejecting an odd-but-real address costs
 *    nothing.
 *
 * Five call sites each carried this literal before it lived here. Never use it
 * to validate a value that is about to be stored.
 */
export const LOOSE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type EmailSchemaOptions = {
  /** Message or i18n key for a malformed address. Defaults to zod's own. */
  message?: string
  /** Override the length cap. Prefer leaving this alone. */
  maxLength?: number
  /** Accept an optional display name, for example `Acme <mail@example.com>`. */
  allowDisplayName?: boolean
}

export type ParsedEmailAddress = {
  address: string
  displayName?: string
}

const DISPLAY_NAME_EMAIL_PATTERN = /^(?:"([^"]*)"|([^<>]*?))?\s*<([^<>]+)>$/

/** Extracts the mailbox from a plain or display-name email address. */
export function parseEmailAddress(value: string): ParsedEmailAddress | null {
  const normalized = value.trim()
  const displayNameMatch = DISPLAY_NAME_EMAIL_PATTERN.exec(normalized)
  const address = (displayNameMatch?.[3] ?? normalized).trim()
  if (!z.string().email().max(EMAIL_MAX_LENGTH).safeParse(address).success) return null
  if (!displayNameMatch) return { address }

  const displayName = (displayNameMatch[1] ?? displayNameMatch[2] ?? '').trim()
  return displayName ? { address, displayName } : { address }
}

export function isEmailAddress(value: string, allowDisplayName = false): boolean {
  if (!allowDisplayName) return z.string().email().max(EMAIL_MAX_LENGTH).safeParse(value.trim()).success
  return parseEmailAddress(value) !== null
}

/**
 * The canonical email schema: trim, validate, cap at {@link EMAIL_MAX_LENGTH}.
 *
 * Before this existed there were 51 independent email schemas, 34 of which set
 * no length cap at all. Use this for any new field, and prefer it when touching
 * an existing one; roughly forty of those schemas are still hand-written.
 *
 * The loose client-side regex that used to be copied alongside them now lives
 * here as {@link LOOSE_EMAIL_PATTERN}, which documents when it is the right
 * tool. Two hand-rolled 25-line validators remain — `isValidCheckoutEmail` and
 * the byte-identical copy in `ui/backend/messages` — and are deliberately
 * stricter on domain labels and tighter on length (254) than this schema, so
 * they are not a drop-in swap.
 *
 * Client-side forms may use it for fast feedback, but the server schema is the
 * enforcement point — a client check is never a substitute for one.
 */
export function emailSchema(options: EmailSchemaOptions = {}) {
  const { message, maxLength = EMAIL_MAX_LENGTH, allowDisplayName = false } = options
  if (allowDisplayName) {
    const schema = z.string().trim().max(maxLength)
    return message ? schema.refine((value) => isEmailAddress(value, true), message) : schema.refine((value) => isEmailAddress(value, true))
  }
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
