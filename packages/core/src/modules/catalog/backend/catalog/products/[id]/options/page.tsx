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
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  Tag,
  Clock,
  DollarSign,
  FolderTree,
  Layers,
} from 'lucide-react'
import type { CatalogOptionTreeData } from '@open-mercato/core/modules/catalog/data/types'
import { createLogger } from '@open-mercato/shared/lib/logger'

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
  duration_value: string
  duration_unit: string
  is_addon: boolean
}

// ─── Group Dialog ──────────────────────────────────────────────────────────────

function GroupDialog({
  open,
  onOpenChange,
  initialValues,
  productId,
  parentOptionId,
  onSuccess,
  editId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initialValues?: GroupFormValues
  productId: string
  parentOptionId?: string | null
  onSuccess: () => void
  editId?: string | null
}) {
  const t = useT()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<GroupFormValues>(
    initialValues ?? { name: '', description: '', requirement: 'required', select_mode: 'single' }
  )

  useEffect(() => {
    if (open) {
      setForm(initialValues ?? { name: '', description: '', requirement: 'required', select_mode: 'single' })
    }
  }, [open, initialValues])

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editId) {
        await apiCall(`/api/catalog/option-groups?id=${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editId, name: form.name, description: form.description || null, requirement: form.requirement, selectMode: form.select_mode }),
        })
      } else {
        await apiCall('/api/catalog/option-groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId,
            parentOptionId: parentOptionId ?? null,
            name: form.name,
            description: form.description || null,
            requirement: form.requirement,
            selectMode: form.select_mode,
            sortOrder: 0,
          }),
        })
      }
      onSuccess()
      onOpenChange(false)
    } catch (err) {
      logger.error('group.save.failed', { err })
    } finally {
      setSaving(false)
    }
  }, [form, editId, productId, parentOptionId, onSuccess, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            {editId
              ? t('catalog.options.editGroup', 'Edit Option Group')
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

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !form.name.trim()}>
            {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
          </Button>
        </DialogFooter>
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
  onSuccess,
  editId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initialValues?: OptionFormValues
  groupId: string
  onSuccess: () => void
  editId?: string | null
}) {
  const t = useT()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<OptionFormValues>(
    initialValues ?? { name: '', code: '', description: '', price_flat: '', duration_value: '', duration_unit: 'minute', is_addon: false }
  )

  useEffect(() => {
    if (open) {
      setForm(initialValues ?? { name: '', code: '', description: '', price_flat: '', duration_value: '', duration_unit: 'minute', is_addon: false })
    }
  }, [open, initialValues])

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        code: form.code || null,
        description: form.description || null,
        priceFlat: form.price_flat ? form.price_flat : null,
        durationValue: form.duration_value ? parseInt(form.duration_value) : null,
        durationUnit: form.duration_value ? form.duration_unit : null,
        isAddon: form.is_addon,
        sortOrder: 0,
      }
      if (editId) {
        await apiCall(`/api/catalog/product-options?id=${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editId, ...payload }),
        })
      } else {
        await apiCall('/api/catalog/product-options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId, ...payload }),
        })
      }
      onSuccess()
      onOpenChange(false)
    } catch (err) {
      logger.error('option.save.failed', { err })
    } finally {
      setSaving(false)
    }
  }, [form, editId, groupId, onSuccess, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-primary" />
            {editId
              ? t('catalog.options.editOption', 'Edit Option')
              : t('catalog.options.addOption', 'Add Option')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="opt-name">{t('catalog.options.optionName', 'Name')} *</Label>
              <Input
                id="opt-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Gel Polish"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="opt-code">{t('catalog.options.code', 'Code')}</Label>
              <Input
                id="opt-code"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="gel-polish"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="opt-price">
                <DollarSign className="inline h-3 w-3" /> {t('catalog.options.price', 'Price (+)')}
              </Label>
              <Input
                id="opt-price"
                type="number"
                value={form.price_flat}
                onChange={(e) => setForm((f) => ({ ...f, price_flat: e.target.value }))}
                placeholder="0"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="opt-dur">
                <Clock className="inline h-3 w-3" /> {t('catalog.options.duration', 'Duration')}
              </Label>
              <Input
                id="opt-dur"
                type="number"
                value={form.duration_value}
                onChange={(e) => setForm((f) => ({ ...f, duration_value: e.target.value }))}
                placeholder="30"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="opt-dur-unit">{t('catalog.options.unit', 'Unit')}</Label>
              <select
                id="opt-dur-unit"
                value={form.duration_unit}
                onChange={(e) => setForm((f) => ({ ...f, duration_unit: e.target.value }))}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="minute">minutes</option>
                <option value="hour">hours</option>
              </select>
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

          <div className="flex items-center gap-2">
            <input
              id="opt-addon"
              type="checkbox"
              checked={form.is_addon}
              onChange={(e) => setForm((f) => ({ ...f, is_addon: e.target.checked }))}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="opt-addon" className="cursor-pointer font-normal">
              {t('catalog.options.isAddon', 'This is an add-on (optional extra)')}
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !form.name.trim()}>
            {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
          </Button>
        </DialogFooter>
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
  productId,
  onReload,
}: {
  opt: OptionItem
  allGroups: GroupItem[]
  allOptions: OptionItem[]
  depth: number
  onEdit: (opt: OptionItem) => void
  onDelete: (id: string) => void
  onAddSubGroup: (parentOptionId: string) => void
  productId: string
  onReload: () => void
}) {
  const t = useT()
  const subGroups = allGroups.filter((g: any) => g.parent_option_id === opt.id)
  const [expanded, setExpanded] = useState(true)
  const hasSubGroups = subGroups.length > 0

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

        <span className="font-medium text-sm flex-1">{opt.name}</span>

        {opt.code && (
          <Badge variant="outline" className="text-xs font-mono hidden group-hover/opt:inline-flex">
            {opt.code}
          </Badge>
        )}
        {opt.price_flat && Number(opt.price_flat) > 0 && (
          <Badge variant="secondary" className="text-xs gap-1">
            <DollarSign className="h-2.5 w-2.5" />
            {Number(opt.price_flat).toLocaleString('vi-VN')}đ
          </Badge>
        )}
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
              onReload={onReload}
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
  onReload,
}: {
  group: GroupItem
  allGroups: GroupItem[]
  allOptions: OptionItem[]
  depth: number
  productId: string
  onReload: () => void
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(true)
  const [editGroupOpen, setEditGroupOpen] = useState(false)
  const [addOptionOpen, setAddOptionOpen] = useState(false)
  const [editingOption, setEditingOption] = useState<OptionItem | null>(null)
  const [addSubGroupForOption, setAddSubGroupForOption] = useState<string | null>(null)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const groupOptions = allOptions.filter((o: any) => o.group_id === group.id)

  const handleDeleteGroup = async () => {
    const ok = await confirm({
      title: t('catalog.options.deleteGroup', 'Delete group?'),
      description: `"${group.name}" ${t('catalog.options.deleteGroupDesc', 'and all its options will be permanently removed.')}`,
      confirmText: t('common.delete', 'Delete'),
      variant: 'destructive',
    })
    if (!ok) return
    await apiCall(`/api/catalog/option-groups?id=${group.id}`, { method: 'DELETE' })
    onReload()
  }

  const handleDeleteOption = async (optId: string) => {
    const ok = await confirm({
      title: t('catalog.options.deleteOption', 'Delete option?'),
      description: t('catalog.options.deleteOptionDesc', 'This option will be permanently removed.'),
      confirmText: t('common.delete', 'Delete'),
      variant: 'destructive',
    })
    if (!ok) return
    await apiCall(`/api/catalog/product-options?id=${optId}`, { method: 'DELETE' })
    onReload()
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
            <span className="font-semibold text-sm">{group.name}</span>
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
            onClick={() => setEditGroupOpen(true)}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
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
                  onReload={onReload}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dialogs */}
      {ConfirmDialogElement}

      <GroupDialog
        open={editGroupOpen}
        onOpenChange={setEditGroupOpen}
        editId={group.id}
        productId={productId}
        initialValues={{
          name: group.name,
          description: (group as any).description ?? '',
          requirement: group.requirement as 'required' | 'optional',
          select_mode: group.select_mode as 'single' | 'multiple',
        }}
        onSuccess={onReload}
      />

      <OptionDialog
        open={addOptionOpen}
        onOpenChange={setAddOptionOpen}
        groupId={group.id}
        onSuccess={onReload}
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
            duration_value: String((editingOption as any).duration_value ?? ''),
            duration_unit: (editingOption as any).duration_unit ?? 'minute',
            is_addon: (editingOption as any).is_addon ?? false,
          }}
          onSuccess={onReload}
        />
      )}

      {addSubGroupForOption && (
        <GroupDialog
          open={!!addSubGroupForOption}
          onOpenChange={(v) => { if (!v) setAddSubGroupForOption(null) }}
          productId={productId}
          parentOptionId={addSubGroupForOption}
          onSuccess={onReload}
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
  const [data, setData] = useState<CatalogOptionTreeData | null>(null)
  const [addGroupOpen, setAddGroupOpen] = useState(false)

  const loadData = useCallback(async () => {
    if (!productId) { setLoading(false); return }
    setLoading(true)
    try {
      const result = await readApiResultOrThrow<CatalogOptionTreeData>(
        `/api/catalog/products/${productId}/option-tree`
      )
      setData(result)
    } catch (err) {
      logger.error('options.load.failed', { err })
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => { void loadData() }, [loadData])

  const rootGroups = (data?.groups ?? []).filter((g: any) => !g.parent_option_id)

  return (
    <Page title={t('catalog.options.title', 'Option Tree')}>
      <PageBody>
        <div className="flex flex-col gap-4">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                {rootGroups.length > 0
                  ? `${rootGroups.length} ${t('catalog.options.rootGroups', 'root groups')} · ${data?.options?.length ?? 0} ${t('catalog.options.totalOptions', 'total options')}`
                  : t('catalog.options.emptyHint', 'Add groups to build the option tree for this product.')}
              </p>
            </div>
            <Button onClick={() => setAddGroupOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              {t('catalog.options.addGroup', 'Add Group')}
            </Button>
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          ) : rootGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 border-2 border-dashed rounded-xl text-muted-foreground">
              <Layers className="h-10 w-10 opacity-30" />
              <div className="text-center">
                <p className="font-medium">{t('catalog.options.noGroups', 'No option groups yet')}</p>
                <p className="text-sm mt-1">{t('catalog.options.noGroupsHint', 'Click "Add Group" to build your decision tree')}</p>
              </div>
              <Button variant="outline" onClick={() => setAddGroupOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                {t('catalog.options.addGroup', 'Add Group')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {rootGroups.map((group: GroupItem) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  allGroups={data?.groups ?? []}
                  allOptions={data?.options ?? []}
                  depth={0}
                  productId={productId}
                  onReload={loadData}
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
          onSuccess={loadData}
        />
      </PageBody>
    </Page>
  )
}
