/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '../../backend/utils/apiCall'
import { AiAssistantLauncher, AI_ASSISTANT_LAUNCHER_OPEN_EVENT } from '../AiAssistantLauncher'
import { resetAiConfiguredCacheForTests } from '../useAiConfigured'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('../../backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as unknown as jest.Mock

describe('<AiAssistantLauncher>', () => {
  beforeEach(() => {
    resetAiConfiguredCacheForTests()
    apiCallMock.mockReset()
    apiCallMock.mockImplementation(async (url: string) => {
      if (url === '/api/ai_assistant/health') {
        return { ok: true, result: { healthy: true } }
      }
      if (url === '/api/ai_assistant/ai/agents') {
        return {
          ok: true,
          result: {
            aiConfigured: true,
            agents: [
              {
                id: 'catalog.catalog_assistant',
                label: 'Catalog Assistant',
                description: 'Explore catalog data',
                mutationPolicy: 'read-only',
              },
            ],
          },
        }
      }
      throw new Error(`Unexpected apiCall: ${url}`)
    })
  })

  it('opens the assistants picker when the global launcher event is dispatched', async () => {
    renderWithProviders(<AiAssistantLauncher />)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Open AI assistant' }).length).toBeGreaterThan(0)
    })

    act(() => {
      window.dispatchEvent(new CustomEvent(AI_ASSISTANT_LAUNCHER_OPEN_EVENT))
    })

    expect(await screen.findByRole('dialog', { name: 'AI assistants' })).toBeInTheDocument()
    expect(screen.getByText('Catalog Assistant')).toBeInTheDocument()
  }, 60_000)

  describe('when no AI provider key is configured', () => {
    beforeEach(() => {
      apiCallMock.mockImplementation(async (url: string) => {
        if (url === '/api/ai_assistant/health') return { ok: true, result: { healthy: true } }
        if (url === '/api/ai_assistant/ai/agents') {
          return {
            ok: true,
            result: {
              aiConfigured: false,
              agents: [{ id: 'catalog.catalog_assistant', label: 'Catalog Assistant' }],
            },
          }
        }
        throw new Error(`Unexpected apiCall: ${url}`)
      })
    })

    it('shows the provider setup panel instead of the agent list', async () => {
      renderWithProviders(<AiAssistantLauncher />)
      act(() => {
        window.dispatchEvent(new CustomEvent(AI_ASSISTANT_LAUNCHER_OPEN_EVENT))
      })

      const dialog = await screen.findByRole('dialog', { name: 'AI assistants' })
      await waitFor(() => {
        expect(dialog.querySelector('[data-ai-provider-setup]')).not.toBeNull()
      })
      expect(screen.queryByText('Catalog Assistant')).toBeNull()
    }, 60_000)

    it('keeps the setup panel out of the listbox so its links stay reachable', async () => {
      renderWithProviders(<AiAssistantLauncher />)
      act(() => {
        window.dispatchEvent(new CustomEvent(AI_ASSISTANT_LAUNCHER_OPEN_EVENT))
      })

      const dialog = await screen.findByRole('dialog', { name: 'AI assistants' })
      await waitFor(() => {
        expect(dialog.querySelector('[data-ai-provider-setup]')).not.toBeNull()
      })
      // A listbox may only contain options — rendering a heading, <pre> and
      // links inside one is invalid ARIA and hides the links from AT.
      expect(dialog.querySelector('[role="listbox"]')).toBeNull()
      expect(screen.getByRole('link', { name: /AI assistant docs/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Provider settings/i })).toBeInTheDocument()
    }, 60_000)

    it('hides the search field and the navigate/launch hints, keeping only Esc', async () => {
      renderWithProviders(<AiAssistantLauncher />)
      act(() => {
        window.dispatchEvent(new CustomEvent(AI_ASSISTANT_LAUNCHER_OPEN_EVENT))
      })

      const dialog = await screen.findByRole('dialog', { name: 'AI assistants' })
      await waitFor(() => {
        expect(dialog.querySelector('[data-ai-provider-setup]')).not.toBeNull()
      })
      expect(dialog.querySelector('[data-ai-launcher-search-input]')).toBeNull()
      expect(screen.queryByText('Navigate')).toBeNull()
      expect(screen.queryByText('Launch')).toBeNull()
      expect(screen.getByText('Close')).toBeInTheDocument()
    }, 60_000)
  })
})
