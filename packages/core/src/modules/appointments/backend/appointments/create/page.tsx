"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  PhoneNumberField,
  PHONE_COUNTRIES,
} from '@open-mercato/ui/backend/inputs/PhoneNumberField'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { isValidPhoneNumber } from '@open-mercato/shared/lib/phone'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import {
  APPOINTMENT_BOOKING_TYPE_OPTIONS,
  APPOINTMENT_ORIGIN_OPTIONS,
  APPOINTMENT_SALUTATION_OPTIONS,
} from '@open-mercato/core/modules/appointments/data/constants'
import { splitCustomerName } from '@open-mercato/core/modules/appointments/lib/customerName'
import { formatOrganizationTreeLabel } from '@open-mercato/core/modules/directory/lib/tree'
import { resolvePhoneIdentity } from '@open-mercato/core/modules/customers/lib/phoneIdentity'
import { DictionarySelectField } from '@open-mercato/core/modules/customers/components/formConfig'

type BookableService = {
  id: string
  title: string
  durationMinutes: number | null
  unitPriceGross: string | null
  currencyCode: string | null
}

type FormValues = {
  phone: string
  email: string
  salutation: string
  name: string
  origin: string
  referral: string
  location: string
  bookingType: string
  date: string
  time: string
  notes: string
  externalNotes: string
  productIds: string[]
}

type CheckCustomer = {
  id: string
  name: string
  salutation: string | null
  email: string | null
  phone: string | null
  phoneCountryCode: string | null
  source: string | null
  origin: string | null
}

type OrgSwitcherNode = {
  id: string
  name: string
  depth: number
  selectable: boolean
  children?: OrgSwitcherNode[]
}

type LocationOption = {
  value: string
  label: string
}

function flattenSelectableOrganizations(
  nodes: OrgSwitcherNode[] | undefined,
  acc: LocationOption[] = [],
  depth = 0,
): LocationOption[] {
  if (!nodes) return acc
  for (const node of nodes) {
    if (node.selectable) {
      acc.push({
        value: node.id,
        label: formatOrganizationTreeLabel(node.name || node.id, depth),
      })
    }
    flattenSelectableOrganizations(node.children, acc, depth + 1)
  }
  return acc
}

const COUNTRIES_BY_DIAL_LENGTH = [...PHONE_COUNTRIES].sort(
  (a, b) => b.dialCode.length - a.dialCode.length,
)

function resolvePhoneFromField(phone: string) {
  const trimmed = phone.trim()
  const country = COUNTRIES_BY_DIAL_LENGTH.find((entry) => trimmed.startsWith(entry.dialCode))
  return resolvePhoneIdentity({
    primaryPhone: trimmed,
    phoneCountryCode: country?.dialCode ?? null,
    phoneCountry: country?.iso2.toLowerCase() ?? null,
  })
}

function composePhoneForField(
  phone: string | null | undefined,
  phoneCountryCode: string | null | undefined,
): string {
  const local = typeof phone === 'string' ? phone.trim() : ''
  if (!local) return ''
  if (local.startsWith('+')) return local
  const dial = typeof phoneCountryCode === 'string' ? phoneCountryCode.trim() : ''
  if (!dial) return local
  const withPlus = dial.startsWith('+') ? dial : `+${dial}`
  return `${withPlus} ${local}`
}

