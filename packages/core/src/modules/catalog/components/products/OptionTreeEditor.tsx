"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import {
  apiCallOrThrow,
  readApiResultOrThrow,
  withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { DndContext, closestCenter, type DragEndEvent, PointerSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog/useConfirmDialog'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  Tag,
  Clock,
  Banknote,
  FolderTree,
  Layers,
  Save,
} from 'lucide-react'
import type { CatalogOptionTreeData } from '@open-mercato/core/modules/catalog/data/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'

const logger = createLogger('catalog')

export interface OptionTreeEditorProps {
  groups: GroupItem[];
  options: OptionItem[];
  onChangeGroups: (groups: GroupItem[]) => void;
  onChangeOptions: (options: OptionItem[]) => void;
  currencyCode?: string;
  productId?: string;
  headerActions?: React.ReactNode;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type GroupItem = CatalogOptionTreeData['groups'][number]
type OptionItem = CatalogOptionTreeData['options'][number]
type OptionDurationUnit = 'minute' | 'hour'
type OptionPriceType = 'fixed' | 'range'

type GroupFormValues = {
  name: string
  description: string
  requirement: 'required' | 'optional'
  select_mode: 'single' | 'multiple'
}

type OptionFormValues = {
  name: string
  code: string
  description: string
  price_flat: string
  price_min: string
  price_max: string
  duration_value: string
  duration_min: string
  duration_max: string
  duration_unit: OptionDurationUnit
  is_addon: boolean
}

const EMPTY_OPTION_FORM: OptionFormValues = {
  name: '',
  code: '',
  description: '',
  price_flat: '',
  price_min: '',
  price_max: '',
  duration_value: '',
  duration_min: '',
  duration_max: '',
  duration_unit: 'minute',
  is_addon: false,
}

function normalizeDurationUnit(value: string | null | undefined): OptionDurationUnit {
  return value === 'hour' ? 'hour' : 'minute'
}

function formatOptionPriceLabel(option: OptionItem, t: ReturnType<typeof useT>, currencyCode?: string): string | null {
  const flat = formatCurrency(option.price_flat, currencyCode)
  const min = formatCurrency(option.price_min, currencyCode)
  const max = formatCurrency(option.price_max, currencyCode)

  if (min && max) return `${min} - ${max}`
  if (flat !== null) return flat
  if (min) return `${t('catalog.options.priceFrom', 'From')} ${min}`
  if (max) return `${t('catalog.options.priceUpTo', 'Up to')} ${max}`
  return null
}

function formatOptionDurationLabel(option: OptionItem, t: ReturnType<typeof useT>): string | null {
  const unitLabel = normalizeDurationUnit(option.duration_unit) === 'hour'
    ? t('catalog.options.durationUnitHourShort', 'hr')
    : t('catalog.options.durationUnitMinuteShort', 'min')

  const min = option.duration_min
  const max = option.duration_max

  if (min !== null && min !== undefined && max !== null && max !== undefined) {
    return `${min} - ${max} ${unitLabel}`
  }
  if (option.duration_value !== null && option.duration_value !== undefined) {
    return `${option.duration_value} ${unitLabel}`
  }
  if (min !== null && min !== undefined) return `${min}+ ${unitLabel}`
  if (max !== null && max !== undefined) return `≤ ${max} ${unitLabel}`
  return null
}

function toOptionFormValues(option: OptionItem): OptionFormValues {
  return {
    name: option.name ?? '',
    code: option.code ?? '',
    description: option.description ?? '',
    price_flat: option.price_flat ?? '',
    price_min: option.price_min ?? '',
    price_max: option.price_max ?? '',
    duration_value: option.duration_value === null || option.duration_value === undefined
      ? ''
      : String(option.duration_value),
    duration_min: option.duration_min === null || option.duration_min === undefined
      ? ''
      : String(option.duration_min),
    duration_max: option.duration_max === null || option.duration_max === undefined
      ? ''
      : String(option.duration_max),
    duration_unit: normalizeDurationUnit(option.duration_unit),
    is_addon: option.is_addon ?? false,
  }
}

function collectCascadeDeletion(
  initialGroupIds: Iterable<string>,
  initialOptionIds: Iterable<string>,
  groups: GroupItem[],
  options: OptionItem[],
): { groupIds: Set<string>; optionIds: Set<string> } {
  const groupIds = new Set(initialGroupIds)
  const optionIds = new Set(initialOptionIds)

  let added = true
  while (added) {
    added = false

    for (const option of options) {
      if (groupIds.has(option.group_id) && !optionIds.has(option.id)) {
        optionIds.add(option.id)
        added = true
      }
    }

    for (const group of groups) {
      if (!group.parent_option_id || groupIds.has(group.id)) continue
      if (optionIds.has(group.parent_option_id)) {
        groupIds.add(group.id)
        added = true
      }
    }
  }

  return { groupIds, optionIds }
}

// ─── Group Dialog ──────────────────────────────────────────────────────────────

export function OptionTreeSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2].map((i) => (
        <div key={i} className="rounded-lg border border-border bg-card shadow-sm">
          {/* Group Header Skeleton */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
            <div className="h-4 w-4 rounded bg-muted animate-pulse shrink-0" />
            <div className="h-4 w-4 rounded bg-muted animate-pulse shrink-0" />
            <div className="flex-1">
              <div className="h-5 w-48 rounded bg-muted animate-pulse" />
            </div>
            <div className="h-7 w-24 rounded bg-muted animate-pulse shrink-0" />
          </div>
          
          {/* Options List Skeleton */}
          <div className="px-4 py-2 space-y-2">
            {[1, 2, 3].map((j) => (
              <div key={j} className="flex items-center gap-3 py-2 pl-6">
                <div className="h-3 w-3 rounded bg-muted animate-pulse shrink-0" />
                <div className="h-4 w-4 rounded bg-muted animate-pulse shrink-0" />
                <div className="h-4 w-32 rounded bg-muted animate-pulse flex-1" />
                <div className="h-5 w-16 rounded bg-muted animate-pulse shrink-0" />
                <div className="h-5 w-16 rounded bg-muted animate-pulse shrink-0" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function GroupDialog({
  open,
  onOpenChange,
  initialValues,
  productId,
  parentOptionId,
  onSave,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initialValues?: GroupFormValues
  productId: string
  parentOptionId?: string | null
  onSave: (group: GroupItem) => void
}) {
  const t = useT()
  const [form, setForm] = useState<GroupFormValues>(
    initialValues ?? { name: '', description: '', requirement: 'required', select_mode: 'single' }
  )

  useEffect(() => {
    if (open) {
      setForm(initialValues ?? { name: '', description: '', requirement: 'required', select_mode: 'single' })
    }
  }, [open, initialValues])

  const handleSave = useCallback(() => {
    if (!form.name.trim()) return
    onSave({
      id: crypto.randomUUID(),
      product_id: productId,
      parent_option_id: parentOptionId ?? null,
      name: form.name,
      description: form.description || null,
      requirement: form.requirement,
      select_mode: form.select_mode,
      sort_order: 0,
      is_active: true,
      metadata: null,
    } as GroupItem)
    onOpenChange(false)
  }, [form, productId, parentOptionId, onSave, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <div 
          onKeyDown={(e) => { 
            if (e.key === 'Enter' && form.name.trim()) { 
              e.preventDefault(); 
              handleSave(); 
            } 
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              {parentOptionId
                ? t('catalog.options.addSubGroup', 'Add Sub-Group')
                : t('catalog.options.addGroup', 'Add Option Group')}
            </DialogTitle>
          </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="group-name">{t('catalog.options.groupName', 'Group name')} *</Label>
            <Input
              id="group-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t('catalog.options.groupNamePlaceholder', 'e.g. Polish Type')}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="group-desc">{t('catalog.options.description', 'Description')}</Label>
            <Textarea
              id="group-desc"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t('catalog.options.descriptionPlaceholder', 'Optional description…')}
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('catalog.options.requirement', 'Requirement')}</Label>
              <div className="flex rounded-md border overflow-hidden">
                {(['required', 'optional'] as const).map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, requirement: val }))}
                    className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                      form.requirement === val
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {val === 'required' ? t('catalog.options.reqRequired', 'Required') : t('catalog.options.reqOptional', 'Optional')}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t('catalog.options.selection', 'Selection')}</Label>
              <div className="flex rounded-md border overflow-hidden">
                {(['single', 'multiple'] as const).map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, select_mode: val }))}
                    className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                      form.select_mode === val
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {val === 'single' ? t('catalog.options.selSingle', 'Single') : t('catalog.options.selMultiple', 'Multiple')}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={!form.name.trim()}>
            {t('common.save', 'Save')}
          </Button>
        </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Option Dialog ─────────────────────────────────────────────────────────────

function OptionDialog({
  open,
  onOpenChange,
  initialValues,
  groupId,
  onSave,
  editId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initialValues?: OptionFormValues
  groupId: string
  onSave: (opt: OptionItem) => void
  editId?: string | null
}) {
  const t = useT()
  const [form, setForm] = useState<OptionFormValues>(
    initialValues ?? EMPTY_OPTION_FORM
  )
  const [priceType, setPriceType] = useState<OptionPriceType>('fixed')
  const [durationType, setDurationType] = useState<'fixed' | 'range'>('fixed')

  useEffect(() => {
    if (open) {
      setForm(initialValues ?? EMPTY_OPTION_FORM)
      setPriceType((initialValues?.price_min || initialValues?.price_max) ? 'range' : 'fixed')
      setDurationType((initialValues?.duration_min || initialValues?.duration_max) ? 'range' : 'fixed')
    }
  }, [open, initialValues])

  const handleSave = useCallback(() => {
    if (!form.name.trim()) return
    
    onSave({
      id: editId || crypto.randomUUID(),
      group_id: groupId,
      name: form.name,
      code: form.code || null,
      description: form.description || null,
      price_flat: (priceType === 'fixed' && form.price_flat) ? form.price_flat : null,
      price_min: (priceType === 'range' && form.price_min) ? form.price_min : null,
      price_max: (priceType === 'range' && form.price_max) ? form.price_max : null,
      duration_value: (durationType === 'fixed' && form.duration_value) ? parseInt(form.duration_value, 10) : null,
      duration_min: (durationType === 'range' && form.duration_min) ? parseInt(form.duration_min, 10) : null,
      duration_max: (durationType === 'range' && form.duration_max) ? parseInt(form.duration_max, 10) : null,
      duration_unit: (form.duration_value || form.duration_min || form.duration_max) ? form.duration_unit : null,
      is_addon: form.is_addon,
      sort_order: 0,
      is_active: true,
      metadata: null,
      note: null,
      unit: null,
    } as OptionItem)
    onOpenChange(false)
  }, [form, editId, groupId, onSave, onOpenChange, priceType, durationType])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <div 
          onKeyDown={(e) => { 
            if (e.key === 'Enter' && form.name.trim()) { 
              e.preventDefault(); 
              handleSave(); 
            } 
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" />
              {editId
                ? t('catalog.options.editOption', 'Edit Option')
                : t('catalog.options.addOption', 'Add Option')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 mt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label htmlFor="opt-name">{t('catalog.options.optionName', 'Name')} *</Label>
              <Input
                id="opt-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t('catalog.options.optionNamePlaceholder', 'e.g. Gel Polish')}
                autoFocus
              />
            </div>

            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label htmlFor="opt-code">{t('catalog.options.code', 'Code')}</Label>
              <Input
                id="opt-code"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder={t('catalog.options.codePlaceholder', 'gel-polish')}
              />
              <p className="mt-0.5 text-xs leading-tight text-muted-foreground">
                {t('catalog.options.codeHint', 'Optional identifier for integrations')}
              </p>
            </div>

            <div className="space-y-1.5 col-span-2">
              <div className="flex items-center justify-between">
                <Label>
                  <Banknote className="inline h-3 w-3 text-muted-foreground mr-1" />
                  {t('catalog.options.price', 'Price')}
                </Label>
                <div className="flex bg-muted rounded-md p-0.5">
                  <button
                    type="button"
                    onClick={() => setPriceType('fixed')}
                    className={`rounded-sm px-2 py-0.5 text-xs transition-colors ${priceType === 'fixed' ? 'bg-surface shadow-sm text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    {t('catalog.options.priceFixed', 'Fixed')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPriceType('range')}
                    className={`rounded-sm px-2 py-0.5 text-xs transition-colors ${priceType === 'range' ? 'bg-surface shadow-sm text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    {t('catalog.options.priceRange', 'Range')}
                  </button>
                </div>
              </div>
              
              {priceType === 'fixed' ? (
                <Input
                  id="opt-price-flat"
                  type="number"
                  value={form.price_flat}
                  onChange={(e) => setForm((f) => ({ ...f, price_flat: e.target.value }))}
                  placeholder={t('catalog.options.pricePlaceholder', 'e.g. 50000')}
                />
              ) : (
                <div className="flex gap-2 items-center">
                  <Input
                    id="opt-price-min"
                    type="number"
                    value={form.price_min}
                    onChange={(e) => setForm((f) => ({ ...f, price_min: e.target.value }))}
                    placeholder={t('catalog.options.priceMinPlaceholder', 'Min')}
                  />
                  <span className="text-muted-foreground text-sm">-</span>
                  <Input
                    id="opt-price-max"
                    type="number"
                    value={form.price_max}
                    onChange={(e) => setForm((f) => ({ ...f, price_max: e.target.value }))}
                    placeholder={t('catalog.options.priceMaxPlaceholder', 'Max')}
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5 col-span-2">
              <div className="flex items-center justify-between">
                <Label>
                  <Clock className="inline h-3 w-3 text-muted-foreground mr-1" />
                  {t('catalog.options.duration', 'Duration')}
                </Label>
                <div className="flex bg-muted rounded-md p-0.5">
                  <button
                    type="button"
                    onClick={() => setDurationType('fixed')}
                    className={`rounded-sm px-2 py-0.5 text-xs transition-colors ${durationType === 'fixed' ? 'bg-surface shadow-sm text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    {t('catalog.options.priceFixed', 'Fixed')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDurationType('range')}
                    className={`rounded-sm px-2 py-0.5 text-xs transition-colors ${durationType === 'range' ? 'bg-surface shadow-sm text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    {t('catalog.options.priceRange', 'Range')}
                  </button>
                </div>
              </div>
              
              <div className="flex gap-2">
                {durationType === 'fixed' ? (
                  <Input
                    id="opt-dur"
                    type="number"
                    value={form.duration_value}
                    onChange={(e) => setForm((f) => ({ ...f, duration_value: e.target.value }))}
                    placeholder={t('catalog.options.durationPlaceholder', '30')}
                    className="flex-1"
                  />
                ) : (
                  <div className="flex gap-2 items-center flex-1 min-w-0">
                    <Input
                      id="opt-dur-min"
                      type="number"
                      value={form.duration_min}
                      onChange={(e) => setForm((f) => ({ ...f, duration_min: e.target.value }))}
                      placeholder={t('catalog.options.priceMinPlaceholder', 'Min')}
                      className="flex-1 min-w-0"
                    />
                    <span className="text-muted-foreground text-sm shrink-0">-</span>
                    <Input
                      id="opt-dur-max"
                      type="number"
                      value={form.duration_max}
                      onChange={(e) => setForm((f) => ({ ...f, duration_max: e.target.value }))}
                      placeholder={t('catalog.options.priceMaxPlaceholder', 'Max')}
                      className="flex-1 min-w-0"
                    />
                  </div>
                )}
                
                <div className="w-[120px] shrink-0">
                  <Select
                    value={form.duration_unit}
                    onValueChange={(value) => setForm((f) => ({ ...f, duration_unit: normalizeDurationUnit(value) }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minute">{t('catalog.options.durationUnitMinute', 'Minutes')}</SelectItem>
                      <SelectItem value="hour">{t('catalog.options.durationUnitHour', 'Hours')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="opt-desc">{t('catalog.options.description', 'Description')}</Label>
            <Textarea
              id="opt-desc"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t('catalog.options.descriptionPlaceholder', 'Optional description…')}
              rows={2}
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Checkbox
              id="opt-addon"
              checked={form.is_addon}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, is_addon: !!checked }))}
            />
            <Label htmlFor="opt-addon" className="cursor-pointer font-normal text-sm">
              {t('catalog.options.isAddon', 'This is an add-on (optional extra)')}
            </Label>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={!form.name.trim()}>
            {t('common.save', 'Save')}
          </Button>
        </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Option Row ────────────────────────────────────────────────────────────────

function OptionRow({
  opt,
  allGroups,
  allOptions,
  depth,
  onEdit,
  onDelete,
  onAddSubGroup,
  onSaveGroup,
  onSaveOption,
  onDeleteGroup,
  onDeleteOption,
  productId,
  currencyCode,
}: {
  opt: OptionItem
  allGroups: GroupItem[]
  allOptions: OptionItem[]
  depth: number
  onEdit: (opt: OptionItem) => void
  onDelete: (id: string) => void
  onAddSubGroup: (parentOptionId: string) => void
  onSaveGroup: (g: GroupItem) => void
  onSaveOption: (o: OptionItem) => void
  onDeleteGroup: (id: string) => void
  onDeleteOption: (id: string) => void
  productId: string
  currencyCode: string
}) {
  const t = useT()
  const subGroups = allGroups.filter((group) => group.parent_option_id === opt.id)
  const [expanded, setExpanded] = useState(true)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editNameValue, setEditNameValue] = useState(opt.name)
  const hasSubGroups = subGroups.length > 0
  const priceLabel = formatOptionPriceLabel(opt, t, currencyCode)
  const durationLabel = formatOptionDurationLabel(opt, t)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: opt.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
    position: 'relative' as const,
  }

  const handleRenameConfirm = () => {
    if (editNameValue.trim() && editNameValue !== opt.name) {
      onSaveOption({ ...opt, name: editNameValue.trim() })
    } else {
      setEditNameValue(opt.name)
    }
    setIsEditingName(false)
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameConfirm()
    } else if (e.key === 'Escape') {
      setEditNameValue(opt.name)
      setIsEditingName(false)
    }
  }

  return (
    <div ref={setNodeRef} style={style} className="group/opt">
      <div className="flex items-center gap-2 py-2 px-3 rounded-md hover:bg-muted/40 transition-colors">
        <button type="button" className="cursor-grab hover:bg-muted rounded p-0.5" {...attributes} {...listeners}>
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
        </button>

        {hasSubGroups ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-0.5 rounded hover:bg-muted shrink-0"
          >
            {expanded
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        ) : (
          <div className="w-5 shrink-0" />
        )}

        {isEditingName ? (
          <Input
            autoFocus
            value={editNameValue}
            onChange={e => setEditNameValue(e.target.value)}
            onBlur={handleRenameConfirm}
            onKeyDown={handleRenameKeyDown}
            className="h-7 text-sm py-1 flex-1 min-w-0"
          />
        ) : (
          <span
            className="font-medium text-sm flex-1 cursor-pointer hover:underline underline-offset-4 decoration-primary/50"
            onClick={() => setIsEditingName(true)}
          >
            {opt.name}
          </span>
        )}

        {opt.code && (
          <Badge variant="outline" className="text-xs font-mono hidden group-hover/opt:inline-flex">
            {opt.code}
          </Badge>
        )}
        {priceLabel ? (
          <Badge variant="secondary" className="text-xs gap-1">
            <Banknote className="h-2.5 w-2.5" />
            {priceLabel}
          </Badge>
        ) : null}
        {durationLabel ? (
          <Badge variant="secondary" className="text-xs gap-1">
            <Clock className="h-2.5 w-2.5" />
            {durationLabel}
          </Badge>
        ) : null}

        <div className="flex gap-1 opacity-0 group-hover/opt:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => onAddSubGroup(opt.id)}
            className="p-1.5 rounded hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors"
            title={t('catalog.options.addSubGroup', 'Add sub-group after this option')}
          >
            <FolderTree className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onEdit(opt)}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(opt.id)}
            className="p-1.5 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {hasSubGroups && expanded && (
        <div className="ml-8 mt-1 space-y-2 border-l-2 border-primary/20 pl-3">
          {subGroups.map((sg: GroupItem) => (
            <GroupCard
              key={sg.id}
              group={sg}
              allGroups={allGroups}
              allOptions={allOptions}
              depth={depth + 1}
              productId={productId}
              onSaveGroup={onSaveGroup}
              onSaveOption={onSaveOption}
              onDeleteGroup={onDeleteGroup}
              onDeleteOption={onDeleteOption}
              currencyCode={currencyCode}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Group Card ────────────────────────────────────────────────────────────────

function GroupCard({
  group,
  allGroups,
  allOptions,
  depth,
  productId,
  onSaveGroup,
  onSaveOption,
  onDeleteGroup,
  onDeleteOption,
  currencyCode,
}: {
  group: GroupItem
  allGroups: GroupItem[]
  allOptions: OptionItem[]
  depth: number
  productId: string
  onSaveGroup: (g: GroupItem) => void
  onSaveOption: (o: OptionItem) => void
  onDeleteGroup: (id: string) => void
  onDeleteOption: (id: string) => void
  currencyCode: string
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(true)
  const [addOptionOpen, setAddOptionOpen] = useState(false)
  const [editingOption, setEditingOption] = useState<OptionItem | null>(null)
  const [addSubGroupForOption, setAddSubGroupForOption] = useState<string | null>(null)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editNameValue, setEditNameValue] = useState(group.name)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const groupOptions = allOptions.filter((option) => option.group_id === group.id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = groupOptions.findIndex((o) => o.id === active.id)
      const newIndex = groupOptions.findIndex((o) => o.id === over.id)
      if (oldIndex >= 0 && newIndex >= 0) {
        const reordered = arrayMove(groupOptions, oldIndex, newIndex)
        reordered.forEach((opt, index) => {
          if (opt.sort_order !== index) {
            onSaveOption({ ...opt, sort_order: index })
          }
        })
      }
    }
  }

  const handleRenameConfirm = () => {
    if (editNameValue.trim() && editNameValue !== group.name) {
      onSaveGroup({ ...group, name: editNameValue.trim() })
    } else {
      setEditNameValue(group.name)
    }
    setIsEditingName(false)
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameConfirm()
    } else if (e.key === 'Escape') {
      setEditNameValue(group.name)
      setIsEditingName(false)
    }
  }

  const handleDeleteGroup = async () => {
    const ok = await confirm({
      title: t('catalog.options.deleteGroup', 'Delete group?'),
      description: `"${group.name}" ${t('catalog.options.deleteGroupDesc', 'and all its options will be permanently removed.')}`,
      confirmText: t('common.delete', 'Delete'),
      variant: 'destructive',
    })
    if (!ok) return
    onDeleteGroup(group.id)
  }

  const handleDeleteOption = async (optId: string) => {
    const ok = await confirm({
      title: t('catalog.options.deleteOption', 'Delete option?'),
      description: t('catalog.options.deleteOptionDesc', 'This option will be permanently removed.'),
      confirmText: t('common.delete', 'Delete'),
      variant: 'destructive',
    })
    if (!ok) return
    onDeleteOption(optId)
  }

  const requirementColor = group.requirement === 'required' ? 'destructive' : 'secondary'

  return (
    <div className={`rounded-lg border bg-card shadow-sm transition-all ${depth === 0 ? 'border-border' : 'border-dashed border-primary/30 bg-primary/[0.02]'}`}>
      {/* Group header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="p-0.5 rounded hover:bg-muted shrink-0"
        >
          {expanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>

        {depth === 0
          ? <Layers className="h-4 w-4 text-primary shrink-0" />
          : <FolderTree className="h-4 w-4 text-primary/60 shrink-0" />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isEditingName ? (
              <Input
                autoFocus
                value={editNameValue}
                onChange={e => setEditNameValue(e.target.value)}
                onBlur={handleRenameConfirm}
                onKeyDown={handleRenameKeyDown}
                className="h-7 text-sm py-1 w-48"
              />
            ) : (
              <span
                className="font-semibold text-sm cursor-pointer hover:underline underline-offset-4 decoration-primary/50"
                onClick={() => setIsEditingName(true)}
              >
                {group.name}
              </span>
            )}
            <Badge variant={requirementColor} className="text-xs capitalize">
              {group.requirement}
            </Badge>
            <Badge variant="outline" className="text-xs capitalize">
              {group.select_mode}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {groupOptions.length} {groupOptions.length === 1
                ? t('catalog.options.optionSingular', 'option')
                : t('catalog.options.optionPlural', 'options')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAddOptionOpen(true)}
            className="h-7 gap-1 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('catalog.options.addOption', 'Add option')}
          </Button>
          <button
            type="button"
            onClick={handleDeleteGroup}
            className="p-1.5 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Options list */}
      {expanded && (
        <div className="p-2">
          {groupOptions.length === 0 ? (
            <div className="py-3 text-center text-xs text-muted-foreground">
              {t('catalog.options.noOptions', 'No options yet.')}
              <button
                type="button"
                onClick={() => setAddOptionOpen(true)}
                className="ml-1 text-primary hover:underline"
              >
                {t('catalog.options.addFirst', 'Add one')}
              </button>
            </div>
          ) : (
            <div className="space-y-0.5">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={groupOptions.map(o => o.id)} strategy={verticalListSortingStrategy}>
                  {groupOptions.map((opt: OptionItem) => (
                    <OptionRow
                      key={opt.id}
                      opt={opt}
                      allGroups={allGroups}
                      allOptions={allOptions}
                      depth={depth}
                      onEdit={(o) => setEditingOption(o)}
                      onDelete={handleDeleteOption}
                      onAddSubGroup={(parentOptId) => setAddSubGroupForOption(parentOptId)}
                      productId={productId}
                      onSaveGroup={onSaveGroup}
                      onSaveOption={onSaveOption}
                      onDeleteGroup={onDeleteGroup}
                      onDeleteOption={onDeleteOption}
                      currencyCode={currencyCode}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          )}
        </div>
      )}

      {/* Dialogs */}
      {ConfirmDialogElement}

      <OptionDialog
        open={addOptionOpen}
        onOpenChange={setAddOptionOpen}
        groupId={group.id}
        onSave={onSaveOption}
      />

      {editingOption && (
        <OptionDialog
          open={!!editingOption}
          onOpenChange={(v) => { if (!v) setEditingOption(null) }}
          editId={editingOption.id}
          groupId={group.id}
          initialValues={toOptionFormValues(editingOption)}
          onSave={onSaveOption}
        />
      )}

      {addSubGroupForOption && (
        <GroupDialog
          open={!!addSubGroupForOption}
          onOpenChange={(v) => { if (!v) setAddSubGroupForOption(null) }}
          productId={productId}
          parentOptionId={addSubGroupForOption}
          onSave={onSaveGroup}
        />
      )}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export function OptionTreeEditor({
  groups: localGroups,
  options: localOptions,
  onChangeGroups: setLocalGroups,
  onChangeOptions: setLocalOptions,
  currencyCode = 'VND',
  productId = '',
  headerActions,
}: OptionTreeEditorProps) {
  const t = useT()
  const [addGroupOpen, setAddGroupOpen] = useState(false)



  // Handlers for updating local state tree
  const handleSaveGroup = useCallback((group: GroupItem) => {
    const prev = localGroups;
    const idx = prev.findIndex(g => g.id === group.id)
    if (idx >= 0) {
      const next = [...prev]
      next[idx] = group
      setLocalGroups(next)
      return
    }
    const siblings = prev.filter(g => g.parent_option_id === group.parent_option_id)
    const maxSort = siblings.reduce((max, g) => Math.max(max, g.sort_order), -1)
    setLocalGroups([...prev, { ...group, sort_order: maxSort + 1 }])
  }, [localGroups, setLocalGroups])

  const handleDeleteGroup = useCallback((id: string) => {
    const { groupIds, optionIds } = collectCascadeDeletion([id], [], localGroups, localOptions)
    setLocalGroups(localGroups.filter((group) => !groupIds.has(group.id)))
    setLocalOptions(localOptions.filter((option) => !optionIds.has(option.id)))
  }, [localGroups, localOptions, setLocalGroups, setLocalOptions])

  const handleSaveOption = useCallback((option: OptionItem) => {
    const prev = localOptions;
    const idx = prev.findIndex(o => o.id === option.id)
    if (idx >= 0) {
      const next = [...prev]
      next[idx] = option
      setLocalOptions(next)
      return
    }
    const siblings = prev.filter(o => o.group_id === option.group_id)
    const maxSort = siblings.reduce((max, o) => Math.max(max, o.sort_order), -1)
    setLocalOptions([...prev, { ...option, sort_order: maxSort + 1 }])
  }, [localOptions, setLocalOptions])

  const handleDeleteOption = useCallback((id: string) => {
    const { groupIds, optionIds } = collectCascadeDeletion([], [id], localGroups, localOptions)
    setLocalGroups(localGroups.filter((group) => !groupIds.has(group.id)))
    setLocalOptions(localOptions.filter((option) => !optionIds.has(option.id)))
  }, [localGroups, localOptions, setLocalGroups, setLocalOptions])



  const rootGroups = localGroups.filter(g => !g.parent_option_id)

  return (
    <div>
        <div className="flex flex-col gap-4">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                {rootGroups.length > 0
                  ? `${rootGroups.length} ${t('catalog.options.rootGroups', 'root groups')} · ${localOptions.length} ${t('catalog.options.totalOptions', 'total options')}`
                  : t('catalog.options.emptyHint', 'Add groups to build the option tree for this product.')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {headerActions}
              <Button type="button" onClick={() => setAddGroupOpen(true)} variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />
                {t('catalog.options.addGroup', 'Add Group')}
              </Button>
            </div>
          </div>

          {/* Content */}
          {rootGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 border-2 border-dashed rounded-xl bg-card text-muted-foreground shadow-sm">
              <div className="p-4 rounded-full bg-primary/10">
                <FolderTree className="h-12 w-12 text-primary/80" />
              </div>
              <div className="text-center max-w-sm">
                <h3 className="font-semibold text-lg text-foreground">{t('catalog.options.noGroups', 'No options configured yet')}</h3>
                <p className="text-sm mt-1">{t('catalog.options.noGroupsHint', 'Add option groups to let customers choose service variants.')}</p>
              </div>
              <Button type="button" onClick={() => setAddGroupOpen(true)} className="gap-2 mt-2">
                <Plus className="h-4 w-4" />
                {t('catalog.options.addFirstGroup', 'Add first group')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {rootGroups.map((group: GroupItem) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  allGroups={localGroups}
                  allOptions={localOptions}
                  depth={0}
                  productId={productId}
                  onSaveGroup={handleSaveGroup}
                  onSaveOption={handleSaveOption}
                  onDeleteGroup={handleDeleteGroup}
                  onDeleteOption={handleDeleteOption}
                  currencyCode={currencyCode}
                />
              ))}
            </div>
          )}
        </div>

        {/* Add root group dialog */}
        <GroupDialog
          open={addGroupOpen}
          onOpenChange={setAddGroupOpen}
          productId={productId}
          onSave={handleSaveGroup}
        />
      </div>
  )
}
