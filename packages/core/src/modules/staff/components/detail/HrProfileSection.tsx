"use client"

import * as React from 'react'
import { FileText, Pencil } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow, apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern', 'temporary'] as const

type HrProfileFormValues = {
  employeeNumber?: string
  jobTitle?: string
  employmentType?: string
  startDate?: string
  endDate?: string
  workPhone?: string
  personalPhone?: string
  personalEmail?: string
  dateOfBirth?: string
  notes?: string
}

type HrProfileRecord = {
  id: string
  employeeNumber: string | null
  jobTitle: string | null
  employmentType: string | null
  startDate: string | null
  endDate: string | null
  workPhone: string | null
  personalPhone: string | null
  personalEmail: string | null
  dateOfBirth: string | null
  notes: string | null
  updatedAt: string | undefined
}

/** The API returns snake_case columns; the form speaks camelCase. */
function toRecord(row: Record<string, unknown>): HrProfileRecord {
  const text = (key: string) => {
    const value = row[key]
    return typeof value === 'string' && value.length > 0 ? value : null
  }
  const day = (key: string) => {
    const value = text(key)
    return value ? value.slice(0, 10) : null
  }
  return {
    id: String(row.id ?? ''),
    employeeNumber: text('employee_number'),
    jobTitle: text('job_title'),
    employmentType: text('employment_type'),
    startDate: day('start_date'),
    endDate: day('end_date'),
    workPhone: text('work_phone'),
    personalPhone: text('personal_phone'),
    personalEmail: text('personal_email'),
    dateOfBirth: day('date_of_birth'),
    notes: text('notes'),
    updatedAt: text('updated_at') ?? undefined,
  }
}

/**
 * A member's HR record: what they are to the company, next to the scheduling
 * data the rest of this page shows.
 *
 * One record per member, so this is a single form rather than a list — there is
 * nothing to add a second of. `canManage` comes from `staff.hr_profile.manage`;
 * the section only renders at all for someone holding `staff.hr_profile.view`.
 */
