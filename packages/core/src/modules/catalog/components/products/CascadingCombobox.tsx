"use client"

import * as React from 'react'
import { ChevronRight, ChevronDown, Search, X, Check } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type TreeItem = {
  id: string
  label: string
  description?: string | null
  children?: TreeItem[]
}

export type CascadingItemDef = {
  id: string
  label: string
  description?: string | null
  children?: CascadingItemDef[]
  selectable?: boolean
  keepOpenOnSelect?: boolean
}

export type CascadingComboboxProps = {
  value: string
  onChange: (itemId: string) => void
  /** Flat list — nested via children */
  items: CascadingItemDef[]
  placeholder?: string
  disabled?: boolean
  clearable?: boolean
  className?: string
  /** IDs to exclude from selection (e.g., already selected source option) */
  excludeIds?: string[]
  /** Show loading skeleton in dropdown */
  loading?: boolean
}

type FlatItem = (CascadingItemDef & { depth: number; isExcluded?: boolean })

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function buildFlat(
  items: CascadingItemDef[],
  expanded: Set<string>,
  depth = 0,
  excludeSet?: Set<string>,
): FlatItem[] {
  const result: FlatItem[] = []
  for (const item of items) {
    const isExcluded = excludeSet?.has(item.id) ?? false
    result.push({ ...item, depth, isExcluded })
    if (expanded.has(item.id) && item.children?.length) {
      result.push(...buildFlat(item.children, expanded, depth + 1, excludeSet))
    }
  }
  return result
}

// ─────────────────────────────────────────────────────────────────
// CascadingCombobox
// ─────────────────────────────────────────────────────────────────
export function CascadingCombobox({
  value,
  onChange,
  items,
  placeholder = 'Search or select...',
  disabled,
  clearable,
  className,
  excludeIds = [],
  loading = false,
}: CascadingComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [search, setSearch] = React.useState('')
  const containerRef = React.useRef<HTMLDivElement>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  // Selected label
  const selectedItem = React.useMemo(() => {
    const find = (list: CascadingItemDef[]): CascadingItemDef | undefined => {
      for (const item of list) {
        if (item.id === value) return item
        if (item.children) {
          const found = find(item.children)
          if (found) return found
        }
      }
      return undefined
    }
    return find(items)
  }, [items, value])

  // Flat list
  const flatList = React.useMemo(() => buildFlat(items, expanded), [items, expanded])

  // Filter — uses same expanded state as flatList
  const filteredList = React.useMemo(() => {
    const excludeSet = new Set(excludeIds)

    if (!search.trim()) return buildFlat(items, expanded, 0, excludeSet)

    const q = search.toLowerCase()
    const match = (item: CascadingItemDef): boolean =>
      item.label.toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q) ||
      (item.children?.some(match) ?? false)

    const searchFiltered = items.reduce<CascadingItemDef[]>((acc, item) => {
      if (!match(item)) return acc
      const filtered: CascadingItemDef = { ...item }
      if (item.children) {
        const childFiltered = item.children.reduce<CascadingItemDef[]>((a, c) => {
          if (match(c)) a.push(c)
          return a
        }, [])
        if (childFiltered.length) filtered.children = childFiltered
        else delete filtered.children
      }
      acc.push(filtered)
      return acc
    }, [])

    return buildFlat(searchFiltered, expanded, 0, excludeSet)
  }, [search, items, expanded, excludeIds])

  const handleToggle = (item: CascadingItemDef) => {
    if (!item.children?.length) return
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
  }

  const handleSelect = (item: CascadingItemDef, forceSelect = false) => {
    if (item.children?.length && !forceSelect && !item.selectable) {
      handleToggle(item)
    } else {
      onChange(item.id)
      if (!item.keepOpenOnSelect) {
        setOpen(false)
        setSearch('')
      }
    }
  }

  // Close on outside click
  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  React.useEffect(() => {
    if (open) searchInputRef.current?.focus()
  }, [open])

  // Auto-expand path to selected value; also expand all groups on open
  React.useEffect(() => {
    if (!value) {
      const groupIds = items.filter((i) => i.children?.length).map((i) => i.id)
      setExpanded(new Set(groupIds))
      return
    }
    const collectParents = (list: CascadingItemDef[], path: string[] = []): string[] | null => {
      for (const item of list) {
        if (item.id === value) return path
        if (item.children) {
          const found = collectParents(item.children, [...path, item.id])
          if (found) return found
        }
      }
      return null
    }
    const parents = collectParents(items)
    if (parents?.length) {
      setExpanded((prev) => {
        const next = new Set(prev)
        for (const id of parents) next.add(id)
        return next
      })
    }
  }, [value, items])

  const hasItems = items.length > 0

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm text-left',
          'hover:bg-muted/50 transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          open && 'ring-2 ring-ring ring-offset-1 outline-none',
        )}
      >
        <span className={cn('truncate flex-1', !selectedItem && 'text-muted-foreground')}>
          {selectedItem?.label || placeholder}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {clearable && value && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); onChange(''); setExpanded(new Set()) }}
              className="p-0.5 rounded hover:bg-muted"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </span>
          )}
          <svg className={cn('w-4 h-4 text-muted-foreground transition-transform', open && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
          {/* Search */}
          {hasItems && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
              <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={placeholder}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {search && (
                <span role="button" tabIndex={-1} onClick={() => setSearch('')} className="p-0.5 rounded hover:bg-muted">
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </span>
              )}
            </div>
          )}

          {/* List */}
          <div className="max-h-64 overflow-y-auto py-1">
            {loading ? (
              <div className="px-3 py-3 space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4 shrink-0" />
                    <Skeleton className="h-4 flex-1" />
                  </div>
                ))}
              </div>
            ) : filteredList.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No items found
              </div>
            ) : (
              <>

            {filteredList.map((item) => {
              const hasChildren = Boolean(item.children?.length)
              const isExpanded = expanded.has(item.id)
              const isSelected = item.id === value
              const isExcluded = Boolean(item.isExcluded)
              const indent = item.depth * 16

              return (
                <div
                  key={item.id}
                  className={cn(
                    'flex w-full items-center gap-1.5 text-sm text-left transition-colors rounded-sm',
                    isExcluded ? 'opacity-40' : 'hover:bg-muted/40',
                  )}
                  style={{ paddingLeft: `${12 + indent}px`, paddingRight: '12px', paddingTop: '2px', paddingBottom: '2px' }}
                >
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleToggle(item); }}
                      className="p-1 -ml-1 rounded hover:bg-background shrink-0 text-muted-foreground cursor-pointer"
                    >
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  ) : (
                    <span className="w-5 shrink-0" />
                  )}

                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      if (isExcluded) return;
                      if (hasChildren && !item.selectable) {
                        handleToggle(item);
                      } else {
                        handleSelect(item, true);
                      }
                    }}
                    className={cn(
                      'flex-1 min-w-0 flex items-center gap-2 py-1.5',
                      (!hasChildren || item.selectable) && !isExcluded ? 'cursor-pointer' : 'cursor-default'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'truncate',
                          isSelected ? 'font-medium text-foreground' : 'text-foreground',
                          isExcluded && 'line-through',
                        )}>
                          {item.label}
                        </span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                        {isExcluded && !isSelected && (
                          <span className="text-xs text-muted-foreground shrink-0">Already selected</span>
                        )}
                      </div>
                      {item.description && (
                        <div className="text-xs text-muted-foreground truncate">
                          {item.description}
                        </div>
                      )}
                    </div>
                    {hasChildren && !isExpanded && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {item.children!.length} item{item.children!.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
