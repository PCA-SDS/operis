"use client"

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { AppointmentStatusBadge } from './AppointmentStatusBadge'
import type { AppointmentStatusDto } from '../lib/statusCatalog'

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; status: AppointmentStatusDto }

type FormState = {
  label: string
  code: string
  description: string
  sortOrder: string
}

const EMPTY_FORM: FormState = {
  label: '',
  code: '',
  description: '',
  sortOrder: '100',
}

const SAVE_CONTEXT_ID = 'appointments-status-settings'

export function AppointmentStatusSettings() {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const translate = React.useCallback(
    (key: string, fallback: string) => {
      const value = t(key)
      return value === key ? fallback : value
    },
    [t],
  )
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: SAVE_CONTEXT_ID,
    blockedMessage: translate('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo(
    () => ({
      formId: SAVE_CONTEXT_ID,
      resourceKind: 'appointments.statuses',
      retryLastMutation,
    }),
    [retryLastMutation],
  )

  const [items, setItems] = React.useState<AppointmentStatusDto[]>([])
  const [loading, setLoading] = React.useState(true)
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = React.useState(false)
  const scopeVersion = useOrganizationScopeVersion()

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await readApiResultOrThrow<{ items?: AppointmentStatusDto[] }>(
        '/api/appointments/statuses',
        undefined,
        {
          errorMessage: translate(
            'appointments.config.statuses.error.load',
            'Failed to load statuses.',
          ),
          fallback: { items: [] },
        },
      )
      setItems(Array.isArray(data?.items) ? data.items : [])
    } catch {
      flash(
        translate('appointments.config.statuses.error.load', 'Failed to load statuses.'),
        'error',
      )
    } finally {
      setLoading(false)
    }
  }, [translate])

  React.useEffect(() => {
    void load()
  }, [load, scopeVersion])

  const openCreate = React.useCallback(() => {
    setForm(EMPTY_FORM)
    setDialog({ mode: 'create' })
  }, [])

  const openEdit = React.useCallback((status: AppointmentStatusDto) => {
    setForm({
      label: status.label,
      code: status.code,
      description: status.description ?? '',
      sortOrder: String(status.sortOrder),
    })
    setDialog({ mode: 'edit', status })
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialog(null)
    setForm(EMPTY_FORM)
  }, [])

  const handleDelete = React.useCallback(
    async (status: AppointmentStatusDto) => {
      if (status.isSystem) return
      const confirmed = await confirm({
        title: translate(
          'appointments.config.statuses.deleteConfirm',
          'Delete status "{{label}}"?',
        ).replace('{{label}}', status.label),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        await runMutation({
          operation: async () => {
            const call = await apiCall(
              `/api/appointments/statuses/${encodeURIComponent(status.id)}`,
              { method: 'DELETE' },
            )
            if (!call.ok) {
              await raiseCrudError(
                call.response,
                translate(
                  'appointments.config.statuses.error.delete',
                  'Failed to delete status.',
                ),
              )
            }
            return call
          },
          context: mutationContext,
          mutationPayload: { action: 'delete', id: status.id },
        })
        flash(
          translate('appointments.config.statuses.success.delete', 'Status deleted.'),
          'success',
        )
        await load()
      } catch (err) {
        flash(
          err instanceof Error
            ? err.message
            : translate(
                'appointments.config.statuses.error.delete',
                'Failed to delete status.',
              ),
          'error',
        )
      }
    },
    [confirm, load, mutationContext, runMutation, translate],
  )

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (!dialog) return
      const label = form.label.trim()
      if (!label) {
        flash(
          translate('appointments.config.statuses.error.labelRequired', 'Status name is required.'),
          'error',
        )
        return
      }
      const sortOrder = Number.parseInt(form.sortOrder, 10)
      setSubmitting(true)
      try {
        if (dialog.mode === 'create') {
          await runMutation({
            operation: async () => {
              const call = await apiCall('/api/appointments/statuses', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  label,
                  code: form.code.trim() || undefined,
                  description: form.description.trim() || null,
                  sortOrder: Number.isFinite(sortOrder) ? sortOrder : 100,
                }),
              })
              if (!call.ok) {
                await raiseCrudError(
                  call.response,
                  translate(
                    'appointments.config.statuses.error.save',
                    'Failed to save status.',
                  ),
                )
              }
              return call
            },
            context: mutationContext,
            mutationPayload: { action: 'create', label },
          })
        } else {
          const status = dialog.status
          await runMutation({
            operation: async () => {
              const call = await apiCall(
                `/api/appointments/statuses/${encodeURIComponent(status.id)}`,
                {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    ...(status.isSystem ? {} : { label }),
                    description: form.description.trim() || null,
                    sortOrder: Number.isFinite(sortOrder) ? sortOrder : status.sortOrder,
                  }),
                },
              )
              if (!call.ok) {
                await raiseCrudError(
                  call.response,
                  translate(
                    'appointments.config.statuses.error.save',
                    'Failed to save status.',
                  ),
                )
              }
              return call
            },
            context: mutationContext,
            mutationPayload: { action: 'update', id: status.id },
          })
        }
        flash(
          translate('appointments.config.statuses.success.save', 'Status saved.'),
          'success',
        )
        closeDialog()
        await load()
      } catch (err) {
        flash(
          err instanceof Error
            ? err.message
            : translate('appointments.config.statuses.error.save', 'Failed to save status.'),
          'error',
        )
      } finally {
        setSubmitting(false)
      }
    },
    [closeDialog, dialog, form, load, mutationContext, runMutation, translate],
  )

  const editingSystem = dialog?.mode === 'edit' && dialog.status.isSystem

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">
            {translate('appointments.config.statuses.title', 'Appointment statuses')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {translate(
              'appointments.config.statuses.description',
              'System codes drive workflow actions; labels stay customizable for custom statuses.',
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {translate('appointments.config.statuses.actions.refresh', 'Refresh')}
          </Button>
          <Button type="button" size="sm" onClick={openCreate}>
            {translate('appointments.config.statuses.actions.add', 'Add status')}
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">
          {translate('common.loading', 'Loading…')}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
          {translate('appointments.config.statuses.empty', 'No statuses yet.')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((status) => (
            <li
              key={status.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-input-bg/40 px-3 py-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <AppointmentStatusBadge statusCode={status.code} label={status.label} />
                  {status.isSystem ? (
                    <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {translate('appointments.config.statuses.systemBadge', 'System')}
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {status.code}
                  {status.description ? ` · ${status.description}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => openEdit(status)}>
                  {translate('appointments.config.statuses.actions.edit', 'Edit')}
                </Button>
                {!status.isSystem ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void handleDelete(status)
                    }}
                  >
                    {translate('appointments.config.statuses.actions.delete', 'Delete')}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialog != null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit'
                ? translate('appointments.config.statuses.dialog.editTitle', 'Edit status')
                : translate('appointments.config.statuses.dialog.addTitle', 'Add status')}
            </DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <div className="space-y-2">
              <Label htmlFor="appointment-status-label">
                {translate('appointments.config.statuses.dialog.labelLabel', 'Label')}
              </Label>
              <Input
                id="appointment-status-label"
                value={form.label}
                disabled={editingSystem || submitting}
                onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
                required
              />
              {editingSystem ? (
                <p className="text-xs text-muted-foreground">
                  {translate(
                    'appointments.config.statuses.dialog.systemLabelHint',
                    'System status names cannot be renamed.',
                  )}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="appointment-status-code">
                {translate('appointments.config.statuses.dialog.codeLabel', 'Code')}
              </Label>
              <Input
                id="appointment-status-code"
                value={form.code}
                disabled={dialog?.mode === 'edit' || submitting}
                placeholder={translate(
                  'appointments.config.statuses.dialog.codePlaceholder',
                  'Auto from label if empty',
                )}
                onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="appointment-status-description">
                {translate('appointments.config.statuses.dialog.descriptionLabel', 'Description')}
              </Label>
              <Textarea
                id="appointment-status-description"
                value={form.description}
                disabled={submitting}
                rows={3}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, description: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="appointment-status-sort">
                {translate('appointments.config.statuses.dialog.sortOrderLabel', 'Sort order')}
              </Label>
              <Input
                id="appointment-status-sort"
                type="number"
                min={0}
                value={form.sortOrder}
                disabled={submitting}
                onChange={(event) => setForm((prev) => ({ ...prev, sortOrder: event.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
                {translate('appointments.config.statuses.dialog.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={submitting}>
                {translate('appointments.config.statuses.dialog.save', 'Save')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </section>
  )
}
