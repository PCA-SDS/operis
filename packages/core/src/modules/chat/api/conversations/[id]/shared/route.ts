import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { MAX_SHARED_PAGE_SIZE, querySharedResources } from '../../../../lib/shared'
import { loadOrganizationMembers } from '../../../../lib/scope'
import {
  chatService,
  jsonOk,
  readContext,
  resolveChatRequest,
  toChatErrorResponse,
  searchParamsToObject,
} from '../../../shared'
import { CHAT_TAG, COMMON_ERRORS, sharedResourcesSchema } from '../../../openapi'

const paramsSchema = z.object({ id: z.string().uuid() })

const querySchema = z.object({
  kind: z.enum(['files', 'media', 'links']).default('files'),
  limit: z.coerce.number().int().min(1).max(MAX_SHARED_PAGE_SIZE).optional(),
  cursor: z.string().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
}

/**
 * What has been shared in this conversation.
 *
 * Membership is checked first, exactly as reading the transcript is: the panel
 * is a second way to reach the same messages, so it cannot be a way around the
 * rule that governs them.
 *
 * One route for all three views. They differ by a predicate, not by a notion of
 * what sharing means, and splitting them into three endpoints would be three
 * places for the scope check to drift.
 */
export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id: conversationId } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    await chatService(request).requireParticipant(readContext(request), conversationId)

    const query = querySchema.parse(searchParamsToObject(req.url))
    const result = await querySharedResources({
      em: request.em,
      scope: request.scope,
      conversationId,
      kind: query.kind,
      limit: query.limit,
      cursor: query.cursor,
    })

    // Names for the page in one read, not one per row — the same rule the
    // transcript follows.
    const userIds = [
      ...new Set(
        result.items.map((item) => (item.kind === 'link' ? item.sharedByUserId : item.uploaderUserId)),
      ),
    ].filter(Boolean)
    const people = await loadOrganizationMembers(request.em, request.scope, userIds)
    const nameOf = (userId: string) => {
      const person = people.get(userId)
      return person ? person.name || person.email : ''
    }

    return jsonOk({
      items: result.items.map((item) =>
        item.kind === 'link'
          ? { ...item, sharedByName: nameOf(item.sharedByUserId) }
          : { ...item, uploaderName: nameOf(item.uploaderUserId) },
      ),
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    })
  } catch (error) {
    return toChatErrorResponse(error, 'chat.conversation.shared')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Shared resources',
  methods: {
    GET: {
      summary: 'Files, media and links shared in this conversation',
      description:
        'Membership is checked before anything is read, so the panel cannot reach messages the transcript would refuse. Files whose message was deleted, and files that have not cleared their scan, are not listed — a panel is somewhere people download from. Paged with a keyset on (created_at, id), because a message sent with twenty images writes twenty rows at one instant and a time-only cursor would split that group.',
      responses: [
        { status: 200, description: 'A page of shared resources.', schema: sharedResourcesSchema },
      ],
      errors: [...COMMON_ERRORS],
    },
  },
}
