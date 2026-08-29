"use client"

import * as React from 'react'
import type { CrudCustomFieldRenderProps } from '../CrudForm'
import { FieldRegistry } from './registry'
import { PhoneNumberField, PHONE_COUNTRIES, buildPhoneCountryOptions } from '../inputs/PhoneNumberField'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Dropdown } from '../../primitives/dropdown'

type PhoneFieldConfig = {
  defaultCountryIso2?: string
}

type PhoneFieldDef = PhoneFieldConfig & {
  configJson?: PhoneFieldConfig
}

type PhoneFieldInputProps = CrudCustomFieldRenderProps & { def?: PhoneFieldDef }


function PhoneFieldInput({ id, value, setValue, disabled, error, def }: PhoneFieldInputProps) {
  const stringValue = typeof value === 'string' ? value : value == null ? '' : String(value)
  return (
    <PhoneNumberField
      id={id}
      value={stringValue}
      onValueChange={(next) => setValue(next ?? undefined)}
      disabled={disabled}
      externalError={error ?? null}
      defaultCountryIso2={def?.defaultCountryIso2}
    />
  )
}

function PhoneFieldDefEditor({
  def,
  onChange,
}: {
  def: { configJson?: PhoneFieldConfig } | undefined
  onChange: (patch: Partial<PhoneFieldConfig>) => void
}) {
  const t = useT()
  const selected = typeof def?.configJson?.defaultCountryIso2 === 'string' ? def.configJson.defaultCountryIso2 : ''
  const countryOptions = React.useMemo(() => buildPhoneCountryOptions(PHONE_COUNTRIES), [])
  return (
    <div className="mt-3 space-y-3 rounded border border-dashed border-muted-foreground/40 bg-muted/30 p-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t('ui.customFields.phone.defaultCountry', 'Default country')}
        </label>
        {/* Same searchable picker as the phone input itself. "Auto-detect" is
            the reset row: `Dropdown` carries a real null, so the old
            `__om_phone_auto__` sentinel — which only existed because Radix
            Select rejects an empty value — is gone. */}
        <Dropdown<string>
          value={selected || null}
          onChange={(next) => onChange({ defaultCountryIso2: next ?? undefined })}
          options={countryOptions}
          searchable={t('ui.phone.searchCountry', 'Search country…')}
          resetLabel={t('ui.customFields.phone.defaultCountryAuto', 'Auto-detect from value')}
          placeholder={t('ui.customFields.phone.defaultCountryAuto', 'Auto-detect from value')}
          ariaLabel={t('ui.customFields.phone.defaultCountry', 'Default country')}
          variant="field"
          size="sm"
          data-testid="country-select"
        />
        <p className="text-xs text-muted-foreground">
          {t(
            'ui.customFields.phone.defaultCountryHint',
            'Pre-selects a country in the phone editor when the field is empty.',
          )}
        </p>
      </div>
    </div>
  )
}

FieldRegistry.register('phone', {
  input: (props) => <PhoneFieldInput {...props} />,
  inputRendersOwnError: true,
  defEditor: (props) => <PhoneFieldDefEditor {...props} />,
})

export {}
