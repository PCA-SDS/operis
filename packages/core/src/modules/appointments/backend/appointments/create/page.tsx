"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'

type BookableService = {
  id: string
  title: string
  durationMinutes: number | null
  unitPriceGross: string | null
  currencyCode: string | null
}

type FormValues = {
  firstName: string
  lastName: string
  phone: string
  email: string
  salutation: string
  date: string
  time: string
  notes: string
  productIds: string[]
}

function ServiceChecklist({
  services,
  loading,
  emptyLabel,
  value,
  setValue,
}: {
  services: BookableService[]
  loading: boolean
  emptyLabel: string
  value: string[]
  setValue: (next: string[]) => void
}) {
  const selected = new Set(Array.isArray(value) ? value : [])
  if (loading) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  if (!services.length) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <ul className="space-y-2 rounded-md border border-border bg-surface p-3">
      {services.map((service) => {
        const checked = selected.has(service.id)
        const meta = [
          service.durationMinutes != null ? `${service.durationMinutes} min` : null,
          service.unitPriceGross
            ? `${service.unitPriceGross}${service.currencyCode ? ` ${service.currencyCode}` : ''}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <li key={service.id}>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={checked}
                onChange={() => {
                  const next = new Set(selected)
                  if (checked) next.delete(service.id)
                  else next.add(service.id)
                  setValue(Array.from(next))
                }}
              />
              <span>
                <span className="font-medium text-foreground">{service.title}</span>
                {meta ? <span className="mt-0.5 block text-muted-foreground">{meta}</span> : null}
              </span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

export default function AppointmentCreatePage() {
  const t = useT()
  const router = useRouter()
  const { organizationId, tenantId } = useOrganizationScopeDetail()
  const [services, setServices] = React.useState<BookableService[]>([])
  const [servicesLoading, setServicesLoading] = React.useState(false)
  const { runMutation } = useGuardedMutation({
    contextId: 'appointments.create',
  })

  React.useEffect(() => {
    let cancelled = false
    async function loadServices() {
      if (!tenantId || !organizationId) {
        setServices([])
        return
      }
      setServicesLoading(true)
      const params = new URLSearchParams({
        tenantId,
        organizationId,
      })
      const call = await apiCall<{ items?: BookableService[] }>(
        `/api/catalog/bookable-services?${params.toString()}`,
        undefined,
        { fallback: { items: [] } },
      )
      if (cancelled) return
      setServices(call.ok && Array.isArray(call.result?.items) ? call.result.items : [])
      setServicesLoading(false)
    }
    void loadServices()
    return () => {
      cancelled = true
    }
  }, [tenantId, organizationId])

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'firstName',
        label: t('appointments.create.field.firstName'),
        type: 'text',
        required: true,
      },
      {
        id: 'lastName',
        label: t('appointments.create.field.lastName'),
        type: 'text',
        required: true,
      },
      {
        id: 'phone',
        label: t('appointments.create.field.phone'),
        type: 'text',
        required: true,
      },
      {
        id: 'email',
        label: t('appointments.create.field.email'),
        type: 'text',
      },
      {
        id: 'salutation',
        label: t('appointments.create.field.salutation'),
        type: 'text',
      },
      {
        id: 'date',
        label: t('appointments.create.field.date'),
        type: 'text',
        required: true,
        placeholder: 'YYYY-MM-DD',
      },
      {
        id: 'time',
        label: t('appointments.create.field.time'),
        type: 'text',
        required: true,
        placeholder: 'HH:mm',
      },
      {
        id: 'notes',
        label: t('appointments.create.field.notes'),
        type: 'textarea',
      },
      {
        id: 'productIds',
        label: t('appointments.create.field.services'),
        type: 'custom',
        required: true,
        description: t('appointments.create.services.hint'),
        component: ({ value, setValue }) => (
          <ServiceChecklist
            services={services}
            loading={servicesLoading}
            emptyLabel={
              servicesLoading
                ? t('appointments.create.services.loading')
                : t('appointments.create.services.empty')
            }
            value={Array.isArray(value) ? (value as string[]) : []}
            setValue={(next) => setValue(next)}
          />
        ),
      },
    ],
    [t, services, servicesLoading],
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'customer',
        title: t('appointments.create.group.customer'),
        column: 1,
        fields: ['firstName', 'lastName', 'phone', 'email', 'salutation'],
      },
      {
        id: 'visit',
        title: t('appointments.create.group.visit'),
        column: 2,
        fields: ['date', 'time', 'notes'],
      },
      {
        id: 'services',
        title: t('appointments.create.group.services'),
        column: 1,
        fields: ['productIds'],
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <CrudForm<FormValues>
          title={t('appointments.create.title')}
          backHref="/backend/appointments"
          fields={fields}
          groups={groups}
          initialValues={{
            firstName: '',
            lastName: '',
            phone: '',
            email: '',
            salutation: '',
            date: '',
            time: '',
            notes: '',
            productIds: [],
          }}
          submitLabel={t('common.create')}
          cancelHref="/backend/appointments"
          onSubmit={async (values) => {
            if (!tenantId || !organizationId) {
              throw createCrudFormError(t('appointments.create.error.scope'))
            }
            const date = values.date.trim()
            const time = values.time.trim()
            if (!date || !time) {
              throw createCrudFormError(t('appointments.create.error.datetime'))
            }
            const productIds = Array.isArray(values.productIds) ? values.productIds : []
            if (!productIds.length) {
              throw createCrudFormError(t('appointments.create.error.servicesRequired'))
            }
            const requestedStartAt = new Date(`${date}T${time}:00`).toISOString()
            if (Number.isNaN(new Date(requestedStartAt).getTime())) {
              throw createCrudFormError(t('appointments.create.error.datetime'))
            }
            const result = await runMutation({
              operation: async () => {
                const call = await apiCall<{ id: string; error?: string }>(
                  '/api/appointments',
                  {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      requestedStartAt,
                      notes: values.notes.trim() || null,
                      customer: {
                        firstName: values.firstName.trim(),
                        lastName: values.lastName.trim(),
                        phone: values.phone.trim(),
                        email: values.email.trim() || null,
                        salutation: values.salutation.trim() || null,
                      },
                      lines: productIds.map((productId) => ({ productId })),
                    }),
                  },
                  { fallback: null },
                )
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
