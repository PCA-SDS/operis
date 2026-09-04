import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { DefaultChatService } from './services/chatService'
import './commands'

export function register(container: AppContainer) {
  container.register({
    chatService: asFunction(() => new DefaultChatService()).singleton(),
  })
}
