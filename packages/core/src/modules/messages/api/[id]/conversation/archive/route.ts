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
  return runConversationActorMutation(req, params.id, 'messages.conversation.archive_for_actor')
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  return runConversationActorMutation(req, params.id, 'messages.conversation.unarchive_for_actor')
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    PUT: {
      summary: 'Archive conversation for current actor',
      responses: [
        { status: 200, description: 'Conversation archived', schema: conversationMutationResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Unarchive conversation for current actor',
      responses: [
        { status: 200, description: 'Conversation unarchived', schema: conversationMutationResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
      ],
    },
  },
}
