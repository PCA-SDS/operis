"use client"

import {
  apiCallOrThrow,
  readApiResultOrThrow,
  withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { jsonRequestInit } from '@open-mercato/shared/lib/http/query'
import type { ChatAccountChatDto, ChatMessagingAccountDto, ChatMessagingAccountListDto } from '../../data/types'

const BASE = '/api/chat/accounts'

type AccountResponse = { account: ChatMessagingAccountDto }

export type CreateAccountRequest = {
  network: string
  /** Left out for a personal account, which is then named after its owner. */
  name?: string
  ownerType: 'company' | 'user'
  memberUserIds: string[]
}

export type UpdateAccountRequest = {
  name?: string
  memberUserIds?: string[]
  showSenderName?: boolean
}

export type ConnectAccountRequest = { flow: 'qr' | 'phone'; phoneNumber?: string | null }

/** Messaging accounts over HTTP. Edits and removals carry the version they were made against. */
export const accountsApi = {
  list: (signal?: AbortSignal) => readApiResultOrThrow<ChatMessagingAccountListDto>(BASE, { signal }),

  get: async (id: string, signal?: AbortSignal) =>
    (await readApiResultOrThrow<AccountResponse>(`${BASE}/${id}`, { signal })).account,

  create: async (input: CreateAccountRequest) =>
    (await apiCallOrThrow<AccountResponse>(BASE, jsonRequestInit('POST', input))).result!.account,

  update: async (id: string, updatedAt: string | null, input: UpdateAccountRequest) =>
    (
      await withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), () =>
        apiCallOrThrow<AccountResponse>(`${BASE}/${id}`, jsonRequestInit('PATCH', input)),
      )
    ).result!.account,

  connect: async (id: string, input: ConnectAccountRequest) =>
    (await apiCallOrThrow<AccountResponse>(`${BASE}/${id}/connect`, jsonRequestInit('POST', input))).result!.account,

  cancelConnect: async (id: string) =>
    (await apiCallOrThrow<AccountResponse>(`${BASE}/${id}/connect/cancel`, jsonRequestInit('POST', {}))).result!
      .account,

  disconnect: async (id: string, updatedAt: string | null) =>
    (
      await withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), () =>
        apiCallOrThrow<AccountResponse>(`${BASE}/${id}/disconnect`, jsonRequestInit('POST', {})),
      )
    ).result!.account,

  listChats: async (id: string, signal?: AbortSignal) =>
    (await readApiResultOrThrow<{ items: ChatAccountChatDto[] }>(`${BASE}/${id}/chats`, { signal })).items,

  moveChat: async (id: string, chatId: string) =>
    (await apiCallOrThrow<{ conversationId: string }>(`${BASE}/${id}/chats/move`, jsonRequestInit('POST', { chatId })))
      .result!,

  remove: async (id: string, updatedAt: string | null) => {
    await withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), () =>
      apiCallOrThrow<{ ok: boolean }>(`${BASE}/${id}`, { method: 'DELETE' }),
    )
  },
}
