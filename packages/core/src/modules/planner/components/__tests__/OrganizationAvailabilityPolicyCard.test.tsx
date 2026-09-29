/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { OrganizationAvailabilityPolicyCard } from '../OrganizationAvailabilityPolicyCard'

const SETTINGS_UPDATED_AT = '2026-09-28T10:00:00.000Z'
const readApiResultOrThrowMock = jest.fn()
const buildOptimisticLockHeaderMock = jest.fn((updatedAt: string | null | undefined) => (
  updatedAt ? { 'x-om-ext-optimistic-lock-expected-updated-at': updatedAt } : {}
))
const runMutationMock = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: (updatedAt: string | null | undefined) => buildOptimisticLockHeaderMock(updatedAt),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (...args: [{ operation: () => Promise<unknown> }]) => runMutationMock(...args),
    retryLastMutation: jest.fn(),
    isPending: false,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))

describe('OrganizationAvailabilityPolicyCard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    readApiResultOrThrowMock
      .mockResolvedValueOnce({
        configured: false,
        operatingHoursRuleSetId: null,
        lastCustomerBeforeCloseMinutes: 0,
        timeOverflowMinutes: 0,
        updatedAt: SETTINGS_UPDATED_AT,
      })
      .mockResolvedValueOnce({
        configured: true,
        operatingHoursRuleSetId: 'rule-set-1',
        lastCustomerBeforeCloseMinutes: 0,
        timeOverflowMinutes: 0,
        updatedAt: '2026-09-28T10:01:00.000Z',
      })
  })

  it('activates a ruleset explicitly with the settings record lock token', async () => {
    renderWithProviders(<OrganizationAvailabilityPolicyCard ruleSetId="rule-set-1" />)

    const activateButton = await screen.findByRole('button', { name: 'Official organization operating hours' })
    await waitFor(() => expect(activateButton).toBeEnabled())
    fireEvent.click(activateButton)

    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2))
    expect(buildOptimisticLockHeaderMock).toHaveBeenCalledWith(SETTINGS_UPDATED_AT)
    expect(readApiResultOrThrowMock).toHaveBeenLastCalledWith(
      '/api/planner/organization-availability-settings',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'x-om-ext-optimistic-lock-expected-updated-at': SETTINGS_UPDATED_AT,
        }),
        body: JSON.stringify({ operatingHoursRuleSetId: 'rule-set-1' }),
      }),
      expect.any(Object),
    )
  })
})
