"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card } from '@open-mercato/ui/primitives/card'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ConsentScope = { scope: string; description: string }
type ConsentOrganization = { id: string; name: string }

type ConsentContext = {
  clientName: string
  clientId: string
  redirectUri: string
  scopes: ConsentScope[]
  organizations: ConsentOrganization[]
}

/**
 * The approval step of the MCP OAuth flow.
 *
 * The page never sees the underlying OAuth parameters — it holds only the signed
 * ticket from the URL and echoes it back with the user's decision. Which
 * organization the connection is bound to is chosen here explicitly, because the
 * MCP endpoint refuses to infer one.
 */
export default function McpConsentPage() {
  const t = useT()
  const [ticket, setTicket] = React.useState<string | null>(null)
  const [context, setContext] = React.useState<ConsentContext | null>(null)
  const [organizationId, setOrganizationId] = React.useState<string>('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    const request = new URLSearchParams(window.location.search).get('request')
    if (!request) {
      setError(t('mcp.consent.errors.missingRequest', 'This authorization link is incomplete or has expired.'))
      return
    }
    setTicket(request)

    let cancelled = false
    void (async () => {
      const outcome = await apiCall<ConsentContext>(
        `/api/mcp/oauth/consent-context?request=${encodeURIComponent(request)}`,
      )
      if (cancelled) return
      if (!outcome.ok || !outcome.result) {
        setError(t('mcp.consent.errors.invalidRequest', 'This authorization request is no longer valid. Start the connection again from your MCP client.'))
        return
      }
      setContext(outcome.result)
      setOrganizationId(outcome.result.organizations[0]?.id ?? '')
    })()

    return () => {
      cancelled = true
    }
  }, [t])

  const decide = React.useCallback(
    async (decision: 'approve' | 'deny') => {
      if (!ticket) return
      if (decision === 'approve' && !organizationId) return
      setSubmitting(true)
      setError(null)
      try {
        const outcome = await apiCall<{ redirectTo?: string }>('/api/mcp/oauth/authorize', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ request: ticket, organizationId, decision }),
        })
        if (!outcome.ok) {
          setError(t('mcp.consent.errors.failed', 'The authorization could not be completed. Start the connection again from your MCP client.'))
          return
        }
        const redirectTo = outcome.result?.redirectTo
        if (redirectTo) {
          // A full navigation, not a router push: the destination is the OAuth
          // client's own redirect URI, which is outside this application.
          window.location.href = redirectTo
          return
        }
        setError(t('mcp.consent.errors.failed', 'The authorization could not be completed. Start the connection again from your MCP client.'))
      } finally {
        setSubmitting(false)
      }
    },
    [organizationId, t, ticket],
  )

  if (error) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }

  if (!context) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('mcp.consent.loading', 'Loading the authorization request…')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <Card className="mx-auto max-w-xl p-6">
          <h1 className="text-lg font-semibold text-foreground">
            {t('mcp.consent.heading', 'Connect an MCP client')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('mcp.consent.intro', 'This application is requesting access to your account:')}{' '}
            <span className="font-medium text-foreground">{context.clientName}</span>
          </p>

          <section className="mt-6">
            <h2 className="text-sm font-medium text-foreground">
              {t('mcp.consent.permissions', 'It will be able to:')}
            </h2>
            <ul className="mt-2 space-y-2">
              {context.scopes.map((entry) => (
                <li key={entry.scope} className="rounded-md bg-surface p-3 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{entry.scope}</span>
                  <p className="mt-1 text-foreground">{entry.description}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              {t(
                'mcp.consent.rbacNote',
                'It can never do more than you can. Your own permissions still apply to every action.',
              )}
            </p>
          </section>

          <section className="mt-6">
            <h2 className="text-sm font-medium text-foreground">
              {t('mcp.consent.organization', 'Organization')}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                'mcp.consent.organizationHelp',
                'The connection is locked to one organization. It cannot reach data in any other.',
              )}
            </p>
            <div className="mt-2 space-y-2">
              {context.organizations.map((organization) => (
                <label
                  key={organization.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md bg-surface p-3 text-sm"
                >
                  <input
                    type="radio"
                    name="organization"
                    value={organization.id}
                    checked={organizationId === organization.id}
                    onChange={() => setOrganizationId(organization.id)}
                  />
                  <span className="text-foreground">{organization.name}</span>
                </label>
              ))}
            </div>
          </section>

          <div className="mt-8 flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={() => void decide('deny')} disabled={submitting}>
              {t('mcp.consent.deny', 'Deny')}
            </Button>
            <Button
              onClick={() => void decide('approve')}
              disabled={submitting || !organizationId}
            >
              {submitting ? <Spinner className="mr-2" /> : null}
              {t('mcp.consent.approve', 'Allow access')}
            </Button>
          </div>
        </Card>
      </PageBody>
    </Page>
  )
}
