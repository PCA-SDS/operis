"use client"

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import type { ChatMessagingAccountDto } from '../../data/types'
import {
  accountsApi,
  type ConnectAccountRequest,
  type CreateAccountRequest,
  type UpdateAccountRequest,
} from './accountsApi'

/** How often a connecting account is re-read, so a rotated QR code or a finished login shows up. */
const CONNECTING_POLL_MS = 2_000

export const accountKeys = {
  all: ['chat-accounts'] as const,
  list: (scope: number) => [...accountKeys.all, { scope }, 'list'] as const,
  one: (scope: number, id: string) => [...accountKeys.all, { scope }, 'one', id] as const,
  chats: (scope: number, id: string) => [...accountKeys.all, { scope }, 'chats', id] as const,
}

export function useAccountList() {
  const scope = useOrganizationScopeVersion()
  return useQuery({
    queryKey: accountKeys.list(scope),
    queryFn: ({ signal }) => accountsApi.list(signal),
  })
}

/**
 * One account, polled while it connects — WhatsApp rotates its QR code every
 * twenty seconds, and the login ends on the phone, not here.
 *
 * The list is not polled, so the moment a login ends — connected, failed or
 * cancelled — it is told to re-read; otherwise the page behind the dialog
 * would keep showing the account as it was when the login started.
 */
export function useAccount(id: string | null) {
  const client = useQueryClient()
  const scope = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: accountKeys.one(scope, id ?? 'none'),
    queryFn: ({ signal }) => accountsApi.get(id as string, signal),
    enabled: Boolean(id),
    refetchInterval: (current) => (current.state.data?.status === 'connecting' ? CONNECTING_POLL_MS : false),
    refetchIntervalInBackground: true,
  })
  const status = query.data?.status
  const previous = React.useRef(status)
  React.useEffect(() => {
    if (previous.current === 'connecting' && status && status !== 'connecting') {
      void client.invalidateQueries({ queryKey: accountKeys.list(scope) })
    }
    previous.current = status
  }, [client, scope, status])
  return query
}

/**
 * The chats on the caller's personal WhatsApp, read live while the move picker
 * is open — never cached past it, since the phone is where they change.
 */
export function useAccountChats(id: string | null, enabled: boolean) {
  const scope = useOrganizationScopeVersion()
  return useQuery({
    queryKey: accountKeys.chats(scope, id ?? 'none'),
    queryFn: ({ signal }) => accountsApi.listChats(id as string, signal),
    enabled: enabled && Boolean(id),
    staleTime: 0,
    gcTime: 0,
  })
}

/** Every account write, through the mutation guard like the rest of the module. */
export function useAccountMutations() {
  const client = useQueryClient()
  const { runMutation } = useGuardedMutation({ contextId: 'chat.messaging_account' })
  const settled = React.useCallback(() => {
    void client.invalidateQueries({ queryKey: accountKeys.all })
  }, [client])

  const guarded = React.useCallback(
    <T,>(resourceId: string | null, payload: Record<string, unknown>, operation: () => Promise<T>) =>
      runMutation({
        operation,
        context: { resourceKind: 'chat.messaging_account', resourceId },
        mutationPayload: payload,
      }),
    [runMutation],
  )

  const create = useMutation({
    mutationFn: (input: CreateAccountRequest) => guarded(null, input, () => accountsApi.create(input)),
    onSuccess: settled,
  })

  const update = useMutation({
    mutationFn: (input: { account: ChatMessagingAccountDto; changes: UpdateAccountRequest }) =>
      guarded(input.account.id, input.changes, () =>
        accountsApi.update(input.account.id, input.account.updatedAt, input.changes),
      ),
    onSuccess: settled,
  })

  const connect = useMutation({
    mutationFn: (input: { id: string; request: ConnectAccountRequest }) =>
      guarded(input.id, { flow: input.request.flow }, () => accountsApi.connect(input.id, input.request)),
    onSuccess: settled,
  })

  const cancelConnect = useMutation({
    mutationFn: (id: string) => guarded(id, {}, () => accountsApi.cancelConnect(id)),
    onSuccess: settled,
  })

  const disconnect = useMutation({
    mutationFn: (account: ChatMessagingAccountDto) =>
      guarded(account.id, {}, () => accountsApi.disconnect(account.id, account.updatedAt)),
    onSuccess: settled,
  })

  const remove = useMutation({
    mutationFn: (account: ChatMessagingAccountDto) =>
      guarded(account.id, {}, () => accountsApi.remove(account.id, account.updatedAt)),
    onSuccess: settled,
  })

  const moveChat = useMutation({
    mutationFn: (input: { account: ChatMessagingAccountDto; chatId: string }) =>
      guarded(input.account.id, { chatId: input.chatId }, () => accountsApi.moveChat(input.account.id, input.chatId)),
    onSuccess: settled,
  })

  return { create, update, connect, cancelConnect, disconnect, remove, moveChat }
}
