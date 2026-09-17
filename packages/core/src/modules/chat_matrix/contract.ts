import { defineModuleContract } from '@open-mercato/shared/modules/contract'

/**
 * Public contract for `chat_matrix`.
 *
 * Everything under `data/`, `lib/`, `services/`, `components/` and `api/` is
 * private: the package exports map sends `./modules/chat_matrix/*` to null, so a
 * cross-module deep import fails to resolve at compile time rather than in review.
 *
 * Empty because no other module consumes chat_matrix today. Publishing a surface
 * nobody asked for re-creates the wide coupling sealing removed, only sanctioned.
 * Add an entry in the SAME change as the caller that needs it:
 *
 *   commands:   ['chat_matrix.<entity>.<action>']   // cross-module writes, via the command bus
 *   readModels: ['chat_matrix:<entity>']            // cross-module reads, via the query engine
 *
 * Events are public by default and bind by id string — see `events.ts`, not here.
 */
export const contract = defineModuleContract({
  moduleId: 'chat_matrix',
})

export default contract
