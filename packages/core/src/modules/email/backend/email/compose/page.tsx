'use client'

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  blocksToHtml,
  parseVariableTypes,
  renderHtmlPreviewWithSamples,
  renderWithSamples,
  type BlockType,
  type TemplateBlockFormValue,
} from '../templates/_components/TemplateBuilderForm'

type TemplateBlock = {
  id: string
  type: string
  label?: string
  props?: Record<string, unknown>
  children?: unknown[]
}

type EmailTemplateRow = {
  id: string
  template_key: string
  name: string
  subject: string
  preheader?: string | null
  blocks?: TemplateBlock[]
  accounting_metadata?: {
    defaultValues?: Record<string, string>
    variableTypes?: Record<string, string>
  } | null
}

type ListResponse = {
  items?: EmailTemplateRow[]
}

type EmailDraftPart = 'recipients' | 'subject' | 'body'

type ClipboardItemConstructor = new (items: Record<string, Blob>) => ClipboardItem

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

function blocksFromStored(blocks: TemplateBlock[] | undefined): TemplateBlockFormValue[] {
  const storedBlocks = typeof blocks === 'string' ? (() => {
    try {
      return JSON.parse(blocks) as unknown
    } catch {
      return blocks
    }
  })() : blocks
  if (!Array.isArray(storedBlocks)) return []
  return storedBlocks.map((item, index) => {
    const block = item && typeof item === 'object' && !Array.isArray(item) ? item as TemplateBlock : { id: `stored-${index}`, type: 'paragraph', props: {} }
    return ({
    id: block.id || `stored-${index}`,
    type: (block.type === 'rich-text-html' || block.type === 'rich_text' ? 'rich-text-html' : block.type === 'heading' || block.type === 'button' || block.type === 'divider' ? block.type : 'paragraph') as BlockType,
    label: block.label || `Block ${index + 1}`,
    content: typeof block.props?.html === 'string' ? block.props.html : typeof block.props?.text === 'string' ? block.props.text : '',
    url: typeof block.props?.href === 'string' ? block.props.href : '',
  })
  })
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

function greetingFromPeople(people: CompanyPerson[]) {
  const names = people.map(readDisplayName).filter(Boolean)
  if (names.length === 0) return 'Dear Sir/Madam,'
  return names.map((name) => `Dear ${name},`).join('\n')
}

function rowsToRecord(rows: KeyValueRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.key.trim(), row.value] as const).filter(([key]) => key.length > 0))
}

