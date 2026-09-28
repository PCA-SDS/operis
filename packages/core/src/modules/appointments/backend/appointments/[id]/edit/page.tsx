"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
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
import {
  useAppointmentFormFields,
  type AppointmentCustomerSearchResult,
} from '../../../../components/useAppointmentFormFields'
import {
  buildAppointmentRequestBody,
  composePhoneForField,
  joinPhoneWithDialCode,
  validateAppointmentForm,
  type AppointmentFormValues,
} from '../../../../components/appointmentFormHelpers'

type FormValues = AppointmentFormValues & {
  updateCustomerProfile: boolean
  customerUpdatedAt: string | null
}

function pickedCustomerPhone(customer: AppointmentCustomerSearchResult): string {
  return joinPhoneWithDialCode(customer.primaryPhone, customer.phoneCountryCode)
}

export function AppointmentEditForm({
  params,
  embedded = false,
  onSaved,
}: {
  params?: { id?: string | string[] }
  embedded?: boolean
  onSaved?: () => Promise<void> | void
}) {
  const appointmentId = typeof params?.id === 'string' ? params.id : (Array.isArray(params?.id) ? params.id[0] : '')
  const t = useT()
  const router = useRouter()
  const { organizationId: scopeOrganizationId, tenantId } = useOrganizationScopeDetail()
  const [initialData, setInitialData] = React.useState<FormValues | null>(null)
  const [dataLoading, setDataLoading] = React.useState(true)
  const [locationId, setLocationId] = React.useState<string | null>(scopeOrganizationId)
  const { runMutation } = useGuardedMutation({
    contextId: 'appointments.update',
  })
  const { fields, groups } = useAppointmentFormFields({
    locationId,
    setLocationId,
    embedded,
    customerProfileToggle: true,
    pickedPhone: pickedCustomerPhone,
  })

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function loadData() {
      if (!appointmentId) return
      setDataLoading(true)
      try {
        const call = await apiCall<any>(`/api/appointments/${appointmentId}`, { signal: controller.signal }, { fallback: null })
        if (cancelled) return
        if (!call.ok || !call.result) {
          if (!embedded) router.push('/backend/appointments')
          return
        }
        const data = call.result
        const dateObj = new Date(data.requestedStartAt)
        const year = dateObj.getFullYear()
        const month = String(dateObj.getMonth() + 1).padStart(2, '0')
        const day = String(dateObj.getDate()).padStart(2, '0')
        const hours = String(dateObj.getHours()).padStart(2, '0')
        const minutes = String(dateObj.getMinutes()).padStart(2, '0')

        setLocationId(data.organizationId)

        setInitialData({
          phone: composePhoneForField(data.customerPhone, data.customerPhoneCountryCode),
          email: data.customerEmail || '',
          salutation: data.customerSalutation || 'None',
          name: data.customerName || '',
          origin: data.customerOrigin || '',
          referral: data.customerSource || '',
          updateCustomerProfile: false,
          customerUpdatedAt: data.customerUpdatedAt || null,
          location: data.organizationId || '',
          bookingType: data.bookingType || '',
          date: `${year}-${month}-${day}`,
          time: `${hours}:${minutes}`,
          notes: data.notes || '',
          externalNotes: data.externalNotes || '',
          serviceSelections: data.lines?.map((line: any) => ({
            productId: line.productId,
            selectedOptions: line.selectedOptions || {}
          })) || [],
        })
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return
        // The !ok branch above redirects; a thrown error used to leave the page
        // on "Loading..." forever, because initialData stays null and nothing
        // tells the user why.
        flash(t('appointments.edit.loadFailed', 'Unable to load this appointment.'), 'error')
        if (!embedded) router.push('/backend/appointments')
      } finally {
        if (!cancelled) setDataLoading(false)
      }
    }
    void loadData()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [appointmentId, embedded, router, t])

  if (dataLoading || !initialData) {
    if (embedded) {
      return <div className="flex min-h-64 items-center justify-center text-muted-foreground">{t('common.loading', 'Loading…')}</div>
    }
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

  const form = (
    <CrudForm<FormValues>
          title={t('appointments.edit.title', 'Edit appointment')}
          backHref="/backend/appointments"
          fields={fields}
          groups={groups}
          initialValues={initialData}
          embedded={embedded}
          submitLabel={t('common.save', 'Save')}
          cancelHref="/backend/appointments"
          onSubmit={async (values) => {
            const validated = validateAppointmentForm(values, { tenantId, locationId, t, attachFieldErrors: false })
            const result = await runMutation({
              operation: async () => {
                const call = await withScopedApiRequestHeaders(buildOptimisticLockHeader(undefined), () => apiCall<{ id: string; error?: string }>(
                  `/api/appointments/${appointmentId}`,
                  {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(buildAppointmentRequestBody(values, validated, {
                      updateCustomerProfile: values.updateCustomerProfile === true,
                      ...(values.updateCustomerProfile && values.customerUpdatedAt
                        ? { customerUpdatedAt: values.customerUpdatedAt }
                        : {}),
                    })),
                  },
                  { fallback: null },
                ))
                if (!call.ok) {
                  const errorPayload = call.result as { error?: string } | undefined
                  throw createCrudFormError(
                    typeof errorPayload?.error === 'string'
                      ? errorPayload.error
                      : t('appointments.create.failed'),
                  )
                }
                return call.result
              },
              context: {},
            })
            flash(t('appointments.update.success', 'Appointment updated'), 'success')
            if (embedded) {
              await onSaved?.()
              return
            }
            if (result?.id) {
              router.push(`/backend/appointments/${result.id}`)
            } else {
              router.push('/backend/appointments')
            }
          }}
        />
  )

  if (embedded) return form
  return (
    <Page>
      <PageBody>{form}</PageBody>
    </Page>
  )
}

export default function AppointmentEditPage({ params }: { params?: { id?: string | string[] } }) {
  return <AppointmentEditForm params={params} />
}
