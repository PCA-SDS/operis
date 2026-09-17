'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import {
  blocksFromRecord,
  createBlock,
  customTemplateVariables,
  type TemplateStatus,
} from '../../../../../components/templateHtml'
import {
  DEFAULT_TEMPLATE_CATEGORY,
  buildTemplateApiPayload,
  type TemplateBuilderFormValue,
} from '../../../../../components/templatePayload'
import { TemplateBuilderForm } from '../../_components/TemplateBuilderForm'

type EmailTemplateRecord = {
  id: string
  template_key: string
  name: string
  description: string | null
  category: string
  status: TemplateStatus
  subject: string
  preheader: string | null
  design: unknown
  blocks: unknown
  variables: unknown
  accounting_metadata: {
    workflowKey?: string
    fields?: string[]
    defaultValues?: Record<string, string>
    variableTypes?: Record<string, string>
    rules?: Record<string, unknown>
    ruleNotes?: string
    sortOrder?: number
    isActive?: boolean
  } | null
  updatedAt: string
}

type EmailTemplateListResponse = { items?: EmailTemplateRecord[] }
type EmailTemplateDetailResponse = EmailTemplateListResponse & { item?: EmailTemplateRecord; data?: EmailTemplateRecord }

type EditTemplateForm = TemplateBuilderFormValue & { updatedAt: string }

const emptyForm: EditTemplateForm = {
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
  updatedAt: '',
}

function toForm(record: EmailTemplateRecord): EditTemplateForm {
  const metadata = record.accounting_metadata ?? {}
  const fields = Array.isArray(metadata.fields) ? metadata.fields : []
  const defaultValues = metadata.defaultValues && typeof metadata.defaultValues === 'object' ? metadata.defaultValues : {}
  const variableTypes = metadata.variableTypes && typeof metadata.variableTypes === 'object' ? metadata.variableTypes : {}
  const rules = metadata.rules && typeof metadata.rules === 'object' && !Array.isArray(metadata.rules) ? metadata.rules : {}
  const variables = Array.isArray(record.variables) ? record.variables.filter((value): value is string => typeof value === 'string') : []
  const storedBlocks = blocksFromRecord(record.blocks, record.design)

  return {
    templateKey: record.template_key,
    name: record.name,
    description: record.description ?? '',
    category: record.category,
    status: record.status,
    subject: record.subject,
    preheader: record.preheader ?? '',
    variables: customTemplateVariables(variables.join(', ')).join(', '),
    fields: fields.join(', '),
    defaultValues: JSON.stringify(defaultValues, null, 2),
    variableTypes: JSON.stringify(variableTypes, null, 2),
    rules: JSON.stringify(rules, null, 2),
    ruleNotes: metadata.ruleNotes ?? '',
    workflowKey: metadata.workflowKey ?? '',
    sortOrder: String(typeof metadata.sortOrder === 'number' ? metadata.sortOrder : 0),
    isActive: metadata.isActive !== false && record.status !== 'archived',
    // A record with no stored body still needs one editable block to type into.
    blocks: storedBlocks.length ? storedBlocks : [createBlock('paragraph', '')],
    updatedAt: record.updatedAt,
  }
}

function templateFromResponse(response: EmailTemplateDetailResponse | null | undefined): EmailTemplateRecord | null {
  if (!response) return null
  if (response.item) return response.item
  if (response.data) return response.data
  if (Array.isArray(response.items)) return response.items[0] ?? null
  return null
}

function templateIdFromPathname(pathname: string): string {
  const match = pathname.match(/\/backend\/email\/templates\/([^/]+)\/edit(?:\/)?$/)
  return match?.[1] ? decodeURIComponent(match[1]) : ''
}

export default function EditEmailTemplatePage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const id = params?.id ?? templateIdFromPathname(pathname)
  const [form, setForm] = React.useState<EditTemplateForm>(emptyForm)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      setNotFound(false)
      const response = await apiCall<EmailTemplateDetailResponse>(`/api/email/templates/${encodeURIComponent(id)}`, { signal: controller.signal })
      if (cancelled) return
      if (!response.ok) {
        const body = response.result as { error?: string; message?: string } | undefined
        throw new Error(body?.error ?? body?.message ?? t('email.templates.errors.loadOne', 'Failed to load email template'))
      }
      const record = templateFromResponse(response.result)
      if (!record) {
        setNotFound(true)
        setIsLoading(false)
        return
      }
      setForm(toForm(record))
      setIsLoading(false)
    }
    void load().catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message.replace(/^\[internal]\s*/, '') : t('email.templates.errors.loadOne', 'Failed to load email template'))
        setIsLoading(false)
      }
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [id])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSaving(true)
    try {
      const payload = buildTemplateApiPayload(form, t('email.templates.blocks.openLink', 'Open link'))
      await updateCrud('email/templates', { ...payload, id, expected_updated_at: form.updatedAt }, {
        fallbackResult: null,
        headers: buildOptimisticLockHeader(form.updatedAt),
        errorMessage: t('email.templates.errors.update', 'Failed to update email template'),
      })
      router.push('/backend/email/templates')
    } catch (err) {
      if (surfaceRecordConflict(err, t)) return
      setError(err instanceof Error ? err.message.replace(/^\[internal]\s*/, '') : t('email.templates.errors.update', 'Failed to update email template'))
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteTemplate() {
    const confirmed = await confirm({
      title: t('email.templates.deleteConfirm.title', 'Delete email template?'),
      text: t('email.templates.deleteConfirm', 'Delete this email template?'),
      confirmText: t('email.common.delete', 'Delete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    setError(null)
    setIsSaving(true)
    try {
      await deleteCrud('email/templates', {
        body: { id, expected_updated_at: form.updatedAt },
        fallbackResult: null,
        headers: buildOptimisticLockHeader(form.updatedAt),
        errorMessage: t('email.templates.errors.delete', 'Failed to delete email template'),
      })
      router.push('/backend/email/templates')
    } catch (err) {
      if (surfaceRecordConflict(err, t)) return
      setError(err instanceof Error ? err.message.replace(/^\[internal]\s*/, '') : t('email.templates.errors.delete', 'Failed to delete email template'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Page className="min-w-0 overflow-x-hidden">
      <PageHeader
        title={t('email.templates.edit.title', 'Edit Email Template')}
        description={t('email.templates.edit.description', 'Update tenant-owned template content, rules, placeholders, preview, and visual-builder blocks.')}
        actions={<Button variant="secondary" asChild><Link href="/backend/email/templates">{t('email.common.back', 'Back')}</Link></Button>}
      />
      <PageBody className="min-w-0 w-full max-w-full">
        {isLoading ? (
          <LoadingMessage label={t('email.templates.loadingOne', 'Loading email template…')} />
        ) : notFound ? (
          <RecordNotFoundState
            label={t('email.templates.notFound.title', 'Email template not found')}
            description={t('email.templates.notFound.description', 'This email template no longer exists, or it belongs to another organization.')}
            backHref="/backend/email/templates"
            backLabel={t('email.templates.notFound.back', 'Back to Email Templates')}
          />
        ) : error && !form.templateKey ? (
          <ErrorMessage label={error} />
        ) : (
          <TemplateBuilderForm mode="edit" value={form} error={error} isSaving={isSaving} onChange={(next) => setForm({ ...next, updatedAt: form.updatedAt })} onSubmit={submit} onDelete={deleteTemplate} />
        )}
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
