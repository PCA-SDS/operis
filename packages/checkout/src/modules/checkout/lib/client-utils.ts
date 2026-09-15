/**
 * Client-safe utility functions for the checkout module.
 * MUST NOT import from data/entities or any server-only module.
 */

import { normalizeOptionalString } from '@open-mercato/shared/lib/string'

export { normalizeOptionalString }

export function buildCheckoutAttachmentPreviewUrl(attachmentId: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(attachmentId)
  if (!normalized) return null
  return `/api/attachments/image/${encodeURIComponent(normalized)}?width=640&height=240&cropType=contain`
}
