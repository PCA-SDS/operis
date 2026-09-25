"use client"

import * as React from 'react'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@open-mercato/ui/primitives/accordion'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { TagsInput, type TagsInputOption } from '@open-mercato/ui/backend/inputs/TagsInput'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { fetchOrganizationOptions } from './organizationOptions'

export type StaffRoleAssignment = {
  organizationId: string
  roleIds: string[]
}

type AssignmentItem = {
  organizationId?: unknown
  roleIds?: unknown
  roles?: unknown
}

type AssignmentResponse = {
  items?: AssignmentItem[]
}

type RoleOption = TagsInputOption & { organizationId: string }
type LoadStatus = 'idle' | 'loading' | 'ready' | 'unavailable'
type BulkSummary = { matchedOrganizations: number; totalOrganizations: number; missingOrganizations: string[] }

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(readString).filter((id): id is string => id !== null)))
}

function readAssignments(value: unknown): StaffRoleAssignment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const organizationId = readString(record.organizationId)
    if (!organizationId) return []
    return [{ organizationId, roleIds: readIds(record.roleIds) }]
  })
}

function readRoleOptions(value: unknown, organizationId: string): RoleOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const id = readString(record.id)
    const name = readString(record.name)
    if (!id || !name) return []
    return [{ value: id, label: name, organizationId }]
  })
}

function organizationIdsFromValues(values: Record<string, unknown> | undefined): string[] {
  const homeOrganizationId = readString(values?.organizationId)
  const assignedOrganizationIds = readIds(values?.organizationIds)
  return Array.from(new Set([
    ...(homeOrganizationId ? [homeOrganizationId] : []),
    ...assignedOrganizationIds,
  ]))
}

