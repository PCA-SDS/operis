"use client"
import * as React from 'react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Badge } from '@open-mercato/ui/primitives/badge'
import {
  ModuleAccessSection,
  type ModuleAccessLabels,
  type ModuleAccessRow,
} from '@open-mercato/ui/backend/entitlements/ModuleAccessSection'
import { readApiResultOrThrow, apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { readJsonSafe } from '@open-mercato/ui/backend/utils/serverErrors'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type UserModuleRow = {
  moduleId: string
  title: string
  description: string | null
  isEnabled: boolean
}

type UserSummary = {
  id: string
  email?: string | null
  name?: string | null
}

export default function UserModulesPage({ params }: { params?: { id?: string } }) {
  const userId = params?.id
  const t = useT()
  const [rows, setRows] = React.useState<UserModuleRow[] | null>(null)
  const [user, setUser] = React.useState<UserSummary | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const { runMutation } = useGuardedMutation<{ userId: string }>({
    contextId: 'auth.user-modules',
  })

  const load = React.useCallback(async () => {
    if (!userId) return
    setError(null)
    try {
      const [modulesResult, userResult] = await Promise.all([
        readApiResultOrThrow<{ items?: UserModuleRow[] }>(
          `/api/auth/user-modules?userId=${encodeURIComponent(userId)}`,
        ),
        readApiResultOrThrow<{ items?: UserSummary[] }>(
          `/api/auth/users?id=${encodeURIComponent(userId)}`,
        ),
      ])
      setRows(modulesResult.items ?? [])
      setUser(userResult.items?.[0] ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.userModules.errors.loadFailed', 'Failed to load user modules'))
    }
  }, [userId, t])

  React.useEffect(() => { void load() }, [load])

  const toggle = React.useCallback(async (row: ModuleAccessRow, next: boolean) => {
    if (!userId) return
    await runMutation({
      context: { userId },
      mutationPayload: { moduleId: row.moduleId, isEnabled: next },
      operation: async () => {
        // optimistic-lock-exempt: each write sets one module's boolean availability to an
        // absolute value taken from the operator's click, not from a loaded record version.
        // Toggles of different modules touch different rows, and two admins toggling the same
        // module concurrently should land on the last click — there is no field-level lost
        // update for a version header to protect.
        const response = await apiCall('/api/auth/user-modules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, moduleId: row.moduleId, isEnabled: next }),
        })
        if (!response.ok) {
          const body = await readJsonSafe<{ error?: string }>(response as unknown as Response, {})
          throw new Error(body?.error || t('auth.userModules.errors.saveFailed', 'Failed to update module availability'))
        }
        return response
      },
    // Reload rather than patch locally: the tenant's own entitlement may have
    // changed underneath, which would silently drop a row from the list.
    }).then(() => load()).catch((err) => {
      flash(err instanceof Error ? err.message : t('auth.userModules.errors.saveFailed', 'Failed to update module availability'), 'error')
      throw err
    })
  }, [userId, runMutation, t, load])

  const labels = React.useMemo<ModuleAccessLabels>(() => ({
    heading: t('auth.userModules.heading', 'Modules'),
    edit: t('common.edit', 'Edit'),
    done: t('common.done', 'Done'),
    enabled: t('auth.userModules.state.available', 'Enabled'),
    disabled: t('auth.userModules.state.withheld', 'Not enabled'),
    core: t('auth.userModules.state.core', 'Core'),
    blocked: () => '',
    cascade: () => '',
    emptyTitle: t('auth.userModules.empty.title', 'No modules to assign'),
    emptyDescription: t('auth.userModules.empty.description', 'This tenant is not entitled to any modules yet, so there is nothing to assign. A platform administrator grants modules at the tenant level first.'),
    confirmTitle: (row, next) => (next
      ? t('auth.userModules.confirm.enableTitle', 'Enable {module}?', { module: row.title })
      : t('auth.userModules.confirm.disableTitle', 'Disable {module}?', { module: row.title })),
    confirmBody: (row, next) => (next
      ? t('auth.userModules.confirm.enableBody', 'This user regains access to {module} immediately, subject to their role permissions.', { module: row.title })
      : t('auth.userModules.confirm.disableBody', 'This user loses access to {module} immediately. Other users in the tenant are unaffected, and their existing data is kept.', { module: row.title })),
    attestations: [
      t('auth.userModules.confirm.attestation1', 'I understand this changes what this user can see and do straight away.'),
    ],
    confirmCta: (next) => (next
      ? t('auth.userModules.confirm.enableCta', 'Enable module')
      : t('auth.userModules.confirm.disableCta', 'Disable module')),
    cancel: t('common.cancel', 'Cancel'),
    toggleAriaLabel: (row, next) => (next
      ? t('auth.userModules.confirm.enableTitle', 'Enable {module}?', { module: row.title })
      : t('auth.userModules.confirm.disableTitle', 'Disable {module}?', { module: row.title })),
  }), [t])

  if (error) {
    return <ErrorMessage label={t('auth.userModules.loadError', 'Could not load user modules')} description={error} />
  }
  if (!rows) return <LoadingMessage label={t('common.loading', 'Loading…')} />

  const enabledCount = rows.filter((row) => row.isEnabled).length

  return (
    <Page>
      <PageHeader
        eyebrow={user?.name || user?.email || undefined}
        title={t('auth.userModules.title', 'User Modules')}
        description={t(
          'auth.userModules.description',
          'Modules this user may reach. Only modules the tenant is entitled to are listed, and turning one off here withholds it from this user alone — it never grants access the tenant does not have.',
        )}
      />
      <PageBody>
        <ModuleAccessSection
          rows={rows}
          labels={labels}
          onToggle={toggle}
          headerAside={rows.length ? (
            <Badge variant="secondary">
              {t('auth.userModules.enabledCount', '{enabled} of {total} enabled')
                .replace('{enabled}', String(enabledCount))
                .replace('{total}', String(rows.length))}
            </Badge>
          ) : undefined}
        />
      </PageBody>
    </Page>
  )
}
