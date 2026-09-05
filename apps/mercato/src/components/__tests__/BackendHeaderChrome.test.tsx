/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { BackendHeaderChrome } from '../BackendHeaderChrome'

jest.mock('next/dynamic', () => (loader: () => Promise<unknown>) => {
  const source = loader.toString()
  const isOrganizationSwitcher = source.includes('OrganizationSwitcher')
  const isChatIcon = source.includes('ChatUnreadIcon')
  const Lazy = () =>
    isOrganizationSwitcher ? (
      <div data-testid="lazy-organization-switcher" />
    ) : isChatIcon ? (
      <div data-testid="lazy-chat-icon" />
    ) : (
      <div data-testid="lazy-other" />
    )
  return Lazy
})

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
  useLocale: () => 'en',
}))

let chromeGroups: Array<{ items?: Array<{ href: string }> }> = []

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({
    payload: { groups: chromeGroups, grantedFeatures: [] },
    isReady: true,
  }),
}))

jest.mock('@open-mercato/ui/backend/IntegrationsButton', () => ({
  IntegrationsButton: () => <div data-testid="integrations-button" />,
}))

jest.mock('@open-mercato/ui/backend/ProfileDropdown', () => ({
  ProfileDropdown: () => <div data-testid="profile-dropdown" />,
}))

jest.mock('@open-mercato/ui/backend/SettingsButton', () => ({
  SettingsButton: () => <div data-testid="settings-button" />,
}))

jest.mock('@open-mercato/ui/backend/AuthSessionGuard', () => ({
  AuthSessionGuard: () => <div data-testid="auth-session-guard" />,
}))

jest.mock('@/components/AiAssistantShellIntegration', () => ({
  AiAssistantShellIntegration: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

beforeEach(() => {
  chromeGroups = []
})

/**
 * The chat icon is gated on the same signal as Messages: whether the nav actually
 * resolves `/backend/chat` for this viewer. That covers both the module
 * entitlement and the `chat.view` feature, so a tenant without chat must never be
 * shown a topbar entry — nor load the chunk behind it.
 */
describe('BackendHeaderChrome chat entry', () => {
  it('hides the chat icon when /backend/chat is not reachable', () => {
    render(<BackendHeaderChrome userId="u1" tenantId="t1" organizationId="o1" />)
    expect(screen.queryByTestId('lazy-chat-icon')).toBeNull()
  })

  it('shows the chat icon once /backend/chat is in the nav', () => {
    chromeGroups = [{ items: [{ href: '/backend/chat' }] }]
    render(<BackendHeaderChrome userId="u1" tenantId="t1" organizationId="o1" />)
    expect(screen.getByTestId('lazy-chat-icon')).toBeInTheDocument()
  })
})

describe('BackendHeaderChrome', () => {
  it('renders the organization switcher in the topbar without a viewport-gated wrapper', () => {
    const { container } = render(
      <BackendHeaderChrome
        email="demo@example.com"
        userId="user-1"
        tenantId={null}
        organizationId={null}
      />,
    )

    const switcher = screen.getByTestId('lazy-organization-switcher')
    expect(switcher).toBeInTheDocument()

    // Regression for issue #1795: the topbar OrganizationSwitcher must not be
    // wrapped in a viewport-gated container that hides it at narrow widths.
    // Previously `<div className="hidden lg:contents">` removed it below 1024px,
    // which combined with `mobileSidebarSlot={<OrganizationSwitcher compact />}`
    // caused the dropdown to reappear inside the mobile sidebar drawer.
    const hiddenWrappers = container.querySelectorAll('.hidden')
    for (const wrapper of Array.from(hiddenWrappers)) {
      expect(wrapper.contains(switcher)).toBe(false)
    }
  })
})
