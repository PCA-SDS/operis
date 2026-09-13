import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  ScopedAttachmentUploadError,
  type ScopedAttachmentUploadService,
} from '@open-mercato/core/modules/attachments/lib/scoped-upload-service'
import {
  isMultipartUploadLimitError,
  parseMultipartFormDataWithinUploadLimit,
} from '@open-mercato/core/modules/attachments/lib/upload-limits'
import { CHAT_DRAFT_ATTACHMENT_ENTITY_ID, buildChatAttachmentMetadata, getDraftAttachments } from '../../../../lib/attachments'
import { chatAttachmentUploadRateLimit } from '../../../../lib/rateLimits'
import { CHAT_ATTACHMENT_PARTITION, resolveChatAttachmentLimits } from '../../../../lib/attachmentPolicy'
import { toChatAttachmentDto } from '../../../../lib/attachmentDto'
import {
  chatService,
  enforceChatRateLimit,
  jsonOk,
  readContext,
  resolveChatRequest,
  toChatErrorResponse,
} from '../../../shared'
import { CHAT_TAG, COMMON_ERRORS, RATE_LIMITED_ERRORS, chatAttachmentSchema } from '../../../openapi'

const paramsSchema = z.object({ id: z.string().uuid() })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
  POST: { requireAuth: true, requireFeatures: ['chat.view'] },
}

/**
 * Files staged for a message that has not been sent yet.
 *
 * Membership is checked before anything is stored, not after (§101). A caller
 * who cannot read the conversation cannot obtain the capability to put bytes
 * against it — which is what stops uploads being parked somewhere cheap and
 * later associated with a conversation the uploader was never in.
 *
 * The row is created as a draft owned by this uploader, so nobody else sees it
 * until the message it belongs to is sent.
 */
export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id: conversationId } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    // Before the body is read. Refusing after the bytes are on the wire still
    // costs the transfer, and an upload endpoint is the one worth protecting.
    const limited = await enforceChatRateLimit(request, chatAttachmentUploadRateLimit, {
      failClosed: true,
    })
    if (limited) return limited

    // Membership first. Everything below this line assumes it.
    await chatService(request).requireParticipant(readContext(request), conversationId)

    let form: FormData
    try {
      form = await parseMultipartFormDataWithinUploadLimit(req)
    } catch (error) {
      if (isMultipartUploadLimitError(error)) {
        return Response.json({ error: 'attachment_too_large' }, { status: 413 })
      }
      throw error
    }

    const file = form.get('file')
    if (!(file instanceof File)) {
      return Response.json({ error: 'file_required' }, { status: 400 })
    }

    const limits = resolveChatAttachmentLimits()
    const uploadService = request.container.resolve(
      'attachmentScopedUploadService',
    ) as ScopedAttachmentUploadService

    const attachment = await uploadService.upload({
      tenantId: request.scope.tenantId,
      organizationId: request.scope.organizationId,
      entityId: CHAT_DRAFT_ATTACHMENT_ENTITY_ID,
      // The draft's own id until the message exists. It is replaced on send.
      recordId: conversationId,
      fileName: file.name,
      declaredMimeType: file.type || null,
      buffer: Buffer.from(await file.arrayBuffer()),
      partitionCode: CHAT_ATTACHMENT_PARTITION,
      maxBytes: limits.maxBytes,
      // Who staged it and where. This is what keeps one participant's draft
      // from being visible to — or sendable by — anybody else.
      metadata: buildChatAttachmentMetadata({
        uploaderUserId: request.userId,
        conversationId,
      }),
    })

    // `item`, because that is the key the shared upload adapter reads. Chat
    // reuses that adapter rather than growing an upload client of its own, so
    // the response shape is part of the contract with it.
    return jsonOk({ item: toChatAttachmentDto(attachment) })
  } catch (error) {
    if (error instanceof ScopedAttachmentUploadError) {
      return Response.json({ error: error.code }, { status: error.status })
    }
    return toChatErrorResponse(error, 'chat.conversation.attachments.upload')
  }
}

/**
 * The drafts this person has staged here.
 *
 * Scoped to the uploader rather than the conversation: a draft is not shared,
 * and a composer restored after a refresh should show its own pending files
 * and nobody else's.
 */
export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id: conversationId } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    await chatService(request).requireParticipant(readContext(request), conversationId)

    const drafts = await getDraftAttachments({
      em: request.em,
      scope: request.scope,
      uploaderUserId: request.userId,
      conversationId,
    })

    return jsonOk({ items: drafts.map(toChatAttachmentDto) })
  } catch (error) {
    return toChatErrorResponse(error, 'chat.conversation.attachments.list')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Conversation attachments',
  methods: {
    POST: {
      summary: 'Stage a file for a message in this conversation',
      description:
        'Membership is checked before any bytes are stored, so upload capability cannot be obtained for a conversation the caller does not belong to. The file is stored as a draft owned by the uploader and is not readable by anyone until the message carrying it is sent and its scan has cleared.',
      responses: [
        { status: 200, description: 'The staged attachment.', schema: z.object({ item: chatAttachmentSchema }) },
      ],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
    GET: {
      summary: "List the caller's staged attachments for this conversation",
      description: 'Drafts belong to the uploader; one participant never sees another’s staged files.',
      responses: [
        { status: 200, description: 'Staged attachments.', schema: z.object({ items: z.array(chatAttachmentSchema) }) },
      ],
      errors: [...COMMON_ERRORS],
    },
  },
}
