'use client'

import * as React from 'react'
import { extensionPoints } from '@open-mercato/core/modules/audit_logs/extension-points'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable, type PaginationProps } from '@open-mercato/ui/backend/DataTable'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatResource } from '../lib/display-helpers'
import { formatDateTime } from '@open-mercato/shared/lib/time'

export type AccessLogItem = {
  id: string
  resourceKind: string
  resourceId: string
  accessType: string
  actorUserId: string | null
  actorUserName: string | null
  tenantId: string | null
  tenantName: string | null
  organizationId: string | null
  organizationName: string | null
  fields: string[]
  context: Record<string, unknown> | null
  createdAt: string
}

export function AccessLogsTable({ items, isLoading, actions, pagination }: { items: AccessLogItem[] | undefined; isLoading?: boolean; actions?: React.ReactNode; pagination?: PaginationProps }) {
  const t = useT()
  const accessItems = Array.isArray(items) ? items : []
  const noneLabel = t('audit_logs.common.none')

  const columns = React.useMemo<ColumnDef<AccessLogItem, any>[]>(() => [
    {
      accessorKey: 'resourceKind',
      header: t('audit_logs.access.columns.resource'),
      cell: (info) => formatResource(info.row.original, noneLabel),
    },
    {
      accessorKey: 'accessType',
      header: t('audit_logs.access.columns.access'),
    },
    {
      accessorKey: 'actorUserId',
      header: t('audit_logs.access.columns.user'),
      cell: (info) => info.row.original.actorUserName || info.getValue() || noneLabel,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'tenantId',
      header: t('audit_logs.access.columns.tenant'),
      cell: (info) => info.row.original.tenantName || info.getValue() || noneLabel,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'organizationId',
      header: t('audit_logs.access.columns.organization'),
      cell: (info) => info.row.original.organizationName || info.getValue() || noneLabel,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'fields',
      header: t('audit_logs.access.columns.fields'),
      cell: (info) => {
        const value = info.getValue() as string[]
        return value?.length ? value.join(', ') : noneLabel
      },
    },
    {
      accessorKey: 'createdAt',
      header: t('audit_logs.access.columns.when'),
      cell: (info) => formatDateTime(info.getValue() as string, { fallback: info.getValue() as string }),
    },
  ], [t, noneLabel])

  return (
    <DataTable<AccessLogItem>
      data={accessItems}
      columns={columns}
      perspective={{ tableId: extensionPoints.hosts.accessLogsTable.tableId }}
      isLoading={Boolean(isLoading)}
      actions={actions}
      pagination={pagination}
    />
  )
}
