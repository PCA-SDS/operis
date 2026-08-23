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

type TenantModuleRow = {
  moduleId: string
  title: string
  description: string | null
  isEnabled: boolean
  missingDependencies: string[]
  dependents: string[]
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

  const toggle = React.useCallback(async (row: ModuleAccessRow, next: boolean) => {
    if (!tenantId) return
    await runMutation({
      context: { tenantId },
      mutationPayload: { moduleId: row.moduleId, isEnabled: next },
      operation: async () => {
        // optimistic-lock-exempt: each write sets one module's boolean entitlement to an
        // absolute value taken from the operator's click, not from a loaded record version.
        // Toggles of different modules touch different rows, and two operators toggling the
        // same module concurrently should land on the last click — there is no field-level
        // lost update for a version header to protect.
        const response = await apiCall('/api/directory/tenant-modules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, moduleId: row.moduleId, isEnabled: next }),
        })
        if (!response.ok) {
          const body = await readJsonSafe<{ error?: string }>(response as unknown as Response, {})
          throw new Error(body?.error || t('directory.errors.tenant_modules_save_failed', 'Failed to update module entitlement'))
        }
        return response
      },
    // Reload rather than patch locally: switching a prerequisite off changes the
    // dependency badges on every dependent row, which a local edit cannot know.
    }).then(() => load()).catch((err) => {
      flash(err instanceof Error ? err.message : t('directory.errors.tenant_modules_save_failed', 'Failed to update module entitlement'), 'error')
      throw err
    })
  }, [tenantId, runMutation, t, load])

  const labels = React.useMemo<ModuleAccessLabels>(() => ({
    heading: t('directory.tenantModules.heading', 'Modules'),
    edit: t('common.edit', 'Edit'),
    done: t('common.done', 'Done'),
    enabled: t('directory.tenantModules.state.granted', 'Enabled'),
    disabled: t('directory.tenantModules.state.withheld', 'Not enabled'),
    core: t('directory.tenantModules.state.core', 'Core'),
    blocked: (dependencies) => t(
      'directory.tenantModules.blocked',
      'Unavailable until {dependencies} is enabled.',
      { dependencies },
    ),
    cascade: (dependents) => t(
      'directory.tenantModules.cascade',
      'Turning this off also removes {dependents}.',
      { dependents },
    ),
    emptyTitle: t('directory.tenantModules.empty.title', 'No modules are registered'),
    emptyDescription: t('directory.tenantModules.empty.description', 'Nothing can be granted until a module is added to the registry.'),
    confirmTitle: (row, next) => (next
      ? t('directory.tenantModules.confirm.enableTitle', 'Enable {module}?', { module: row.title })
      : t('directory.tenantModules.confirm.disableTitle', 'Disable {module}?', { module: row.title })),
    confirmBody: (row, next) => (next
      ? t('directory.tenantModules.confirm.enableBody', 'This tenant gains access to {module} immediately.', { module: row.title })
      : t('directory.tenantModules.confirm.disableBody', 'This tenant loses access to {module} immediately, for every one of its users. Existing data is kept and returns if you enable it again.', { module: row.title })),
    attestations: [
      t('directory.tenantModules.confirm.attestation1', 'I have confirmed this change with the tenant’s authorized representative.'),
      t('directory.tenantModules.confirm.attestation2', 'I understand billing implications may apply.'),
    ],
    confirmCta: (next) => (next
      ? t('directory.tenantModules.confirm.enableCta', 'Enable module')
      : t('directory.tenantModules.confirm.disableCta', 'Disable module')),
    cancel: t('common.cancel', 'Cancel'),
    toggleAriaLabel: (row, next) => (next
      ? t('directory.tenantModules.confirm.enableTitle', 'Enable {module}?', { module: row.title })
      : t('directory.tenantModules.confirm.disableTitle', 'Disable {module}?', { module: row.title })),
  }), [t])

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
      />
      <PageBody>
        <ModuleAccessSection
          rows={rows}
          labels={labels}
          onToggle={toggle}
          headerAside={(
            <Badge variant="secondary">
              {t('directory.tenantModules.enabledCount', '{enabled} of {total} enabled')
                .replace('{enabled}', String(enabledCount))
                .replace('{total}', String(rows.length))}
            </Badge>
          )}
        />
      </PageBody>
    </Page>
  )
}
