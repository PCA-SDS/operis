"use client"

import * as React from 'react'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Loader2, Search, UserRound, X } from 'lucide-react'
import { PhoneNumberField } from '@open-mercato/ui/backend/inputs/PhoneNumberField'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { isValidPhoneNumber } from '@open-mercato/shared/lib/phone'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
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
import { DictionarySelectField } from '@open-mercato/core/modules/customers/components/formConfig'
import {
  AppointmentServicePicker,
  type AppointmentBookableService as BookableService,
  type AppointmentServiceSelection,
} from './AppointmentServicePicker'
import {
  composePhoneForField,
  flattenSelectableOrganizations,
  resolvePhoneFromField,
  type LocationOption,
  type OrgSwitcherNode,
} from './appointmentFormHelpers'

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

export type AppointmentCustomerSearchResult = {
  id: string
  displayName: string
  primaryEmail: string | null
  primaryPhone: string | null
  phoneCountryCode: string | null
  salutation: string | null
  origin: string | null
  source: string | null
}

function composePickedPhone(customer: AppointmentCustomerSearchResult): string {
  return composePhoneForField(customer.primaryPhone, customer.phoneCountryCode)
}

export type AppointmentFormFieldsOptions = {
  /** The branch being booked. The page owns it: its own record loader sets it as well. */
  locationId: string | null
  setLocationId: (locationId: string | null) => void
  /** Rendered inside another surface (the seat planner sheet): dropdowns are raised above it. */
  embedded?: boolean
  /** Adds the "update customer profile too" checkbox to the customer group (the edit form). */
  customerProfileToggle?: boolean
  /** How a picked returning customer's phone is written into the phone field. */
  pickedPhone?: (customer: AppointmentCustomerSearchResult) => string
}

/**
 * The customer, visit and services fields the appointment create and edit forms share, with the
 * state behind them: returning-customer search, phone lookup, locations and bookable services.
 */
