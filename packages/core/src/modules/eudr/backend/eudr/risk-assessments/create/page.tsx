"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatementSelectField, translateEudrCrudError } from '../../../../components/formConfig'
import {
  RiskConclusionCriteriaWarning,
  RiskCriteriaField,
  type RiskCriteriaValue,
} from '../../../../components/RiskCriteriaField'
import { normalizeOptionalString } from '@open-mercato/shared/lib/string'
import { normalizeCriteria, conclusionOptions, toIsoDateTime } from '../../../../components/riskAssessmentForm'
import { toDateTimeLocalInput } from '../../../../lib/dates'

type RiskAssessmentFormValues = {
  statementId: string
  criteria: RiskCriteriaValue
  conclusion: string
  assessedAt: string
  reviewDueAt: string
  notes: string
} & Record<string, unknown>

type CreateRiskAssessmentResponse = {
  id?: string | null
}

function defaultReviewDueDate(): string {
  const date = new Date()
  date.setFullYear(date.getFullYear() + 1)
  return date.toISOString().slice(0, 10)
}

export default function CreateEudrRiskAssessmentPage() {
  const translate = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefilledStatementId = searchParams.get('statementId') ?? ''

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'statementId',
      layout: 'half',
      label: translate('eudr.riskAssessments.form.statement'),
      type: 'custom',
      required: true,
      component: ({ id, value, setValue }) => (
        <StatementSelectField
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(nextValue) => setValue(nextValue ?? '')}
          placeholder={translate('eudr.riskAssessments.form.statementPlaceholder')}
          loadError={translate('eudr.riskAssessments.form.statementLoadError')}
        />
      ),
    },
    {
      id: 'criteria',
      label: translate('eudr.riskAssessments.form.criteria'),
      type: 'custom',
      layout: 'full',
      component: ({ id, value, setValue, disabled }) => (
        <RiskCriteriaField
          id={id}
          value={value}
          disabled={disabled}
          onChange={(nextValue) => setValue(nextValue)}
        />
      ),
    },
    {
      id: 'conclusion',
      layout: 'half',
      label: translate('eudr.riskAssessments.form.conclusion'),
      type: 'select',
      required: true,
      options: conclusionOptions(translate),
    },
    {
      id: 'assessedAt',
      layout: 'half',
      label: translate('eudr.riskAssessments.form.assessedAt'),
      type: 'datetime-local',
      required: true,
      maxDate: new Date(),
    },
    {
      id: 'reviewDueAt',
      layout: 'half',
      label: translate('eudr.riskAssessments.form.reviewDueAt'),
      type: 'date',
      description: translate('eudr.riskAssessments.form.reviewDueAtHelp'),
    },
    {
      id: 'notes',
      label: translate('eudr.riskAssessments.form.notes'),
      type: 'textarea',
    },
  ], [translate])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: translate('eudr.riskAssessments.form.details'),
      column: 1,
      fields: [
        'statementId',
        'conclusion',
        'assessedAt',
        'reviewDueAt',
      ],
    },
    {
      id: 'criteria',
      title: translate('eudr.riskAssessments.form.criteria'),
      column: 1,
      fields: [
        'criteria',
      ],
    },
    {
      id: 'criteriaWarning',
      column: 1,
      bare: true,
      component: ({ values }) => (
        <RiskConclusionCriteriaWarning conclusion={values.conclusion} criteria={values.criteria} />
      ),
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
        <CrudForm<RiskAssessmentFormValues>
          title={translate('eudr.riskAssessments.create.title')}
          backHref="/backend/eudr/risk-assessments"
          cancelHref="/backend/eudr/risk-assessments"
          submitLabel={translate('eudr.riskAssessments.form.submitCreate')}
          fields={fields}
          groups={groups}
          initialValues={{
            statementId: prefilledStatementId,
            criteria: {},
            conclusion: '',
            assessedAt: toDateTimeLocalInput(new Date()),
            reviewDueAt: defaultReviewDueDate(),
            notes: '',
          }}
          onSubmit={async (values) => {
            const statementId = normalizeOptionalString(values.statementId)
            if (!statementId) {
              const message = translate('eudr.riskAssessments.form.statementRequired')
              throw createCrudFormError(message, { statementId: message })
            }
            const conclusion = normalizeOptionalString(values.conclusion)
            if (!conclusion) {
              const message = translate('eudr.riskAssessments.form.conclusionRequired')
              throw createCrudFormError(message, { conclusion: message })
            }
            const assessedAt = toIsoDateTime(normalizeOptionalString(values.assessedAt))
            if (!assessedAt) {
              const message = translate('eudr.riskAssessments.form.assessedAtInvalid')
              throw createCrudFormError(message, { assessedAt: message })
            }
            const result = await createCrud<CreateRiskAssessmentResponse>('eudr/risk-assessments', {
              statementId,
              criteria: normalizeCriteria(values.criteria),
              conclusion,
              assessedAt,
              reviewDueAt: normalizeOptionalString(values.reviewDueAt),
              notes: normalizeOptionalString(values.notes),
            }, {
              errorMessage: translate('eudr.riskAssessments.form.createError'),
            }).catch((err) => {
              throw translateEudrCrudError(err, translate)
            })
            flash(translate('eudr.riskAssessments.form.createSuccess'), 'success')
            const id = typeof result.result?.id === 'string' ? result.result.id : null
            router.push(id ? `/backend/eudr/risk-assessments/${id}` : '/backend/eudr/risk-assessments')
          }}
        />
      </PageBody>
    </Page>
  )
}
