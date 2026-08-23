"use client"

import * as React from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useCurrentUserId } from '@open-mercato/ui/backend/utils/useCurrentUserId'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TASK_COMMENT_PLAINTEXT_MAX_LENGTH } from '../data/types'
import { RichTextEditor, RichTextView, type RichTextValue } from './RichText'
import { CARD_CAPTION_CLASS, ErrorState, SkeletonBlock, UserAvatar } from './ui-bits'
import { formatEditedAt, formatTaskDateTime } from './format'
import { useCommentMutations, useTaskComments, useTaskError } from './hooks'

/** Discussion on a task. Authors may edit or delete their own comments; doing
 *  so to anyone else's is a separate grant the server enforces. */
export function CommentsThread({ taskId }: { taskId: string }) {
  const t = useT()
  const currentUserId = useCurrentUserId()
  const { comments, total, isLoading, error, retry } = useTaskComments(taskId)
  const errorMessage = useTaskError(error, t('tasks.common.loadFailed', "This didn't load"))
  const { create, update, remove } = useCommentMutations(taskId)

  const [draft, setDraft] = React.useState<RichTextValue>({ html: '', text: '' })
  const [editingId, setEditingId] = React.useState<string | null>(null)

  const canPost = draft.text.trim().length > 0 && !create.isPending

  const post = async (value: RichTextValue = draft) => {
    if (value.text.trim() === '' || create.isPending) return
    try {
      await create.mutateAsync({ body: value.html, plaintext: value.text })
      setDraft({ html: '', text: '' })
    } catch {
      flash(t('tasks.comments.postFailed', 'Could not post the comment.'), 'error')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className={`shrink-0 ${CARD_CAPTION_CLASS}`}>
        {total > 0
          ? t('tasks.panel.commentsCount', 'Comments ({count})', { count: total })
          : t('tasks.panel.comments', 'Comments')}
      </h3>

      <div className="shrink-0 space-y-2">
        <RichTextEditor
          value={draft.html}
          onChange={setDraft}
          onSubmit={(value) => void post(value)}
          placeholder={t('tasks.comments.placeholder', 'Leave a comment…')}
          minRows={3}
        />
        <div className="flex items-center justify-end gap-2">
          <Button type="button" size="sm" onClick={() => void post()} disabled={!canPost}>
            {t('tasks.comments.post', 'Comment')}
          </Button>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        {errorMessage ? (
          <ErrorState message={errorMessage} onRetry={retry} />
        ) : isLoading ? (
          <SkeletonBlock className="h-16" />
        ) : comments.length === 0 ? (
          <EmptyState
            variant="subtle"
            title={t('tasks.comments.empty', 'No comments yet')}
            description={t('tasks.comments.emptyHint', 'Use the box above to leave the first note on this task.')}
          />
        ) : (
          <ul className="space-y-4">
            {comments.map((comment) => {
              const isAuthor = !!currentUserId && comment.author?.id === currentUserId
              const editing = editingId === comment.id
              return (
                <li key={comment.id} className="flex gap-3">
                  <UserAvatar name={comment.author?.name ?? null} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {comment.author?.name ?? t('tasks.comments.deletedUser', 'Deleted user')}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatTaskDateTime(comment.createdAt)}
                        {comment.isEdited
                          ? ` · ${formatEditedAt(t, comment.createdAt, comment.updatedAt)}`
                          : ''}
                      </span>
                      {isAuthor && !editing && (
                        <span className="ml-auto flex items-center gap-1">
                          <IconButton
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={t('tasks.comments.edit', 'Edit comment')}
                            onClick={() => setEditingId(comment.id)}
                          >
                            <Pencil className="size-3.5" aria-hidden="true" />
                          </IconButton>
                          <IconButton
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={t('tasks.comments.delete', 'Delete comment')}
                            className="text-destructive"
                            onClick={() =>
                              remove.mutate(
                                { id: comment.id, updatedAt: comment.updatedAt },
                                {
                                  onError: () =>
                                    flash(
                                      t('tasks.comments.deleteFailed', 'Could not delete comment.'),
                                      'error',
                                    ),
                                },
                              )
                            }
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </IconButton>
                        </span>
                      )}
                    </div>

                    {editing ? (
                      <CommentEditor
                        initialHtml={comment.body}
                        saving={update.isPending}
                        onCancel={() => setEditingId(null)}
                        onSave={async (next) => {
                          if (next.text.trim() === '') return
                          try {
                            await update.mutateAsync({
                              id: comment.id,
                              body: { body: next.html, plaintext: next.text },
                              updatedAt: comment.updatedAt,
                            })
                            setEditingId(null)
                          } catch {
                            flash(t('tasks.comments.updateFailed', 'Could not update comment.'), 'error')
                          }
                        }}
                      />
                    ) : (
                      <div className="rounded-lg bg-surface-muted px-3 py-2">
                        <RichTextView html={comment.body} />
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function CommentEditor({
  initialHtml,
  onCancel,
  onSave,
  saving,
}: {
  initialHtml: string
  onCancel: () => void
  onSave: (next: RichTextValue) => void
  saving: boolean
}) {
  const t = useT()
  const [draft, setDraft] = React.useState<RichTextValue>({ html: initialHtml, text: '' })

  return (
    <div className="space-y-2">
      <RichTextEditor
        value={initialHtml}
        onChange={setDraft}
        onSubmit={(next) => {
          if (saving || next.text.trim().length === 0) return
          onSave(next)
        }}
        minRows={2}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="2xs" onClick={onCancel} disabled={saving}>
          {t('tasks.common.cancel', 'Cancel')}
        </Button>
        <Button
          type="button"
          size="2xs"
          onClick={() => onSave(draft)}
          disabled={saving || draft.text.trim().length === 0}
        >
          {t('tasks.comments.save', 'Save')}
        </Button>
      </div>
      <p className="text-right text-overline text-muted-foreground">
        {draft.text.trim().length}/{TASK_COMMENT_PLAINTEXT_MAX_LENGTH}
      </p>
    </div>
  )
}
