"use client"

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type RoleOption = { id: string; name: string }

const AUTH_ROLES_PAGE_SIZE = 100
const AUTH_ROLES_MAX_PAGES = 200
const NO_PARENT_VALUE = '__no_parent__'

async function fetchRoleOptions(signal: AbortSignal): Promise<RoleOption[]> {
  const options: RoleOption[] = []
  let page = 1
  let totalPages = 1

  do {
    const searchParams = new URLSearchParams({
      page: String(page),
      pageSize: String(AUTH_ROLES_PAGE_SIZE),
    })
    const result = await readApiResultOrThrow<{ items?: RoleOption[]; totalPages?: unknown }>(
      `/api/auth/roles?${searchParams.toString()}`,
      { signal },
    )
    const items = Array.isArray(result?.items) ? result.items : []
    options.push(...items)
    totalPages = typeof result?.totalPages === 'number' && Number.isFinite(result.totalPages)
      ? Math.max(1, Math.floor(result.totalPages))
      : 1
    if (items.length < AUTH_ROLES_PAGE_SIZE) break
    page += 1
  } while (page <= totalPages && page <= AUTH_ROLES_MAX_PAGES)

  return options
}

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
        const result = await fetchRoleOptions(controller.signal)
        if (!cancelled) setOptions(result)
      } catch {
        if (!cancelled) setOptions([])
      }
    })()
    return () => { cancelled = true; controller.abort() }
  }, [])

  const selectable = options.filter((option) => option.id !== excludeRoleId)

  return (
    <Select
      value={value || NO_PARENT_VALUE}
      onValueChange={(next) => onChange(next === NO_PARENT_VALUE ? null : next)}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={t('auth.roles.form.field.parentRoleNone', 'No parent (top level)')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_PARENT_VALUE}>
          {t('auth.roles.form.field.parentRoleNone', 'No parent (top level)')}
        </SelectItem>
        {selectable.map((option) => (
          <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
