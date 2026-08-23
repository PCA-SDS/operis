"use client"

import * as React from 'react'
import { FileText, Plus, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ProjectDocTreeItemDto } from '../data/types'
import { RichTextEditor, type RichTextValue } from './RichText'
import {
  CARD_CAPTION_CLASS,
  CARD_CLASS,
  CARD_HEADER_CLASS,
  ErrorState,
  SkeletonBlock,
  TitleInput,
} from './ui-bits'
import { formatTaskDate } from './format'
import { useDoc, useDocMutations, useDocTree, useTaskError } from './hooks'

type TreeNode = ProjectDocTreeItemDto & { children: TreeNode[] }

function buildTree(items: ProjectDocTreeItemDto[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  for (const item of items) byId.set(item.id, { ...item, children: [] })

  const roots: TreeNode[] = []
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.children.push(node)
    else roots.push(node)
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.position - b.position)
    nodes.forEach((node) => sort(node.children))
  }
  sort(roots)
  return roots
}

/** Project documentation: a page tree on the left, one page open on the right. */
export function DocsTab({ projectId }: { projectId: string }) {
  const t = useT()
  const { tree, isLoading, error, retry } = useDocTree(projectId)
  const errorMessage = useTaskError(error, t('tasks.common.loadFailed', "This didn't load"))
  const { create, update, remove } = useDocMutations(projectId)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  const nodes = React.useMemo(() => buildTree(tree), [tree])

  // Keep a page selected as the tree changes — deleting the open page should
  // land on another, not on a blank panel.
  React.useEffect(() => {
    if (tree.length === 0) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !tree.some((item) => item.id === selectedId)) setSelectedId(tree[0]!.id)
  }, [tree, selectedId])

  const addPage = async (parentId: string | null) => {
    try {
      const doc = await create.mutateAsync({
        title: t('tasks.docs.untitled', 'Untitled page'),
        parentId,
      })
      setSelectedId(doc.id)
    } catch {
      flash(t('tasks.docs.createFailed', 'Could not create the page.'), 'error')
    }
  }

  if (errorMessage) return <ErrorState message={errorMessage} onRetry={retry} size="lg" />
  if (isLoading) return <SkeletonBlock className="h-72" />

  if (tree.length === 0) {
    return (
      <EmptyState
        size="lg"
        variant="subtle"
        title={t('tasks.docs.empty', 'No documents yet')}
        description={t(
          'tasks.docs.emptyHint',
          'Write specs, notes, and knowledge pages alongside your project.',
        )}
        actions={
          <Button type="button" size="sm" onClick={() => void addPage(null)} disabled={create.isPending}>
            <Plus className="size-4" aria-hidden="true" />
            {t('tasks.docs.newPage', 'New page')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <aside className={cn(CARD_CLASS, 'self-start')}>
        <div className={CARD_HEADER_CLASS}>
          <span className={`flex-1 ${CARD_CAPTION_CLASS}`}>{t('tasks.docs.pages', 'Pages')}</span>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('tasks.docs.newPage', 'New page')}
            disabled={create.isPending}
            onClick={() => void addPage(null)}
          >
            <Plus className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
        <nav className="space-y-0.5 p-2">
          {nodes.map((node) => (
            <DocTreeNode
              key={node.id}
              node={node}
              depth={0}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onAddChild={(parentId) => void addPage(parentId)}
            />
          ))}
        </nav>
      </aside>

      {selectedId ? (
        <DocEditor
          key={selectedId}
          docId={selectedId}
          saving={update.isPending}
          deleting={remove.isPending}
          onSave={(title, body, plaintext, updatedAt) =>
            update.mutate(
              { id: selectedId, body: { title, body, plaintext }, updatedAt },
              {
                onSuccess: () => flash(t('tasks.docs.saved', 'Page saved.'), 'success'),
                onError: () => flash(t('tasks.docs.saveFailed', 'Could not save the page.'), 'error'),
              },
            )
          }
          onDelete={(updatedAt) =>
            remove.mutate(
              { id: selectedId, updatedAt },
              {
                onSuccess: () => flash(t('tasks.docs.deleted', 'Page deleted.'), 'success'),
                onError: () => flash(t('tasks.docs.deleteFailed', 'Could not delete the page.'), 'error'),
              },
            )
          }
        />
      ) : null}
    </div>
  )
}

function DocTreeNode({
  node,
  depth,
  selectedId,
  onSelect,
  onAddChild,
}: {
  node: TreeNode
  depth: number
  selectedId: string | null
  onSelect: (id: string) => void
  onAddChild: (parentId: string) => void
}) {
  const t = useT()
  const selected = selectedId === node.id
  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md pr-1',
          selected ? 'bg-primary-soft' : 'hover:bg-surface-muted',
        )}
        style={{ paddingLeft: `${depth * 0.75 + 0.25}rem` }}
      >
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-sm focus:outline-none focus-visible:shadow-focus',
            selected ? 'font-medium text-primary' : 'text-foreground',
          )}
        >
          <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{node.title}</span>
        </button>
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('tasks.docs.addUnder', 'Add a page under {title}', { title: node.title })}
          onClick={() => onAddChild(node.id)}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </IconButton>
      </div>
      {node.children.map((child) => (
        <DocTreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          onAddChild={onAddChild}
        />
      ))}
    </div>
  )
}

