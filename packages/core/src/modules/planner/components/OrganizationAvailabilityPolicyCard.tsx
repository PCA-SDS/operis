'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type SettingsResponse = {
  configured: boolean
  operatingHoursRuleSetId: string | null
  lastCustomerBeforeCloseMinutes: number
  timeOverflowMinutes: number
}

export function OrganizationAvailabilityPolicyCard({ ruleSetId }: { ruleSetId: string }) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [settings, setSettings] = React.useState<SettingsResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  const labels = React.useMemo(() => ({
    title: t('planner.organizationAvailability.policy.title', 'Organization operating hours'),
    description: t('planner.organizationAvailability.policy.description', 'Mark this existing schedule as the organization operating-hours baseline. Last-customer and overflow values are configured on each window in Availability.'),
    official: t('planner.organizationAvailability.policy.official', 'Official organization operating hours'),
    officialActive: t('planner.organizationAvailability.policy.officialActive', 'This schedule is currently official'),
    saved: t('planner.organizationAvailability.messages.saved', 'Organization operating hours saved.'),
    loadError: t('planner.organizationAvailability.errors.load', 'Unable to load booking policy.'),
    saveError: t('planner.organizationAvailability.errors.save', 'Unable to save booking policy.'),
  }), [t])

  React.useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    readApiResultOrThrow<SettingsResponse>(
      '/api/planner/organization-availability-settings',
      undefined,
      { errorMessage: labels.loadError },
    ).then((nextSettings) => {
      if (cancelled) return
      setSettings(nextSettings)
    }).catch(() => {
      if (!cancelled) flash(labels.loadError, 'error')
    }).finally(() => {
      if (!cancelled) setIsLoading(false)
    })
    return () => { cancelled = true }
  }, [labels.loadError, ruleSetId, scopeVersion])

  const save = async () => {
    setIsSaving(true)
    try {
      const nextSettings = await readApiResultOrThrow<SettingsResponse>(
        '/api/planner/organization-availability-settings',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            operatingHoursRuleSetId: ruleSetId,
          }),
        },
        { errorMessage: labels.saveError },
      )
      setSettings(nextSettings)
      flash(labels.saved, 'success')
    } catch {
      flash(labels.saveError, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const isOfficial = settings?.configured && settings.operatingHoursRuleSetId === ruleSetId

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
      <div>
        <h2 className="text-lg font-semibold">{labels.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{labels.description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
        <div>
          <p className="text-sm font-medium">{labels.official}</p>
          <p className="text-xs text-muted-foreground">{isOfficial ? labels.officialActive : labels.official}</p>
        </div>
        <Button type="button" variant={isOfficial ? 'default' : 'outline'} disabled={isLoading || isSaving} onClick={() => void save()}>
          {isOfficial ? labels.officialActive : labels.official}
        </Button>
      </div>
    </section>
  )
}
