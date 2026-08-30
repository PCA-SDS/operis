"use client"

import * as React from 'react'
import { useState, useCallback, useMemo } from 'react'
import { Plus, Trash2, Lock, Unlock, ArrowRight, Package, ChevronRight, Inbox, Info } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from '@open-mercato/ui/primitives/drawer'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@open-mercato/ui/primitives/tooltip'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CatalogConstraintItem } from '@open-mercato/core/modules/catalog/data/types'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { CascadingCombobox, type CascadingItemDef } from './CascadingCombobox'

export type ConstraintType = CatalogConstraintItem['constraint_type']

export const CONSTRAINT_TYPE_LABELS: Record<ConstraintType, string> = {
  conflicts_with_item: 'Conflicts with',
  requires_item: 'Requires',
  mutually_exclusive_item: 'Mutually exclusive with',
  includes_item: 'Includes',
}

export const CONSTRAINT_TYPE_COLORS: Record<ConstraintType, { variant: 'error' | 'info' | 'success' | 'warning'; dot: boolean }> = {
  conflicts_with_item: { variant: 'error', dot: true },
  requires_item: { variant: 'info', dot: true },
  mutually_exclusive_item: { variant: 'warning', dot: true },
  includes_item: { variant: 'success', dot: true },
}

export type LocalOptionSummary = {
  id: string
  name: string
  groupId: string
  groupName: string
  path: string
  parentOptionId?: string | null
}

type ConstraintDraft = {
  id: string
  constraintType: ConstraintType
  sourceKind: 'product' | 'option'
  sourceId: string
  targetKind: 'product' | 'option'
  targetId: string
  targetProductId: string
  targetProductName?: string
  targetOptionName?: string
  locked: boolean
}

