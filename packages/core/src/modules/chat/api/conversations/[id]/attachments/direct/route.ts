import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers'
import { resolveChatDirectUpload, finalizeChatDirectUpload } from '../../../../../lib/directUpload'
import { chatAttachmentUploadRateLimit } from '../../../../../lib/rateLimits'
import { toChatAttachmentDto } from '../../../../../lib/attachmentDto'
import {
  chatService,
  enforceChatRateLimit,
  jsonOk,
  readContext,
  resolveChatRequest,
  toChatErrorResponse,
} from '../../../../shared'
import { CHAT_TAG, COMMON_ERRORS, RATE_LIMITED_ERRORS, chatAttachmentSchema } from '../../../../openapi'

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * What the client says it is about to upload.
 *
 * All of it is a claim. The size binds the signature and the reservation, so a
 * client that understates it cannot then store more; the type binds the
 * signature too. Neither is trusted as the final record — finalisation reads
 * both back from storage.
 */
const ticketSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  contentLength: z.number().int().positive(),
})

const finalizeSchema = z.object({
  uploadId: z.string().min(1).max(200),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['chat.view'] },
  PUT: { requireAuth: true, requireFeatures: ['chat.view'] },
}

/**
 * Ask for permission to upload straight to storage.
 *
 * Membership is settled before any capability is issued (§101). The ticket that
 * comes back is bound to one key, one content type and one length, and expires
 * in minutes — a client cannot use it to write something else, somewhere else,
 * or later.
 *
 * Answers `{ supported: false }` where the backing store cannot presign, so the
 * client falls back to uploading through the multipart endpoint rather than
 * failing. Development runs on the local driver, and it must behave the same as
 * production does.
 */
export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id: conversationId } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatAttachmentUploadRateLimit, {
      failClosed: true,
    })
    if (limited) return limited

    await chatService(request).requireParticipant(readContext(request), conversationId)

    const input = ticketSchema.parse(await req.json())
    const ticket = await resolveChatDirectUpload({
      em: request.em,
      scope: request.scope,
      uploaderUserId: request.userId,
      conversationId,
      storageDriverFactory: request.container.resolve(
        'storageDriverFactory',
      ) as StorageDriverFactory,
      quotaService: request.container.resolve('attachmentQuotaService'),
      fileName: input.fileName,
      contentType: input.contentType,
      contentLength: input.contentLength,
    })

    return jsonOk(ticket)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.conversation.attachments.direct')
  }
}

/**
 * Turn a completed direct upload into an attachment.
 *
 * Nothing the client said about the object is taken as fact (§103). The size
 * and type are read back from storage, the reservation must belong to this
 * uploader, the conversation must still be one they belong to, and the file is
 * scanned before it can be read by anyone. Only then does the row exist.
 */
export async function PUT(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id: conversationId } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    // Re-checked here, not inherited from the ticket: membership can end
    // between asking to upload and saying the upload is done.
    await chatService(request).requireParticipant(readContext(request), conversationId)

    const input = finalizeSchema.parse(await req.json())
    const attachment = await finalizeChatDirectUpload({
      em: request.em,
      scope: request.scope,
      uploaderUserId: request.userId,
      conversationId,
      uploadId: input.uploadId,
      storageDriverFactory: request.container.resolve(
        'storageDriverFactory',
      ) as StorageDriverFactory,
      quotaService: request.container.resolve('attachmentQuotaService'),
      dataEngine: request.container.resolve('dataEngine'),
    })

    return jsonOk({ item: toChatAttachmentDto(attachment) })
  } catch (error) {
    return toChatErrorResponse(error, 'chat.conversation.attachments.finalize')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Direct-to-storage attachment upload',
  methods: {
    POST: {
      summary: 'Request a scoped upload ticket',
      description:
        'Membership is checked before any capability is issued. The returned URL is bound to one storage key, content type and length, cannot overwrite an existing object, and expires in minutes. Where the backing store cannot presign, the response says so and the client uploads through the multipart endpoint instead.',
      responses: [
        {
          status: 200,
          description: 'An upload ticket, or a statement that direct upload is unavailable.',
          schema: z.union([
            z.object({
              supported: z.literal(true),
              uploadId: z.string(),
              url: z.string(),
              method: z.literal('PUT'),
              headers: z.record(z.string(), z.string()),
              expiresAt: z.string(),
            }),
            z.object({ supported: z.literal(false) }),
          ]),
        },
      ],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
    PUT: {
      summary: 'Finalise a completed direct upload',
      description:
        'The size and type are read back from storage rather than taken from the client, the reservation must belong to the caller, and the conversation is re-authorized — membership can end between the ticket and the finalisation. The file is scanned before it becomes readable.',
      responses: [
        { status: 200, description: 'The staged attachment.', schema: z.object({ item: chatAttachmentSchema }) },
      ],
      errors: [...COMMON_ERRORS],
    },
  },
}
