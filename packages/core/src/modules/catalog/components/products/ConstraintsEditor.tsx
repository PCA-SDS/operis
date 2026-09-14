"use client"

import * as React from 'react'
import { useState, useCallback, useMemo } from 'react'
import { Plus, Trash2, Lock, ArrowRight, Package, Inbox } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { Radio, RadioGroup } from '@open-mercato/ui/primitives/radio'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from '@open-mercato/ui/primitives/drawer'
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
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

const CONSTRAINT_TYPE_LABEL_KEYS: Record<ConstraintType, string> = {
  conflicts_with_item: 'catalog.constraints.types.conflictsWith',
  requires_item: 'catalog.constraints.types.requires',
  mutually_exclusive_item: 'catalog.constraints.types.mutuallyExclusive',
  includes_item: 'catalog.constraints.types.includes',
}

const CONSTRAINT_TYPE_DESCRIPTION_KEYS: Record<ConstraintType, { key: string; fallback: string }> = {
  conflicts_with_item: {
    key: 'catalog.constraints.types.conflictsWith.description',
    fallback: 'Source cannot be selected together with target.',
  },
  requires_item: {
    key: 'catalog.constraints.types.requires.description',
    fallback: 'Selecting source also requires target.',
  },
  mutually_exclusive_item: {
    key: 'catalog.constraints.types.mutuallyExclusive.description',
    fallback: 'Only one side of this relationship can be selected.',
  },
  includes_item: {
    key: 'catalog.constraints.types.includes.description',
    fallback: 'Selecting source includes target automatically.',
  },
}

