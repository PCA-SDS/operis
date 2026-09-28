"use client"

import * as React from 'react'
import type { CrudField, CrudFieldOption, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Switch } from '@open-mercato/ui/primitives/switch'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { fetchClaimReasonOptions } from '../../components/claimReasonOptions'
import { isRecord } from '@open-mercato/shared/lib/guards'
import { normalizeOptionalString } from '@open-mercato/shared/lib/string'
import { toFiniteNumberOrNull } from '@open-mercato/shared/lib/number'
import { nullableInteger } from '../../components/formValues'

export type VendorPolicyRecord = {
  id: string
  vendorName: string | null
  vendorRef: string | null
  coverageMonths: number | null
  claimableReasonCodes: string[] | null
  recoveryRatePct: string | null
  contactEmail: string | null
  autoGenerateRecovery: boolean
  isActive: boolean
  updatedAt: string | null
}

export type VendorPolicyFormValues = Partial<VendorPolicyRecord> & {
  claimableReasonCodesCsv?: string | string[] | null
} & Record<string, unknown>

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function nullableText(value: unknown): string | null {
  return normalizeOptionalString(value)
}

function nullableDecimalString(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function parseReasonCodes(value: unknown): string[] {
  if (Array.isArray(value)) return toStringArray(value) ?? []
  if (typeof value !== 'string') return []
  const result: string[] = []
  for (const part of value.split(',')) {
    const normalized = part.trim()
    if (normalized && !result.includes(normalized)) result.push(normalized)
  }
  return result
}

function createSwitchField(
  id: 'autoGenerateRecovery' | 'isActive',
  label: string,
  enabledLabel: string,
  disabledLabel: string,
  description?: string,
): CrudField {
  return {
    id,
    label,
    type: 'custom',
    description,
    component: ({ value, setValue, disabled }) => {
      const checked = value === true
      return (
        <div className="flex items-center gap-3">
          <Switch
            aria-label={label}
            checked={checked}
            disabled={disabled}
            onCheckedChange={(next) => setValue(next)}
          />
          <span className="text-sm text-muted-foreground">
            {checked ? enabledLabel : disabledLabel}
          </span>
        </div>
      )
    },
  }
}

export function normalizeVendorPolicy(value: unknown): VendorPolicyRecord | null {
  if (!isRecord(value)) return null
  const id = normalizeOptionalString(value.id)
  if (!id) return null
  return {
    id,
    vendorName: normalizeOptionalString(value.vendorName),
    vendorRef: normalizeOptionalString(value.vendorRef),
    coverageMonths: toFiniteNumberOrNull(value.coverageMonths),
    claimableReasonCodes: toStringArray(value.claimableReasonCodes),
    recoveryRatePct: normalizeOptionalString(value.recoveryRatePct),
    contactEmail: normalizeOptionalString(value.contactEmail),
    autoGenerateRecovery: value.autoGenerateRecovery === true,
    isActive: value.isActive !== false,
    updatedAt: normalizeOptionalString(value.updatedAt),
  }
}

export function toVendorPolicyInitialValues(policy: VendorPolicyRecord): VendorPolicyFormValues {
  return {
    ...policy,
    claimableReasonCodesCsv: policy.claimableReasonCodes ?? [],
  }
}

export function buildVendorPolicyPayload(values: VendorPolicyFormValues, id?: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (id) payload.id = id
  payload.vendorName = nullableText(values.vendorName) ?? ''
  payload.vendorRef = nullableText(values.vendorRef)
  payload.coverageMonths = nullableInteger(values.coverageMonths)
  payload.claimableReasonCodes = parseReasonCodes(values.claimableReasonCodesCsv ?? values.claimableReasonCodes)
  payload.recoveryRatePct = nullableDecimalString(values.recoveryRatePct)
  payload.contactEmail = nullableText(values.contactEmail)
  payload.autoGenerateRecovery = values.autoGenerateRecovery === true
  payload.isActive = values.isActive !== false
  return payload
}

export function useVendorPolicyFormConfig(t: TranslateFn): { fields: CrudField[]; groups: CrudFormGroup[] } {
  const loadReasonCodeOptions = React.useCallback(() => fetchClaimReasonOptions(t), [t])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'vendorName',
      label: t('warranty_claims.vendorPolicies.form.vendorName', 'Vendor name'),
      type: 'text',
      required: true,
    },
    {
      id: 'vendorRef',
      label: t('warranty_claims.vendorPolicies.form.vendorRef', 'Vendor reference'),
      type: 'text',
    },
    {
      id: 'contactEmail',
      label: t('warranty_claims.vendorPolicies.form.contactEmail', 'Contact email'),
      type: 'text',
    },
    {
      id: 'coverageMonths',
      label: t('warranty_claims.vendorPolicies.form.coverageMonths', 'Coverage months'),
      type: 'number',
    },
    {
      id: 'claimableReasonCodesCsv',
      label: t('warranty_claims.vendorPolicies.form.claimableReasonCodes', 'Claimable reason codes'),
      type: 'tags',
      layout: 'full',
      loadOptions: loadReasonCodeOptions,
      placeholder: t('warranty_claims.vendorPolicies.form.claimableReasonCodes.placeholder', 'Add reason code'),
      description: t('warranty_claims.vendorPolicies.form.claimableReasonCodes.multiHelp', 'Pick claim reasons from the dictionary, or type a custom code and press Enter. Leave empty to match any reason.'),
    },
    {
      id: 'recoveryRatePct',
      label: t('warranty_claims.vendorPolicies.form.recoveryRatePct', 'Recovery rate percent'),
      type: 'number',
    },
    createSwitchField(
      'autoGenerateRecovery',
      t('warranty_claims.vendorPolicies.form.autoGenerateRecovery', 'Auto-generate recovery'),
      t('warranty_claims.vendorPolicies.form.autoGenerateRecovery.enabled', 'Automatic recovery enabled'),
      t('warranty_claims.vendorPolicies.form.autoGenerateRecovery.disabled', 'Manual suggestion only'),
      t('warranty_claims.vendorPolicies.form.autoGenerateRecovery.help', 'When enabled, resolved matching lines generate supplier recovery claims automatically.'),
    ),
    createSwitchField(
      'isActive',
      t('warranty_claims.vendorPolicies.form.isActive', 'Active'),
      t('warranty_claims.vendorPolicies.form.isActive.enabled', 'Policy active'),
      t('warranty_claims.vendorPolicies.form.isActive.disabled', 'Policy inactive'),
    ),
  ], [loadReasonCodeOptions, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'identity',
      title: t('warranty_claims.vendorPolicies.form.group.identity', 'Vendor'),
      fields: ['vendorName', 'vendorRef', 'contactEmail'],
    },
    {
      id: 'coverage',
      title: t('warranty_claims.vendorPolicies.form.group.coverage', 'Coverage'),
      fields: ['coverageMonths', 'claimableReasonCodesCsv', 'recoveryRatePct'],
    },
    {
      id: 'automation',
      title: t('warranty_claims.vendorPolicies.form.group.automation', 'Automation'),
      fields: ['autoGenerateRecovery', 'isActive'],
    },
  ], [t])

  return { fields, groups }
}
