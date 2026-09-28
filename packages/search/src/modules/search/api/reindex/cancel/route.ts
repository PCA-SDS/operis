import { reindexCancelOpenApi } from '../../openapi'
import { cancelReindex } from '../../cancelReindex'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['search.reindex'] },
}

export async function POST(req: Request) {
  return cancelReindex(req, {
    indexType: 'fulltext',
    queueName: 'fulltextIndexQueue',
    logHandler: 'api:search.reindex.cancel',
  })
}

export const openApi = reindexCancelOpenApi