export function useAppointmentFormFields({
  locationId,
  setLocationId,
  embedded = false,
  customerProfileToggle = false,
  pickedPhone = composePickedPhone,
}: AppointmentFormFieldsOptions) {
  const t = useT()
  const { organizationId: scopeOrganizationId, tenantId } = useOrganizationScopeDetail()
  const [locationOptions, setLocationOptions] = React.useState<LocationOption[]>([])
  const [locationsLoading, setLocationsLoading] = React.useState(true)
  const [services, setServices] = React.useState<BookableService[]>([])
  const [servicesLoading, setServicesLoading] = React.useState(false)
  const [servicesError, setServicesError] = React.useState<string | null>(null)
  const [lookupLoading, setLookupLoading] = React.useState(false)
  const [customerSearch, setCustomerSearch] = React.useState('')
  const [customerSearchResults, setCustomerSearchResults] = React.useState<AppointmentCustomerSearchResult[]>([])
  const [customerSearchOpen, setCustomerSearchOpen] = React.useState(false)
  const [customerSearchLoading, setCustomerSearchLoading] = React.useState(false)

  React.useEffect(() => {
    const query = customerSearch.trim().slice(0, 64)
    setCustomerSearchResults([])
    if (!customerSearchOpen || query.length < 2) {
      setCustomerSearchLoading(false)
      return
    }

    const controller = new AbortController()
    setCustomerSearchLoading(true)
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams({ search: query })
      void apiCall<{ items?: AppointmentCustomerSearchResult[] }>(
        `/api/appointments/customer-search?${params.toString()}`,
        { signal: controller.signal },
        { fallback: null },
      ).then((call) => {
        if (controller.signal.aborted) return
        setCustomerSearchResults(call.ok && Array.isArray(call.result?.items) ? call.result.items : [])
        setCustomerSearchLoading(false)
      }).catch(() => {
        if (controller.signal.aborted) return
        setCustomerSearchResults([])
        setCustomerSearchLoading(false)
      })
    }, 350)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [customerSearch, customerSearchOpen])

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
        if (!(err instanceof DOMException && err.name === 'AbortError') && !cancelled) {
          flash(t('appointments.locations.loadFailed', 'Unable to load locations. Reload the page to try again.'), 'error')
        }
      } finally {
        if (!cancelled) setLocationsLoading(false)
      }
    }
    void loadLocations()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [scopeOrganizationId, tenantId, t, setLocationId])

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function loadServices() {
      if (!tenantId || !locationId) {
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
          organizationId: locationId,
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
  }, [locationId, tenantId, t])

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
        id: 'customerSearch',
        label: t('appointments.create.customerSearch.label', 'Find returning customer'),
        type: 'custom',
        component: ({ setFormValue }) => (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
              <Input
                value={customerSearch}
                onFocus={() => setCustomerSearchOpen(true)}
                onChange={(event) => {
                  setCustomerSearch(event.target.value.slice(0, 64))
                  setCustomerSearchOpen(true)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setCustomerSearchOpen(false)
                }}
                placeholder={t('appointments.create.customerSearch.placeholder', 'Type customer name or phone to search...')}
                autoComplete="off"
                className="pl-9 pr-10"
              />
              {customerSearchLoading ? (
                <Loader2 className="absolute right-3 top-3 size-4 animate-spin text-muted-foreground" />
              ) : customerSearch ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 size-7"
                  aria-label={t('appointments.create.customerSearch.clear', 'Clear customer search')}
                  onClick={() => {
                    setCustomerSearch('')
                    setCustomerSearchResults([])
                    setCustomerSearchOpen(false)
                  }}
                >
                  <X className="size-4" />
                </Button>
              ) : null}
              {customerSearchOpen && customerSearch.trim() ? (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg">
                  <div className="max-h-72 overflow-y-auto p-1">
                    {customerSearch.trim().length < 2 ? (
                      <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                        {t('appointments.create.customerSearch.minimum', 'Type at least 2 characters to search.')}
                      </div>
                    ) : customerSearchLoading && customerSearchResults.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-muted-foreground">
                        {t('appointments.create.customerSearch.loading', 'Searching customers...')}
                      </div>
                    ) : customerSearchResults.length === 0 ? (
                      <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                        {t('appointments.create.customerSearch.empty', 'No customers found.')}
                      </div>
                    ) : customerSearchResults.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent"
                        onClick={() => {
                          if (!setFormValue) return
                          setFormValue('phone', pickedPhone(customer))
                          setFormValue('email', customer.primaryEmail ?? '')
                          setFormValue('name', customer.displayName ?? '')
                          setFormValue('salutation', customer.salutation ?? 'None')
                          const matchingOrigin = APPOINTMENT_ORIGIN_OPTIONS.find((option) => option.value === customer.origin)
                          if (matchingOrigin) setFormValue('origin', matchingOrigin.value)
                          setFormValue('referral', customer.source ?? '')
                          setCustomerSearch('')
                          setCustomerSearchResults([])
                          setCustomerSearchOpen(false)
                          flash(t('appointments.create.customerSearch.selected', 'Customer details filled in.'), 'success')
                        }}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <UserRound className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{customer.displayName || t('appointments.create.customerSearch.unnamed', 'Unnamed customer')}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {[customer.phoneCountryCode, customer.primaryPhone, customer.primaryEmail].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('appointments.create.customerSearch.hint', 'Search by customer name or phone. Suggestions load automatically after you stop typing.')}
            </p>
          </div>
        ),
      },
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
                dropdownElevated={embedded}
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
            selectContentClassName={embedded ? 'z-top' : undefined}
            allowInlineCreate
            showManage
            showActiveAppearance={false}
          />
        ),
      },
      ...(customerProfileToggle
        ? [
            {
              id: 'updateCustomerProfile',
              label: t('appointments.edit.updateCustomerProfile', 'Update customer profile too'),
              type: 'checkbox',
              description: t(
                'appointments.edit.updateCustomerProfileHint',
                'Also update the shared customer profile with these details.',
              ),
            } satisfies CrudField,
          ]
        : []),
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
              <SelectContent className={embedded ? 'z-top' : undefined}>
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
      customerSearch,
      customerSearchOpen,
      customerSearchLoading,
      customerSearchResults,
      services,
      servicesLoading,
      servicesError,
      tenantId,
      locationId,
      setLocationId,
      locationOptions,
      locationsLoading,
      lookupLoading,
      lookupCustomer,
      embedded,
      customerProfileToggle,
      pickedPhone,
    ],
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'customer',
        title: t('appointments.create.group.customer'),
        column: 1,
        fields: customerProfileToggle
          ? ['customerSearch', 'phone', 'salutation', 'name', 'email', 'origin', 'referral', 'updateCustomerProfile']
          : ['customerSearch', 'phone', 'salutation', 'name', 'email', 'origin', 'referral'],
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
    [t, customerProfileToggle],
  )

  return { fields, groups }
}
