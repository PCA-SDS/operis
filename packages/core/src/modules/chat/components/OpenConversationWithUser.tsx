"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOpenConversation } from './hooks'

export type OpenConversationWithUserProps = {
  userId: string
}

/**
 * The entry point other modules link to: "message this person".
 *
 * It resolves the canonical direct conversation through the same
 * `POST /api/chat/conversations` the chat UI uses — no module gets its own way
 * of creating one — then replaces the URL with the conversation's own route, so
 * browser back returns to where the reader came from rather than re-triggering
 * this redirect.
 *
 * The write stays a POST rather than being folded into the page load, so a link
 * prefetch cannot create conversations behind the user's back.
 */
export function OpenConversationWithUser({ userId }: OpenConversationWithUserProps) {
  const t = useT()
  const router = useRouter()
  const openConversation = useOpenConversation()
  const [error, setError] = React.useState<string | null>(null)
  // Keyed on the id, not a bare boolean: Next reuses the component instance
  // across a client-side navigation between two `/with/<id>` routes, and a
  // boolean guard would short-circuit the second one into a spinner that never
  // resolves and has no way out.
  const startedFor = React.useRef<string | null>(null)

  const [retryable, setRetryable] = React.useState(true)

  const open = React.useCallback(async () => {
    setError(null)
    try {
      const conversation = await openConversation.mutateAsync(userId)
      router.replace(`/backend/chat/${conversation.id}`)
    } catch (err) {
      const status = (err as { status?: number } | null)?.status
      // A 4xx is a settled answer — a malformed id, or someone outside the
      // organization. Offering "Try again" for it is a button that can only ever
      // fail, so only a server-side or transport failure keeps the retry.
      const isClientError = typeof status === 'number' && status >= 400 && status < 500
      setRetryable(!isClientError)
      setError(
        // Server validation copy ("Validation failed") is not something to show
        // a user as the whole explanation; fall back to the module's own wording
        // for anything the request could not make sense of.
        !isClientError && err instanceof Error && err.message
          ? err.message
          : status === 404
            ? t('chat.errors.recipientNotFound', 'That person is not an active member of your organization.')
            : t('chat.start.failed', "Couldn't open that conversation."),
      )
    }
  }, [openConversation, router, t, userId])

  React.useEffect(() => {
    if (startedFor.current === userId) return
    startedFor.current = userId
    void open()
    // Runs once per userId. React double-invokes effects in development, and
    // without the guard that would post twice.
  }, [open, userId])

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <ErrorMessage
          label={error}
          action={
            <div className="flex flex-wrap gap-2">
              {retryable ? (
                <Button type="button" variant="outline" size="sm" onClick={() => void open()}>
                  {t('chat.actions.retry', 'Try again')}
                </Button>
              ) : null}
              <Button type="button" size="sm" onClick={() => router.replace('/backend/chat')}>
                {t('chat.start.backToChat', 'Go to chat')}
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <LoadingMessage label={t('chat.start.opening', 'Opening the conversation…')} />
    </div>
  )
}
