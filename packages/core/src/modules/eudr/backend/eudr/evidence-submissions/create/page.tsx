"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  CompanySelectField,
  CountrySelectField,
  MappingSelectField,
  PlotMultiSelectField,
  StatementSelectField,
  commodityOptions,
  parseGeolocationInput,
  submissionStatusOptions,
  type CompanySnapshot,
  translateEudrCrudError,
} from '../../../../components/formConfig'
import { normalizeOptionalString, toNonEmptyStringArray } from '@open-mercato/shared/lib/string'
import { EvidenceAdvancedFields } from '../../../../components/EvidenceAdvancedFields'
import { optionalNumber, optionalUpperText } from '../../../../components/evidenceFormValues'

type EvidenceSubmissionFormValues = {
  supplierEntityId: string
  supplierSnapshot: CompanySnapshot | null
  commodity: string
  productMappingId: string
  statementId: string
  plotIds: string[]
  originCountry: string
  geolocation: string
  quantityKg: string
  batchNumber: string
  harvestFrom: string
  harvestTo: string
  producerName: string
  status: string
  notes: string
} & Record<string, unknown>

function isCompanySnapshot(value: unknown): value is CompanySnapshot {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export default function CreateEudrEvidenceSubmissionPage() {
  const translate = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefilledStatementId = searchParams.get('statementId') ?? ''

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'supplierEntityId',
      layout: 'half',
      label: translate('eudr.evidenceSubmissions.form.supplier'),
      type: 'custom',
      required: true,
      component: ({ id, value, setValue, setFormValue }) => (
        <CompanySelectField
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(nextValue) => setValue(nextValue ?? '')}
          onSnapshot={(snapshot) => setFormValue?.('supplierSnapshot', snapshot)}
          placeholder={translate('eudr.evidenceSubmissions.form.supplierPlaceholder')}
          loadError={translate('eudr.evidenceSubmissions.form.supplierLoadError')}
        />
      ),
    },
    {
      id: 'commodity',
      layout: 'half',
      label: translate('eudr.evidenceSubmissions.form.commodity'),
      type: 'select',
      required: true,
      options: commodityOptions(translate),
    },
    {
      id: 'productMappingId',
      layout: 'half',
      label: translate('eudr.evidenceSubmissions.form.productMapping'),
      type: 'custom',
      component: ({ id, value, setValue }) => (
        <MappingSelectField
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(nextValue) => setValue(nextValue ?? '')}
          placeholder={translate('eudr.evidenceSubmissions.form.productMappingPlaceholder')}
          emptyLabel={translate('eudr.common.empty')}
          loadError={translate('eudr.evidenceSubmissions.form.productMappingLoadError')}
        />
      ),
    },
    {
      id: 'statementId',
      layout: 'half',
      label: translate('eudr.evidenceSubmissions.form.statement'),
      type: 'custom',
      component: ({ id, value, setValue }) => (
        <StatementSelectField
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(nextValue) => setValue(nextValue ?? '')}
          placeholder={translate('eudr.evidenceSubmissions.form.statementPlaceholder')}
          emptyLabel={translate('eudr.common.empty')}
          loadError={translate('eudr.evidenceSubmissions.form.statementLoadError')}
        />
      ),
    },
    {
      id: 'plotIds',
      label: translate('eudr.evidenceSubmissions.form.plots'),
      type: 'custom',
      component: ({ id, value, setValue, values }) => (
        <PlotMultiSelectField
          id={id}
          value={toNonEmptyStringArray(value)}
          onChange={(nextValue) => setValue(nextValue)}
          supplierEntityId={typeof values?.supplierEntityId === 'string' ? values.supplierEntityId : null}
        />
      ),
    },
    {
      id: 'originCountry',
      layout: 'half',
      label: translate('eudr.evidenceSubmissions.form.originCountry'),
      type: 'custom',
      description: translate('eudr.form.originCountryHint'),
      component: ({ id, value, setValue, disabled }) => (
        <CountrySelectField
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(nextValue) => setValue(nextValue ?? '')}
          disabled={disabled}
          placeholder={translate('eudr.plots.form.originCountryPlaceholder')}
        />
      ),
    },
    {
      id: 'quantityKg',
      layout: 'half',
      label: translate('eudr.evidenceSubmissions.form.quantityKg'),
      type: 'text',
    },
    {
      id: 'batchNumber',
      layout: 'half',
      label: translate('eudr.evidenceSubmissions.form.batchNumber'),
      type: 'text',
    },
    {
      id: 'harvestFrom',
      layout: 'half',
      label: translate('eudr.evidenceSubmissions.form.harvestFrom'),
      type: 'date',
    },
    {
      id: 'harvestTo',
      layout: 'half',
      label: translate('eudr.evidenceSubmissions.form.harvestTo'),
      type: 'date',
    },
    {
      id: 'producerName',
      layout: 'half',
      label: translate('eudr.evidenceSubmissions.form.producerName'),
      type: 'text',
    },
    {
      id: 'attachmentsHint',
      label: translate('eudr.evidenceSubmissions.form.documents'),
      type: 'custom',
      component: () => (
        <div className="rounded-md border border-dashed border-border/70 bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
          {translate('eudr.evidenceSubmissions.form.attachmentsAfterSave')}
        </div>
      ),
    },
    {
      id: 'status',
      label: translate('eudr.evidenceSubmissions.form.status'),
      type: 'select',
      options: submissionStatusOptions(translate),
    },
    {
      id: 'notes',
      label: translate('eudr.evidenceSubmissions.form.notes'),
      type: 'textarea',
    },
  ], [translate])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: translate('eudr.evidenceSubmissions.form.details'),
      column: 1,
      fields: [
        'supplierEntityId',
        'commodity',
        'productMappingId',
        'statementId',
        'plotIds',
      ],
    },
    {
      id: 'evidence',
      title: translate('eudr.evidenceSubmissions.form.evidence'),
      column: 1,
      fields: [
        'originCountry',
        'quantityKg',
        'batchNumber',
        'harvestFrom',
        'harvestTo',
        'producerName',
      ],
    },
    {
      id: 'documents',
      title: translate('eudr.evidenceSubmissions.form.documents'),
      column: 1,
      fields: [
        'attachmentsHint',
      ],
    },
    {
      id: 'advanced',
      column: 1,
      bare: true,
      component: ({ values, setValue }) => (
        <EvidenceAdvancedFields values={values} setValue={setValue} translate={translate} />
      ),
    },
    {
      id: 'classification',
      title: translate('eudr.common.classification'),
      column: 2,
      fields: [
        'status',
      ],
    },
    {
      id: 'notes',
      title: translate('eudr.common.notes'),
      column: 2,
      fields: [
        'notes',
      ],
    },
  ], [translate])

  return (
    <Page>
      <PageBody>
        <CrudForm<EvidenceSubmissionFormValues>
          title={translate('eudr.evidenceSubmissions.create.title')}
          backHref="/backend/eudr/evidence-submissions"
          cancelHref="/backend/eudr/evidence-submissions"
          submitLabel={translate('eudr.evidenceSubmissions.form.submitCreate')}
          fields={fields}
          groups={groups}
          initialValues={{
            supplierEntityId: '',
            supplierSnapshot: null,
            commodity: '',
            productMappingId: '',
            statementId: prefilledStatementId,
            plotIds: [],
            originCountry: '',
            geolocation: '',
            quantityKg: '',
            batchNumber: '',
            harvestFrom: '',
            harvestTo: '',
            producerName: '',
            status: 'draft',
            notes: '',
          }}
          onSubmit={async (values) => {
            const supplierEntityId = normalizeOptionalString(values.supplierEntityId)
            if (!supplierEntityId) {
              const message = translate('eudr.evidenceSubmissions.form.supplierRequired')
              throw createCrudFormError(message, { supplierEntityId: message })
            }
            const commodity = normalizeOptionalString(values.commodity)
            if (!commodity) {
              const message = translate('eudr.evidenceSubmissions.form.commodityRequired')
              throw createCrudFormError(message, { commodity: message })
            }
            const call = await createCrud<{ id?: string | null }>('eudr/evidence-submissions', {
              supplierEntityId,
              supplierSnapshot: isCompanySnapshot(values.supplierSnapshot) ? values.supplierSnapshot : null,
              commodity,
              productMappingId: normalizeOptionalString(values.productMappingId),
              statementId: normalizeOptionalString(values.statementId),
              plotIds: toNonEmptyStringArray(values.plotIds),
              originCountry: optionalUpperText(values.originCountry),
              geolocation: parseGeolocationInput(typeof values.geolocation === 'string' ? values.geolocation : '', translate),
              quantityKg: optionalNumber(values.quantityKg, translate),
              batchNumber: normalizeOptionalString(values.batchNumber),
              harvestFrom: normalizeOptionalString(values.harvestFrom),
              harvestTo: normalizeOptionalString(values.harvestTo),
              producerName: normalizeOptionalString(values.producerName),
              status: normalizeOptionalString(values.status) ?? 'draft',
              notes: normalizeOptionalString(values.notes),
            }, {
              errorMessage: translate('eudr.evidenceSubmissions.form.createError'),
            }).catch((err) => {
              throw translateEudrCrudError(err, translate)
            })
            const createdId = normalizeOptionalString(call.result?.id)
            if (createdId) {
              flash(translate('eudr.evidence.attachAfterCreateHint'), 'success')
              router.push(`/backend/eudr/evidence-submissions/${createdId}`)
            } else {
              flash(translate('eudr.evidenceSubmissions.form.createSuccess'), 'success')
              router.push('/backend/eudr/evidence-submissions')
            }
          }}
        />
      </PageBody>
    </Page>
  )
}
