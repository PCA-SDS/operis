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
  /**
   * The sibling is loaded by PACKAGE specifier, not by relative path.
   *
   * A bundler resolves `./lib/transport.js` against the bundled `di.js`, where
   * no such file sits, and emits an empty module stub rather than throwing — so
   * the `catch` below never ran, `createMatrixChatTransport` came back
   * `undefined`, and `register` went on to log that it had bound Matrix. The
   * package specifier is the same form the generated DI registry uses to import
   * this very file, so whatever resolves that resolves this. The relative forms
   * stay as fallbacks for the source and test trees, where the package
   * self-reference is not always available.
   */
  const transport = loadFirstWith('createMatrixChatTransport', require, [
    '@open-mercato/core/modules/chat_matrix/lib/transport',
    './lib/transport.js',
    './lib/transport',
  ])
  return {
    MatrixClient: bindingOf(matrix, 'MatrixClient'),
    matrixConfigFromEnv: bindingOf(matrix, 'matrixConfigFromEnv'),
    createMatrixChatTransport: bindingOf(transport, 'createMatrixChatTransport'),
  }
}

/**
 * The first specifier that actually yields the export, not the first that loads.
 *
 * Taking the first require that does not throw is what hid the bundler stub:
 * an empty object is a successful load and a useless one.
 */
function loadFirstWith(
  name: string,
  require: NodeJS.Require,
  specifiers: readonly string[],
): unknown {
  const failures: string[] = []
  for (const specifier of specifiers) {
    let loaded: unknown
    try {
      loaded = require(specifier)
    } catch (error) {
      failures.push(`${specifier}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const namespace = loaded as Record<string, unknown> | undefined
    if (namespace?.[name] !== undefined) return loaded
    if ((namespace?.default as Record<string, unknown> | undefined)?.[name] !== undefined) return loaded
    failures.push(`${specifier}: loaded, but carries no "${name}"`)
  }
  throw new Error(
    `[internal] OM_CHAT_TRANSPORT=matrix but "${name}" could not be loaded. Tried — ${failures.join('; ')}.`,
  )
}

/**
 * One named export, whichever shape the loader handed back.
 *
 * `packages/core` and `@open-mercato/matrix` are both `"type": "module"`, so
 * `createRequire` returns an ES module namespace here — and depending on the
 * runtime doing the resolving, the names sit either on the namespace itself or
 * behind its `default`. Reading only the first shape is how the transport came
 * back `undefined` under a production Next build while `register` below still
 * logged that it had bound Matrix.
 *
 * A missing binding throws rather than returning `undefined`, for the same
 * reason `register` refuses to boot without a homeserver: a transport that is
 * absent at resolve time is indistinguishable from `local` to everyone except
 * the homeserver that never receives anything.
 */
function bindingOf<T>(loaded: unknown, name: string): T {
  const namespace = loaded as Record<string, unknown> | undefined
  const direct = namespace?.[name]
  if (direct !== undefined) return direct as T
  const nested = (namespace?.default as Record<string, unknown> | undefined)?.[name]
  if (nested !== undefined) return nested as T
  throw new Error(
    `[internal] OM_CHAT_TRANSPORT=matrix but the Matrix binding "${name}" did not load. Available: ${Object.keys(namespace ?? {}).join(', ') || '(none)'}.`,
  )
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
