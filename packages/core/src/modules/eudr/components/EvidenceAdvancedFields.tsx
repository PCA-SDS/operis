import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { Textarea } from '@open-mercato/ui/primitives/textarea'

export function EvidenceAdvancedFields({
  values,
  setValue,
  translate,
}: {
  values: Record<string, unknown>
  setValue: (id: string, value: unknown) => void
  translate: ReturnType<typeof useT>
}) {
  return (
    <CollapsibleSection
      title={translate('eudr.evidenceSubmissions.form.legacyGeolocation')}
      defaultCollapsed
      contentClassName="space-y-4"
    >
      <div className="space-y-2" data-crud-field-id="geolocation">
        <label className="text-sm font-medium" htmlFor="eudr-evidence-geolocation">
          {translate('eudr.evidenceSubmissions.form.geolocation')}
        </label>
        <Textarea
          id="eudr-evidence-geolocation"
          rows={8}
          value={typeof values.geolocation === 'string' ? values.geolocation : ''}
          onChange={(event) => setValue('geolocation', event.target.value)}
        />
      </div>
    </CollapsibleSection>
  )
}
