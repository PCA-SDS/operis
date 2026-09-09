"use client"

import * as React from 'react'
import { ChevronRight, ChevronDown, X, Check } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
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
type DropdownPosition = {
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
}

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

function collectExpandableIds(items: CascadingItemDef[], ids = new Set<string>()): Set<string> {
  for (const item of items) {
    if (item.children?.length) {
      ids.add(item.id)
      collectExpandableIds(item.children, ids)
    }
  }
  return ids
}

function filterTreeForSearch(items: CascadingItemDef[], query: string): CascadingItemDef[] {
  const q = query.toLowerCase()
  const matches = (item: CascadingItemDef): boolean =>
    item.label.toLowerCase().includes(q) ||
    item.description?.toLowerCase().includes(q) === true

  const visit = (item: CascadingItemDef): CascadingItemDef | null => {
    const children = item.children
      ?.map((child) => visit(child))
      .filter((child): child is CascadingItemDef => child !== null)

    if (matches(item) || (children && children.length > 0)) {
      return {
        ...item,
        children: children && children.length > 0 ? children : undefined,
      }
    }

    return null
  }

  return items
    .map((item) => visit(item))
    .filter((item): item is CascadingItemDef => item !== null)
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
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [search, setSearch] = React.useState('')
  const containerRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLDivElement>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const [dropdownPosition, setDropdownPosition] = React.useState<DropdownPosition>({
    top: 0,
    left: 0,
    width: 280,
    maxHeight: 256,
  })

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

    const searchFiltered = filterTreeForSearch(items, search.trim())
    return buildFlat(searchFiltered, collectExpandableIds(searchFiltered), 0, excludeSet)
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

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) setSearch('')
  }

  const updateDropdownPosition = React.useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger || typeof window === 'undefined') return

    const rect = trigger.getBoundingClientRect()
    const viewportPadding = 12
    const sideOffset = 4
    const preferredMaxHeight = 256
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding - sideOffset
    const spaceAbove = rect.top - viewportPadding - sideOffset
    const openBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove
    const availableHeight = Math.max(140, openBelow ? spaceBelow : spaceAbove)
    const width = Math.max(280, rect.width)
    const left = Math.max(
      viewportPadding,
      Math.min(rect.left, window.innerWidth - width - viewportPadding),
    )

    setDropdownPosition({
      top: openBelow ? rect.bottom + sideOffset : undefined,
      bottom: openBelow ? undefined : window.innerHeight - rect.top + sideOffset,
      left,
      width,
      maxHeight: Math.min(preferredMaxHeight, availableHeight),
    })
  }, [])

  React.useLayoutEffect(() => {
    if (!open) return
    updateDropdownPosition()
    searchInputRef.current?.focus()
  }, [open, updateDropdownPosition])

  React.useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        handleOpenChange(false)
      }
    }
    const handleReposition = () => updateDropdownPosition()

    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [open, updateDropdownPosition])

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
      <div ref={triggerRef} className="relative">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => handleOpenChange(!open)}
          className={cn(
            'h-auto min-h-9 w-full justify-between bg-input-bg py-2 text-left font-normal hover:bg-modal-muted',
            clearable && value && !disabled ? 'pr-16' : 'pr-3',
            open && 'shadow-focus border-input-border-focus bg-modal-muted',
          )}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <span className="min-w-0 flex-1">
            <span className={cn('block truncate', !selectedItem && 'text-muted-foreground')}>
              {selectedItem?.label || placeholder}
            </span>
            {selectedItem?.description ? (
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {selectedItem.description}
              </span>
            ) : null}
          </span>
          <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </Button>
        {clearable && value && !disabled ? (
          <IconButton
            type="button"
            variant="ghost"
            size="xs"
            aria-label={t('catalog.constraints.combobox.clearSelection', 'Clear selection')}
            className="absolute right-8 top-1/2 z-10 -translate-y-1/2"
            onClick={(event) => {
              event.stopPropagation()
              onChange('')
              setExpanded(new Set())
            }}
          >
            <X className="size-3.5" />
          </IconButton>
        ) : null}
      </div>

      {open ? (
        <div
          className="fixed z-popover overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
          style={{
            top: dropdownPosition.top,
            bottom: dropdownPosition.bottom,
            left: dropdownPosition.left,
            width: dropdownPosition.width,
          }}
        >
          {/* Search */}
          {hasItems && (
            <div className="border-b border-border px-3 py-2">
              <SearchInput
                ref={searchInputRef}
                value={search}
                onChange={setSearch}
                onClear={() => setSearch('')}
                placeholder={placeholder}
                clearLabel={t('catalog.constraints.combobox.clearSearch', 'Clear search')}
                tone="plain"
              />
            </div>
          )}

          {/* List */}
          <div className="overflow-y-auto py-1 overscroll-contain" style={{ maxHeight: dropdownPosition.maxHeight }}>
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
                {t('catalog.constraints.combobox.empty', 'No items found')}
              </div>
            ) : (
              <>
                {filteredList.map((item) => {
                  const hasChildren = Boolean(item.children?.length)
                  const isExpanded = expanded.has(item.id)
                  const isSelected = item.id === value
                  const isExcluded = Boolean(item.isExcluded)
                  const indent = item.depth * 16
                  const childCount = item.children?.length ?? 0

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
                        <IconButton
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={(event) => {
                            event.stopPropagation()
                            handleToggle(item)
                          }}
                          aria-label={isExpanded
                            ? t('catalog.constraints.combobox.collapse', 'Collapse')
                            : t('catalog.constraints.combobox.expand', 'Expand')}
                          className="-ml-1 shrink-0 text-muted-foreground"
                        >
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </IconButton>
                      ) : (
                        <span className="w-5 shrink-0" />
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isExcluded}
                        onClick={() => {
                          if (isExcluded) return
                          if (hasChildren && !item.selectable) {
                            handleToggle(item)
                          } else {
                            handleSelect(item, true)
                          }
                        }}
                        className={cn(
                          'h-auto min-w-0 flex-1 justify-start gap-2 px-0 py-1.5 text-left hover:bg-transparent',
                          hasChildren && !item.selectable && 'cursor-default',
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
                              <span className="text-xs text-muted-foreground shrink-0">
                                {t('catalog.constraints.combobox.alreadySelected', 'Already selected')}
                              </span>
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
                            {childCount === 1
                              ? t('catalog.constraints.combobox.childCount.one', '1 item')
                              : t('catalog.constraints.combobox.childCount.many', '{count} items').replace('{count}', String(childCount))}
                          </span>
                        )}
                      </Button>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
