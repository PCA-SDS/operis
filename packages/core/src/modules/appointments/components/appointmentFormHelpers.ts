import { PHONE_COUNTRIES } from '@open-mercato/ui/backend/inputs/PhoneNumberField'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { isValidPhoneNumber } from '@open-mercato/shared/lib/phone'
import { formatTreeLabel } from '@open-mercato/shared/lib/tree'
import { resolvePhoneIdentity, type PhoneIdentityParts } from '@open-mercato/core/modules/customers/lib/contactIdentity'
import { splitCustomerName } from '../lib/customerName'

export type OrgSwitcherNode = {
  id: string
  name: string
  depth: number
  selectable: boolean
  children?: OrgSwitcherNode[]
}

export type LocationOption = {
  value: string
  label: string
}

export type AppointmentFormServiceSelection = { productId: string, selectedOptions?: Record<string, unknown> }

/** The values the appointment create and edit forms share. */
export type AppointmentFormValues = {
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
  serviceSelections: AppointmentFormServiceSelection[]
}

export function flattenSelectableOrganizations(
  nodes: OrgSwitcherNode[] | undefined,
  acc: LocationOption[] = [],
  depth = 0,
): LocationOption[] {
  if (!nodes) return acc
  for (const node of nodes) {
    if (node.selectable) {
      acc.push({
        value: node.id,
        label: formatTreeLabel(node.name || node.id, depth),
      })
    }
    flattenSelectableOrganizations(node.children, acc, depth + 1)
  }
  return acc
}

export const COUNTRIES_BY_DIAL_LENGTH = [...PHONE_COUNTRIES].sort(
  (a, b) => b.dialCode.length - a.dialCode.length,
)

export function resolvePhoneFromField(phone: string) {
  const trimmed = phone.trim()
  const country = COUNTRIES_BY_DIAL_LENGTH.find((entry) => trimmed.startsWith(entry.dialCode))
  return resolvePhoneIdentity({
    primaryPhone: trimmed,
    phoneCountryCode: country?.dialCode ?? null,
    phoneCountry: country?.iso2.toLowerCase() ?? null,
  })
}

export function composePhoneForField(
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

/**
 * The edit form's join for a picked returning customer. Unlike {@link composePhoneForField} it
 * does not prefix a stored dial code with "+", and stored dial codes are digits only.
 */
export function joinPhoneWithDialCode(
  phone: string | null | undefined,
  phoneCountryCode: string | null | undefined,
): string {
  const local = phone?.trim() ?? ''
  const dial = phoneCountryCode?.trim() ?? ''
  return local ? (local.startsWith('+') || !dial ? local : `${dial} ${local}`) : ''
}

/** Normalizes Operis TimePicker value (`HH:mm` or `HH:mm:ss`) for ISO datetime composition. */
export function normalizeTimeValue(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(trimmed)
  if (!match) return null
  return `${match[1]}:${match[2]}`
}

export type ValidatedAppointmentForm = {
  organizationId: string
  requestedStartAt: string
  firstName: string
  lastName: string
  salutation: string | null
  phoneIdentity: PhoneIdentityParts
  serviceSelections: AppointmentFormServiceSelection[]
}

/**
 * The pre-submit checks both forms run, in their order. With `attachFieldErrors` a failure also
 * marks the fields it is about (the create form); without it the message is form-level only.
 */
export function validateAppointmentForm(
  values: AppointmentFormValues,
  context: {
    tenantId: string | null | undefined
    locationId: string | null
    t: TranslateFn
    attachFieldErrors: boolean
  },
): ValidatedAppointmentForm {
  const { tenantId, locationId, t, attachFieldErrors } = context
  const failure = (message: string, fields: string[]) =>
    createCrudFormError(
      message,
      attachFieldErrors ? Object.fromEntries(fields.map((field) => [field, message])) : undefined,
    )
  const organizationId =
    (typeof values.location === 'string' && values.location.trim()) ||
    locationId ||
    null
  if (!tenantId || !organizationId) throw failure(t('appointments.create.error.scope'), ['location'])
  const name = values.name.trim()
  if (!name) throw failure(t('appointments.create.error.name'), ['name'])
  if (!values.origin) throw failure(t('appointments.create.error.origin'), ['origin'])
  if (!values.referral) throw failure(t('appointments.create.error.referral'), ['referral'])
  if (!values.bookingType) throw failure(t('appointments.create.error.bookingType'), ['bookingType'])
  const phone = values.phone.trim()
  if (!phone || !isValidPhoneNumber(phone)) throw failure(t('appointments.create.field.phone.invalid'), ['phone'])
  const phoneIdentity = resolvePhoneFromField(phone)
  if (!phoneIdentity.primaryPhone || !phoneIdentity.phoneCountryCode) {
    throw failure(t('appointments.create.field.phone.invalid'), ['phone'])
  }
  const date = values.date.trim()
  const time = normalizeTimeValue(values.time)
  if (!date) throw failure(t('appointments.create.error.datetime'), ['date'])
  if (!time) throw failure(t('appointments.create.error.datetime'), ['time'])
  const serviceSelections = Array.isArray(values.serviceSelections) ? values.serviceSelections : []
  if (!serviceSelections.length) throw failure(t('appointments.create.error.servicesRequired'), ['serviceSelections'])
  const requestedStartAt = new Date(`${date}T${time}:00`).toISOString()
  if (Number.isNaN(new Date(requestedStartAt).getTime())) {
    throw failure(t('appointments.create.error.datetime'), ['date', 'time'])
  }
  const { firstName, lastName } = splitCustomerName(name)
  const salutation =
    values.salutation && values.salutation !== 'None' ? values.salutation.trim() : null
  return { organizationId, requestedStartAt, firstName, lastName, salutation, phoneIdentity, serviceSelections }
}

/** The appointment write body; `extra` lands between the visit fields and the customer. */
export function buildAppointmentRequestBody(
  values: AppointmentFormValues,
  validated: ValidatedAppointmentForm,
  extra: Record<string, unknown> = {},
) {
  return {
    organizationId: validated.organizationId,
    requestedStartAt: validated.requestedStartAt,
    notes: values.notes.trim() || null,
    externalNotes: values.externalNotes.trim() || null,
    bookingType: values.bookingType,
    ...extra,
    customer: {
      firstName: validated.firstName,
      lastName: validated.lastName,
      phone: validated.phoneIdentity.primaryPhone,
      email: values.email.trim() || null,
      salutation: validated.salutation,
      source: values.referral,
      origin: values.origin,
      phoneCountryCode: validated.phoneIdentity.phoneCountryCode,
      phoneCountry: validated.phoneIdentity.phoneCountry,
    },
    lines: validated.serviceSelections.map((sel) => ({
      productId: sel.productId,
      selectedOptions: sel.selectedOptions,
    })),
  }
}
