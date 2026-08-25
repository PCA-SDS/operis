'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('app').child({ component: 'BackendErrorBoundary' })

/**
 * Route-level error boundary for the whole backend tree.
 *
 * Before this existed the app had ZERO `error.tsx` files, so any throw — from a
 * single injected widget, one bad cell renderer, anything — bubbled all the way
 * to `app/global-error.tsx`, which renders its own `<html>`/`<body>` and
 * therefore REPLACES the entire document: nav rail, sidebar, header and
 * breadcrumb all gone, swapped for a bare card. One failing widget took down
 * the whole admin chrome.
 *
 * This boundary sits inside `(backend)/backend/layout.tsx`, so AppShell stays
 * mounted and only the content pane shows the error, with `reset()` to retry
 * the segment without a full reload.
 *
 * Deliberately uses `createLogger` rather than the telemetry `reportError`
 * facade: this is a Client Component, and the OTEL facade is server-side —
 * importing it here would pull server code into the browser bundle.
 */
export default function BackendError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useT()

  React.useEffect(() => {
    logger.error('Unhandled error in backend route', { err: error, digest: error.digest })
  }, [error])

  return (
    // `ErrorMessage` already carries role="alert"; a second one here would
    // register two nested alert regions.
    <div className="p-4 md:p-6">
      <ErrorMessage
        label={t('ui.errors.defaultTitle', 'Something went wrong')}
        // Never surface `error.message` — it can carry internal detail. The
        // digest is the support-facing correlation id Next.js already computes.
        description={
          error.digest
            ? `${t('ui.errors.defaultMessage', 'Unable to load data. Please try again.')} (${error.digest})`
            : t('ui.errors.defaultMessage', 'Unable to load data. Please try again.')
        }
        action={
          <Button type="button" onClick={() => reset()}>
            {t('ui.errors.tryAgain', 'Try again')}
          </Button>
        }
      />
    </div>
  )
}