export function StaffRoleAssignmentsField({
  value,
  values,
  setValue,
  tenantId,
  userId,
}: CrudCustomFieldRenderProps & { tenantId: string | null; userId?: string | null }) {
  const t = useT()
  const homeOrganizationId = readString(values?.organizationId)
  const assignedOrganizationIds = values?.organizationIds
  const organizationIds = React.useMemo(
    () => organizationIdsFromValues({ organizationId: homeOrganizationId, organizationIds: assignedOrganizationIds }),
    [assignedOrganizationIds, homeOrganizationId],
  )
  const organizationKey = organizationIds.join(',')
  const currentAssignments = readAssignments(value)
  const [loadStatus, setLoadStatus] = React.useState<LoadStatus>('idle')
  const [organizationNames, setOrganizationNames] = React.useState<Record<string, string>>({})
  const [roleOptions, setRoleOptions] = React.useState<Record<string, RoleOption[]>>({})
  const [bulkRoleIds, setBulkRoleIds] = React.useState<string[]>([])
  const [bulkSummary, setBulkSummary] = React.useState<BulkSummary | null>(null)
  const [retryCount, setRetryCount] = React.useState(0)
  const [openOrganizationIds, setOpenOrganizationIds] = React.useState<string[]>([])
  const loadedKeyRef = React.useRef<string | null>(null)
  const currentAssignmentsRef = React.useRef(currentAssignments)

  React.useEffect(() => {
    currentAssignmentsRef.current = currentAssignments
  }, [currentAssignments])

  React.useEffect(() => {
    setOpenOrganizationIds((current) => {
      const activeOrganizationIds = current.filter((organizationId) => organizationIds.includes(organizationId))
      if (activeOrganizationIds.length) return activeOrganizationIds
      const defaultOrganizationId = homeOrganizationId ?? organizationIds[0]
      return defaultOrganizationId ? [defaultOrganizationId] : []
    })
  }, [homeOrganizationId, organizationIds, organizationKey])

  React.useEffect(() => {
    if (!tenantId || !organizationIds.length) {
      loadedKeyRef.current = null
      setLoadStatus('idle')
      setRoleOptions({})
      setOrganizationNames({})
      setBulkRoleIds([])
      setBulkSummary(null)
      if (organizationKey === '' && currentAssignmentsRef.current.length) setValue([])
      return
    }
    const loadKey = `${tenantId}:${organizationKey}`
    if (loadedKeyRef.current === loadKey) return
    loadedKeyRef.current = loadKey
    setBulkRoleIds([])
    setBulkSummary(null)
    let cancelled = false
    const controller = new AbortController()
    setLoadStatus('loading')
    const params = new URLSearchParams({ organizationIds: organizationIds.join(',') })
    params.set('tenantId', tenantId)
    if (userId) params.set('userId', userId)
    Promise.all([
      apiCall<AssignmentResponse>(`/api/staff/user-assignments?${params.toString()}`, { signal: controller.signal }),
      fetchOrganizationOptions(tenantId),
    ]).then(([assignmentsResponse, organizations]) => {
      if (cancelled) return
      if (!assignmentsResponse.ok || !Array.isArray(assignmentsResponse.result?.items)) {
        setLoadStatus('unavailable')
        return
      }
      const existingByOrganization = new Map(currentAssignmentsRef.current.map((assignment) => [assignment.organizationId, assignment.roleIds]))
      const nextAssignments = assignmentsResponse.result.items.flatMap((item) => {
        const organizationId = readString(item.organizationId)
        if (!organizationId) return []
        return [{
          organizationId,
          roleIds: existingByOrganization.get(organizationId) ?? readIds(item.roleIds),
        }]
      })
      const nextOptions: Record<string, RoleOption[]> = {}
      for (const item of assignmentsResponse.result.items) {
        const organizationId = readString(item.organizationId)
        if (organizationId) nextOptions[organizationId] = readRoleOptions(item.roles, organizationId)
      }
      const nextNames: Record<string, string> = {}
      for (const organization of organizations) {
        if (organization.value && organization.label) nextNames[organization.value] = organization.label
      }
      setLoadStatus('ready')
      setRoleOptions(nextOptions)
      setOrganizationNames(nextNames)
      setValue(nextAssignments)
    }).catch(() => {
      if (!cancelled) setLoadStatus('unavailable')
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [organizationIds, organizationKey, retryCount, setValue, tenantId, userId])

  const assignments = React.useMemo(() => {
    const byOrganization = new Map(currentAssignments.map((assignment) => [assignment.organizationId, assignment.roleIds]))
    return organizationIds.map((organizationId) => ({
      organizationId,
      roleIds: byOrganization.get(organizationId) ?? [],
    }))
  }, [currentAssignments, organizationIds])

  const allRoleOptions = React.useMemo(() => {
    const byId = new Map<string, RoleOption>()
    Object.values(roleOptions).flat().forEach((option) => {
      if (!byId.has(option.value)) byId.set(option.value, option)
    })
    return Array.from(byId.values())
  }, [roleOptions])

  const updateAssignment = React.useCallback((organizationId: string, roleIds: string[]) => {
    setValue(assignments.map((assignment) => (
      assignment.organizationId === organizationId ? { ...assignment, roleIds } : assignment
    )))
  }, [assignments, setValue])

  const applyRolesToAll = React.useCallback(() => {
    if (!bulkRoleIds.length) return
    const selectedNames = new Set(
      allRoleOptions
        .filter((option) => bulkRoleIds.includes(option.value))
        .map((option) => option.label),
    )
    const missingOrganizations = assignments.filter((assignment) => {
      const availableNames = new Set((roleOptions[assignment.organizationId] ?? []).map((option) => option.label))
      return !Array.from(selectedNames).every((name) => availableNames.has(name))
    }).map((assignment) => organizationNames[assignment.organizationId] ?? assignment.organizationId)
    setBulkSummary({
      matchedOrganizations: assignments.length - missingOrganizations.length,
      totalOrganizations: assignments.length,
      missingOrganizations,
    })
    setValue(assignments.map((assignment) => ({
      ...assignment,
      roleIds: (roleOptions[assignment.organizationId] ?? [])
        .filter((option) => selectedNames.has(option.label))
        .map((option) => option.value),
    })))
  }, [allRoleOptions, assignments, bulkRoleIds, organizationNames, roleOptions, setValue])

  const retryLoading = React.useCallback(() => {
    loadedKeyRef.current = null
    setRetryCount((current) => current + 1)
  }, [])

  const updateBulkRoleIds = React.useCallback((nextRoleIds: string[]) => {
    setBulkRoleIds(nextRoleIds)
    setBulkSummary(null)
  }, [])

  if (loadStatus === 'unavailable') {
    return (
      <Alert status="error" style="lighter" size="sm">
        <div className="flex w-full items-center justify-between gap-3">
          <span>{t('auth.users.staffAssignments.unavailable', 'Staff role assignment is unavailable for this account or module.')}</span>
          <Button type="button" variant="outline" size="sm" onClick={retryLoading}>
            {t('common.retry', 'Retry')}
          </Button>
        </div>
      </Alert>
    )
  }

  if (loadStatus === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size="sm" />
        {t('auth.users.staffAssignments.loading', 'Loading staff roles…')}
      </div>
    )
  }

  if (loadStatus === 'idle' || !assignments.length) {
    return (
      <Alert status="information" style="lighter">
        {t('auth.users.staffAssignments.selectOrganizations', 'Select at least one organization to assign staff roles.')}
      </Alert>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/30 p-3">
        <div className="mb-2 text-sm font-medium">
          {t('auth.users.staffAssignments.applyLabel', 'Apply the same role names to all organizations')}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <TagsInput
              value={bulkRoleIds}
              onChange={updateBulkRoleIds}
              suggestions={allRoleOptions}
              selectedOptions={allRoleOptions}
              allowCustomValues={false}
              placeholder={t('auth.users.staffAssignments.applyPlaceholder', 'Choose roles to copy')}
            />
          </div>
          <Button type="button" variant="outline" size="sm" disabled={!bulkRoleIds.length} onClick={applyRolesToAll}>
            {t('auth.users.staffAssignments.applyAction', 'Apply')}
          </Button>
        </div>
        {bulkSummary ? (
          <Alert
            status={bulkSummary.matchedOrganizations === bulkSummary.totalOrganizations ? 'success' : 'warning'}
            style="lighter"
            size="xs"
            className="mt-2"
          >
            {t('auth.users.staffAssignments.bulkSummary', 'Applied to {matched} of {total} organizations.', {
              matched: bulkSummary.matchedOrganizations,
              total: bulkSummary.totalOrganizations,
            })}
            {bulkSummary.matchedOrganizations < bulkSummary.totalOrganizations ? (
              <div className="mt-1 space-y-1">
                <div>{t('auth.users.staffAssignments.bulkPartial', 'Some selected roles are not available in every organization.')}</div>
                <div className="text-xs">
                  {t('auth.users.staffAssignments.bulkMissing', 'Not available in: {organizations}', {
                    organizations: bulkSummary.missingOrganizations.join(', '),
                  })}
                </div>
              </div>
            ) : null}
          </Alert>
        ) : null}
      </div>
      <Accordion
        type="multiple"
        value={openOrganizationIds}
        onValueChange={setOpenOrganizationIds}
        className="space-y-2"
      >
        {assignments.map((assignment) => {
          const options = roleOptions[assignment.organizationId] ?? []
          return (
            <AccordionItem key={assignment.organizationId} value={assignment.organizationId}>
              <AccordionTrigger triggerIcon="chevron" className="items-center">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate">{organizationNames[assignment.organizationId] ?? assignment.organizationId}</span>
                  {assignment.organizationId === homeOrganizationId ? (
                    <Badge variant="info" size="sm">
                      {t('auth.users.staffAssignments.primary', 'Primary')}
                    </Badge>
                  ) : null}
                  <Badge variant="neutral" size="sm">
                    {t('auth.users.staffAssignments.roleCount', '{count} roles', { count: assignment.roleIds.length })}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <TagsInput
                  value={assignment.roleIds}
                  onChange={(roleIds) => updateAssignment(assignment.organizationId, roleIds)}
                  suggestions={options}
                  selectedOptions={options}
                  allowCustomValues={false}
                  placeholder={t('auth.users.staffAssignments.rolePlaceholder', 'Choose staff roles')}
                />
                {!options.length && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t('auth.users.staffAssignments.noRoles', 'No staff roles are configured for this organization.')}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
    </div>
  )
}
