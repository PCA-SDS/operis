"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Save } from 'lucide-react'
import {
  apiCallOrThrow,
  readApiResultOrThrow,
  withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import type { CatalogConstraintsData, CatalogOptionTreeData, CatalogOptionGroupItem, CatalogOptionItem } from '@open-mercato/core/modules/catalog/data/types'
import type { ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { ConstraintsEditor, draftToPayload, type LocalOptionSummary } from '@open-mercato/core/modules/catalog/components/products/ConstraintsEditor'
import type { CascadingItemDef } from '@open-mercato/core/modules/catalog/components/products/CascadingCombobox'

const logger = createLogger('catalog')

export type OptionSummary = {
  id: string
  name: string
  groupId: string
  groupName: string
  path: string
  parentOptionId?: string | null
}

// ─────────────────────────────────────────────────────────────────
// Build full hierarchy path for each option
// ─────────────────────────────────────────────────────────────────
function buildOptionSummaries(
  groups: CatalogOptionGroupItem[],
  options: CatalogOptionItem[],
): LocalOptionSummary[] {
  const optionNameMap = new Map<string, string>()
  for (const o of options) optionNameMap.set(o.id, o.name)

  const groupMap = new Map<string, CatalogOptionGroupItem>()
  for (const g of groups) groupMap.set(g.id, g)

  const childOf = new Map<string, string>()
  for (const g of groups) {
    if (!g.parent_option_id) continue
    for (const parentGroup of groups) {
      const optsInParent = options.filter((o) => o.group_id === parentGroup.id)
      if (optsInParent.some((o) => o.id === g.parent_option_id)) {
        childOf.set(g.id, parentGroup.id)
        break
      }
    }
  }

  const result: LocalOptionSummary[] = []

  for (const o of options) {
    const group = groupMap.get(o.group_id)
    if (!group) continue

    const pathParts: string[] = []
    let currentGroupId: string | undefined = group.id

    while (currentGroupId) {
      const currentGroup = groupMap.get(currentGroupId)
      if (!currentGroup) break

      pathParts.unshift(currentGroup.name)

      if (currentGroup.parent_option_id) {
        const parentOptName = optionNameMap.get(currentGroup.parent_option_id)
        if (parentOptName) pathParts.unshift(parentOptName)
      }

      currentGroupId = childOf.get(currentGroupId)
    }

    const path = pathParts.join(' > ')
    result.push({ 
      id: o.id, 
      name: o.name, 
      groupId: group.id, 
      groupName: group.name, 
      path,
      parentOptionId: group.parent_option_id
    })
  }

  return result
}

export default function ProductConstraintsPage({ params }: { params?: { id?: string } }) {
  const productId = params?.id ? String(params.id) : ''
  const t = useT()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadSucceeded, setLoadSucceeded] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  const [constraints, setConstraints] = useState<CatalogConstraintsData['constraints']>([])
  const [incomingConstraints, setIncomingConstraints] = useState<CatalogConstraintsData['constraints']>([])
  const [pendingPayload, setPendingPayload] = useState<ReturnType<typeof draftToPayload>[]>([])
  const [optionSummaries, setOptionSummaries] = useState<LocalOptionSummary[]>([])
  const [productSeedOptions, setProductSeedOptions] = useState<CascadingItemDef[]>([])
  const [productName, setProductName] = useState<string>('')

  const loadData = useCallback(async () => {
    if (!productId) return
    setLoading(true)
    setLoadError(null)
    try {
      const result = await readApiResultOrThrow<CatalogConstraintsData>(
        `/api/catalog/products/${productId}/constraints?incoming=true`
      )
      setConstraints(result.constraints || [])
      setIncomingConstraints(result.incoming_constraints || [])
      setUpdatedAt(result.updated_at ?? null)
      setProductName(result.product_name ?? 'This product')
      setIsDirty(false)
      setLoadSucceeded(true)

      // Load option tree
      try {
        const treeResult = await readApiResultOrThrow<CatalogOptionTreeData>(
          `/api/catalog/products/${productId}/option-tree`
        )
        const groups = treeResult.groups ?? []
        const opts = treeResult.options ?? []
        setOptionSummaries(buildOptionSummaries(groups, opts))
      } catch {
        // non-critical
      }

      // Load products — as cascading tree items
      try {
        const productsResult = await readApiResultOrThrow<{ items: { id: string; title?: string; name?: string }[] }>(
          `/api/catalog/products?limit=100`
        )
        const opts: CascadingItemDef[] = (productsResult.items ?? [])
          .filter((p) => p.id !== productId) // exclude current product
          .map((p) => ({
            id: p.id,
            label: (p as { title?: string; name?: string }).title ?? (p as { name?: string }).name ?? p.id,
          }))
        setProductSeedOptions(opts)
      } catch {
        // non-critical
      }
    } catch (err) {
      logger.error('constraints.load.failed', { err })
      setUpdatedAt(null)
      setLoadSucceeded(false)
      setLoadError(t('catalog.constraints.loadFailed', 'Failed to load constraints.'))
    } finally {
      setLoading(false)
    }
  }, [productId, t])

  useEffect(() => { void loadData() }, [loadData])

  const { runMutation } = useGuardedMutation({ contextId: 'constraints' })

  const handleSave = async () => {
    if (!productId || !isDirty) return
    setSaving(true)
    try {
      await runMutation({
        context: { productId },
        operation: async () => {
          await withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), () =>
            apiCallOrThrow(`/api/catalog/products/${productId}/constraints`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ constraints: pendingPayload }),
            })
          )
          flash(t('catalog.constraints.saveSuccess', 'Constraints saved successfully'), 'success')
          setIsDirty(false)
          await loadData()
        },
      })
    } catch (err) {
      logger.error('constraints.save.failed', { err })
      if (surfaceRecordConflict(err, t, { onRefresh: () => { void loadData() } })) return
      flash(t('catalog.constraints.saveFailed', 'Failed to save constraints'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page title={t('catalog.constraints.title', 'Constraints')}>
      <PageBody>
        <div className="flex flex-col gap-4">
          {loading ? (
            <div className="flex flex-col gap-4">
              {/* Header skeleton */}
              <div className="flex items-start justify-between shrink-0">
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-4 w-72" />
                </div>
                <Skeleton className="h-9 w-36 rounded-md" />
              </div>
              {/* Constraint rows skeleton */}
              <div className="flex flex-col gap-2">
                {[1, 2].map((i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 p-3 rounded-lg border bg-card">
                    <Skeleton className="h-5 w-24 rounded-full" />
                    <Skeleton className="h-5 w-40 rounded-md" />
                    <Skeleton className="h-4 w-4 shrink-0" />
                    <Skeleton className="h-5 w-40 rounded-md" />
                    <div className="ml-auto flex items-center gap-2 shrink-0">
                      <Skeleton className="h-8 w-8 rounded-md" />
                      <Skeleton className="h-8 w-8 rounded-md" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : loadError ? (
            <ErrorMessage
              label={loadError}
              description={t(
                'catalog.constraints.loadFailedDescription',
                'Constraints could not be loaded. Saving is disabled until the load succeeds.',
              )}
            />
          ) : (
            <ConstraintsEditor
              constraints={constraints}
              incomingConstraints={incomingConstraints}
              productId={productId}
              productName={productName}
              options={optionSummaries}
              productSeedOptions={productSeedOptions}
              onChange={(payload) => {
                setPendingPayload(payload)
                setIsDirty(true)
              }}
              headerActions={
                <>
                  {isDirty && (
                    <span className="text-sm font-medium text-status-warning-text mr-2">
                      {t('catalog.options.unsavedChanges', 'You have unsaved changes.')}
                    </span>
                  )}
                  <Button
                    onClick={handleSave}
                    disabled={!isDirty || saving || !loadSucceeded}
                    className="gap-2"
                  >
                    {saving ? <Spinner className="w-4 h-4 mr-1" /> : <Save className="h-4 w-4" />}
                    {t('catalog.actions.saveChanges', 'Save Changes')}
                  </Button>
                </>
              }
            />
          )}
        </div>
      </PageBody>
    </Page>
  )
}
