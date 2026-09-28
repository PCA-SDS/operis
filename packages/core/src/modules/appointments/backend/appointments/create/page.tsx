"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { mapAppointmentCreateValidationIssues } from '@open-mercato/core/modules/appointments/lib/appointmentCreateValidation'
import { useAppointmentFormFields } from '../../../components/useAppointmentFormFields'
import {
  buildAppointmentRequestBody,
  composePhoneForField,
  validateAppointmentForm,
  type AppointmentFormValues as FormValues,
} from '../../../components/appointmentFormHelpers'

export default function AppointmentCreatePage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const cloneId = searchParams?.get('cloneId')
  const { organizationId: scopeOrganizationId, tenantId } = useOrganizationScopeDetail()
  const [locationId, setLocationId] = React.useState<string | null>(scopeOrganizationId)
  const [initialData, setInitialData] = React.useState<FormValues | null>(null)

  const { runMutation } = useGuardedMutation({
    contextId: 'appointments.create',
  })

  React.useEffect(() => {
    if (!cloneId) {
      setInitialData({
        phone: '',
        email: '',
        salutation: 'None',
        name: '',
        origin: '',
        referral: '',
        location: locationId ?? '',
        bookingType: '',
        date: '',
        time: '',
        notes: '',
        externalNotes: '',
        serviceSelections: [],
      })
      return
    }

    let cancelled = false
    const controller = new AbortController()
    async function loadClone() {
      try {
        const call = await apiCall<any>(`/api/appointments/${cloneId}`, { signal: controller.signal }, { fallback: null })
        if (cancelled) return
        if (call.ok && call.result) {
          const data = call.result
          if (data.organizationId) setLocationId(data.organizationId)

          setInitialData({
            phone: composePhoneForField(data.customerPhone, data.customerPhoneCountryCode),
            email: data.customerEmail || '',
            salutation: data.customerSalutation || 'None',
            name: data.customerName || '',
            origin: data.customerOrigin || '',
            referral: data.customerSource || '',
            location: data.organizationId || locationId || '',
            bookingType: data.bookingType || '',
            // Do not copy old date/time to avoid creating appointments in the past
            date: '',
            time: '',
            notes: data.notes || '',
            externalNotes: data.externalNotes || '',
            serviceSelections: data.lines?.map((line: any) => ({
              productId: line.productId,
              selectedOptions: line.selectedOptions || {}
            })) || [],
          })
        }
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return
        flash(t('appointments.create.cloneSource.loadFailed', 'Unable to load the appointment being cloned.'), 'error')
      }
    }
    void loadClone()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [cloneId, locationId, t])

  const { fields, groups } = useAppointmentFormFields({ locationId, setLocationId })

  if (!initialData) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            {t('common.loading', 'Loading…')}
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<FormValues>
          title={cloneId ? t('appointments.create.titleClone', 'Clone appointment') : t('appointments.create.title')}
          backHref="/backend/appointments"
          fields={fields}
          groups={groups}
          initialValues={initialData}
          submitLabel={t('common.create')}
          cancelHref="/backend/appointments"
          onSubmit={async (values) => {
            const validated = validateAppointmentForm(values, { tenantId, locationId, t, attachFieldErrors: true })
            const result = await runMutation({
              operation: async () => {
                const call = await withScopedApiRequestHeaders(buildOptimisticLockHeader(undefined), () => apiCall<{
                  id?: string
                  error?: string
                  code?: string
                  details?: unknown
                }>(
                  '/api/appointments',
                  {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(buildAppointmentRequestBody(values, validated)),
                  },
                  { fallback: null },
                ))
                if (!call.ok) {
                  const errorPayload = call.result as { error?: string; code?: string; details?: unknown } | undefined
                  const message = typeof errorPayload?.error === 'string'
                    ? errorPayload.error
                    : t('appointments.create.failed')
                  const fieldErrors = mapAppointmentCreateValidationIssues(errorPayload?.details, t)
                  if (errorPayload?.code === 'SCOPE_REQUIRED') fieldErrors.location = message
                  if (errorPayload?.code === 'SERVICE_NOT_BOOKABLE') fieldErrors.serviceSelections = message
                  if (errorPayload?.code === 'INVALID_START_AT') {
                    fieldErrors.date = message
                    fieldErrors.time = message
                  }
                  throw createCrudFormError(message, Object.keys(fieldErrors).length ? fieldErrors : undefined)
                }
                return call.result
              },
              context: {},
            })
            flash(t('appointments.create.success'), 'success')
            if (result?.id) {
              router.push(`/backend/appointments/${result.id}`)
            } else {
              router.push('/backend/appointments')
            }
          }}
        />
      </PageBody>
    </Page>
  )
}
