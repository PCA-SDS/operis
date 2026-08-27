"use client"

import * as React from 'react'
import { useState, useCallback, useEffect } from 'react'
import { Plus, Trash2, Lock, Unlock } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import type { ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CatalogConstraintItem } from '@open-mercato/core/modules/catalog/data/types'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type ConstraintType = CatalogConstraintItem['constraint_type']

export const CONSTRAINT_TYPE_LABELS: Record<ConstraintType, string> = {
  conflicts_with_item: 'Conflicts with',
  requires_item: 'Requires',
  mutually_exclusive_item: 'Mutually exclusive with',
  includes_item: 'Includes',
}

type SourceOrTarget = 'product' | 'option'

type ConstraintDraft = {
  id: string
  constraintType: ConstraintType
  sourceKind: SourceOrTarget
  sourceId: string
  targetKind: SourceOrTarget
  targetId: string
  locked: boolean
}

type ProductSummary = { id: string; name: string }
type OptionSummary = { id: string; name: string; groupName: string }

function draftFromItem(item: CatalogConstraintItem): ConstraintDraft {
  return {
    id: item.id,
    constraintType: item.constraint_type,
    sourceKind: item.source_option_id ? 'option' : 'product',
    sourceId: (item.source_option_id ?? item.source_product_id) || '',
    targetKind: item.target_option_id ? 'option' : 'product',
    targetId: (item.target_option_id ?? item.target_product_id) || '',
    locked: item.locked,
  }
}

function draftToPayload(draft: ConstraintDraft): Omit<CatalogConstraintItem, 'created_at' | 'updated_at'> {
  return {
    id: draft.id,
    constraint_type: draft.constraintType,
    source_product_id: draft.sourceKind === 'product' ? draft.sourceId : null,
    source_option_id: draft.sourceKind === 'option' ? draft.sourceId : null,
    target_product_id: draft.targetKind === 'product' ? draft.targetId : null,
    target_option_id: draft.targetKind === 'option' ? draft.targetId : null,
    locked: draft.locked,
  }
}

function newDraft(): ConstraintDraft {
  return {
    id: crypto.randomUUID(),
    constraintType: 'requires_item',
    sourceKind: 'product',
    sourceId: '',
    targetKind: 'product',
    targetId: '',
    locked: false,
  }
}

// ────────────────────────────────────────────────────────────────────
// EntityCombobox — search products or options
// ────────────────────────────────────────────────────────────────────
type EntityComboboxProps = {
  kind: SourceOrTarget
  value: string
  productId: string
  options: OptionSummary[]
  onChange: (id: string) => void
  disabled?: boolean
  placeholder?: string
}

function EntityCombobox({ kind, value, productId, options, onChange, disabled, placeholder }: EntityComboboxProps) {
  const loadProducts = useCallback(async (query?: string): Promise<ComboboxOption[]> => {
    try {
      const params = new URLSearchParams({ limit: '20' })
      if (query) params.set('search', query)
      const result = await readApiResultOrThrow<{ items: ProductSummary[] }>(
        `/api/catalog/products?${params}`
      )
      return (result.items ?? []).map((p) => ({ value: p.id, label: p.name }))
    } catch {
      return []
    }
  }, [])

  if (kind === 'option') {
    const optionSuggestions: ComboboxOption[] = options.map((o) => ({
      value: o.id,
      label: o.name,
      description: o.groupName,
    }))
    return (
      <ComboboxInput
        value={value}
        onChange={onChange}
        placeholder={placeholder ?? 'Select option...'}
        suggestions={optionSuggestions}
        disabled={disabled}
        clearable
      />
    )
  }

  return (
    <ComboboxInput
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? 'Search product...'}
      loadSuggestions={loadProducts}
      disabled={disabled}
      clearable
    />
  )
}

// ────────────────────────────────────────────────────────────────────
// ConstraintRow — one editable row
// ────────────────────────────────────────────────────────────────────
type ConstraintRowProps = {
  draft: ConstraintDraft
  options: OptionSummary[]
  productId: string
  onChange: (updated: ConstraintDraft) => void
  onDelete: () => void
  isNew?: boolean
}