type NewConstraintDraft = {
  constraintType: ConstraintType
  sourceKind: 'product' | 'option'
  sourceId: string
  targetKind: 'product' | 'option'
  targetId: string
  targetProductId: string
  targetProductName?: string
  targetOptionName?: string
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function draftFromItem(item: CatalogConstraintItem): ConstraintDraft {
  return {
    id: item.id,
    constraintType: item.constraint_type,
    sourceKind: item.source_option_id ? 'option' : 'product',
    sourceId: (item.source_option_id ?? item.source_product_id) || '',
    targetKind: item.target_option_id ? 'option' : 'product',
    targetId: (item.target_option_id ?? item.target_product_id) || '',
    targetProductId: (item.target_product_id && item.target_option_id) ? item.target_product_id : '',
    targetProductName: item.target_product_name ?? undefined,
    targetOptionName: item.target_option_name ?? undefined,
    locked: item.locked,
  }
}

function draftToPayload(draft: ConstraintDraft): Omit<CatalogConstraintItem, 'created_at' | 'updated_at'> {
  return {
    id: draft.id,
    constraint_type: draft.constraintType,
    source_product_id: draft.sourceKind === 'product' ? (draft.sourceId || null) : null,
    source_option_id: draft.sourceKind === 'option' ? (draft.sourceId || null) : null,
    target_product_id: draft.targetKind === 'product' ? (draft.targetId || null) : null,
    target_option_id: draft.targetKind === 'option' ? (draft.targetId || null) : null,
    target_product_name: draft.targetProductName ?? null,
    target_option_name: draft.targetOptionName ?? null,
    locked: draft.locked,
  }
}

// ─────────────────────────────────────────────────────────────────
// Build nested tree from flat groups + options
// ─────────────────────────────────────────────────────────────────
type GroupFlat = { id: string; name: string; parent_option_id: string | null }
type OptionFlat = { id: string; name: string; group_id: string }

function buildOptionTree(groups: GroupFlat[], options: OptionFlat[]): CascadingItemDef[] {
  // Group → options
  const groupOptions = new Map<string, OptionFlat[]>()
  for (const o of options) {
    if (!groupOptions.has(o.group_id)) groupOptions.set(o.group_id, [])
    groupOptions.get(o.group_id)!.push(o)
  }

  const rootGroupIds = groups.filter((g) => g.parent_option_id === null).map((g) => g.id)

  function buildNode(groupId: string): CascadingItemDef {
    const group = groups.find((g) => g.id === groupId)!
    const children: CascadingItemDef[] = []

    // Options in this group
    const optsInThisGroup = groupOptions.get(groupId) ?? []
    for (const o of optsInThisGroup) {
      // Find all child groups that belong to this specific option
      const childGroupIds = groups
        .filter((g) => g.parent_option_id === o.id)
        .map((g) => g.id)

      const optionChildren: CascadingItemDef[] = []
      for (const cgId of childGroupIds) {
        optionChildren.push(buildNode(cgId))
      }

      children.push({
        id: o.id,
        label: o.name,
        selectable: true,
        children: optionChildren.length > 0 ? optionChildren : undefined,
      })
    }

    return {
      id: group.id,
      label: group.name,
      selectable: false,
      children: children.length > 0 ? children : undefined,
    }
  }

  return rootGroupIds.map(buildNode)
}

// ─────────────────────────────────────────────────────────────────
// OptionBadge
// ─────────────────────────────────────────────────────────────────
type OptionBadgeProps = {
  id: string
  options: LocalOptionSummary[]
}

function OptionBadge({ id, options }: OptionBadgeProps) {
  const opt = options.find((o) => o.id === id)
  if (!opt) {
    return (
      <Tag variant="brand" shape="square" className="max-w-48">
        <span className="truncate text-xs">{id || '—'}</span>
      </Tag>
    )
  }

  const pathSegments = opt.path.split(' > ')

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Tag variant="brand" shape="square" className="max-w-72 h-auto py-1.5 flex flex-col items-start gap-1 cursor-default">
            <span className="flex flex-wrap items-center text-xs opacity-75 leading-none mt-0.5">
              {pathSegments.map((seg, i) => (
                <React.Fragment key={i}>
                  <span className="truncate max-w-32">{seg}</span>
                  {i < pathSegments.length - 1 && <ChevronRight className="w-2.5 h-2.5 mx-0.5 shrink-0" />}
                </React.Fragment>
              ))}
            </span>
            <span className="truncate font-medium text-sm leading-tight">{opt.name}</span>
          </Tag>
        </TooltipTrigger>
        <TooltipContent>{opt.path}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// ─────────────────────────────────────────────────────────────────
// ConstraintRow
// ─────────────────────────────────────────────────────────────────
type ConstraintRowProps = {
  draft: ConstraintDraft
  localOptions: LocalOptionSummary[]
  productSeedOptions?: CascadingItemDef[]
  productId: string
  productName: string
  onChange: (updated: ConstraintDraft) => void
  onDelete: () => void
}

// ─────────────────────────────────────────────────────────────────
// IncomingConstraintBadge — read-only badge for incoming constraints
// ─────────────────────────────────────────────────────────────────

function IncomingConstraintBadge({ constraint, sourceLabel }: { constraint: CatalogConstraintItem; sourceLabel: string }) {
  const t = useT()
  const color = CONSTRAINT_TYPE_COLORS[constraint.constraint_type]
  const label = CONSTRAINT_TYPE_LABELS[constraint.constraint_type]

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-status-warning-bg/50 bg-status-warning-bg/10">
      <Tag variant={color.variant} dot={color.dot} className="text-xs font-medium shrink-0">
        {label}
      </Tag>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span className="text-xs font-medium text-foreground/80">{sourceLabel}</span>
        <ArrowRight className="w-3 h-3 shrink-0" />
        <span>{t('catalog.constraints.thisProduct', 'this product')}</span>
      </div>
      {constraint.locked && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Lock className="w-3.5 h-3.5 text-status-warning-icon shrink-0" />
            </TooltipTrigger>
            <TooltipContent>
              {t('catalog.constraints.locked', 'Locked by migration')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  )
}

function ConstraintRow({ draft, localOptions, productSeedOptions, productId, productName, onChange, onDelete }: ConstraintRowProps) {
  const t = useT()
  const { confirm } = useConfirmDialog()

  const set = <K extends keyof ConstraintDraft>(key: K, val: ConstraintDraft[K]) =>
    onChange({ ...draft, [key]: val })

  const handleDelete = () => {
    if (draft.locked) return
    confirm({
      title: t('catalog.constraints.delete.title', 'Delete constraint?'),
      text: t('catalog.constraints.delete.description', 'This action cannot be undone.'),
      confirmText: t('common.delete', 'Delete'),
      variant: 'destructive',
    }).then(() => onDelete())
  }

  const color = CONSTRAINT_TYPE_COLORS[draft.constraintType]
  const isExternal = draft.targetKind === 'product' ? true : (draft.targetProductId ? draft.targetProductId !== productId : false)

  return (
    <div className={cn(
      'flex flex-wrap items-center gap-2 p-3 rounded-lg border bg-card transition-colors',
      draft.locked ? 'opacity-75' : 'hover:border-border/80',
    )}>
      <Tag variant={color.variant} dot={color.dot} className="text-xs font-medium shrink-0">
        {CONSTRAINT_TYPE_LABELS[draft.constraintType]}
      </Tag>

      {draft.sourceKind === 'option' ? (
        <OptionBadge id={draft.sourceId} options={localOptions} />
      ) : (
        <Tag variant="neutral" shape="square" className="max-w-40">
          <span className="flex items-center gap-1.5 truncate text-xs">
            <Package className="w-3 h-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{productName}</span>
          </span>
        </Tag>
      )}

      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />

      {draft.targetKind === 'option' ? (
        isExternal ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Tag variant="neutral" shape="square" className="max-w-72 h-auto py-1.5 flex flex-col items-start gap-1 cursor-default">
                  <span className="flex flex-wrap items-center text-xs opacity-75 leading-none mt-0.5">
                    <Package className="w-2.5 h-2.5 mr-1 shrink-0" />
                    <span className="truncate max-w-32">{draft.targetProductName || draft.targetProductId || 'External Product'}</span>
                  </span>
                  {draft.targetOptionName ? (
                    <span className="truncate font-medium text-sm leading-tight">
                      {draft.targetOptionName}
                    </span>
                  ) : (
                    <span className="truncate font-medium text-sm leading-tight">{draft.targetId}</span>
                  )}
                </Tag>
              </TooltipTrigger>
              <TooltipContent>
                {(() => {
                  const parts: string[] = []
                  if (draft.targetProductName || draft.targetProductId) {
                    parts.push(draft.targetProductName || draft.targetProductId || '')
                  }
                  if (draft.targetOptionName) parts.push(draft.targetOptionName)
                  else parts.push(draft.targetId)
                  return parts.join(' > ')
                })()}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <OptionBadge id={draft.targetId} options={localOptions} />
        )
      ) : (
        <Tag variant="neutral" shape="square" className="max-w-40">
          <span className="flex items-center gap-1.5 truncate text-xs">
            <Package className="w-3 h-3 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {productSeedOptions?.find((p) => p.id === draft.targetId)?.label ?? draft.targetProductName ?? draft.targetId}
            </span>
          </span>
        </Tag>
      )}

      <div className="ml-auto flex items-center gap-1 shrink-0">
        {isExternal && (
          <Tag variant="neutral" shape="square" className="text-xs">
            <span className="flex items-center gap-1">
              <Package className="w-2.5 h-2.5" />
              External
            </span>
          </Tag>
        )}
        {draft.targetKind === 'option' && !isExternal && (
          <Tag variant="brand" shape="square" className="text-xs">Option</Tag>
        )}
      </div>

      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => set('locked', !draft.locked)}
        aria-label={draft.locked ? t('catalog.constraints.unlock', 'Unlock') : t('catalog.constraints.lock', 'Lock')}
        className={cn(
          'shrink-0',
          draft.locked && 'text-status-warning-icon hover:text-status-warning-text',
        )}
      >
        {draft.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
      </IconButton>

      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleDelete}
        disabled={draft.locked}
        aria-label={t('common.delete', 'Delete')}
        className="text-destructive hover:text-destructive shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </IconButton>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// AddConstraintDrawer
// ─────────────────────────────────────────────────────────────────
type AddConstraintDrawerProps = {
  open: boolean
  onClose: () => void
  onAdd: (draft: NewConstraintDraft) => void
  localGroups: CascadingItemDef[]
  productSeedOptions: CascadingItemDef[]
  productName: string
  currentProductId: string
}

function AddConstraintDrawer({
  open,
  onClose,
  onAdd,
  localGroups,
  productSeedOptions,
  productName,
  currentProductId,
}: AddConstraintDrawerProps) {
  const t = useT()

  const [sourceMode, setSourceMode] = useState<'product' | 'option'>('product')
  const [sourceId, setSourceId] = useState('__product__')
  const [constraintType, setConstraintType] = useState<ConstraintType>('requires_item')

  type TargetMode = 'local_option' | 'external_product'
  const [targetMode, setTargetMode] = useState<TargetMode>('local_option')
  const [targetId, setTargetId] = useState('')
  const [externalProductId, setExternalProductId] = useState('')
  const [externalTree, setExternalTree] = useState<CascadingItemDef[]>([])
  const [externalProductName, setExternalProductName] = useState('')
  const [loadingExternal, setLoadingExternal] = useState(false)

  // Source tree: [product name] + localGroups
  const sourceTree: CascadingItemDef[] = [
    { 
      id: '__product__', 
      label: productName,
      selectable: true,
      children: localGroups.length > 0 ? localGroups : undefined,
    },
  ]

  const canSubmit = (sourceId.trim().length > 0) && (targetId.trim().length > 0)

  const handleExternalProductSelect = async (productId: string) => {
    if (!productId) {
      setExternalTree([])
      return
    }
    setLoadingExternal(true)
    try {
      const result = await readApiResultOrThrow<{
        productName: string
        groups: { id: string; parent_option_id: string | null; name: string }[]
        options: { id: string; group_id: string; name: string }[]
      }>(`/api/catalog/products/${currentProductId}/external-options?externalProductId=${productId}`)
      const tree = buildOptionTree(result.groups, result.options)
      setExternalTree(tree)
      if (result.productName) setExternalProductName(result.productName)
    } catch {
      setExternalTree([])
    }
    setLoadingExternal(false)
  }

  const handleSubmit = () => {
    if (!canSubmit) return

    let finalTargetKind: 'product' | 'option' = 'option'
    let finalTargetId = targetId.trim()
    let finalTargetProductId = ''
    let finalTargetProductName: string | undefined
    let finalTargetOptionName: string | undefined

    if (targetMode === 'local_option') {
      finalTargetKind = 'option'
      finalTargetProductId = currentProductId
    } else if (targetMode === 'external_product') {
      if (targetId.trim() !== externalProductId.trim()) {
        // User selected an option from the external product
        finalTargetKind = 'option'
        finalTargetProductId = externalProductId.trim()
        finalTargetProductName = externalProductName

        const findPath = (list: CascadingItemDef[], currentPath: string[] = []): string | undefined => {
          for (const item of list) {
            if (item.id === finalTargetId) {
              return currentPath.length > 0 ? `${currentPath.join(' > ')} > ${item.label}` : item.label
            }
            if (item.children) {
              const res = findPath(item.children, [...currentPath, item.label])
              if (res) return res
            }
          }
          return undefined
        }
        finalTargetOptionName = findPath(externalTree)
      } else {
        // User only selected the external product itself
        finalTargetKind = 'product'
        finalTargetId = externalProductId.trim()
        finalTargetProductId = ''
        finalTargetProductName = externalProductName
      }
    }

    onAdd({
      constraintType,
      sourceKind: sourceMode,
      sourceId: sourceId === '__product__' ? currentProductId : sourceId.trim(),
      targetKind: finalTargetKind,
      targetId: finalTargetId,
      targetProductId: finalTargetProductId,
      targetProductName: finalTargetProductName,
      targetOptionName: finalTargetOptionName,
    })
    resetForm()
    onClose()
  }

  const resetForm = () => {
    setSourceMode('product')
    setSourceId('__product__')
    setConstraintType('requires_item')
    setTargetMode('local_option')
    setTargetId('')
    setExternalProductId('')
    setExternalTree([])
    setExternalProductName('')
  }

  const handleClose = () => { resetForm(); onClose() }

  const handleTargetModeChange = (v: TargetMode) => {
    setTargetMode(v)
    setTargetId('')
    if (v === 'external_product') {
      setExternalProductId('')
      setExternalTree([])
      setExternalProductName('')
    }
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && handleClose()}>
      <DrawerContent className="sm:max-w-md">
        <DrawerHeader>
          <DrawerTitle>{t('catalog.constraints.addConstraint', 'Add Constraint')}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="flex flex-col gap-6">

          {/* Source */}
          <div className="flex flex-col gap-2">
            <div>
              <label className="text-sm font-medium text-foreground">
                {t('catalog.constraints.source.label', 'Source')}
              </label>
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                {t('catalog.constraints.source.hint', 'What is constrained?')}
              </p>
            </div>

            <CascadingCombobox
              value={sourceId}
              onChange={(id) => {
                setSourceId(id)
                setSourceMode(id === '__product__' ? 'product' : 'option')
              }}
              items={sourceTree}
              placeholder={t('catalog.constraints.selectSource', 'Select source...')}
              clearable={false}
            />
          </div>

          {/* Relationship */}
          <div className="flex flex-col gap-2 mt-2">
            <label className="text-sm font-medium text-foreground">
              {t('catalog.constraints.relationship', 'Relationship')}
            </label>
            <Select value={constraintType} onValueChange={(v) => setConstraintType(v as ConstraintType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(CONSTRAINT_TYPE_LABELS) as [ConstraintType, string][]).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Target — 2 tabs */}
          <div className="flex flex-col gap-2 mt-2">
            <div>
              <label className="text-sm font-medium text-foreground">
                {t('catalog.constraints.target.label', 'Target')}
              </label>
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                {t('catalog.constraints.target.hint', 'What is the source constrained with?')}
              </p>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-muted/10 p-3 mt-1">
              <SegmentedControl
                value={targetMode}
                onValueChange={(v) => handleTargetModeChange(v as TargetMode)}
              >
              <SegmentedControlItem value="local_option">
                {t('catalog.constraints.target.localOption', "This product's option")}
              </SegmentedControlItem>
              <SegmentedControlItem value="external_product">
                {t('catalog.constraints.target.externalProduct', 'Other product')}
              </SegmentedControlItem>
            </SegmentedControl>

            {targetMode === 'local_option' && (
              <CascadingCombobox
                value={targetId}
                onChange={setTargetId}
                items={localGroups}
                placeholder={t('catalog.constraints.selectOption', 'Select an option...')}
                clearable
                excludeIds={sourceMode === 'option' && sourceId ? [sourceId] : []}
              />
            )}

            {targetMode === 'external_product' && (
              <CascadingCombobox
                value={targetId}
                onChange={(id) => {
                  if (id === '') {
                    setExternalProductId('')
                    setTargetId('')
                    setExternalTree([])
                  } else if (!externalProductId) {
                    setExternalProductId(id)
                    setTargetId(id)
                    const name = productSeedOptions.find(p => p.id === id)?.label || id
                    setExternalProductName(name)
                    handleExternalProductSelect(id)
                  } else {
                    setTargetId(id)
                  }
                }}
                items={
                  !externalProductId
                    ? productSeedOptions.map(p => ({ ...p, keepOpenOnSelect: true }))
                    : [
                        {
                          id: externalProductId,
                          label: externalProductName || externalProductId,
                          selectable: true,
                          children: loadingExternal
                            ? [{ id: '__loading__', label: t('common.loading', 'Loading options...'), selectable: false }]
                            : (externalTree.length > 0 ? externalTree : undefined),
                        },
                      ]
                }
                placeholder={t('catalog.constraints.selectOtherProduct', 'Select a product...')}
                loading={loadingExternal}
                clearable
              />
            )}
            </div>
          </div>

        </DrawerBody>
        <DrawerFooter className="flex-row items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <KbdShortcut keys={['⌘', '↵']} />
            <span>{t('catalog.constraints.shortcut.toSave', 'to save')}</span>
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              {t('ui.actions.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
              {t('catalog.constraints.addConstraint', 'Add Constraint')}
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

// ─────────────────────────────────────────────────────────────────
// ConstraintsEditor — public component
// ─────────────────────────────────────────────────────────────────
export type ConstraintsEditorProps = {
  constraints: CatalogConstraintItem[]
  incomingConstraints?: CatalogConstraintItem[]
  productId: string
  productName?: string
  options?: LocalOptionSummary[]
  /** Products for "Other product" target picker — each product is a root item */
  productSeedOptions?: CascadingItemDef[]
  onChange: (constraints: ReturnType<typeof draftToPayload>[]) => void
  headerActions?: React.ReactNode
}

export function ConstraintsEditor({
  constraints,
  incomingConstraints = [],
  productId,
  productName = 'This product',
  options = [],
  productSeedOptions = [],
  onChange,
  headerActions,
}: ConstraintsEditorProps) {
  const t = useT()
  const [showAddDrawer, setShowAddDrawer] = useState(false)

  const [drafts, setDrafts] = useState<ConstraintDraft[]>(() => constraints.map(draftFromItem))
  const onChangeRef = React.useRef(onChange)
  onChangeRef.current = onChange

  // Build local cascading tree from flat options
  const localGroups = useMemo((): CascadingItemDef[] => {
    const groupMap = new Map<string, { name: string; parent_option_id: string | null }>()
    for (const opt of options) {
      if (!groupMap.has(opt.groupId)) {
        groupMap.set(opt.groupId, { name: opt.groupName, parent_option_id: opt.parentOptionId ?? null })
      }
    }

    const groupOptions = new Map<string, { id: string; name: string }[]>()
    for (const opt of options) {
      if (!groupOptions.has(opt.groupId)) groupOptions.set(opt.groupId, [])
      groupOptions.get(opt.groupId)!.push({ id: opt.id, name: opt.name })
    }

    const rootGroupIds = [...groupMap.entries()]
      .filter(([, g]) => g.parent_option_id === null)
      .map(([id]) => id)

    function buildNode(groupId: string): CascadingItemDef {
      const group = groupMap.get(groupId)!
      const children: CascadingItemDef[] = []

      const optsInThisGroup = groupOptions.get(groupId) ?? []
      for (const o of optsInThisGroup) {
        // Child groups belonging to this option
        const childGroupIds = [...groupMap.entries()]
          .filter(([, g]) => g.parent_option_id === o.id)
          .map(([id]) => id)

        const optionChildren: CascadingItemDef[] = []
        for (const cgId of childGroupIds) {
          optionChildren.push(buildNode(cgId))
        }

        children.push({
          id: o.id,
          label: o.name,
          selectable: true,
          children: optionChildren.length > 0 ? optionChildren : undefined
        })
      }

      return { 
        id: groupId, 
        label: group.name, 
        selectable: false,
        children: children.length > 0 ? children : undefined 
      }
    }

    return rootGroupIds.map(buildNode)
  }, [options])

  const draftsRef = React.useRef(drafts)
  draftsRef.current = drafts

  const sync = useCallback((next: ConstraintDraft[]) => {
    onChangeRef.current(next.map(draftToPayload))
  }, [])

  const updateDraft = useCallback((id: string, updated: ConstraintDraft) => {
    const next = draftsRef.current.map((d) => (d.id === id ? updated : d))
    setDrafts(next)
    sync(next)
  }, [sync])

  const deleteDraft = useCallback((id: string) => {
    const next = draftsRef.current.filter((d) => d.id !== id)
    setDrafts(next)
    sync(next)
  }, [sync])

  const handleAdd = useCallback((draft: NewConstraintDraft) => {
    const newDraft: ConstraintDraft = { id: crypto.randomUUID(), ...draft, locked: false }
    const next = [...draftsRef.current, newDraft]
    setDrafts(next)
    sync(next)
  }, [sync])

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between shrink-0">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-foreground">
            {t('catalog.constraints.heading', 'Constraints')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t('catalog.constraints.description', 'Define what this product or its options require, conflict with, or include.')}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {headerActions}
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setShowAddDrawer(true)}>
            <Plus className="w-3.5 h-3.5" />
            {t('catalog.constraints.addConstraint', 'Add Constraint')}
          </Button>
        </div>
      </div>

      {/* Outgoing Constraints (editable) */}
      {drafts.length > 0 ? (
        <div className="flex flex-col gap-2">
          {drafts.map((draft) => (
            <ConstraintRow
              key={draft.id}
              draft={draft}
              localOptions={options}
              productSeedOptions={productSeedOptions}
              productId={productId}
              productName={productName}
              onChange={(updated) => updateDraft(draft.id, updated)}
              onDelete={() => deleteDraft(draft.id)}
            />
          ))}
        </div>
      ) : (
        <ListEmptyState
          icon={<Inbox className="size-7" />}
          title={t('catalog.constraints.empty', 'No constraints defined')}
          description={t('catalog.constraints.emptyHint', 'Add a constraint to define what this product or its options require or conflict with.')}
          onCreate={() => setShowAddDrawer(true)}
          createLabel={t('catalog.constraints.addConstraint', 'Add Constraint')}
        />
      )}

      {/* Incoming Constraints (read-only) */}
      {incomingConstraints && incomingConstraints.length > 0 && (
        <div className="flex flex-col gap-3 pt-4 border-t mt-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-status-warning-bg" />
              <span className="text-sm font-medium text-foreground">
                {t('catalog.constraints.incoming', 'Required by')}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              ({incomingConstraints.length})
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {incomingConstraints.map((c) => {
              const sourceLabel = c.source_product_name || c.source_option_name || 'Unknown'
              const sourceBadge = c.source_option_name
                ? `${c.source_product_name || ''} › ${c.source_option_name}`.trim()
                : sourceLabel
              return (
                <IncomingConstraintBadge key={c.id} constraint={c} sourceLabel={sourceBadge} />
              )
            })}
          </div>
        </div>
      )}

      <AddConstraintDrawer
        open={showAddDrawer}
        onClose={() => setShowAddDrawer(false)}
        onAdd={handleAdd}
        localGroups={localGroups}
        productSeedOptions={productSeedOptions}
        productName={productName}
        currentProductId={productId}
      />
    </div>
  )
}

export { draftToPayload }