export function HrProfileSection({ memberId, canManage }: { memberId: string | null; canManage: boolean }) {
  const t = useT()
  const [record, setRecord] = React.useState<HrProfileRecord | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!memberId) return
    setIsLoading(true)
    setLoadError(null)
    try {
      const result = await readApiResultOrThrow<{ items?: Record<string, unknown>[] }>(
        `/api/staff/employee-profiles?memberId=${encodeURIComponent(memberId)}&pageSize=1`,
      )
      const row = result?.items?.[0]
      setRecord(row ? toRecord(row) : null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }, [memberId])

  React.useEffect(() => { void load() }, [load])

  const labels = React.useMemo(() => ({
    title: t('staff.hrProfile.title', 'HR profile'),
    edit: t('staff.hrProfile.edit', 'Edit HR profile'),
    add: t('staff.hrProfile.add', 'Add HR profile'),
    empty: t('staff.hrProfile.empty', 'No HR profile yet'),
    emptyHint: t('staff.hrProfile.emptyHint', 'Record employment details for this member.'),
    saved: t('staff.hrProfile.saved', 'HR profile saved'),
    generateRecord: t('staff.employeeRecord.generate', 'Generate record'),
    recordGenerated: t('staff.employeeRecord.generated', 'Employee record filed'),
    recordFailed: t('staff.employeeRecord.failed', 'Could not generate the record'),
    save: t('staff.hrProfile.save', 'Save'),
    cancel: t('staff.hrProfile.cancel', 'Cancel'),
    fields: {
      employeeNumber: t('staff.hrProfile.fields.employeeNumber', 'Employee number'),
      jobTitle: t('staff.hrProfile.fields.jobTitle', 'Job title'),
      employmentType: t('staff.hrProfile.fields.employmentType', 'Employment type'),
      startDate: t('staff.hrProfile.fields.startDate', 'Start date'),
      endDate: t('staff.hrProfile.fields.endDate', 'End date'),
      workPhone: t('staff.hrProfile.fields.workPhone', 'Work phone'),
      personalPhone: t('staff.hrProfile.fields.personalPhone', 'Personal phone'),
      personalEmail: t('staff.hrProfile.fields.personalEmail', 'Personal email'),
      dateOfBirth: t('staff.hrProfile.fields.dateOfBirth', 'Date of birth'),
      notes: t('staff.hrProfile.fields.notes', 'Notes'),
    },
    employmentTypes: {
      full_time: t('staff.hrProfile.employmentTypes.full_time', 'Full time'),
      part_time: t('staff.hrProfile.employmentTypes.part_time', 'Part time'),
      contract: t('staff.hrProfile.employmentTypes.contract', 'Contract'),
      intern: t('staff.hrProfile.employmentTypes.intern', 'Intern'),
      temporary: t('staff.hrProfile.employmentTypes.temporary', 'Temporary'),
    } as Record<string, string>,
  }), [t])

  const fields = React.useMemo<CrudField[]>(() => ([
    { id: 'employeeNumber', label: labels.fields.employeeNumber, type: 'text', layout: 'half' },
    { id: 'jobTitle', label: labels.fields.jobTitle, type: 'text', layout: 'half' },
    {
      id: 'employmentType',
      label: labels.fields.employmentType,
      type: 'select',
      layout: 'half',
      options: EMPLOYMENT_TYPES.map((value) => ({ value, label: labels.employmentTypes[value] })),
    },
    { id: 'dateOfBirth', label: labels.fields.dateOfBirth, type: 'date', layout: 'half' },
    { id: 'startDate', label: labels.fields.startDate, type: 'date', layout: 'half' },
    { id: 'endDate', label: labels.fields.endDate, type: 'date', layout: 'half' },
    { id: 'workPhone', label: labels.fields.workPhone, type: 'text', layout: 'half' },
    { id: 'personalPhone', label: labels.fields.personalPhone, type: 'text', layout: 'half' },
    { id: 'personalEmail', label: labels.fields.personalEmail, type: 'text' },
    { id: 'notes', label: labels.fields.notes, type: 'textarea' },
  ]), [labels])

  const rows = React.useMemo(() => {
    if (!record) return []
    return [
      { label: labels.fields.employeeNumber, value: record.employeeNumber },
      { label: labels.fields.jobTitle, value: record.jobTitle },
      {
        label: labels.fields.employmentType,
        value: record.employmentType ? (labels.employmentTypes[record.employmentType] ?? record.employmentType) : null,
      },
      { label: labels.fields.startDate, value: record.startDate },
      { label: labels.fields.endDate, value: record.endDate },
      { label: labels.fields.workPhone, value: record.workPhone },
      { label: labels.fields.personalPhone, value: record.personalPhone },
      { label: labels.fields.personalEmail, value: record.personalEmail },
      { label: labels.fields.dateOfBirth, value: record.dateOfBirth },
      { label: labels.fields.notes, value: record.notes },
    ].filter((row) => row.value)
  }, [record, labels])

  const initialValues = React.useMemo<HrProfileFormValues>(() => ({
    employeeNumber: record?.employeeNumber ?? '',
    jobTitle: record?.jobTitle ?? '',
    employmentType: record?.employmentType ?? '',
    startDate: record?.startDate ?? '',
    endDate: record?.endDate ?? '',
    workPhone: record?.workPhone ?? '',
    personalPhone: record?.personalPhone ?? '',
    personalEmail: record?.personalEmail ?? '',
    dateOfBirth: record?.dateOfBirth ?? '',
    notes: record?.notes ?? '',
  }), [record])

  const handleSubmit = React.useCallback(async (values: HrProfileFormValues) => {
    // Blank means "no value", not an empty string — the column is nullable and
    // an empty personal email would fail the email check on the next save.
    const payload: Record<string, unknown> = { memberId }
    for (const [key, value] of Object.entries(values)) {
      payload[key] = typeof value === 'string' && value.trim().length === 0 ? null : value
    }
    try {
      if (record) await updateCrud('/api/staff/employee-profiles', { ...payload, id: record.id })
      else await createCrud('/api/staff/employee-profiles', payload)
    } catch (err) {
      if (surfaceRecordConflict(err, t)) return
      throw err
    }
    flash(labels.saved, 'success')
    setDialogOpen(false)
    await load()
  }, [record, memberId, labels.saved, load, t])

  const [recordBusy, setRecordBusy] = React.useState(false)

  const generateRecord = React.useCallback(async () => {
    if (!memberId) return
    setRecordBusy(true)
    try {
      const result = await apiCall('/api/staff/employee-record', {
        method: 'POST',
        body: JSON.stringify({ memberId }),
      })
      flash(result.ok ? labels.recordGenerated : labels.recordFailed, result.ok ? 'success' : 'error')
    } finally {
      setRecordBusy(false)
    }
  }, [memberId, labels.recordGenerated, labels.recordFailed])

  if (!memberId) return null
  if (isLoading) return <LoadingMessage label={t('staff.hrProfile.loading', 'Loading HR profile…')} />
  if (loadError) return <ErrorMessage label={loadError} />

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{labels.title}</h3>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            {/* Only offered once there is something to record. */}
            {record ? (
              <Button type="button" variant="outline" onClick={() => void generateRecord()} disabled={recordBusy}>
                <FileText aria-hidden />
                {labels.generateRecord}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setDialogOpen(true)}>
              <Pencil aria-hidden />
              {record ? labels.edit : labels.add}
            </Button>
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <TabEmptyState
          title={labels.empty}
          actionLabel={canManage ? labels.add : undefined}
          onAction={canManage ? () => setDialogOpen(true) : undefined}
        />
      ) : (
        <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start gap-3">
              <dt className="w-36 shrink-0 text-sm text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 flex-1 text-sm text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{record ? labels.edit : labels.add}</DialogTitle>
          </DialogHeader>
          <CrudForm<HrProfileFormValues>
            fields={fields}
            initialValues={initialValues}
            optimisticLockUpdatedAt={record?.updatedAt ?? null}
            onSubmit={handleSubmit}
            submitLabel={labels.save}
            extraActions={(
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                {labels.cancel}
              </Button>
            )}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