function HelpLabel({ children, help }: { children: React.ReactNode; help: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{children}</span>
      <span className="group relative inline-flex">
        <button
          type="button"
          aria-label={help}
          className="inline-flex size-4 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
        >
          i
        </button>
        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden w-64 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs font-normal text-popover-foreground shadow-md group-hover:block group-focus-within:block">
          {help}
        </span>
      </span>
    </span>
  )
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
  const [companyName, setCompanyName] = React.useState('Harborview Analytics')
  const [companyCode, setCompanyCode] = React.useState('HV-001')
  const [companyEmail, setCompanyEmail] = React.useState('info@harborviewanalytics.com')
  const [contactNames, setContactNames] = React.useState('Ms. Linh, Mr. David')
  const [recipientEmails, setRecipientEmails] = React.useState('linh@example.com, david@example.com')
  const [greeting, setGreeting] = React.useState('Dear Ms. Linh and Mr. David,')
  const [accountingRows, setAccountingRows] = React.useState<KeyValueRow[]>([
    { key: 'quarterPeriod', value: 'Quarter 1 2026' },
    { key: 'declarationDeadline', value: 'April 29, 2026' },
  ])
  const [copiedPart, setCopiedPart] = React.useState<EmailDraftPart | null>(null)

  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    async function loadTemplates() {
      setIsLoading(true)
      setError(null)
      const response = await apiCall<ListResponse>('/api/email/templates?activeOnly=true&pageSize=100&sort=updatedAt&order=desc', {
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
  }, [selectedCompanyId])

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

  const templateDefaults = selectedTemplate?.accounting_metadata?.defaultValues ?? {}
  const effectiveRecipientEmails = recipientEmails.trim() || companyEmail.trim()
  const mergedSamples = {
    companyName,
    companyCode,
    companyEmail,
    contactNames,
    recipientEmails: effectiveRecipientEmails,
    greeting,
    ...templateDefaults,
    ...rowsToRecord(accountingRows),
  }
  const variableTypes = parseVariableTypes(JSON.stringify(selectedTemplate?.accounting_metadata?.variableTypes ?? {}))
  const blocks = blocksFromStored(selectedTemplate?.blocks)
  const previewSubject = selectedTemplate ? renderWithSamples(selectedTemplate.subject, mergedSamples) : t('email.compose.selectPublishedTemplate', 'Select a published template')
  const previewPreheader = selectedTemplate?.preheader ? renderWithSamples(selectedTemplate.preheader, mergedSamples) : ''
  const previewHtml = selectedTemplate ? renderHtmlPreviewWithSamples(blocksToHtml(blocks), mergedSamples, variableTypes) : `<p>${t('email.compose.noTemplateSelected', 'No template selected.')}</p>`
  const hasTemplates = templates.length > 0
  const hasCompanies = companies.length > 0
  const copyDraftPart = async (part: EmailDraftPart) => {
    if (part === 'body') {
      await copyHtml(previewHtml)
    } else {
      await navigator.clipboard.writeText(part === 'recipients' ? effectiveRecipientEmails : previewSubject)
    }
    setCopiedPart(part)
    window.setTimeout(() => setCopiedPart(null), 1800)
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{t('email.compose.title', 'Compose Email')}</h1>
            <p className="text-sm text-muted-foreground">{t('email.compose.description', 'Preview a published tenant template with selected company/contact and accounting values. This does not send email.')}</p>
          </div>
          <Button variant="secondary" asChild><Link href="/backend/email/templates">{t('email.compose.backToTemplates', 'Back to Templates')}</Link></Button>
        </div>
        {error ? <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
        {!isLoading && !hasTemplates ? (
          <div className="mb-4 rounded-md border border-dashed bg-card px-4 py-3 text-sm text-muted-foreground">
            {t('email.compose.empty.templates', 'No published email templates are available. Publish a template before composing email.')}
          </div>
        ) : null}
        {!isLoadingCompanies && !hasCompanies ? (
          <div className="mb-4 rounded-md border border-dashed bg-card px-4 py-3 text-sm text-muted-foreground">
            {t('email.compose.empty.companies', 'No companies are available. Create or select a customer company before composing email.')}
          </div>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <section className="space-y-4 rounded-lg border bg-card p-4">
            <label className="block text-sm font-medium"><HelpLabel help={t('email.compose.template.help', 'Choose a published tenant-owned template. Draft and archived templates are not available here.')}>{t('email.compose.template.label', 'Template')}</HelpLabel>
              <select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" disabled={isLoading || templates.length === 0} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                {templates.length ? templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>) : <option value="">{t('email.compose.template.nonePublished', 'No published templates')}</option>}
              </select>
            </label>
            <label className="block text-sm font-medium"><HelpLabel help={t('email.compose.company.help', 'Choose the Operis customer company whose values should fill system variables such as companyName and companyEmail.')}>{t('email.compose.company.label', 'Company')}</HelpLabel>
              <select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" disabled={isLoadingCompanies || companies.length === 0} value={selectedCompanyId} onChange={(event) => setSelectedCompanyId(event.target.value)}>
                {companies.length ? companies.map((company) => <option key={company.id} value={company.id}>{readDisplayName(company) || company.id}</option>) : <option value="">{t('email.compose.company.noneFound', 'No companies found')}</option>}
              </select>
              <span className="mt-1 block text-xs text-muted-foreground">{t('email.compose.company.description', 'Selecting a company fills company variables and linked people/recipient variables when available.')}</span>
            </label>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1">
              <label className="block text-sm font-medium"><HelpLabel help={t('email.compose.companyName.help', 'Filled from the selected company; editable for this preview only.')}>{t('email.compose.companyName', 'Company name')}</HelpLabel><input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></label>
              <label className="block text-sm font-medium"><HelpLabel help={t('email.compose.companyCode.help', 'Optional company code used by templates such as accounting subjects.')}>{t('email.compose.companyCode', 'Company code')}</HelpLabel><input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={companyCode} onChange={(event) => setCompanyCode(event.target.value)} /></label>
              <label className="block text-sm font-medium"><HelpLabel help={t('email.compose.companyEmail.help', 'Company email from the customer record; editable for this preview only.')}>{t('email.compose.companyEmail', 'Company email')}</HelpLabel><input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={companyEmail} onChange={(event) => setCompanyEmail(event.target.value)} /></label>
              <label className="block text-sm font-medium"><HelpLabel help={t('email.compose.contactNames.help', 'Names of people linked to the company. If none are linked, this stays empty until the user fills it manually.')}>{t('email.compose.contactNames', 'Contact names')}</HelpLabel><input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={contactNames} onChange={(event) => setContactNames(event.target.value)} /></label>
              <label className="block text-sm font-medium"><HelpLabel help={t('email.compose.recipientEmails.help', 'Recipient email addresses from linked people. If empty, the selected company email is used as the fallback.')}>{t('email.compose.recipientEmails', 'Recipient emails')}</HelpLabel><input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={recipientEmails} onChange={(event) => setRecipientEmails(event.target.value)} /></label>
              <label className="block text-sm font-medium"><HelpLabel help={t('email.compose.greeting.help', 'Greeting generated from linked people when possible; falls back to a generic greeting if no contacts exist.')}>{t('email.compose.greeting', 'Greeting')}</HelpLabel><input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={greeting} onChange={(event) => setGreeting(event.target.value)} /></label>
            </div>
            <section className="space-y-3 rounded-md border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-medium"><HelpLabel help={t('email.compose.accountingValues.help', 'Fill template-specific accounting placeholders, such as quarter, deadline, payable amount, or report link, for this preview only.')}>{t('email.compose.accountingValues.title', 'Accounting values')}</HelpLabel></h2>
                  <p className="text-xs text-muted-foreground">{t('email.compose.accountingValues.description', 'Fill custom accounting variables for this preview. These values are not saved to the template.')}</p>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={() => setAccountingRows([...accountingRows, { key: '', value: '' }])}>{t('email.compose.accountingValues.add', 'Add value')}</Button>
              </div>
              <div className="space-y-2">
                {accountingRows.map((row, index) => (
                  <div key={`accounting-value-${index}`} className="grid gap-2 md:grid-cols-[minmax(140px,1fr)_minmax(180px,1fr)_auto] lg:grid-cols-[minmax(140px,1fr)_minmax(180px,1fr)_auto]">
                    <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={row.key} onChange={(event) => {
                      const next = [...accountingRows]
                      next[index] = { ...row, key: event.target.value }
                      setAccountingRows(next)
                    }} placeholder={t('email.compose.accountingValues.keyPlaceholder', 'quarterPeriod')} />
                    <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={row.value} onChange={(event) => {
                      const next = [...accountingRows]
                      next[index] = { ...row, value: event.target.value }
                      setAccountingRows(next)
                    }} placeholder={t('email.compose.accountingValues.valuePlaceholder', 'Quarter 1 2026')} />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-9 w-9 shrink-0 px-0 text-destructive hover:text-destructive"
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
          <aside className="space-y-4 rounded-lg border bg-card p-4">
            <div><h2 className="font-semibold"><HelpLabel help={t('email.compose.preview.help', 'Shows the email output using the selected template, company, linked people, and accounting values.')}>{t('email.compose.preview.title', 'Live preview')}</HelpLabel></h2><p className="text-sm text-muted-foreground">{t('email.compose.preview.description', 'System variables come from the selected company and linked people; this page lets users verify output before sending exists.')}</p></div>
            <DraftPartCard copied={copiedPart === 'recipients'} copiedLabel={t('email.common.copied', 'Copied')} copyLabel={t('email.common.copy', 'Copy')} label={t('email.compose.preview.to', 'To')} onCopy={() => void copyDraftPart('recipients')}>
              <div className="mt-1 font-medium">{effectiveRecipientEmails || t('email.compose.preview.noRecipients', 'No recipients selected')}</div>
            </DraftPartCard>
            <DraftPartCard copied={copiedPart === 'subject'} copiedLabel={t('email.common.copied', 'Copied')} copyLabel={t('email.common.copy', 'Copy')} label={t('email.templates.form.subject.label', 'Subject')} onCopy={() => void copyDraftPart('subject')}>
              <div className="mt-1 font-medium">{previewSubject}</div>{previewPreheader ? <div className="mt-1 text-sm text-muted-foreground">{previewPreheader}</div> : null}
            </DraftPartCard>
            <DraftPartCard copied={copiedPart === 'body'} copiedLabel={t('email.common.copied', 'Copied')} copyLabel={t('email.common.copy', 'Copy')} label={t('email.templates.preview.emailBody', 'Email body')} onCopy={() => void copyDraftPart('body')}>
              {selectedTemplate ? (
                <iframe className="mt-2 h-[560px] w-full rounded border bg-white" sandbox="" srcDoc={`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;padding:16px">${previewHtml}</body></html>`} title={t('email.compose.preview.iframeTitle', 'Email compose preview')} />
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
    <section className="rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <Button type="button" size="sm" variant="secondary" onClick={onCopy}>{copied ? copiedLabel : copyLabel}</Button>
      </div>
      {children}
    </section>
  )
}

function htmlToPlainText(html: string) {
  const element = document.createElement('div')
  element.innerHTML = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
  return (element.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

async function copyHtml(html: string) {
  const plainText = htmlToPlainText(html)
  const ClipboardItemCtor = (globalThis as { ClipboardItem?: ClipboardItemConstructor }).ClipboardItem

  if (navigator.clipboard.write && ClipboardItemCtor) {
    await navigator.clipboard.write([
      new ClipboardItemCtor({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      }),
    ])
    return
  }

  await navigator.clipboard.writeText(plainText)
}
