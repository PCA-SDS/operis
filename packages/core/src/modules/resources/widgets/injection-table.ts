import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Resources module injection table.
 *
 * Maps extension host keys (from extension-points.ts) to their injection spot IDs
 * so the extension system can bind declared extension points to real injection spots.
 */
export const injectionTable: ModuleInjectionTable = {
  // Extension hosts declared in extension-points.ts
  'data-table:resources.resources.list': [],
  'data-table:resources.resource-types.list': [],
  'data-table:resources.resource-areas.list': [],
}

export default injectionTable
