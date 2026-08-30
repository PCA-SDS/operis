"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Save, GitBranch, Settings2 } from 'lucide-react'
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
import { cn } from '@open-mercato/shared/lib/utils'
import type { CatalogOptionTreeData } from '@open-mercato/core/modules/catalog/data/types'
import { OptionTreeEditor, OptionTreeSkeleton } from '@open-mercato/core/modules/catalog/components/products/OptionTreeEditor'

const logger = createLogger('catalog')

type GroupItem = CatalogOptionTreeData['groups'][number]
type OptionItem = CatalogOptionTreeData['options'][number]



export default function ProductOptionsPage({ params }: { params?: { id?: string } }) {
  const productId = params?.id ? String(params.id) : ''
  const t = useT()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadSucceeded, setLoadSucceeded] = useState(false)
  const [treeUpdatedAt, setTreeUpdatedAt] = useState<string | null>(null)
  
  const [localGroups, setLocalGroups] = useState<GroupItem[]>([])
  const [localOptions, setLocalOptions] = useState<OptionItem[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [currencyCode, setCurrencyCode] = useState<string>('USD')

  const loadData = useCallback(async () => {
    if (!productId) return
    setLoading(true)
    setLoadError(null)
    try {
      const result = await readApiResultOrThrow<CatalogOptionTreeData & { currency_code?: string }>(
        `/api/catalog/products/${productId}/option-tree`
      )
      setLocalGroups(result.groups || [])
      setLocalOptions(result.options || [])
      setTreeUpdatedAt(result.updated_at ?? null)
      if (result.currency_code) {
        setCurrencyCode(result.currency_code)
      }
      setIsDirty(false)
      setLoadSucceeded(true)
    } catch (err) {
      logger.error('options.load.failed', { err })
      setTreeUpdatedAt(null)
      setLoadSucceeded(false)
      setLoadError(
        t('catalog.options.loadFailed', 'Failed to load option tree.'),
      )
    } finally {
      setLoading(false)
    }
  }, [productId, t])

  useEffect(() => { void loadData() }, [loadData])

  const { runMutation } = useGuardedMutation({ contextId: 'option-tree' })

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
          await withScopedApiRequestHeaders(buildOptimisticLockHeader(treeUpdatedAt), () =>
            apiCallOrThrow(`/api/catalog/products/${productId}/option-tree`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }),
          )
          flash(t('catalog.options.syncSuccess', 'Option tree updated successfully'), 'success')
          setIsDirty(false)
          await loadData()
        }
      })
    } catch (err) {
      logger.error('options.sync.failed', { err })
      if (surfaceRecordConflict(err, t, { onRefresh: () => { void loadData() } })) return
      flash(t('catalog.options.syncFailed', 'Failed to save option tree'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page title={t('catalog.options.title', 'Option Tree')}>
      <PageBody>
        <div className="flex flex-col gap-4">
          {/* Content */}
          {loading ? (
            <OptionTreeSkeleton />
          ) : loadError ? (
            <ErrorMessage
              label={loadError}
              description={t(
                'catalog.options.loadFailedDescription',
                'The current option tree could not be loaded, so saving is disabled until the load succeeds.',
              )}
            />
          ) : (
            <OptionTreeEditor
              groups={localGroups}
              options={localOptions}
              onChangeGroups={(g) => { setLocalGroups(g); setIsDirty(true) }}
              onChangeOptions={(o) => { setLocalOptions(o); setIsDirty(true) }}
              currencyCode={currencyCode}
              productId={productId}
              headerActions={
                <>
                  {isDirty && (
                    <span className="text-sm font-medium text-status-warning-text mr-2">
                      {t('catalog.options.unsavedChanges', 'You have unsaved changes.')}
                    </span>
                  )}
                  <Button onClick={handleSyncTree} disabled={!isDirty || saving || !loadSucceeded} className="gap-2">
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