/** Normalizes Operis TimePicker value (`HH:mm` or `HH:mm:ss`) for ISO datetime composition. */
function normalizeTimeValue(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(trimmed)
  if (!match) return null
  return `${match[1]}:${match[2]}`
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
  const { organizationId: scopeOrganizationId, tenantId } = useOrganizationScopeDetail()
  const [locationOptions, setLocationOptions] = React.useState<LocationOption[]>([])
  const [locationsLoading, setLocationsLoading] = React.useState(true)
  const [locationId, setLocationId] = React.useState<string | null>(scopeOrganizationId)
  const [services, setServices] = React.useState<BookableService[]>([])
  const [servicesLoading, setServicesLoading] = React.useState(false)
  const [servicesError, setServicesError] = React.useState<string | null>(null)
  const [lookupLoading, setLookupLoading] = React.useState(false)
  const { runMutation } = useGuardedMutation({
    contextId: 'appointments.create',
  })

  React.useEffect(() => {
    let cancelled = false
    async function loadLocations() {
      setLocationsLoading(true)
      const call = await apiCall<{
        items?: OrgSwitcherNode[]
        selectedId?: string | null
      }>('/api/directory/organization-switcher', undefined, { fallback: null })
      if (cancelled) return
      if (!call.ok || !call.result) {
        setLocationOptions([])
        setLocationsLoading(false)
        return
      }
      const options = flattenSelectableOrganizations(call.result.items)
      setLocationOptions(options)
      const optionIds = new Set(options.map((option) => option.value))
      const preferred =
        (scopeOrganizationId && optionIds.has(scopeOrganizationId) ? scopeOrganizationId : null) ||
        (typeof call.result.selectedId === 'string' && optionIds.has(call.result.selectedId)
          ? call.result.selectedId
          : null) ||
        options[0]?.value ||
        null
      setLocationId(preferred)
      setLocationsLoading(false)
    }
    void loadLocations()
    return () => {
      cancelled = true
    }
  }, [scopeOrganizationId, tenantId])

  React.useEffect(() => {
    let cancelled = false
    async function loadServices() {
      if (!tenantId || !locationId) {
        setServices([])
        setServicesError(null)
        setServicesLoading(false)
        return
      }
      setServicesLoading(true)
      setServicesError(null)
      const params = new URLSearchParams({
        tenantId,
        organizationId: locationId,
      })
      const call = await apiCall<{ items?: BookableService[]; error?: string }>(
        `/api/catalog/bookable-services?${params.toString()}`,
        undefined,
        { fallback: null },
      )
      if (cancelled) return
      if (!call.ok) {
        setServices([])
        setServicesError(
          typeof call.result?.error === 'string'
            ? call.result.error
            : t('appointments.create.services.error'),
        )
      } else {
        setServices(Array.isArray(call.result?.items) ? call.result.items : [])
        setServicesError(null)
      }
      setServicesLoading(false)
    }
    void loadServices()
    return () => {
      cancelled = true
    }
  }, [tenantId, locationId, t])

  const lookupCustomer = React.useCallback(
    async (
      values: Record<string, unknown> | undefined,
      setFormValue?: (id: string, value: unknown) => void,
    ) => {
      if (!tenantId || !setFormValue) return
      const phone = typeof values?.phone === 'string' ? values.phone.trim() : ''
      if (!phone || !isValidPhoneNumber(phone)) {
        flash(t('appointments.create.lookup.phoneRequired'), 'error')
        return
      }
      const phoneIdentity = resolvePhoneFromField(phone)
      setLookupLoading(true)
      try {
        const call = await apiCall<{
          exists?: boolean
          customer?: CheckCustomer | null
          error?: string
        }>(
          '/api/customers/people/check',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              tenantId,
              phone: phoneIdentity.primaryPhone,
              phoneCountryCode: phoneIdentity.phoneCountryCode,
              phoneCountry: phoneIdentity.phoneCountry,
            }),
          },
          { fallback: null },
        )
        if (!call.ok) {
          flash(
            typeof call.result?.error === 'string'
              ? call.result.error
              : t('appointments.create.lookup.failed'),
            'error',
          )
          return
        }
        if (!call.result?.exists || !call.result.customer) {
          flash(t('appointments.create.lookup.notFound'), 'info')
          return
        }
        const customer = call.result.customer
        setFormValue('name', customer.name || '')
        setFormValue('email', customer.email || '')
        setFormValue('salutation', customer.salutation || 'None')
        setFormValue('phone', composePhoneForField(customer.phone, customer.phoneCountryCode))
        if (customer.origin) {
          const match = APPOINTMENT_ORIGIN_OPTIONS.find((option) => option.value === customer.origin)
          if (match) setFormValue('origin', match.value)
        }
        if (customer.source) {
          setFormValue('referral', customer.source)
        }
        flash(t('appointments.create.lookup.found'), 'success')
      } finally {
        setLookupLoading(false)
      }
    },
    [tenantId, t],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'phone',
        label: t('appointments.create.field.phone'),
        type: 'custom',
        required: true,
        rendersOwnError: true,
        component: ({ value, setValue, error, disabled, autoFocus, values, setFormValue }) => (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <PhoneNumberField
                value={typeof value === 'string' ? value : null}
                onValueChange={(next) => setValue(typeof next === 'string' ? next : '')}
                externalError={error}
                autoFocus={autoFocus}
                disabled={disabled}
                placeholder={t('appointments.create.field.phone.placeholder')}
                invalidLabel={t('appointments.create.field.phone.invalid')}
                minDigits={7}
                defaultCountryIso2="VN"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="shrink-0 sm:mt-0"
              disabled={lookupLoading || !tenantId || disabled}
              onClick={() => {
                void lookupCustomer(values, setFormValue)
              }}
            >
              {lookupLoading ? t('appointments.create.services.loading') : t('appointments.create.lookup')}
            </Button>
          </div>
        ),
      },
      {
        id: 'email',
        label: t('appointments.create.field.email'),
        type: 'text',
      },
      {
        id: 'salutation',
        label: t('appointments.create.field.salutation'),
        type: 'select',
        layout: 'half',
        options: APPOINTMENT_SALUTATION_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
        })),
      },
      {
        id: 'name',
        label: t('appointments.create.field.name'),
        type: 'text',
        required: true,
        layout: 'half',
      },
      {
        id: 'origin',
        label: t('appointments.create.field.origin'),
        type: 'select',
        required: true,
        layout: 'half',
        options: APPOINTMENT_ORIGIN_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
        })),
      },
      {
        id: 'referral',
        label: t('appointments.create.field.referral'),
        type: 'custom',
        required: true,
        layout: 'half',
        component: ({ value, setValue }) => (
          <DictionarySelectField
            kind="sources"
            value={typeof value === 'string' && value.length ? value : undefined}
            onChange={(next) => setValue(next ?? '')}
            labels={{
              placeholder: t('appointments.create.field.referral.placeholder', 'Select a source'),
              addLabel: t('customers.people.form.dictionary.addSource', 'Add source'),
              addPrompt: t('customers.people.form.dictionary.promptSource', 'Enter a new source'),
              dialogTitle: t('customers.people.form.dictionary.dialogTitleSource', 'Add source'),
              valueLabel: t('customers.people.form.dictionary.valueLabel', 'Value'),
              valuePlaceholder: t('customers.people.form.dictionary.valuePlaceholder', 'Value'),
              labelLabel: t('customers.config.dictionaries.dialog.labelLabel', 'Label'),
              labelPlaceholder: t('customers.people.form.dictionary.labelPlaceholder', 'Display name shown in UI'),
              emptyError: t('customers.people.form.dictionary.errorRequired'),
              cancelLabel: t('customers.people.form.dictionary.cancel'),
              saveLabel: t('customers.people.form.dictionary.save'),
              errorLoad: t('customers.people.form.dictionary.errorLoad'),
              errorSave: t('customers.people.form.dictionary.error'),
              loadingLabel: t('customers.people.form.dictionary.loading'),
              manageTitle: t('customers.people.form.dictionary.manage'),
            }}
            allowInlineCreate
            showManage
            showActiveAppearance={false}
          />
        ),
      },
      {
        id: 'location',
        label: t('appointments.create.field.location'),
        type: 'custom',
        required: true,
        layout: 'half',
        description: t(
          'appointments.create.field.locationHint',
          'Pick the branch for this booking. Defaults to your current organization.',
        ),
        component: ({ value, setValue, setFormValue, disabled }) => {
          const selected =
            (typeof value === 'string' && value.trim()) || locationId || undefined
          if (locationsLoading) {
            return (
              <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted-foreground">
                {t('appointments.create.field.location.loading', 'Loading locations…')}
              </p>
            )
          }
          if (!locationOptions.length) {
            return (
              <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted-foreground">
                {t('appointments.create.error.scope')}
              </p>
            )
          }
          return (
            <Select
              value={selected}
              disabled={disabled}
              onValueChange={(next) => {
                const nextId = next.trim() || null
                setLocationId(nextId)
                setValue(nextId ?? '')
                setFormValue?.('productIds', [])
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={t(
                    'appointments.create.field.location.placeholder',
                    'Select a location',
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {locationOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        },
      },
      {
        id: 'bookingType',
        label: t('appointments.create.field.bookingType'),
        type: 'select',
        required: true,
        layout: 'half',
        options: APPOINTMENT_BOOKING_TYPE_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
        })),
      },
      {
        id: 'date',
        label: t('appointments.create.field.date'),
        type: 'date',
        required: true,
        layout: 'half',
        placeholder: t('appointments.create.field.date.placeholder', 'Select a date'),
      },
      {
        id: 'time',
        label: t('appointments.create.field.time'),
        type: 'time',
        required: true,
        layout: 'half',
        // System TimePicker stays full-day by default; appointments narrows to
        // TPS booking hours (09:00–20:00) + 24h labels + period sections.
        minuteStep: 30,
        timeFormat: '24h',
        startTime: '09:00',
        endTime: '20:00',
        groupByPeriod: true,
        periodLabels: {
          morning: t('appointments.create.field.time.period.morning', 'Morning'),
          afternoon: t('appointments.create.field.time.period.afternoon', 'Afternoon'),
          evening: t('appointments.create.field.time.period.evening', 'Evening'),
        },
        placeholder: t('appointments.create.field.time.placeholder', 'Pick a time'),
      },
      {
        id: 'notes',
        label: t('appointments.create.field.notes'),
        type: 'textarea',
        layout: 'half',
      },
      {
        id: 'externalNotes',
        label: t('appointments.create.field.externalNotes'),
        type: 'textarea',
        layout: 'half',
      },
      {
        id: 'productIds',
        label: t('appointments.create.field.services'),
        type: 'custom',
        required: true,
        description: t('appointments.create.services.hint'),
        component: ({ value, setValue }) => {
          let emptyLabel = t('appointments.create.services.empty')
          if (!tenantId || !locationId) {
            emptyLabel = t('appointments.create.error.scope')
          } else if (servicesLoading) {
            emptyLabel = t('appointments.create.services.loading')
          } else if (servicesError) {
            emptyLabel = servicesError
          }
          return (
            <ServiceChecklist
              services={services}
              loading={servicesLoading}
              emptyLabel={emptyLabel}
              value={Array.isArray(value) ? (value as string[]) : []}
              setValue={(next) => setValue(next)}
            />
          )
        },
      },
    ],
    [
      t,
      services,
      servicesLoading,
      servicesError,
      tenantId,
      locationId,
      locationOptions,
      locationsLoading,
      lookupLoading,
      lookupCustomer,
    ],
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'customer',
        title: t('appointments.create.group.customer'),
        column: 1,
        fields: ['phone', 'salutation', 'name', 'email', 'origin', 'referral'],
      },
      {
        id: 'visit',
        title: t('appointments.create.group.visit'),
        column: 1,
        fields: ['location', 'bookingType', 'date', 'time', 'notes', 'externalNotes'],
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
            productIds: [],
          }}
          submitLabel={t('common.create')}
          cancelHref="/backend/appointments"
          onSubmit={async (values) => {
            const selectedOrganizationId =
              (typeof values.location === 'string' && values.location.trim()) ||
              locationId ||
              null
            if (!tenantId || !selectedOrganizationId) {
              throw createCrudFormError(t('appointments.create.error.scope'))
            }
            const name = values.name.trim()
            if (!name) {
              throw createCrudFormError(t('appointments.create.error.name'))
            }
            if (!values.origin) {
              throw createCrudFormError(t('appointments.create.error.origin'))
            }
            if (!values.referral) {
              throw createCrudFormError(t('appointments.create.error.referral'))
            }
            if (!values.bookingType) {
              throw createCrudFormError(t('appointments.create.error.bookingType'))
            }
            const phone = values.phone.trim()
            if (!phone || !isValidPhoneNumber(phone)) {
              throw createCrudFormError(t('appointments.create.field.phone.invalid'))
            }
            const phoneIdentity = resolvePhoneFromField(phone)
            if (!phoneIdentity.primaryPhone || !phoneIdentity.phoneCountryCode) {
              throw createCrudFormError(t('appointments.create.field.phone.invalid'))
            }
            const date = values.date.trim()
            const time = normalizeTimeValue(values.time)
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
            const { firstName, lastName } = splitCustomerName(name)
            const salutation =
              values.salutation && values.salutation !== 'None' ? values.salutation.trim() : null
            const result = await runMutation({
              operation: async () => {
                const call = await apiCall<{ id: string; error?: string }>(
                  '/api/appointments',
                  {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      organizationId: selectedOrganizationId,
                      requestedStartAt,
                      notes: values.notes.trim() || null,
                      externalNotes: values.externalNotes.trim() || null,
                      bookingType: values.bookingType,
                      customer: {
                        firstName,
                        lastName,
                        phone: phoneIdentity.primaryPhone,
                        email: values.email.trim() || null,
                        salutation,
                        source: values.referral,
                        origin: values.origin,
                        phoneCountryCode: phoneIdentity.phoneCountryCode,
                        phoneCountry: phoneIdentity.phoneCountry,
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
