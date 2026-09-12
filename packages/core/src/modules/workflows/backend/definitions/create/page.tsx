"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { readJsonSafe } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  workflowDefinitionFormSchema,
  createFormGroups,
  createFieldDefinitions,
  defaultFormValues,
  buildWorkflowPayload,
  type WorkflowDefinitionFormValues,
} from '../../../components/formConfig'
import { StepsEditor } from '../../../components/StepsEditor'
import { TransitionsEditor } from '../../../components/TransitionsEditor'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Zap } from 'lucide-react'
import { formatWorkflowValidationError } from '../../../lib/format-validation-error'

export default function CreateWorkflowDefinitionPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const t = useT()

  const handleSubmit = async (values: WorkflowDefinitionFormValues) => {
    const payload = buildWorkflowPayload(values)

    const response = await apiFetch('/api/workflows/definitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorBody = await readJsonSafe<{ error?: string; details?: Array<{ path?: Array<string | number>; message?: string }> }>(response, null)
      throw new Error(formatWorkflowValidationError(errorBody, t('workflows.errors.createFailed')))
    }

    // The list lives in a client `useQuery`, and getting back there is a
    // client-side navigation, so `router.refresh()` alone re-runs the server
    // render while React Query keeps serving the pre-create page — the new
    // definition stays invisible until a hard reload.
    await queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] })
    router.push('/backend/definitions')
    router.refresh()
  }

  const fields = React.useMemo(() => createFieldDefinitions(t), [t])

  const formGroups = React.useMemo(
    () => createFormGroups(t, StepsEditor, TransitionsEditor),
    [t]
  )

  return (
    <Page>
      <PageBody>
        <Alert status="information" icon={<Zap aria-hidden="true" />} className="mb-6">
          <AlertTitle>{t('workflows.create.eventTriggersTitle')}</AlertTitle>
          <AlertDescription>
            {t('workflows.create.eventTriggersDescription')}
          </AlertDescription>
        </Alert>
        <CrudForm
          title={t('workflows.create.title')}
          backHref="/backend/definitions"
          schema={workflowDefinitionFormSchema}
          fields={fields}
          initialValues={defaultFormValues}
          onSubmit={handleSubmit}
          cancelHref="/backend/definitions"
          groups={formGroups}
          submitLabel={t('workflows.form.create')}
        />
      </PageBody>
    </Page>
  )
}
