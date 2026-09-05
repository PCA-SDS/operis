"use client"

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type RoleOption = { id: string; name: string }

/**
 * Picks the role a role reports to, which is what gives the organisation chart
 * its shape.
 *
 * The role being edited is excluded from its own list — a role reporting to
 * itself is the one loop the API always refuses, so offering it would only ever
 * produce an error. Deeper loops are still refused server-side; the chart is
 * built from this field and a cycle would otherwise break a branch.
 */
export function ParentRoleSelect({
  value,
  onChange,
  excludeRoleId,
  id,
}: {
  value: string | null
  onChange: (next: string | null) => void
  excludeRoleId?: string | null
  id?: string
}) {
  const t = useT()
  const [options, setOptions] = React.useState<RoleOption[]>([])

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    void (async () => {
      try {
        const result = await readApiResultOrThrow<{ items?: RoleOption[] }>(
          '/api/auth/roles?pageSize=200',
          { signal: controller.signal },
        )
        if (!cancelled) setOptions(result?.items ?? [])
      } catch {
        if (!cancelled) setOptions([])
      }
    })()
    return () => { cancelled = true; controller.abort() }
  }, [])

  const selectable = options.filter((option) => option.id !== excludeRoleId)

  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value ? event.target.value : null)}
      className="h-9 w-full rounded-lg border border-border bg-input-bg px-2 text-sm"
    >
      <option value="">{t('auth.roles.form.field.parentRoleNone', 'No parent (top level)')}</option>
      {selectable.map((option) => (
        <option key={option.id} value={option.id}>{option.name}</option>
      ))}
    </select>
  )
}
