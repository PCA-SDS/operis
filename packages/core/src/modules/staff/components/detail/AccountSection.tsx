"use client"

import * as React from 'react'
import Link from 'next/link'
import { KeyRound, UserPlus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { LoadingMessage, ErrorMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow, apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type AccountRow = {
  id: string
  email: string
  name: string | null
  roles: string[]
  isConfirmed: boolean
  hasPassword?: boolean
}

/**
 * The sign-in account behind a team member, shown where the member is.
 *
 * The reference puts account actions on the employee page rather than making an
 * administrator go and find the user record. Operis already owns all of this in
 * the auth module, so nothing is reimplemented here: this reads the auth users
 * API and links out to the auth pages for anything that changes the account
 * beyond resending an invite.
 *
 * Deactivation is deliberately a link rather than a button. Operis has no
 * `isActive` on a user — deactivating means deleting the account, which is
 * destructive and already carries its own confirmation on the auth page.
 */
export function AccountSection({
  userId,
  canCreateUsers,
  canEditUsers,
}: {
  userId: string | null
  canCreateUsers: boolean
  canEditUsers: boolean
}) {
  const t = useT()
  const [account, setAccount] = React.useState<AccountRow | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [inviteBusy, setInviteBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!userId) {
      setAccount(null)
      return
    }
    setIsLoading(true)
    setLoadError(null)
    try {
      const result = await readApiResultOrThrow<{ items?: AccountRow[] }>(
        `/api/auth/users?id=${encodeURIComponent(userId)}`,
      )
      setAccount(result?.items?.[0] ?? null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }, [userId])

  React.useEffect(() => { void load() }, [load])

  const resendInvite = React.useCallback(async () => {
    if (!account) return
    setInviteBusy(true)
    try {
      const result = await apiCall('/api/auth/users/resend-invite', {
        method: 'POST',
        body: JSON.stringify({ id: account.id }),
      })
      if (result.ok) flash(t('staff.account.inviteSent', 'Invitation sent'), 'success')
      else flash(t('staff.account.inviteFailed', 'Could not send the invitation'), 'error')
    } finally {
      setInviteBusy(false)
    }
  }, [account, t])

  if (isLoading) return <LoadingMessage label={t('staff.account.loading', 'Loading account…')} />
  if (loadError) return <ErrorMessage label={loadError} />

  if (!userId || !account) {
    return (
      <TabEmptyState
        title={t('staff.account.noAccount', 'No sign-in account')}
        description={t(
          'staff.account.noAccountHint',
          'This member cannot sign in. Create a user and link it from the member details.',
        )}
      >
        {canCreateUsers ? (
          <Button asChild variant="outline">
            <Link href="/backend/auth/users/create">
              <UserPlus aria-hidden />
              {t('staff.account.createUser', 'Create a user')}
            </Link>
          </Button>
        ) : null}
      </TabEmptyState>
    )
  }

  const rows = [
    { label: t('staff.account.fields.name', 'Name'), value: account.name },
    { label: t('staff.account.fields.email', 'Email'), value: account.email },
  ].filter((row) => row.value)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t('staff.account.title', 'Account')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {canCreateUsers ? (
            <Button type="button" variant="outline" onClick={() => void resendInvite()} disabled={inviteBusy}>
              <KeyRound aria-hidden />
              {t('staff.account.resendInvite', 'Resend invite')}
            </Button>
          ) : null}
          {canEditUsers ? (
            <Button asChild variant="outline">
              <Link href={`/backend/auth/users/${account.id}/edit`}>
                <UserPlus aria-hidden />
                {t('staff.account.manage', 'Manage account')}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start gap-3">
            <dt className="w-36 shrink-0 text-sm text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 flex-1 text-sm text-foreground">{row.value}</dd>
          </div>
        ))}
        <div className="flex items-start gap-3">
          <dt className="w-36 shrink-0 text-sm text-muted-foreground">
            {t('staff.account.fields.status', 'Status')}
          </dt>
          <dd className="min-w-0 flex-1">
            <Badge variant={account.isConfirmed ? 'success' : 'warning'} size="sm">
              {account.isConfirmed
                ? t('staff.account.status.confirmed', 'Confirmed')
                : t('staff.account.status.pending', 'Invitation pending')}
            </Badge>
          </dd>
        </div>
        {account.roles.length > 0 ? (
          <div className="flex items-start gap-3">
            <dt className="w-36 shrink-0 text-sm text-muted-foreground">
              {t('staff.account.fields.roles', 'Roles')}
            </dt>
            <dd className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {account.roles.map((role) => (
                <Badge key={role} variant="secondary" size="sm">{role}</Badge>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  )
}
