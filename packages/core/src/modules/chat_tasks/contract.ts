import { defineModuleContract } from '@open-mercato/shared/modules/contract'

/**
 * Public contract for `chat_tasks`.
 *
 * Owns only the conversation<->task link. Both halves stay owned by `chat` and `tasks`;
 * this module publishes nothing because nothing integrates with the link itself.
 *
 * Everything under `data/`, `lib/`, `services/`, `components/` and `api/` is
 * private: `packages/core/package.json` maps `./modules/chat_tasks/*` to null, so a
 * cross-module deep import fails to resolve at compile time rather than in review.
 *
 * This contract is deliberately empty. No other module consumes chat_tasks today, and
 * publishing a surface nobody asked for is the same wide coupling sealing removed —
 * only sanctioned. Add an entry here in the SAME change as the caller that needs it:
 *
 *   commands:   ['chat_tasks.<entity>.<action>']   // cross-module writes, via the command bus
 *   readModels: ['chat_tasks:<entity>']            // cross-module reads, via the query engine
 *
 * Events are public by default and bind by id string — see `events.ts`, not here.
 */
export const contract = defineModuleContract({
  moduleId: 'chat_tasks',
})

export default contract
