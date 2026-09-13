"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
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
import { resolvePhoneIdentity } from '@open-mercato/core/modules/customers/lib/contactIdentity'
import { DictionarySelectField } from '@open-mercato/core/modules/customers/components/formConfig'
import { AppointmentServicePicker, type AppointmentBookableService as BookableService, type AppointmentServiceSelection } from '../../../../components/AppointmentServicePicker'

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
  serviceSelections: { productId: string, selectedOptions?: Record<string, unknown> }[]
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

export default function AppointmentEditPage({ params }: { params?: { id?: string | string[] } }) {
  const appointmentId = typeof params?.id === 'string' ? params.id : (Array.isArray(params?.id) ? params.id[0] : '')
  const t = useT()
  const router = useRouter()
  const { organizationId: scopeOrganizationId, tenantId } = useOrganizationScopeDetail()
  const [initialData, setInitialData] = React.useState<FormValues | null>(null)
  const [dataLoading, setDataLoading] = React.useState(true)
  const [locationOptions, setLocationOptions] = React.useState<LocationOption[]>([])
  const [locationsLoading, setLocationsLoading] = React.useState(true)
  const [locationId, setLocationId] = React.useState<string | null>(scopeOrganizationId)
  const [services, setServices] = React.useState<BookableService[]>([])
  const [servicesLoading, setServicesLoading] = React.useState(false)
  const [servicesError, setServicesError] = React.useState<string | null>(null)
  const [lookupLoading, setLookupLoading] = React.useState(false)
  const { runMutation } = useGuardedMutation({
    contextId: 'appointments.update',
  })

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function loadLocations() {
      setLocationsLoading(true)
      try {
        const call = await apiCall<{
          items?: OrgSwitcherNode[]
          selectedId?: string | null
        }>('/api/directory/organization-switcher', { signal: controller.signal }, { fallback: null })
        if (cancelled) return
        if (!call.ok || !call.result) {
          setLocationOptions([])
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
      } catch (err) {
        if (!cancelled) console.error(err)
      } finally {
        if (!cancelled) setLocationsLoading(false)
      }
    }
    void loadLocations()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [scopeOrganizationId, tenantId])

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function loadServices() {
      if (!tenantId) {
        setServices([])
        setServicesError(null)
        setServicesLoading(false)
        return
      }
      setServicesLoading(true)
      setServicesError(null)
      try {
        const params = new URLSearchParams({
          tenantId,
        })
        const call = await apiCall<{ items?: BookableService[]; error?: string }>(
          `/api/catalog/bookable-services?${params.toString()}`,
          { signal: controller.signal },
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
      } catch (err) {
        if (!cancelled) {
          setServicesError(t('appointments.create.services.error'))
        }
      } finally {
        if (!cancelled) setServicesLoading(false)
      }
    }
    void loadServices()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [tenantId, t])

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
          router.push('/backend/appointments')
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
        router.push('/backend/appointments')
      } finally {
        if (!cancelled) setDataLoading(false)
      }
    }
    void loadData()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [appointmentId, router, t])

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
                setFormValue?.('serviceSelections', [])
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
        id: 'serviceSelections',
        label: t('appointments.create.field.services'),
        type: 'custom',
        required: true,
        description: t('appointments.create.services.hint'),
        component: ({ value, setValue, disabled }) => {
          let emptyLabel = t('appointments.create.services.empty')
          if (!tenantId) {
            emptyLabel = t('appointments.create.error.scope')
          } else if (servicesLoading) {
            emptyLabel = t('appointments.create.services.loading')
          } else if (servicesError) {
            emptyLabel = servicesError
          }
          return (
            <AppointmentServicePicker
              services={services}
              loading={servicesLoading}
              disabled={disabled}
              emptyLabel={emptyLabel}
              value={Array.isArray(value) ? value : []}
              onChange={(next: AppointmentServiceSelection[]) => setValue(next)}
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
        fields: ['serviceSelections'],
      },
    ],
    [t],
  )

  if (dataLoading || !initialData) {
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
          title={t('appointments.edit.title', 'Edit appointment')}
          backHref="/backend/appointments"
          fields={fields}
          groups={groups}
          initialValues={initialData}
          submitLabel={t('common.save', 'Save')}
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
            const serviceSelections = Array.isArray(values.serviceSelections) ? values.serviceSelections : []
            if (!serviceSelections.length) {
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
                const call = await withScopedApiRequestHeaders(buildOptimisticLockHeader(undefined), () => apiCall<{ id: string; error?: string }>(
                  `/api/appointments/${appointmentId}`,
                  {
                    method: 'PUT',
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
                      lines: serviceSelections.map((sel) => ({
                        productId: sel.productId,
                        selectedOptions: sel.selectedOptions,
                      })),
                    }),
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
