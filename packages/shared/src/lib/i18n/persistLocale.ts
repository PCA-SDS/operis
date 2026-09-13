import type { Locale } from './config'

/**
 * Persist the viewer's locale choice against their session.
 *
 * One implementation for every locale switcher — the backend profile dropdown,
 * the public-site language switcher and the checkout pay page each used to
 * inline this same POST, so a change to the endpoint or payload had to be made
 * in three places. Callers decide what happens afterwards (router refresh,
 * full reload, or nothing); this only reports whether the write landed.
 *
 * Deliberately raw `fetch`: this ships in `packages/shared`, which sits below
 * `@open-mercato/ui` and so cannot reach `apiCall`. Moving the endpoint onto
 * `apiCall` would also subject a preference write to the auth redirect
 * machinery, which is a behavior change rather than a consolidation.
 */
export async function persistLocalePreference(locale: Locale): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/locale', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale }),
    })
    return response.ok
  } catch {
    return false
  }
}
