"use client"

import * as React from 'react'
import { uploadAttachmentsForChat, type UploadFailureReason } from '@open-mercato/ui/ai/upload-adapter'
import { chatApi } from './api'
import type { ChatAttachmentDto } from '../data/types'

/**
 * Files staged for the message being written.
 *
 * The upload itself is the shared adapter the AI composer already uses —
 * concurrency, per-file timeouts, abort and typed failure reasons are all
 * solved there, and a second uploader in chat would be the same problems solved
 * again slightly differently. What this owns is the part that is chat's: which
 * conversation the files belong to, and what the composer shows while they land.
 */

export type ChatDraftAttachment = {
  /** Stable for the life of the row in the composer, so React keys never move. */
  key: string
  fileName: string
  fileSize: number
  mimeType: string
  status: 'uploading' | 'ready' | 'error'
  /** 0-1 while uploading. */
  progress: number
  /** Present once the server has the file; this is what a send names. */
  attachmentId?: string
  /** Present when it failed, so the row can say why and offer a retry. */
  failure?: { reason: UploadFailureReason; message: string }
  /** Kept so a retry does not make the reader find the file again (§28). */
  file: File
  /** Object URL for an image thumbnail, revoked when the row goes away. */
  previewUrl?: string
}

const IMAGE_PREVIEW_PREFIX = 'image/'

function makeKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

