/** @jest-environment jsdom */

import { replaceIntegrationDetailTabUrl } from '../detail-page-widgets'

describe('integration detail tab navigation', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('updates the tab query with History API without navigating the backend route', () => {
    window.history.replaceState({ __NA: true }, '', '/backend/integrations/resend?runId=run-123')
    const replaceState = jest.spyOn(window.history, 'replaceState')

    const nextUrl = replaceIntegrationDetailTabUrl({
      integrationId: 'resend',
      nextTab: 'health',
      currentSearchParams: new URLSearchParams(window.location.search),
    })

    expect(nextUrl).toBe('/backend/integrations/resend?runId=run-123&tab=health')
    expect(replaceState).toHaveBeenCalledWith(null, '', nextUrl)
    expect(window.location.pathname).toBe('/backend/integrations/resend')
    expect(window.location.search).toBe('?runId=run-123&tab=health')
  })

  it('removes the default credentials tab while preserving other query parameters', () => {
    window.history.replaceState(null, '', '/backend/integrations/resend?runId=run-123&tab=logs')

    const nextUrl = replaceIntegrationDetailTabUrl({
      integrationId: 'resend',
      nextTab: 'credentials',
      currentSearchParams: new URLSearchParams(window.location.search),
    })

    expect(nextUrl).toBe('/backend/integrations/resend?runId=run-123')
    expect(window.location.search).toBe('?runId=run-123')
  })
})
