'use client'

import * as React from 'react'
import Link from 'next/link'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
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
      }).catch((err: unknown) => ({ ok: false as const, result: { error: err instanceof Error ? err.message : 'Failed to load email templates' } }))
      if (cancelled) return
      if (!response.ok) {
        const body = response.result as { error?: string } | undefined
        setRows([])
        setTotal(0)
        setTotalPages(1)
        setError(body?.error ?? 'Failed to load email templates')
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
      { header: 'Name', accessorKey: 'name' },
      { header: 'Key', accessorKey: 'template_key', meta: { truncate: true, maxWidth: 220 } },
      { header: 'Category', accessorKey: 'category' },
      { header: 'Subject', accessorKey: 'subject', meta: { truncate: true, maxWidth: 360 } },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <Tag variant={statusVariant(row.original.status)}>{row.original.status}</Tag>,
      },
      {
        header: 'Updated',
        accessorKey: 'updatedAt',
        cell: ({ row }) => new Date(row.original.updatedAt).toLocaleString(),
      },
      {
        header: 'Actions',
        id: 'actions',
        cell: ({ row }) => (
          <Button size="sm" variant="secondary" asChild>
            <Link href={`/backend/email/templates/${row.original.id}/edit`}>Edit</Link>
          </Button>
        ),
      },
    ],
    [],
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
              placeholder="Search templates by name"
            />
            <Button type="submit" variant="secondary">Search</Button>
          </form>
          <div className="flex gap-2">
            <Button variant="secondary" asChild>
              <Link href="/backend/email/accounting-defaults">Accounting Defaults</Link>
            </Button>
            <Button asChild>
              <Link href="/backend/email/templates/create">New Template</Link>
            </Button>
          </div>
        </div>
        <DataTable<EmailTemplateRow>
          title="Email Templates"
          columns={columns}
          data={rows}
          isLoading={isLoading}
          error={error}
          emptyState="No email templates yet. Create one from a PCA starter or from scratch."
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
    </Page>
  )
}
