"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { ConversationTasksPanel } from '../../../components/ConversationTasksPanel'
import { CHAT_TASKS_PANEL_SECTION_ID } from '../../sectionIds'

type SectionContext = {
  sectionId: string
  conversationId: string
  onJumpToMessage?: (messageId: string) => void
}

function isSectionContext(context: unknown): context is SectionContext {
  if (!context || typeof context !== 'object') return false
  const candidate = context as Partial<SectionContext>
  return typeof candidate.sectionId === 'string' && typeof candidate.conversationId === 'string'
}

/**
 * The Tasks section of the conversation's contextual region.
 *
 * Chat's region is single-slot and can hold a section from any module, so the first
 * thing this does is check the open section is ours — otherwise two claimers would
 * both render into the same slot.
 */
export default function ChatTasksPanelWidget({ context }: InjectionWidgetComponentProps<unknown, unknown>) {
  if (!isSectionContext(context)) return null
  if (context.sectionId !== CHAT_TASKS_PANEL_SECTION_ID) return null
  return (
    <ConversationTasksPanel
      conversationId={context.conversationId}
      onJumpToMessage={context.onJumpToMessage}
    />
  )
}
