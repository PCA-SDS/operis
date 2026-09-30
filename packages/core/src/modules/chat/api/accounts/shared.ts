import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { canAccessAccount, loadAccount, toAccountDtos, type ChatMessagingAccountDto } from '../../lib/accounts'
import type { ChatRequestContext } from '../shared'

/**
 * The account as the caller may see it, read fresh after a write — or the same
 * 404 a missing id gets, so account ids cannot be probed.
 */
export async function readAccountForCaller(
  request: ChatRequestContext,
  accountId: string,
): Promise<ChatMessagingAccountDto> {
  const em = request.em.fork()
  const account = await loadAccount(em, request.scope, accountId)
  if (!account || !(await canAccessAccount(request.container, request.scope, request.userId, account))) {
    throw notFound(request.messages.accountNotFound)
  }
  const [dto] = await toAccountDtos(em, request.scope, [account])
  if (!dto) throw notFound(request.messages.accountNotFound)
  return dto
}
