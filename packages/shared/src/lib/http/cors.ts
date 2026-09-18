const localDevelopmentOrigins = new Set([
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:5174',
])

function configuredOrigins(): Set<string> {
  return new Set(
    [process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL, ...(process.env.APP_ALLOWED_ORIGINS ?? '').split(',')]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .map((value) => {
        try {
          return new URL(value).origin
        } catch {
          return value
        }
      }),
  )
}

export function publicCorsHeaders(request: Request): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    Vary: 'Origin',
  })
  const origin = request.headers.get('origin')
  const allowedOrigins = configuredOrigins()
  const isLocalDevelopmentOrigin = process.env.NODE_ENV !== 'production' && origin !== null && localDevelopmentOrigins.has(origin)

  if (origin && (allowedOrigins.has(origin) || isLocalDevelopmentOrigin)) {
    headers.set('Access-Control-Allow-Origin', origin)
  }

  return headers
}

export function withPublicCorsHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of publicCorsHeaders(request).entries()) {
    headers.set(name, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
