import { embeddingsReindexCancelOpenApi } from '../../../openapi'
import { cancelReindex } from '../../../cancelReindex'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['search.embeddings.manage'] },
}

export async function POST(req: Request) {
  return cancelReindex(req, {
    indexType: 'vector',
    queueName: 'vectorIndexQueue',
    logHandler: 'api:search.embeddings.reindex.cancel',
  })
}

export const openApi = embeddingsReindexCancelOpenApi
