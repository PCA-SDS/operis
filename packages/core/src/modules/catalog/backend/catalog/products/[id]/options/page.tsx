"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
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

// ─── Types ────────────────────────────────────────────────────────────────────

type GroupItem = CatalogOptionTreeData['groups'][number]
type OptionItem = CatalogOptionTreeData['options'][number]

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
  duration_unit: string
  is_addon: boolean
}

// ─── Group Dialog ──────────────────────────────────────────────────────────────

function OptionTreeSkeleton() {
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
        <form onSubmit={(e) => { e.preventDefault(); handleSave() }}>
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
                    onClick={() => setForm((f) => ({ ...f, requirement: val }))}
                    className={`flex-1 py-1.5 text-sm transition-colors ${
                      form.requirement === val
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    {val === 'required'
                      ? t('catalog.options.required', 'Required')
                      : t('catalog.options.optional', 'Optional')}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t('catalog.options.selectMode', 'Selection')}</Label>
              <div className="flex rounded-md border overflow-hidden">
                {(['single', 'multiple'] as const).map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, select_mode: val }))}
                    className={`flex-1 py-1.5 text-sm transition-colors ${
                      form.select_mode === val
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    {val === 'single'
                      ? t('catalog.options.single', 'Single')
                      : t('catalog.options.multiple', 'Multiple')}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="submit" disabled={!form.name.trim()}>
            {t('common.save', 'Save')}
          </Button>
        </DialogFooter>
        </form>
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
    initialValues ?? { name: '', code: '', description: '', price_flat: '', price_min: '', price_max: '', duration_value: '', duration_unit: 'minute', is_addon: false }
  )

  useEffect(() => {
    if (open) {
      setForm(initialValues ?? { name: '', code: '', description: '', price_flat: '', price_min: '', price_max: '', duration_value: '', duration_unit: 'minute', is_addon: false })
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
      price_flat: form.price_flat ? form.price_flat : null,
      price_min: form.price_min ? form.price_min : null,
      price_max: form.price_max ? form.price_max : null,
      duration_value: form.duration_value ? parseInt(form.duration_value) : null,
      duration_unit: form.duration_value ? form.duration_unit : null,
      is_addon: form.is_addon,
      sort_order: 0,
      is_active: true,
      metadata: null,
      note: null,
      unit: null,
      duration_min: null,
      duration_max: null,
    } as OptionItem)
    onOpenChange(false)
  }, [form, editId, groupId, onSave, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={(e) => { e.preventDefault(); handleSave() }}>
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
                placeholder="e.g. Gel Polish"
                autoFocus
              />
            </div>

            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label htmlFor="opt-code">{t('catalog.options.code', 'Code')}</Label>
              <Input
                id="opt-code"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="gel-polish"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                {t('catalog.options.codeHint', 'Optional identifier for integrations')}
              </p>
            </div>

            <div className="space-y-1.5 col-span-2">
              <Label>
                <Banknote className="inline h-3 w-3 text-muted-foreground mr-1" />
                {t('catalog.options.price', 'Price')}
              </Label>
              <div className="grid grid-cols-3 gap-2">
                <Input
                  id="opt-price-flat"
                  type="number"
                  value={form.price_flat}
                  onChange={(e) => setForm((f) => ({ ...f, price_flat: e.target.value }))}
                  placeholder="Fixed"
                  title="Fixed Price"
                />
                <Input
                  id="opt-price-min"
                  type="number"
                  value={form.price_min}
                  onChange={(e) => setForm((f) => ({ ...f, price_min: e.target.value }))}
                  placeholder="Min"
                  title="Min Range"
                />
                <Input
                  id="opt-price-max"
                  type="number"
                  value={form.price_max}
                  onChange={(e) => setForm((f) => ({ ...f, price_max: e.target.value }))}
                  placeholder="Max"
                  title="Max Range"
                />
              </div>
            </div>

            <div className="space-y-1.5 col-span-2">
              <Label>
                <Clock className="inline h-3 w-3 text-muted-foreground mr-1" />
                {t('catalog.options.duration', 'Duration')}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="opt-dur"
                  type="number"
                  value={form.duration_value}
                  onChange={(e) => setForm((f) => ({ ...f, duration_value: e.target.value }))}
                  placeholder="30"
                  className="w-16"
                />
                <div className="flex-1">
                  <Select
                    value={form.duration_unit}
                    onValueChange={(val) => setForm((f) => ({ ...f, duration_unit: val }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minute">minutes</SelectItem>
                      <SelectItem value="hour">hours</SelectItem>
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
          <Button type="submit" disabled={!form.name.trim()}>
            {t('common.save', 'Save')}
          </Button>
        </DialogFooter>
        </form>
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
}) {
  const t = useT()
  const subGroups = allGroups.filter((g: any) => g.parent_option_id === opt.id)
  const [expanded, setExpanded] = useState(true)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editNameValue, setEditNameValue] = useState(opt.name)
  const hasSubGroups = subGroups.length > 0

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
    <div className="group/opt">
      <div className="flex items-center gap-2 py-2 px-3 rounded-md hover:bg-muted/40 transition-colors">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />

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
        {(opt.price_min && opt.price_max && Number(opt.price_max) > 0) ? (
          <Badge variant="secondary" className="text-xs gap-1">
            <Banknote className="h-2.5 w-2.5" />
            {Number(opt.price_min).toLocaleString('vi-VN')}đ – {Number(opt.price_max).toLocaleString('vi-VN')}đ
          </Badge>
        ) : (opt.price_flat && Number(opt.price_flat) > 0) ? (
          <Badge variant="secondary" className="text-xs gap-1">
            <Banknote className="h-2.5 w-2.5" />
            {Number(opt.price_flat).toLocaleString('vi-VN')}đ
          </Badge>
        ) : null}
        {opt.duration_value && (
          <Badge variant="secondary" className="text-xs gap-1">
            <Clock className="h-2.5 w-2.5" />
            {opt.duration_value}{opt.duration_unit === 'minute' ? 'p' : 'h'}
          </Badge>
        )}

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
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(true)
  const [addOptionOpen, setAddOptionOpen] = useState(false)
  const [editingOption, setEditingOption] = useState<OptionItem | null>(null)
  const [addSubGroupForOption, setAddSubGroupForOption] = useState<string | null>(null)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editNameValue, setEditNameValue] = useState(group.name)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const groupOptions = allOptions.filter((o: any) => o.group_id === group.id)

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
                />
              ))}
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
          initialValues={{
            name: editingOption.name ?? '',
            code: (editingOption as any).code ?? '',
            description: (editingOption as any).description ?? '',
            price_flat: (editingOption as any).price_flat ?? '',
            price_min: (editingOption as any).price_min ?? '',
            price_max: (editingOption as any).price_max ?? '',
            duration_value: String((editingOption as any).duration_value ?? ''),
            duration_unit: (editingOption as any).duration_unit ?? 'minute',
            is_addon: (editingOption as any).is_addon ?? false,
          }}
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

