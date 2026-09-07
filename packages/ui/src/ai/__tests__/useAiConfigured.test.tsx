/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '../../backend/utils/apiCall'
import { AiProviderSetupPanel } from '../AiProviderSetupPanel'
import { resetAiConfiguredCacheForTests, useAiConfigured } from '../useAiConfigured'

jest.mock('../../backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as unknown as jest.Mock

function Probe() {
  const { configured, loaded, isUnconfigured } = useAiConfigured()
  return (
    <div>
      <span data-testid="configured">{String(configured)}</span>
      <span data-testid="loaded">{String(loaded)}</span>
      {isUnconfigured ? <AiProviderSetupPanel /> : <span data-testid="chat">chat</span>}
    </div>
  )
}

describe('useAiConfigured', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    resetAiConfiguredCacheForTests()
  })

  it('renders the setup panel instead of the chat when no provider key is configured', async () => {
    apiCallMock.mockResolvedValue({ ok: true, result: { aiConfigured: false, agents: [] } })

    renderWithProviders(<Probe />)

    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'))
    expect(screen.getByTestId('configured')).toHaveTextContent('false')
    expect(document.querySelector('[data-ai-provider-setup]')).not.toBeNull()
    expect(screen.queryByTestId('chat')).toBeNull()
  }, 60_000)

  it('renders the chat when a provider key is configured', async () => {
    apiCallMock.mockResolvedValue({ ok: true, result: { aiConfigured: true, agents: [] } })

    renderWithProviders(<Probe />)

    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'))
    expect(screen.getByTestId('chat')).toBeInTheDocument()
    expect(document.querySelector('[data-ai-provider-setup]')).toBeNull()
  }, 60_000)

  it('fails open — a failing probe leaves the chat in place rather than nagging', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 403, result: null })

    renderWithProviders(<Probe />)

    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'))
    expect(screen.getByTestId('configured')).toHaveTextContent('null')
    expect(screen.getByTestId('chat')).toBeInTheDocument()
  }, 60_000)

  it('shares one request across every consumer mounted on the page', async () => {
    apiCallMock.mockResolvedValue({ ok: true, result: { aiConfigured: false, agents: [] } })

    renderWithProviders(
      <>
        <Probe />
        <Probe />
        <Probe />
      </>,
    )

    await waitFor(() => expect(screen.getAllByTestId('loaded')).toHaveLength(3))
    await waitFor(() =>
      expect(screen.getAllByTestId('loaded').every((node) => node.textContent === 'true')).toBe(true),
    )
    expect(apiCallMock).toHaveBeenCalledTimes(1)
  }, 60_000)
})
