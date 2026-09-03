"use client"

// The module's single HTTP surface. Every component reads and writes through
// here rather than assembling URLs inline, so a route change is one edit.

import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type {
  ChatConversationDto,
  ChatConversationListDto,
  ChatMessagePageDto,
  ChatSendMessageResultDto,
  ChatUnreadCountDto,
} from '../data/types'
import type { ChatDirectoryResult } from '../lib/directory'

const BASE = '/api/chat'

function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const serialized = search.toString()
  return serialized ? `?${serialized}` : ''
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

export const chatApi = {
  searchDirectory: (params: { q?: string; limit?: number }, signal?: AbortSignal) =>
    readApiResultOrThrow<ChatDirectoryResult>(`${BASE}/directory${query(params)}`, { signal }),

  listConversations: (params: { limit?: number }, signal?: AbortSignal) =>
    readApiResultOrThrow<ChatConversationListDto>(`${BASE}/conversations${query(params)}`, { signal }),

  getConversation: (id: string, signal?: AbortSignal) =>
    readApiResultOrThrow<ChatConversationDto>(`${BASE}/conversations/${id}`, { signal }),

  openConversation: async (userId: string) =>
    (await apiCallOrThrow<ChatConversationDto>(`${BASE}/conversations`, jsonInit('POST', { userId }))).result!,

  listMessages: (id: string, params: { cursor?: string; limit?: number }, signal?: AbortSignal) =>
    readApiResultOrThrow<ChatMessagePageDto>(`${BASE}/conversations/${id}/messages${query(params)}`, { signal }),

  sendMessage: async (id: string, body: { body: string; clientMessageId?: string }) =>
    (await apiCallOrThrow<ChatSendMessageResultDto>(
      `${BASE}/conversations/${id}/messages`,
      jsonInit('POST', body),
    )).result!,

  markRead: async (id: string, readAt?: string) =>
    (await apiCallOrThrow<{ lastReadAt: string }>(
      `${BASE}/conversations/${id}/read`,
      jsonInit('POST', readAt ? { readAt } : {}),
    )).result!,

  unreadCount: (signal?: AbortSignal) =>
    readApiResultOrThrow<ChatUnreadCountDto>(`${BASE}/unread-count`, { signal }),
}
