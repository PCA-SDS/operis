import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { runConversationActorMutation } from '../actorMutation'
import {
  conversationMutationResponseSchema,
  errorResponseSchema,
} from '../../../openapi'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['messages.view'] },
  DELETE: { requireAuth: true, requireFeatures: ['messages.view'] },
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return runConversationActorMutation(req, params.id, 'messages.conversation.mark_read_for_actor')
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  return runConversationActorMutation(req, params.id, 'messages.conversation.mark_unread_for_actor')
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    PUT: {
      summary: 'Mark entire conversation as read for current actor',
      responses: [
        { status: 200, description: 'Conversation marked read', schema: conversationMutationResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Mark entire conversation as unread for current actor',
      responses: [
        { status: 200, description: 'Conversation marked unread', schema: conversationMutationResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
      ],
    },
  },
}
