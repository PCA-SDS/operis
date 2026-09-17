/**
 * Module public contracts.
 *
 * A module's `contract.ts` is the ONLY server-side surface other modules may
 * import. Everything else — `data/`, `lib/`, `services/`, `utils/`,
 * `components/`, `api/` — is private to the module and is made unreachable by
 * the package `exports` map once the module is sealed (see
 * `packages/core/package.json` and `module-seal-integrity.test.ts`).
 *
 * The contract is deliberately thin. It declares ADDRESSES, not implementations:
 *
 * - `commands`   — command ids other modules dispatch through the command bus.
 *                  Writes to another module's data go through these and nowhere
 *                  else, so the owning module keeps its rules, audit trail,
 *                  events and optimistic locking.
 * - `readModels` — query-engine entity ids other modules may read. The engine
 *                  appends tenant/organization predicates and throws without a
 *                  tenantId, so a cross-module read is tenant-safe by
 *                  construction rather than by the caller remembering.
 * - `events`     — OPTIONAL. `events.ts` is already the module's event contract
 *                  and subscribers bind by id string, never by import, so
 *                  events are public by default and listing them here would be
 *                  a second source of truth. Populate this ONLY to narrow the
 *                  public set when a module emits internal events it does not
 *                  want depended on; an empty list means "everything in
 *                  events.ts is public".
 * - `services`   — DI tokens for the rare synchronous call that needs a result
 *                  the query engine cannot express. Each one costs a contract
 *                  test, so prefer a command or a read model.
 *
 * Declare only what is actually consumed today. A contract is a promise, and a
 * speculative promise is indistinguishable from debt: publishing every command
 * a module happens to have re-creates the wide surface sealing was meant to
 * remove, except now it is sanctioned. Start empty; add an entry when a real
 * caller needs it, in the same change as that caller.
 *
 * Declaring an address here does NOT export the implementation. That is the
 * point: a consumer resolves it at runtime through the command bus, the query
 * engine, the event bus or the container, none of which require importing the
 * owning module's source.
 *
 * Types may be exported alongside the contract, but only types the consumer
 * genuinely needs, and never an ORM entity class — exporting one hands the
 * caller a way to query the table directly and re-opens the boundary.
 * `module-contract-purity.test.ts` enforces both rules.
 */

export type ModuleContractDeclaration<
  TCommands extends readonly string[] = readonly string[],
  TReadModels extends readonly string[] = readonly string[],
  TEvents extends readonly string[] = readonly string[],
  TServices extends readonly string[] = readonly string[],
> = {
  /** Owning module id — must match the directory name and `ModuleInfo.name`. */
  moduleId: string
  /** Command ids callable via the command bus. Format: `<module>.<entity>.<action>`. */
  commands?: TCommands
  /** Query-engine entity ids readable by other modules. Format: `<module>:<entity>`. */
  readModels?: TReadModels
  /** Event ids other modules may subscribe to. Format: `<module>.<entity>.<action>`. */
  events?: TEvents
  /** DI tokens resolvable by other modules. Use sparingly. */
  services?: TServices
}

export type ModuleContract<
  TCommands extends readonly string[] = readonly string[],
  TReadModels extends readonly string[] = readonly string[],
  TEvents extends readonly string[] = readonly string[],
  TServices extends readonly string[] = readonly string[],
> = Readonly<Required<ModuleContractDeclaration<TCommands, TReadModels, TEvents, TServices>>>

function assertPrefixed(moduleId: string, values: readonly string[], separator: '.' | ':', kind: string): void {
  const prefix = `${moduleId}${separator}`
  const stray = values.filter((value) => !value.startsWith(prefix))
  if (stray.length > 0) {
    throw new Error(
      `[internal] Module contract '${moduleId}' declares ${kind} outside its own namespace: ${stray.join(', ')}. `
        + `A module may only publish addresses it owns; declaring another module's ${kind} here would let callers `
        + `treat this contract as a proxy for a boundary it does not own.`,
    )
  }
}

function assertUnique(moduleId: string, values: readonly string[], kind: string): void {
  const seen = new Set<string>()
  const duplicates = values.filter((value) => (seen.has(value) ? true : (seen.add(value), false)))
  if (duplicates.length > 0) {
    throw new Error(`[internal] Module contract '${moduleId}' declares duplicate ${kind}: ${duplicates.join(', ')}.`)
  }
}

/**
 * Declare a module's public contract.
 *
 * Validation runs at import time so a malformed contract fails the build rather
 * than surfacing as a missing command at runtime, in a tenant's request.
 */
export function defineModuleContract<
  const TCommands extends readonly string[] = readonly [],
  const TReadModels extends readonly string[] = readonly [],
  const TEvents extends readonly string[] = readonly [],
  const TServices extends readonly string[] = readonly [],
>(
  declaration: ModuleContractDeclaration<TCommands, TReadModels, TEvents, TServices>,
): ModuleContract<TCommands, TReadModels, TEvents, TServices> {
  const { moduleId } = declaration
  if (!/^[a-z][a-z0-9_]*$/.test(moduleId)) {
    throw new Error(`[internal] Module contract has an invalid moduleId '${moduleId}'; expected snake_case.`)
  }

  const commands = (declaration.commands ?? []) as TCommands
  const readModels = (declaration.readModels ?? []) as TReadModels
  const events = (declaration.events ?? []) as TEvents
  const services = (declaration.services ?? []) as TServices

  assertPrefixed(moduleId, commands, '.', 'commands')
  assertPrefixed(moduleId, readModels, ':', 'read models')
  assertPrefixed(moduleId, events, '.', 'events')
  assertUnique(moduleId, commands, 'commands')
  assertUnique(moduleId, readModels, 'read models')
  assertUnique(moduleId, events, 'events')
  assertUnique(moduleId, services, 'services')

  return Object.freeze({ moduleId, commands, readModels, events, services })
}