function DocEditor({
  docId,
  onSave,
  onDelete,
  saving,
  deleting,
}: {
  docId: string
  onSave: (title: string, body: string, plaintext: string, updatedAt: string) => void
  onDelete: (updatedAt: string) => void
  saving: boolean
  deleting: boolean
}) {
  const t = useT()
  const { doc, isLoading, error, retry } = useDoc(docId)
  const errorMessage = useTaskError(error, t('tasks.common.loadFailed', "This didn't load"))
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState<RichTextValue>({ html: '', text: '' })
  const [hydrated, setHydrated] = React.useState(false)

  React.useEffect(() => {
    if (!doc || hydrated) return
    setTitle(doc.title)
    setBody({ html: doc.body, text: doc.plaintext })
    setHydrated(true)
  }, [doc, hydrated])

  if (errorMessage) return <ErrorState message={errorMessage} onRetry={retry} />
  if (isLoading || !doc) return <SkeletonBlock className="h-72" />

  const confirmDelete = async () => {
    const ok = await confirm({
      title: t('tasks.docs.deleteTitle', 'Delete page?'),
      description: t('tasks.docs.deleteBody', 'Sub-pages are kept and moved up a level.'),
      confirmText: t('tasks.common.delete', 'Delete'),
      variant: 'destructive',
    })
    if (ok) onDelete(doc.updatedAt)
  }

  return (
    <div className={`${CARD_CLASS} space-y-3 p-4 sm:p-5`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <TitleInput
            size="lg"
            value={title}
            onChange={setTitle}
            placeholder={t('tasks.docs.titlePlaceholder', 'Page title')}
            ariaLabel={t('tasks.docs.titlePlaceholder', 'Page title')}
          />
        </div>
        <IconButton
          type="button"
          variant="ghost"
          size="default"
          className="text-destructive"
          aria-label={t('tasks.docs.deleteLabel', 'Delete page')}
          disabled={deleting}
          onClick={() => void confirmDelete()}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </IconButton>
      </div>

      <p className="text-xs text-muted-foreground">
        {doc.author?.name ? `${doc.author.name} · ` : ''}
        {t('tasks.docs.updatedAt', 'Updated {date}', { date: formatTaskDate(doc.updatedAt) })}
      </p>

      <RichTextEditor
        value={doc.body}
        onChange={setBody}
        variant="standard"
        minRows={10}
        placeholder={t('tasks.docs.bodyPlaceholder', 'Start writing…')}
      />

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={saving}
          onClick={() =>
            onSave(
              title.trim() || t('tasks.docs.untitled', 'Untitled page'),
              body.html,
              body.text,
              doc.updatedAt,
            )
          }
        >
          {t('tasks.docs.save', 'Save page')}
        </Button>
      </div>

      {ConfirmDialogElement}
    </div>
  )
}
