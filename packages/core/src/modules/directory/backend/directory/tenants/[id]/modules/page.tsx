"use client"
import * as React from 'react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { readApiResultOrThrow, apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type TenantModuleRow = {
  moduleId: string
  isEnabled: boolean
}

type TenantSummary = {
  id: string
  name: string
}

export default function TenantModulesPage({ params }: { params?: { id?: string } }) {
  const tenantId = params?.id
  const t = useT()
  const [rows, setRows] = React.useState<TenantModuleRow[] | null>(null)
  const [tenant, setTenant] = React.useState<TenantSummary | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<string | null>(null)
  const { runMutation } = useGuardedMutation<{ tenantId: string }>({
    contextId: 'directory.tenant-modules',
  })

  const load = React.useCallback(async () => {
    if (!tenantId) return
    setError(null)
    try {
      const [modulesResult, tenantResult] = await Promise.all([
        readApiResultOrThrow<{ items?: TenantModuleRow[] }>(
          `/api/directory/tenant-modules?tenantId=${encodeURIComponent(tenantId)}`,
        ),
        readApiResultOrThrow<{ items?: TenantSummary[] }>(
          `/api/directory/tenants?id=${encodeURIComponent(tenantId)}`,
        ),
      ])
      setRows(modulesResult.items ?? [])
      setTenant(tenantResult.items?.[0] ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('directory.errors.tenant_modules_load_failed', 'Failed to load tenant modules'))
    }
  }, [tenantId, t])

  React.useEffect(() => { void load() }, [load])

  const toggle = React.useCallback(async (moduleId: string, isEnabled: boolean) => {
    if (!tenantId) return
    setPending(moduleId)
    // Optimistic: reflect the intent immediately, roll back if the write fails.
    setRows((current) => current?.map((row) => (row.moduleId === moduleId ? { ...row, isEnabled } : row)) ?? current)
    try {
      await runMutation({
        context: { tenantId },
        mutationPayload: { moduleId, isEnabled },
        operation: async () => {
          // optimistic-lock-exempt: each write sets one module's boolean entitlement to an
          // absolute value taken from the operator's click, not from a loaded record version.
          // Toggles of different modules touch different rows, and two operators toggling the
          // same module concurrently should land on the last click — there is no field-level
          // lost update for a version header to protect.
          const response = await apiCall('/api/directory/tenant-modules', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, moduleId, isEnabled }),
          })
          if (!response.ok) {
            throw new Error(t('directory.errors.tenant_modules_save_failed', 'Failed to update module entitlement'))
          }
          return response
        },
      })
    } catch {
      setRows((current) => current?.map((row) => (row.moduleId === moduleId ? { ...row, isEnabled: !isEnabled } : row)) ?? current)
    } finally {
      setPending(null)
    }
  }, [tenantId, runMutation, t])

  if (error) {
    return <ErrorMessage label={t('directory.tenantModules.loadError', 'Could not load tenant modules')} description={error} />
  }
  if (!rows) return <LoadingMessage label={t('common.loading', 'Loading…')} />

  const enabledCount = rows.filter((row) => row.isEnabled).length

  return (
    <Page>
      <PageHeader
        eyebrow={tenant?.name ?? undefined}
        title={t('directory.tenantModules.title', 'Tenant Modules')}
        description={t(
          'directory.tenantModules.description',
          'Modules this tenant is entitled to. A module that is off here is unreachable for every user in the tenant, whatever their role grants.',
        )}
        actions={(
          <Badge variant="secondary">
            {t('directory.tenantModules.enabledCount', '{enabled} of {total} enabled')
              .replace('{enabled}', String(enabledCount))
              .replace('{total}', String(rows.length))}
          </Badge>
        )}
      />
      <PageBody>
        <div className="divide-y divide-border rounded-lg border border-border bg-surface">
          {rows.map((row) => (
            <div key={row.moduleId} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{row.moduleId}</p>
                <p className="text-xs text-muted-foreground">
                  {row.isEnabled
                    ? t('directory.tenantModules.state.granted', 'Granted')
                    : t('directory.tenantModules.state.withheld', 'Withheld')}
                </p>
              </div>
              <Switch
                checked={row.isEnabled}
                disabled={pending === row.moduleId}
                onCheckedChange={(next) => { void toggle(row.moduleId, next) }}
                aria-label={row.moduleId}
              />
            </div>
          ))}
        </div>
      </PageBody>
    </Page>
  )
}
