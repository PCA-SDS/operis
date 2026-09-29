'use client'

import * as React from 'react'
import { Zap } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export const CREDENTIAL_TEST_FIELD_ID = '__credentialTest'

type CredentialTestStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unconfigured'

type CredentialTestResponse = {
  status: CredentialTestStatus
  message: string | null
  code?: string
}

const SECRET_REENTRY_REQUIRED_CODE = 'credentials.secret_reentry_required'

type CredentialTestOutcome =
  | { kind: 'result'; status: CredentialTestStatus; message: string | null }
  | { kind: 'failed'; messageKey: string; fallback: string }

const TEST_STATUS_VARIANTS: StatusMap<CredentialTestStatus> = {
  healthy: 'success',
  degraded: 'warning',
  unhealthy: 'error',
  unconfigured: 'neutral',
}

function failureForStatus(status: number, code?: string): CredentialTestOutcome {
  if (status === 422 && code === SECRET_REENTRY_REQUIRED_CODE) {
    return {
      kind: 'failed',
      messageKey: 'integrations.detail.credentials.test.secretReentryRequired',
      fallback: 'You changed the connection settings. Enter the secret again to test them.',
    }
  }
  if (status === 403) {
    return {
      kind: 'failed',
      messageKey: 'integrations.detail.credentials.test.forbidden',
      fallback: 'You do not have permission to test credentials.',
    }
  }
  if (status === 429) {
    return {
      kind: 'failed',
      messageKey: 'integrations.detail.credentials.test.rateLimited',
      fallback: 'Too many tests. Wait a minute and try again.',
    }
  }
  return {
    kind: 'failed',
    messageKey: 'integrations.detail.credentials.test.error',
    fallback: 'The test could not be run. Try again.',
  }
}

function collectSubmittedCredentials(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([key, value]) => key !== CREDENTIAL_TEST_FIELD_ID && value !== undefined),
  )
}

export function CredentialTestField({
  integrationId,
  values,
  disabled,
}: {
  integrationId: string
  values: Record<string, unknown>
  disabled?: boolean
}) {
  const t = useT()
  const [pending, setPending] = React.useState(false)
  const [outcome, setOutcome] = React.useState<CredentialTestOutcome | null>(null)
  const submitted = React.useMemo(() => collectSubmittedCredentials(values), [values])
  const submittedSignature = React.useMemo(() => JSON.stringify(submitted), [submitted])

  React.useEffect(() => {
    setOutcome(null)
  }, [submittedSignature])

  const handleTest = React.useCallback(async () => {
    if (pending) return
    setPending(true)
    try {
      const call = await apiCall<CredentialTestResponse>(
        `/api/integrations/${encodeURIComponent(integrationId)}/health`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentials: submitted }),
        },
        { fallback: null },
      )
      if (call.ok && call.result) {
        setOutcome({ kind: 'result', status: call.result.status, message: call.result.message })
      } else {
        setOutcome(failureForStatus(call.status, call.result?.code))
      }
    } catch {
      setOutcome(failureForStatus(0))
    } finally {
      setPending(false)
    }
  }, [integrationId, pending, submitted])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => void handleTest()} disabled={disabled || pending}>
          {pending ? <Spinner className="mr-2 h-4 w-4" /> : <Zap className="mr-2 h-4 w-4" />}
          {pending
            ? t('integrations.detail.credentials.test.testing', 'Testing...')
            : t('integrations.detail.credentials.test.action', 'Test connection')}
        </Button>
        {outcome?.kind === 'result' ? (
          <StatusBadge variant={TEST_STATUS_VARIANTS[outcome.status] ?? 'neutral'} dot>
            {t(`integrations.detail.health.${outcome.status}`)}
          </StatusBadge>
        ) : null}
      </div>
      <div aria-live="polite" className="space-y-1">
        {outcome?.kind === 'result' && outcome.message ? (
          <p className="text-sm text-muted-foreground">{outcome.message}</p>
        ) : null}
        {outcome?.kind === 'failed' ? (
          <p className="text-sm text-status-error-text">{t(outcome.messageKey, outcome.fallback)}</p>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          'integrations.detail.credentials.test.hint',
          'Tests the values in this form with the provider. Nothing is saved until you save the credentials.',
        )}
      </p>
    </div>
  )
}
