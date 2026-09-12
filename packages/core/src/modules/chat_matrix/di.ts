import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { MatrixClient, matrixConfigFromEnv } from '@open-mercato/matrix'
import {
  resolveChatTransportId,
  resolveChatTransportMode,
} from '@open-mercato/core/modules/chat/lib/transport'
import { createMatrixChatTransport } from './lib/transport'

const logger = createLogger('chat_matrix')

/**
 * Swap the chat transport for a homeserver-backed one, when asked to.
 *
 * This module is listed after `chat` in `apps/mercato/src/modules.ts`, so
 * re-registering `chatTransport` here replaces the `local` implementation that
 * module registered. That ordering is the entire integration: `chat` never
 * imports anything Matrix-shaped, and removing this module reverts the swap.
 */
export function register(container: AppContainer) {
  const transportId = resolveChatTransportId()
  if (transportId !== 'matrix') return

  const config = matrixConfigFromEnv()
  if (!config) {
    // Refusing to boot rather than falling back.
    //
    // The operator asked for the Matrix transport. Quietly running `local`
    // instead would look identical from the outside — messages send, readers
    // read — while the homeserver silently received nothing, and the drift
    // check would report a growing gap nobody could explain. A failed start
    // names the actual problem.
    throw new Error(
      '[internal] OM_CHAT_TRANSPORT=matrix but no homeserver is configured. Set OM_MATRIX_HOMESERVER_URL, OM_MATRIX_SERVER_NAME and OM_MATRIX_AS_TOKEN, or unset OM_CHAT_TRANSPORT.',
    )
  }

  const mode = resolveChatTransportMode()

  container.register({
    matrixConfig: asValue(config),
    matrixClient: asFunction(() => new MatrixClient(config)).singleton(),
    chatTransport: asFunction(() => createMatrixChatTransport(config, mode)).singleton(),
  })

  logger.info('chat transport bound to Matrix', {
    serverName: config.serverName,
    // The homeserver URL, never the token.
    homeserver: config.baseUrl,
    mode,
    // Worth saying out loud on every boot: in this mode a homeserver outage
    // stops people sending, which is the trade the flag exists to make.
    sourceOfTruth: mode === 'authoritative' ? 'matrix' : 'postgres',
  })
}
