/**
 * What chat accepts as an attachment, and how much of it.
 *
 * Centralised because the brief's own instruction is the right one: a size
 * limit repeated at each call site is a limit that will disagree with itself.
 * Everything here reads from the environment with a documented default, so a
 * deployment can move it without a code change and an organization-level
 * override can be added later without hunting for constants.
 */

/**
 * The storage partition chat uploads land in.
 *
 * The existing private one, not a chat-specific partition. It is already
 * described as "internal attachments scoped to tenants and organizations",
 * which is exactly what a chat file is, and it is already seeded everywhere —
 * a new partition would have to be created in every deployment before chat
 * could accept a single upload, in exchange for no property this one lacks.
 *
 * Named here rather than inlined so that if chat ever does need its own
 * storage driver or retention, this is the one line that changes.
 */
export const CHAT_ATTACHMENT_PARTITION = 'privateAttachments'

const MAX_UPLOAD_MB_ENV_KEYS = ['OM_CHAT_ATTACHMENT_MAX_UPLOAD_MB']
/**
 * 200 MB, matching what Google Chat accepts per file.
 *
 * Deliberately larger than the platform default for other attachment kinds: a
 * product image has no reason to be this size, and a limit is only meaningful
 * where it is the smallest one that still lets people do the thing.
 */
const DEFAULT_MAX_UPLOAD_MB = 200

/** Google Chat's own ceiling for images and videos in a single message. */
export const MAX_MEDIA_ATTACHMENTS_PER_MESSAGE = 20

/**
 * How many non-media files may ride on one message.
 *
 * One, matching Google Chat's baseline. The message model supports more without
 * complaint — the link is a row per attachment — so this is a product choice
 * rather than a technical limit, and it is here in one place so raising it is a
 * one-line decision rather than an archaeology exercise.
 */
export const MAX_FILE_ATTACHMENTS_PER_MESSAGE = 1

function parseMegabytes(keys: string[], fallbackMb: number): number {
  for (const key of keys) {
    const raw = process.env[key]
    if (typeof raw !== 'string' || raw.trim().length === 0) continue
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallbackMb
}

export type ChatAttachmentLimits = {
  maxBytes: number
  maxMediaPerMessage: number
  maxFilesPerMessage: number
}

export function resolveChatAttachmentLimits(): ChatAttachmentLimits {
  return {
    maxBytes: Math.floor(parseMegabytes(MAX_UPLOAD_MB_ENV_KEYS, DEFAULT_MAX_UPLOAD_MB) * 1024 * 1024),
    maxMediaPerMessage: MAX_MEDIA_ATTACHMENTS_PER_MESSAGE,
    maxFilesPerMessage: MAX_FILE_ATTACHMENTS_PER_MESSAGE,
  }
}

/** Whether this file is rendered as media rather than as a file card. */
export function isChatMediaMimeType(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false
  return mimeType.startsWith('image/') || mimeType.startsWith('video/')
}

/**
 * Whether the number of attachments on one message is allowed.
 *
 * Media and files are counted separately because they are separate limits, and
 * a message may carry both.
 */
export function checkAttachmentCounts(
  mimeTypes: readonly (string | null | undefined)[],
  limits: ChatAttachmentLimits = resolveChatAttachmentLimits(),
): { ok: true } | { ok: false; reason: 'too_many_media' | 'too_many_files' } {
  let media = 0
  let files = 0
  for (const mimeType of mimeTypes) {
    if (isChatMediaMimeType(mimeType)) media += 1
    else files += 1
  }
  if (media > limits.maxMediaPerMessage) return { ok: false, reason: 'too_many_media' }
  if (files > limits.maxFilesPerMessage) return { ok: false, reason: 'too_many_files' }
  return { ok: true }
}
