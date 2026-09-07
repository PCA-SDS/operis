"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns/format'
import { parseISO } from 'date-fns/parseISO'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { crudFormExtensionSpotId } from '@open-mercato/shared/modules/widgets/extension-points'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { dealFormSchema } from '../DealForm'
import { createDictionarySelectLabels } from '../utils'
import { DictionarySelectField } from '../../formConfig'
import { DealAssociationsSection } from './DealAssociationsSection'
import { DealCreateSidebar } from './DealCreateSidebar'
import { PipelineSelect } from './PipelineSelect'
import { PipelineStageSelect } from './PipelineStageSelect'
import { SuffixInput } from './SuffixInput'
import { DealCurrencyField } from './DealCurrencyField'
import { sanitizeAmount, sanitizeProbability } from './dealNumericInput'
import { useDealPipelines } from './useDealPipelines'
import { useDealCustomFields } from './useDealCustomFields'
import { EMPTY_VALUES, type BaseValues } from './dealFormTypes'

const CONTEXT_ID = 'customers.deals.create'
const DEAL_ENTITY_ID = 'customers:customer_deal'
const DEAL_SPOT_ENTITY = DEAL_ENTITY_ID.replace(/:+/g, '.')
const CUSTOM_FIELDS_MANAGE_HREF = `/backend/entities/system/${encodeURIComponent(DEAL_ENTITY_ID)}`

export type CreateDealFormProps = {
  returnTo: string
  /** Seed values merged over EMPTY_VALUES for the initial form state. Entries set to `undefined` are ignored (the EMPTY_VALUES default wins), so a sparse `Partial<BaseValues>` can never unset a required field. Additive: omitting it preserves current behavior. */
  initialValues?: Partial<BaseValues>
}

