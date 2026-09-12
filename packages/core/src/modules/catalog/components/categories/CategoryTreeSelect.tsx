"use client"

import * as React from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'

const logger = createLogger('catalog').child({ component: 'CategoryTreeSelect' })

export type CategoryTreeSelectNode = {
  id: string
  name: string
  parentId?: string | null
  depth?: number
  pathLabel?: string | null
  childIds?: string[]
  descendantIds?: string[]
  children?: CategoryTreeSelectNode[]
}

type CategoryTreeResponse = {
  items?: CategoryTreeSelectNode[]
}

type CategoryTreeSelectProps = {
  id?: string
  value?: string | null
  onChange: (value: string | null) => void
  disabled?: boolean
  excludeSubtreeOf?: string | null
  emptyLabel?: string
  loadingErrorLabel?: string
  className?: string
}

function collectExcludedIds(nodes: CategoryTreeSelectNode[], excludeId?: string | null): Set<string> {
  const excluded = new Set<string>()
  if (!excludeId) return excluded
  const visit = (node: CategoryTreeSelectNode): boolean => {
    const isExcludedRoot = node.id === excludeId
    if (isExcludedRoot) {
      excluded.add(node.id)
      for (const descendantId of node.descendantIds ?? []) {
        if (typeof descendantId === 'string' && descendantId.length) excluded.add(descendantId)
      }
    }
    for (const child of node.children ?? []) {
      if (isExcludedRoot) excluded.add(child.id)
      visit(child)
    }
    return isExcludedRoot
  }
  for (const node of nodes) visit(node)
  return excluded
}

function flattenVisibleNodes(
  nodes: CategoryTreeSelectNode[],
  expandedIds: Set<string>,
  excludedIds: Set<string>,
): CategoryTreeSelectNode[] {
  const output: CategoryTreeSelectNode[] = []
  const append = (entries: CategoryTreeSelectNode[]) => {
    for (const entry of entries) {
      if (excludedIds.has(entry.id)) continue
      output.push(entry)
      if (expandedIds.has(entry.id)) append(entry.children ?? [])
    }
  }
  append(nodes)
  return output
}

function findNode(nodes: CategoryTreeSelectNode[], id: string | null): CategoryTreeSelectNode | null {
  if (!id) return null
  for (const node of nodes) {
    if (node.id === id) return node
    const child = findNode(node.children ?? [], id)
    if (child) return child
  }
  return null
}

function collectAncestorIds(nodes: CategoryTreeSelectNode[], id: string | null): string[] {
  if (!id) return []
  const visit = (entries: CategoryTreeSelectNode[], path: string[]): string[] | null => {
    for (const entry of entries) {
      if (entry.id === id) return path
      const found = visit(entry.children ?? [], [...path, entry.id])
      if (found) return found
    }
    return null
  }
  return visit(nodes, []) ?? []
}

export function CategoryTreeSelect({
  id,
  value,
  onChange,
  disabled,
  excludeSubtreeOf,
  emptyLabel,
  loadingErrorLabel,
  className,
}: CategoryTreeSelectProps) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const selectedValue = typeof value === 'string' && value.length > 0 ? value : null
  const noSelectionLabel = emptyLabel ?? t('catalog.categories.select.empty', 'Root level')
  const errorLabel = loadingErrorLabel ?? t('catalog.categories.select.error', 'Failed to load categories')
  const [nodes, setNodes] = React.useState<CategoryTreeSelectNode[]>([])
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set())
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function loadCategories() {
      setLoading(true)
      try {
        const params = new URLSearchParams({ view: 'tree', status: 'all' })
        const payload = await readApiResultOrThrow<CategoryTreeResponse>(
          `/api/catalog/categories?${params.toString()}`,
          { signal: controller.signal },
          { errorMessage: errorLabel, allowNullResult: true },
        )
        if (cancelled) return
        const nextNodes = Array.isArray(payload?.items) ? payload.items : []
        setNodes(nextNodes)
        setExpandedIds(new Set(collectAncestorIds(nextNodes, selectedValue)))
      } catch (err) {
        if (cancelled) return
        logger.error('Failed to load category tree options', { err })
        setNodes([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadCategories()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [errorLabel, scopeVersion, selectedValue])

  const excludedIds = React.useMemo(() => collectExcludedIds(nodes, excludeSubtreeOf), [excludeSubtreeOf, nodes])
  const rows = React.useMemo(() => flattenVisibleNodes(nodes, expandedIds, excludedIds), [expandedIds, excludedIds, nodes])
  const selected = findNode(nodes, selectedValue)
  const selectedLabel = selected ? selected.pathLabel ?? selected.name : noSelectionLabel

  const toggleExpanded = React.useCallback((category: CategoryTreeSelectNode) => {
    if (!category.children?.length) return
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(category.id)) next.delete(category.id)
      else next.add(category.id)
      return next
    })
  }, [])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className={cn('w-full justify-between', className)}
          disabled={disabled || loading}
        >
          <span className="truncate">{loading ? t('catalog.categories.select.loading', 'Loading categories…') : selectedLabel}</span>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <ChevronDown className="size-4" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-1">
        <div className="max-h-80 overflow-auto">
          <Button
            type="button"
            variant="ghost"
            role="option"
            aria-selected={!selectedValue}
            className={cn('w-full justify-start', !selectedValue && 'bg-surface-strong text-foreground')}
            onClick={() => onChange(null)}
          >
            <span>{noSelectionLabel}</span>
          </Button>
          {rows.map((category) => {
            const hasChildren = Boolean(category.children?.length)
            const expanded = expandedIds.has(category.id)
            const isSelected = selectedValue === category.id
            return (
              <div
                key={category.id}
                className="flex items-center gap-1"
                style={{ paddingLeft: `${Math.max(category.depth ?? 0, 0) * 16}px` }}
              >
                {hasChildren ? (
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="size-5"
                    aria-label={expanded
                      ? t('catalog.categories.actions.collapse', 'Collapse category')
                      : t('catalog.categories.actions.expand', 'Expand category')}
                    onClick={() => toggleExpanded(category)}
                  >
                    {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  </IconButton>
                ) : (
                  <span className="size-5 shrink-0" aria-hidden="true" />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-selected={isSelected}
                  className={cn('min-w-0 flex-1 justify-start', isSelected && 'bg-surface-strong text-foreground')}
                  onClick={() => onChange(category.id)}
                >
                  <span className="truncate">{category.name}</span>
                </Button>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
