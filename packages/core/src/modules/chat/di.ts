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
    // Refusing to boot, rather than warning and carrying on.
    //
    // The fake returns `[fr] <original>` and the command PERSISTS that into
    // `chat_message_translations`, where it is served to every later reader
    // from cache. Removing the flag does not undo it: the poisoned rows outlive
    // the mistake and only a manual DELETE clears them. A stray line in a
    // production `.env` is therefore a durable data defect, which is worth a
    // failed start rather than a log line nobody reads.
    // `NODE_ENV === 'production'` alone is the wrong test: the integration
    // harness deliberately runs a production BUILD, and gating on that broke
    // the one path the fake exists for. `OM_INTEGRATION_TEST` is set by that
    // harness and by nothing a real deployment runs.
    if (process.env.NODE_ENV === 'production' && process.env.OM_INTEGRATION_TEST !== 'true') {
      throw new Error(
        '[internal] OM_TRANSLATION_FAKE_PROVIDER is set in production. The fake provider writes placeholder text into the translation cache, where it is served to every reader until deleted by hand. Unset it, or set NODE_ENV correctly for a non-production deployment.',
      )
    }
    registerTranslationProvider(createFakeTranslationProvider(), { asDefault: true })
  }
}
