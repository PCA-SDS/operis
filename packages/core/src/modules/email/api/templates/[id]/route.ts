import { GET as listGet, metadata, PUT, DELETE, openApi } from '../route'

type RouteContext = {
  params?: { id?: string } | Promise<{ id?: string }>
}

async function readRouteParams(context: RouteContext): Promise<{ id?: string }> {
  const params = context.params
  if (params && typeof (params as Promise<{ id?: string }>).then === 'function') {
    return params
  }
  return params ?? {}
}

export async function GET(request: Request, context: RouteContext = {}) {
  const params = await readRouteParams(context)
  if (!params.id) return listGet(request)

  const url = new URL(request.url)
  if (!url.searchParams.has('id')) url.searchParams.set('id', params.id)

  return listGet(new Request(url.toString(), {
    headers: request.headers,
    method: request.method,
    signal: request.signal,
  }))
}

export { metadata, PUT, DELETE, openApi }
