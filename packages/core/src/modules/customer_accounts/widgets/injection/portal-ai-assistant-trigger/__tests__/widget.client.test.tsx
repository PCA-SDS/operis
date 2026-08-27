/**
 * @jest-environment jsdom
 *
 * Step 4.10 — Portal AiChat injection widget unit tests.
 *
 * Trigger-level coverage only; the Playwright integration spec
 * `TC-AI-INJECT-010-portal-inject.spec.ts` covers the sheet + chat flow.
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import PortalAiAssistantTriggerWidget from '../widget.client'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback || _key,
}))

jest.mock('@open-mercato/ui/ai/AiChat', () => ({
  AiChat: () => <div data-testid="mock-portal-ai-chat" />,
}))

const useAiConfiguredMock = jest.fn()
jest.mock('@open-mercato/ui/ai/useAiConfigured', () => ({
  useAiConfigured: () => useAiConfiguredMock(),
}))

jest.mock('@open-mercato/shared/security/features', () => ({
  hasFeature: (features: string[], required: string) => features.includes(required),
}))

describe('customer_accounts PortalAiAssistantTriggerWidget', () => {
  beforeEach(() => {
    useAiConfiguredMock.mockReset()
    useAiConfiguredMock.mockReturnValue({ configured: true, loaded: true, isUnconfigured: false })
  })

  it('renders the portal trigger button from concrete effective features', () => {
    render(<PortalAiAssistantTriggerWidget
      context={{
        isPortalAdmin: true,
        resolvedFeatures: ['portal.account.manage'],
      }}
    />)
    const trigger = screen.getByRole('button', { name: /open portal ai assistant/i })
    expect(trigger).toBeTruthy()
  })

  it('hides the trigger when the caller lacks the required feature', () => {
    const { container } = render(
      <PortalAiAssistantTriggerWidget
        context={{ isPortalAdmin: false, resolvedFeatures: ['some.other.feature'] }}
      />,
    )
    expect(container.textContent?.trim()).toBe('')
  })

  it('hides the trigger when no AI provider key is configured', () => {
    useAiConfiguredMock.mockReturnValue({ configured: false, loaded: true, isUnconfigured: true })
    const { container } = render(
      <PortalAiAssistantTriggerWidget
        context={{ isPortalAdmin: true, resolvedFeatures: ['portal.account.manage'] }}
      />,
    )
    expect(container.textContent?.trim()).toBe('')
  })

  it('keeps the trigger when the provider probe is inconclusive', () => {
    useAiConfiguredMock.mockReturnValue({ configured: null, loaded: true, isUnconfigured: false })
    render(
      <PortalAiAssistantTriggerWidget
        context={{ isPortalAdmin: true, resolvedFeatures: ['portal.account.manage'] }}
      />,
    )
    expect(screen.getByRole('button', { name: /open portal ai assistant/i })).toBeTruthy()
  })
})
