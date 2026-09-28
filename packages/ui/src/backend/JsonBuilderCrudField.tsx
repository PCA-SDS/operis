import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { JsonBuilder } from '@open-mercato/ui/backend/JsonBuilder'

/**
 * JsonBuilderCrudField - Custom field wrapper for JsonBuilder
 */
export function JsonBuilderCrudField({ value, setValue, disabled }: CrudCustomFieldRenderProps) {
  return (
    <JsonBuilder
      value={value || {}}
      onChange={setValue}
      disabled={disabled}
    />
  )
}
