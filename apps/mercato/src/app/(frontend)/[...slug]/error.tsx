'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('app').child({ component: 'FrontendErrorBoundary' })

/**
 * Route-level error boundary for the customer portal / storefront catch-all.
 *
 * Without it a throw in any portal page bubbles to `app/global-error.tsx`,
 * which renders its own `<html>`/`<body>` and replaces the whole document —
 * so a customer sees a bare error card instead of the portal with an error in
 * its content pane. Rendering inside `(frontend)/layout.tsx` keeps the portal
 * shell mounted and lets `reset()` retry the segment.
 *
 * Client Component, so it logs through `createLogger` rather than the
 * server-side telemetry facade.
 */
export default function FrontendError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useT()

  React.useEffect(() => {
    logger.error('Unhandled error in portal route', { err: error, digest: error.digest })
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
