'use client'

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { HelpLabel } from '../../../components/HelpLabel'
import { copyHtml, copyText } from '../../../components/clipboard'
import { FIELD_CLASS, PANEL_CLASS, PREVIEW_FRAME_CLASS, SUBPANEL_CLASS, previewDocument } from '../../../components/formStyles'
import {
  blocksFromRecord,
  blocksToHtml,
  parseVariableTypes,
  renderHtmlPreviewWithSamples,
  renderWithSamples,
} from '../../../components/templateHtml'
import { mergeEmailTemplateVariables, withoutReservedEmailSystemVariables } from '../../../lib/accountingDefaults'

type EmailTemplateRow = {
  id: string
  template_key: string
  name: string
  subject: string
  preheader?: string | null
  design?: unknown
  blocks?: unknown
  accounting_metadata?: {
    defaultValues?: Record<string, string>
    variableTypes?: Record<string, string>
  } | null
}

type ListResponse = {
  items?: EmailTemplateRow[]
}

type AccountingDefaultsResponse = {
  placeholders?: Record<string, unknown>
  link_placeholders?: Record<string, unknown>
}

type EmailDraftPart = 'recipients' | 'subject' | 'body'

type KeyValueRow = {
  key: string
  value: string
}

type CompanyListItem = {
  id: string
  displayName?: string | null
  display_name?: string | null
  primaryEmail?: string | null
  primary_email?: string | null
}

type CompanyPerson = {
  displayName?: string | null
  display_name?: string | null
  primaryEmail?: string | null
  primary_email?: string | null
}

type CompanyDetailResponse = {
  company?: {
    id?: string
    displayName?: string | null
    display_name?: string | null
    primaryEmail?: string | null
    primary_email?: string | null
  } | null
  profile?: {
    taxCode?: string | null
    tax_code?: string | null
  } | null
}

type CompanyPeopleResponse = {
  items?: CompanyPerson[]
}

function readDisplayName(value: { displayName?: string | null; display_name?: string | null }): string {
  return (value.displayName ?? value.display_name ?? '').trim()
}

function readPrimaryEmail(value: { primaryEmail?: string | null; primary_email?: string | null }): string {
  return (value.primaryEmail ?? value.primary_email ?? '').trim()
}

function readCompanyCode(value: CompanyDetailResponse): string {
  return (value.profile?.taxCode ?? value.profile?.tax_code ?? value.company?.id ?? '').trim()
}

function rowsToRecord(rows: KeyValueRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.key.trim(), row.value] as const).filter(([key]) => key.length > 0))
}