export function useChatAttachments(conversationId: string | undefined) {
  const [items, setItems] = React.useState<ChatDraftAttachment[]>([])
  // One controller per staged file, so a single row can be cancelled without
  // taking the rest of the batch with it (§27).
  const controllers = React.useRef(new Map<string, AbortController>())

  /**
   * A conversation switch must not carry its files across (§79).
   *
   * Anything still uploading is aborted rather than left running: it would land
   * against the conversation it was started in, which is correct, but the
   * composer it belongs to is gone and nothing would ever send it.
   */
  React.useEffect(() => {
    return () => {
      for (const controller of controllers.current.values()) controller.abort()
      controllers.current.clear()
      setItems((current) => {
        for (const item of current) {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
        }
        return []
      })
    }
  }, [conversationId])

  const update = React.useCallback((key: string, patch: Partial<ChatDraftAttachment>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }, [])

  /**
   * Upload straight to storage when the deployment can offer it.
   *
   * Returns `false` when it cannot, so the caller falls back to posting through
   * our own endpoint. That fallback is not a degraded path — it is the one
   * development uses, because the local driver has nowhere to point a signed
   * URL, and both must behave identically from here.
   */
  const sendDirect = React.useCallback(
    async (key: string, file: File, signal: AbortSignal): Promise<boolean> => {
      if (!conversationId) return false

      const offer = await chatApi.requestDirectUpload(
        conversationId,
        {
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          contentLength: file.size,
        },
        signal,
      )
      if (offer.supported !== true) return false

      // The one raw request in the module, and it has to be: this goes to the
      // object store, not to Operis. There is no record version to carry and no
      // API envelope to unwrap — the signature covers the key, the type and the
      // length, so the browser has nothing here it could usefully change.
      // optimistic-lock-exempt: uploads bytes to signed object storage, not an Operis record.
      const put = await fetch(offer.url, {
        method: 'PUT',
        headers: offer.headers,
        body: file,
        signal,
      })
      if (!put.ok) return false

      const finalized = await chatApi.finalizeDirectUpload(conversationId, { uploadId: offer.uploadId }, signal)
      if (!finalized.item?.id) return false

      update(key, { status: 'ready', progress: 1, attachmentId: finalized.item.id })
      return true
    },
    [conversationId, update],
  )

  const send = React.useCallback(
    async (key: string, file: File) => {
      if (!conversationId) return
      const controller = new AbortController()
      controllers.current.set(key, controller)

      // Tried first, because a large file has no business travelling through
      // the application server. Any failure falls through to the endpoint that
      // does accept bytes, so a store that cannot presign is not a dead end.
      try {
        if (await sendDirect(key, file, controller.signal)) {
          controllers.current.delete(key)
          return
        }
      } catch (error) {
        if (controller.signal.aborted) {
          controllers.current.delete(key)
          return
        }
      }

      const result = await uploadAttachmentsForChat([file], {
        // The chat route, not the generic attachments one: membership is
        // checked there before any bytes are stored, which is the whole point
        // of a conversation-scoped upload.
        endpoint: `/api/chat/conversations/${conversationId}/attachments`,
        signal: controller.signal,
        onProgress: (_index, progress) => {
          const ratio = progress.total > 0 ? progress.loaded / progress.total : 0
          update(key, { progress: Math.min(1, Math.max(0, ratio)) })
        },
      })

      controllers.current.delete(key)

      const uploaded = result.items[0]
      if (uploaded) {
        update(key, { status: 'ready', progress: 1, attachmentId: uploaded.attachmentId })
        return
      }

      const failure = result.failed[0]
      if (failure?.reason === 'aborted') return
      update(key, {
        status: 'error',
        failure: {
          reason: failure?.reason ?? 'server',
          message: failure?.message ?? 'Upload failed.',
        },
      })
    },
    [conversationId, sendDirect, update],
  )

  const add = React.useCallback(
    (files: File[]) => {
      if (!conversationId || files.length === 0) return
      const staged = files.map<ChatDraftAttachment>((file) => ({
        key: makeKey(),
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        status: 'uploading',
        progress: 0,
        file,
        // A local preview so an image appears the moment it is chosen, rather
        // than after a round trip. Revoked when the row leaves.
        previewUrl: file.type.startsWith(IMAGE_PREVIEW_PREFIX)
          ? URL.createObjectURL(file)
          : undefined,
      }))
      setItems((current) => [...current, ...staged])
      for (const item of staged) void send(item.key, item.file)
    },
    [conversationId, send],
  )

  const remove = React.useCallback((key: string) => {
    controllers.current.get(key)?.abort()
    controllers.current.delete(key)
    setItems((current) => {
      const going = current.find((item) => item.key === key)
      if (going?.previewUrl) URL.revokeObjectURL(going.previewUrl)
      return current.filter((item) => item.key !== key)
    })
  }, [])

  const retry = React.useCallback(
    (key: string) => {
      const item = items.find((one) => one.key === key)
      if (!item) return
      // The same File object, so a retry never asks the reader to find it
      // again — and a new upload, so a half-written object is not resumed.
      update(key, { status: 'uploading', progress: 0, failure: undefined })
      void send(key, item.file)
    },
    [items, send, update],
  )

  const clear = React.useCallback(() => {
    for (const controller of controllers.current.values()) controller.abort()
    controllers.current.clear()
    setItems((current) => {
      for (const item of current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      }
      return []
    })
  }, [])

  /** Ids to name on the send. Only files the server has confirmed. */
  const readyIds = React.useMemo(
    () =>
      items
        .filter((item) => item.status === 'ready' && item.attachmentId)
        .map((item) => item.attachmentId as string),
    [items],
  )

  return {
    items,
    add,
    remove,
    retry,
    clear,
    readyIds,
    /** True while anything is still uploading; Send waits for it. */
    isUploading: items.some((item) => item.status === 'uploading'),
    hasAttachments: items.length > 0,
  }
}

/** Whether a message with this text and these files may be sent. */
export function canSendChatMessage(body: string, attachments: ChatDraftAttachment[]): boolean {
  const hasText = body.trim().length > 0
  const ready = attachments.filter((item) => item.status === 'ready')
  // Text alone, files alone, or both — but never while something is still
  // uploading, because the send would silently drop it.
  if (attachments.some((item) => item.status === 'uploading')) return false
  return hasText || ready.length > 0
}

export type { ChatAttachmentDto }
