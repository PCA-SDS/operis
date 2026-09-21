"use client"

import * as React from 'react'

/**
 * How a contributed command reaches the surface that renders it.
 *
 * A command or message action injected into chat is a callback. It cannot render a
 * drawer, and chat has nowhere for it to render one — so the two halves of this
 * module talk to each other: the row action publishes an intent, and the overlay
 * host mounted at `chat:conversation:overlays` subscribes and renders.
 *
 * Module-local, not a DOM event and not a global: both halves live in this module,
 * so they share this module instance and nothing else can publish into it. A
 * `CustomEvent` on `window` would have worked and would have been a public channel
 * anyone could fire, which for something that opens a task composer over a
 * conversation is a worse default.
 *
 * Scoped by conversation id in the payload rather than by having one bridge per
 * conversation: chat remounts the whole shell when the conversation in the path
 * changes, so a per-conversation channel would be created and destroyed constantly
 * while this one simply carries the id and lets the host ignore what is not its own.
 */
export type ChatTaskOverlayIntent =
  | {
      kind: 'create'
      conversationId: string
      /** The text after `/task`, passed through for the quick-add grammar to read. */
      argument: string
      source: { messageId: string; authorName: string; body: string } | null
      /** Called once a task really exists, so the composer's draft can be cleared. */
      onConsumed?: () => void
    }
  | { kind: 'link'; conversationId: string; onConsumed?: () => void }
  | { kind: 'panel'; conversationId: string }
  | { kind: 'my-tasks' }

type Listener = (intent: ChatTaskOverlayIntent) => void

const listeners = new Set<Listener>()

export function publishChatTaskIntent(intent: ChatTaskOverlayIntent): void {
  for (const listener of [...listeners]) listener(intent)
}

export function subscribeToChatTaskIntents(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The host's side of the channel, as a hook so the cleanup cannot be forgotten. */
export function useChatTaskIntents(handler: Listener): void {
  const ref = React.useRef(handler)
  ref.current = handler
  React.useEffect(
    () => subscribeToChatTaskIntents((intent) => ref.current(intent)),
    [],
  )
}
