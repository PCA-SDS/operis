import { publicCorsHeaders } from '../cors'

describe('publicCorsHeaders', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalAllowedOrigins = process.env.APP_ALLOWED_ORIGINS
  const originalAppUrl = process.env.APP_URL

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    process.env.APP_ALLOWED_ORIGINS = originalAllowedOrigins
    process.env.APP_URL = originalAppUrl
  })

  it('allows the local public form origin during development', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.APP_ALLOWED_ORIGINS
    delete process.env.APP_URL

    const headers = publicCorsHeaders(new Request('http://localhost:3000/api/directory/public/organizations', {
      headers: { Origin: 'http://localhost:3001' },
    }))

    expect(headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3001')
    expect(headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS')
  })

  it('allows configured origins in production and rejects other origins', () => {
    process.env.NODE_ENV = 'production'
    process.env.APP_ALLOWED_ORIGINS = 'https://public.example.com'

    const allowed = publicCorsHeaders(new Request('https://operis.example.com/api/directory/public/organizations', {
      headers: { Origin: 'https://public.example.com' },
    }))
    const rejected = publicCorsHeaders(new Request('https://operis.example.com/api/directory/public/organizations', {
      headers: { Origin: 'https://evil.example.com' },
    }))

    expect(allowed.get('Access-Control-Allow-Origin')).toBe('https://public.example.com')
    expect(rejected.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
