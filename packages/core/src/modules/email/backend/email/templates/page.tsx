'use client'

import * as React from 'react'
import Link from 'next/link'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type EmailTemplateRow = {
  id: string
  template_key: string
  name: string
  category: string
  status: 'draft' | 'published' | 'archived'
  subject: string
  updatedAt: string
}

type EmailTemplateListResponse = {
  items?: EmailTemplateRow[]
  total?: number
  totalPages?: number
}

type StatusFilter = 'current' | 'draft' | 'published' | 'archived' | 'all'

function statusVariant(status: EmailTemplateRow['status']): 'success' | 'warning' | 'neutral' {
  if (status === 'published') return 'success'
  if (status === 'draft') return 'warning'
  return 'neutral'
}

export default function EmailTemplatesPage() {
  const t = useT()
  const [rows, setRows] = React.useState<EmailTemplateRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('current')
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const pageSize = 25

  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function load() {
      setIsLoading(true)
      setError(null)
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort: 'updatedAt', order: 'desc' })
      if (query.trim()) params.set('search', query.trim())
      if (statusFilter === 'all') params.set('includeArchived', 'true')
      if (statusFilter !== 'current' && statusFilter !== 'all') params.set('status', statusFilter)
      const response = await apiCall<EmailTemplateListResponse>(`/api/email/templates?${params}`, {
        signal: controller.signal,
      }).catch((err: unknown) => ({ ok: false as const, result: { error: err instanceof Error ? err.message : t('email.templates.errors.load', 'Failed to load email templates') } }))
      if (cancelled) return
      if (!response.ok) {
        const body = response.result as { error?: string } | undefined
        setRows([])
        setTotal(0)
        setTotalPages(1)
        setError(body?.error ?? t('email.templates.errors.load', 'Failed to load email templates'))
      } else {
        const body = response.result ?? {}
        setRows(Array.isArray(body.items) ? body.items : [])
        setTotal(typeof body.total === 'number' ? body.total : 0)
        setTotalPages(typeof body.totalPages === 'number' ? body.totalPages : 1)
      }
      setIsLoading(false)
    }

    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [page, query, statusFilter])

  const columns = React.useMemo<ColumnDef<EmailTemplateRow>[]>(
    () => [
      { header: t('email.templates.table.name', 'Name'), accessorKey: 'name' },
      { header: t('email.templates.table.key', 'Key'), accessorKey: 'template_key', meta: { truncate: true, maxWidth: 220 } },
      { header: t('email.templates.table.category', 'Category'), accessorKey: 'category' },
      { header: t('email.templates.table.subject', 'Subject'), accessorKey: 'subject', meta: { truncate: true, maxWidth: 360 } },
      {
        header: t('email.templates.table.status', 'Status'),
        accessorKey: 'status',
        cell: ({ row }) => <Tag variant={statusVariant(row.original.status)}>{t(`email.templates.status.${row.original.status}`, row.original.status)}</Tag>,
      },
      {
        header: t('email.templates.table.updated', 'Updated'),
        accessorKey: 'updatedAt',
        cell: ({ row }) => new Date(row.original.updatedAt).toLocaleString(),
      },
      {
        header: t('email.templates.table.actions', 'Actions'),
        id: 'actions',
        cell: ({ row }) => (
          <Button size="sm" variant="secondary" asChild>
            <Link href={`/backend/email/templates/${row.original.id}/edit`}>{t('email.common.edit', 'Edit')}</Link>
          </Button>
        ),
      },
    ],
    [t],
  )

  return (
    <Page className="min-w-0 overflow-x-hidden">
      <PageBody className="min-w-0 w-full max-w-full">
        <div className="mb-4 flex flex-wrap items-stretch justify-between gap-3 sm:items-center">
          <form
            className="flex w-full min-w-0 gap-2 sm:flex-1"
            onSubmit={(event) => {
              event.preventDefault()
              setPage(1)
              setQuery(search)
            }}
          >
            <input
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('email.templates.searchPlaceholder', 'Search templates by name')}
            />
            <Button type="submit" variant="secondary">{t('email.common.search', 'Search')}</Button>
          </form>
          <label className="flex w-full min-w-0 items-center gap-2 text-sm text-muted-foreground sm:w-auto">
            <span>{t('email.templates.filters.status.label', 'Status')}</span>
            <select
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground sm:flex-none"
              value={statusFilter}
              onChange={(event) => {
                setPage(1)
                setStatusFilter(event.target.value as StatusFilter)
              }}
            >
              <option value="current">{t('email.templates.filters.status.current', 'Current: Draft + Published')}</option>
              <option value="draft">{t('email.templates.status.draft', 'Draft')}</option>
              <option value="published">{t('email.templates.status.published', 'Published')}</option>
              <option value="archived">{t('email.templates.status.archived', 'Archived')}</option>
              <option value="all">{t('email.templates.filters.status.all', 'All statuses')}</option>
            </select>
          </label>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button className="w-full sm:w-auto" asChild>
              <Link href="/backend/email/templates/create">{t('email.templates.newTemplate', 'New Template')}</Link>
            </Button>
          </div>
        </div>
        <div className="space-y-3 sm:hidden">
          {isLoading ? <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{t('ui.dataTable.loading', 'Loading data...')}</div> : null}
          {!isLoading && error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}
          {!isLoading && !error && rows.length === 0 ? <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">{statusFilter === 'archived' ? t('email.templates.empty.archived', 'No archived email templates found.') : t('email.templates.empty', 'No saved email templates yet. Create a tenant-owned template from scratch.')}</div> : null}
          {!isLoading && !error ? rows.map((row) => (
            <article key={row.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words font-semibold">{row.name}</h2>
                  <p className="break-all text-xs text-muted-foreground">{row.template_key}</p>
                </div>
                <Tag variant={statusVariant(row.status)}>{t(`email.templates.status.${row.status}`, row.status)}</Tag>
              </div>
              <dl className="mt-3 grid gap-2 text-sm">
                <div><dt className="text-xs text-muted-foreground">{t('email.templates.table.category', 'Category')}</dt><dd>{row.category}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t('email.templates.table.subject', 'Subject')}</dt><dd className="break-words">{row.subject}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t('email.templates.table.updated', 'Updated')}</dt><dd>{new Date(row.updatedAt).toLocaleString()}</dd></div>
              </dl>
              <Button className="mt-4 w-full" variant="secondary" asChild><Link href={`/backend/email/templates/${row.id}/edit`}>{t('email.common.edit', 'Edit')}</Link></Button>
            </article>
          )) : null}
        </div>
        <div className="hidden sm:block">
          <DataTable<EmailTemplateRow>
            title={t('email.templates.title', 'Email Templates')}
            columns={columns}
            data={rows}
            isLoading={isLoading}
            error={error}
            emptyState={statusFilter === 'archived' ? t('email.templates.empty.archived', 'No archived email templates found.') : t('email.templates.empty', 'No saved email templates yet. Create a tenant-owned template from scratch.')}
            pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
          />
        </div>
      </PageBody>
    </Page>
  )
}
