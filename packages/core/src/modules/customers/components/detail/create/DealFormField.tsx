"use client"

import * as React from 'react'
import { FormFieldLabel } from '@open-mercato/ui/backend/forms/FormSection'

export type DealFormFieldProps = {
  label: string
  /**
   * Stable field key exposed as `data-crud-field-id` and used as the control's `id`.
   * Lets Playwright target the control via the project's `data-crud-field-id` convention
   * (see .ai/lessons.md). Falls back to a generated id for label/control association only.
   */
  fieldId?: string
  required?: boolean
  hint?: string
  error?: string
  children: React.ReactNode
}

export function DealFormField({ label, fieldId, required, hint, error, children }: DealFormFieldProps) {
  const generatedId = React.useId()
  const controlId = fieldId ?? generatedId
  const control = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id: controlId })
    : children
  return (
    <div data-crud-field-id={fieldId}>
      <FormFieldLabel htmlFor={controlId} required={required}>
        {label}
      </FormFieldLabel>
      {control}
      {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="mt-1.5 text-xs font-medium text-status-error-text">{error}</p> : null}
    </div>
  )
}

export default DealFormField
