"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { CrudField, CrudFieldOption, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { loadOrderOptions, resolveOrderLabel } from '../../components/orderLookup'
import { ClaimLineProductPicker, type ClaimProductPick } from '../../components/productLookup'
import { isRecord } from '@open-mercato/shared/lib/guards'
import { normalizeOptionalString } from '@open-mercato/shared/lib/string'
import { toFiniteNumberOrNull } from '@open-mercato/shared/lib/number'
import { normalizeCustomerOption } from '../../components/customerOptions'
import { nullableInteger, dateInputValue } from '../../components/formValues'

export type RegistrationRecord = {
  id: string
  serialNumber: string | null
  productName: string | null
  sku: string | null
  productId: string | null
  variantId: string | null
  customerId: string | null
  orderId: string | null
  purchaseDate: string | null
  warrantyMonths: number | null
  warrantyExpiresAt: string | null
  coverageType: string | null
  source: string | null
  notes: string | null
  updatedAt: string | null
}

export type RegistrationFormValues = Partial<RegistrationRecord> & Record<string, unknown>

const COVERAGE_TYPES = ['standard', 'extended', 'none'] as const
const SOURCES = ['order', 'manual', 'third_party'] as const

function dateToIso(value: unknown): string | null {
  const dateValue = dateInputValue(value)
  if (!dateValue) return null
  const date = new Date(`${dateValue}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function resolveCustomerLabel(value: string, t: TranslateFn): Promise<string> {
  const params = new URLSearchParams({ id: value, page: '1', pageSize: '1' })
  const [people, companies] = await Promise.all([
    apiCall<{ items?: unknown[] }>(`/api/customers/people?${params.toString()}`, undefined, { fallback: { items: [] } }),
    apiCall<{ items?: unknown[] }>(`/api/customers/companies?${params.toString()}`, undefined, { fallback: { items: [] } }),
  ])
  const items = [
    ...(Array.isArray(people.result?.items) ? people.result.items : []),
    ...(Array.isArray(companies.result?.items) ? companies.result.items : []),
  ]
  const option = items.map((item) => normalizeCustomerOption(item, t)).find((item): item is CrudFieldOption => item !== null)
  return option?.label ?? t('warranty_claims.form.customerUnavailable', 'Customer unavailable')
}

export function normalizeRegistration(value: unknown): RegistrationRecord | null {
  if (!isRecord(value)) return null
  const id = normalizeOptionalString(value.id)
  if (!id) return null
  return {
    id,
    serialNumber: normalizeOptionalString(value.serialNumber),
    productName: normalizeOptionalString(value.productName),
    sku: normalizeOptionalString(value.sku),
    productId: normalizeOptionalString(value.productId),
    variantId: normalizeOptionalString(value.variantId),
    customerId: normalizeOptionalString(value.customerId),
    orderId: normalizeOptionalString(value.orderId),
    purchaseDate: dateInputValue(value.purchaseDate) || null,
    warrantyMonths: toFiniteNumberOrNull(value.warrantyMonths),
    warrantyExpiresAt: normalizeOptionalString(value.warrantyExpiresAt),
    coverageType: normalizeOptionalString(value.coverageType),
    source: normalizeOptionalString(value.source),
    notes: normalizeOptionalString(value.notes),
    updatedAt: normalizeOptionalString(value.updatedAt),
  }
}

function nullableText(value: unknown): string | null {
  return normalizeOptionalString(value)
}

export function buildRegistrationPayload(values: RegistrationFormValues, id?: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (id) payload.id = id
  payload.serialNumber = nullableText(values.serialNumber)
  payload.productName = nullableText(values.productName)
  payload.sku = nullableText(values.sku)
  payload.productId = nullableText(values.productId)
  payload.variantId = nullableText(values.variantId)
  payload.customerId = nullableText(values.customerId)
  payload.orderId = nullableText(values.orderId)
  payload.purchaseDate = dateToIso(values.purchaseDate)
  payload.warrantyMonths = nullableInteger(values.warrantyMonths)
  payload.coverageType = nullableText(values.coverageType)
  payload.source = nullableText(values.source)
  payload.notes = nullableText(values.notes)
  return payload
}

function coverageLabel(t: TranslateFn, value: string): string {
  if (value === 'standard') return t('warranty_claims.registrations.coverageType.standard', 'Standard')
  if (value === 'extended') return t('warranty_claims.registrations.coverageType.extended', 'Extended')
  return t('warranty_claims.registrations.coverageType.none', 'No coverage')
}

function sourceLabel(t: TranslateFn, value: string): string {
  if (value === 'order') return t('warranty_claims.registrations.source.order', 'Order')
  if (value === 'manual') return t('warranty_claims.registrations.source.manual', 'Manual')
  return t('warranty_claims.registrations.source.thirdParty', 'Third party')
}

export function useRegistrationFormConfig(
  t: TranslateFn,
  registration?: RegistrationRecord | null,
): { fields: CrudField[]; groups: CrudFormGroup[] } {
  const loadCustomerOptions = React.useCallback(async (query?: string): Promise<CrudFieldOption[]> => {
    const params = new URLSearchParams({ page: '1', pageSize: '20' })
    const trimmed = query?.trim()
    if (trimmed) params.set('search', trimmed)
    const [people, companies] = await Promise.all([
      apiCall<{ items?: unknown[] }>(`/api/customers/people?${params.toString()}`, undefined, { fallback: { items: [] } }),
      apiCall<{ items?: unknown[] }>(`/api/customers/companies?${params.toString()}`, undefined, { fallback: { items: [] } }),
    ])
    const items = [
      ...(Array.isArray(people.result?.items) ? people.result.items : []),
      ...(Array.isArray(companies.result?.items) ? companies.result.items : []),
    ]
    return items.map((item) => normalizeCustomerOption(item, t)).filter((option): option is CrudFieldOption => option !== null)
  }, [t])

  const coverageOptions = React.useMemo<CrudFieldOption[]>(
    () => COVERAGE_TYPES.map((value) => ({ value, label: coverageLabel(t, value) })),
    [t],
  )

  const sourceOptions = React.useMemo<CrudFieldOption[]>(
    () => SOURCES.map((value) => ({ value, label: sourceLabel(t, value) })),
    [t],
  )

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'serialNumber',
      label: t('warranty_claims.registrations.form.serialNumber', 'Serial number'),
      type: 'text',
      required: true,
    },
    {
      id: 'productName',
      label: t('warranty_claims.registrations.form.productName', 'Product name'),
      type: 'text',
    },
    {
      id: 'sku',
      label: t('warranty_claims.registrations.form.sku', 'SKU'),
      type: 'text',
    },
    {
      id: 'customerId',
      label: t('warranty_claims.registrations.form.customerId', 'Customer'),
      type: 'combobox',
      loadOptions: loadCustomerOptions,
      resolveLabel: (value: string) => resolveCustomerLabel(value, t),
      seedOptions: [],
      allowCustomValues: false,
      placeholder: t('warranty_claims.registrations.form.customerId.placeholder', 'Search customers'),
    },
    {
      id: 'orderId',
      label: t('warranty_claims.registrations.form.orderId', 'Order ID'),
      type: 'combobox',
      loadOptions: (query?: string) => loadOrderOptions(query, {
        fallbackLabel: t('warranty_claims.form.orderUnavailable', 'Order unavailable'),
      }),
      resolveLabel: (value: string) => resolveOrderLabel(value, t('warranty_claims.form.orderUnavailable', 'Order unavailable')),
      seedOptions: [],
      allowCustomValues: false,
      placeholder: t('warranty_claims.registrations.form.orderId.placeholder', 'Search orders'),
    },
    {
      id: 'purchaseDate',
      label: t('warranty_claims.registrations.form.purchaseDate', 'Purchase date'),
      type: 'date',
    },
    {
      id: 'warrantyMonths',
      label: t('warranty_claims.registrations.form.warrantyMonths', 'Warranty months'),
      type: 'number',
    },
    {
      id: 'coverageType',
      label: t('warranty_claims.registrations.form.coverageType', 'Coverage type'),
      type: 'select',
      options: coverageOptions,
    },
    {
      id: 'source',
      label: t('warranty_claims.registrations.form.source', 'Source'),
      type: 'select',
      options: sourceOptions,
    },
    {
      id: 'notes',
      label: t('warranty_claims.registrations.form.notes', 'Notes'),
      type: 'textarea',
      rows: 5,
      layout: 'full',
    },
  ], [coverageOptions, loadCustomerOptions, sourceOptions, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'product',
      title: t('warranty_claims.registrations.form.group.product', 'Product'),
      fields: ['serialNumber', 'productName', 'sku'],
      component: ({ values, setValue }) => (
        <ClaimLineProductPicker
          value={{
            productId: nullableText(values.productId),
            variantId: nullableText(values.variantId),
            productName: nullableText(values.productName),
            sku: nullableText(values.sku),
          }}
          onPick={(pick: ClaimProductPick) => {
            setValue('productId', pick.productId)
            setValue('variantId', pick.variantId)
            setValue('sku', pick.sku)
            setValue('productName', pick.productName)
          }}
          onClear={() => {
            setValue('productId', null)
            setValue('variantId', null)
          }}
        />
      ),
    },
    {
      id: 'ownership',
      title: t('warranty_claims.registrations.form.group.ownership', 'Ownership'),
      fields: ['customerId', 'orderId'],
    },
    {
      id: 'coverage',
      title: t('warranty_claims.registrations.form.group.coverage', 'Coverage'),
      fields: ['purchaseDate', 'warrantyMonths', 'coverageType', 'source'],
    },
    {
      id: 'notes',
      title: t('warranty_claims.registrations.form.group.notes', 'Notes'),
      fields: ['notes'],
    },
  ], [t])

  return { fields, groups }
}
