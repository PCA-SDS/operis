import { parseBooleanToken } from '../boolean'

/** Whether `OM_INDEXER_VERBOSE` asks the indexer CLIs for per-record progress output. */
export function isIndexerVerbose(): boolean {
  const parsed = parseBooleanToken(process.env.OM_INDEXER_VERBOSE ?? '')
  return parsed === true
}
