import type { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import type { ChatAttachmentDto } from '../data/types'
import { isChatMediaMimeType } from './attachmentPolicy'

/**
 * What the client is told about an attachment.
 *
 * Deliberately not the row. A storage path, a partition code and a driver name
 * are all facts about where Operis keeps the file, and none of them is the
 * client's business — exposing them is how a private bucket layout ends up in a
 * browser's network tab. The stable reference is the id; everything the UI
 * needs to draw a card is derived here.
 */
export type { ChatAttachmentDto } from '../data/types'

function statusFor(attachment: Attachment): ChatAttachmentDto['status'] {
  switch (attachment.scanStatus) {
    case 'clean':
      return 'ready'
    case 'infected':
      return 'rejected'
    case 'failed':
      return 'failed'
    default:
      return 'pending'
  }
}

export function toChatAttachmentDto(attachment: Attachment): ChatAttachmentDto {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize,
    kind: isChatMediaMimeType(attachment.mimeType) ? 'media' : 'file',
    // `rejected` and `failed` are distinct on purpose: one is "this file is
    // dangerous", the other is "we could not tell", and the composer says
    // different things about them. Neither is downloadable.
    status: statusFor(attachment),
    createdAt: attachment.createdAt.toISOString(),
  }
}
