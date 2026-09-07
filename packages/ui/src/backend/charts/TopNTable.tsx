"use client"

import * as React from 'react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'

export type TopNTableColumn<T = Record<string, unknown>> = {
  key: keyof T | string
  header: string
  formatter?: (value: unknown, row: T) => React.ReactNode
  align?: 'left' | 'center' | 'right'
  width?: string
}

export type TopNTableProps<T = Record<string, unknown>> = {
  title?: string
  data: T[]
  columns: TopNTableColumn<T>[]
  loading?: boolean
  error?: string | null
  className?: string
  emptyMessage?: string
  maxRows?: number
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

function defaultFormatter(value: unknown): React.ReactNode {
  if (value === null || value === undefined) return '--'
  if (typeof value === 'number') {
    if (Math.abs(value) >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`
    }
    if (Math.abs(value) >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K`
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  return String(value)
}

export function TopNTable<T extends Record<string, unknown>>({
  title,
  data,
  columns,
  loading,
  error,
  className = '',
  emptyMessage = 'No data available',
  maxRows,
}: TopNTableProps<T>) {
  if (error) {
    return (
      <div className={`rounded-xl border border-border bg-surface shadow-sm p-4 ${className}`}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={`rounded-xl border border-border bg-surface shadow-sm p-4 ${className}`}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-48 items-center justify-center">
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className={`rounded-xl border border-border bg-surface shadow-sm p-4 ${className}`}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-48 items-center justify-center">
          <EmptyState variant="subtle" title={emptyMessage} />
        </div>
      </div>
    )
  }

  const displayData = maxRows && maxRows > 0 ? data.slice(0, maxRows) : data

  return (
    <div className={`rounded-xl border border-border bg-surface shadow-sm p-4 ${className}`}>
      {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
      <div className="overflow-x-auto">
        <Table density="compact" columns={columns.map((column) => column.width ?? 'minmax(0,1fr)')}>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={String(column.key)}
                  align={column.align ?? 'left'}
                  style={column.width ? { width: column.width } : undefined}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayData.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {columns.map((column) => {
                  const rawValue = getNestedValue(row as Record<string, unknown>, String(column.key))
                  const formatted = column.formatter ? column.formatter(rawValue, row) : defaultFormatter(rawValue)
                  return (
                    <TableCell key={String(column.key)} align={column.align ?? 'left'}>
                      {formatted}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export default TopNTable