function toDate(value: string): Date | null {
  if (!value) return null
  const parsed = parseISO(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Deal creation, hosted by `CrudForm`.
 *
 * The form used to be hand-built, which cost it the field-injection spot and the
 * replacement handle every other create form has — the gap
 * `.ai/specs/2026-07-02-deal-create-initial-values.md` was written to work
 * around. Hosting it on `CrudForm` restores both.
 *
 * The deal-specific pieces stay deal-specific: the pipeline/stage cascade, the
 * association pickers and the custom-attribute sidebar keep their own tested
 * components and mount through `CrudForm`'s custom-field and group-component
 * slots. `injectionSpotId` is passed explicitly rather than via `entityId`
 * because `entityId` would also hand the custom attributes to `CrudForm`'s own
 * pipeline and render them twice.
 */
export function CreateDealForm({ returnTo, initialValues }: CreateDealFormProps) {
  const t = useT()
  const router = useRouter()
  const tr = React.useCallback(
    (key: string, fallback: string, params?: Record<string, string | number>) =>
      translateWithFallback(t, key, fallback, params),
    [t],
  )

  const seededValues = React.useMemo<BaseValues>(() => {
    const definedSeedEntries = Object.entries(initialValues ?? {}).filter(([, seedValue]) => seedValue !== undefined)
    return { ...EMPTY_VALUES, ...Object.fromEntries(definedSeedEntries) }
  }, [initialValues])

  // Associations live outside the CrudForm value bag: the picker owns both lists
  // and renders them as one control.
  const [personIds, setPersonIds] = React.useState<string[]>(seededValues.personIds)
  const [companyIds, setCompanyIds] = React.useState<string[]>(seededValues.companyIds)
  // The custom-attribute sidebar renders its own fields, so CrudForm cannot own
  // their errors — they are held here and handed back to the sidebar.
  const [customErrors, setCustomErrors] = React.useState<Record<string, string>>({})

  const { pipelines, stages, loadStages } = useDealPipelines()
  const {
    customValues,
    customFieldsLoaded,
    customCount,
    handleCustomChange,
    handleCustomAttributesLoaded,
    validateCustomFields,
    collectNormalizedCustomValues,
  } = useDealCustomFields(tr)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: CONTEXT_ID,
    blockedMessage: tr('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const statusLabels = React.useMemo(
    () => createDictionarySelectLabels('deal-statuses', (key, fallback) => tr(key, fallback ?? key)),
    [tr],
  )

  const handlePipelineChange = React.useCallback(
    (id: string, setValue: (value: unknown) => void, setFormValue?: (id: string, value: unknown) => void) => {
      setValue(id)
      setFormValue?.('pipelineStageId', '')
      // loadStages resets stages to [] on failure; the rejection is intentionally ignored here.
      loadStages(id).catch(() => {})
    },
    [loadStages],
  )

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'title',
      label: tr('customers.deals.create.fields.title', 'Deal title'),
      type: 'text',
      required: true,
      description: tr('customers.deals.create.hints.title', 'Short, descriptive name shown on pipeline cards'),
    },
    {
      id: 'status',
      label: tr('customers.people.detail.deals.fields.status', 'Status'),
      type: 'custom',
      component: ({ value, setValue }) => (
        <DictionarySelectField
          kind="deal-statuses"
          value={asString(value) || undefined}
          onChange={(next) => setValue(next ?? '')}
          labels={statusLabels}
          selectClassName="w-full"
          showActiveAppearance={false}
        />
      ),
    },
    {
      id: 'pipelineId',
      label: tr('customers.people.detail.deals.fields.pipeline', 'Pipeline'),
      type: 'custom',
      component: ({ value, setValue, setFormValue, disabled }) => (
        <PipelineSelect
          pipelines={pipelines}
          value={asString(value)}
          onChange={(id) => handlePipelineChange(id, setValue, setFormValue)}
          disabled={disabled}
          placeholder={tr('customers.deals.form.pipeline.placeholder', 'Select pipeline…')}
        />
      ),
    },
    {
      id: 'pipelineStageId',
      label: tr('customers.people.detail.deals.fields.pipelineStage', 'Pipeline stage'),
      type: 'custom',
      description: tr('customers.deals.create.hints.pipelineStage', 'Stages depend on the selected pipeline'),
      component: ({ value, setValue, values, disabled }) => (
        <PipelineStageSelect
          stages={stages}
          value={asString(value)}
          onChange={(id) => setValue(id)}
          disabled={disabled || !asString(values?.pipelineId)}
          placeholder={tr('customers.deals.form.pipelineStage.placeholder', 'Select stage…')}
          formatCount={(position, total) =>
            tr('customers.deals.create.fields.stageOf', '· stage {position} of {total}', { position, total })
          }
        />
      ),
    },
    {
      id: 'valueAmount',
      label: tr('customers.deals.create.fields.valueAmount', 'Deal value'),
      type: 'custom',
      description: tr('customers.deals.create.hints.valueAmount', 'Potential revenue from this opportunity'),
      component: ({ value, setValue, values, error, disabled }) => (
        <SuffixInput
          suffix={asString(values?.valueCurrency)}
          inputMode="decimal"
          value={asString(value)}
          onChange={(event) => setValue(sanitizeAmount(event.target.value))}
          placeholder="0"
          aria-invalid={error ? true : undefined}
          disabled={disabled}
        />
      ),
    },
    {
      id: 'valueCurrency',
      label: tr('customers.people.detail.deals.fields.valueCurrency', 'Currency'),
      type: 'custom',
      component: ({ value, setValue, disabled }) => (
        <DealCurrencyField value={asString(value)} onChange={(code) => setValue(code)} disabled={disabled} />
      ),
    },
    {
      id: 'probability',
      label: tr('customers.deals.create.fields.probability', 'Probability'),
      type: 'custom',
      description: tr('customers.deals.create.hints.probability', '0 – 100%, used for weighted pipeline value'),
      component: ({ value, setValue, error, disabled }) => (
        <SuffixInput
          suffix="%"
          inputMode="numeric"
          value={asString(value)}
          onChange={(event) => setValue(sanitizeProbability(event.target.value))}
          placeholder="0"
          aria-invalid={error ? true : undefined}
          disabled={disabled}
        />
      ),
    },
    {
      id: 'expectedCloseAt',
      label: tr('customers.deals.create.fields.expectedCloseAt', 'Expected close date'),
      type: 'custom',
      component: ({ value, setValue, disabled }) => (
        <DatePicker
          value={toDate(asString(value))}
          onChange={(date) => setValue(date ? format(date, 'yyyy-MM-dd') : '')}
          disabled={disabled}
          placeholder={tr('customers.deals.create.fields.datePlaceholder', 'Pick a date')}
        />
      ),
    },
    {
      id: 'description',
      label: tr('customers.people.detail.deals.fields.description', 'Description'),
      type: 'textarea',
    },
  ], [handlePipelineChange, pipelines, stages, statusLabels, tr])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: tr('customers.deals.create.title', 'Create Deal'),
      description: tr('customers.deals.create.sections.details.subtitle', 'Core opportunity info'),
      column: 1,
      fields: ['title', 'status', 'pipelineId', 'pipelineStageId', 'valueAmount', 'valueCurrency', 'probability', 'expectedCloseAt', 'description'],
    },
    {
      id: 'associations',
      column: 1,
      bare: true,
      component: ({ values }) => (
        <DealAssociationsSection
          tr={tr}
          personIds={personIds}
          companyIds={companyIds}
          onPeopleChange={setPersonIds}
          onCompaniesChange={setCompanyIds}
          disabled={Boolean(values.__submitting)}
        />
      ),
    },
    {
      id: 'customFields',
      column: 2,
      bare: true,
      component: () => (
        <DealCreateSidebar
          tr={tr}
          customValues={customValues}
          onCustomChange={handleCustomChange}
          errors={customErrors}
          disabled={false}
          customCount={customCount}
          manageHref={CUSTOM_FIELDS_MANAGE_HREF}
          onCustomLoaded={handleCustomAttributesLoaded}
        />
      ),
    },
  ], [companyIds, customCount, customErrors, customValues, handleCustomAttributesLoaded, handleCustomChange, personIds, tr])

  const handleSubmit = React.useCallback(async (formValues: Record<string, unknown>) => {
    if (!customFieldsLoaded) {
      throw createCrudFormError(tr('customers.deals.create.sections.custom.loading', 'Loading custom fields...'))
    }
    const base = { ...formValues, personIds, companyIds } as unknown as BaseValues
    const merged = { ...base, ...customValues }
    const parsed = dealFormSchema.safeParse(merged)
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = typeof issue.path[0] === 'string' ? issue.path[0] : undefined
        if (key && !fieldErrors[key]) fieldErrors[key] = tr(issue.message, issue.message)
      }
      throw createCrudFormError(Object.values(fieldErrors)[0] ?? '[internal] invalid deal', fieldErrors)
    }

    const customFieldErrors = validateCustomFields(merged)
    if (Object.keys(customFieldErrors).length) {
      setCustomErrors(customFieldErrors)
      throw createCrudFormError(Object.values(customFieldErrors)[0] ?? '[internal] invalid deal', customFieldErrors)
    }
    setCustomErrors({})

    const data = parsed.data
    const expectedCloseAt =
      data.expectedCloseAt && data.expectedCloseAt.length
        ? new Date(data.expectedCloseAt).toISOString()
        : undefined
    const payload: Record<string, unknown> = {
      title: data.title,
      status: data.status || undefined,
      pipelineId: data.pipelineId || undefined,
      pipelineStageId: data.pipelineStageId || undefined,
      valueAmount: typeof data.valueAmount === 'number' ? data.valueAmount : undefined,
      valueCurrency: data.valueCurrency || undefined,
      probability: typeof data.probability === 'number' ? data.probability : undefined,
      expectedCloseAt,
      description: data.description && data.description.length ? data.description : undefined,
      personIds: personIds.length ? personIds : undefined,
      companyIds: companyIds.length ? companyIds : undefined,
    }
    const custom = collectNormalizedCustomValues(merged)
    if (Object.keys(custom).length) payload.customFields = custom

    await runMutation({
      operation: () =>
        createCrud('customers/deals', payload, {
          errorMessage: tr('customers.deals.create.error', 'Failed to create deal.'),
        }),
      context: { formId: CONTEXT_ID, resourceKind: 'customers.deal', retryLastMutation },
      mutationPayload: payload,
    })
    flash(tr('customers.people.detail.deals.success', 'Deal created.'), 'success')
    router.push(returnTo)
  }, [
    collectNormalizedCustomValues,
    companyIds,
    customFieldsLoaded,
    customValues,
    personIds,
    retryLastMutation,
    returnTo,
    router,
    runMutation,
    tr,
    validateCustomFields,
  ])

  return (
    <CrudForm
      injectionSpotId={crudFormExtensionSpotId(DEAL_SPOT_ENTITY)}
      replacementHandle={ComponentReplacementHandles.crudForm(DEAL_SPOT_ENTITY)}
      title={tr('customers.deals.create.title', 'Create Deal')}
      backHref={returnTo}
      backLabel={tr('customers.deals.create.back', 'Back to deals')}
      cancelHref={returnTo}
      submitLabel={tr('customers.deals.create.submit', 'Create deal')}
      // Mirrors the pre-migration gate: no submit until the custom-field
      // definitions have resolved, so a deal cannot be created without them.
      submitDisabled={!customFieldsLoaded}
      fields={fields}
      groups={groups}
      initialValues={seededValues as unknown as Record<string, unknown>}
      onSubmit={handleSubmit}
    />
  )
}

export default CreateDealForm
