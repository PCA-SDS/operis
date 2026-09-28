import { readCookieFromHeader } from '../cookies'
import { jsonRequestInit, searchParamsToObject, toQueryString } from '../query'
import { jsonResponse, unauthorizedResponse } from '../responses'
import { readSseDataPayload } from '../sse'

jest.mock('../../i18n/server', () => ({
  resolveTranslations: async () => ({ t: (_key: string, fallback: string) => fallback }),
}))

describe('readCookieFromHeader', () => {
  it('returns the raw value of the named cookie', () => {
    expect(readCookieFromHeader('a=1; session=abc%20d; b=2', 'session')).toBe('abc%20d')
    expect(readCookieFromHeader('a=1', 'session')).toBeUndefined()
    expect(readCookieFromHeader(null, 'session')).toBeUndefined()
  })

  it('keeps an empty value as the empty string', () => {
    expect(readCookieFromHeader('session=; a=1', 'session')).toBe('')
  })
})

describe('query helpers', () => {
  it('serializes only set values', () => {
    expect(toQueryString({ page: 2, q: 'x y', empty: '', missing: undefined, none: null })).toBe('?page=2&q=x+y')
    expect(toQueryString({})).toBe('')
  })

  it('builds a JSON request init and leaves an absent body out', () => {
    expect(jsonRequestInit('POST', { a: 1 })).toEqual({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    })
    expect(jsonRequestInit('DELETE').body).toBeUndefined()
  })

  it('reads query parameters, keeping the last of a repeated key', () => {
    expect(searchParamsToObject('https://x.test/api?a=1&b=2&a=3')).toEqual({ a: '3', b: '2' })
  })
})

describe('jsonResponse', () => {
  it('defaults to 200 and keeps extra headers', async () => {
    const response = jsonResponse({ ok: true }, { status: 201, headers: { 'x-trace': '1' } })
    expect(response.status).toBe(201)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('x-trace')).toBe('1')
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(jsonResponse(null).status).toBe(200)
  })
})

describe('readSseDataPayload', () => {
  it('joins multi-line data and ignores other fields', () => {
    expect(readSseDataPayload('event: message\ndata: {"a":\ndata:1}')).toBe('{"a":\n1}')
    expect(readSseDataPayload(': comment')).toBeNull()
  })
})

describe('unauthorizedResponse', () => {
  it('answers 401 with the translated message', async () => {
    const response = await unauthorizedResponse()
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })
})
