/** `?key=value` for the non-blank entries of `params`, or `''` when none are set. */
export function toQueryString(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const serialized = search.toString()
  return serialized ? `?${serialized}` : ''
}

/** `RequestInit` for a JSON call; `body` is serialized unless it is `undefined`. */
export function jsonRequestInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

/** The query parameters of `url` as a plain object; a repeated key keeps its last value. */
export function searchParamsToObject(url: string): Record<string, string> {
  const params = new URL(url).searchParams
  const result: Record<string, string> = {}
  for (const [key, value] of params.entries()) result[key] = value
  return result
}
