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
import type { CatalogConstraintsData, CatalogOptionTreeData } from '@open-mercato/core/modules/catalog/data/types'
import { ConstraintsEditor, draftToPayload } from '@open-mercato/core/modules/catalog/components/products/ConstraintsEditor'

const logger = createLogger('catalog')

type OptionSummary = { id: string; name: string; groupName: string }

// ── Shared tab bar ──────────────────────────────────────────────────
function ProductSubPageTabs({ productId }: { productId: string }) {
  const pathname = usePathname()
  const t = useT()

  const tabs = [
    {
      href: `/backend/catalog/products/${productId}/options`,
      label: t('catalog.options.tab', 'Options'),
      icon: Settings2,
      match: '/options',
    },
    {
      href: `/backend/catalog/products/${productId}/constraints`,
      label: t('catalog.constraints.tab', 'Constraints'),
      icon: GitBranch,
      match: '/constraints',
    },
  ]

  return (
    <div className="flex gap-1 border-b border-border mb-6 -mt-2">
      {tabs.map((tab) => {
        const active = pathname?.endsWith(tab.match) ?? false
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────
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
  const [pendingPayload, setPendingPayload] = useState<ReturnType<typeof draftToPayload>[]>([])
  const [optionSummaries, setOptionSummaries] = useState<OptionSummary[]>([])

  const loadData = useCallback(async () => {
    if (!productId) return
    setLoading(true)
    setLoadError(null)
    try {
      // Load constraints
      const result = await readApiResultOrThrow<CatalogConstraintsData>(
        `/api/catalog/products/${productId}/constraints`
      )
      setConstraints(result.constraints || [])
      setUpdatedAt(result.updated_at ?? null)
      setIsDirty(false)
      setLoadSucceeded(true)

      // Also load option tree for the option picker
      try {
        const treeResult = await readApiResultOrThrow<CatalogOptionTreeData>(
          `/api/catalog/products/${productId}/option-tree`
        )
        const groups = treeResult.groups ?? []
        const opts: OptionSummary[] = (treeResult.options ?? []).map((o) => {
          const group = groups.find((g) => g.id === o.group_id)
          return { id: o.id, name: o.name, groupName: group?.name ?? '' }
        })
        setOptionSummaries(opts)
      } catch {
        // Non-critical: option picker just won't have suggestions
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
          <ProductSubPageTabs productId={productId} />

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner className="w-6 h-6 text-muted-foreground" />
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
              productId={productId}
              options={optionSummaries}
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
                    {t('common.saveChanges', 'Save Changes')}
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