export default function EmailComposePreviewPage() {
  const t = useT()
  const [templates, setTemplates] = React.useState<EmailTemplateRow[]>([])
  const [companies, setCompanies] = React.useState<CompanyListItem[]>([])
  const [selectedId, setSelectedId] = React.useState('')
  const [selectedCompanyId, setSelectedCompanyId] = React.useState('')
  const [selectedTemplate, setSelectedTemplate] = React.useState<EmailTemplateRow | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isLoadingCompanies, setIsLoadingCompanies] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  // Start empty. These used to be seeded with plausible-looking company and
  // recipient details, and nothing cleared them when the customers reads failed
  // — a user holding only email.templates.view gets 403 on those endpoints and
  // would otherwise copy a complete draft addressed to people who do not exist.
  const [companyName, setCompanyName] = React.useState('')
  const [companyCode, setCompanyCode] = React.useState('')
  const [companyEmail, setCompanyEmail] = React.useState('')
  const [contactNames, setContactNames] = React.useState('')
  const [recipientEmails, setRecipientEmails] = React.useState('')
  const [greeting, setGreeting] = React.useState('')
  const [accountingRows, setAccountingRows] = React.useState<KeyValueRow[]>([])
  const [accountingDefaults, setAccountingDefaults] = React.useState<Record<string, string>>({})
  const [copiedPart, setCopiedPart] = React.useState<EmailDraftPart | null>(null)

  const greetingFromPeople = React.useCallback((people: CompanyPerson[]) => {
    const names = people.map(readDisplayName).filter(Boolean)
    if (names.length === 0) return t('email.compose.greeting.fallback', 'Dear Sir/Madam,')
    return names.map((name) => t('email.compose.greeting.named', 'Dear {name},').replace('{name}', name)).join('\n')
  }, [t])

  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    async function loadTemplates() {
      setIsLoading(true)
      setError(null)
      const response = await apiCall<ListResponse>('/api/email/templates?status=published&pageSize=100&sort=updatedAt&order=desc', {
        signal: controller.signal,
      }).catch((err: unknown) => ({ ok: false as const, result: { error: err instanceof Error ? err.message : t('email.compose.errors.loadTemplates', 'Failed to load templates') } }))
      if (cancelled) return
      if (!response.ok) {
        setTemplates([])
        setError((response.result as { error?: string } | undefined)?.error ?? t('email.compose.errors.loadTemplates', 'Failed to load templates'))
      } else {
        const items = Array.isArray(response.result?.items) ? response.result.items : []
        setTemplates(items)
        setSelectedId((current) => current || items[0]?.id || '')
      }
      setIsLoading(false)
    }
    void loadTemplates()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    async function loadAccountingDefaults() {
      const response = await apiCall<AccountingDefaultsResponse>('/api/email/accounting-defaults', { signal: controller.signal })
        .catch(() => ({ ok: false as const, result: undefined }))
      if (cancelled || !response.ok) return
      setAccountingDefaults({
        ...withoutReservedEmailSystemVariables(response.result?.placeholders),
        ...withoutReservedEmailSystemVariables(response.result?.link_placeholders),
      })
    }
    void loadAccountingDefaults()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    async function loadCompanies() {
      setIsLoadingCompanies(true)
      const response = await apiCall<{ items?: CompanyListItem[] }>('/api/customers/companies?page=1&pageSize=50&sort=updatedAt&order=desc', {
        signal: controller.signal,
      }).catch((err: unknown) => ({ ok: false as const, result: { error: err instanceof Error ? err.message : t('email.compose.errors.loadCompanies', 'Failed to load companies') } }))
      if (cancelled) return
      if (response.ok) {
        const items = Array.isArray(response.result?.items) ? response.result.items : []
        setCompanies(items)
        setSelectedCompanyId((current) => current || items[0]?.id || '')
      }
      setIsLoadingCompanies(false)
    }
    void loadCompanies()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  React.useEffect(() => {
    if (!selectedCompanyId) return
    const controller = new AbortController()
    let cancelled = false
    async function loadCompanyDetail() {
      const [detailResponse, peopleResponse] = await Promise.all([
        apiCall<CompanyDetailResponse>(`/api/customers/companies/${encodeURIComponent(selectedCompanyId)}`, {
          signal: controller.signal,
        }).catch((err: unknown) => ({ ok: false as const, result: { error: err instanceof Error ? err.message : t('email.compose.errors.loadCompanyDetails', 'Failed to load company details') } })),
        apiCall<CompanyPeopleResponse>(`/api/customers/companies/${encodeURIComponent(selectedCompanyId)}/people?pageSize=100&sort=name-asc`, {
          signal: controller.signal,
        }).catch((err: unknown) => ({ ok: false as const, result: { error: err instanceof Error ? err.message : t('email.compose.errors.loadCompanyDetails', 'Failed to load company details') } })),
      ])
      if (cancelled || !detailResponse.ok) return
      const detail = detailResponse.result
      const company = detail?.company
      const people = peopleResponse.ok && Array.isArray(peopleResponse.result?.items) ? peopleResponse.result.items : []
      if (company) {
        const nextCompanyName = readDisplayName(company)
        const nextCompanyEmail = readPrimaryEmail(company)
        setCompanyName((current) => nextCompanyName || current)
        setCompanyCode((current) => readCompanyCode(detail) || current)
        setCompanyEmail((current) => nextCompanyEmail || current)
      }
      setContactNames(people.map(readDisplayName).filter(Boolean).join(', '))
      setRecipientEmails(people.map(readPrimaryEmail).filter(Boolean).join(', '))
      setGreeting(greetingFromPeople(people))
    }
    void loadCompanyDetail()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [selectedCompanyId, greetingFromPeople])

  React.useEffect(() => {
    if (!selectedId) {
      setSelectedTemplate(null)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    async function loadTemplate() {
      const response = await apiCall<ListResponse & { item?: EmailTemplateRow; data?: EmailTemplateRow }>(`/api/email/templates/${encodeURIComponent(selectedId)}`, {
        signal: controller.signal,
      }).catch((err: unknown) => ({ ok: false as const, result: { error: err instanceof Error ? err.message : t('email.compose.errors.loadTemplateDetails', 'Failed to load template details') } }))
      if (cancelled) return
      if (!response.ok) {
        setSelectedTemplate(null)
        setError((response.result as { error?: string } | undefined)?.error ?? t('email.compose.errors.loadTemplateDetails', 'Failed to load template details'))
        return
      }
      setSelectedTemplate(response.result?.item ?? response.result?.data ?? response.result?.items?.[0] ?? null)
    }
    void loadTemplate()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [selectedId])

  React.useEffect(() => {
    const defaults = selectedTemplate?.accounting_metadata?.defaultValues ?? {}
    if (!Object.keys(defaults).length) return
    setAccountingRows((current) => {
      const existing = new Set(current.map((row) => row.key))
      const additions = Object.entries(defaults)
        .filter(([key]) => !existing.has(key))
        .map(([key, value]) => ({ key, value: String(value ?? '') }))
      return additions.length ? [...current, ...additions] : current
    })
  }, [selectedTemplate])

  const templateDefaults = withoutReservedEmailSystemVariables(selectedTemplate?.accounting_metadata?.defaultValues)
  const effectiveRecipientEmails = recipientEmails.trim() || companyEmail.trim()
  const mergedSamples = mergeEmailTemplateVariables({
    companyName,
    companyCode,
    companyEmail,
    contactNames,
    recipientEmails: effectiveRecipientEmails,
    greeting,
  }, accountingDefaults, templateDefaults, rowsToRecord(accountingRows))
  const variableTypes = parseVariableTypes(JSON.stringify(selectedTemplate?.accounting_metadata?.variableTypes ?? {}))
  // Same reader as the builder, including the `design.body.html` fallback for
  // migrated rows — compose used to read `blocks` only, so a template with a
  // body but no blocks previewed (and copied) as an empty email.
  const blocks = blocksFromRecord(selectedTemplate?.blocks, selectedTemplate?.design)
  const previewSubject = selectedTemplate ? renderWithSamples(selectedTemplate.subject, mergedSamples) : t('email.compose.selectPublishedTemplate', 'Select a published template')
  const previewPreheader = selectedTemplate?.preheader ? renderWithSamples(selectedTemplate.preheader, mergedSamples) : ''
  const previewHtml = selectedTemplate
    ? renderHtmlPreviewWithSamples(blocksToHtml(blocks, t('email.templates.blocks.openLink', 'Open link')), mergedSamples, variableTypes)
    : `<p>${t('email.compose.noTemplateSelected', 'No template selected.')}</p>`
  const hasTemplates = templates.length > 0
  const hasCompanies = companies.length > 0
  const copyDraftPart = async (part: EmailDraftPart) => {
    if (part === 'body') {
      await copyHtml(previewHtml)
    } else {
      await copyText(part === 'recipients' ? effectiveRecipientEmails : previewSubject)
    }
    setCopiedPart(part)
    window.setTimeout(() => setCopiedPart(null), 1800)
  }

  return (
    <Page className="min-w-0 overflow-x-hidden">
      <PageHeader
        title={t('email.compose.title', 'Compose Email')}
        description={t('email.compose.description', 'Preview a published tenant template with selected company/contact and accounting values. This does not send email.')}
        actions={<Button variant="secondary" asChild><Link href="/backend/email/templates">{t('email.compose.backToTemplates', 'Back to Templates')}</Link></Button>}
      />
      <PageBody className="min-w-0 w-full max-w-full">
        {error ? <ErrorMessage label={error} /> : null}
        {isLoading ? <LoadingMessage label={t('email.compose.loadingTemplates', 'Loading email templates…')} /> : null}
        {!isLoading && !hasTemplates ? (
          <EmptyState
            variant="subtle"
            title={t('email.compose.empty.templates', 'No published email templates are available. Publish a template before composing email.')}
            actions={<Button variant="secondary" asChild><Link href="/backend/email/templates">{t('email.compose.backToTemplates', 'Back to Templates')}</Link></Button>}
          />
        ) : null}
        {!isLoadingCompanies && !hasCompanies ? (
          <EmptyState
            variant="subtle"
            title={t('email.compose.empty.companies', 'No companies are available. Create or select a customer company before composing email.')}
          />
        ) : null}
        <div className="grid w-full max-w-full min-w-0 gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <section className="w-full max-w-full min-w-0 space-y-4 rounded-lg border bg-surface p-4">
            <label className="block text-sm font-medium"><HelpLabel help={t('email.compose.template.help', 'Choose a published tenant-owned template. Draft and archived templates are not available here.')}>{t('email.compose.template.label', 'Template')}</HelpLabel>
              <select className={`mt-1 ${FIELD_CLASS}`} disabled={isLoading || templates.length === 0} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                {templates.length ? templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>) : <option value="">{t('email.compose.template.nonePublished', 'No published templates')}</option>}
              </select>
            </label>
            <label className="block text-sm font-medium"><HelpLabel help={t('email.compose.company.help', 'Choose the Operis customer company whose values should fill system variables such as companyName and companyEmail.')}>{t('email.compose.company.label', 'Company')}</HelpLabel>
              <select className={`mt-1 ${FIELD_CLASS}`} disabled={isLoadingCompanies || companies.length === 0} value={selectedCompanyId} onChange={(event) => setSelectedCompanyId(event.target.value)}>
                {companies.length ? companies.map((company) => <option key={company.id} value={company.id}>{readDisplayName(company) || company.id}</option>) : <option value="">{t('email.compose.company.noneFound', 'No companies found')}</option>}
              </select>
              <span className="mt-1 block text-xs text-muted-foreground">{t('email.compose.company.description', 'Selecting a company fills company variables and linked people/recipient variables when available.')}</span>
            </label>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <label className="block text-sm font-medium"><HelpLabel help={t('email.compose.companyName.help', 'Filled from the selected company; editable for this preview only.')}>{t('email.compose.companyName', 'Company name')}</HelpLabel><Input className="mt-1" value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></label>
              <label className="block text-sm font-medium"><HelpLabel help={t('email.compose.companyCode.help', 'Optional company code used by templates such as accounting subjects.')}>{t('email.compose.companyCode', 'Company code')}</HelpLabel><Input className="mt-1" value={companyCode} onChange={(event) => setCompanyCode(event.target.value)} /></label>
              <label className="block text-sm font-medium"><HelpLabel help={t('email.compose.companyEmail.help', 'Company email from the customer record; editable for this preview only.')}>{t('email.compose.companyEmail', 'Company email')}</HelpLabel><Input className="mt-1" value={companyEmail} onChange={(event) => setCompanyEmail(event.target.value)} /></label>
              <label className="block text-sm font-medium"><HelpLabel help={t('email.compose.contactNames.help', 'Names of people linked to the company. If none are linked, this stays empty until the user fills it manually.')}>{t('email.compose.contactNames', 'Contact names')}</HelpLabel><Input className="mt-1" value={contactNames} onChange={(event) => setContactNames(event.target.value)} /></label>
              <label className="block text-sm font-medium"><HelpLabel help={t('email.compose.recipientEmails.help', 'Recipient email addresses from linked people. If empty, the selected company email is used as the fallback.')}>{t('email.compose.recipientEmails', 'Recipient emails')}</HelpLabel><Input className="mt-1" value={recipientEmails} onChange={(event) => setRecipientEmails(event.target.value)} /></label>
              <label className="block text-sm font-medium"><HelpLabel help={t('email.compose.greeting.help', 'Greeting generated from linked people when possible; falls back to a generic greeting if no contacts exist.')}>{t('email.compose.greeting', 'Greeting')}</HelpLabel><Input className="mt-1" value={greeting} onChange={(event) => setGreeting(event.target.value)} /></label>
            </div>
            <section className={PANEL_CLASS}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-medium"><HelpLabel help={t('email.compose.accountingValues.help', 'Fill template-specific accounting placeholders, such as quarter, deadline, payable amount, or report link, for this preview only.')}>{t('email.compose.accountingValues.title', 'Accounting values')}</HelpLabel></h2>
                  <p className="text-xs text-muted-foreground">{t('email.compose.accountingValues.description', 'Fill custom accounting variables for this preview. These values are not saved to the template.')}</p>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={() => setAccountingRows([...accountingRows, { key: '', value: '' }])}>{t('email.compose.accountingValues.add', 'Add value')}</Button>
              </div>
              <div className="space-y-2">
                {accountingRows.map((row, index) => (
                  <div key={`accounting-value-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-1 md:grid-cols-[minmax(140px,1fr)_minmax(180px,1fr)_auto] md:gap-2 lg:grid-cols-[minmax(140px,1fr)_minmax(180px,1fr)_auto]">
                    <Input className="min-w-0" value={row.key} onChange={(event) => {
                      const next = [...accountingRows]
                      next[index] = { ...row, key: event.target.value }
                      setAccountingRows(next)
                    }} placeholder={t('email.compose.accountingValues.keyPlaceholder', 'quarterPeriod')} />
                    <Input className="min-w-0" value={row.value} onChange={(event) => {
                      const next = [...accountingRows]
                      next[index] = { ...row, value: event.target.value }
                      setAccountingRows(next)
                    }} placeholder={t('email.compose.accountingValues.valuePlaceholder', 'Quarter 1 2026')} />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-9 w-8 shrink-0 justify-self-end px-0 text-destructive hover:text-destructive"
                      aria-label={t('email.common.remove', 'Remove')}
                      title={t('email.common.remove', 'Remove')}
                      onClick={() => setAccountingRows(accountingRows.filter((_, rowIndex) => rowIndex !== index))}
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          </section>
          <aside className="w-full max-w-full min-w-0 space-y-4 rounded-lg border bg-surface p-4">
            <div><h2 className="font-semibold"><HelpLabel help={t('email.compose.preview.help', 'Shows the email output using the selected template, company, linked people, and accounting values.')}>{t('email.compose.preview.title', 'Live preview')}</HelpLabel></h2><p className="text-sm text-muted-foreground">{t('email.compose.preview.description', 'System variables come from the selected company and linked people; this page lets users verify output before sending exists.')}</p></div>
            <DraftPartCard copied={copiedPart === 'recipients'} copiedLabel={t('email.common.copied', 'Copied')} copyLabel={t('email.common.copy', 'Copy')} label={t('email.compose.preview.to', 'To')} onCopy={() => void copyDraftPart('recipients')}>
              <div className="mt-1 font-medium">{effectiveRecipientEmails || t('email.compose.preview.noRecipients', 'No recipients selected')}</div>
            </DraftPartCard>
            <DraftPartCard copied={copiedPart === 'subject'} copiedLabel={t('email.common.copied', 'Copied')} copyLabel={t('email.common.copy', 'Copy')} label={t('email.templates.form.subject.label', 'Subject')} onCopy={() => void copyDraftPart('subject')}>
              <div className="mt-1 font-medium">{previewSubject}</div>{previewPreheader ? <div className="mt-1 text-sm text-muted-foreground">{previewPreheader}</div> : null}
            </DraftPartCard>
            <DraftPartCard copied={copiedPart === 'body'} copiedLabel={t('email.common.copied', 'Copied')} copyLabel={t('email.common.copy', 'Copy')} label={t('email.templates.preview.emailBody', 'Email body')} onCopy={() => void copyDraftPart('body')}>
              {selectedTemplate ? (
                <iframe className={PREVIEW_FRAME_CLASS} sandbox="" srcDoc={previewDocument(previewHtml)} title={t('email.compose.preview.iframeTitle', 'Email compose preview')} />
              ) : (
                <div className="mt-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">{t('email.compose.preview.emptyBody', 'Select a published template to preview the email body.')}</div>
              )}
            </DraftPartCard>
          </aside>
        </div>
      </PageBody>
    </Page>
  )
}

function DraftPartCard({ children, copied, copiedLabel, copyLabel, label, onCopy }: { children: React.ReactNode; copied: boolean; copiedLabel: string; copyLabel: string; label: string; onCopy: () => void }) {
  return (
    <section className={SUBPANEL_CLASS}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <Button type="button" size="sm" variant="secondary" onClick={onCopy}>{copied ? copiedLabel : copyLabel}</Button>
      </div>
      {children}
    </section>
  )
}
