import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { MatrixClient, MatrixConfig } from '@open-mercato/matrix'
import { driveAccountLogin } from '../lib/accounts'
import { ACCOUNT_LOGIN_CONCURRENCY, CHAT_MATRIX_QUEUES, type AccountLoginJob } from '../lib/queue'

export const metadata: WorkerMeta = {
  queue: CHAT_MATRIX_QUEUES.accountLogin,
  id: 'chat_matrix:account-login',
  concurrency: ACCOUNT_LOGIN_CONCURRENCY,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Wait on the bridge while somebody connects a messaging account: each new QR
 * or pairing code goes to chat, and the outcome ends the login. The whole loop
 * is in `lib/accounts.ts`; a retried job resumes where the last one stopped.
 */
export default async function handle(job: QueuedJob<AccountLoginJob>, ctx: HandlerContext): Promise<void> {
  await driveAccountLogin(
    {
      em: ctx.resolve<EntityManager>('em'),
      commandBus: ctx.resolve<CommandBus>('commandBus'),
      config: ctx.resolve<MatrixConfig>('matrixConfig'),
      client: ctx.resolve<MatrixClient>('matrixClient'),
      container: { resolve: ctx.resolve.bind(ctx) } as never,
    },
    job.payload,
  )
}