function ConstraintRow({ draft, options, productId, onChange, onDelete, isNew }: ConstraintRowProps) {
  const t = useT()

  const set = <K extends keyof ConstraintDraft>(key: K, val: ConstraintDraft[K]) =>
    onChange({ ...draft, [key]: val })

  return (
    <div
      className={cn(
        'grid gap-2 p-3 rounded-lg border bg-card transition-colors',
        isNew ? 'border-primary/30 bg-primary/5' : 'border-border',
        draft.locked && 'opacity-80'
      )}
      style={{ gridTemplateColumns: '1fr auto 1fr auto auto auto' }}
    >
      {/* Source */}
      <div className="flex gap-1.5 items-center min-w-0">
        <Select
          value={draft.sourceKind}
          onValueChange={(v) => set('sourceKind', v as SourceOrTarget)}
          disabled={draft.locked}
        >
          <SelectTrigger className="w-[90px] shrink-0 text-xs h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="product">{t('catalog.constraints.source.product', 'Product')}</SelectItem>
            <SelectItem value="option">{t('catalog.constraints.source.option', 'Option')}</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1 min-w-0">
          <EntityCombobox
            kind={draft.sourceKind}
            value={draft.sourceId}
            productId={productId}
            options={options}
            onChange={(id) => set('sourceId', id)}
            disabled={draft.locked}
            placeholder={draft.sourceKind === 'product' ? 'Search product...' : 'Select option...'}
          />
        </div>
      </div>

      {/* Type badge */}
      <div className="flex items-center px-1">
        <Select
          value={draft.constraintType}
          onValueChange={(v) => set('constraintType', v as ConstraintType)}
          disabled={draft.locked}
        >
          <SelectTrigger className="w-[180px] text-xs h-8 font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.entries(CONSTRAINT_TYPE_LABELS) as [ConstraintType, string][]).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Target */}
      <div className="flex gap-1.5 items-center min-w-0">
        <Select
          value={draft.targetKind}
          onValueChange={(v) => set('targetKind', v as SourceOrTarget)}
          disabled={draft.locked}
        >
          <SelectTrigger className="w-[90px] shrink-0 text-xs h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="product">{t('catalog.constraints.target.product', 'Product')}</SelectItem>
            <SelectItem value="option">{t('catalog.constraints.target.option', 'Option')}</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1 min-w-0">
          <EntityCombobox
            kind={draft.targetKind}
            value={draft.targetId}
            productId={productId}
            options={options}
            onChange={(id) => set('targetId', id)}
            disabled={draft.locked}
            placeholder={draft.targetKind === 'product' ? 'Search product...' : 'Select option...'}
          />
        </div>
      </div>

      {/* Lock toggle */}
      <button
        type="button"
        title={draft.locked ? t('catalog.constraints.unlock', 'Unlock') : t('catalog.constraints.lock', 'Lock')}
        onClick={() => set('locked', !draft.locked)}
        className={cn(
          'flex items-center justify-center w-8 h-8 rounded-md border transition-colors',
          draft.locked
            ? 'border-amber-400 bg-amber-50 text-amber-600 hover:bg-amber-100'
            : 'border-border bg-transparent text-muted-foreground hover:bg-muted'
        )}
      >
        {draft.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
      </button>

      {/* Delete */}
      <button
        type="button"
        title={t('common.delete', 'Delete')}
        onClick={onDelete}
        disabled={draft.locked}
        className="flex items-center justify-center w-8 h-8 rounded-md border border-border text-muted-foreground hover:border-destructive hover:text-destructive hover:bg-destructive/5 transition-colors disabled:opacity-40 disabled:pointer-events-none"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// ConstraintsEditor — public component
// ────────────────────────────────────────────────────────────────────
export type ConstraintsEditorProps = {
  constraints: CatalogConstraintItem[]
  productId: string
  onChange: (constraints: ReturnType<typeof draftToPayload>[]) => void
  /** Options from the current product's option tree for quick-picking */
  options?: OptionSummary[]
  headerActions?: React.ReactNode
}

export function ConstraintsEditor({
  constraints,
  productId,
  onChange,
  options = [],
  headerActions,
}: ConstraintsEditorProps) {
  const t = useT()
  const [drafts, setDrafts] = useState<ConstraintDraft[]>(() =>
    constraints.map(draftFromItem)
  )
  const [newIds, setNewIds] = useState<Set<string>>(new Set())

  // Sync upward whenever drafts change
  useEffect(() => {
    onChange(drafts.map(draftToPayload))
  }, [drafts]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateDraft = useCallback((id: string, updated: ConstraintDraft) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? updated : d)))
  }, [])

  const deleteDraft = useCallback((id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id))
    setNewIds((prev) => { const s = new Set(prev); s.delete(id); return s })
  }, [])

  const addNew = useCallback(() => {
    const draft = newDraft()
    setDrafts((prev) => [...prev, draft])
    setNewIds((prev) => new Set(prev).add(draft.id))
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {t('catalog.constraints.heading', 'Product Constraints')}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t(
              'catalog.constraints.description',
              'Define relationships between items — conflicts, requirements, mutual exclusions, and inclusions.'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {headerActions}
        </div>
      </div>

      {/* Column headers */}
      {drafts.length > 0 && (
        <div
          className="grid gap-2 px-3 text-xs font-medium text-muted-foreground"
          style={{ gridTemplateColumns: '1fr auto 1fr auto auto' }}
        >
          <span>{t('catalog.constraints.col.source', 'Source')}</span>
          <span className="w-[180px]">{t('catalog.constraints.col.type', 'Relationship')}</span>
          <span>{t('catalog.constraints.col.target', 'Target')}</span>
          <span className="w-8 text-center">{t('catalog.constraints.col.lock', 'Lock')}</span>
          <span className="w-8" />
        </div>
      )}

      {/* Rows */}
      <div className="flex flex-col gap-2">
        {drafts.map((draft) => (
          <ConstraintRow
            key={draft.id}
            draft={draft}
            options={options}
            productId={productId}
            onChange={(updated) => updateDraft(draft.id, updated)}
            onDelete={() => deleteDraft(draft.id)}
            isNew={newIds.has(draft.id)}
          />
        ))}

        {drafts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed rounded-lg text-muted-foreground gap-2">
            <p className="text-sm font-medium">
              {t('catalog.constraints.empty', 'No constraints defined')}
            </p>
            <p className="text-xs">
              {t(
                'catalog.constraints.emptyHint',
                'Add a constraint to define how this product or its options relate to other items.'
              )}
            </p>
          </div>
        )}
      </div>

      {/* Add button */}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={addNew}
        >
          <Plus className="w-3.5 h-3.5" />
          {t('catalog.constraints.addConstraint', 'Add Constraint')}
        </Button>
      </div>
    </div>
  )
}

export { draftToPayload }
