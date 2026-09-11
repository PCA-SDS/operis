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
  }, [page, query])

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
    <Page>
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <form
            className="flex min-w-0 flex-1 gap-2"
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
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/backend/email/templates/create">{t('email.templates.newTemplate', 'New Template')}</Link>
            </Button>
          </div>
        </div>
        <DataTable<EmailTemplateRow>
          title={t('email.templates.title', 'Email Templates')}
          columns={columns}
          data={rows}
          isLoading={isLoading}
          error={error}
          emptyState={t('email.templates.empty', 'No saved email templates yet. Create a tenant-owned template from scratch.')}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
    </Page>
  )
}
