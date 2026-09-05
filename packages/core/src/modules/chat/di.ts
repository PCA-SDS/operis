import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerTranslationProvider } from '@open-mercato/shared/lib/translation/provider'
import { createFakeTranslationProvider } from '@open-mercato/shared/lib/translation/fake-provider'
import { DefaultChatService } from './services/chatService'
import './commands'

export function register(container: AppContainer) {
  container.register({
    chatService: asFunction(() => new DefaultChatService()).singleton(),
  })

  // Network-free engine for integration tests and offline development, matching
  // how the push channels swap their SDK clients. The real adapter stands down
  // when this flag is set, so the two cannot both claim the default.
  if (process.env.OM_TRANSLATION_FAKE_PROVIDER === '1') {
    registerTranslationProvider(createFakeTranslationProvider(), { asDefault: true })
  }
}