function getConstraintTypeLabel(
  type: ConstraintType,
  t: (key: string, fallback?: string) => string,
): string {
  return t(CONSTRAINT_TYPE_LABEL_KEYS[type], CONSTRAINT_TYPE_LABELS[type])
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
    targetOptionName: item.target_option_path ?? item.target_option_name ?? undefined,
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

function buildOptionTree(groups: GroupFlat[], options: OptionFlat[], productName?: string): CascadingItemDef[] {
  // Group → options
  const groupOptions = new Map<string, OptionFlat[]>()
  for (const o of options) {
    if (!groupOptions.has(o.group_id)) groupOptions.set(o.group_id, [])
    groupOptions.get(o.group_id)!.push(o)
  }

  const rootGroupIds = groups.filter((g) => g.parent_option_id === null).map((g) => g.id)

  function buildNode(groupId: string, parentPath: string[] = []): CascadingItemDef {
    const group = groups.find((g) => g.id === groupId)!
    const groupPath = [...parentPath, group.name]
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
        optionChildren.push(buildNode(cgId, [...groupPath, o.name]))
      }

      children.push({
        id: o.id,
        label: o.name,
        description: productName ? [productName, ...groupPath].join(' > ') : groupPath.join(' > '),
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

  return rootGroupIds.map((groupId) => buildNode(groupId))
}

function findItemLabel(items: CascadingItemDef[], id: string): string | undefined {
  for (const item of items) {
    if (item.id === id) return item.label
    if (item.children) {
      const child = findItemLabel(item.children, id)
      if (child) return child
    }
  }
  return undefined
}

function findItemDisplayLabel(items: CascadingItemDef[], id: string): string | undefined {
  for (const item of items) {
    if (item.id === id) return item.description ? `${item.label} (${item.description})` : item.label
    if (item.children) {
      const child = findItemDisplayLabel(item.children, id)
      if (child) return child
    }
  }
  return undefined
}

function findItemPath(items: CascadingItemDef[], id: string, currentPath: string[] = []): string | undefined {
  for (const item of items) {
    const nextPath = [...currentPath, item.label]
    if (item.id === id) return nextPath.join(' > ')
    if (item.children) {
      const child = findItemPath(item.children, id, nextPath)
      if (child) return child
    }
  }
  return undefined
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
      <Tag variant="brand" shape="square" className="w-full max-w-full sm:w-auto sm:max-w-48">
        <span className="truncate text-xs">{id || '—'}</span>
      </Tag>
    )
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Tag variant="brand" shape="square" className="w-full max-w-full cursor-default sm:w-auto sm:max-w-64">
            <span className="truncate text-xs font-medium">{opt.path}</span>
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
  onDelete: () => void
}

// ─────────────────────────────────────────────────────────────────
// IncomingConstraintBadge — read-only badge for incoming constraints
// ─────────────────────────────────────────────────────────────────

function IncomingConstraintBadge({ constraint }: { constraint: CatalogConstraintItem }) {
  const t = useT()
  const color = CONSTRAINT_TYPE_COLORS[constraint.constraint_type]
  const label = getConstraintTypeLabel(constraint.constraint_type, t)
  const sourceLabel =
    constraint.source_option_path ??
    constraint.source_product_name ??
    constraint.source_option_name ??
    t('catalog.constraints.unknownSource', 'Unknown source')

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 transition-colors sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Tag variant={color.variant} dot={color.dot} className="self-start text-xs font-medium shrink-0 sm:self-auto">
          {label}
        </Tag>

        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <Tag variant="neutral" shape="square" className="w-full max-w-full sm:w-auto sm:max-w-72">
            <span className="flex items-center gap-1.5 truncate text-xs">
              <Package className="w-3 h-3 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{sourceLabel}</span>
            </span>
          </Tag>

          <ArrowRight className="ml-1 w-3.5 h-3.5 rotate-90 text-muted-foreground shrink-0 sm:ml-0 sm:rotate-0" />

          <Tag variant="neutral" shape="square" className="w-full max-w-full sm:w-auto sm:max-w-40">
            <span className="flex items-center gap-1.5 truncate text-xs">
              <Package className="w-3 h-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{t('catalog.constraints.thisProduct', 'This product')}</span>
            </span>
          </Tag>
        </div>
      </div>

      <div className="flex items-center justify-end gap-1 shrink-0 sm:ml-auto">
        <Tag variant="neutral" shape="square" className="text-xs">
          <span className="flex items-center gap-1">
            <Inbox className="w-2.5 h-2.5" />
            {t('catalog.constraints.incomingBadge', 'Incoming')}
          </span>
        </Tag>

        {constraint.locked && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled
                  aria-label={t('catalog.constraints.locked', 'Locked by migration')}
                  className="shrink-0 text-status-warning-icon"
                >
                  <Lock className="w-3.5 h-3.5" />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent>
                {t('catalog.constraints.locked', 'Locked by migration')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  )
}

function ConstraintRow({ draft, localOptions, productSeedOptions, productId, productName, onDelete }: ConstraintRowProps) {
  const t = useT()
  const { confirm } = useConfirmDialog()

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
      'flex flex-col gap-2 rounded-lg border bg-card p-3 transition-colors sm:flex-row sm:flex-wrap sm:items-center',
      draft.locked ? 'opacity-75' : 'hover:border-border/80',
    )}>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Tag variant={color.variant} dot={color.dot} className="self-start text-xs font-medium shrink-0 sm:self-auto">
          {getConstraintTypeLabel(draft.constraintType, t)}
        </Tag>

        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          {draft.sourceKind === 'option' ? (
            <OptionBadge id={draft.sourceId} options={localOptions} />
          ) : (
            <Tag variant="neutral" shape="square" className="w-full max-w-full sm:w-auto sm:max-w-40">
              <span className="flex items-center gap-1.5 truncate text-xs">
                <Package className="w-3 h-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{productName}</span>
              </span>
            </Tag>
          )}

          <ArrowRight className="ml-1 w-3.5 h-3.5 rotate-90 text-muted-foreground shrink-0 sm:ml-0 sm:rotate-0" />

          {draft.targetKind === 'option' ? (
            isExternal ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Tag variant="neutral" shape="square" className="w-full max-w-full sm:w-auto sm:max-w-72">
                      <span className="flex items-center gap-1.5 truncate text-xs">
                        <Package className="w-3 h-3 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">
                          {draft.targetOptionName || draft.targetId}
                        </span>
                      </span>
                    </Tag>
                  </TooltipTrigger>
                  <TooltipContent>
                    {draft.targetOptionName || draft.targetId}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <OptionBadge id={draft.targetId} options={localOptions} />
            )
          ) : (
            <Tag variant="neutral" shape="square" className="w-full max-w-full sm:w-auto sm:max-w-40">
              <span className="flex items-center gap-1.5 truncate text-xs">
                <Package className="w-3 h-3 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {productSeedOptions?.find((p) => p.id === draft.targetId)?.label ?? draft.targetProductName ?? draft.targetId}
                </span>
              </span>
            </Tag>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-1 shrink-0 sm:ml-auto">
        {isExternal && (
          <Tag variant="neutral" shape="square" className="text-xs">
            <span className="flex items-center gap-1">
              <Package className="w-2.5 h-2.5" />
              {t('catalog.constraints.external', 'External')}
            </span>
          </Tag>
        )}
        {draft.targetKind === 'option' && !isExternal && (
          <Tag variant="brand" shape="square" className="text-xs">
            {t('catalog.constraints.option', 'Option')}
          </Tag>
        )}

        {draft.locked ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled
                  aria-label={t('catalog.constraints.locked', 'Locked by migration')}
                  className="shrink-0 text-status-warning-icon"
                >
                  <Lock className="w-3.5 h-3.5" />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent>{t('catalog.constraints.locked', 'Locked by migration')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}

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
  const [constraintType, setConstraintType] = useState<ConstraintType>('conflicts_with_item')

  type TargetMode = 'local_option' | 'external_product' | 'external_option'
  const [targetMode, setTargetMode] = useState<TargetMode>('local_option')
  const [targetId, setTargetId] = useState('')
  const [externalProductId, setExternalProductId] = useState('')
  const [externalTree, setExternalTree] = useState<CascadingItemDef[]>([])
  const [externalProductName, setExternalProductName] = useState('')
  const [loadingExternal, setLoadingExternal] = useState(false)

  // Source tree: [product name] + localGroups
  const sourceTree = useMemo<CascadingItemDef[]>(
    () => [
      {
        id: '__product__',
        label: productName,
        selectable: true,
        children: localGroups.length > 0 ? localGroups : undefined,
      },
    ],
    [localGroups, productName],
  )

  const selectedSourceLabel = useMemo(
    () => findItemDisplayLabel(sourceTree, sourceId) ?? productName,
    [sourceId, sourceTree, productName],
  )
  const selectedTargetLabel = useMemo(() => {
    if (targetMode === 'local_option') return findItemDisplayLabel(localGroups, targetId)
    if (targetMode === 'external_product') return externalProductName || findItemLabel(productSeedOptions, externalProductId)
    return findItemDisplayLabel(externalTree, targetId)
  }, [externalProductId, externalProductName, externalTree, localGroups, productSeedOptions, targetId, targetMode])

  const canSubmit =
    sourceId.trim().length > 0 &&
    (targetMode === 'external_product'
      ? externalProductId.trim().length > 0
      : targetId.trim().length > 0)

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
      const tree = buildOptionTree(result.groups, result.options, result.productName)
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
      finalTargetKind = 'product'
      finalTargetId = externalProductId.trim()
      finalTargetProductId = ''
      finalTargetProductName = externalProductName || findItemLabel(productSeedOptions, externalProductId)
    } else if (targetMode === 'external_option') {
      finalTargetKind = 'option'
      finalTargetProductId = externalProductId.trim()
      finalTargetProductName = externalProductName || findItemLabel(productSeedOptions, externalProductId)
      finalTargetOptionName = findItemPath(externalTree, finalTargetId)
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
    setConstraintType('conflicts_with_item')
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
    setExternalProductId('')
    setExternalTree([])
    setExternalProductName('')
  }

  const handleExternalProductChange = (productId: string, loadOptions: boolean) => {
    setExternalProductId(productId)
    setTargetId('')
    setExternalTree([])
    const name = productSeedOptions.find((p) => p.id === productId)?.label || productId
    setExternalProductName(productId ? name : '')
    if (productId && loadOptions) {
      void handleExternalProductSelect(productId)
    }
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && handleClose()}>
      <DrawerContent className="sm:max-w-2xl">
        <DrawerHeader>
          <DrawerTitle>{t('catalog.constraints.addConstraint', 'Add Constraint')}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="flex flex-col gap-5 sm:gap-6">

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
            <RadioGroup
              value={constraintType}
              onValueChange={(value) => setConstraintType(value as ConstraintType)}
              className="grid gap-2 sm:grid-cols-2"
            >
              {(Object.keys(CONSTRAINT_TYPE_LABELS) as ConstraintType[]).map((value) => {
                const color = CONSTRAINT_TYPE_COLORS[value]
                const selected = constraintType === value
                const description = CONSTRAINT_TYPE_DESCRIPTION_KEYS[value]
                return (
                  <label
                    key={value}
                    className={cn(
                      'flex cursor-pointer gap-3 rounded-md border bg-surface p-3 text-left transition-colors',
                      selected ? 'border-primary shadow-focus' : 'hover:border-border/80 hover:bg-surface-muted',
                    )}
                  >
                    <Radio value={value} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <Tag variant={color.variant} dot={color.dot} className="mb-2 text-xs font-medium">
                        {getConstraintTypeLabel(value, t)}
                      </Tag>
                      <span className="block text-xs text-muted-foreground">
                        {t(description.key, description.fallback)}
                      </span>
                    </span>
                  </label>
                )
              })}
            </RadioGroup>
          </div>

          {/* Target */}
          <div className="flex flex-col gap-2 mt-2">
            <div>
              <label className="text-sm font-medium text-foreground">
                {t('catalog.constraints.target.label', 'Target')}
              </label>
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                {t('catalog.constraints.target.hint', 'What is the source constrained with?')}
              </p>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-surface-muted p-3 mt-1">
              {/* Mobile: Select dropdown */}
              <Select
                value={targetMode}
                onValueChange={(v) => handleTargetModeChange(v as TargetMode)}
              >
                <SelectTrigger className="w-full sm:hidden">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local_option">
                    {t('catalog.constraints.target.localOption', "This product's option")}
                  </SelectItem>
                  <SelectItem value="external_product">
                    {t('catalog.constraints.target.externalProduct', 'Other product')}
                  </SelectItem>
                  <SelectItem value="external_option">
                    {t('catalog.constraints.target.externalOption', 'Other product option')}
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Desktop: SegmentedControl */}
              <SegmentedControl
                value={targetMode}
                onValueChange={(v) => handleTargetModeChange(v as TargetMode)}
                fullWidth
                size="sm"
                className="hidden sm:flex"
              >
                <SegmentedControlItem value="local_option">
                  {t('catalog.constraints.target.localOption', "This product's option")}
                </SegmentedControlItem>
                <SegmentedControlItem value="external_product">
                  {t('catalog.constraints.target.externalProduct', 'Other product')}
                </SegmentedControlItem>
                <SegmentedControlItem value="external_option">
                  {t('catalog.constraints.target.externalOption', 'Other product option')}
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
                value={externalProductId}
                onChange={(id) => {
                  if (id === '') {
                    handleExternalProductChange('', false)
                  } else {
                    handleExternalProductChange(id, false)
                  }
                }}
                items={productSeedOptions}
                placeholder={t('catalog.constraints.selectOtherProduct', 'Select a product...')}
                clearable
              />
            )}

            {targetMode === 'external_option' && (
              <div className="grid gap-3">
                <CascadingCombobox
                  value={externalProductId}
                  onChange={(id) => {
                    if (id === '') {
                      handleExternalProductChange('', true)
                    } else {
                      handleExternalProductChange(id, true)
                    }
                  }}
                  items={productSeedOptions}
                  placeholder={t('catalog.constraints.selectOtherProduct', 'Select a product...')}
                  clearable
                />
                <CascadingCombobox
                  value={targetId}
                  onChange={setTargetId}
                  items={externalTree}
                  placeholder={
                    externalProductId
                      ? t('catalog.constraints.selectExternalOption', 'Select an option from that product...')
                      : t('catalog.constraints.selectProductFirst', 'Select a product first...')
                  }
                  loading={loadingExternal}
                  disabled={!externalProductId}
                  clearable
                />
              </div>
            )}
            </div>
          </div>

          <div className="rounded-md border bg-surface p-3">
            <p className="text-xs font-medium text-muted-foreground">
              {t('catalog.constraints.preview', 'Preview')}
            </p>
            <p className="mt-1 text-sm text-foreground">
              <span className="font-medium">{selectedSourceLabel}</span>
              {' '}
              <span>{getConstraintTypeLabel(constraintType, t).toLowerCase()}</span>
              {' '}
              <span className="font-medium">
                {selectedTargetLabel ?? t('catalog.constraints.preview.targetPlaceholder', 'selected target')}
              </span>
            </p>
          </div>

        </DrawerBody>
        <DrawerFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="hidden text-xs text-muted-foreground sm:inline-flex sm:items-center sm:gap-1.5">
            <KbdShortcut keys={['⌘', '↵']} />
            <span>{t('catalog.constraints.shortcut.toSave', 'to save')}</span>
          </span>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={handleClose}>
              {t('ui.actions.cancel', 'Cancel')}
            </Button>
            <Button type="button" className="w-full sm:w-auto" onClick={handleSubmit} disabled={!canSubmit}>
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

    const groupOptions = new Map<string, { id: string; name: string; path: string }[]>()
    for (const opt of options) {
      if (!groupOptions.has(opt.groupId)) groupOptions.set(opt.groupId, [])
      groupOptions.get(opt.groupId)!.push({ id: opt.id, name: opt.name, path: opt.path })
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
          description: [productName, o.path].filter(Boolean).join(' > '),
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
  }, [options, productName])

  const draftsRef = React.useRef(drafts)
  draftsRef.current = drafts

  const sync = useCallback((next: ConstraintDraft[]) => {
    onChangeRef.current(next.map(draftToPayload))
  }, [])

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
      <div className="flex flex-col gap-3 shrink-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-foreground">
            {t('catalog.constraints.heading', 'Constraints')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t('catalog.constraints.description', 'Define what this product or its options require, conflict with, or include.')}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
          {headerActions}
          <Button type="button" variant="outline" size="sm" className="w-full gap-2 sm:w-auto" onClick={() => setShowAddDrawer(true)}>
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
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-status-warning-bg" />
              <span className="text-sm font-medium text-foreground">
                {t('catalog.constraints.incoming', 'Incoming constraints')}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              ({incomingConstraints.length})
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {incomingConstraints.map((c) => {
              return (
                <IncomingConstraintBadge key={c.id} constraint={c} />
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
