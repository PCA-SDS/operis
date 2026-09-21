import { defineModuleContract } from '@open-mercato/shared/modules/contract'

/**
 * Public contract for `channel_expo`.
 *
 * Everything under `data/`, `lib/`, `services/`, `components/` and `api/` is
 * private: the package exports map sends `./modules/channel_expo/*` to null, so a
 * cross-module deep import fails to resolve at compile time rather than in review.
 *
 * Empty because no other module consumes channel_expo today. Publishing a surface
 * nobody asked for re-creates the wide coupling sealing removed, only sanctioned.
 * Add an entry in the SAME change as the caller that needs it:
 *
 *   commands:   ['channel_expo.<entity>.<action>']   // cross-module writes, via the command bus
 *   readModels: ['channel_expo:<entity>']            // cross-module reads, via the query engine
 *
 * Events are public by default and bind by id string — see `events.ts`, not here.
 */
export const contract = defineModuleContract({
  moduleId: 'channel_expo',
})

export default contract