export default function ProductOptionsPage({
  params,
}: {
  params?: { id?: string }
}) {
  const productId = params?.id ? String(params.id) : ''
  const t = useT()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  // Local state for atomic sync
  const [localGroups, setLocalGroups] = useState<GroupItem[]>([])
  const [localOptions, setLocalOptions] = useState<OptionItem[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [addGroupOpen, setAddGroupOpen] = useState(false)

  const loadData = useCallback(async () => {
    if (!productId) { setLoading(false); return }
    setLoading(true)
    try {
      const result = await readApiResultOrThrow<CatalogOptionTreeData>(
        `/api/catalog/products/${productId}/option-tree`
      )
      setLocalGroups(result.groups || [])
      setLocalOptions(result.options || [])
      setIsDirty(false)
    } catch (err) {
      logger.error('options.load.failed', { err })
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => { void loadData() }, [loadData])

  // Handlers for updating local state tree
  const handleSaveGroup = (group: GroupItem) => {
    setLocalGroups(prev => {
      const idx = prev.findIndex(g => g.id === group.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = group
        return next
      }
      return [...prev, group]
    })
    setIsDirty(true)
  }

  const handleDeleteGroup = (id: string) => {
    // Delete group and all nested groups/options recursively
    const idsToDelete = new Set<string>([id])
    
    // Find all subgroups recursively
    let added = true
    while (added) {
      added = false
      for (const g of localGroups) {
        if (g.parent_option_id && !idsToDelete.has(g.id)) {
          // If the group's parent option belongs to a group we are deleting
          const parentOption = localOptions.find(o => o.id === g.parent_option_id)
          if (parentOption && idsToDelete.has(parentOption.group_id)) {
            idsToDelete.add(g.id)
            added = true
          }
        }
      }
    }

    setLocalGroups(prev => prev.filter(g => !idsToDelete.has(g.id)))
    setLocalOptions(prev => prev.filter(o => !idsToDelete.has(o.group_id)))
    setIsDirty(true)
  }

  const handleSaveOption = (option: OptionItem) => {
    setLocalOptions(prev => {
      const idx = prev.findIndex(o => o.id === option.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = option
        return next
      }
      return [...prev, option]
    })
    setIsDirty(true)
  }

  const handleDeleteOption = (id: string) => {
    setLocalOptions(prev => prev.filter(o => o.id !== id))
    // Also delete any sub-groups attached to this option
    const idsToDelete = new Set<string>()
    let added = true
    while (added) {
      added = false
      for (const g of localGroups) {
        if (g.parent_option_id === id || (g.parent_option_id && !idsToDelete.has(g.id))) {
           const parentOption = localOptions.find(o => o.id === g.parent_option_id)
           if (parentOption && (parentOption.id === id || idsToDelete.has(parentOption.group_id))) {
             idsToDelete.add(g.id)
             added = true
           }
        }
      }
    }
    if (idsToDelete.size > 0) {
      setLocalGroups(prev => prev.filter(g => !idsToDelete.has(g.id)))
      setLocalOptions(prev => prev.filter(o => o.id !== id && !idsToDelete.has(o.group_id)))
    }
    setIsDirty(true)
  }

  const { runMutation } = useGuardedMutation({ contextId: 'option-tree' })

  // Handle Atomic Sync
  const handleSyncTree = async () => {
    if (!productId || !isDirty) return
    setSaving(true)
    try {
      const payload = {
        groups: localGroups.map(g => ({
          id: g.id,
          name: g.name,
          description: g.description,
          requirement: g.requirement,
          selectMode: g.select_mode,
          sortOrder: g.sort_order,
          isActive: g.is_active,
          parentOptionId: g.parent_option_id,
          metadata: g.metadata,
        })),
        options: localOptions.map(o => ({
          id: o.id,
          groupId: o.group_id,
          name: o.name,
          code: o.code,
          description: o.description,
          priceFlat: o.price_flat,
          priceMin: o.price_min,
          priceMax: o.price_max,
          durationValue: o.duration_value,
          durationUnit: o.duration_unit,
          durationMin: o.duration_min,
          durationMax: o.duration_max,
          isAddon: o.is_addon,
          sortOrder: o.sort_order,
          isActive: o.is_active,
          metadata: o.metadata,
          note: o.note,
          unit: o.unit,
        }))
      }

      await runMutation({
        context: { productId },
        operation: async () => {
          await apiCall(`/api/catalog/products/${productId}/option-tree`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          flash(t('catalog.options.syncSuccess', 'Option tree updated successfully'), 'success')
          setIsDirty(false)
          loadData()
        }
      })
    } catch (err) {
      logger.error('options.sync.failed', { err })
      flash(t('catalog.options.syncFailed', 'Failed to save option tree'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const rootGroups = localGroups.filter(g => !g.parent_option_id)

  return (
    <Page title={t('catalog.options.title', 'Option Tree')}>
      <PageBody>
        <div className="flex flex-col gap-4">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                {rootGroups.length > 0
                  ? `${rootGroups.length} ${t('catalog.options.rootGroups', 'root groups')} · ${localOptions.length} ${t('catalog.options.totalOptions', 'total options')}`
                  : t('catalog.options.emptyHint', 'Add groups to build the option tree for this product.')}
              </p>
              {isDirty && (
                <p className="text-sm text-yellow-600 dark:text-yellow-500 font-medium mt-1">
                  {t('catalog.options.unsavedChanges', 'You have unsaved changes.')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => setAddGroupOpen(true)} variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />
                {t('catalog.options.addGroup', 'Add Group')}
              </Button>
              <Button onClick={handleSyncTree} disabled={!isDirty || saving} className="gap-2">
                {saving ? <Spinner className="w-4 h-4 mr-1" /> : <Save className="h-4 w-4" />}
                {t('common.saveChanges', 'Save Changes')}
              </Button>
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <OptionTreeSkeleton />
          ) : rootGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 border-2 border-dashed rounded-xl bg-card text-muted-foreground shadow-sm">
              <div className="p-4 rounded-full bg-primary/10">
                <FolderTree className="h-12 w-12 text-primary/80" />
              </div>
              <div className="text-center max-w-sm">
                <h3 className="font-semibold text-lg text-foreground">{t('catalog.options.noGroups', 'No options configured yet')}</h3>
                <p className="text-sm mt-1">{t('catalog.options.noGroupsHint', 'Add option groups to let customers choose service variants.')}</p>
              </div>
              <Button onClick={() => setAddGroupOpen(true)} className="gap-2 mt-2">
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
      </PageBody>
    </Page>
  )
}
