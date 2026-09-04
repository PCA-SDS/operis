"use client"

// The module's single HTTP surface. Every component reads and writes through
// here rather than assembling URLs inline, so a route change is one edit.

import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type {
  ChatConversationDto,
  ChatPinnedListDto,
  ChatConversationListDto,
  ChatMemberListDto,
  ChatMessagePageDto,
  ChatParticipantRole,
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

  createSpace: async (input: { title: string; memberIds: string[] }) =>
    (await apiCallOrThrow<ChatConversationDto>(
      `${BASE}/conversations`,
      jsonInit('POST', {
        kind: 'space',
        title: input.title,
        // Omitted rather than sent empty: the schema treats an empty array as a
        // validation failure, and "just me for now" is a valid space.
        memberIds: input.memberIds.length > 0 ? input.memberIds : undefined,
      }),
    )).result!,

  renameSpace: async (id: string, title: string) =>
    (await apiCallOrThrow<ChatConversationDto>(`${BASE}/conversations/${id}`, jsonInit('PATCH', { title })))
      .result!,

  listMembers: (id: string, params: { q?: string; limit?: number; offset?: number }, signal?: AbortSignal) =>
    readApiResultOrThrow<ChatMemberListDto>(`${BASE}/conversations/${id}/members${query(params)}`, { signal }),

  addMembers: async (id: string, memberIds: string[]) =>
    (await apiCallOrThrow<{ added: string[] }>(
      `${BASE}/conversations/${id}/members`,
      jsonInit('POST', { memberIds }),
    )).result!,

  removeMember: async (id: string, userId: string) =>
    (await apiCallOrThrow<{ removed: string; spaceDeleted: boolean }>(
      `${BASE}/conversations/${id}/members/${userId}`,
      jsonInit('DELETE'),
    )).result!,

  setMemberRole: async (id: string, userId: string, role: ChatParticipantRole) =>
    (await apiCallOrThrow<{ userId: string; role: ChatParticipantRole }>(
      `${BASE}/conversations/${id}/members/${userId}`,
      jsonInit('PATCH', { role }),
    )).result!,

  listMessages: (id: string, params: { cursor?: string; limit?: number }, signal?: AbortSignal) =>
    readApiResultOrThrow<ChatMessagePageDto>(`${BASE}/conversations/${id}/messages${query(params)}`, { signal }),

  /** A window centred on one message — how pin navigation reaches history. */
  listMessagesAround: (id: string, around: string, signal?: AbortSignal) =>
    readApiResultOrThrow<ChatMessagePageDto>(
      `${BASE}/conversations/${id}/messages${query({ around })}`,
      { signal },
    ),

  listPinned: (id: string, signal?: AbortSignal) =>
    readApiResultOrThrow<ChatPinnedListDto>(`${BASE}/conversations/${id}/pins`, { signal }),

  toggleReaction: async (conversationId: string, messageId: string, emoji: string) =>
    (await apiCallOrThrow<{ emoji: string; reacted: boolean }>(
      `${BASE}/conversations/${conversationId}/messages/${messageId}/reactions`,
      jsonInit('POST', { emoji }),
    )).result!,

  setPinned: async (conversationId: string, messageId: string, pinned: boolean) =>
    (await apiCallOrThrow<{ pinned: boolean }>(
      `${BASE}/conversations/${conversationId}/messages/${messageId}/pin`,
      jsonInit(pinned ? 'POST' : 'DELETE'),
    )).result!,

  sendMessage: async (
    id: string,
    body: { body: string; clientMessageId?: string; replyToMessageId?: string },
  ) =>
    (await apiCallOrThrow<ChatSendMessageResultDto>(
      `${BASE}/conversations/${id}/messages`,
      jsonInit('POST', body),
    )).result!,

  markRead: async (id: string, readAt?: string) =>
    (await apiCallOrThrow<{ lastReadAt: string }>(
      `${BASE}/conversations/${id}/read`,
      jsonInit('POST', readAt ? { readAt } : {}),
    )).result!,

  markAllRead: async () =>
    (await apiCallOrThrow<{ conversationIds: string[]; lastReadAt: string }>(
      `${BASE}/read-all`,
      jsonInit('POST'),
    )).result!,

  unreadCount: (signal?: AbortSignal) =>
    readApiResultOrThrow<ChatUnreadCountDto>(`${BASE}/unread-count`, { signal }),
}
