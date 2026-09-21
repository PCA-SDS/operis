import { defineModuleContract } from '@open-mercato/shared/modules/contract'

/**
 * Public contract for `invoice`.
 *
 * AP/AR invoice accounting. Integrates outward to GDT; nothing integrates inward.
 *
 * Everything under `data/`, `lib/`, `services/`, `components/` and `api/` is
 * private: `packages/core/package.json` maps `./modules/invoice/*` to null, so a
 * cross-module deep import fails to resolve at compile time rather than in review.
 *
 * This contract is deliberately empty. No other module consumes invoice today, and
 * publishing a surface nobody asked for is the same wide coupling sealing removed —
 * only sanctioned. Add an entry here in the SAME change as the caller that needs it:
 *
 *   commands:   ['invoice.<entity>.<action>']   // cross-module writes, via the command bus
 *   readModels: ['invoice:<entity>']            // cross-module reads, via the query engine
 *
 * Events are public by default and bind by id string — see `events.ts`, not here.
 */
export const contract = defineModuleContract({
  moduleId: 'invoice',
})

export default contract
