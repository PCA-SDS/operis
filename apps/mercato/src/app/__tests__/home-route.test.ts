const redirect = jest.fn((target: string) => {
  // Next's redirect() signals by throwing; mirror that so code after it cannot run.
  throw new Error(`NEXT_REDIRECT:${target}`)
})
const getAuthFromCookies = jest.fn()
const isAutoLoginEnabled = jest.fn(() => false)

jest.mock('next/navigation', () => ({ redirect }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: () => getAuthFromCookies(),
}))
jest.mock('@open-mercato/core/modules/auth/lib/autologin', () => ({
  isAutoLoginEnabled: () => isAutoLoginEnabled(),
}))

import Home from '../page'

async function landsOn(): Promise<string> {
  try {
    await Home()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.startsWith('NEXT_REDIRECT:')) return message.slice('NEXT_REDIRECT:'.length)
    throw err
  }
  throw new Error('[internal] the home route rendered instead of redirecting')
}

describe('home route', () => {
  beforeEach(() => {
    redirect.mockClear()
    getAuthFromCookies.mockReset()
    isAutoLoginEnabled.mockReset().mockReturnValue(false)
  })

  it('sends an anonymous visitor straight to the login form', async () => {
    getAuthFromCookies.mockResolvedValue(null)
    expect(await landsOn()).toBe('/login')
  })

  it('sends an authenticated visitor into the app', async () => {
    getAuthFromCookies.mockResolvedValue({ sub: 'user-1', tenantId: 't-1', orgId: 'o-1', roles: ['admin'] })
    expect(await landsOn()).toBe('/backend')
  })

  it('never lands on the developer start page', async () => {
    getAuthFromCookies.mockResolvedValue(null)
    await landsOn()
    expect(redirect).not.toHaveBeenCalledWith('/start')
  })

  it('still hands off to autologin when it is configured and there is no session', async () => {
    getAuthFromCookies.mockResolvedValue(null)
    isAutoLoginEnabled.mockReturnValue(true)
    expect(await landsOn()).toBe('/api/auth/autologin')
  })

  it('ignores autologin once a session exists', async () => {
    getAuthFromCookies.mockResolvedValue({ sub: 'user-1' })
    isAutoLoginEnabled.mockReturnValue(true)
    expect(await landsOn()).toBe('/backend')
  })
})
