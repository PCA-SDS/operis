"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { ChatTaskCard } from '../../../components/ChatTaskCard'
import { useChatTaskLiveRefresh, useMessageTaskCard } from '../../../components/hooks'

/**
 * The body of a card row in the transcript.
 *
 * Chat wrote the row and knows nothing about what is in it; this resolves the task
 * through an authorized read for whoever is looking. Two people reading the same
 * conversation can therefore see different things here, which is the point.
 */
type CardContext = {
  conversationId: string
  messageId: string
}

function isCardContext(context: unknown): context is CardContext {
  if (!context || typeof context !== 'object') return false
  const candidate = context as Partial<CardContext>
  return typeof candidate.conversationId === 'string' && typeof candidate.messageId === 'string'
}

export default function ChatTaskCardWidget({ context }: InjectionWidgetComponentProps<unknown, unknown>) {
  // Validated rather than cast: a spot's context is a contract with another module,
  // and rendering from a shape that is not the expected one is how a missing id
  // becomes a request for card `undefined`.
  const valid = isCardContext(context) ? context : null
  const { card, isLoading } = useMessageTaskCard(valid?.conversationId ?? '', valid?.messageId ?? '')
  useChatTaskLiveRefresh()
  if (!valid) return null
  return <ChatTaskCard card={card} isLoading={isLoading} />
}
