"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { ChatTaskComposer, type ChatTaskSourceMessage } from '../../../components/ChatTaskComposer'
import { LinkExistingTaskDialog } from '../../../components/LinkExistingTaskDialog'
import { useChatTaskIntents } from '../../../components/overlayBridge'
import { CHAT_TASKS_ASSIGNED_HREF } from '../../../lib/routes'
import { openChatPanelSection } from '@open-mercato/core/modules/chat/components/contextPanel'
import { CHAT_TASKS_PANEL_SECTION_ID } from '../../sectionIds'

type OverlayContext = {
  conversationId: string
}

function isOverlayContext(context: unknown): context is OverlayContext {
  if (!context || typeof context !== 'object') return false
  return typeof (context as Partial<OverlayContext>).conversationId === 'string'
}

/**
 * The module's surfaces that have to be mounted before a command can open them.
 *
 * Nothing renders until an intent arrives, so the cost of it being mounted for every
 * open conversation is one subscription.
 */
export default function ChatTaskOverlaysWidget({ context }: InjectionWidgetComponentProps<unknown, unknown>) {
  const router = useRouter()
  const valid = isOverlayContext(context) ? context : null
  const conversationId = valid?.conversationId ?? ''

  const [composer, setComposer] = React.useState<{
    argument: string
    source: ChatTaskSourceMessage | null
    onConsumed?: () => void
  } | null>(null)
  const [linking, setLinking] = React.useState<{ onConsumed?: () => void } | null>(null)

  useChatTaskIntents((intent) => {
    // A conversation this host is not rendering for. Chat remounts the whole shell on
    // a conversation switch, so during the swap two hosts can briefly overlap.
    if ('conversationId' in intent && intent.conversationId !== conversationId) return
    if (intent.kind === 'create') {
      setComposer({ argument: intent.argument, source: intent.source, onConsumed: intent.onConsumed })
      return
    }
    if (intent.kind === 'link') {
      setLinking({ onConsumed: intent.onConsumed })
      return
    }
    if (intent.kind === 'panel') {
      // Chat owns the region's state, so this asks for it by section id rather than
      // rendering a second panel of its own.
      openChatPanelSection(CHAT_TASKS_PANEL_SECTION_ID)
      return
    }
    if (intent.kind === 'my-tasks') {
      // Navigation rather than an overlay: "Assigned to me" is the tasks module's own
      // view, and reproducing it here would be a second definition of "mine".
      router.push(CHAT_TASKS_ASSIGNED_HREF)
    }
  })

  if (!valid) return null

  return (
    <>
      {composer ? (
        <ChatTaskComposer
          conversationId={conversationId}
          initialText={composer.argument}
          source={composer.source}
          onClose={() => setComposer(null)}
          onCreated={() => {
            // Only now: the composer keeps the typed line until the task actually
            // exists, so a cancel or a failure never costs somebody their sentence.
            composer.onConsumed?.()
            setComposer(null)
          }}
        />
      ) : null}
      {linking ? (
        <LinkExistingTaskDialog
          conversationId={conversationId}
          onClose={() => setLinking(null)}
          onLinked={() => linking.onConsumed?.()}
        />
      ) : null}
    </>
  )
}
