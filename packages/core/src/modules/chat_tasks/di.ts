import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { DefaultChatTaskService } from './services/chatTaskService'
import { DefaultChatTaskAssignmentService } from './services/chatTaskAssignmentService'
import './commands'

export function register(container: AppContainer) {
  container.register({
    chatTaskService: asFunction(() => new DefaultChatTaskService()).singleton(),
    /**
     * Composed rather than resolved lazily: the assignment rules are always asked
     * in terms of a conversation the read service has already authorized, so the
     * dependency is real and making it explicit keeps it honest.
     *
     * `.proxy()` is required. The container runs Awilix CLASSIC injection, which
     * resolves a factory's *parameter names* as registrations — so without it the
     * `cradle` parameter below is itself looked up as a dependency and every call
     * that needs this service answers 500 with `Could not resolve 'cradle'`. The
     * same trap took down `rbacService` (see `auth/di.ts`), and it is invisible
     * until something actually resolves the token.
     */
    chatTaskAssignmentService: asFunction(
      (cradle: { chatTaskService: DefaultChatTaskService }) =>
        new DefaultChatTaskAssignmentService(cradle.chatTaskService),
    )
      .proxy()
      .singleton(),
  })
}
