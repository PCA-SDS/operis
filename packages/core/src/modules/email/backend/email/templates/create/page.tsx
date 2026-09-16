'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createStaticBlock } from '@open-mercato/core/modules/email/components/templateHtml'
import {
  DEFAULT_TEMPLATE_CATEGORY,
  buildTemplateApiPayload,
  type TemplateBuilderFormValue,
} from '@open-mercato/core/modules/email/components/templatePayload'
import { TemplateBuilderForm } from '../_components/TemplateBuilderForm'

const initialForm: TemplateBuilderFormValue = {
  templateKey: '',
  name: '',
  description: '',
  category: DEFAULT_TEMPLATE_CATEGORY,
  status: 'draft',
  subject: '',
  preheader: '',
  variables: '',
  fields: '',
  defaultValues: '{}',
  variableTypes: '{}',
  rules: '{}',
  ruleNotes: '',
  workflowKey: '',
  sortOrder: '0',
  isActive: true,
  blocks: [],
}

function createInitialForm(bodyText: string, blockLabel: string): TemplateBuilderFormValue {
  return {
    ...initialForm,
    blocks: [createStaticBlock('initial-body', 'rich-text-html', `<p>Hello {{companyName}},</p><p>${bodyText}</p>`, '', blockLabel)],
  }
}

export default function CreateEmailTemplatePage() {
  const t = useT()
  const router = useRouter()
  const [form, setForm] = React.useState<TemplateBuilderFormValue>(() => createInitialForm(
    t('email.templates.form.initialBody', 'Write your email body here.'),
    t('email.templates.blocks.richText', 'Rich text'),
  ))
  const [error, setError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSaving(true)
    try {
      const payload = buildTemplateApiPayload(form, t('email.templates.blocks.openLink', 'Open link'))
      await createCrud('email/templates', payload, {
        fallbackResult: null,
        errorMessage: t('email.templates.errors.create', 'Failed to create email template'),
      })
      router.push('/backend/email/templates')
    } catch (err) {
      if (surfaceRecordConflict(err, t)) return
      setError(err instanceof Error ? err.message.replace(/^\[internal]\s*/, '') : t('email.templates.errors.create', 'Failed to create email template'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Page className="min-w-0 overflow-x-hidden">
      <PageHeader
        title={t('email.templates.create.title', 'Create Email Template')}
        description={t('email.templates.create.description', 'Tenant-owned templates with workflow rules, typed variables, live preview, and visual-builder blocks.')}
        actions={<Button variant="secondary" asChild><Link href="/backend/email/templates">{t('email.common.back', 'Back')}</Link></Button>}
      />
      <PageBody className="min-w-0 w-full max-w-full">
        <TemplateBuilderForm mode="create" value={form} error={error} isSaving={isSaving} onChange={setForm} onSubmit={submit} />
      </PageBody>
    </Page>
  )
}
