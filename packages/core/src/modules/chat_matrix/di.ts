import { createRequire } from 'node:module'
import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  resolveChatTransportId,
  resolveChatTransportMode,
} from '@open-mercato/core/modules/chat/lib/transport'
import type { MatrixClient as MatrixClientType, matrixConfigFromEnv as MatrixConfigFromEnv } from '@open-mercato/matrix'
import type { createMatrixChatTransport as CreateMatrixChatTransport } from './lib/transport'

const logger = createLogger('chat_matrix')

/**
 * Load the Matrix half of this module, and only once someone asks for it.
 *
 * Everything under `./lib/` and `@open-mercato/matrix` is reached through here
 * rather than through a top-level `import`, because `di.ts` is one of the files
 * the generated DI registry pulls in EAGERLY, for every module, on every boot.
 * A static import would therefore make the whole application's startup depend
 * on the Matrix package resolving — with `OM_CHAT_TRANSPORT` unset and this
 * module registering nothing. That is exactly what happened: a missing
 * workspace link turned an opt-in transport into
 * `Cannot find package '@open-mercato/matrix'` at boot, crash-looping the app
 * and rolling the deployment back.
 *
 * `createRequire` rather than `await import()` because `DiRegistrar` is
 * `(container) => void`, shared by every module — making this one registrar
 * async would change that contract for all of them. Node resolves an ESM graph
 * synchronously here as long as it contains no top-level await, which this one
 * does not; the package is a plain client library.
 */
function loadMatrixBindings(): {
  MatrixClient: typeof MatrixClientType
  matrixConfigFromEnv: typeof MatrixConfigFromEnv
  createMatrixChatTransport: typeof CreateMatrixChatTransport
} {
  const require = createRequire(import.meta.url)
  const matrix = require('@open-mercato/matrix')
  // `.js` is what the shipped artifact next to this file is called; the bare
  // specifier is what resolves when this runs from the TypeScript source tree.
  // Node's CJS resolver is doing the work here, not the test runner's, so
  // neither form covers both trees on its own.
  const transport = (() => {
    try {
      return require('./lib/transport.js')
    } catch {
      return require('./lib/transport')
    }
  })()
  return {
    MatrixClient: matrix.MatrixClient,
    matrixConfigFromEnv: matrix.matrixConfigFromEnv,
    createMatrixChatTransport: transport.createMatrixChatTransport,
  }
}

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

  // Past this line the operator has explicitly asked for Matrix, so needing the
  // package IS the contract and failing loudly is correct.
  const { MatrixClient, matrixConfigFromEnv, createMatrixChatTransport } = loadMatrixBindings()

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
